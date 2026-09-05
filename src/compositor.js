export const OUTPUT_WIDTH = 1080;
export const OUTPUT_HEIGHT = 1920;

const CAMERA_FALLBACK = "#171918";
const PAPER_COLOR = "#f7f3e9";
const INK_COLOR = "#171816";
const BORDER_COLOR = "#a9d8ee";

function finitePositive(value, fallback) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function sourceDimensions(source) {
  return {
    width: Number(source?.videoWidth || source?.naturalWidth || source?.width || 0),
    height: Number(source?.videoHeight || source?.naturalHeight || source?.height || 0),
  };
}

function graphemes(value) {
  if (typeof Intl?.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return Array.from(segmenter.segment(value), ({ segment }) => segment);
  }

  return Array.from(value);
}

function breakLongWord(ctx, word, maxWidth) {
  const pieces = [];
  let piece = "";

  for (const character of graphemes(word)) {
    const candidate = piece + character;
    if (piece && ctx.measureText(candidate).width > maxWidth) {
      pieces.push(piece);
      piece = character;
    } else {
      piece = candidate;
    }
  }

  if (piece || pieces.length === 0) {
    pieces.push(piece);
  }

  return pieces;
}

/**
 * Draw an image or video with object-fit: cover semantics.
 * Returns false while a media source has no drawable dimensions.
 */
export function drawCover(ctx, source, rect, mirror = false) {
  const { width: sourceWidth, height: sourceHeight } = sourceDimensions(source);
  const x = Number(rect?.x || 0);
  const y = Number(rect?.y || 0);
  const width = Number(rect?.width || 0);
  const height = Number(rect?.height || 0);

  if (
    !ctx ||
    typeof ctx.drawImage !== "function" ||
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    width <= 0 ||
    height <= 0
  ) {
    return false;
  }

  const sourceAspect = sourceWidth / sourceHeight;
  const destinationAspect = width / height;
  let cropWidth = sourceWidth;
  let cropHeight = sourceHeight;
  let cropX = 0;
  let cropY = 0;

  if (sourceAspect > destinationAspect) {
    cropWidth = sourceHeight * destinationAspect;
    cropX = (sourceWidth - cropWidth) / 2;
  } else if (sourceAspect < destinationAspect) {
    cropHeight = sourceWidth / destinationAspect;
    cropY = (sourceHeight - cropHeight) / 2;
  }

  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();

    if (mirror) {
      ctx.translate(x + width, y);
      ctx.scale(-1, 1);
      ctx.drawImage(
        source,
        cropX,
        cropY,
        cropWidth,
        cropHeight,
        0,
        0,
        width,
        height,
      );
    } else {
      ctx.drawImage(
        source,
        cropX,
        cropY,
        cropWidth,
        cropHeight,
        x,
        y,
        width,
        height,
      );
    }
  } finally {
    ctx.restore();
  }

  return true;
}

/**
 * Draw an entire image or video centered with object-fit: contain semantics.
 * Returns false while a media source has no drawable dimensions.
 */
export function drawContain(ctx, source, rect, mirror = false) {
  const { width: sourceWidth, height: sourceHeight } = sourceDimensions(source);
  const x = Number(rect?.x || 0);
  const y = Number(rect?.y || 0);
  const width = Number(rect?.width || 0);
  const height = Number(rect?.height || 0);

  if (
    !ctx ||
    typeof ctx.drawImage !== "function" ||
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    width <= 0 ||
    height <= 0
  ) {
    return false;
  }

  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const destinationWidth = sourceWidth * scale;
  const destinationHeight = sourceHeight * scale;
  const destinationX = x + (width - destinationWidth) / 2;
  const destinationY = y + (height - destinationHeight) / 2;

  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();

    if (mirror) {
      ctx.translate(destinationX + destinationWidth, destinationY);
      ctx.scale(-1, 1);
      ctx.drawImage(
        source,
        0,
        0,
        sourceWidth,
        sourceHeight,
        0,
        0,
        destinationWidth,
        destinationHeight,
      );
    } else {
      ctx.drawImage(
        source,
        0,
        0,
        sourceWidth,
        sourceHeight,
        destinationX,
        destinationY,
        destinationWidth,
        destinationHeight,
      );
    }
  } finally {
    ctx.restore();
  }

  return true;
}

