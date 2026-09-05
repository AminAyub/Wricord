import test from "node:test";
import assert from "node:assert/strict";

import {
  formatTimestamp,
  parseLocalDateTime,
  recordingFilename,
  toDateInputValue,
  toTimeInputValue,
} from "../src/time.js";

test("formats a compact deterministic timestamp", () => {
  const date = new Date(2026, 8, 3, 4, 7, 9);
  assert.equal(formatTimestamp(date), "03 SEP 2026  ·  04:07");
});

test("converts a local date into form values", () => {
  const date = new Date(2026, 0, 9, 14, 5);
  assert.equal(toDateInputValue(date), "2026-01-09");
  assert.equal(toTimeInputValue(date), "14:05");
});

test("parses and validates manual local date/time values", () => {
  const date = parseLocalDateTime("2026-09-03", "14:58");
  assert.ok(date);
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 8);
  assert.equal(date.getDate(), 3);
  assert.equal(date.getHours(), 14);
  assert.equal(date.getMinutes(), 58);
  assert.equal(parseLocalDateTime("2026-02-30", "14:58"), null);
  assert.equal(parseLocalDateTime("not-a-date", "14:58"), null);
});

test("creates filesystem-friendly recording names", () => {
  const date = new Date(2026, 8, 3, 14, 58, 7);
  assert.equal(recordingFilename(date, "MP4"), "wricord-2026-09-03-145807.mp4");
});
