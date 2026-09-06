import test from "node:test";
import assert from "node:assert/strict";
import { PagedEditor } from "../src/pages.js";

test("Markdown includes every page and uses the live edited page", () => {
  const pages = Object.assign(Object.create(PagedEditor.prototype), {
    pages: ["first", "stale middle", "last"],
    editor: "edited middle",
    index: 1,
  });
  assert.equal(pages.markdown(value => value), "first\n\nedited middle\n\nlast\n");
});

test("navigation disables only the appropriate page boundary", () => {
  const pages = Object.assign(Object.create(PagedEditor.prototype), {
    pages: [{}, {}, {}], index: 0,
    controls: { previous: {}, next: {}, label: {} },
  });
  pages.updateControls();
  assert.equal(pages.controls.previous.disabled, true);
  assert.equal(pages.controls.next.disabled, false);
  pages.index = 1;
  pages.updateControls();
  assert.equal(pages.controls.label.textContent, "2 / 3");
  assert.equal(pages.controls.previous.disabled, false);
  assert.equal(pages.controls.next.disabled, false);
  pages.index = 2;
  pages.updateControls();
  assert.equal(pages.controls.next.disabled, true);
});

test("out-of-range navigation leaves the active page untouched", () => {
  const pages = Object.assign(Object.create(PagedEditor.prototype), {
    pages: [{}], index: 0,
    stash() { assert.fail("must not mutate a page for invalid navigation"); },
  });
  pages.show(-1);
  pages.show(1);
  assert.equal(pages.index, 0);
});
