/**
 * SDK configuration resolution.
 *
 * Figures out WHICH leaderboard (`game`) the host page is wired to and WHERE the
 * API lives (`api`), from three independent sources in a fixed precedence:
 *   1. `window.HALLPASS_CONFIG` — explicit page-level override.
 *   2. `data-game` / `data-api` attributes on the SDK's own `<script>` tag.
 *   3. The origin the SDK script was served from (its own `src`), else the page
 *      origin. (Games are embedded on third-party pages, so the script origin is
 *      the API origin — e.g. `https://hallpass.gg`.)
 *
 * Load-bearing decision: `document.currentScript` is only the SDK's own tag
 * DURING synchronous top-level evaluation; inside the async callbacks that run
 * later it is `null`. Because the whole SDK is bundled into ONE IIFE that runs
 * synchronously on load, we capture it here at module-eval time and reuse it.
 * `resolveConfig` takes the script as an (overridable) argument purely so tests
 * can inject a fabricated `<script>` element.
 */

/** Resolved runtime configuration. `api` is always a string (never empty in a browser). */
export interface ResolvedConfig {
  game: string | null;
  api: string;
}

/**
 * The `<script>` element that loaded this SDK, captured synchronously during
 * module evaluation. `null` outside a browser (e.g. under jsdom in tests, where
 * resolveConfig is called with an explicit element instead).
 */
const SDK_SCRIPT: HTMLScriptElement | null = captureCurrentScript();

function captureCurrentScript(): HTMLScriptElement | null {
  try {
    const el = typeof document !== "undefined" ? document.currentScript : null;
    return el instanceof HTMLScriptElement ? el : null;
  } catch {
    return null;
  }
}

/**
 * Resolve `{ game, api }` following the documented precedence. Never throws.
 * @param script The SDK script element. Defaults to the one captured at load.
 */
export function resolveConfig(
  script: HTMLScriptElement | null = SDK_SCRIPT,
): ResolvedConfig {
  const global = readGlobalConfig();

  const game = firstNonEmpty(global.game, attr(script, "data-game")) ?? null;

  const api = normalizeApi(
    firstNonEmpty(
      global.api,
      attr(script, "data-api"),
      scriptOrigin(script),
      pageOrigin(),
    ) ?? "",
  );

  return { game, api };
}

/** Read `window.HALLPASS_CONFIG`, tolerating any malformed shape. */
function readGlobalConfig(): { game?: string; api?: string } {
  try {
    const holder = window as unknown as {
      HALLPASS_CONFIG?: { game?: unknown; api?: unknown };
    };
    const cfg = holder.HALLPASS_CONFIG;
    if (cfg && typeof cfg === "object") {
      return {
        game: typeof cfg.game === "string" ? cfg.game : undefined,
        api: typeof cfg.api === "string" ? cfg.api : undefined,
      };
    }
  } catch {
    // Accessing window can throw in exotic sandboxes; fall through.
  }
  return {};
}

/** Read a trimmed attribute off the script element, or `undefined`. */
function attr(script: HTMLScriptElement | null, name: string): string | undefined {
  try {
    const value = script?.getAttribute(name);
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

/** The origin of the script's own `src`, e.g. `https://hallpass.gg`. */
function scriptOrigin(script: HTMLScriptElement | null): string | undefined {
  try {
    const src = script?.src;
    if (src) return new URL(src).origin;
  } catch {
    // Relative / malformed src — fall through to the page origin.
  }
  return undefined;
}

/** The host page origin, as a last resort. */
function pageOrigin(): string | undefined {
  try {
    return window.location.origin || undefined;
  } catch {
    return undefined;
  }
}

/** First defined, non-empty (after trim) candidate. */
function firstNonEmpty(...candidates: Array<string | undefined>): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const trimmed = candidate.trim();
      if (trimmed) return trimmed;
    }
  }
  return undefined;
}

/** Drop trailing slashes so `api + "/api/v1/..."` never double-slashes. */
function normalizeApi(api: string): string {
  return api.replace(/\/+$/, "");
}
