# Wricord

Wricord is a deliberately quiet, 9:16 writing recorder for a MacBook. It places a compact webcam strip above a DIN A4-proportioned writing surface and records the composed portrait scene for short-form video.

## Run locally

Install a supported [Node.js LTS release](https://nodejs.org/) (22 or newer recommended; minimum 20) and Git, then run:

```sh
git clone https://github.com/AminAyub/Wricord.git
cd Wricord
npm start
```

Open [http://localhost:4173](http://localhost:4173) in a current Safari or Chromium-based browser. There are no packages to install and no build step. To use another port, run `PORT=3000 npm start`.

Alternatively, use **Code → Download ZIP** on GitHub, extract it, open Terminal in that folder, and run `npm start`. Keep Terminal running; press Control–C there to stop the server. Do not open `index.html` directly.

To update a Git clone, run `git pull --ff-only`, restart the server, and refresh or fully reopen the app.

For an app-like Mac experience, use the browser’s **Add to Dock** or **Install App** command after opening Wricord once. The included web-app manifest and offline cache let the installed window reopen without browser chrome; run the local server again whenever the browser needs to refresh application files.

The camera and microphone APIs require a secure browser context. `localhost` is treated as secure by modern browsers, so use the localhost address printed by the server rather than opening `index.html` directly. Grant camera access when prompted; microphone access is only needed when audio recording is enabled.

Run the automated checks with:

```sh
npm test
```

## Recording and export

Start the camera, compose your text and timestamp, then start recording. The saved video contains the portrait composition rather than a screen capture of browser controls. The full camera frame stays sharp and undistorted in the compact top strip; darkened camera imagery fills the surrounding width.

The recorder is designed for sessions of at least four minutes. Keep Wricord visible while recording when possible; if the browser briefly suspends display animation, a separate frame watchdog keeps the portrait canvas moving and refreshes it when the app becomes visible again.

There is no application-imposed duration limit. Recordings stay in browser memory until export, so memory pressure, screen locking, and browser suspension can interrupt long sessions. The four-minute automated tests simulate scheduling and chunk retention; they do not validate a real browser encoder. Before important use, record four minutes with camera motion and changing text and inspect playback near the end.

- Type directly on the A4-proportioned lower page. Draft text is saved automatically in local browser storage and displayed as rich Markdown. Typed `**bold**`, `*italic*`, headings, lists, quotes, and code are supported.
- Click the bottom-right timestamp to switch between the live clock and a fixed manual date/time.
- Move the pointer over the camera to reveal Record, microphone, and mirror controls. Microphone audio is off by default.
- Press **Command–B** or **Command–I** for bold or italic, **Command–Enter** to start or stop recording, or **Command–Shift–D** to edit the timestamp.
- On supported browsers, the first recording asks you to choose a save folder. Pick Downloads or any locally synced folder such as Dropbox; stopping writes the 1080×1920 video and matching `.md` file directly there, then clears the writing page.
- If folder access is unavailable or skipped, both files use normal browser downloads. The confirmation includes separate Video and Text retry buttons in case the browser blocks one of the two automatic downloads.

Wricord records WebM/VP8 because current Safari MP4 recording can stop producing video after roughly 16 seconds or create corrupt long frame durations. WebM is safely collected in one-second chunks and the download receives a `.webm` extension. If WebM is unavailable, Wricord now stops immediately instead of silently creating an unreliable MP4. YouTube accepts WebM; convert to MP4 before uploading if another destination requires it.

## Chrome and Safari compatibility

| Capability | Current Chrome on macOS | Safari 18.4+ on macOS |
| --- | --- | --- |
| Webcam, optional microphone, writing, WebM recording | Supported | Supported |
| Choose a writable folder | Available where permitted | Uses browser downloads |
| Markdown export | Supported | Supported |
| Automatic MP4 conversion | Not implemented | Not implemented |

Safari added WebM recording in [Safari 18.4](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/). Use the latest browser available for your Mac. Confirm **REC WEBM** while recording. If WebM is unavailable, the app reports an error rather than falling back to unreliable MP4 capture.

Markdown support is intentionally lightweight, not a complete CommonMark implementation. Control–B/I also work for bold and italic. The app is primarily designed for macOS; other platforms have not been comprehensively tested.

## Export and troubleshooting

Stopping prepares a `.webm` video and `.md` snapshot with matching timestamped names, then clears the page. Chrome can write them to a selected folder; Safari uses its configured download destination, usually Downloads. A folder managed by a Dropbox sync client works without any Dropbox integration.

If one download is blocked, click the corresponding **Video** or **Text** retry button in the confirmation before it disappears. The browser does not let the app confirm that an ordinary download completed. Closing/reloading the page discards the in-memory retry copies.

- Camera or audio missing: check website permissions and **System Settings → Privacy & Security → Camera / Microphone**. Microphone audio is off until enabled.
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

Wricord runs entirely in your browser on your Mac. Camera frames, microphone audio, writing, and recordings are not uploaded or sent to a remote service. The local server only serves the application files and does not store recordings. A recording leaves browser memory only when you choose to download it.

For the strongest privacy boundary, keep the server bound to its default `127.0.0.1` address and close the browser tab when you finish.

Drafts and preferences use local browser storage; clearing site data removes them. App assets are cached for offline reuse. There are no analytics or remote account services. If you export into a synced folder, that application's sync behavior applies.

## Development

Plain HTML, CSS, and JavaScript; no runtime dependencies. `src/recorder.js` handles capture, `src/compositor.js` draws the portrait output, `src/markdown.js` handles formatting, and `src/saver.js` writes to supported folders. Run `npm test`; GitHub Actions runs these tests on Linux and macOS. See [CONTRIBUTING.md](CONTRIBUTING.md) for browser verification steps.

## Legal

Copyright © 2026 Amin Ayub ([AminAyub](https://github.com/AminAyub)).

Wricord is **source-available for noncommercial use**, not an OSI-approved open-source project. The [Wricord Noncommercial License](LICENSE) permits noncommercial use, study, modification, and redistribution with the required notices.

**Any commercial or monetary use of any part of this codebase requires Amin Ayub's prior written permission.** This includes selling the software, incorporating it into paid products, running a paid hosted service, or making a closed-source commercial version. Publishing source code does not waive this restriction.

Contact [@AminAyub](https://github.com/AminAyub) through a repository issue to request permission; opening a request does not grant permission. The software comes without warranty. The LICENSE file contains the controlling terms.
