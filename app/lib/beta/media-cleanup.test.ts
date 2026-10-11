/**
 * Tests for the beta media sweep and the account-deletion clean-up.
 *
 * Fakes only: a fake store records what it is asked to clear, a fake remover
 * records (and can fail) deletes. No database, no Blob.
 */

import { describe, expect, it, vi } from "vitest";
import {
  isBlobGone,
  removeBlob,
  removeOwnedMedia,
  sweepExpiredMedia,
  type BlobRemover,
} from "./media-cleanup";

type Due = { id: number; clipBlobPath: string | null; shotBlobPath: string | null };

function fakeStore(due: Due[] = []) {
  const cleared: { id: number; clip: boolean; shot: boolean }[] = [];
  const deletedShots: string[][] = [];
  return {
    cleared,
    deletedShots,
    expiredMedia: vi.fn(async (_days: number, limit: number) => due.slice(0, limit)),
    markMediaExpired: vi.fn(async (id: number, c: { clip: boolean; shot: boolean }) => {
      cleared.push({ id, ...c });
    }),
    mediaOwnedBy: vi.fn(),
    deleteShots: vi.fn(async (ids: string[]) => {
      deletedShots.push(ids);
    }),
  };
}

function fakeRemover(failOn: string[] = [], goneOn: string[] = []) {
  const removed: string[] = [];
  const remove: BlobRemover = async (path) => {
    if (goneOn.includes(path)) {
      throw Object.assign(new Error("The requested blob does not exist"), {
        name: "BlobNotFoundError",
      });
    }
    if (failOn.includes(path)) throw new Error("blob outage");
    removed.push(path);
  };
  return { remove, removed };
}

const quiet = () => {};

describe("isBlobGone", () => {
  it("recognises the SDK's not-found error and nothing else", () => {
    expect(isBlobGone(Object.assign(new Error("x"), { name: "BlobNotFoundError" }))).toBe(true);
    expect(isBlobGone(new Error("404 not found"))).toBe(true);
    expect(isBlobGone(new Error("blob outage"))).toBe(false);
    expect(isBlobGone(null)).toBe(false);
  });
});

describe("removeBlob", () => {
  it("treats an already-gone object as deleted", async () => {
    const { remove } = fakeRemover([], ["a"]);
    await expect(removeBlob(remove, "a", quiet)).resolves.toBe(true);
  });

  it("reports a real failure as false, logs it, and never throws", async () => {
    const { remove } = fakeRemover(["a"]);
    const log = vi.fn();
    await expect(removeBlob(remove, "a", log)).resolves.toBe(false);
    expect(log).toHaveBeenCalledOnce();
  });
});

