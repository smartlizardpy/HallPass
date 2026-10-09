/**
 * Tests for the two FILE upload actions now that the file arrives by temporary
 * path rather than in the form (see `app/lib/game-upload.ts`).
 *
 * Every collaborator appends to one shared `log`, so the assertions read as the
 * sequence the action performed. The load-bearing claims:
 *   - only this game's upload, from this form, is read — anything else is
 *     refused before the store is touched;
 *   - the temporary file is deleted on EVERY outcome once it has been read,
 *     and before anything is published;
 *   - the bytes it held are what gets published, through the same validation as
 *     before, and the kill switch is still honoured.
 */

import { zipSync, strToU8 } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";

const MB = 1024 * 1024;

const h = vi.hoisted(() => ({
  log: [] as string[],
  /** What `get()` finds at a pathname; `undefined` means not found. */
  stored: new Map<string, Uint8Array>(),
  /** Overrides the size `get()` reports, to exercise the cap without 10 MB of bytes. */
  reportedSize: null as number | null,
  getThrows: false,
  blobOpOn: true,
  putFails: false,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  updateTag: (t: string) => h.log.push(`tag:${t}`),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    h.log.push(`redirect:${decodeURIComponent(url)}`);
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));
vi.mock("@/app/lib/auth", () => ({
  requireRole: async (role: string) => {
    h.log.push(`role:${role}`);
    return { email: "a@x", role: "admin", playerId: "p" };
  },
}));
vi.mock("@/app/lib/blob-ops", () => ({
  isBlobOpEnabled: async () => h.blobOpOn,
  blobOpDisabledMessage: () => "publishing is off",
}));
vi.mock("@/app/lib/game-credits", () => ({
  CREDITS_CACHE_TAG: "credits",
  recordFirstUpload: async () => h.log.push("credit"),
}));
vi.mock("@/app/lib/game-serving-blobs", () => ({ GAMES_BLOB_CACHE_TAG: "serving" }));
vi.mock("@/app/lib/games-version", () => ({
  GAMES_VERSION_CACHE_TAG: "version",
  writeGamesVersion: async () => h.log.push("bump"),
}));
vi.mock("@/app/lib/game-blob-index", () => ({
  recordGameBlobs: async (rows: { pathname: string }[]) =>
    h.log.push(`record:${rows.map((r) => r.pathname).join(",")}`),
  listGameFilesLive: async () => [],
  forgetGameBlobs: async () => {},
  forgetGameBlobsForSlug: async () => {},
}));
vi.mock("@/app/lib/games", () => ({ games: [{ slug: "g" }, { slug: "other" }] }));
vi.mock("@vercel/blob", () => ({
  get: async (pathname: string, options: { access: string }) => {
    h.log.push(`get:${pathname}:${options.access}`);
    if (h.getThrows) throw new Error("store down");
    const bytes = h.stored.get(pathname);
    if (!bytes) return null;
    return {
      statusCode: 200,
      stream: new Response(bytes.slice()).body,
      blob: { size: h.reportedSize ?? bytes.length },
    };
  },
  del: async (pathname: string | string[]) => h.log.push(`del:${[pathname].flat().join(",")}`),
  put: async (pathname: string, body: string | Buffer) => {
    if (h.putFails) throw new Error("put failed");
    h.log.push(`put:${pathname}:${typeof body === "string" ? body : body.toString()}`);
    return { url: `https://store/${pathname}` };
  },
}));

import { uploadBundleAction, uploadHtmlAction } from "./actions";

const HTML_PATH = "game-uploads/g/lq3x9a-abcdefgh.html";
const ZIP_PATH = "game-uploads/g/lq3x9a-abcdefgh.zip";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

/** Run an action to its redirect and return the log. */
async function run(action: (fd: FormData) => Promise<void>, fields: Record<string, string>) {
  await expect(action(form(fields))).rejects.toThrow("NEXT_REDIRECT");
  return h.log;
}

const banner = () => h.log.find((l) => l.startsWith("redirect:")) ?? "";

beforeEach(() => {
  h.log = [];
  h.stored = new Map();
  h.reportedSize = null;
  h.getThrows = false;
  h.blobOpOn = true;
  h.putFails = false;
});

describe("uploadHtmlAction", () => {
  it("publishes the uploaded bytes and deletes the temporary file first", async () => {
    h.stored.set(HTML_PATH, strToU8("<!doctype html><p>hi</p>"));
    const log = await run(uploadHtmlAction, { slug: "g", uploadPath: HTML_PATH });

    expect(log.slice(0, 4)).toEqual([
      "role:admin",
      `get:${HTML_PATH}:public`,
      `del:${HTML_PATH}`,
      "put:games/g/index.html:<!doctype html><p>hi</p>",
    ]);
    expect(log).toContain("record:games/g/index.html");
    expect(log).toContain("credit");
    expect(banner()).toBe("redirect:/dashboard/games/g?ok=Uploaded HTML");
  });

  it("accepts a file over the old 2 MB limit", async () => {
    h.stored.set(HTML_PATH, strToU8(`<!doctype html>${"x".repeat(3 * MB)}`));
    await run(uploadHtmlAction, { slug: "g", uploadPath: HTML_PATH });
    expect(banner()).toBe("redirect:/dashboard/games/g?ok=Uploaded HTML");
  });

  it("refuses a file over 10 MB, still deleting it", async () => {
    h.stored.set(HTML_PATH, strToU8("<p>hi</p>"));
    h.reportedSize = 10 * MB + 1;
    const log = await run(uploadHtmlAction, { slug: "g", uploadPath: HTML_PATH });
    expect(log).toContain(`del:${HTML_PATH}`);
    expect(log.some((l) => l.startsWith("put:"))).toBe(false);
    expect(banner()).toBe("redirect:/dashboard/games/g?error=File too large (max 10 MB).");
  });

  it.each([
    ["no path", ""],
    ["another game's upload", "game-uploads/other/lq3x9a-abcdefgh.html"],
    ["the zip form's upload", ZIP_PATH],
    ["a live game file", "games/g/index.html"],
  ])("refuses %s without touching the store", async (_label, uploadPath) => {
    const log = await run(uploadHtmlAction, { slug: "g", uploadPath });
    expect(log.some((l) => /^(get|del|put):/.test(l))).toBe(false);
    expect(banner()).toBe("redirect:/dashboard/games/g?error=Pick an HTML file to upload.");
  });

  it("explains a missing upload, still trying to delete it", async () => {
    const log = await run(uploadHtmlAction, { slug: "g", uploadPath: HTML_PATH });
    expect(log).toContain(`del:${HTML_PATH}`);
    expect(banner()).toBe("redirect:/dashboard/games/g?error=The upload didn't arrive. Try again.");
  });

  it("explains a store failure, still trying to delete it", async () => {
    h.getThrows = true;
    const log = await run(uploadHtmlAction, { slug: "g", uploadPath: HTML_PATH });
    expect(log).toContain(`del:${HTML_PATH}`);
    expect(banner()).toBe(
      "redirect:/dashboard/games/g?error=Couldn't read the upload back. Try again.",
    );
  });

  it("refuses an empty file", async () => {
    h.stored.set(HTML_PATH, strToU8("   \n"));
    await run(uploadHtmlAction, { slug: "g", uploadPath: HTML_PATH });
    expect(banner()).toBe("redirect:/dashboard/games/g?error=Uploaded file is empty.");
  });

  it("honours the kill switch after the temporary file is gone", async () => {
    h.stored.set(HTML_PATH, strToU8("<p>hi</p>"));
    h.blobOpOn = false;
    const log = await run(uploadHtmlAction, { slug: "g", uploadPath: HTML_PATH });
    expect(log).toContain(`del:${HTML_PATH}`);
    expect(log.some((l) => l.startsWith("put:"))).toBe(false);
    expect(banner()).toBe("redirect:/dashboard/games/g?error=publishing is off");
  });

  it("reports a failed publish", async () => {
    h.stored.set(HTML_PATH, strToU8("<p>hi</p>"));
    h.putFails = true;
    await run(uploadHtmlAction, { slug: "g", uploadPath: HTML_PATH });
    expect(banner()).toBe("redirect:/dashboard/games/g?error=Blob write failed. Try again.");
  });
});

describe("uploadBundleAction", () => {
  it("publishes every file in the uploaded zip", async () => {
    h.stored.set(
      ZIP_PATH,
      zipSync({ "index.html": strToU8("<p>game</p>"), "js/main.js": strToU8("go()") }),
    );
    const log = await run(uploadBundleAction, { slug: "g", uploadPath: ZIP_PATH });

    expect(log.indexOf(`del:${ZIP_PATH}`)).toBeLessThan(
      log.findIndex((l) => l.startsWith("put:")),
    );
    expect(log).toContain("put:games/g/index.html:<p>game</p>");
    expect(log).toContain("put:games/g/js/main.js:go()");
    expect(log).toContain("record:games/g/index.html,games/g/js/main.js");
    expect(banner()).toBe("redirect:/dashboard/games/g?ok=Uploaded bundle (2 files)");
  });

  it("strips a single zipped-folder prefix as before", async () => {
    h.stored.set(ZIP_PATH, zipSync({ "mygame/index.html": strToU8("<p>game</p>") }));
    const log = await run(uploadBundleAction, { slug: "g", uploadPath: ZIP_PATH });
    expect(log).toContain("put:games/g/index.html:<p>game</p>");
  });

  it("refuses a zip over 50 MB, still deleting it", async () => {
    h.stored.set(ZIP_PATH, zipSync({ "index.html": strToU8("<p>game</p>") }));
    h.reportedSize = 50 * MB + 1;
    const log = await run(uploadBundleAction, { slug: "g", uploadPath: ZIP_PATH });
    expect(log).toContain(`del:${ZIP_PATH}`);
    expect(banner()).toBe("redirect:/dashboard/games/g?error=File too large (max 50 MB).");
  });

  it("still vets the archive, after deleting it", async () => {
    h.stored.set(ZIP_PATH, zipSync({ "main.js": strToU8("go()") }));
    const log = await run(uploadBundleAction, { slug: "g", uploadPath: ZIP_PATH });
    expect(log).toContain(`del:${ZIP_PATH}`);
    expect(log.some((l) => l.startsWith("put:"))).toBe(false);
    expect(banner()).toBe(
      "redirect:/dashboard/games/g?error=Bundle must contain an index.html at its root.",
    );
  });

  it("refuses something that is not a zip", async () => {
    h.stored.set(ZIP_PATH, strToU8("not a zip"));
    await run(uploadBundleAction, { slug: "g", uploadPath: ZIP_PATH });
    expect(banner()).toBe("redirect:/dashboard/games/g?error=Not a valid .zip archive.");
  });

  it("refuses the HTML form's upload without touching the store", async () => {
    const log = await run(uploadBundleAction, { slug: "g", uploadPath: HTML_PATH });
    expect(log.some((l) => /^(get|del|put):/.test(l))).toBe(false);
    expect(banner()).toBe("redirect:/dashboard/games/g?error=Pick a .zip bundle to upload.");
  });
});
