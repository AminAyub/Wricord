// Pages keep their DOM nodes so formatting and selections survive navigation.
export class PagedEditor {
  constructor(editor, controls) {
    this.editor = editor;
    this.controls = controls;
    this.pages = [document.createElement("div")];
    this.index = 0;
    controls.previous.addEventListener("click", () => this.show(this.index - 1));
    controls.next.addEventListener("click", () => this.show(this.index + 1));
    this.updateControls();
  }

  stash() {
    this.pages[this.index].replaceChildren(...this.editor.childNodes);
  }

  show(index, focus = true) {
    if (index < 0 || index >= this.pages.length) return;
    this.stash();
    this.index = index;
    this.editor.replaceChildren(...this.pages[index].childNodes);
    this.editor.scrollTop = 0;
    this.updateControls();
    if (focus) this.editor.focus({ preventScroll: true });
  }

  updateControls() {
    this.controls.label.textContent = `${this.index + 1} / ${this.pages.length}`;
    this.controls.previous.disabled = this.index === 0;
    this.controls.next.disabled = this.index === this.pages.length - 1;
  }

  markdown(serialize) {
    return this.pages.map((page, index) =>
      serialize(index === this.index ? this.editor : page).trimEnd(),
    ).join("\n\n").trimEnd() + "\n";
  }

  reset() {
    this.pages = [document.createElement("div")];
    this.index = 0;
    this.editor.innerHTML = "<p><br></p>";
    this.editor.scrollTop = 0;
    this.updateControls();
  }

  // Find the first character whose line extends beyond the printable area.
  overflowPoint() {
    const editor = this.editor;
    editor.scrollTop = 0;
    const style = getComputedStyle(editor);
    const bottom = editor.getBoundingClientRect().bottom - parseFloat(style.paddingBottom);
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    const range = document.createRange();
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.TEXT_NODE && node.length) {
        range.selectNodeContents(node);
        if (range.getBoundingClientRect().bottom <= bottom + 0.5) continue;
        for (let offset = 0; offset < node.length; offset++) {
          range.setStart(node, offset);
          range.setEnd(node, offset + 1);
          if (range.getBoundingClientRect().bottom > bottom + 0.5) {
            return { node, offset };
          }
        }
      } else if (node.nodeName === "BR" && node.getBoundingClientRect().bottom > bottom + 0.5) {
        return { node: node.parentNode, offset: Array.from(node.parentNode.childNodes).indexOf(node) };
      }
    }
    return null;
  }

  paginate() {
    if (!this.editor.clientHeight) return;
    const originalIndex = this.index;
    const selection = window.getSelection();
    let marker = null;
    if (selection?.isCollapsed && selection.rangeCount && this.editor.contains(selection.anchorNode)) {
      marker = document.createElement("span");
      marker.dataset.pageCaret = "true";
      selection.getRangeAt(0).cloneRange().insertNode(marker);
    }
    let moved = false;
    // Each split consumes at least one line. Guard against unrenderable content.
    for (let count = 0; count < 1000; count++) {
      const point = this.overflowPoint();
      if (!point) break;
      // Move a whole block when its first character overflows, rather than
      // leaving an empty heading/list wrapper behind on the previous page.
      while (point.offset === 0 && point.node !== this.editor) {
        const child = point.node;
        point.node = child.parentNode;
        point.offset = Array.from(point.node.childNodes).indexOf(child);
      }
      const range = document.createRange();
      range.setStart(point.node, point.offset);
      range.setEnd(this.editor, this.editor.childNodes.length);
      const tail = range.extractContents();
      if (!this.editor.textContent.trim() && !this.editor.querySelector("br")) {
        this.editor.append(tail);
        break;
      }
      if (!this.pages[this.index + 1]) this.pages.push(document.createElement("div"));
      this.pages[this.index + 1].prepend(tail);
      this.show(this.index + 1, false);
      moved = true;
    }
    let target = originalIndex;
    if (marker) {
      target = this.editor.contains(marker) ? this.index : this.pages.findIndex(page => page.contains(marker));
      if (target < 0) target = originalIndex;
    }
    if (moved) this.show(target, false);
    if (marker?.isConnected) {
      const range = document.createRange();
      range.setStartBefore(marker);
      range.collapse(true);
      marker.remove();
      selection.removeAllRanges();
      selection.addRange(range);
    } else {
      marker?.remove();
    }
    this.editor.scrollTop = 0;
    this.updateControls();
  }
}
