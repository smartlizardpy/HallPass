/**
 * The live HallPass client — the real implementation of the `HallPass` interface
 * that `index.ts` installs at `window.HallPass`.
 *
 * Golden rule everywhere: every public method RESOLVES and NONE THROW. Each one
 * is wrapped so that a storage/network/serialisation failure degrades to a safe
 * value (`getScores → []`, `submitScore → { ok: false, reason: ... }`).
 *
 * Event model: there is exactly one SDK instance per page, so a single
 * module-level registry backs `on`/`off`. `emit` is exported so `index.ts` can
 * fire the `"ready"` event through the same registry, and is also passed into
 * `createClient` (defaulting to the exported one) so tests can observe events
 * with a spy.
 */

import type {
  AuthRedirectOptions,
  ChallengeOptions,
  ChallengeResult,
  EventName,
  GetScoresOptions,
  HallPass,
  LeaderboardResponse,
  MeResponse,
  Mode,
  PlayerIdentity,
  ReadyState,
  ScoreEntry,
  SubmitOptions,
  SubmitResponse,
  SubmitResult,
} from "./contract";
import type { ResolvedConfig } from "./config";
import { createAchievements } from "./achievements";
import {
  AUTH_COMPLETE_PATH,
  openAuthPopup,
  subscribeAuthSignals,
  watchPopup,
} from "./auth-flow";
import {
  isSameOrigin,
  openInlinePicker,
  openPopupPicker,
  pickerUrl,
  subscribeChallengeSignals,
} from "./challenge";
import { ensureHandle, getHandle, setHandle } from "./handle";
import { getJSON, postJSON } from "./transport";
import { SDK_MAJOR } from "./version";

/** Event dispatcher signature. */
export type Emit = (event: EventName, payload: unknown) => void;

type Listener = (payload: unknown) => void;

/** Single-instance event registry shared by `on`/`off` and `emit`. */
const registry: Partial<Record<EventName, Listener[]>> = {};

/**
 * Last `"ready"` payload, cached so the one-shot `"ready"` event is STICKY: a
 * listener attached after bootstrap (via `on("ready", cb)`) is invoked
 * immediately with this value instead of missing the single emit.
 */
let lastReady: unknown;

/**
 * Last `"auth"` payload, cached so `"auth"` is STICKY exactly like `"ready"`: a
 * listener attached after the identity was last resolved (via `on("auth", cb)`)
 * is invoked immediately with the current `{ player }`. `undefined` = never
 * emitted yet (the payload object itself is never `undefined`).
 */
let lastAuth: unknown;

/** Dispatch `payload` to every listener of `event`. Never throws. */
export function emit(event: EventName, payload: unknown): void {
  if (event === "ready") lastReady = payload;
  if (event === "auth") lastAuth = payload;
  const listeners = registry[event];
  if (!listeners || !listeners.length) return;
  for (const cb of listeners.slice()) {
    try {
      cb(payload);
    } catch {
      // A misbehaving listener must never break the SDK.
    }
  }
}

/**
 * How long an abandoned challenge picker is left open before the SDK gives up,
 * removes it and resolves. Matches the listener's own watchdog in
 * `challenge.ts`, which only STOPS LISTENING — it cannot remove a frame or
 * settle a promise, so this is the half that actually cleans up.
 */
const PICKER_MAX_MS = 5 * 60 * 1000;

/** Cap on the number of pending claim tokens held in memory. */
const MAX_CLAIM_TOKENS = 20;

/** How long a remembered claim token is considered worth flushing (6h). */
const CLAIM_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** One remembered anonymous-submission claim token and when it was minted. */
interface ClaimEntry {
  token: string;
  ts: number;
}

/**
 * In-memory (NEVER persisted) store of claim tokens from anonymous submissions
 * made during THIS page visit. It is deliberately not written to storage: on a
 * shared computer the next player signing in must never absorb a previous
 * player's scores. It dies with the page — exactly the intended scope.
 */
const claimStore: ClaimEntry[] = [];

/**
 * Record a claim token from an OK anonymous `submitScore`. Prunes entries older
 * than {@link CLAIM_MAX_AGE_MS} and caps the store at {@link MAX_CLAIM_TOKENS}
 * (dropping the oldest). Fully guarded; never throws.
 */
