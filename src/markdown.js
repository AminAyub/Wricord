const ZERO_WIDTH_SPACE = "\u200b";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderInlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*\*([^*\n]+)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
}

function renderParagraph(lines) {
  return `<p>${lines.map(renderInlineMarkdown).join("<br>")}</p>`;
}

export function markdownToHtml(markdown) {
  const lines = String(markdown ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let listType = null;
  let listItems = [];
  let codeFence = false;
  let codeLines = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push(renderParagraph(paragraph));
      paragraph = [];
    }
  };

  const flushList = () => {
    if (listType && listItems.length) {
      blocks.push(`<${listType}>${listItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</${listType}>`);
    }
    listType = null;
    listItems = [];
  };

  for (const line of lines) {
    if (/^```/.test(line)) {
      flushParagraph();
      flushList();
      if (codeFence) {
        blocks.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = [];
      }
      codeFence = !codeFence;
      continue;
    }

    if (codeFence) {
      codeLines.push(line);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    const unordered = line.match(/^[-+*]\s+(.+)$/);
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    const quote = line.match(/^>\s?(.*)$/);

    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
    } else if (unordered || ordered) {
      flushParagraph();
      const nextListType = unordered ? "ul" : "ol";
      if (listType && listType !== nextListType) {
        flushList();
      }
      listType = nextListType;
      listItems.push((unordered || ordered)[1]);
    } else if (quote) {
      flushParagraph();
      flushList();
      blocks.push(`<blockquote>${renderInlineMarkdown(quote[1])}</blockquote>`);
    } else if (line.trim() === "") {
      flushParagraph();
      flushList();
    } else {
      flushList();
      paragraph.push(line);
    }
  }

  if (codeFence) {
    blocks.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  }
  flushParagraph();
  flushList();

  return blocks.join("") || "<p><br></p>";
}

function cleanText(value) {
  return String(value).replaceAll(ZERO_WIDTH_SPACE, "").replaceAll("\u00a0", " ");
}

function inlineToMarkdown(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    return cleanText(node.nodeValue || "");
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }

  const tag = node.tagName.toLowerCase();
  const content = Array.from(node.childNodes, inlineToMarkdown).join("");

  if (tag === "strong" || tag === "b") {
    return content ? `**${content}**` : "";
  }
  if (tag === "em" || tag === "i") {
    return content ? `*${content}*` : "";
  }
  if (tag === "code") {
    return node.parentElement?.tagName.toLowerCase() === "pre" ? content : `\`${content}\``;
  }
  if (tag === "br") {
    return "\n";
  }
  if (tag === "a") {
    const href = node.getAttribute("href");
    return href ? `[${content}](${href})` : content;
  }

  return content;
}

function serializeList(list, ordered) {
  return Array.from(list.children)
    .filter((child) => child.tagName?.toLowerCase() === "li")
    .map((item, index) => `${ordered ? `${index + 1}.` : "-"} ${inlineToMarkdown(item).trim()}`)
    .join("\n");
}

function blockToMarkdown(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    return cleanText(node.nodeValue || "");
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }

  const tag = node.tagName.toLowerCase();
  const content = inlineToMarkdown(node).trim();

  if (/^h[1-6]$/.test(tag)) {
    return `${"#".repeat(Number(tag[1]))} ${content}`;
  }
  if (tag === "ul" || tag === "ol") {
    return serializeList(node, tag === "ol");
  }
  if (tag === "blockquote") {
    return content.split("\n").map((line) => `> ${line}`).join("\n");
  }
  if (tag === "pre") {
    return `\`\`\`\n${cleanText(node.textContent || "")}\n\`\`\``;
  }
  return content;
}

