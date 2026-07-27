/**
 * Achievements for the HallPass client — `unlock`, `unlockMany`, `progress`,
 * `getAchievements`, and the `"achievement"` event.
 *
 * WHY THIS LIVES INSIDE /sdk/v1/ INSTEAD OF A SIBLING BUNDLE. The obvious
 * alternative was `/sdk/v1/achievements.js`, loaded only by games that want it.
 * It was rejected, and the cost is worth writing down because it is not obvious
 * from the file sizes:
 *
 *   - A sibling bundle means a SECOND `<script>` tag AND a second inline stub in
 *     every game's HTML. The stub is what makes `HallPass.unlock()` safe to call
 *     before the network delivers anything; a second surface needs its own.
 *   - That stub is duplicated verbatim in four places (sdk/README.md,
 *     app/llms-full.txt/route.ts, app/lib/integration-prompt.ts, and every game
 *     already shipped). Splitting the SDK turns four copies to keep byte-identical
 *     into EIGHT — and a stub that drifts fails silently, by hanging a promise
 *     nobody ever resolves.
 *   - It also needs its own cache-busting and version story in `public/sw.js` and
 *     `next.config.ts`, both of which special-case the single non-hashed
 *     `/sdk/v1/hallpass.js` URL today.
 *
 * All of that to avoid shipping ~2 KB onto a bundle the game has already loaded,
 * parsed, and (after the first visit) cached. The trade is lopsided; we extend.
 *
 * THE COALESCER IS THE REASON THIS FILE IS NOT TRIVIAL. `progress()` is designed
 * to be callable from inside a `requestAnimationFrame` loop — "the player is now
 * at 57 zombies" is a natural thing to say every frame — so calls are merged per
 * key on a trailing ~1s edge, turning 60 calls/sec into ~1 request/sec/key.
 * Everything else in the file exists to make that merging SAFE:
 *
 *   - The merged value is the MAXIMUM, not the last one. The server takes
 *     `GREATEST(stored, incoming)`, so max is the only merge that agrees with
 *     what will actually be stored; "last write wins" would let the SDK report a
 *     number the database never held.
 *   - Every queued call is flushed on `pagehide` AND on `visibilitychange` →
 *     hidden, via `sendBeacon`. A plain `fetch` issued while the document is
 *     unloading is cancelled, which is precisely how you lose the LAST value —
 *     and the last value is the one that matters. A player who finishes at
 *     100/100 and is left staring at 97/100 forever is the bug this file is
 *     written to prevent.
 *   - Those beacon-path promises are still SETTLED rather than abandoned,
 *     because `pagehide` is not necessarily terminal: a bfcache restore brings
 *     the same document (and every pending promise) back to life.
 *
 * Golden rules inherited from the rest of the SDK and upheld here: every method
 * RESOLVES, none throw, nothing hangs (all fetch I/O goes through
 * `transport.ts`, which races a 6s timer), and a cross-origin or signed-out
 * embed degrades to a resolved no-op instead of a doomed request.
 */

import type {
  AchievementUnlock,
  AchievementsResponse,
  GetAchievementsOptions,
  Mode,
  PlayerAchievement,
  ProgressOptions,
  UnlockEntryResult,
  UnlockOptions,
  UnlockReason,
  UnlockResponse,
  UnlockResult,
} from "./contract";
import type { ResolvedConfig } from "./config";
import type { Emit } from "./client";
import type { TransportResult } from "./transport";
import { getJSON, postJSON } from "./transport";

/**
 * Trailing-edge window for `progress()`.
 *
 * One second is chosen against the failure it protects: at 60fps it collapses
 * ~60 calls into one request, while a player can never perceive a progress bar
 * that is at most a second stale. Shorter buys nothing; longer starts losing
 * updates to tab switches on flaky mobile connections.
 */
const COALESCE_MS = 1000;

/**
 * Entries per request. Mirrors `MAX_BATCH_SIZE` in
 * `app/lib/achievements/config.ts` — the server answers `bad-request` for a
 * bigger batch, so the SDK splits rather than letting a legitimate flush be
 * rejected wholesale. Not imported: `sdk/src/*` never reaches into `app/`.
 */
const MAX_BATCH = 20;