describe("sweepExpiredMedia", () => {
  it("passes the window and batch size to the query and clears both kinds", async () => {
    const store = fakeStore([{ id: 1, clipBlobPath: "c1", shotBlobPath: "s1" }]);
    const { remove, removed } = fakeRemover();
    const result = await sweepExpiredMedia({ store, remove, days: 30, limit: 100, log: quiet });
    expect(store.expiredMedia).toHaveBeenCalledWith(30, 100);
    expect(removed).toEqual(["c1", "s1"]);
    expect(store.cleared).toEqual([{ id: 1, clip: true, shot: true }]);
    expect(result).toMatchObject({ considered: 1, cleared: 1, blobsRemoved: 2, failed: 0, more: false });
  });

  it("handles a report with only a screenshot", async () => {
    const store = fakeStore([{ id: 2, clipBlobPath: null, shotBlobPath: "s2" }]);
    const { remove, removed } = fakeRemover();
    await sweepExpiredMedia({ store, remove, days: 30, limit: 10, log: quiet });
    expect(removed).toEqual(["s2"]);
    expect(store.cleared).toEqual([{ id: 2, clip: false, shot: true }]);
  });

  it("leaves the row alone when its blob delete fails, so the next run retries", async () => {
    const store = fakeStore([
      { id: 1, clipBlobPath: "bad", shotBlobPath: null },
      { id: 2, clipBlobPath: "ok", shotBlobPath: null },
    ]);
    const { remove, removed } = fakeRemover(["bad"]);
    const result = await sweepExpiredMedia({ store, remove, days: 30, limit: 10, log: quiet });
    // The failure on report 1 does not stop report 2.
    expect(removed).toEqual(["ok"]);
    expect(store.cleared).toEqual([{ id: 2, clip: true, shot: false }]);
    expect(result).toMatchObject({ cleared: 1, failed: 1 });
  });

  it("clears only the half that was deleted when the other half fails", async () => {
    const store = fakeStore([{ id: 3, clipBlobPath: "c3", shotBlobPath: "s3" }]);
    const { remove } = fakeRemover(["s3"]);
    const result = await sweepExpiredMedia({ store, remove, days: 30, limit: 10, log: quiet });
    expect(store.cleared).toEqual([{ id: 3, clip: true, shot: false }]);
    expect(result.failed).toBe(1);
  });

  it("does not wedge on an object that is already gone", async () => {
    const store = fakeStore([{ id: 4, clipBlobPath: "gone", shotBlobPath: null }]);
    const { remove } = fakeRemover([], ["gone"]);
    const result = await sweepExpiredMedia({ store, remove, days: 30, limit: 10, log: quiet });
    expect(store.cleared).toEqual([{ id: 4, clip: true, shot: false }]);
    expect(result.failed).toBe(0);
  });

  it("counts a failed row write as a failure and carries on", async () => {
    const store = fakeStore([
      { id: 1, clipBlobPath: "c1", shotBlobPath: null },
      { id: 2, clipBlobPath: "c2", shotBlobPath: null },
    ]);
    store.markMediaExpired.mockRejectedValueOnce(new Error("db down"));
    const { remove, removed } = fakeRemover();
    const result = await sweepExpiredMedia({ store, remove, days: 30, limit: 10, log: quiet });
    expect(removed).toEqual(["c1", "c2"]);
    expect(result).toMatchObject({ cleared: 1, failed: 1 });
  });

  it("is bounded by the batch size and says when more is waiting", async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      id: i + 1,
      clipBlobPath: `c${i + 1}`,
      shotBlobPath: null,
    }));
    const store = fakeStore(many);
    const { remove, removed } = fakeRemover();
    const result = await sweepExpiredMedia({ store, remove, days: 30, limit: 3, log: quiet });
    expect(removed).toEqual(["c1", "c2", "c3"]);
    expect(result).toMatchObject({ considered: 3, more: true });
  });

  it("does nothing when nothing is due", async () => {
    const store = fakeStore([]);
    const { remove, removed } = fakeRemover();
    const result = await sweepExpiredMedia({ store, remove, days: 30, limit: 3, log: quiet });
    expect(removed).toEqual([]);
    expect(result).toMatchObject({ considered: 0, more: false });
  });
});

describe("removeOwnedMedia", () => {
  const owned = {
    reports: [{ id: 5, clipBlobPath: "c5", shotBlobPath: "s5" }],
    shots: [
      { id: "shot-a", blobPath: "beta-shots/a.png" },
      { id: "shot-b", blobPath: "beta-shots/b.png" },
    ],
  };

  it("deletes report media and staged shots, then drops the shot rows", async () => {
    const store = fakeStore();
    const { remove, removed } = fakeRemover();
    const result = await removeOwnedMedia({ store, remove, owned, log: quiet });
    expect(removed).toEqual(["c5", "s5", "beta-shots/a.png", "beta-shots/b.png"]);
    expect(store.cleared).toEqual([{ id: 5, clip: true, shot: true }]);
    expect(store.deletedShots).toEqual([["shot-a", "shot-b"]]);
    expect(result).toEqual({ removed: 4, failed: 0 });
  });

  it("never throws on a blob failure, and keeps the rows it could not clear", async () => {
    const store = fakeStore();
    const { remove } = fakeRemover(["c5", "beta-shots/a.png"]);
    const result = await removeOwnedMedia({ store, remove, owned, log: quiet });
    // The screenshot half was cleared; the failed clip keeps its pointer for the sweep.
    expect(store.cleared).toEqual([{ id: 5, clip: false, shot: true }]);
    // Only the shot whose object is gone loses its row.
    expect(store.deletedShots).toEqual([["shot-b"]]);
    expect(result.failed).toBe(2);
  });

  it("survives the store failing too", async () => {
    const store = fakeStore();
    store.markMediaExpired.mockRejectedValue(new Error("db down"));
    store.deleteShots.mockRejectedValue(new Error("db down"));
    const { remove } = fakeRemover();
    await expect(removeOwnedMedia({ store, remove, owned, log: quiet })).resolves.toMatchObject({
      failed: 2,
    });
  });
});
