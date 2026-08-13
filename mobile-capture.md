# HallPass — evidence capture on a phone

A beta tester on an iPhone can play a game, file a report and write a review.
They cannot produce a single picture of what went wrong, and nothing on the
screen tells them why.

> **Status — phase 1 built, phase 2 designed and not built.**
>
> Phase 1 (this change): evidence uploads stop being judged by gallery rules, the
> composer gains a manual attach, and a same-origin canvas grabber gives a
> no-permission screenshot on devices with no `getDisplayMedia`.
>
> Phase 2 (below, deliberately not built yet): attaching an iOS screen recording
> and cropping the HUD out of it by fiducial marker. The decisions are recorded
> here so the next change starts from them rather than re-litigating them.

---

## Why the phone is empty-handed

`canCapture()` (`app/lib/capture/tab-capture.ts`) requires
`navigator.mediaDevices.getDisplayMedia`. WebKit does not implement it on iOS —
and since every browser on iOS is WebKit underneath, that covers Chrome and
Firefox there too. It is not a gap we can shim; there is no API to call.

Everything downstream hangs off that one stream:

| capability | on desktop | on iOS |
|---|---|---|
| auto-screenshots (`FrameGrabber`) | yes | **no stream** |
| replay clip (`ReplayBuffer`) | yes | **no stream** |
| freeze-frame at the bug | yes | **nothing to freeze** |
| cover candidates for the gallery | yes | **none** |
| error log, reports, review, Done | yes | yes |

The `MediaRecorder` half is already iOS-ready — `MIME_CANDIDATES` in
`replay-buffer.ts` lists `video/mp4` precisely because Safari encodes H.264/MP4
and not WebM. Only the source is missing.

The UI's failure mode was silence: the capture button is rendered behind
`canRecord &&`, so on a phone it simply is not there, and the composer's
"attached automatically" list still advised starting a recording that cannot be
started.

---

## The policy bug underneath it

Even with a picture in hand, a tester could not have attached one.

`submitReportAction` puts report attachments through `uploadShot` →
`validateMediaUpload`, which is the **gallery** policy: at least 640px wide, and
an aspect between 1.2 and 2.2 (`image-meta.ts`). A portrait iPhone screenshot is
about 0.46. It would have been rejected — and `submitReportAction` logged that to
the console and filed the report with no image, so the tester would have been
told nothing at all.

Those two policies were never the same policy; they only shared a function
because until now every image came from the same 16:9 grabber.

- **Gallery candidates** (`beta_shots`, later copied into `game_media`) are
  published on a game's page. They must be landscape and big enough to sit in a
  16:9 frame. That policy stays exactly as it is.
- **Evidence** (`beta_reports.shot_blob_path`) is looked at once by an admin in a
  triage list that renders it `h-32 w-auto`. Its only job is to show what went
  wrong. A portrait phone screenshot is the *normal* shape here, not a defect.

So `validateEvidenceUpload` keeps the parts that are about safety and cost —
magic-byte sniffing (never `file.type`, see the module docblock), the 4 MB cap,
PNG/JPEG/WebP only — and drops the parts that are about looking good in a
gallery. No migration: `shot_blob_path`/`shot_url` are plain `TEXT` with no
dimension columns.

---

## Phase 1 — what is built

### 1. Manual attach in the composer

A file input, `accept="image/*"`. On iOS that opens Photo Library / Take Photo,
so the flow is: hit the bug, take a screenshot the way you always do, press
**Report bug**, attach it.

Downscaled and re-encoded to WebP in the browser before it goes anywhere — a
modern phone screenshot is 3–8 MB of PNG and the cap is 4 MB, so uploading the
original would fail on exactly the devices this is for.

**It is announced, not silent.** The auto-grab path can promise the HUD is
outside every image because it crops to the iframe by construction. A file out of
someone's camera roll carries whatever they photographed, so the composer says so
next to the picker rather than letting a child discover it later.

### 2. The same-origin canvas grabber

Bundled games are served from `/game-html/<slug>/` **on our own origin** (see
`app/game-html/[slug]/[[...path]]/route.ts`), which is how `attachToFrame`
already reaches inside the frame to collect the game's errors. The same access
allows `iframe.contentDocument` → largest `<canvas>` → `drawImage` → `toBlob`.
No permission, no prompt, no `getDisplayMedia`, and it works on iOS.