/**
 * Key format, mirrored from `ACHIEVEMENT_KEY_RE` (and from the
 * `achievements_key_format` CHECK behind it). Validating client-side turns a
 * typo into a resolved `bad-request` instead of a wasted round trip.
 */
const KEY_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** Largest value `player_achievements.progress` (INTEGER) can hold. */
const MAX_PROGRESS = 2147483647;

/** Rendered when nothing — server, catalogue, or cache — supplies an icon. */
const FALLBACK_ICON = "🏅";

/** Every valid {@link UnlockReason}, for validating a server-sent one. */
const REASONS: Record<string, true> = {
  "no-game": true,
  "bad-request": true,
  "signed-out": true,
  "unknown-achievement": true,
  inert: true,
  network: true,
  "rate-limited": true,
  http: true,
};

/** One key awaiting a flush, plus everyone who asked about it. */
interface Pending {
  key: string;
  /** Absolute progress, or `null` for a bare unlock ("reach the target"). */
  progress: number | null;
  /** Resolvers of every `unlock`/`progress` promise merged into this entry. */
  waiters: Array<(result: UnlockResult) => void>;
}

/** What {@link createAchievements} needs from the client that owns it. */
export interface AchievementDeps {
  /** The LIVE config object — `ready({ game })` may rewrite `cfg.game` later. */
  cfg: ResolvedConfig;
  /** The owning client's mode; `inert` short-circuits every call. */
  mode: Mode;
  /** `sameOriginApi()` from the client — gates cookie-credentialed requests. */
  sameOrigin: () => boolean;
  /** The client's event sink, so `"achievement"` rides the one registry. */
  emit: Emit;
}

/** The achievement half of the `HallPass` surface. */
export interface AchievementApi {
  unlock(key: string, opts?: UnlockOptions): Promise<UnlockResult>;
  unlockMany(keys: string[], opts?: UnlockOptions): Promise<UnlockResult[]>;
  progress(key: string, value: number, opts?: ProgressOptions): Promise<UnlockResult>;
  getAchievements(opts?: GetAchievementsOptions): Promise<PlayerAchievement[]>;
}

