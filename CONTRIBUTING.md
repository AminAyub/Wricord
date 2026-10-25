# Contributing

Read the [license](LICENSE). Contributions are submitted under the same
license unless separately agreed in writing; contributors retain copyright.
Do not include code whose license is incompatible with these terms.

Open an issue for bugs or proposals. Include browser/macOS versions,
reproduction steps, expected behavior, and actual behavior. Do not publish
private recordings, writing, credentials, or personal information.

Run `npm install` once and `npm test` before submitting a pull request. For
editing, recording, or export changes, also check current Chrome on macOS:

- Open localhost and allow the camera.
- Verify bold/italic shortcuts, headings, A4 page turns, page navigation, and draft restoration.
- Toggle the abstract camera treatment on and off. Confirm the full upper band
  is transformed; hair, face, neck, shoulders, and torso read as one connected
  subject; and a plain background resolves into substantially larger fields
  than detailed areas.
- Confirm the sparse face grammar stays recognizable while moving: one brow
  and two nested fields per eye, two nose fields, and two mouth fields. Check
  that hair remains attached rather than forming a floating face mask.
- Confirm mirroring remains correct, the deliberately stepped 10 fps artwork
  does not stall typing, related person structures use a coherent palette,
  distinct background structures contrast, and both camera modes match their
  recorded output.
- Set a manual timestamp, then switch back to the live clock.
- Enable the microphone and record at least four minutes with camera motion
  and changing text. Confirm `REC WEBM` throughout.
- Inspect exported video at the start, middle, and end, including audio;
  check the Markdown snapshot and cleared writing page.
- Test folder saving, skipped-folder downloads, and individual retry buttons.
- Keep the app visible for the baseline test; record background limitations
  separately. Simulated time does not validate real browser encoders.

Keep runtime dependencies minimal and preserve local-only processing. Browser
dependencies and models must be version-pinned, integrity-checked, served from
the explicit local allowlist, and recorded in `THIRD_PARTY_NOTICES.md`.
