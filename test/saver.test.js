import assert from "node:assert/strict";
import test from "node:test";

import { saveRecordingPair } from "../src/saver.js";

test("writes the video and Markdown as separate files", async () => {
  const written = [];
  const directory = {
    async getFileHandle(filename, options) {
      assert.deepEqual(options, { create: true });
      return {
        async createWritable() {
          return {
            async write(blob) {
              written.push([filename, await blob.text()]);
            },
            async close() {},
          };
        },
      };
    },
  };

  await saveRecordingPair(directory, {
    filename: "wricord.webm",
    blob: new Blob(["video"]),
    markdownFilename: "wricord.md",
    markdownBlob: new Blob(["# Notes"]),
  });

  assert.deepEqual(written, [
    ["wricord.webm", "video"],
    ["wricord.md", "# Notes"],
  ]);
});

test("rejects an invalid save destination", async () => {
  await assert.rejects(() => saveRecordingPair(null, {}), /writable recording folder/);
});
