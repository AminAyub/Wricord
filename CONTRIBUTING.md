# Contributing

Read the [license](LICENSE). Contributions are submitted under the same
license unless separately agreed in writing; contributors retain copyright.
Do not include code whose license is incompatible with these terms.

Open an issue for bugs or proposals. Include browser/macOS versions,
reproduction steps, expected behavior, and actual behavior. Do not publish
private recordings, writing, credentials, or personal information.

Run `npm test` before submitting a pull request. For editing, recording, or
export changes, also check current Chrome and Safari 18.4+ on macOS:

- Open localhost and allow the camera.
- Verify bold/italic shortcuts, headings, editing, scrolling, and draft restoration.
- Set a manual timestamp, then switch back to the live clock.
- Enable the microphone and record at least four minutes with camera motion
  and changing text. Confirm `REC WEBM` throughout.
- Inspect exported video at the start, middle, and end, including audio;
  check the Markdown snapshot and cleared writing page.
- In Chrome, test folder saving and skipped-folder downloads. In Safari,
  test downloads and individual retry buttons.
- Keep the app visible for the baseline test; record background limitations
  separately. Simulated time does not validate real browser encoders.

Keep runtime dependencies minimal and preserve local-only processing.
