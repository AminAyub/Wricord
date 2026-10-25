# Wricord

Wricord is a deliberately quiet, 9:16 writing recorder for a MacBook. It places a compact webcam strip above a DIN A4-proportioned writing surface and records the composed portrait scene for short-form video.

## Run locally

Install a supported [Node.js LTS release](https://nodejs.org/) (22 or newer recommended; minimum 20) and Git, then run:

```sh
git clone https://github.com/AminAyub/Wricord.git
cd Wricord
npm install
npm start
```

`npm install` pins the browser vision runtime and downloads two official
MediaPipe models: the 3.8 MB Face Landmarker and the 15.6 MiB SelfieMulticlass
segmenter. Both are checksum-verified before they are installed locally. Open
[http://localhost:4173](http://localhost:4173) in a current Chrome browser.
There is no build step. To use another port, run `PORT=3000 npm start`.

Alternatively, use **Code → Download ZIP** on GitHub, extract it, open Terminal
in that folder, and run `npm install` followed by `npm start`. Keep Terminal
running; press Control–C there to stop the server. Do not open `index.html`
directly.

To update a Git clone, run `git pull --ff-only`, restart the server, and refresh or fully reopen the app.

For an app-like Mac experience, use the browser’s **Add to Dock** or **Install App** command after opening Wricord once. The included web-app manifest and offline cache let the installed window reopen without browser chrome; run the local server again whenever the browser needs to refresh application files.

The camera and microphone APIs require a secure browser context. `localhost` is treated as secure by modern browsers, so use the localhost address printed by the server rather than opening `index.html` directly. Grant camera access when prompted; microphone access is only needed when audio recording is enabled.

Run the automated checks with:

```sh
npm test
```

## Recording and export

Start the camera, compose your text and timestamp, then start recording. The
saved video contains the portrait composition rather than a screen capture of
browser controls. The camera starts in its original natural view. Use the
mosaic icon beside the recording controls to switch the complete upper
band—including the side-fill regions—into a scene-aware live abstract painting.

The painter analyzes each camera frame locally in two complementary ways. A
six-class semantic model separates background, hair, face skin, body skin,
clothing, and accessories; their union establishes one connected person from
head through neck and shoulders to torso. A blurred YCoCg Scharr detector then
finds luminance and color edges inside and around those structures. The result
is rectangularized as one full-scene composition, so the person no longer
appears as an independent face mask laid over a separate mosaic.

Facial landmarks guide a deliberately sparse Rothko-like grammar: broad
forehead, cheek, and jaw fields; a brow and two nested blocks per eye; a vertical
bridge plus horizontal base for the nose; and two horizontal mouth fields. Hair
comes from the semantic silhouette and resolves into broad attached blocks.
Uniform walls and side-fill areas stay much larger, while real scene boundaries
earn smaller fields. Hair, skin, and clothing keep distinct roles but share one
person palette group; unrelated background structures use complementary
families from a curated vermilion, cobalt, gold, teal, violet, ink, and
warm-paper palette. Source pixels influence structure and lightness, not literal
paint hue.

The artwork is intentionally held and replaced at no more than 10 fps. Slow
inference drops camera frames instead of queueing them, so typing and the
recording compositor remain responsive. The preview and exported recording
always use the same held artwork canvas.

### Rothko+ painting

The **R+** button selects a third mode: glowing cadmium-orange above saturated
crimson on a deep plum-maroon ground. Feathered translucent washes breathe slowly,
with a subtle, stationary cotton-grain texture across the whole painting.
The person emerges through soft plum/rose pigment, broad cheek shading and a
translucent body wash rather than black outlines. These deposits multiply into
the field colours and receive the same final colour glaze as the whole painting.
Field edges wick gently along the smoothed body contours where the two meet.
The shared person segmentation and Scharr detector locate the body,
hair crown and hairline; facial landmarks shape the jaw, with restrained neck
and collar curves. Contours use stable resampling and temporal smoothing.
Tracked eyes become diffuse plum almond shapes; curved lips open with the mouth.
No extra models or network services are needed.

Opening the mouth for about 0.2 seconds releases small line butterflies. Inner
lip separation is normalized by mouth width and camera aspect ratio; hysteresis
suppresses small detection changes. While the mouth remains open, at most one
butterfly appears every 650 ms. Butterflies alone retain crisp black pigment.
Each uses four wing curves, flies toward alternating
edges, and fades away; at most nine are active. Closing the mouth or losing face
tracking stops new butterflies, while existing ones finish their flight.

Like the other modes, Rothko+ is included in the recording through the same
artwork canvas and updates at up to 10 fps. Press **R+** again for the normal camera.
Low light, occlusion, or extreme head angles can reduce contour and mouth accuracy.
The deterministic `/rothko-plus-study.html` page uses synthetic portrait anchors
and an **Open mouth** button to inspect the same painter and butterfly animation
without a webcam. It is a rendering test, not a substitute for real detection testing.

### Mondrian controls and composition

The **M** button selects a separate Mondrian treatment. The mosaic button selects
Rothko; pressing the active mode returns to the normal camera. Both modes are
included in the saved recording exactly as displayed. The **⋮** button opens
Mondrian settings; mode and settings are remembered locally.

Mondrian reduces the shared person mask and face box to head extent, shoulder
width/height, torso placement, reliable side skin masses, and one strong horizontal
background division. Missing detection uses a central seated-person prior. It
does not draw eyes, mouths, skin colours, or a traced silhouette.

An asymmetric hierarchy of 12–18 rectangular fields creates long black divisions
and shorter T junctions. Six inexpensive palette candidates are evaluated using
source luminance/colour, foreground importance, area, visual-weight moments and
previous colour choices. Defaults budget about 23% of the area for colour/black
planes, leaving roughly 65–75% off-white after the lines. This is a heuristic
composition system, not a generative image model or a pose/hand landmark model.

Anchors have a deadband and time-based smoothing. Colour changes must persist for
1.4 seconds after evaluation every 700 ms; existing colours receive a persistence
bonus. A stationary source keeps its partition. Black lines remain crisp and
opaque; changes use held frames without fading or gradients. Tracking latency
and challenging lighting can still affect recognition.

Settings: raise **Subject recognizability** for closer proportions and a broader
torso emphasis; raise **Abstraction** for fewer fields. **Colour density** controls
the coloured-area budget, **Responsiveness** the movement speed, and **Line
thickness** the black divisions. Optional **Texture** is very faint and fixed in
canvas coordinates. **Show anchors and partition** overlays the mask, anchors and
cells in the preview only; diagnostic marks are excluded from recordings.

For reproducible source comparisons, open
<http://localhost:4173/painting-test.html> while the server runs. Select a saved
portrait image or short video (no upload), then use **Restart composition** to
reset tracking and composition. This page uses the same `AbstractCameraRenderer`,
`FaceTracker`, and `MondrianPainter` as the webcam. Video controls allow pausing
and seeking; the image remains available while local models settle. Inference
timing can vary between runs, so pixel-exact determinism is tested separately
with synthetic anchors and frames in `test/mondrian.test.js`.

The recorder is designed for sessions of at least four minutes. Keep Wricord visible while recording when possible; if the browser briefly suspends display animation, a separate frame watchdog keeps the portrait canvas moving and refreshes it when the app becomes visible again.

There is no application-imposed duration limit. Recordings stay in browser memory until export, so memory pressure, screen locking, and browser suspension can interrupt long sessions. The four-minute automated tests simulate scheduling and chunk retention; they do not validate a real browser encoder. Before important use, record four minutes with camera motion and changing text and inspect playback near the end.

- Type directly on the A4-proportioned lower page. Draft text is saved automatically in local browser storage and displayed as rich Markdown. Typed `**bold**`, `*italic*`, headings, lists, quotes, and code are supported.
- A complete A4 page stays visible beneath the camera. Text automatically continues on the next page when the printable area fills; use the bottom-left arrows to revisit and edit earlier pages. Text scales with the paper, and recordings capture only the currently displayed page (without the navigation controls). The `.md` export includes every page; stopping a recording clears them all. Deleting text on an earlier page leaves later pages in place.
- Click the bottom-right timestamp to switch between the live clock and a fixed manual date/time.
- Move the pointer over the camera to reveal Record, microphone, and mirror controls. Microphone audio is off by default.
- The optional scene-aware abstract treatment is local and its on/off choice is remembered. Facial geometry and the semantic mask are smoothed across frames; the edge-aware fallback continues while models load or when no face is visible. It can also be toggled while recording.
- Press **Command–B** or **Command–I** for bold or italic, **Command–Enter** to start or stop recording, or **Command–Shift–D** to edit the timestamp.
- On supported browsers, the first recording asks you to choose a save folder. Pick Downloads or any locally synced folder such as Dropbox; stopping writes the 1080×1920 video and matching `.md` file directly there, then clears the writing page.
- If folder access is unavailable or skipped, both files use normal browser downloads. The confirmation includes separate Video and Text retry buttons in case the browser blocks one of the two automatic downloads.

Wricord records WebM/VP8 in one-second chunks and gives the download a `.webm`
extension. If WebM is unavailable, Wricord stops immediately instead of
silently selecting an unverified recording path. YouTube accepts WebM; convert
to MP4 before uploading if another destination requires it.

## Browser compatibility

Current Chrome on macOS is the supported target. It provides the module Worker,
WebAssembly SIMD, `createImageBitmap`, folder access, and WebM recording used by
the complete scene-aware workflow. Safari compatibility is not currently a
release requirement and has not been verified for this version.

Confirm **REC WEBM** while recording. Automatic MP4 conversion is not
implemented.

Markdown support is intentionally lightweight, not a complete CommonMark implementation. Control–B/I also work for bold and italic. The app is primarily designed for macOS; other platforms have not been comprehensively tested.

## Export and troubleshooting

Stopping prepares a `.webm` video and `.md` snapshot with matching timestamped
names, then clears the page. Chrome can write them to a selected folder. A
folder managed by a Dropbox sync client works without any Dropbox integration.

If one download is blocked, click the corresponding **Video** or **Text** retry button in the confirmation before it disappears. The browser does not let the app confirm that an ordinary download completed. Closing/reloading the page discards the in-memory retry copies.

- Camera or audio missing: check website permissions and **System Settings → Privacy & Security → Camera / Microphone**. Microphone audio is off until enabled.
- Abstract person or face remains coarse: keep the head and shoulders reasonably well lit and visible, then wait a moment for both local vision models. Run `npm run setup:model` if the terminal reports that a model file is missing or invalid. Chrome uses GPU segmentation when available and automatically falls back to a slower held-frame CPU path.
- Old behavior after updating: run the server, refresh, and fully reopen installed windows. New recordings must show `REC WEBM` and end in `.webm`.
- Frozen video: keep the app visible and the Mac awake; report browser/macOS versions and the freeze time in an issue. Avoid attaching private recordings to public issues.
- Port already in use: stop the previous server or set another `PORT`.

### Optional WebM to MP4 conversion

Conversion is not built in. With a working [FFmpeg installation](https://ffmpeg.org/download.html), run:

```sh
ffmpeg -i recording.webm -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p -c:a aac -b:a 160k -movflags +faststart recording.mp4
```

This creates H.264/AAC MP4 while preserving the original WebM. Check your destination's current upload requirements.

## Privacy

Face analysis, camera composition, microphone audio, writing, and recording all
run on your Mac. Camera frames are analyzed in a local browser Worker and are
never uploaded. The local server only serves application files and does not
store recordings. A recording leaves browser memory only when you choose to
download it.

Initial `npm install` contacts the npm registry and the official Google-hosted
MediaPipe model URLs to obtain the pinned runtime and models. Normal app use is
same-origin: a restrictive Content Security Policy allows connections only to
the local Wricord origin, which also prevents the MediaPipe runtime's external
performance-metrics endpoint from receiving requests.

For the strongest privacy boundary, keep the server bound to its default `127.0.0.1` address and close the browser tab when you finish.

Drafts and preferences use local browser storage; clearing site data removes
them. App assets are cached for offline reuse. Wricord itself has no analytics
or remote account service. If you export into a synced folder, that
application's sync behavior applies.

## Development

Plain HTML, CSS, and JavaScript with one pinned browser dependency:
MediaPipe Tasks Vision 1.0.1. `src/face-worker.js` runs landmark and multiclass
segmentation inference away from the UI thread, `src/face-tracker.js` smooths
both result streams, `src/scene-geometry.js` performs edge analysis, connected
scene labelling, and rectangularization, and `src/camera-art.js` paints the
shared preview/recording canvas. `src/art-geometry.js` retains palette and
fallback helpers.
`src/recorder.js` handles capture, `src/compositor.js` draws the portrait output,
and `src/saver.js` writes exports. Run `npm test`; GitHub Actions runs these
tests on Linux and macOS. See [CONTRIBUTING.md](CONTRIBUTING.md) for browser
verification steps and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the
MediaPipe license.

## Legal

Copyright © 2026 Amin Ayub ([AminAyub](https://github.com/AminAyub)).

Wricord is **source-available for noncommercial use**, not an OSI-approved open-source project. The [Wricord Noncommercial License](LICENSE) permits noncommercial use, study, modification, and redistribution with the required notices.

**Any commercial or monetary use of any part of this codebase requires Amin Ayub's prior written permission.** This includes selling the software, incorporating it into paid products, running a paid hosted service, or making a closed-source commercial version. Publishing source code does not waive this restriction.

Contact [@AminAyub](https://github.com/AminAyub) through a repository issue to request permission; opening a request does not grant permission. The software comes without warranty. The LICENSE file contains the controlling terms.

The MediaPipe runtime, face-landmark model, and selfie-segmentation model are third-party Apache-2.0
components and retain their own upstream terms; Wricord's noncommercial license
does not replace those terms. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
