/**
 * Fetch helpers for the board page. Every call is same-origin JSON with
 * credentials; none ever throws — a network failure is a typed result so the UI
 * can show "Reconnecting…" instead of an error screen.
 */

import type { BoardSessionState } from "@/app/lib/boardpass/sessions";

export type BoardState =
  | { state: "loading" }
  | { state: "unavailable" }
  | { state: "google-session" }
  | { state: "none"; expired?: boolean }
  | { state: "active"; session: BoardSessionState };

const BASE = "/api/v1/boardpass/session";

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  try {
    const res = await fetch(BASE + path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data: Record<string, unknown> = {};
    try { data = (await res.json()) as Record<string, unknown>; } catch { /* empty body */ }
    return { status: res.status, data };
  } catch {
    return { status: 0, data: {} };
  }
}

export async function fetchState(): Promise<BoardState | null> {
  const r = await call("GET", "");
  if (r.status !== 200) return null;
  return r.data as unknown as BoardState;
}

export type LoginResult =
  | { ok: true }
  | { ok: false; error: "invalid" | "throttled" | "duplicate" | "full" | "google-session" | "network" | "unavailable" };

export async function login(username: string, pin: string): Promise<LoginResult> {
  const r = await call("POST", "/participants", { username, pin });
  if (r.status === 0) return { ok: false, error: "network" };
  if (r.data.ok === true) return { ok: true };
  const e = r.data.error;
  if (e === "throttled" || e === "duplicate" || e === "full" || e === "google-session") return { ok: false, error: e };
  if (r.status === 404 || r.status === 503) return { ok: false, error: "unavailable" };
  return { ok: false, error: "invalid" };
}

export const removeParticipant = (id: string) => call("DELETE", `/participants/${encodeURIComponent(id)}`);
export const endSession = () => call("DELETE", "");
export const keepPlaying = () => call("POST", "/touch", {});

export async function bindGame(participantId: string, slug: string): Promise<"ok" | "busy" | "gone" | "network"> {
  const today = new Date();
  const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const r = await call("POST", "/active", {
    participantId,
    slug,
    day,
    tzOffsetMin: -today.getTimezoneOffset(),
  });
  if (r.status === 0) return "network";
  if (r.data.ok === true) return "ok";
  return r.status === 409 ? "busy" : "gone";
}

export const unbindGame = () => call("DELETE", "/active");

/** Fire-and-forget unbind for when the page is going away. */
export function unbindOnExit(): void {
  try {
    void fetch(BASE + "/active", { method: "DELETE", credentials: "same-origin", keepalive: true });
  } catch { /* nothing to do */ }
}
