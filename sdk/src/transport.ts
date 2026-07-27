/**
 * Tiny fetch wrapper that upholds the SDK's golden rule: never throw, never
 * hang. Every call resolves to a uniform `TransportResult` within a bounded
 * timeout, even when `fetch` is missing, the network is down, CORS blocks the
 * request, or the body is not JSON.
 *
 * Load-bearing decisions:
 *  - An `AbortController` caps every request at ~6s; on timeout/abort/failure we
 *    resolve `{ ok: false, status: 0 }` (status 0 = "never reached the server",
 *    which the client maps to the `network` reason).
 *  - `mode: "cors"` + `credentials: "omit"` by DEFAULT because the SDK runs
 *    embedded on third-party game pages and talks cross-origin to the public
 *    leaderboard API. (The server vertical must send permissive CORS headers for
 *    this to land.) The same-origin identity endpoints (`/api/v1/me*`) opt into
 *    `credentials: "include"` via `RequestOptions` so the session cookie rides
 *    along; cross-origin those calls simply fail CORS and degrade to anonymous.
 *  - We swallow JSON parse errors: `data` is simply left `undefined`.
 */

/** Uniform outcome of every transport call. Never rejected. */
export interface TransportResult {
  ok: boolean;
  status: number;
  data?: unknown;
  error?: string;
}

/** Per-call transport knobs. */
export interface RequestOptions {
  /**
   * Credential mode. Defaults to `"omit"` (cross-origin public API calls). The
   * same-origin identity endpoints pass `"include"` to send the session cookie.
   */
  credentials?: RequestCredentials;
  /**
   * Ask the browser to let this request outlive the page.
   *
   * LOAD-BEARING for anything sent at game over. Without it the browser is free
   * to cancel an in-flight request the moment the document starts unloading, so
   * a final `unlock()` or a flushed `progress()` followed by
   * `location.href = ...` — the exact pattern the integration docs recommend —
   * silently never reaches the server. `app/lib/personalization.ts` documents
   * the same reasoning for the play beacon.
   *
   * Only meaningful on POSTs, and the browser caps all in-flight keepalive
   * bodies at 64 KiB. A batch here is at most `MAX_BATCH_SIZE` short entries,
   * which is orders of magnitude under that.
   */
  keepalive?: boolean;
}

/** Hard ceiling for any single request. */
const TIMEOUT_MS = 6000;

/** GET `url` expecting JSON. Always resolves. */
export function getJSON(url: string, opts?: RequestOptions): Promise<TransportResult> {
  return request(
    url,
    { method: "GET", headers: { Accept: "application/json" } },
    opts?.credentials,
    opts?.keepalive,
  );
}

/** POST `body` as JSON to `url`. Always resolves. */
export function postJSON(
  url: string,
  body: unknown,
  opts?: RequestOptions,
): Promise<TransportResult> {
  let payload: string;
  try {
    payload = JSON.stringify(body ?? {});
  } catch {
    payload = "{}";
  }
  return request(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: payload,
    },
    opts?.credentials,
    opts?.keepalive,
  );
}

async function request(
  url: string,
  init: RequestInit,
  credentials: RequestCredentials = "omit",
  keepalive = false,
): Promise<TransportResult> {
  if (typeof fetch === "undefined") {
    return { ok: false, status: 0, error: "fetch unavailable" };
  }

  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  // A race against an unconditional timer guarantees we ALWAYS resolve within
  // TIMEOUT_MS — even where `AbortController` is missing and the underlying
  // fetch could otherwise hang forever (the golden "never hang" rule).
  const timeout = new Promise<TransportResult>((resolve) => {
    timer = setTimeout(() => {
      if (controller) {
        try {
          controller.abort();
        } catch {
          // Ignore — the race below already resolves us.
        }
      }
      resolve({ ok: false, status: 0, error: "timeout" });
    }, TIMEOUT_MS);
  });

  const run = (async (): Promise<TransportResult> => {
    try {
      const res = await fetch(url, {
        ...init,
        mode: "cors",
        credentials,
        // Only set when asked. Passing `keepalive: false` explicitly is
        // harmless, but some older engines treat the presence of the key as
        // opting into the keepalive body-size accounting, and this SDK runs on
        // whatever browser a school hands a pupil.
        ...(keepalive ? { keepalive: true } : {}),
        signal: controller ? controller.signal : undefined,
      });

      const status = res.status;
      let data: unknown;
      try {
        data = await res.json();
      } catch {
        data = undefined;
      }

      if (res.ok) {
        return { ok: true, status, data };
      }
      return { ok: false, status, data, error: errorMessage(data, status) };
    } catch (err) {
      // Network failure, CORS rejection, abort/timeout — all land here.
      return {
        ok: false,
        status: 0,
        error: err instanceof Error ? err.message : "network error",
      };
    }
  })();

  try {
    return await Promise.race([run, timeout]);
  } finally {
    if (timer !== undefined) {
      try {
        clearTimeout(timer);
      } catch {
        // no-op
      }
    }
  }
}

/** Pull a human-readable message out of an `ApiError`-shaped body. */
function errorMessage(data: unknown, status: number): string {
  if (data && typeof data === "object" && "error" in data) {
    const value = (data as { error?: unknown }).error;
    if (typeof value === "string" && value) return value;
  }
  return "HTTP " + status;
}