function rememberClaimToken(token: string): void {
  try {
    if (typeof token !== "string" || !token) return;
    const now = Date.now();
    for (let i = claimStore.length - 1; i >= 0; i--) {
      if (now - claimStore[i].ts > CLAIM_MAX_AGE_MS) claimStore.splice(i, 1);
    }
    claimStore.push({ token, ts: now });
    while (claimStore.length > MAX_CLAIM_TOKENS) claimStore.shift();
  } catch {
    // A claim token is best-effort — never let bookkeeping throw.
  }
}

/** Compare two identity values by id; `null`/`undefined` both mean "no player". */
function samePlayer(
  a: PlayerIdentity | null | undefined,
  b: PlayerIdentity | null | undefined,
): boolean {
  const aId = a && typeof a === "object" ? a.id : null;
  const bId = b && typeof b === "object" ? b.id : null;
  return aId === bId;
}

/**
 * Build the live API object bound to a resolved config.
 * @param cfg   Resolved `{ game, api }`.
 * @param emitEvent Event sink (defaults to the module `emit`; overridable for tests).
 */
export function createClient(cfg: ResolvedConfig, emitEvent: Emit = emit): HallPass {
  // "inert" only when this environment has no usable fetch (e.g. a sandboxed
  // preview); otherwise "live". A reachable-but-failing network is NOT inert —
  // that surfaces as the "network" reason on individual calls.
  const mode: Mode = typeof fetch === "undefined" ? "inert" : "live";

  /**
   * In-memory cache of the player identity. `undefined` = not fetched yet;
   * `null` = fetched, no session; an object = the cached identity. It lives only
   * for this page (a full-page `signIn`/`signOut` navigation clears it anyway)
   * and is refreshed by `setPlayerHandle`. Per-instance, so tests are isolated.
   */
  let cachedPlayer: PlayerIdentity | null | undefined;

  /** Single-flight guard for {@link refreshAuth} so overlapping signals coalesce. */
  let refreshing = false;

  /**
   * True iff the configured API origin equals the page origin, so credentialed
   * (cookie-bearing) requests and popup auth signalling can actually work.
   *
   * DELEGATES to `challenge.ts` rather than keeping its own copy, so the SDK has
   * exactly one same-origin rule. The same answer decides whether a cookie can
   * flow, whether auth pops up or redirects, and whether the challenge picker is
   * an inline frame — and two rules that disagreed would let the picker open a
   * frame on an origin this function had already ruled out.
   */
  function sameOriginApi(): boolean {
    return isSameOrigin(cfg.api);
  }

  function leaderboardUrl(game: string): string {
    return cfg.api + "/api/v1/leaderboard/" + encodeURIComponent(game);
  }

  function meUrl(): string {
    return cfg.api + "/api/v1/me";
  }

  function meHandleUrl(): string {
    return cfg.api + "/api/v1/me/handle";
  }

  async function ready(opts?: { game?: string; api?: string }): Promise<ReadyState> {
    try {
      if (opts && typeof opts.game === "string" && opts.game.trim()) {
        cfg.game = opts.game.trim();
      }
      if (opts && typeof opts.api === "string" && opts.api.trim()) {
        cfg.api = opts.api.trim().replace(/\/+$/, "");
      }
      return {
        ready: true,
        game: cfg.game,
        handle: getHandle(),
        mode: api.mode,
      };
    } catch {
      return { ready: true, game: cfg.game, handle: null, mode: api.mode };
    }
  }

  async function submitScore(
    score: number,
    opts?: SubmitOptions,
  ): Promise<SubmitResult> {
    try {
      if (typeof score !== "number" || !isFinite(score)) {
        return fail("bad-score");
      }
      const game = cfg.game;
      if (!game) {
        return fail("no-game");
      }

      const handle = ensureHandle({
        handle: opts?.handle,
        promptHandle: opts?.promptHandle,
      });

      // Same-origin embeds send the session cookie so a signed-in submission is
      // attributed at insert; cross-origin embeds stay anonymous (default omit).
      const sameOrigin = sameOriginApi();
      const res = await postJSON(
        leaderboardUrl(game),
        { score, handle },
        { credentials: sameOrigin ? "include" : "omit" },
      );

      if (res.ok) {
        const body = res.data as Partial<SubmitResponse> | undefined;
        const rank = typeof body?.rank === "number" ? body.rank : undefined;
        // An anonymous same-origin submission may hand back a claim token; hold it
        // in memory so a later sign-in this visit can re-attribute the score.
        if (sameOrigin && typeof body?.claimToken === "string") {
          rememberClaimToken(body.claimToken);
        }
        const result: SubmitResult = { ok: true, rank };
        emitEvent("submitted", result);
        return result;
      }
      if (res.status === 429) {
        return fail("rate-limited", res.error);
      }
      if (res.status === 0) {
        return fail(
          api.mode === "inert" || res.error === "fetch unavailable"
            ? "inert"
            : "network",
          res.error,
        );
      }
      return fail("http", res.error);
    } catch {
      return fail("network");
    }

    function fail(reason: SubmitResult["reason"], error?: string): SubmitResult {
      const result: SubmitResult = { ok: false, reason };
      if (error) result.error = error;
      emitEvent("error", result);
      return result;
    }
  }

  async function getScores(opts?: GetScoresOptions): Promise<ScoreEntry[]> {
    try {
      const game = (opts && opts.game && opts.game.trim()) || cfg.game;
      if (!game) {
        emitEvent("scores", []);
        return [];
      }

      const limit = clampLimit(opts?.limit);
      const period = opts?.period ?? "all";
      const url =
        leaderboardUrl(game) +
        "?limit=" +
        limit +
        "&period=" +
        encodeURIComponent(period);

      const res = await getJSON(url);
      const scores = res.ok ? extractScores(res.data) : [];
      emitEvent("scores", scores);
      return scores;
    } catch {
      emitEvent("scores", []);
      return [];
    }
  }

  /**
   * Resolve the signed-in player's PUBLIC identity, or `null`. Same-origin GET to
   * `/api/v1/me` with credentials so the session cookie rides along. The first
   * successful answer (identity OR a confirmed no-session `null`) is cached; a
   * network/inert failure resolves `null` WITHOUT caching, so a later call retries.
   */
  async function getPlayer(): Promise<PlayerIdentity | null> {
    try {
      if (cachedPlayer !== undefined) return cachedPlayer;
      if (mode === "inert") return null;

      const res = await getJSON(meUrl(), { credentials: "include" });
      if (!res.ok) return null;

      cachedPlayer = extractPlayer(res.data);
      return cachedPlayer;
    } catch {
      return null;
    }
  }

  /**
   * Flush any pending claim tokens to `POST <api>/api/v1/me/claim` (same-origin,
   * credentialed) so this visit's anonymous scores attach to the signed-in
   * player. No-op when the store is empty. On an OK response the store is cleared;
   * on any failure the tokens are kept for a later retry. Fully guarded; never
   * throws.
   */
  async function flushClaims(): Promise<void> {
    try {
      if (!claimStore.length) return;
      const now = Date.now();
      const tokens = claimStore
        .filter((e) => now - e.ts <= CLAIM_MAX_AGE_MS)
        .map((e) => e.token);
      if (!tokens.length) {
        claimStore.length = 0;
        return;
      }
      const res = await postJSON(
        cfg.api + "/api/v1/me/claim",
        { tokens },
        { credentials: "include" },
      );
      if (res.ok) {
        // Claimed (or definitively rejected server-side) — drop them either way.
        claimStore.length = 0;
      }
      // Non-OK (network/transient) — keep the tokens for the next flush.
    } catch {
      // Never throw; keep tokens for retry.
    }
  }

  /**
   * Re-check the signed-in identity and, if it changed, emit the sticky `"auth"`
   * event. Single-flight so overlapping signals (popup close + BroadcastChannel +
   * storage) collapse into one refresh. Busts the identity cache, compares the new
   * identity to the previous by id (null vs non-null counts as a change), and on a
   * signed-in result fires a best-effort claim flush. Never throws.
   */
  async function refreshAuth(): Promise<void> {
    if (refreshing) return;
    refreshing = true;
    try {
      const prev = cachedPlayer;
      cachedPlayer = undefined;
      const player = await getPlayer();
      if (!samePlayer(prev, player)) {
        emitEvent("auth", { player });
      }
      if (player) {
        void flushClaims();
      }
    } catch {
      // Never throw to game code.
    } finally {
      refreshing = false;
    }
  }

  /**
   * Open the popup-based auth flow (or degrade). Busts the identity cache first.
   * No-op when inert or outside a browser. Cross-origin embeds keep the legacy
   * full-page `navigate()` (popup signalling and cookies can't work there). Live
   * same-origin: open a small popup so the game document is NOT unloaded; a blocked
   * popup falls back to a TOP-LEVEL navigation (never an iframe navigation, which
   * dead-ends at Google's frame refusal). Never throws.
   */
  function startAuthFlow(path: string, opts?: AuthRedirectOptions): void {
    try {
      cachedPlayer = undefined;
      if (mode === "inert") return;
      if (typeof window === "undefined" || !window.location) return;

      if (!sameOriginApi()) {
        navigate(path, opts);
        return;
      }

      const popup = openAuthPopup(
        path + "?callbackUrl=" + encodeURIComponent(AUTH_COMPLETE_PATH),
      );
      if (!popup) {
        topLevelNavigate(path, opts);
        return;
      }
      // A close is only a hint; refreshAuth re-fetches identity to confirm.
      watchPopup(popup, refreshAuth);
    } catch {
      // Never throw.
    }
  }

  /**
   * Popup-blocked fallback: navigate the TOP page (not this iframe) to `path`,
   * carrying the top page's own relative path as `callbackUrl`. If `window.top`
   * is cross-origin (inaccessible — reading its `location` throws), degrade to the
   * in-frame `navigate(path, opts)`. Never throws.
   */
  function topLevelNavigate(path: string, opts?: AuthRedirectOptions): void {
    try {
      const top = window.top;
      const topLoc = top ? top.location : null;
      if (!topLoc) {
        navigate(path, opts);
        return;
      }
      const back = topLoc.pathname + topLoc.search + topLoc.hash;
      topLoc.assign(path + "?callbackUrl=" + encodeURIComponent(back));
    } catch {
      // window.top is cross-origin inaccessible — fall back to in-frame navigate.
      try {
        navigate(path, opts);
      } catch {
        // Never throw.
      }
    }
  }

  /**
   * Open a small same-origin popup for Google sign-in; the game document is NOT
   * unloaded. Busts the identity cache. Falls back to a top-level redirect only if
   * the popup is blocked; cross-origin embeds keep the legacy full-page redirect.
   * No-op when inert or outside a browser; never throws.
   */
  function signIn(opts?: AuthRedirectOptions): void {
    startAuthFlow("/play/signin", opts);
  }

  /**
   * Open a small same-origin popup for the sign-out flow (the `/play/signout` page
   * runs the sign-out server action); the game document is NOT unloaded. Busts the
   * identity cache. Same fallbacks as {@link signIn}. No-op when inert or outside a
   * browser; never throws.
   */
  function signOut(opts?: AuthRedirectOptions): void {
    startAuthFlow("/play/signout", opts);
  }

  /**
   * Set the player's chosen handle. Same-origin credentialed POST to
   * `/api/v1/me/handle`; on success refresh the identity cache and resolve the
   * updated identity, else resolve `null`. Never throws.
   */
  async function setPlayerHandle(handle: string): Promise<PlayerIdentity | null> {
    try {
      if (mode === "inert") return null;

      const res = await postJSON(meHandleUrl(), { handle }, { credentials: "include" });
      if (!res.ok) return null;

      cachedPlayer = extractPlayer(res.data);
      return cachedPlayer;
    } catch {
      return null;
    }
  }

  /**
   * Navigate the browser to `path?callbackUrl=<redirectTo|location.href>`. Fully
   * guarded: a missing `window`, inert mode, or a sandbox that blocks navigation
   * all degrade to a silent no-op.
   */
  function navigate(path: string, opts?: AuthRedirectOptions): void {
    try {
      if (mode === "inert") return;
      if (typeof window === "undefined" || !window.location) return;
      const raw =
        (opts && typeof opts.redirectTo === "string" && opts.redirectTo.trim()) ||
        window.location.href;
      // The sign-in page only accepts a same-origin RELATIVE callbackUrl, so
      // reduce whatever we have (an absolute href by default) to its relative
      // part; a cross-origin value falls back to the current path.
      let back =
        window.location.pathname + window.location.search + window.location.hash;
      try {
        const u = new URL(raw, window.location.href);
        if (u.origin === window.location.origin) {
          back = u.pathname + u.search + u.hash;
        }
      } catch {
        // keep the current-path fallback
      }
      window.location.assign(path + "?callbackUrl=" + encodeURIComponent(back));
    } catch {
      // Navigation blocked (sandboxed iframe, etc.) — never throw.
    }
  }

  /**
   * The achievement half of the surface, built here so it shares this instance's
   * config object (so a later `ready({ game })` retargets it too), its mode, its
   * same-origin test, and — crucially — its event sink, so `"achievement"` is
   * delivered through the one registry `on`/`off` already talk to.
   *
   * Note `"achievement"` is deliberately NOT sticky, unlike `"ready"` and
   * `"auth"`. Those describe a STATE a late listener still needs; an unlock is a
   * MOMENT, and replaying it to every listener attached afterwards would re-toast
   * a trophy the player already celebrated.
   */
  const achievements = createAchievements({
    cfg,
    mode,
    sameOrigin: sameOriginApi,
    emit: emitEvent,
  });

  const api: HallPass = {
    version: SDK_MAJOR,
    mode,
    ready,
    submitScore,
    getScores,
    getHandle: () => getHandle(),
    setHandle: (handle: string) => setHandle(handle),
    getPlayer,
    signIn,
    signOut,
    setPlayerHandle,
    unlock: achievements.unlock,
    unlockMany: achievements.unlockMany,
    progress: achievements.progress,
    getAchievements: achievements.getAchievements,
    /**
     * Open the challenge picker and resolve once it closes.
     *
     * Orchestration only — the panel is a first-party HallPass page, so nothing
     * about the player is read or drawn here. This picks the transport, waits
     * for one signal, and tears the frame down.
     *
     * RESOLVES, NEVER REJECTS, like every other method. And note the two
     * distinct falsey outcomes: dismissing the picker is `{ ok: true, sent:
     * false, reason: "closed" }` because the call worked and the player simply
     * changed their mind, while a blocked popup is `ok: false` because the
     * player never got to decide.
     */
    challenge(opts?: ChallengeOptions): Promise<ChallengeResult> {
      return new Promise<ChallengeResult>((resolve) => {
        try {
          if (mode === "inert") {
            resolve({ ok: false, sent: false, reason: "inert" });
            return;
          }
          const game = opts?.game ?? cfg.game;
          const url = pickerUrl(cfg.api, { game, board: opts?.board });

          // Same-origin gets the inline card; anything else gets a popup, whose
          // top-level context still carries the session cookie. If the inline
          // path cannot mount either, there is no fallback worth trying — a
          // popup was already rejected for this origin by construction.
          const picker = isSameOrigin(cfg.api)
            ? openInlinePicker(url) ?? openPopupPicker(url)
            : openPopupPicker(url);

          if (!picker) {
            resolve({ ok: false, sent: false, reason: "popup-blocked" });
            return;
          }

          let settled = false;
          let cancelAbandonTimer = (): void => {};
          const finish = (result: ChallengeResult): void => {
            if (settled) return;
            settled = true;
            try {
              cancelAbandonTimer();
            } catch {
              // Teardown must not stop the promise settling.
            }
            try {
              unsubscribe();
            } catch {
              // Teardown must not stop the promise settling.
            }
            picker.close();
            resolve(result);
          };

          const unsubscribe = subscribeChallengeSignals(cfg.api, (signal) => {
            if (signal.sent && signal.challenge) {
              // A new event name, which the append-only rule explicitly allows:
              // a game that never listens for it is unaffected.
              emitEvent("challenge", signal.challenge);
              finish({ ok: true, sent: true, challenge: signal.challenge });
              return;
            }
            finish({
              ok: true,
              sent: false,
              reason: (signal.reason as ChallengeResult["reason"]) ?? "closed",
            });
          });

          // A popup the player closes by hand sends no signal, so its closing is
          // the only hint we get. `watchPopup` polls and calls back once.
          if (picker.window) {
            watchPopup(picker.window, () =>
              finish({ ok: true, sent: false, reason: "closed" }),
            );
          }

          // BACKSTOP, and it has to live here rather than in the subscriber.
          // `subscribeChallengeSignals` stops listening after its own deadline,
          // but stopping is all it can do: it cannot remove the frame and cannot
          // settle this promise. Left to that alone, an inline picker abandoned
          // for five minutes would be orphaned on the page forever — no signal
          // could reach it, nothing could close it, and the game's `await`
          // would never return. Finishing from here tears the frame down and
          // resolves, which is what an abandoned picker should do anyway.
          const abandoned = setTimeout(
            () => finish({ ok: true, sent: false, reason: "closed" }),
            PICKER_MAX_MS,
          );
          cancelAbandonTimer = () => clearTimeout(abandoned);
        } catch {
          resolve({ ok: false, sent: false, reason: "network" });
        }
      });
    },
    on(event: EventName, cb: (payload: unknown) => void): HallPass {
      try {
        if (typeof cb === "function") {
          (registry[event] || (registry[event] = [])).push(cb);
          // "ready" is sticky: a listener added after bootstrap still gets it.
          if (event === "ready" && lastReady !== undefined) {
            try {
              cb(lastReady);
            } catch {
              // A misbehaving listener must never break the SDK.
            }
          }
          // "auth" is sticky too: a late listener gets the last known identity.
          if (event === "auth" && lastAuth !== undefined) {
            try {
              cb(lastAuth);
            } catch {
              // A misbehaving listener must never break the SDK.
            }
          }
        }
      } catch {
        // ignore
      }
      return api;
    },
    off(event: EventName, cb: (payload: unknown) => void): HallPass {
      try {
        const listeners = registry[event];
        if (listeners) {
          const i = listeners.indexOf(cb);
          if (i >= 0) listeners.splice(i, 1);
        }
      } catch {
        // ignore
      }
      return api;
    },
  };

  // Live same-origin only: a sign-in/out completing in the popup — or in another
  // tab — pings us to re-check identity. One subscription for the page lifetime.
  try {
    if (mode === "live" && sameOriginApi()) {
      subscribeAuthSignals(refreshAuth);
    }
  } catch {
    // Never let wiring the listener throw during construction.
  }

  return api;
}

