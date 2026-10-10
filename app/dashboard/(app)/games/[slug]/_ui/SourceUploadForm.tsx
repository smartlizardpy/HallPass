"use client";

import { upload } from "@vercel/blob/client";
import { startTransition, useState, type FormEvent } from "react";
import {
  DIRECT_UPLOAD_MAX_BYTES,
  MAX_UPLOAD_BYTES,
  UPLOAD_CONTENT_TYPE,
  newUploadPath,
  uploadLimitLabel,
  type SourceUploadKind,
} from "@/app/lib/game-upload";
import { uploadBundleAction, uploadHtmlAction } from "../../actions";

/**
 * One of the Source-code panel's two FILE forms — an `.html` or a `.zip`.
 *
 * A file up to 4 MB is posted to the action in the form data, as it always was.
 * A bigger one takes two steps, because Vercel caps a function's request body at
 * 4.5 MB (which is why zips over that size used to fail):
 *
 * 1. The file goes STRAIGHT TO BLOB from the browser, at a temporary path, with
 *    a token from `api/v1/admin/game-upload-token`. See `app/lib/game-upload.ts`.
 * 2. The action is then called with only that path. It reads the file back,
 *    deletes the temporary copy, and validates and publishes exactly as it does
 *    for a posted file.
 *
 * Small files skip step 1 because it is a billed Blob `put` that buys nothing
 * when the form could carry the file anyway. Either way the action
 * `redirect()`s to this page with the usual `?ok=` / `?error=` banner — a
 * redirect from an action called in a transition navigates the same way a form
 * post does.
 *
 * Client-only because step 1 is a browser PUT, so this form needs JavaScript
 * where the panel's other forms do not. The size is checked here first purely
 * so an over-limit file is refused instantly rather than after uploading; the
 * token and the action each enforce the cap again.
 *
 * A failed upload is answered here, not with a banner, because no action ran.
 * The token route deliberately says nothing about WHY it refused (and
 * `upload()` discards its body anyway), so the message names the one refusal an
 * admin can fix themselves — the kill switch — next to the usual retry.
 */
export function SourceUploadForm({
  slug,
  kind,
}: {
  slug: string;
  kind: SourceUploadKind;
}) {
  const [stage, setStage] = useState<"idle" | "uploading" | "publishing">("idle");
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const busy = stage !== "idle";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem("file");
    const file = input instanceof HTMLInputElement ? input.files?.[0] : undefined;
    if (!file) {
      setError(kind === "html" ? "Pick an HTML file to upload." : "Pick a .zip bundle to upload.");
      return;
    }
    if (file.size === 0) {
      setError("Uploaded file is empty.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES[kind]) {
      setError(`File too large (max ${uploadLimitLabel(kind)}).`);
      return;
    }

    setError(null);
    const formData = new FormData();
    formData.set("slug", slug);
    const action = kind === "html" ? uploadHtmlAction : uploadBundleAction;
    // The action always ends in a redirect to this page's banner, which is what
    // clears the "Publishing…" state; nothing after it runs.
    const publish = () => {
      setStage("publishing");
      startTransition(async () => {
        await action(formData);
      });
    };

    if (file.size <= DIRECT_UPLOAD_MAX_BYTES) {
      formData.set("file", file);
      publish();
      return;
    }

    setPercent(0);
    setStage("uploading");
    let uploadPath: string;
    try {
      const blob = await upload(newUploadPath(slug, kind), file, {
        access: "public",
        handleUploadUrl: "/api/v1/admin/game-upload-token",
        contentType: UPLOAD_CONTENT_TYPE[kind],
        onUploadProgress: ({ percentage }) => setPercent(Math.round(percentage)),
      });
      uploadPath = blob.pathname;
    } catch (err) {
      console.error("game source upload failed:", err);
      setStage("idle");
      setError(
        "The upload didn't go through. Check your connection and try again — " +
          "or, if game source publishing is switched off in Blob ops, turn it back on first.",
      );
      return;
    }

    formData.set("uploadPath", uploadPath);
    publish();
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-sm font-semibold text-foreground">
        {kind === "html" ? (
          <>
            Upload an <code className="font-mono">.html</code> file
          </>
        ) : (
          <>
            …or upload a multi-file bundle (<code className="font-mono">.zip</code> with{" "}
            <code className="font-mono">index.html</code> at its root)
          </>
        )}{" "}
        <span className="font-normal text-muted">— up to {uploadLimitLabel(kind)}</span>
        <input
          name="file"
          type="file"
          required
          disabled={busy}
          accept={kind === "html" ? ".html,text/html" : ".zip,application/zip"}
          className="mt-2 block w-full text-sm"
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white hover:bg-brand-600 disabled:opacity-60"
        >
          {stage === "uploading"
            ? `Uploading… ${percent}%`
            : stage === "publishing"
              ? "Publishing…"
              : kind === "html"
                ? "Upload HTML"
                : "Upload bundle (.zip)"}
        </button>
        {stage === "uploading" && (
          <div
            className="h-1.5 w-40 overflow-hidden rounded-full bg-surface-2"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <div className="h-full bg-brand" style={{ width: `${percent}%` }} />
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </form>
  );
}
