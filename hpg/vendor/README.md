# hpg/vendor — pinned CDN libraries for offline packages

Some games load a library from a CDN: Tailwind's Play CDN, three.js, Font
Awesome. Offline, that request cannot succeed, so the packager (build/inline.ts)
substitutes the copy in this folder when a game asks for one of these exact
URLs. The game files are never edited (the Blob mirror would overwrite them).

- `manifest.json` lists every URL prefix, alias and file, with each file's
  sha256. The packager refuses a file whose hash does not match.
- Only URLs listed in the manifest are substituted. Any other remote URL is
  still a build error.
- `https://cdn.tailwindcss.com` is unversioned online. It is pinned here to
  3.4.17, the version it served when vendored, and the build warns about it.

To add or upgrade a library, edit `LIBRARIES` in `fetch.mjs`, then run
`node hpg/vendor/fetch.mjs` and commit the result. Only `fetch.mjs` uses the
network. The build reads this folder and nothing else.

Licences: Tailwind CSS (MIT), three.js (MIT), Font Awesome Free (CSS MIT, fonts
SIL OFL 1.1). Each file keeps its own licence header where upstream ships one.
