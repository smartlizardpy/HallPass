// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSidecar, EventLog } from "./record-events";
import { saveBlob, sidecarBlob } from "./save-take";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("saveBlob", () => {
  it("clicks a download link with the filename, then revokes the URL", () => {
    vi.useFakeTimers();
    const create = vi.fn(() => "blob:x");
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.download).toBe("snag.webm");
        expect(this.href).toBe("blob:x");
      });

    saveBlob(new Blob(["v"]), "snag.webm");

    expect(click).toHaveBeenCalledTimes(1);
    expect(document.querySelector("a[download]")).toBeNull();
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(revoke).toHaveBeenCalledWith("blob:x");
  });
});

describe("sidecarBlob", () => {
  it("is JSON that round-trips", async () => {
    const sidecar = buildSidecar(
      {
        slug: "snag",
        title: "Snag",
        file: "snag.webm",
        mimeType: "video/webm",
        startedAtEpochMs: 0,
        durationMs: 10,
        width: 1,
        height: 1,
        audio: "none",
        endedBy: "user",
        canvasCount: 1,
        userAgent: "ua",
      },
      new EventLog(0),
    );
    const blob = sidecarBlob(sidecar);
    expect(blob.type).toBe("application/json");
    expect(JSON.parse(await blob.text())).toEqual(sidecar);
  });
});
