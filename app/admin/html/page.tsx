import { del, put } from "@vercel/blob";
import { redirect } from "next/navigation";
import {
  isAdminPasswordConfigured,
  isHtmlAdminAuthenticated,
  loginHtmlAdmin,
  logoutHtmlAdmin,
} from "@/app/lib/admin-html-auth";
import { blobPathForSlug } from "@/app/lib/game-html-blob";
import { GAMES_VERSION_BLOB_PATH } from "@/app/lib/games-version-blob";
import { games } from "@/app/lib/games";

async function bumpGamesVersion() {
  try {
    await put(GAMES_VERSION_BLOB_PATH, String(Date.now()), {
      access: "public",
      contentType: "text/plain; charset=utf-8",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 0,
    });
  } catch {
    // best-effort; offline-refresh polling will lag until next successful bump
  }
}

type Params = Promise<{ ok?: string | string[]; error?: string | string[] }>;

function asString(value: string | string[] | undefined): string | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] : value;
}

function assertKnownSlug(slug: string): void {
  if (!games.some((g) => g.slug === slug)) {
    throw new Error("Invalid game slug");
  }
}

async function writeHtml(slug: string, html: string) {
  assertKnownSlug(slug);
  await put(blobPathForSlug(slug), html, {
    access: "public",
    contentType: "text/html; charset=utf-8",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  });
  await bumpGamesVersion();
}

async function uploadHtml(formData: FormData) {
  "use server";

  if (!(await isHtmlAdminAuthenticated())) {
    redirect("/admin/html?error=unauthorized");
  }

  const slug = String(formData.get("slug") ?? "").trim();
  const file = formData.get("htmlFile");

  if (!slug) redirect("/admin/html?error=missing-slug");
  if (!(file instanceof File)) redirect("/admin/html?error=missing-file");

  const html = await file.text();
  if (!html.trim()) redirect("/admin/html?error=empty-html");
  if (html.length > 2_000_000) redirect("/admin/html?error=file-too-large");

  await writeHtml(slug, html);

  redirect(`/admin/html?ok=${encodeURIComponent(`Uploaded HTML for ${slug}`)}`);
}

async function pasteHtml(formData: FormData) {
  "use server";

  if (!(await isHtmlAdminAuthenticated())) {
    redirect("/admin/html?error=unauthorized");
  }

  const slug = String(formData.get("slug") ?? "").trim();
  const html = String(formData.get("html") ?? "");

  if (!slug) redirect("/admin/html?error=missing-slug");
  if (!html.trim()) redirect("/admin/html?error=empty-html");
  if (html.length > 2_000_000) redirect("/admin/html?error=file-too-large");

  await writeHtml(slug, html);

  redirect(`/admin/html?ok=${encodeURIComponent(`Pasted HTML for ${slug}`)}`);
}

async function clearHtml(formData: FormData) {
  "use server";

  if (!(await isHtmlAdminAuthenticated())) {
    redirect("/admin/html?error=unauthorized");
  }

  const slug = String(formData.get("slug") ?? "").trim();
  if (!slug) redirect("/admin/html?error=missing-slug");

  assertKnownSlug(slug);
  try {
    await del(blobPathForSlug(slug));
  } catch {
    // already gone — treat as success
  }
  await bumpGamesVersion();

  redirect(`/admin/html?ok=${encodeURIComponent(`Cleared HTML for ${slug}`)}`);
}

async function login(formData: FormData) {
  "use server";

  const password = String(formData.get("password") ?? "");
  const ok = await loginHtmlAdmin(password);
  if (!ok) redirect("/admin/html?error=bad-password");
  redirect("/admin/html?ok=logged-in");
}

async function logout() {
  "use server";

  await logoutHtmlAdmin();
  redirect("/admin/html?ok=logged-out");
}

const ERROR_TEXT: Record<string, string> = {
  unauthorized: "Unauthorized. Please sign in again.",
  "missing-slug": "Choose a game first.",
  "missing-file": "Pick an HTML file to upload.",
  "empty-html": "Uploaded file is empty.",
  "file-too-large": "File too large (max 2MB).",
  "bad-password": "Wrong password.",
};