export function createAchievements(deps: AchievementDeps): AchievementApi {
  const { cfg, mode, sameOrigin, emit } = deps;

  /**
   * Queued entries, keyed by game and then by achievement key. Keyed by GAME
   * because `opts.game` lets one page drive two boards, and a batch is scoped to
   * one `/games/<slug>/achievements` URL — mixing them would post keys to the
   * wrong catalogue, where they would resolve to nothing at all.
   */
  const queues = new Map<string, Map<string, Pending>>();

  /** The single armed trailing-edge timer, or `undefined` when idle. */
  let timer: ReturnType<typeof setTimeout> | undefined;

  /** Unload hooks are attached lazily — a game that never queues pays nothing. */
  let hooked = false;

  /**
   * Catalogue cache per game, used ONLY to put a name and an icon on an unlock
   * the server did not enrich. It is deliberately not used to answer
   * `getAchievements()`: a game calls that to re-render after unlocking
   * something, and serving it a stale list would show the player the trophy case
   * they had a moment ago.
   */
  const catalogue = new Map<string, Map<string, PlayerAchievement>>();

  /** Single-flight guard so a burst of unlocks triggers ONE catalogue read. */
  const catalogueLoads = new Map<string, Promise<void>>();

  /**
   * Keys this page has already celebrated, per game.
   *
   * The server answers "newly unlocked" from the row as its own statement saw
   * it, which is right for the row but not sufficient for a toast: two beacons
   * for the same key can overlap, both see it unearned, and both report the
   * earn. Only the client knows what this page has already shown, so the
   * at-most-once rule lives here. Never pruned — it holds a handful of short
   * strings for the lifetime of one page.
   */
  const announced = new Map<string, Set<string>>();

  function achievementsUrl(game: string): string {
    return cfg.api + "/api/v1/games/" + encodeURIComponent(game) + "/achievements";
  }

  /** The slug for this call: explicit override, else the configured one. */
  function resolveGame(override?: string): string | null {
    if (typeof override === "string" && override.trim()) return override.trim();
    return cfg.game;
  }

  /**
   * Reject a write we know cannot land, WITHOUT firing a request.
   *
   * The cross-origin case is the interesting one. Achievements are attached to a
   * signed-in player, and the endpoint is cookie-credentialed, so a third-party
   * embed has no identity to write to — the request would be a guaranteed 401
   * (or a CORS failure before that). `signed-out` is the honest reason, and
   * resolving it locally keeps a cross-origin game from spraying doomed requests
   * out of its game loop.
   */
  function precheck(key: unknown, game: string | null): UnlockResult | null {
    if (typeof key !== "string" || !KEY_RE.test(key)) {
      return { ok: false, key: typeof key === "string" ? key : undefined, unlocked: false, reason: "bad-request" };
    }
    if (!game) return { ok: false, key, unlocked: false, reason: "no-game" };
    if (mode === "inert") return { ok: false, key, unlocked: false, reason: "inert" };
    if (!sameOrigin()) return { ok: false, key, unlocked: false, reason: "signed-out" };
    return null;
  }

  function queueFor(game: string): Map<string, Pending> {
    let queue = queues.get(game);
    if (!queue) {
      queue = new Map<string, Pending>();
      queues.set(game, queue);
    }
    return queue;
  }

  /**
   * Merge two reports of the same key.
   *
   * A bare unlock (`null`) beats an explicit number because "earn this" is the
   * stronger statement; otherwise the LARGER number wins. Max — not "latest" —
   * because the server stores `GREATEST(existing, incoming)`, so the largest
   * value in the window is the one that will exist afterwards either way. The
   * same rule is implemented server-side in `record()`; both are needed, since
   * the SDK's copy decides what a single flush reports back to the game.
   */
  function mergeProgress(held: number | null, incoming: number | null): number | null {
    if (held === null || incoming === null) return null;
    return Math.max(held, incoming);
  }

  /** Queue one entry, returning the promise the caller awaits. Never throws. */
  function enqueue(game: string, key: string, progress: number | null): Promise<UnlockResult> {
    return new Promise<UnlockResult>((resolve) => {
      try {
        const queue = queueFor(game);
        const held = queue.get(key);
        if (held) {
          held.progress = mergeProgress(held.progress, progress);
          held.waiters.push(resolve);
        } else {
          queue.set(key, { key, progress, waiters: [resolve] });
        }
        armUnloadHooks();
      } catch {
        // Queueing itself failed (an exotic environment with no Map, say).
        // Resolve rather than leave the caller's promise dangling forever.
        resolve({ ok: false, key, unlocked: false, reason: "network" });
      }
    });
  }

  /**
   * Attach the unload flushes, once.
   *
   * BOTH events, deliberately: `pagehide` is the one that fires on a real
   * navigation (including bfcache), while `visibilitychange` → hidden is the
   * only one a mobile browser reliably delivers before it freezes or kills a
   * backgrounded tab. Flushing twice is harmless — the second call finds an
   * empty queue.
   */
  function armUnloadHooks(): void {
    if (hooked) return;
    hooked = true;
    try {
      if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
      window.addEventListener("pagehide", flushOnUnload);
      // On the DOCUMENT, not the window: `visibilitychange` is fired at the
      // document, and relying on it bubbling up is how this quietly stops
      // working in an environment that dispatches it non-bubbling.
      if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
        document.addEventListener("visibilitychange", () => {
          try {
            if (document.visibilityState !== "hidden") return;
            // A hidden document is USUALLY STILL ALIVE — an alt-tab, a phone
            // screen lock, another app coming forward. Routing that through
            // `flushOnUnload` would beacon the batch fire-and-forget: the
            // response is never read, so `announce` never runs, and an
            // achievement earned in that moment fires no "achievement" event
            // and resolves `unlocked:false`. The player comes back to a live
            // page having silently earned something, and the toast is gone for
            // good.
            //
            // So flush NORMALLY here and read the reply. `send` sets
            // `keepalive`, so if this hide does turn out to be the start of a
            // real teardown the request still survives it. `pagehide` — which
            // genuinely means the document is going away — keeps the beacon.
            void flush();
          } catch {
            // Never throw out of an event handler.
          }
        });
      }
    } catch {
      // No event target to hook — the timer path still runs.
    }
  }

  /** Arm the trailing edge if it is not already armed. */
  function scheduleFlush(): void {
    try {
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        void flush();
      }, COALESCE_MS);
    } catch {
      // No timers here — fall back to sending immediately.
      void flush();
    }
  }

  /** Cancel the trailing edge (a flush is happening now instead). */
  function cancelTimer(): void {
    try {
      if (timer !== undefined) clearTimeout(timer);
    } catch {
      // ignore
    }
    timer = undefined;
  }

  /**
   * Take everything queued and clear the queues in ONE synchronous step.
   *
   * Draining before any `await` is what keeps a flush and a concurrent
   * `progress()` from fighting over the same entry: calls that arrive while a
   * request is in flight land in a fresh queue and become the next batch.
   */
  function drain(): Array<{ game: string; items: Pending[] }> {
    const out: Array<{ game: string; items: Pending[] }> = [];
    for (const [game, queue] of queues) {
      const items = Array.from(queue.values());
      if (items.length) out.push({ game, items });
    }
    queues.clear();
    return out;
  }

  /** Split a game's entries into server-legal batches. */
  function chunk(items: Pending[]): Pending[][] {
    const out: Pending[][] = [];
    for (let i = 0; i < items.length; i += MAX_BATCH) {
      out.push(items.slice(i, i + MAX_BATCH));
    }
    return out;
  }

  /**
   * Resolve every promise merged into these entries. EVERY code path must end
   * here: an unresolved waiter is a hang, and "never hang" is the rule that
   * matters most to a game that awaited us inside its loop.
   */
  function settle(items: Pending[], make: (item: Pending) => UnlockResult): void {
    for (const item of items) {
      const waiters = item.waiters.splice(0);
      for (const waiter of waiters) {
        try {
          waiter(make(item));
        } catch {
          // A resolver cannot normally throw; never let it break the flush.
        }
      }
    }
  }

  /** Send everything queued now. Never throws; always settles what it drained. */
  async function flush(): Promise<void> {
    cancelTimer();
    const batches = drain();
    const sends: Array<Promise<void>> = [];
    for (const batch of batches) {
      for (const items of chunk(batch.items)) {
        sends.push(send(batch.game, items));
      }
    }
    try {
      await Promise.all(sends);
    } catch {
      // `send` never rejects; this is belt-and-braces.
    }
  }

  /** POST one batch and settle it against the response. Never throws. */
  async function send(game: string, items: Pending[]): Promise<void> {
    try {
      const entries = items.map((item) => ({ key: item.key, progress: item.progress }));
      // `keepalive` is LOAD-BEARING, not a nicety. The integration docs tell a
      // game to unlock "at game over" and then navigate, and `unlock()` /
      // `unlockMany()` / `progress({flush:true})` all drain the queue
      // SYNCHRONOUSLY — so by the time `pagehide` fires there is nothing left
      // for the beacon path to rescue, and without this flag the browser is
      // free to cancel the in-flight POST. That loses the final value, and
      // because the server merges with GREATEST a per-run counter never heals:
      // the player finishes at 100/100 and sees 97/100 forever.
      const res = await postJSON(
        achievementsUrl(game),
        { entries },
        { credentials: "include", keepalive: true },
      );

      if (!res.ok) {
        const reason = transportReason(res);
        settle(items, (item) => ({
          ok: false,
          key: item.key,
          unlocked: false,
          reason,
          error: res.error,
        }));
        return;
      }

      const body = res.data as Partial<UnlockResponse> | undefined;
      // A batch-level `ok:false` (rate-limited, signed-out, bad-request) carries
      // no per-entry results, so every entry in it takes the batch's reason.
      if (body && body.ok === false) {
        const reason = isReason(body.reason) ? body.reason : "http";
        settle(items, (item) => ({ ok: false, key: item.key, unlocked: false, reason }));
        return;
      }

      const results = extractResults(body);
      const byKey = new Map<string, UnlockEntryResult>();
      for (const entry of results) byKey.set(entry.key, entry);

      // Enrich + announce BEFORE settling so a game that both listens for
      // "achievement" and awaits the promise sees the event first — one
      // ordering, always, rather than one that depends on timing.
      const unlocks = await announce(game, results);

      settle(items, (item) => {
        const entry = byKey.get(item.key);
        if (!entry) {
          // Resolved nothing: the key is not provisioned for this game. Not an
          // error for the batch (others may have landed) but, for the caller who
          // asked about THIS key, it is exactly why their unlock did not happen.
          return { ok: false, key: item.key, unlocked: false, reason: "unknown-achievement" };
        }
        const result: UnlockResult = {
          ok: true,
          key: entry.key,
          unlocked: entry.unlocked,
          alreadyUnlocked: entry.alreadyUnlocked,
          progress: entry.progress,
          target: entry.target,
        };
        const unlock = unlocks.get(entry.key);
        if (unlock) result.achievement = unlock;
        return result;
      });
    } catch {
      settle(items, (item) => ({ ok: false, key: item.key, unlocked: false, reason: "network" }));
    }
  }

  /**
   * Fire `"achievement"` once per NEWLY earned achievement, and return the
   * payloads so the resolved `UnlockResult` can carry the same object.
   *
   * The filter is `entry.unlocked`, which the server defines as "unearned before
   * this statement AND earned after it". An already-held achievement is
   * therefore silent — that single condition is the whole difference between a
   * celebration and an annoyance, because a progress beacon re-reports a
   * finished achievement on every call.
   *
   * Enrichment: the server MAY send `name`/`icon` with the result, in which case
   * this costs nothing. When it does not, we read the catalogue once (single
   * flight, cached) so `showToast(a.name, a.icon)` still works. A cached entry
   * that is a LOCKED SECRET is refreshed first — its name is redacted by design,
   * and the player has just earned the right to see it.
   */
  async function announce(
    game: string,
    results: UnlockEntryResult[],
  ): Promise<Map<string, AchievementUnlock>> {
    const out = new Map<string, AchievementUnlock>();
    try {
      const fresh = results.filter((entry) => {
        if (!entry || !entry.unlocked) return false;
        // AT MOST ONCE PER KEY, whatever the server says.
        //
        // The server decides `unlocked` from the row as its own statement saw
        // it, and two beacons for the same key can be in flight at once (a
        // flush re-arms the timer immediately). Both snapshots then see the
        // achievement as unearned, both statements report it as newly earned,
        // and the game shows the same celebration twice. The stored row is
        // fine — COALESCE keeps the first timestamp — so this is purely a
        // presentation defect, and the honest place to fix it is here, where
        // "have we already told this page about this key" is actually knowable.
        const seen = announced.get(game);
        if (seen && seen.has(entry.key)) return false;
        if (seen) seen.add(entry.key);
        else announced.set(game, new Set([entry.key]));
        return true;
      });
      if (!fresh.length) return out;

      const stale = fresh.some((entry) => {
        if (str(entry.name)) return false;
        const cached = lookup(game, entry.key);
        return !cached || (cached.secret && !cached.unlocked);
      });
      if (stale) await loadCatalogue(game);

      for (const entry of fresh) {
        const cached = lookup(game, entry.key);
        const payload: AchievementUnlock = {
          key: entry.key,
          // Last resort is the KEY itself: an ugly toast is a bug report, an
          // `undefined` toast is a support ticket about "the game breaking".
          name: str(entry.name) || (cached && cached.name) || entry.key,
          description: str(entry.description) || (cached && cached.description) || "",
          icon: str(entry.icon) || (cached && cached.icon) || FALLBACK_ICON,
          points: num(entry.points, cached ? cached.points : 0),
          progress: num(entry.progress, 0),
          target: Math.max(1, num(entry.target, 1)),
          unlockedAt: cached && cached.unlockedAt ? cached.unlockedAt : null,
          game,
        };
        out.set(entry.key, payload);
        emit("achievement", payload);
      }
    } catch {
      // Never let decorating a toast break the unlock that earned it.
    }
    return out;
  }

  function lookup(game: string, key: string): PlayerAchievement | undefined {
    const cached = catalogue.get(game);
    return cached ? cached.get(key) : undefined;
  }

  /**
   * Refresh one game's catalogue cache, at most once concurrently.
   *
   * `.then(done, done)` rather than `.finally`: `Promise.prototype.finally` is
   * ES2018 and this bundle targets ES2017 browsers, where esbuild would leave
   * the call in place to fail at runtime on the oldest devices in a school.
   */
  function loadCatalogue(game: string): Promise<void> {
    const inflight = catalogueLoads.get(game);
    if (inflight) return inflight;
    const done = (): void => {
      catalogueLoads.delete(game);
    };
    const load = getAchievements({ game }).then(done, done);
    catalogueLoads.set(game, load);
    return load;
  }

  /**
   * Flush on unload with `sendBeacon`, the ONLY transport that survives a
   * document being torn down.
   *
   * A `fetch` issued from `pagehide` is cancelled when the document goes away —
   * that is exactly how the final progress value gets lost. `sendBeacon` is
   * specified as a keepalive request, so the browser keeps it alive past the
   * page; it also carries same-origin cookies, which is all this endpoint needs
   * (we only ever queue same-origin, so the beacon is never a cross-origin
   * request needing a preflight it cannot get).
   *
   * If `sendBeacon` is missing or refuses (it returns `false` when the payload
   * exceeds the browser's queue), we still try the normal transport: likely
   * cancelled, but a cancelled attempt beats no attempt. `transport.ts` cannot
   * set `keepalive` today and is not this vertical's file to change.
   */
  function flushOnUnload(): void {
    try {
      cancelTimer();
      for (const batch of drain()) {
        for (const items of chunk(batch.items)) {
          const url = achievementsUrl(batch.game);
          const payload = { entries: items.map((item) => ({ key: item.key, progress: item.progress })) };
          if (!beacon(url, payload)) {
            void postJSON(url, payload, { credentials: "include", keepalive: true });
          }
          // Settled, not abandoned: `pagehide` is not always the end — a bfcache
          // restore revives this document with these promises still pending, and
          // a game awaiting one would otherwise hang for the rest of its life.
          settle(items, (item) => ({
            ok: true,
            key: item.key,
            unlocked: false,
            progress: item.progress === null ? undefined : item.progress,
          }));
        }
      }
    } catch {
      // Never throw out of an unload handler.
    }
  }

  /** `navigator.sendBeacon` with every guard; `false` means "did not send". */
  function beacon(url: string, payload: unknown): boolean {
    try {
      if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") {
        return false;
      }
      const text = JSON.stringify(payload);
      // A JSON Blob keeps the Content-Type the route expects. Same-origin only,
      // so the non-safelisted type cannot trip a preflight a beacon can't do.
      const body: BodyInit =
        typeof Blob === "function" ? new Blob([text], { type: "application/json" }) : text;
      return navigator.sendBeacon(url, body) === true;
    } catch {
      return false;
    }
  }

  /** Earn one achievement outright. Flushes immediately — a toast cannot wait. */
  async function unlock(key: string, opts?: UnlockOptions): Promise<UnlockResult> {
    try {
      const game = resolveGame(opts && opts.game);
      const bad = precheck(key, game);
      if (bad) return bad;

      const pending = enqueue(game as string, key, null);
      void flush();
      return await pending;
    } catch {
      return { ok: false, key: typeof key === "string" ? key : undefined, unlocked: false, reason: "network" };
    }
  }

  /**
   * Earn several at once — ONE request for the whole set (or one per 20).
   *
   * Results come back in the order the keys were given, including the ones
   * rejected locally, so a caller can zip them against their own list.
   */
  async function unlockMany(keys: string[], opts?: UnlockOptions): Promise<UnlockResult[]> {
    try {
      if (!Array.isArray(keys) || !keys.length) return [];
      const game = resolveGame(opts && opts.game);
      const pending = keys.map((key) => {
        const bad = precheck(key, game);
        if (bad) return Promise.resolve(bad);
        return enqueue(game as string, key, null);
      });
      void flush();
      return await Promise.all(pending);
    } catch {
      return [];
    }
  }

  /** Report absolute progress. Coalesced unless `opts.flush` says otherwise. */
  async function progress(
    key: string,
    value: number,
    opts?: ProgressOptions,
  ): Promise<UnlockResult> {
    try {
      const game = resolveGame(opts && opts.game);
      const bad = precheck(key, game);
      if (bad) return bad;
      if (typeof value !== "number" || !isFinite(value)) {
        return { ok: false, key, unlocked: false, reason: "bad-request" };
      }

      // Clamped in the client as well as the server: an out-of-range INTEGER
      // makes Postgres raise for the WHOLE statement, so one game's arithmetic
      // bug would take every other entry in the batch down with it.
      const clamped = Math.min(MAX_PROGRESS, Math.max(0, Math.floor(value)));
      const pending = enqueue(game as string, key, clamped);
      if (opts && opts.flush) {
        void flush();
      } else {
        scheduleFlush();
      }
      return await pending;
    } catch {
      return { ok: false, key: typeof key === "string" ? key : undefined, unlocked: false, reason: "network" };
    }
  }

  /**
   * The player's view of one game's achievements. Always a fresh read (see the
   * `catalogue` comment), and always `[]` rather than an error.
   *
   * Credentials mirror `submitScore`: `include` same-origin so the session
   * cookie identifies the player, `omit` cross-origin so a wildcard-CORS public
   * read still returns the locked catalogue instead of failing preflight.
   */
  async function getAchievements(opts?: GetAchievementsOptions): Promise<PlayerAchievement[]> {
    try {
      const game = resolveGame(opts && opts.game);
      if (!game || mode === "inert") return [];

      const res = await getJSON(achievementsUrl(game), {
        credentials: sameOrigin() ? "include" : "omit",
      });
      if (!res.ok) return [];

      const list = extractAchievements(res.data);
      const cached = new Map<string, PlayerAchievement>();
      for (const item of list) cached.set(item.key, item);
      catalogue.set(game, cached);
      return list;
    } catch {
      return [];
    }
  }

  return { unlock, unlockMany, progress, getAchievements };

  /** Map a failed transport result onto the reason a game should read. */
  function transportReason(res: TransportResult): UnlockReason {
    if (res.status === 0) {
      return mode === "inert" || res.error === "fetch unavailable" ? "inert" : "network";
    }
    if (res.status === 401 || res.status === 403) return "signed-out";
    if (res.status === 404) return "no-game";
    if (res.status === 429) return "rate-limited";
    if (res.status === 400) return "bad-request";
    return "http";
  }
}