/**
 * Wrap plain textarea content to measured canvas lines while retaining explicit
 * line breaks. Words wider than the available measure are split by grapheme.
 */
export function wrapText(ctx, text, maxWidth) {
  if (!ctx || typeof ctx.measureText !== "function") {
    throw new TypeError("wrapText requires a 2D canvas context");
  }

  const paragraphs = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const width = Number(maxWidth);
  if (!Number.isFinite(width) || width <= 0) {
    return paragraphs;
  }

  const lines = [];

  for (const paragraph of paragraphs) {
    if (paragraph.length === 0) {
      lines.push("");
      continue;
    }

    const words = paragraph.trim().split(/\s+/u);
    if (words.length === 1 && words[0] === "") {
      lines.push("");
      continue;
    }

    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= width) {
        line = candidate;
        continue;
      }

      if (line) {
        lines.push(line);
        line = "";
      }

      if (ctx.measureText(word).width <= width) {
        line = word;
        continue;
      }

      const pieces = breakLongWord(ctx, word, width);
      lines.push(...pieces.slice(0, -1));
      line = pieces.at(-1) || "";
    }

    lines.push(line);
  }

  return lines;
}

function elementRect(element) {
  if (!element || typeof element.getBoundingClientRect !== "function") {
    return null;
  }

  const rect = element.getBoundingClientRect();
  if (!rect || !Number.isFinite(rect.width) || !Number.isFinite(rect.height)) {
    return null;
  }

  return rect;
}

function styleFor(element) {
  if (!element) {
    return null;
  }

  const view = element.ownerDocument?.defaultView;
  const getStyle = view?.getComputedStyle || globalThis.getComputedStyle;
  if (typeof getStyle !== "function") {
    return null;
  }

  try {
    return getStyle.call(view || globalThis, element);
  } catch {
    return null;
  }
}

function makeMapper(stage) {
  const rect = elementRect(stage);
  const stageWidth = rect?.width || stage?.clientWidth || OUTPUT_WIDTH;
  const stageHeight = rect?.height || stage?.clientHeight || OUTPUT_HEIGHT;
  const stageLeft = rect?.left || 0;
  const stageTop = rect?.top || 0;
  const scaleX = OUTPUT_WIDTH / stageWidth;
  const scaleY = OUTPUT_HEIGHT / stageHeight;

  return {
    scaleX,
    scaleY,
    clientRect(child, fallback) {
      if (!child || !Number.isFinite(child.width) || !Number.isFinite(child.height)) {
        return fallback;
      }

      return {
        x: (child.left - stageLeft) * scaleX,
        y: (child.top - stageTop) * scaleY,
        width: child.width * scaleX,
        height: child.height * scaleY,
      };
    },
    rect(element, fallback) {
      const child = elementRect(element);
      if (!child || child.width <= 0 || child.height <= 0) {
        return fallback;
      }

      return this.clientRect(child, fallback);
    },
  };
}

function intersect(rect, bounds) {
  if (!rect) {
    return null;
  }

  const left = Math.max(rect.x, bounds.x);
  const top = Math.max(rect.y, bounds.y);
  const right = Math.min(rect.x + rect.width, bounds.x + bounds.width);
  const bottom = Math.min(rect.y + rect.height, bounds.y + bounds.height);

  if (right <= left || bottom <= top) {
    return null;
  }

  return { x: left, y: top, width: right - left, height: bottom - top };
}

function closestOrQuery(element, stage, selector) {
  return element?.closest?.(selector) || stage?.querySelector?.(selector) || null;
}

function drawCameraBand(ctx, video, rect, mirror, sourceReady) {
  if (!rect) {
    return;
  }

  ctx.fillStyle = CAMERA_FALLBACK;
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);

  if (!sourceReady) {
    return;
  }

  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();
    // A dark blended camera fill is substantially cheaper and more stable for
    // long recordings than applying a full-resolution blur on every frame.
    drawCover(ctx, video, rect, mirror);
    ctx.fillStyle = "rgba(7, 10, 11, 0.58)";
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  } catch {
    // Keep the dark band if a camera frame becomes unavailable mid-render.
  } finally {
    ctx.restore();
  }

  try {
    drawContain(ctx, video, rect, mirror);
  } catch {
    // The blurred or dark camera band remains a stable fallback.
  }
}

