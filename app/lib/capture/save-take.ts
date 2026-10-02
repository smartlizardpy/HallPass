/**
 * HallPass — handing a finished recording to the tester as a file.
 *
 * v1 never uploads anything: the video and its events sidecar are downloaded to
 * the device and that is the end of their journey through this app. The download
 * is a plain anchor click on an object URL, which is the one mechanism that works
 * on every browser we support, including iOS Safari — where it must happen inside
 * a user gesture, which is why the UI saves on a button press rather than
 * automatically when recording stops.
 */

import type { Sidecar } from "./record-events";

export function sidecarBlob(sidecar: Sidecar): Blob {
  return new Blob([`${JSON.stringify(sidecar, null, 2)}\n`], {
    type: "application/json",
  });
}

/** Download a blob under `filename`. The object URL is revoked once the click is out. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Not synchronously: some engines start reading the URL after the click task.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