It does not work everywhere, and the honest list matters more than the feature:

- **External games are cross-origin.** `contentDocument` is null. Nothing to do.
- **WebGL canvases read back blank** unless the game created its context with
  `preserveDrawingBuffer: true`, which is the game's choice. We cannot inject a
  shim to force it either: most games 307 to the static mirror under `/games/`,
  so the HTML we serve is never rewritten on the way past.
- **A canvas tainted by a cross-origin texture** throws `SecurityError` on
  readback.
- **DOM-only games have no canvas at all.**

Every one of those is *detectable*, which is what makes the feature honest rather
than flaky: blank readback is caught by the existing `isBlankFrame()` — the same
check that rejects loading screens — and the rest are caught at the probe. A
failure says which case it hit and points at the manual attach. It never claims
to have grabbed something it did not.

Wired in two places: a **Grab the game** button that replaces the absent
auto-screenshot control, and one automatic attempt when a bug report is opened
with no candidate already in hand, so the common case costs no extra tap and the
freeze-frame still works.

### 3. The phone layout

The composer was `absolute inset-y-0 right-0 w-full max-w-sm`, i.e. a side panel
that covers the entire game on a phone. Under `sm` it becomes a bottom sheet, so
the game stays visible while a bug is described — which is the same argument the
component's own docblock makes for not pausing the game.

---

## Phase 2 — the screen recording, designed not built

Agreed shape, for whoever picks this up:

**Store cropped stills, not a re-encoded video.** Seek through the attached
recording, take a handful of frames, crop each, hand them to the pipeline that
already exists. `canvas.captureStream` + `MediaRecorder` would preserve motion
but its support on iOS Safari is uncertain, and re-encoding video on a phone is
slow and hot. Storing the recording uncropped and cropping it with CSS in triage
was rejected outright: the uncropped pixels stay in the blob for anyone with the
URL, which on a site used by children is not a trade worth making.

**Find the crop by fiducial, not by computer vision.** Arming record mode paints
a known-colour marker frame around the game area; the crop is then a bounding-box
search for that colour. Deterministic, unit-testable against synthetic frames,
and immune to the two unknowns that sink the obvious approaches — the height of
Safari's own chrome, and the device pixel ratio. Detecting the HUD by its
colours, or deriving the offset from `window.screen`, both guess.

**Notification banners: excluded by the crop, then checked by a human.** A banner
drops in above the marker box in the layouts we care about, so the geometry
removes it for the same reason it removes the HUD. Where it overlaps the game
area, a mandatory preview — the tester sees exactly what is about to be sent and
can drop a frame — is the backstop. Auto-detecting a banner by looking for a
region that stays static while the game moves was rejected: most of the
catalogue has a static score panel at the top of the screen, so it would fire on
the game itself.

Open, and worth settling before writing any of it: an iOS screen recording picked
through a file input may arrive as `video/quicktime`, which the clip-token route
does not allow (`ALLOWED = ["video/webm", "video/mp4"]`). If frames are extracted
in the browser the video never needs uploading at all, which sidesteps it — but
that is an assumption to verify on a real device, not in a simulator.

---

## Gotchas

### 1. The gallery policy is load-bearing in two directions

An accepted `beta_shot` is later copied into `game_media`, so anything that would
be rejected there has to be rejected on the way in — otherwise acceptance fails
at the last step, in the dashboard, in front of an admin who cannot do anything
about it. That is why `submitShotAction` keeps `validateMediaUpload` unchanged
and only the *report attachment* path moved to the evidence policy.

### 2. A dropped attachment must be said out loud

The report write deliberately degrades rather than fails when evidence cannot be
stored — the words are the point. But the tester chose that file on purpose, so
the result now says the image did not make it instead of quietly filing without
it. Silence was the original bug, not the rejection.

### 3. `canCapture()` is answered through `useSyncExternalStore`

Reading `navigator` during render made the button absent from the SSR HTML and
present after hydration — a mismatch React recovers from by re-rendering the
tree, which on this page means **remounting the game**. Any new
capability probe in this component follows the same shape, with a `() => false`
server snapshot. It is written up at the `canRecord` declaration.

### 4. Object URLs are owned

Every preview is a `URL.createObjectURL` and leaks the whole decoded image until
revoked. The session already revokes its grabs on unmount; a manual attachment is
one more thing to revoke, including when it is replaced by another one.
