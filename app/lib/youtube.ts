/**
 * HallPass — YouTube URL parsing and embed-URL construction.
 *
 * Deliberately has NO `import "server-only"` and touches no database: the
 * dashboard action validates a pasted URL with {@link parseYouTubeId} on the
 * server, and `GameTrailer` builds an iframe `src` with {@link youtubeEmbedUrl} in
 * the browser. Same split as `game-media-blob.ts`.
 *
 * THE HOST ALLOW-LIST IS THE SECURITY BOUNDARY, and it is the reason this module
 * exists instead of a one-line regex at the call site. The obvious implementation —
 * `/[?&]v=([A-Za-z0-9_-]{11})/` against the raw string — accepts
 * `https://evil.example/?v=dQw4w9WgXcQ`, and the id it extracts is perfectly
 * valid, so the failure is silent: an admin pastes a hostile link, the regex says
 * yes, and we embed it. Parsing with `URL` and checking `hostname` against
 * {@link YOUTUBE_HOSTS} is what makes "this is a YouTube video" a fact rather than
 * a guess.
 *
 * WE STORE THE ID, NEVER THE URL. Every consumer rebuilds the URL from the
 * 11-character id, so no query parameter from the pasted link survives into the
 * iframe. That kills a whole family of problems at once: no `?autoplay=1` an admin
 * did not intend, no tracking parameters, no `playlist=` turning one trailer into a
 * queue of unrelated videos.
 *
 * PRIVACY: embeds use `youtube-nocookie.com`. This site's players are school-age,
 * and the default `youtube.com` embed sets advertising cookies on load. The
 * no-cookie host is not a complete answer — it still contacts Google when the
 * frame loads — which is why `GameTrailer` does not create the frame until someone
 * actually clicks play.
 */

/**
 * A YouTube video id: exactly 11 characters of the URL-safe base64 alphabet.
 *
 * Anchored, and `{11}` is exact rather than `{11,}` — a longer match is not a
 * video id with something appended, it is a different string, and truncating it to
 * 11 characters would silently embed the wrong video.
 */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Hostnames whose URLs may name a video.
 *
 * `URL` lower-cases `hostname`, so these are compared as-is. `youtu.be` is listed
 * because it is the share format the YouTube UI hands people, which makes it the
 * one an admin is most likely to paste.
 */
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
  "youtu.be",
  "www.youtu.be",
]);

/**
 * Path prefixes that carry the id as the NEXT segment: `/embed/<id>`,
 * `/shorts/<id>`, `/live/<id>`, `/v/<id>`.
 *
 * `/watch` is absent on purpose — it carries the id in `?v=`, not in the path, and
 * is handled separately.
 */
const PATH_FORMS = new Set(["embed", "shorts", "live", "v"]);

/** Whether `value` is a well-formed YouTube video id. */
export function isYouTubeId(value: unknown): value is string {
  return typeof value === "string" && VIDEO_ID.test(value);
}

/**
 * Extract a video id from anything an admin might paste, or `null`.
 *
 * Accepts a bare id, a `watch?v=` link, a `youtu.be` short link, an `/embed/`,
 * `/shorts/`, `/live/` or legacy `/v/` path, with or without a scheme, on any of
 * the hosts in {@link YOUTUBE_HOSTS}, with any number of extra query parameters
 * (`&t=30s`, `&list=…`, tracking junk) — all of which are discarded.
 *
 * Returns `null` for every other input, including a valid-looking id on a
 * non-YouTube host. Never throws: `new URL()` on a malformed string is caught, so
 * a caller can pass raw form data straight in.
 *
 * The scheme-less branch is not politeness — people paste `youtu.be/xyz` far more
 * often than they paste the `https://`. It is guarded so it cannot rescue a bare
 * word into a URL: a string with no `.` and no `/` is only ever tried as an id.
 */
export function parseYouTubeId(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw) return null;

  // A bare id is the shortest path and must be checked first: `new URL()` would
  // reject it anyway, but only after the scheme-less branch below had guessed at a
  // hostname for it.
  if (VIDEO_ID.test(raw)) return raw;

  // `youtu.be/xyz` and `www.youtube.com/watch?v=xyz` are both common pastes and
  // neither parses without a scheme. Requiring a `.` or `/` keeps this from turning
  // an arbitrary word into `https://word`.
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw)
    ? raw
    : /[./]/.test(raw)
      ? `https://${raw}`
      : raw;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }

  // THE CHECK THAT MATTERS. Everything below trusts the host.
  if (!YOUTUBE_HOSTS.has(url.hostname)) return null;

  // Reject `javascript:`/`data:` and anything else that is not a web fetch, even
  // on an allowed host — `new URL("javascript://youtu.be/x")` parses, and its
  // hostname really is `youtu.be`.
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const segments = url.pathname.split("/").filter(Boolean);

  // youtu.be/<id> — the whole path is the id.
  if (url.hostname === "youtu.be" || url.hostname === "www.youtu.be") {
    return isYouTubeId(segments[0]) ? segments[0] : null;
  }

  // /watch?v=<id>
  if (segments[0] === "watch") {
    const v = url.searchParams.get("v");
    return isYouTubeId(v) ? v : null;
  }

  // /embed/<id>, /shorts/<id>, /live/<id>, /v/<id>
  if (segments.length >= 2 && PATH_FORMS.has(segments[0])) {
    return isYouTubeId(segments[1]) ? segments[1] : null;
  }

  return null;
}

/**
 * The privacy-mode embed URL for a video id.
 *
 * `encodeURIComponent` is belt-and-braces: a caller should only ever pass an id
 * that came from {@link parseYouTubeId} or from the `youtube_id` column (whose
 * CHECK enforces the same shape), but this string becomes an iframe `src`, so it
 * escapes rather than trusting that promise.
 *
 * The parameters are all about not turning a trailer into a content feed:
 *   - `rel=0` limits the end-screen suggestions to the same channel. YouTube
 *     removed the "no related videos at all" behaviour, so this is the strongest
 *     available setting — it cannot be relied on to show nothing.
 *   - `modestbranding=1` drops the YouTube wordmark from the control bar.
 *   - `iv_load_policy=3` hides annotations.
 *   - `playsinline=1` stops iOS Safari hijacking the video into its native
 *     fullscreen player, which would tear the user out of the store page.
 *   - `autoplay=1` because this URL is only ever built in response to a click on
 *     the poster; the frame does not exist until then, so nothing autoplays
 *     unprompted.
 */
export function youtubeEmbedUrl(
  id: string,
  { autoplay = true }: { autoplay?: boolean } = {},
): string {
  const params = new URLSearchParams({
    rel: "0",
    modestbranding: "1",
    iv_load_policy: "3",
    playsinline: "1",
  });
  if (autoplay) params.set("autoplay", "1");
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?${params}`;
}

/**
 * The canonical watch URL, for the "Watch on YouTube" escape hatch.
 *
 * Uses `youtube.com` rather than the no-cookie host deliberately: this is a link
 * the user chooses to follow off-site, where the no-cookie host offers nothing
 * (it only serves embeds) and would 404 a `/watch` path.
 */
export function youtubeWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
}
