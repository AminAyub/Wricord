import test from "node:test";
import assert from "node:assert/strict";

import { markdownToHtml, renderInlineMarkdown } from "../src/markdown.js";

test("renders common inline Markdown and escapes raw HTML", () => {
  assert.equal(
    renderInlineMarkdown("**bold** and *italic* with `code` <script>"),
    "<strong>bold</strong> and <em>italic</em> with <code>code</code> &lt;script&gt;",
  );
});

test("renders headings, paragraphs, lists, quotes, and fenced code", () => {
  const markdown = [
    "# Heading",
    "",
    "A **bold** paragraph.",
    "",
    "- one",
    "- two",
    "",
    "> note",
    "",
    "```",
    "<safe>",
    "```",
  ].join("\n");

  assert.equal(
    markdownToHtml(markdown),
    "<h1>Heading</h1><p>A <strong>bold</strong> paragraph.</p><ul><li>one</li><li>two</li></ul><blockquote>note</blockquote><pre><code>&lt;safe&gt;</code></pre>",
  );
});

test("returns a usable empty editor block", () => {
  assert.equal(markdownToHtml(""), "<p><br></p>");
});
