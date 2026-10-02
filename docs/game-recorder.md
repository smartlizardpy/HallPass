# HallPass — the gameplay recorder

A beta tester can record the game they are testing — picture, sound and a
timeline of what happened — and save it to their own device. Nothing is uploaded.

> **Status — v1 built: raw recording, local download.** Auto-edit (cut to
> highlights, a best-of reel across sessions) is the reason the events file
> exists and is **not built**. The decisions below are recorded so the next change
> starts from them.

Code: `app/lib/capture/game-recorder.ts` (capture), `record-shim.ts` (page
script), `record-events.ts` (sidecar), `record-policy.ts` (limits and
decisions), `save-take.ts` (download); UI in
`app/beta/session/[slug]/` (`useGameRecorder.ts`, `TestSessionClient.tsx`).
Real-browser check: `node scripts/verify-recorder.mjs`.

---

## Why not the tab capture

`tab-capture.ts` records what the tab shows and needs `getDisplayMedia`, which
iOS does not have (see `mobile-capture.md`). It also shows a picker every time.
This records the **game**: the canvas through `captureStream()`, read out of the
same-origin iframe. No prompt, and it works wherever `MediaRecorder` does,
including Safari (mp4/H.264 via `pickMimeType()`). The two are independent and
can run together.

## What is recorded

- **Picture.** The largest visible canvas ≥ 64×64, chosen at the moment Record is
  pressed. Recorded directly with `captureStream(30)` — not composited through
  `drawImage`, which would bring back the "WebGL reads back blank" problem
  (`dom-capture.ts`). `captureStream` does **not** need `preserveDrawingBuffer`.
  HTML drawn over the canvas (a score panel in the DOM) is **not** in the video.
- **Sound.** The game's Web Audio output, via the shim (below). Silent for a game
  with no Web Audio, including `<audio>`-tag games, and said so.
- **Events.** The sidecar, below.

## How audio gets in: the shim

A node already connected to `AudioContext.destination` cannot be tapped, so the
tap has to be in place before the game builds its graph. The `/game-html` route
normally 307s to the static mirror and never touches the HTML. With
`?hp-rec=1` **on the game document only**, it fetches the HTML (static twin, or
the blob when that is what would have been served), puts `RECORD_SHIM_SOURCE`
after `<head>` (with a `<base href="/games/<slug>/">` for a static-twin game, so
relative URLs resolve as they do after production's 307; `location.pathname` still
differs) and answers 200, `no-store` (private for staged games, and the
staged gate runs first). Only the beta session iframe asks for it.

The shim patches `AudioNode.prototype.connect` so a connection to a destination
is also made (from the same output index) to a per-context
`MediaStreamAudioDestinationNode`; the recorder mixes
those streams (including contexts created mid-take) into one track. It also
wraps `HallPass.submitScore`/`progress` in place (only on an object that has
`submitScore` and a `version` — `window.HP` is often a game's own variable), listens for the `achievement`
event, and reports tab visibility. It never throws and is idempotent.

Known limits: a node the game later `disconnect()`s from the destination keeps
feeding the recording; offline, the service worker falls back to the plain static
twin (the game plays and records, with no audio or SDK events).

## Detected, not hoped about

`probeRecordable()` names why a game cannot be recorded, and the UI says it:
`cross-origin` (external game), `no-canvas` (DOM-only, or not started yet),
`unsupported` (no `MediaRecorder`/`captureStream`), `no-container`, `failed`. A
game drawing in **layers** (a second visible canvas ≥ half the size of the first)
records only the largest layer and the tester is told.

## Caps

| | desktop | touch |
|---|---|---|
| length | 5 min | 3 min |
| size | 120 MB | 80 MB |
| video / audio bitrate | 2.5 Mbps / 128 kbps | 1.5 Mbps / 96 kbps |

Hitting a cap stops the take and offers the download of what exists. Touch gets
less because Safari kills a tab that grows too large and a crash loses the take.

## The sidecar — `*.events.json`, format v1

Downloaded next to the video (`<slug>-YYYYMMDD-HHMMSS.webm|mp4` and
`….events.json`). This is the contract a future auto-edit consumes.

```jsonc
{
  "format": "hallpass-recording-events",
  "version": 1,
  "clock": "mediarecorder-start",     // t = 0 is the recorder's start event
  "game": { "slug": "snag", "title": "Snag" },
  "recording": {
    "file": "snag-20261002-210045.webm",
    "mimeType": "video/webm;codecs=vp9,opus",
    "startedAtEpochMs": 1790000000000,
    "durationMs": 61234,
    "width": 800, "height": 600,       // canvas backing store
    "hasAudio": true,
    "audio": "webaudio",               // "webaudio" | "none" | "unsupported"
    "endedBy": "user",                 // "user" | "cap" | "navigated" | "error"
    "canvasCount": 1
  },
  "device": { "userAgent": "…" },
  "droppedEvents": 0,                  // events past the 2000 cap
  "events": [
    { "t": 0,     "source": "recorder", "type": "recording.start" },
    { "t": 8120,  "source": "sdk",      "type": "score.submit", "data": { "score": 1200 } },
    { "t": 8390,  "source": "sdk",      "type": "score.result", "data": { "ok": true, "rank": 4, "reason": null } },
    { "t": 20040, "source": "tester",   "type": "mark" }
  ]
}
```

Event types (v1): `recording.start|stop`, `score.submit {score}`,
`score.result {ok, rank, reason}`, `achievement {key, name, points}`,
`progress {key, value}`, `game.error {message, file?, line?}`,
`visibility {state}`, `report {kind}` (tester opened a bug report), `mark`
(tester pressed ⭐). Sources: `recorder`, `sdk`, `tester`, `game`. New types and
fields may be **added**; existing ones never change meaning.

For consumers:

- **Zero.** The first video frame can land ~100–200 ms after `t = 0`. Cut with a
  pre-roll, not to the millisecond.
- **What games actually emit.** Only SDK games (16 of the 29 bundled) call
  `submitScore`, and only one calls `unlock`. There is no per-score-tick, death or
  pause signal anywhere, so for the rest the file holds recorder and tester events
  (`mark` and `report` are the strongest highlight signals available). "Game over"
  is, at best, "the game called `submitScore`". Richer events want an additive SDK
  method — a separate piece of work, deliberately not part of v1.
- **No identity.** No player id, handle, name or email. Score values are logged;
  who scored them is not.
- **Chrome WebM has no duration header** and sparse frames on static scenes
  (`captureStream` emits on change). Players cope; remux with ffmpeg before
  seeking precisely.

## The UI

`🎥 Record gameplay` in the top bar, beside the screenshot controls. While
recording: `REC m:ss`, `⭐ Mark`, `■ Stop`. On stop, a bar above the game (outside
the tab capture's crop target) shows duration and size with **Save video**,
**Save events** and **Discard** — saved on a click because iOS Safari needs a
user gesture for downloads, and a take the tester never saved is not left in a
downloads folder. A recording is **not** attached to bug reports; the composer
says so. The control is disabled with a reason for an external game rather than
absent.

## Not verified

iOS Safari. The Safari/mp4 branch is covered by unit tests of `pickMimeType` and
by reading, not by running on a device. Frame-accurate alignment of events to the
video is not measured; `verify-recorder.mjs` checks only the sidecar's own clock.
