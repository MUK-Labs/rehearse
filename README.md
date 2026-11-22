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

The supplied PDF and current MIDI exports are kept unmodified. The PDF has three pages, common time and 17 bars, starting at printed bar 55. Neither MIDI contains a tempo event, and the PDF has no tempo marking, so the example starts at **120 bpm**.

The revised `md.mid` and `ms.mid` exports (14 October 2026) have no duplicated note onsets between the parts. Their endpoints differ by one MIDI tick; both use the same playback clock, and the map retains the full 68 quarter-note beats. The controls keep the source labels **MD / MS**. Some printed staves contain notes from both MIDI parts. These areas now have conservative shared ownership and fade only when both parts are muted; verified lower staves on pages 1 and 2 still fade with MS. For the intended rehearsal tempo, use `bpm=72` in the link.

## Performance mode

Open **Performance** from the rehearsal toolbar, or visit [the Performance page](https://muk-labs.github.io/rehearse/performance.html). QuasiCampane is included as an example. Add local PDFs or load a public CSV to replace the setlist.

### Load a setlist

Use one score per row in concert order. Use direct HTTP(S) PDF URLs.

```csv
title,pdf_url
QuasiCampane,https://muk-labs.github.io/rehearse/library/QuasiCampane/score.pdf
```

In Google Sheets, choose **File → Share → Publish to web**, select the setlist tab and publish it as **Comma-separated values (.csv)**. Paste the published URL into **Public CSV URL**. To share a link that opens the setlist, append `?setlist=` followed by the URL-encoded CSV URL to `performance.html`.

A PDF on another site needs to allow Rehearse to read it through CORS. For PDFs stored in Google Drive, follow the setup below. **Attach PDF** lets you use a downloaded file for a particular score. **Add PDFs** also works for files kept on the device. Local files stay in the browser.

### Download a setlist from Google Drive

Keep the Drive share links in the `pdf_url` column. Each PDF needs to be downloadable by **Anyone with the link**.

1. Use a Google Cloud project with the [Google Drive API enabled](https://console.cloud.google.com/apis/library/drive.googleapis.com). Create a [standard API key](https://developers.google.com/workspace/guides/create-credentials#api-key) with no service account attached.
2. In the key's application restrictions, choose **Websites** and allow `https://muk-labs.github.io/*`. In the API restrictions, allow **Google Drive API** only.
3. Load the CSV in Rehearse, open **Google Drive setup**, and save the key. Choose **Prepare for offline use** to download, verify, and save the entire setlist in this browser.

Running offline preparation while online refreshes PDFs from Drive. Rehearse keeps a previously saved copy if the refresh fails. For a score you previously attached by hand, **Use Drive source** switches it back after Rehearse successfully reads the Drive PDF. The key stays in this browser, separate from the setlist export.

### Set up passages and page turns

- Select a score and page. Drag a box around a passage, or use **Add whole page**. Use the passage arrows to change its place in the sequence. A sequence can repeat a region or jump between pages. A score with no passages advances through the full PDF.
- **Start performance** opens the first view. Use the arrow keys, Page Up/Down, or tap either side. Use Escape, or tap the centre to show **Exit performance**. The score fills the viewport on browsers that do not allow native fullscreen.
- For a MIDI pedal, press **Connect MIDI**, grant access, then select **Learn Previous** or **Learn Next** and press the pedal. Rehearse accepts Note On and CC switches that cross from below 64 to 64 or above. MIDI assignments are saved on this device. Use a pedal that sends keyboard keys on browsers without Web MIDI, including Safari.
- Setlists and passages are saved in the browser. **Export setlist** produces a JSON file for sharing or backups. On another device, **Import setlist** restores the score list and passage order. Attach any local PDFs again.
- Before going onstage, use **Prepare for offline use** and wait for the ready message. Keep the Performance page URL handy, disconnect, and reopen it on the device you'll perform with to check the set. Offline files are held in this browser's site data.

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

MIDI parser regressions use fixed test examples, so replacing a library MIDI does not require updating hard-coded note counts. `npm run check` validates the current library files and their compatibility with the score map; part files may have different end ticks.

For GitHub Pages, select **Settings → Pages → Source → GitHub Actions** and run the repository's Pages workflow. It validates the project and publishes the static files. The piece URL is then `https://muk-labs.github.io/rehearse/?piece=QuasiCampane`.

## Credits

A project by **Adrián Artacho / MUK-Labs**. PDF rendering uses Mozilla's PDF.js; the sampled piano uses Alexander Holm's Salamander Grand Piano. Versions, licenses and source links are in [THIRD_PARTY.md](THIRD_PARTY.md). Bundled score/MIDI material remains the supplied project material; no additional license is assigned here.

---

## [ToDo](https://trello.com/c/stSESbOv/112-%F0%9F%95%B9-rehearse)
