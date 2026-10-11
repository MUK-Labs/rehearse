# Third-party notices

## PDF.js

The PDF renderer in `vendor/pdfjs/` is **PDF.js 6.4.299** by Mozilla and its contributors, distributed under the [Apache License 2.0](vendor/pdfjs/LICENSE).

- Source: https://github.com/mozilla/pdf.js/tree/v6.4.299
- Distribution: https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-6.4.299.tgz
- The browser modules, CMaps, standard fonts and image/color decoder files are copied unchanged from that release. The standard fonts, CMaps and WebAssembly components retain their individual license files in their respective directories.
- Only the rendering distribution is included; Rehearse does not run PDF forms or embedded document actions.

## Salamander Grand Piano

The piano recordings in `assets/piano/` are from **Salamander Grand Piano**, recorded by **Alexander Holm** on a Yamaha C5. They are licensed under [Creative Commons Attribution 3.0 Unported (CC BY 3.0)](https://creativecommons.org/licenses/by/3.0/).

- MP3 source: https://github.com/Tonejs/audio/tree/efd8296360f9526e379bfbe5c1698ff54d6a1d34/salamander
- Original attribution and license notice: [upstream README](assets/piano/UPSTREAM_README.txt)
- Original sample library: https://archive.org/details/SalamanderGrandPianoV3
- Selected recordings: A0, C1, F♯1, C2, F♯2, C3, F♯3, C4, F♯4, C5, F♯5, C6, F♯6, C7, F♯7 and C8.

These 16 MP3s are an unchanged subset of the Tone.js audio collection. Playback transposes the nearest recording to the requested pitch and applies velocity gain and a release envelope. Rehearse does not bundle the original library's complete velocity layers, pedal noises or resonance model. No endorsement is implied.

## Refreshing vendored assets

Run `node scripts/vendor-dependencies.mjs` from any directory. Node.js 20+ and the `tar` command are required. The script downloads the pinned upstream files and verifies their recorded hashes. This is a maintenance command; the deployed site needs no package install, build step or external CDN requests.
