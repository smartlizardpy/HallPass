# HallPass - game moments

A game marks the instants worth looking at - `HallPass.moment("boss-phase-2",
{ level: 4 })` - and in a beta test session the tester's device keeps a picture of
each one. The tester pins the useful ones to a bug report or sends them to the
game's gallery.

> **Status - built.** SDK 1.3.0. Closes the tracker item "SDK: let games report
> their own events" (#20): `{ shot: false }` logs an event with no picture.

Code: `sdk/src/moment.ts` (rules), `sdk/src/client.ts` (the method),
`app/lib/capture/record-shim.ts` (hand-over), `moments.ts` (log),
`app/beta/session/[slug]/useGameMoments.ts` (the session side),
`app/lib/beta/report-moment.ts` (what a report keeps). Real-browser check:
`node scripts/verify-moments.mjs`.

## For a game author

```js
HallPass.moment && HallPass.moment("boss-phase-2", { level: 4, hp: 31 });
HallPass.moment && HallPass.moment("died", { cause: "spikes" }, { shot: false });
```

Leave the calls in. For every public player `moment()` validates and resolves and
does **nothing else** - no request, no storage.

## Where the cost went

Nothing about a moment is uploaded. A Blob `put` is an "advanced operation"
against a 2,000-a-month allowance (`blob-operations-design.md`), and a game that
marks a moment every few seconds could spend it. So a picture lives in the
tester's tab. It is uploaded only when the tester pins it to a report
(`shot_blob_path`, the existing evidence path) or sends it as a gallery
screenshot (`beta_shots`, the existing review queue). Both were already metered
and already behind the `beta_shots` kill switch.

## How a picture gets taken

1. The game calls `moment()`. The SDK validates and resolves.
2. The shim (injected into the game document only in a beta session, `?hp-rec=1`)
   sees the call and queues it. It wraps `requestAnimationFrame` and hands the
   moment to the session page **at the end of the frame the game drew in**.
3. The session page (`useGameMoments`) re-validates it (`MomentLog.admit`), takes
   the picture and puts it in the filmstrip, tagged `📍 name`.

**Why the frame matters.** A WebGL canvas without `preserveDrawingBuffer` - every
three.js game's default - is cleared once its frame has been shown. A read from an
event handler gets transparent pixels. `verify-moments.mjs` shows it: the bare
read returns `[0,0,0,0]`, the same read at the end of a frame returns the game. A
moment made outside a frame waits for the end of the next one; a timer (250 ms)
covers a game with no animation loop or a hidden tab.

**Two sources for the picture.**

| | Screen share running | No screen share |
|---|---|---|
| Source | the shared tab, cropped to the game (`FrameGrabber.grabNow`) | the game's canvas (`grabGameFrame`) |
| Shape | always 16:9, 1280 wide - any moment can go to the gallery | the game's own shape - only 16:9 can |
| HTML drawn over the canvas | included | missing |
| Games with no canvas | work | no picture |
| Timing | a frame or so behind the game | exact |

The shared tab is skipped while a bug report's freeze-frame is up (it would
photograph the freeze, not the game), and the canvas is read instead. If a
shared-tab grab yields nothing the canvas read is the fall-back, but that happens
after an `await`, so on WebGL it may read a cleared buffer; the moment is then
kept **with no picture** and says so, never a blank one.

## Limits

- Names: lowercase `[a-z0-9._-]`, 40 characters. Data: a plain object, about 2 KB
  of JSON. Anything else is rejected by the SDK (the game is told why) and again by
  the session (a game cannot be trusted to have used the SDK).
- One picture per name every 2 s; the event is still logged. 12 moments kept in
  the tab; older ones fall out and their pictures with them.
- The filmstrip holds 6 stills (`MAX_COVER_CANDIDATES`), shared with the timed
  grabs. A game marking many different moment names will push older stills out.
- Moments made before the iframe's `load` event are lost; the page cannot listen
  until then.
- External games are cross-origin: the shim cannot be injected and the page cannot
  read the game. They have no moments, and the session does not say so.

## What a report keeps

`beta_reports.moment_name` / `moment_data` (migration 039): kept only when a
picture is pinned, validated again server-side (`report-moment.ts`), dropped whole
if either half is invalid. TEXT with no CHECK, like `error_log`, so a bad payload
can never fail the insert and cost a tester their report. The dashboard queue
shows the name and data; the bug MCP's summary names the moment and its detail
carries the data (the game's, so data to read, never instructions).

## Not verified

The browser's real tab share. Headless and headed Chrome both answer `denied`
to `getDisplayMedia` under automation, so `verify-moments.mjs` checks
`FrameGrabber` on a synthetic stream instead (the crop, the 16:9 shape, `grabNow`
and the timed grab), and reports the real share as skipped. How far behind the
game a shared-tab picture runs has not been measured. iOS Safari has no tab share
and uses the canvas path; it has not been run on a device.