function isReason(value: unknown): value is UnlockReason {
  return typeof value === "string" && REASONS[value] === true;
}

/** A trimmed non-empty string, else `""` — so `||` chains read cleanly. */
function str(value: unknown): string {
  return typeof value === "string" && value ? value : "";
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && isFinite(value) ? value : fallback;
}

/**
 * Pull validated per-entry results out of an `UnlockResponse` body. Anything
 * malformed is dropped rather than trusted: a bad element would otherwise
 * become a toast reading "undefined".
 */
function extractResults(body: Partial<UnlockResponse> | undefined): UnlockEntryResult[] {
  const results = body && body.results;
  if (!Array.isArray(results)) return [];
  return results.filter(isEntryResult);
}

function isEntryResult(value: unknown): value is UnlockEntryResult {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as UnlockEntryResult).key === "string" &&
    typeof (value as UnlockEntryResult).unlocked === "boolean"
  );
}

/**
 * Pull a validated `PlayerAchievement[]` out of a response body, RE-PROJECTED to
 * exactly the ten public fields — the same discipline `extractPlayer` uses in
 * `client.ts`, and for the same reason: a server that starts over-sharing (an
 * internal id, an email) must not be able to leak the extra field through the
 * SDK surface just because a game spreads the object into its own state.
 */
function extractAchievements(data: unknown): PlayerAchievement[] {
  const body = data as Partial<AchievementsResponse> | undefined;
  const list = body && body.achievements;
  if (!Array.isArray(list)) return [];
  const out: PlayerAchievement[] = [];
  for (const item of list) {
    if (!isAchievementish(item)) continue;
    const target = Math.max(1, num(item.target, 1));
    out.push({
      key: item.key,
      name: str(item.name) || item.key,
      description: str(item.description),
      icon: str(item.icon) || FALLBACK_ICON,
      points: num(item.points, 0),
      target,
      secret: item.secret === true,
      progress: Math.min(target, Math.max(0, num(item.progress, 0))),
      unlocked: item.unlocked === true,
      unlockedAt: typeof item.unlockedAt === "string" ? item.unlockedAt : null,
    });
  }
  return out;
}

function isAchievementish(value: unknown): value is Partial<PlayerAchievement> & { key: string } {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as PlayerAchievement).key === "string" &&
    !!(value as PlayerAchievement).key
  );
}