export default async function HtmlAdminPage({
  searchParams,
}: {
  searchParams: Params;
}) {
  const params = await searchParams;
  const ok = asString(params.ok);
  const errorKey = asString(params.error);
  const error = errorKey ? ERROR_TEXT[errorKey] ?? "Action failed." : null;

  const configured = isAdminPasswordConfigured();
  const authenticated = configured ? await isHtmlAdminAuthenticated() : false;

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <h1 className="text-3xl font-black tracking-tight">HTML Admin</h1>
      <p className="mt-2 text-sm text-muted">
        Password-protected HTML tools for game files.
      </p>

      {!configured && (
        <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Set <code className="font-mono">ADMIN_HTML_PASSWORD</code> in your
          environment to enable this page.
        </div>
      )}

      {ok && (
        <div className="mt-6 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {ok}
        </div>
      )}

      {error && (
        <div className="mt-6 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          {error}
        </div>
      )}

      {configured && !authenticated && (
        <form action={login} className="mt-6 rounded-xl border border-border bg-white p-5">
          <label className="block text-sm font-semibold text-zinc-900">
            Password
            <input
              name="password"
              type="password"
              required
              className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/30"
            />
          </label>
          <button
            type="submit"
            className="mt-4 rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white hover:bg-brand-600"
          >
            Sign in
          </button>
        </form>
      )}

      {configured && authenticated && (
        <>
          <form
            action={uploadHtml}
            className="mt-6 rounded-xl border border-border bg-white p-5"
          >
            <h2 className="text-lg font-black">Upload HTML</h2>

            <label className="mt-4 block text-sm font-semibold text-zinc-900">
              Game
              <select
                name="slug"
                required
                className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/30"
                defaultValue=""
              >
                <option value="" disabled>
                  Select a game
                </option>
                {games.map((g) => (
                  <option key={g.slug} value={g.slug}>
                    {g.title} ({g.slug})
                  </option>
                ))}
              </select>
            </label>

            <label className="mt-4 block text-sm font-semibold text-zinc-900">
              HTML file
              <input
                name="htmlFile"
                type="file"
                required
                accept=".html,text/html"
                className="mt-2 block w-full text-sm"
              />
            </label>

            <button
              type="submit"
              className="mt-4 rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white hover:bg-brand-600"
            >
              Upload HTML
            </button>
          </form>

          <form
            action={pasteHtml}
            className="mt-6 rounded-xl border border-border bg-white p-5"
          >
            <h2 className="text-lg font-black">Paste HTML</h2>

            <label className="mt-4 block text-sm font-semibold text-zinc-900">
              Game
              <select
                name="slug"
                required
                className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/30"
                defaultValue=""
              >
                <option value="" disabled>
                  Select a game
                </option>
                {games.map((g) => (
                  <option key={g.slug} value={g.slug}>
                    {g.title} ({g.slug})
                  </option>
                ))}
              </select>
            </label>

            <label className="mt-4 block text-sm font-semibold text-zinc-900">
              HTML
              <textarea
                name="html"
                required
                rows={12}
                spellCheck={false}
                placeholder="<!doctype html>…"
                className="mt-2 block w-full rounded-lg border border-border px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-brand/30"
              />
            </label>

            <button
              type="submit"
              className="mt-4 rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white hover:bg-brand-600"
            >
              Save HTML
            </button>
          </form>

          <form action={clearHtml} className="mt-6 rounded-xl border border-border bg-white p-5">
            <h2 className="text-lg font-black">Clear HTML</h2>

            <label className="mt-4 block text-sm font-semibold text-zinc-900">
              Game
              <select
                name="slug"
                required
                className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/30"
                defaultValue=""
              >
                <option value="" disabled>
                  Select a game
                </option>
                {games.map((g) => (
                  <option key={g.slug} value={g.slug}>
                    {g.title} ({g.slug})
                  </option>
                ))}
              </select>
            </label>

            <button
              type="submit"
              className="mt-4 rounded-full bg-red-600 px-5 py-2 text-sm font-extrabold text-white hover:bg-red-700"
            >
              Clear HTML
            </button>
          </form>

          <form action={logout} className="mt-4">
            <button
              type="submit"
              className="rounded-full border border-border bg-white px-5 py-2 text-sm font-bold text-zinc-700 hover:bg-surface-2"
            >
              Sign out
            </button>
          </form>
        </>
      )}
    </main>
  );
}
