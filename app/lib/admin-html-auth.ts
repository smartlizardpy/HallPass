import { cookies } from "next/headers";
import { sha256Hex, timingSafeSecretEqual } from "@/app/lib/admin-secret";

const COOKIE_NAME = "hp_admin_html";

/**
 * The cookie value: a digest of the password under a namespace of this
 * surface's own, so the cookie is not the password and cannot be replayed
 * against anything else that hashes it.
 */
function sessionTokenFromPassword(password: string): string {
  return sha256Hex(`${password}::hallpass-html-admin`);
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
  if (!timingSafeSecretEqual(passwordAttempt.trim(), password)) return false;

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