function roundedRectPath(ctx, rect, radius) {
  const safeRadius = Math.max(0, Math.min(radius, rect.width / 2, rect.height / 2));
  ctx.beginPath();

  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(rect.x, rect.y, rect.width, rect.height, safeRadius);
    return;
  }

  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  ctx.moveTo(rect.x + safeRadius, rect.y);
  ctx.lineTo(right - safeRadius, rect.y);
  ctx.quadraticCurveTo(right, rect.y, right, rect.y + safeRadius);
  ctx.lineTo(right, bottom - safeRadius);
  ctx.quadraticCurveTo(right, bottom, right - safeRadius, bottom);
  ctx.lineTo(rect.x + safeRadius, bottom);
  ctx.quadraticCurveTo(rect.x, bottom, rect.x, bottom - safeRadius);
  ctx.lineTo(rect.x, rect.y + safeRadius);
  ctx.quadraticCurveTo(rect.x, rect.y, rect.x + safeRadius, rect.y);
  ctx.closePath();
}

function canvasFont(style, scaleY, defaults = {}) {
  const cssSize = finitePositive(style?.fontSize, defaults.size || 24);
  const size = cssSize * scaleY;
  const fontStyle = style?.fontStyle && style.fontStyle !== "normal" ? style.fontStyle : "";
  const weight = style?.fontWeight || defaults.weight || "400";
  const family = style?.fontFamily || defaults.family || '"Avenir Next", Avenir, sans-serif';
  return {
    cssSize,
    size,
    value: [fontStyle, weight, `${size}px`, family].filter(Boolean).join(" "),
  };
}

function drawEditorText(ctx, editor, editorRect, mapper) {
  const style = styleFor(editor);
  const font = canvasFont(style, mapper.scaleY, { size: 25, weight: "400" });
  const paddingLeft = finitePositive(style?.paddingLeft, 30) * mapper.scaleX;
  const paddingRight = finitePositive(style?.paddingRight, 30) * mapper.scaleX;
  const paddingTop = finitePositive(style?.paddingTop, 30) * mapper.scaleY;
  const paddingBottom = finitePositive(style?.paddingBottom, 30) * mapper.scaleY;
  const cssLineHeight = finitePositive(style?.lineHeight, font.cssSize * 1.55);
  const lineHeight = cssLineHeight * mapper.scaleY;
  const contentWidth = Math.max(1, editorRect.width - paddingLeft - paddingRight);
  const contentHeight = Math.max(1, editorRect.height - paddingTop - paddingBottom);
  const value = String(editor?.value ?? editor?.textContent ?? "");
  const scrollTop = Math.max(0, Number(editor?.scrollTop || 0)) * mapper.scaleY;

  ctx.save();
  ctx.beginPath();
  ctx.rect(
    editorRect.x + paddingLeft,
    editorRect.y + paddingTop,
    contentWidth,
    contentHeight,
  );
  ctx.clip();
  ctx.font = font.value;
  ctx.fillStyle = style?.color || INK_COLOR;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  if ("letterSpacing" in ctx && style?.letterSpacing && style.letterSpacing !== "normal") {
    ctx.letterSpacing = `${Number.parseFloat(style.letterSpacing) * mapper.scaleX}px`;
  }

  const lines = wrapText(ctx, value, contentWidth);
  const startX = editorRect.x + paddingLeft;
  const startY = editorRect.y + paddingTop - scrollTop;

  for (let index = 0; index < lines.length; index += 1) {
    const y = startY + index * lineHeight;
    if (y + lineHeight < editorRect.y || y > editorRect.y + editorRect.height) {
      continue;
    }
    ctx.fillText(lines[index], startX, y, contentWidth);
  }

  ctx.restore();
}