export function editorToMarkdown(editor) {
  if (!editor) {
    return "";
  }

  const markdown = Array.from(editor.childNodes, blockToMarkdown)
    .filter((block) => block !== "")
    .join("\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return markdown ? `${markdown}\n` : "";
}

function placeCaretAfter(node) {
  const selection = node.ownerDocument.defaultView.getSelection();
  if (!selection) {
    return;
  }
  const spacer = node.ownerDocument.createTextNode(ZERO_WIDTH_SPACE);
  node.after(spacer);
  const range = node.ownerDocument.createRange();
  range.setStart(spacer, spacer.data.length);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function placeCaretAtEnd(node) {
  const selection = node.ownerDocument.defaultView.getSelection();
  if (!selection) {
    return;
  }
  const range = node.ownerDocument.createRange();
  range.selectNodeContents(node);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function replaceTextWithElement(textNode, start, end, tagName, content) {
  const document = textNode.ownerDocument;
  const range = document.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, end);
  range.deleteContents();
  const element = document.createElement(tagName);
  element.textContent = content;
  range.insertNode(element);
  placeCaretAfter(element);
}

function textCaret(editor) {
  const selection = editor?.ownerDocument?.defaultView?.getSelection?.();
  if (!selection?.isCollapsed || !selection.anchorNode || !editor.contains(selection.anchorNode)) {
    return null;
  }
  if (selection.anchorNode.nodeType === Node.TEXT_NODE) {
    return { selection, textNode: selection.anchorNode, caret: selection.anchorOffset };
  }

  // Some contenteditable engines expose a collapsed caret on the containing
  // block rather than its text node. In that case the block's final text node
  // is the insertion point used for normal end-of-line typing.
  const block = currentEditableBlock(editor);
  const walker = editor.ownerDocument.createTreeWalker(
    block || selection.anchorNode,
    editor.ownerDocument.defaultView.NodeFilter.SHOW_TEXT,
  );
  let textNode = walker.nextNode();
  let lastTextNode = null;
  while (textNode) {
    lastTextNode = textNode;
    textNode = walker.nextNode();
  }
  return lastTextNode
    ? { selection, textNode: lastTextNode, caret: lastTextNode.data.length }
    : null;
}

export function applyInlineMarkdownShortcut(editor) {
  const position = textCaret(editor);
  const shortcuts = [
    { pattern: /\*\*([^*\n]+)\*\*$/, tag: "strong", contentIndex: 1, prefixIndex: null },
    { pattern: /(^|[^*])\*([^*\n]+)\*$/, tag: "em", contentIndex: 2, prefixIndex: 1 },
    { pattern: /`([^`\n]+)`$/, tag: "code", contentIndex: 1, prefixIndex: null },
  ];

  const applyAt = (textNode, caret) => {
    if (textNode.parentElement?.closest("strong, em, code")) {
      return false;
    }
    const beforeCaret = textNode.data.slice(0, caret);
    for (const shortcut of shortcuts) {
      const match = beforeCaret.match(shortcut.pattern);
      if (!match) {
        continue;
      }
      const prefixLength = shortcut.prefixIndex ? match[shortcut.prefixIndex].length : 0;
      const start = match.index + prefixLength;
      replaceTextWithElement(textNode, start, caret, shortcut.tag, match[shortcut.contentIndex]);
      return true;
    }
    return false;
  };

  if (position && applyAt(position.textNode, position.caret)) {
    return true;
  }

  // Contenteditable implementations can briefly report the caret on the
  // editor container during an input event. Scan backwards for the just-edited
  // text node so typed Markdown still converts immediately.
  const walker = editor.ownerDocument.createTreeWalker(
    editor,
    editor.ownerDocument.defaultView.NodeFilter.SHOW_TEXT,
  );
  const textNodes = [];
  let textNode = walker.nextNode();
  while (textNode) {
    textNodes.push(textNode);
    textNode = walker.nextNode();
  }
  for (let index = textNodes.length - 1; index >= 0; index -= 1) {
    if (applyAt(textNodes[index], textNodes[index].data.length)) {
      return true;
    }
  }

  // Browsers may split a contenteditable run across adjacent text nodes. If
  // the completed marker spans those nodes, rebuild the rich blocks from the
  // Markdown source while keeping the caret in the active block.
  const rawText = cleanText(editor.textContent || "");
  const hasCompleteMarker = /\*\*[^*\n]+\*\*|(^|[^*])\*[^*\n]+\*|`[^`\n]+`/m.test(rawText);
  if (hasCompleteMarker) {
    const activeBlock = currentEditableBlock(editor);
    const activeIndex = activeBlock
      ? Array.from(editor.children).indexOf(activeBlock)
      : editor.children.length - 1;
    const markdown = editorToMarkdown(editor);
    editor.innerHTML = markdownToHtml(markdown);
    const nextBlock = editor.children[Math.max(0, Math.min(activeIndex, editor.children.length - 1))];
    if (nextBlock) {
      placeCaretAtEnd(nextBlock);
    }
    return true;
  }

  return false;
}

export function applyInlineMarkdownKeystroke(editor, key) {
  if (key !== "*" && key !== "`") {
    return false;
  }
  const position = textCaret(editor);
  if (!position) {
    return false;
  }

  const { textNode, caret } = position;
  const beforeCaret = textNode.data.slice(0, caret);
  const shortcuts = key === "*"
    ? [
        { pattern: /\*\*([^*\r\n]+)\*$/, tag: "strong", contentIndex: 1, prefixIndex: null },
        { pattern: /(^|[^*])\*([^*\r\n]+)$/, tag: "em", contentIndex: 2, prefixIndex: 1 },
      ]
    : [{ pattern: /`([^`\r\n]+)$/, tag: "code", contentIndex: 1, prefixIndex: null }];

  for (const shortcut of shortcuts) {
    const match = beforeCaret.match(shortcut.pattern);
    if (!match) {
      continue;
    }
    const prefixLength = shortcut.prefixIndex ? match[shortcut.prefixIndex].length : 0;
    replaceTextWithElement(
      textNode,
      match.index + prefixLength,
      caret,
      shortcut.tag,
      match[shortcut.contentIndex],
    );
    return true;
  }

  return false;
}

export function toggleInlineFormat(editor, tagName) {
  const selection = editor?.ownerDocument?.defaultView?.getSelection?.();
  if (!selection?.rangeCount || !selection.anchorNode || !editor.contains(selection.anchorNode)) {
    return false;
  }

  if (selection.isCollapsed) {
    return editor.ownerDocument.execCommand(tagName === "strong" ? "bold" : "italic");
  }

  const range = selection.getRangeAt(0);
  const element = editor.ownerDocument.createElement(tagName);
  element.append(range.extractContents());
  range.insertNode(element);
  placeCaretAfter(element);
  return true;
}

function currentEditableBlock(editor) {
  const selection = editor?.ownerDocument?.defaultView?.getSelection?.();
  let node = selection?.anchorNode;
  if (!node || !editor.contains(node)) {
    return null;
  }
  if (node === editor) {
    const childIndex = Math.max(
      0,
      Math.min(selection.anchorOffset - 1, editor.childNodes.length - 1),
    );
    node = editor.childNodes[childIndex] || null;
    if (!node) {
      return null;
    }
  }
  if (node.nodeType === Node.TEXT_NODE) {
    node = node.parentElement;
  }
  while (node && node.parentElement !== editor) {
    node = node.parentElement;
  }
  return node && node !== editor ? node : null;
}

function focusEmptyBlock(block) {
  block.replaceChildren(block.ownerDocument.createElement("br"));
  const selection = block.ownerDocument.defaultView.getSelection();
  const range = block.ownerDocument.createRange();
  range.setStart(block, 0);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function applyBlockMarkdownShortcut(editor, key) {
  if (key !== " ") {
    return false;
  }
  const block = currentEditableBlock(editor);
  if (!block) {
    return false;
  }

  const marker = cleanText(block.textContent || "");
  const heading = marker.match(/^(#{1,6})$/);
  const document = editor.ownerDocument;
  let replacement = null;

  if (heading) {
    replacement = document.createElement(`h${heading[1].length}`);
  } else if (/^[-+*]$/.test(marker)) {
    replacement = document.createElement("ul");
    replacement.append(document.createElement("li"));
    block.replaceWith(replacement);
    focusEmptyBlock(replacement.firstElementChild);
    return true;
  } else if (/^1[.)]$/.test(marker)) {
    replacement = document.createElement("ol");
    replacement.append(document.createElement("li"));
    block.replaceWith(replacement);
    focusEmptyBlock(replacement.firstElementChild);
    return true;
  } else if (marker === ">") {
    replacement = document.createElement("blockquote");
  }

  if (!replacement) {
    return false;
  }

  block.replaceWith(replacement);
  focusEmptyBlock(replacement);
  return true;
}

export function exitFormattedBlockOnEnter(editor, key) {
  if (key !== "Enter") {
    return false;
  }
  const block = currentEditableBlock(editor);
  if (!block || !/^h[1-6]$/i.test(block.tagName)) {
    return false;
  }

  const paragraph = editor.ownerDocument.createElement("p");
  block.after(paragraph);
  focusEmptyBlock(paragraph);
  return true;
}

export function resetRichEditor(editor) {
  editor.innerHTML = "<p><br></p>";
}
