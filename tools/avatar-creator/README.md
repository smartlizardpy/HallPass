# Avatar Studio

A standalone, browser-local avatar and colour chooser for the approved 33-face catalogue.
It is outside HallPass's public folder, routes, authentication, and database.

Open `avatar-studio.html` in a current desktop browser. This is the portable
single-file creator. `index.html` and its neighbouring files are editable sources.
No server, API key, account, CDN,
or installation is needed to use the finished browser tool. Select a face,
choose a background colour, then export. Framing is fixed.
This standalone preview does not integrate with HallPass.

The supplied cutouts use original meme images, not image generation.
`sources.json` records source URLs and any selected frame/crop. Python's rembg
library removes backgrounds; reviewed Python polygon masks correct difficult
cartoons without changing source pixels. Pillow trims and centres transparent PNGs.
`asset-data.js` embeds the prepared images so opening the HTML directly still
supports canvas export without cross-origin restrictions.

## Exports

- Single PNG: 512×512, circular colour background, transparent outer corners.
- Full pack ZIP: all 33 rendered avatars, original cutouts, and `catalogue.json`.
- `avatar-catalogue.zip`: a prepared pack with default colours, ready for handoff.
- Project JSON: colour choices; imports cannot change avatar framing.

Browser-local storage saves settings where available. Use project export as a
portable backup. Avatar scale and position come from `approved-framing.json`, supplied by the owner.
Andy uses a replacement face with its own centred framing. Catalogue defaults
are the rendering contract; neither dragging nor size/position controls are exposed.

## Handoff

Catalogue entries use stable `id`, `name`, `category`, `reference`, `src`, and
`defaults` fields. The exported manifest includes the selected background and
fixed placement plus paths to final avatars and cutouts. Do not derive identities from
entry order. Assets are prepared here; HallPass default assignment and personal
photo opt-in are not implemented by this standalone tool.

## Verification

Run `node --test tools/avatar-creator/tests/*.test.mjs` and
`python3 tools/avatar-creator/prepare_assets.py --verify` from the repository root.
The repository lint and test commands are also required before delivery.

## Reprepare images

Use Python 3.12 and install `requirements.txt` in a virtual environment. Run
`download_sources.py`, then `prepare_assets.py --all` and
`prepare_assets.py --bundle`. Source downloads and segmentation-model weights
need network access; the finished HTML creator works offline.