function drawRichToken(ctx, text, sourceRect, style, mapper) {
  const rect = mapper.clientRect(sourceRect, null);
  if (!rect || !text || rect.width <= 0 || rect.height <= 0) {
    return;
  }

  const font = canvasFont(style, mapper.scaleY, { size: 25, weight: "400" });
  ctx.font = font.value;
  ctx.fillStyle = style?.color || INK_COLOR;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  if ("letterSpacing" in ctx) {
    const spacing = Number.parseFloat(style?.letterSpacing);
    ctx.letterSpacing = Number.isFinite(spacing) ? `${spacing * mapper.scaleX}px` : "0px";
  }
  ctx.fillText(text.replaceAll("\u200b", ""), rect.x, rect.y, rect.width + font.size);
}

function drawListMarkers(ctx, editor, mapper) {
  for (const item of editor.querySelectorAll("li")) {
    const itemRect = elementRect(item);
    if (!itemRect) {
      continue;
    }
    const style = styleFor(item);
    const font = canvasFont(style, mapper.scaleY, { size: 25, weight: "400" });
    const ordered = item.parentElement?.tagName.toLowerCase() === "ol";
    const index = ordered ? Array.from(item.parentElement.children).indexOf(item) + 1 : 0;
    const marker = ordered ? `${index}.` : "•";
    const mapped = mapper.clientRect(itemRect, null);
    if (!mapped) {
      continue;
    }
    ctx.font = font.value;
    ctx.fillStyle = style?.color || INK_COLOR;
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText(marker, mapped.x - font.size * 0.34, mapped.y);
  }
}

