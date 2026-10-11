/**
 * Unit tests for `getPlayerByUsername`.
 *
 * The lookup exists to serve the super-admin invite box, so what is pinned here
 * is the part that would be dangerous to get wrong: the username reaches the
 * driver as a BOUND PARAMETER and never as spliced SQL, and a name nobody holds
 * comes back as `null` rather than as some other player's row. The mapped shape
 * carries `email`, which is the whole reason the invite action can use it — and
 * the reason it must stay server-side.
 *
 * The driver is mocked; the real SQL is exercised against a live Neon branch,
 * not from here (see the note in `favorites.test.ts` for the same split).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/app/lib/db", () => ({
  sql: (...args: unknown[]) => query(...args),
  isDbConfigured: () => true,
  isUnconfiguredDbError: () => false,
  isMissingColumnError: (e: unknown) => (e as { code?: string })?.code === "42P01",
}));
const del = vi.fn();
vi.mock("@vercel/blob", () => ({ del: (...args: unknown[]) => del(...args) }));

import { memeAvatarFor } from "./avatars";
import {
  backfillCountryIfMissing,
  deletePlayer,
  getPlayerByUsername,
  getPublicIdentity,
  ownAvatarUrl,
  setAvatarChoice,
  setUseGooglePhoto,
  upsertPlayerOnLogin,
} from "./players";

const ROW = {
  id: "sub-alice",
  email: "alice@example.com",
  name: "Alice A",
  image: null,
  handle: "AliceHandle",
  created_at: "2024-01-01T00:00:00.000Z",
  last_login: "2024-06-01T00:00:00.000Z",
};

beforeEach(() => {
  query.mockReset();
  del.mockReset();
});

describe("getPlayerByUsername", () => {
  it("maps the row, email included", async () => {
    query.mockResolvedValue([ROW]);

    const player = await getPlayerByUsername("alice");

    expect(player?.id).toBe("sub-alice");
    // The invite action needs this; it is also why the function is server-only.
    expect(player?.email).toBe("alice@example.com");
    expect(player?.handle).toBe("AliceHandle");
  });

  it("returns null when nobody holds the name", async () => {
    query.mockResolvedValue([]);
    await expect(getPlayerByUsername("nobody_here")).resolves.toBeNull();
  });

  it("binds the username instead of splicing it", async () => {
    query.mockResolvedValue([]);

    await getPlayerByUsername("alice' OR '1'='1");

    // The tagged template hands the driver its static strings plus the value as
    // a separate argument. The value must never appear inside the SQL text.
    const [strings, ...values] = query.mock.calls[0] as [string[], ...unknown[]];
    expect(values).toEqual(["alice' OR '1'='1"]);
    expect(strings.join("?")).toContain("WHERE username =");
    expect(strings.join("?")).not.toContain("OR '1'='1");
  });
});

describe("upsertPlayerOnLogin", () => {
  it("binds the detected country as a VALUE on insert", async () => {
    query.mockResolvedValue([]);

    await upsertPlayerOnLogin({
      id: "sub-alice",
      email: "Alice@Example.com",
      country: "gb",
    });

    const [strings, ...values] = query.mock.calls[0] as [string[], ...unknown[]];
    expect(strings.join("?")).toContain("INSERT INTO players");
    expect(values).toContain("gb");
  });

  it("only backfills country when the existing row has none", async () => {
    // The load-bearing privacy behaviour: a login must record where the
    // account was FIRST detected, not where it is signing in from now. Unlike
    // `handle` (absent from the SET list entirely — a NULL handle is a
    // deliberate choice), `country` DOES appear here, guarded by COALESCE, so
    // a pre-existing row with no country yet (every player who signed up
    // before this column existed) gets one on its next login — but a row that
    // already has a country is never touched again, real driver semantics
    // this mock can't itself exercise (see the module docblock on that split).
    query.mockResolvedValue([]);

    await upsertPlayerOnLogin({
      id: "sub-alice",
      email: "alice@example.com",
      country: "US",
    });

    const [strings] = query.mock.calls[0] as [string[], ...unknown[]];
    const sql = strings.join("?");
    const conflictClause = sql.slice(sql.indexOf("ON CONFLICT"));
    expect(conflictClause).toContain("COALESCE(players.country, EXCLUDED.country)");
    expect(conflictClause).not.toContain("handle");
  });

  it("defaults to null when no country was detected", async () => {
    query.mockResolvedValue([]);

    await upsertPlayerOnLogin({ id: "sub-bob", email: "bob@example.com" });

    // VALUES order is (id, email, name, image, country) — country is last.
    const [, ...values] = query.mock.calls[0] as [string[], ...unknown[]];
    expect(values[4]).toBeNull();
  });
});

describe("backfillCountryIfMissing", () => {
  it("does nothing when no country was detected — never queries the driver", async () => {
    await backfillCountryIfMissing("sub-alice", null);
    expect(query).not.toHaveBeenCalled();
  });

  it("writes the country, guarded by WHERE country IS NULL", async () => {
    query.mockResolvedValue([]);

    await backfillCountryIfMissing("sub-alice", "gb");

    const [strings, ...values] = query.mock.calls[0] as [string[], ...unknown[]];
    const sql = strings.join("?");
    expect(sql).toContain("UPDATE players SET country =");
    expect(sql).toContain("WHERE id =");
    expect(sql).toContain("AND country IS NULL");
    expect(values).toEqual(["gb", "sub-alice"]);
  });
});

describe("avatars on a player's own identity", () => {
  const PUBLIC_ID = "11111111-2222-3333-4444-555555555555";

  it("the SDK identity carries the meme avatar, never the Google photo", async () => {
    query.mockResolvedValue([
      { ...ROW, image: "https://lh3.example/me.png", public_id: PUBLIC_ID, use_google_photo: true },
    ]);
    const ident = await getPublicIdentity("sub-alice");
    expect(ident?.image).toBe(memeAvatarFor(PUBLIC_ID));
  });

  it("ownAvatarUrl uses the photo only when opted in", () => {
    const base = {
      image: "https://lh3.example/me.png",
      publicId: PUBLIC_ID,
      avatarMeme: null,
      avatarColour: null,
    };
    expect(ownAvatarUrl({ ...base, useGooglePhoto: true })).toBe(base.image);
    expect(ownAvatarUrl({ ...base, useGooglePhoto: false })).toBe(memeAvatarFor(PUBLIC_ID));
    expect(ownAvatarUrl({ ...base, image: null, useGooglePhoto: true })).toBe(
      memeAvatarFor(PUBLIC_ID),
    );
  });

  it("a stored choice shapes the own avatar and the SDK identity", async () => {
    const choice = { meme: "doge", colour: "#ffd982" };
    const base = { image: null, publicId: PUBLIC_ID, useGooglePhoto: false };
    expect(ownAvatarUrl({ ...base, avatarMeme: "doge", avatarColour: "#ffd982" })).toBe(
      memeAvatarFor(PUBLIC_ID, choice),
    );
    // A stale (removed) meme falls back to the default rather than breaking.
    expect(ownAvatarUrl({ ...base, avatarMeme: "meme-02", avatarColour: null })).toBe(
      memeAvatarFor(PUBLIC_ID),
    );
    query.mockResolvedValue([
      { ...ROW, public_id: PUBLIC_ID, avatar_meme: "doge", avatar_colour: "#ffd982" },
    ]);
    const ident = await getPublicIdentity("sub-alice");
    expect(ident?.image).toBe("/avatars/doge.png?bg=ffd982");
  });

  it("setAvatarChoice binds meme, colour and id", async () => {
    query.mockResolvedValue([]);
    await setAvatarChoice("sub-alice", { meme: "doge", colour: "#ffd982" });
    const [, ...values] = query.mock.calls[0] as [string[], ...unknown[]];
    expect(values).toEqual(["doge", "#ffd982", "sub-alice"]);
  });

  it("setUseGooglePhoto binds the flag and the id", async () => {
    query.mockResolvedValue([]);
    await setUseGooglePhoto("sub-alice", true);
    const [, ...values] = query.mock.calls[0] as [string[], ...unknown[]];
    expect(values).toEqual([true, "sub-alice"]);
  });
});

describe("deletePlayer: beta clips and screenshots", () => {
  /** Routes the fake driver by statement text and records the order of effects. */
  function wire(opts: { deleted?: boolean; failMediaRead?: boolean } = {}) {
    const log: string[] = [];
    query.mockImplementation(async (strings: TemplateStringsArray) => {
      const text = strings.join("?");
      if (text.includes("DELETE FROM beta_shots")) {
        log.push("delete-shot-rows");
        return [];
      }
      if (text.includes("FROM beta_reports")) {
        log.push("read-reports");
        if (opts.failMediaRead) throw new Error("neon down");
        return [{ id: 8, clip_blob_path: "beta-clips/g/8.webm", shot_blob_path: "beta-evidence/8.png" }];
      }
      if (text.includes("FROM beta_shots")) {
        log.push("read-shots");
        return [{ id: "shot-1", blob_path: "beta-shots/1.png" }];
      }
      if (text.includes("UPDATE scores")) log.push("anonymise");
      if (text.includes("DELETE FROM players")) {
        log.push("delete-player");
        return opts.deleted === false ? [] : [{ id: "p1" }];
      }
      if (text.includes("UPDATE beta_reports")) log.push("clear-pointers");
      return [];
    });
    del.mockImplementation(async (path: string) => {
      log.push(`blob:${path}`);
    });
    return log;
  }

  it("reads the media first and deletes the files only after the player row is gone", async () => {
    const log = wire();
    await expect(deletePlayer("p1")).resolves.toBe(true);
    const at = (entry: string) => log.indexOf(entry);
    expect(at("read-reports")).toBeLessThan(at("anonymise"));
    expect(at("read-reports")).toBeLessThan(at("delete-player"));
    for (const path of ["beta-clips/g/8.webm", "beta-evidence/8.png", "beta-shots/1.png"]) {
      expect(at(`blob:${path}`)).toBeGreaterThan(at("delete-player"));
    }
    // Pointers cleared and staged rows dropped only after their objects went.
    expect(at("clear-pointers")).toBeGreaterThan(at("blob:beta-evidence/8.png"));
    expect(at("delete-shot-rows")).toBeGreaterThan(at("blob:beta-shots/1.png"));
  });

  it("does not touch any blob when no player row was deleted", async () => {
    wire({ deleted: false });
    await expect(deletePlayer("ghost")).resolves.toBe(false);
    expect(del).not.toHaveBeenCalled();
  });

  it("still deletes the account when the files cannot be listed", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = wire({ failMediaRead: true });
    await expect(deletePlayer("p1")).resolves.toBe(true);
    expect(log).toContain("delete-player");
    expect(del).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it("still reports success when a blob delete fails", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    wire();
    del.mockRejectedValue(new Error("blob outage"));
    await expect(deletePlayer("p1")).resolves.toBe(true);
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it("stays quiet when the beta tables do not exist", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    query.mockImplementation(async (strings: TemplateStringsArray) => {
      const text = strings.join("?");
      if (text.includes("beta_")) throw Object.assign(new Error("relation does not exist"), { code: "42P01" });
      return text.includes("DELETE FROM players") ? [{ id: "p1" }] : [];
    });
    await expect(deletePlayer("p1")).resolves.toBe(true);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
