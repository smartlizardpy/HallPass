/**
 * The one-time "players can see your IP" notice.
 *
 * Peers connect directly (no relay), so they can see each other's public IP
 * address: roughly where you are, plus the ISP or school network. The first
 * time a device is about to host or join over the `hallpass` transport the SDK
 * asks the player to confirm, then remembers the answer in `localStorage`.
 * Skipped for the `local` transport (one machine, nothing exposed), for
 * relay-only connections (peers only ever see the relay), and when the game
 * passes `ipNotice: 'custom'` (it shows its own consent).
 *
 * Failure policy: storage that throws (private mode, blocked site data) means
 * the notice shows once per page session instead of once per device; it never
 * crashes. Without a DOM there is nothing to show, so it passes. Cancel rejects
 * the connect promise with `P2PError('cancelled')`; it never hangs.
 *
 * The overlay lives in a shadow root under one `hallpass-p2p-notice` element,
 * so game CSS cannot restyle it and its CSS cannot leak into the game.
 */

import { hasDocument } from "./env";

export const NOTICE_KEY = "hallpass-p2p:ip-notice:v1";
export const NOTICE_TEXT = "Players in this room can see your IP address (it shows roughly where you are). Only play with people you know.";

/** Answered "Continue" this page session (covers storage that cannot persist). */
let acceptedThisSession = false;
/** The prompt currently on screen, so two connects share one dialog. */
let pending: Promise<boolean> | null = null;

/** Test hook. */
export function resetNoticeState(): void {
  acceptedThisSession = false;
  pending = null;
}

function readAck(): boolean {
  try {
    return globalThis.localStorage?.getItem(NOTICE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeAck(): void {
  try {
    globalThis.localStorage?.setItem(NOTICE_KEY, "1");
  } catch {
    // Not persistable: the in-memory flag still covers this page session.
  }
}

export function noticeAcknowledged(): boolean {
  return acceptedThisSession || readAck();
}

/**
 * Resolves `true` when the player has agreed (now or earlier) and `false` when
 * they cancelled. `show` is injectable for tests.
 */
export async function confirmIpNotice(show: () => Promise<boolean> = showNoticeDialog): Promise<boolean> {
  if (noticeAcknowledged()) return true;
  if (!hasDocument()) return true;
  pending ??= show().finally(() => {
    pending = null;
  });
  const ok = await pending;
  if (ok) {
    acceptedThisSession = true;
    writeAck();
  }
  return ok;
}

const CSS = `
:host{all:initial;display:block;position:fixed;inset:0;z-index:2147483647}
*{box-sizing:border-box}
.backdrop{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(8,10,20,.72);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;animation:fade .15s ease-out}
.card{width:100%;max-width:380px;max-height:100%;overflow:auto;padding:20px;border-radius:14px;background:#fff;color:#14161f;box-shadow:0 12px 40px rgba(0,0,0,.45);animation:pop .15s ease-out}
h2{margin:0 0 8px;font-size:18px;line-height:1.25}
p{margin:0 0 18px;font-size:15px;line-height:1.45}
.row{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap}
button{font:inherit;font-size:15px;font-weight:600;padding:10px 18px;min-height:44px;border-radius:10px;border:2px solid #3b4bd8;cursor:pointer}
button.go{background:#3b4bd8;color:#fff}
button.no{background:#fff;color:#3b4bd8}
button:focus-visible{outline:3px solid #f5a623;outline-offset:2px}
@keyframes fade{from{opacity:0}to{opacity:1}}
@keyframes pop{from{transform:scale(.96);opacity:.6}to{transform:none;opacity:1}}
@media (prefers-reduced-motion:reduce){.backdrop,.card{animation:none}}
`;

/** Renders the dialog; resolves true on Continue, false on Cancel / Escape / backdrop click. */
export function showNoticeDialog(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const previous = document.activeElement as HTMLElement | null;
    const host = document.createElement("hallpass-p2p-notice");
    const root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = CSS;
    const backdrop = document.createElement("div");
    backdrop.className = "backdrop";
    const card = document.createElement("div");
    card.className = "card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", "t");
    card.setAttribute("aria-describedby", "d");
    const h = document.createElement("h2");
    h.id = "t";
    h.textContent = "Before you play online";
    const p = document.createElement("p");
    p.id = "d";
    p.textContent = NOTICE_TEXT;
    const row = document.createElement("div");
    row.className = "row";
    const no = document.createElement("button");
    no.type = "button";
    no.className = "no";
    no.textContent = "Cancel";
    const go = document.createElement("button");
    go.type = "button";
    go.className = "go";
    go.textContent = "Continue";
    row.append(no, go);
    card.append(h, p, row);
    backdrop.append(card);
    root.append(style, backdrop);

    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      window.removeEventListener("keydown", onKey, true);
      host.remove();
      try {
        previous?.focus?.();
      } catch {
        // the old element may be gone
      }
      resolve(ok);
    };
    // Capture on window so the game's own key handlers never see the keys the
    // dialog uses (Escape, Tab) while it is open.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      } else if (e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        const active = root.activeElement;
        (active === go ? no : go).focus();
      }
    };
    no.addEventListener("click", () => finish(false));
    go.addEventListener("click", () => finish(true));
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) finish(false);
    });
    window.addEventListener("keydown", onKey, true);
    document.body.append(host);
    go.focus();
  });
}