function drawRichEditorText(ctx, editor, editorRect, mapper) {
  const document = editor.ownerDocument;
  const view = document?.defaultView;
  const NodeFilterCtor = view?.NodeFilter;
  if (!document?.createTreeWalker || !document?.createRange || !NodeFilterCtor) {
    drawEditorText(ctx, editor, editorRect, mapper);
    return;
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(editorRect.x, editorRect.y, editorRect.width, editorRect.height);
  ctx.clip();
  drawListMarkers(ctx, editor, mapper);

  const walker = document.createTreeWalker(editor, NodeFilterCtor.SHOW_TEXT);
  let textNode = walker.nextNode();
  while (textNode) {
    const value = textNode.data || "";
    const style = styleFor(textNode.parentElement || editor);
    const tokens = value.matchAll(/\S+/gu);

    for (const token of tokens) {
      const visibleText = token[0].replaceAll("\u200b", "");
      if (!visibleText) {
        continue;
      }
      const range = document.createRange();
      range.setStart(textNode, token.index);
      range.setEnd(textNode, token.index + token[0].length);
      const rects = Array.from(range.getClientRects());

      if (rects.length <= 1) {
        drawRichToken(ctx, visibleText, rects[0], style, mapper);
        continue;
      }

      // Only unusually long unbroken tokens span multiple lines. Split those
      // by grapheme so each fragment follows the browser's actual wrapping.
      let offset = token.index;
      for (const grapheme of graphemes(token[0])) {
        const end = offset + grapheme.length;
        range.setStart(textNode, offset);
        range.setEnd(textNode, end);
        drawRichToken(ctx, grapheme, range.getBoundingClientRect(), style, mapper);
        offset = end;
      }
    }

    textNode = walker.nextNode();
  }

  ctx.restore();
}

function timestampText(timestamp) {
  if (timestamp == null) {
    return "";
  }
  if (typeof timestamp === "string" || typeof timestamp === "number") {
    return String(timestamp);
  }
  return String(timestamp.textContent ?? timestamp.value ?? "").trim();
}

function drawTimestamp(ctx, timestamp, editorRect, mapper) {
  const text = timestampText(timestamp);
  if (!text) {
    return;
  }

  const timestampRect = mapper.rect(timestamp, null);
  const style = styleFor(typeof timestamp === "object" ? timestamp : null);
  const font = canvasFont(style, mapper.scaleY, { size: 13, weight: "500" });
  const fallbackInset = 30 * mapper.scaleX;

  ctx.save();
  ctx.font = font.value;
  ctx.fillStyle = style?.color || "#4d5555";
  ctx.textBaseline = "top";

  if (timestampRect) {
    const alignment = style?.textAlign;
    if (alignment === "right" || alignment === "end") {
      ctx.textAlign = "right";
      ctx.fillText(text, timestampRect.x + timestampRect.width, timestampRect.y);
    } else if (alignment === "center") {
      ctx.textAlign = "center";
      ctx.fillText(text, timestampRect.x + timestampRect.width / 2, timestampRect.y);
    } else {
      ctx.textAlign = "left";
      ctx.fillText(text, timestampRect.x, timestampRect.y);
    }
  } else {
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(
      text,
      editorRect.x + editorRect.width - fallbackInset,
      editorRect.y + editorRect.height - fallbackInset,
    );
  }

  ctx.restore();
}

/**
 * Render the visible portrait stage into a fixed 1080 x 1920 recording frame.
 */
export function renderComposition({
  canvas,
  stage,
  video,
  editor,
  timestamp,
  mirror = true,
} = {}) {
  if (!canvas || typeof canvas.getContext !== "function") {
    throw new TypeError("renderComposition requires a canvas");
  }

  if (canvas.width !== OUTPUT_WIDTH) {
    canvas.width = OUTPUT_WIDTH;
  }
  if (canvas.height !== OUTPUT_HEIGHT) {
    canvas.height = OUTPUT_HEIGHT;
  }

  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) {
    throw new Error("A 2D canvas context is unavailable");
  }

  const mapper = makeMapper(stage);
  const outputBounds = { x: 0, y: 0, width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT };
  const cameraPane = closestOrQuery(video, stage, ".camera-pane");
  const writingPane = closestOrQuery(editor, stage, ".writing-pane");
  const editorFrame =
    closestOrQuery(editor, stage, ".editor-frame") || editor?.parentElement || editor;
  const mappedEditor = mapper.rect(editorFrame, mapper.rect(editor, null));
  const mappedWriting = intersect(
    mapper.rect(writingPane, mappedEditor || outputBounds),
    outputBounds,
  );
  const mappedCamera = intersect(
    mapper.rect(cameraPane, mapper.rect(video, null)),
    outputBounds,
  );
  const splitY = Math.max(
    0,
    Math.min(
      OUTPUT_HEIGHT,
      Math.round(mappedWriting?.y ?? ((mappedCamera?.y || 0) + (mappedCamera?.height || 0))),
    ),
  );
  // The visible stage has a subtle outer border. Normalize its child rows to
  // the export edges so the encoded 9:16 frame never inherits a dark hairline.
  const cameraRect = { x: 0, y: 0, width: OUTPUT_WIDTH, height: splitY };
  const writingRect = {
    x: 0,
    y: splitY,
    width: OUTPUT_WIDTH,
    height: OUTPUT_HEIGHT - splitY,
  };
  const editorRect = mapper.rect(editorFrame, mappedEditor || writingRect);
  const textRect = mapper.rect(editor, editorRect);

  ctx.fillStyle = CAMERA_FALLBACK;
  ctx.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);

  const readyState = Number(video?.readyState);
  const sourceReady = !Number.isFinite(readyState) || readyState >= 2;
  drawCameraBand(ctx, video, cameraRect, Boolean(mirror), sourceReady);

  ctx.fillStyle = PAPER_COLOR;
  ctx.fillRect(writingRect.x, writingRect.y, writingRect.width, writingRect.height);

  const editorStyle = styleFor(editorFrame);
  const borderWidth = finitePositive(editorStyle?.borderTopWidth, 1) *
    ((mapper.scaleX + mapper.scaleY) / 2);
  const borderRadius = finitePositive(editorStyle?.borderTopLeftRadius, 16) *
    ((mapper.scaleX + mapper.scaleY) / 2);

  ctx.save();
  ctx.strokeStyle = editorStyle?.borderTopColor || BORDER_COLOR;
  ctx.lineWidth = Math.max(1, borderWidth);
  roundedRectPath(ctx, editorRect, borderRadius);
  ctx.stroke();
  ctx.restore();

  if (editor?.isContentEditable) {
    drawRichEditorText(ctx, editor, textRect, mapper);
  } else {
    drawEditorText(ctx, editor, textRect, mapper);
  }
  drawTimestamp(ctx, timestamp, editorRect, mapper);

  return canvas;
}
