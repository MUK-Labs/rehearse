# [Rehearse](https://muk-labs.github.io/rehearse/?piece=QuasiCampane)

Your score. Your parts. Your tempo.

A small, static rehearsal player: the original PDF stays at the centre, with a play button above each bar and a narrow strip of piano playback controls. Each piece lives in its own folder under `library/`.

The player is hosted on GitHub Pages; each piece can be shared with its own direct link.

## Practising

- Choose a piece from the library menu. A direct link such as `?piece=QuasiCampane` opens that piece.
- Click a **▶ on the score** to start at that bar, or use the **Bar** menu to seek. The example retains its printed numbers **55–71**.
- Toggle a part to hear or mute its MIDI. Its mapped score areas fade; areas shared by several parts fade only when **all** their parts are muted.
- Adjust **♩ bpm** while playing. Tempo is a single, constant quarter-note rate; source tempo changes are not followed. Play/pause also works with **Space** when focus is outside a control. **↤** returns to the beginning.
- The **•••** menu includes automatic following, the original PDF, and file/map tools.

All parts share one musical clock and use the bundled sampled piano. MIDI format 0/1, PPQ timing, note velocity and sustain pedal are supported. A click is required to start browser audio. Playback pauses when the page goes into the background.

### Reading and tempo links

Open [QuasiCampane at 72 bpm, full width](https://muk-labs.github.io/rehearse/?piece=QuasiCampane&fullscreen=1&bpm=72).

| Parameter | Effect |
| --- | --- |
| `fullscreen=1` | Fits the score to the full screen width, hides the heading and footer, and keeps the narrow playback strip available. Useful on an iPad or music stand. |
| `bpm=72` | Sets the starting tempo to 72 quarter notes per minute, overriding the piece's default and any saved map tempo. You can still change it using the controls. |

Both parameters work independently and remain in the link when switching pieces. Valid `bpm` values are 20–300 and are rounded to whole beats per minute; absent or invalid values use the piece's tempo. Reading mode fills the browser viewport without requiring the browser's native fullscreen API. Omit `fullscreen=1` to return to the usual layout. Audio still starts only when you press Play or a bar button.

### About the QuasiCampane example

The original PDF and MIDI files are included unchanged. The PDF has three pages, common time and 17 bars, starting at printed bar 55. Neither MIDI contains a tempo event, and the PDF has no tempo marking, so the example starts at **120 bpm**.

The supplied `md.mid` and `ms.mid` do **not** form a clean split by hand or staff. MD contains the highest notes through bar 63, then rests until partway through bar 68; its ending duplicates material in MS. The controls therefore retain the neutral labels **MD / MS**. Conservative shared-area mapping avoids greying out another active part's notation. Both files play as supplied, including the overlapping ending; corrected exports can replace them later.

## Adding a piece

1. Open **••• → Open PDF + MIDI files** and select **one PDF and all its MIDI files together**. Optionally include an existing `piece.json`. These files are read locally in your browser.
2. Open **Edit map → Bar starts**. Choose a bar, set its printed number and MIDI beat if needed, then click just above its beginning on the PDF. The editor advances to the next bar automatically.
3. Choose **Part areas**, select the part or parts represented by an area, and drag a rectangle around that notation. Shared areas can belong to several parts. Undo, removal and reset are available.
4. **Download map** to save `piece.json`. Put it beside the PDF and MIDI files in `library/<id>/`; the folder name must equal the JSON `id`. IDs use letters, digits, hyphens or underscores.
5. Add the piece to `library/index.json`, commit the folder and index, then link to `?piece=<id>`.

Map edits are remembered in the current browser, when storage is available. They are not written to GitHub automatically, and local PDF/MIDI files must be selected again after reloading. Download and commit `piece.json` to preserve and share the mapping. The download includes the current tempo.

Bar timing is measured in **quarter notes from the MIDI start**: beat 0 is the beginning, regardless of the printed bar number. Automatically inferred bars are only a starting point. Pickups, changing meters and unfolded repeats need explicit beat positions. Marker numbers must be unique; for repeated passages, use unique playback numbers and place the additional markers at the relevant score locations. There is no optical music recognition or automatic PDF-to-MIDI alignment.

### Folder and map format

```text
library/
  index.json
  MyPiece/
    piece.json
    score.pdf
    melody.mid
    accompaniment.mid
```

`library/index.json`:

```json
{"pieces": [{"id": "MyPiece", "title": "My piece"}]}
```

Minimal `piece.json` (replace the example coordinates with your map):

```json
{
  "id": "MyPiece",
  "title": "My piece",
  "pdf": "score.pdf",
  "tempo": 100,
  "parts": [
    {"id": "melody", "label": "Melody", "midi": "melody.mid"},
    {"id": "accompaniment", "label": "Accompaniment", "midi": "accompaniment.mid"}
  ],
  "bars": [
    {"number": 1, "beat": 0, "page": 1, "x": 0.15, "y": 0.20},
    {"number": 2, "beat": 4, "page": 1, "x": 0.55, "y": 0.20}
  ],
  "regions": [
    {"part": "melody", "page": 1, "x": 0.10, "y": 0.24, "width": 0.80, "height": 0.08},
    {"parts": ["melody", "accompaniment"], "page": 1, "x": 0.10, "y": 0.35, "width": 0.80, "height": 0.10}
  ]
}
```

Pages are numbered from 1. Positions and rectangle dimensions are fractions of the page, with the origin at the top left. Optional `pageCount` enables page-bound checks in the command-line validator; optional `durationBeats` can retain trailing silence. The browser always checks mapped page numbers against the actual PDF.

## Run and publish

Serve the repository over HTTP, for example:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000/?piece=QuasiCampane`. Opening `index.html` directly with `file://` will not work. There is no build step or runtime CDN dependency.

With Node.js 20 or later:

```sh
npm test
npm run check
```

The checks cover MIDI timing, playback transport, map validation, referenced assets and piano sample hashes. They require no package installation or Python PDF parser.

For GitHub Pages, select **Settings → Pages → Source → GitHub Actions** and run the repository's Pages workflow. It validates the project and publishes the static files. The piece URL is then `https://muk-labs.github.io/rehearse/?piece=QuasiCampane`.

## Credits

A project by **Adrián Artacho / MUK-Labs**. PDF rendering uses Mozilla's PDF.js; the sampled piano uses Alexander Holm's Salamander Grand Piano. Versions, licenses and source links are in [THIRD_PARTY.md](THIRD_PARTY.md). Bundled score/MIDI material remains the supplied project material; no additional license is assigned here.

---

## [ToDo](https://trello.com/c/stSESbOv/112-%F0%9F%95%B9-rehearse)