/** Clamp a requested limit into 1..100, default 10. */
function clampLimit(limit: unknown): number {
  if (typeof limit === "number" && isFinite(limit)) {
    const n = Math.floor(limit);
    if (n < 1) return 1;
    if (n > 100) return 100;
    return n;
  }
  return 10;
}

/** Pull a validated `ScoreEntry[]` out of a leaderboard response body. */
function extractScores(data: unknown): ScoreEntry[] {
  const body = data as Partial<LeaderboardResponse> | undefined;
  const scores = body?.scores;
  if (Array.isArray(scores)) {
    return scores.filter(isScoreEntry);
  }
  return [];
}

function isScoreEntry(value: unknown): value is ScoreEntry {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as ScoreEntry).rank === "number" &&
    typeof (value as ScoreEntry).handle === "string" &&
    typeof (value as ScoreEntry).score === "number"
  );
}

/**
 * Pull a validated `PlayerIdentity` out of a `MeResponse`-shaped body, else
 * `null`. The result is re-projected to EXACTLY the four public fields so a
 * malformed/over-sharing server response can never leak an extra field (e.g.
 * email) through the SDK surface.
 */
function extractPlayer(data: unknown): PlayerIdentity | null {
  const player = (data as Partial<MeResponse> | undefined)?.player;
  if (!isPlayerIdentity(player)) return null;
  return {
    id: player.id,
    name: player.name,
    image: typeof player.image === "string" ? player.image : null,
    handle: player.handle,
  };
}

function isPlayerIdentity(value: unknown): value is PlayerIdentity {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as PlayerIdentity).id === "string" &&
    typeof (value as PlayerIdentity).name === "string" &&
    typeof (value as PlayerIdentity).handle === "string"
  );
}
