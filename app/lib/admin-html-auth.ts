import { createHash, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "hp_admin_html";

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function sessionTokenFromPassword(password: string): string {
  return sha256(`${password}::hallpass-html-admin`);
}

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(sha256(a), "utf8");
  const bBuf = Buffer.from(sha256(b), "utf8");
  return timingSafeEqual(aBuf, bBuf);
}

export function isAdminPasswordConfigured(): boolean {
  return Boolean(process.env.ADMIN_HTML_PASSWORD);
}

export async function isHtmlAdminAuthenticated(): Promise<boolean> {
  const password = process.env.ADMIN_HTML_PASSWORD?.trim();
  if (!password) return false;
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  return token === sessionTokenFromPassword(password);
}

export async function loginHtmlAdmin(passwordAttempt: string): Promise<boolean> {
  const password = process.env.ADMIN_HTML_PASSWORD?.trim();
  if (!password) return false;
  if (!safeEqual(passwordAttempt.trim(), password)) return false;

  const store = await cookies();
  store.set({
    name: COOKIE_NAME,
    value: sessionTokenFromPassword(password),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/admin/html",
    maxAge: 60 * 60 * 12,
  });

  return true;
}

export async function logoutHtmlAdmin(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

/**
 * Verify an admin-password attempt supplied as a raw string (e.g. from an
 * `X-Admin-Password` or `Authorization` header). Used by API route handlers
 * that need to authenticate non-browser callers (such as an AI agent) without
 * relying on the admin cookie. Returns false if no password is configured.
 */
export function verifyAdminPassword(passwordAttempt: string | null | undefined): boolean {
  const password = process.env.ADMIN_HTML_PASSWORD?.trim();
  if (!password) return false;
  if (!passwordAttempt) return false;
  return safeEqual(passwordAttempt.trim(), password);
}
