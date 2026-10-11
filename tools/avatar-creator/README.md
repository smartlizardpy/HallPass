# Avatar Studio

A standalone, browser-local authoring tool for the approved 33-face catalogue.
It is outside HallPass's public folder, routes, authentication, and database.

Open `index.html` in a current desktop browser. No server, API key, account, CDN,
or installation is needed. Select a face, adjust placement and colour, then export.
The catalogue browser is an authoring aid; the HallPass chooser is a separate task.

The supplied cutouts are AI-generated interpretations of the agreed references,
not extracted original screenshots. `prompts.json` records the generation prompts.
Python/Pillow prepares transparent PNGs; the editor preserves their alpha.

## Exports

- Single PNG: 512×512, circular colour background, transparent outer corners.
- Full pack ZIP: all 33 rendered avatars, original cutouts, and `catalogue.json`.
- Project JSON: editable placement/colour choices; import to restore a project.

Browser-local storage saves settings where available. Use project export as a
portable backup. Imported replacement images stay in memory and must be supplied
again after reload; exported packs include the current cutouts.

## Handoff

Catalogue entries use stable `id`, `name`, `category`, `reference`, `src`, and
`defaults` fields. The exported manifest includes the selected background and
placement plus paths to final avatars and cutouts. Do not derive identities from
entry order. Assets are prepared here; HallPass default assignment and personal
photo opt-in are not implemented by this standalone tool.

## Verification

Run `node --test tools/avatar-creator/tests/*.test.mjs` and
`python3 tools/avatar-creator/prepare_assets.py --verify` from the repository root.
The repository lint and test commands are also required before delivery.
