// Pure geometry, image-analysis, and palette helpers for the live camera painter.

export const ART_PALETTE_FAMILIES = Object.freeze({
  ink: Object.freeze(["#111217", "#24232d", "#3a3444"]),
  paper: Object.freeze(["#bda976", "#dfcea4", "#f2e7cb", "#fff4d8"]),
  vermilion: Object.freeze(["#741d25", "#a92b2d", "#d44835", "#ef7046"]),
  gold: Object.freeze(["#76590f", "#ad8215", "#ddb627", "#f2d55b"]),
  teal: Object.freeze(["#123b3d", "#1d5c59", "#327d70", "#6ba08a"]),
  cobalt: Object.freeze(["#14275d", "#1c438b", "#2e66b0", "#7191c2"]),
  violet: Object.freeze(["#46203f", "#702b55", "#a23c65", "#cf6883"]),
});

export const ABSTRACT_PALETTE = Object.freeze(
  Object.values(ART_PALETTE_FAMILIES).flat(),
);

const BACKGROUND_FAMILIES = Object.freeze([
  "vermilion",
  "cobalt",
  "gold",
  "teal",
  "violet",
  "paper",
]);
const DEFAULT_SEED = 0x4d4f4e44;

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function seededRandom(seed) {
  let state = Number(seed) >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(value, seed = DEFAULT_SEED) {
  let hash = Number(seed) >>> 0;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function normalizedChannel(value) {
  return clamp(Number(value) || 0, 0, 255) / 255;
}

export function pixelLuminance(red, green, blue) {
  return normalizedChannel(red) * 0.2126 +
    normalizedChannel(green) * 0.7152 +
    normalizedChannel(blue) * 0.0722;
}

function saturationForColor(red, green, blue) {
  const r = normalizedChannel(red);
  const g = normalizedChannel(green);
  const b = normalizedChannel(blue);
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  const delta = maximum - minimum;
  const lightness = (maximum + minimum) / 2;
  return delta === 0 ? 0 : delta / Math.max(0.001, 1 - Math.abs(2 * lightness - 1));
}

/** Deterministic centre-weighted fallback used before a readable frame exists. */
export function createAdaptiveRectangles(width, height, seed = DEFAULT_SEED) {
  const canvasWidth = Math.max(1, Math.round(Number(width) || 1));
  const canvasHeight = Math.max(1, Math.round(Number(height) || 1));
  const random = seededRandom(seed);
  const minimumTarget = Math.max(7, Math.min(canvasWidth, canvasHeight) * 0.042);
  const maximumTarget = minimumTarget * 5.2;
  const pending = [{ x: 0, y: 0, width: canvasWidth, height: canvasHeight }];
  const rectangles = [];

  while (pending.length) {
    const rectangle = pending.pop();
    const centreX = rectangle.x + rectangle.width / 2;
    const centreY = rectangle.y + rectangle.height / 2;
    const normalizedX = (centreX / canvasWidth - 0.5) * 2;
    const normalizedY = (centreY / canvasHeight - 0.5) * 2;
    const distance = Math.min(1, Math.hypot(normalizedX, normalizedY) / Math.SQRT2);
    const target = minimumTarget +
      (maximumTarget - minimumTarget) * Math.pow(distance, 1.45);
    const widthPressure = rectangle.width / (target * (0.82 + random() * 0.76));
    const heightPressure = rectangle.height / (target * (0.68 + random() * 0.7));
    const room = rectangles.length + pending.length + 2 <= 680;
    const splitWidth = rectangle.width >= Math.ceil(minimumTarget * 1.35) * 2 &&
      widthPressure > 1.22;
    const splitHeight = rectangle.height >= Math.ceil(minimumTarget * 1.2) * 2 &&
      heightPressure > 1.22;

    if (!room || (!splitWidth && !splitHeight)) {
      rectangles.push({
        ...rectangle,
        id: `fallback-${rectangles.length}`,
        family: "ink",
      });
      continue;
    }

    const splitOnX = splitWidth && splitHeight
      ? widthPressure / heightPressure > 1.16 || random() > 0.5
      : splitWidth;
    const dimension = splitOnX ? rectangle.width : rectangle.height;
    const minimumPart = Math.max(2, Math.floor(minimumTarget * 0.55));
    const cut = clamp(
      Math.round(dimension * (0.36 + random() * 0.28)),
      minimumPart,
      dimension - minimumPart,
    );

    if (splitOnX) {
      pending.push({
        x: rectangle.x + cut,
        y: rectangle.y,
        width: rectangle.width - cut,
        height: rectangle.height,
      });
      pending.push({ x: rectangle.x, y: rectangle.y, width: cut, height: rectangle.height });
    } else {
      pending.push({
        x: rectangle.x,
        y: rectangle.y + cut,
        width: rectangle.width,
        height: rectangle.height - cut,
      });
      pending.push({ x: rectangle.x, y: rectangle.y, width: rectangle.width, height: cut });
    }
  }
  return rectangles;
}

/** Compatibility quantizer. Live art uses structure families, not source hue. */
export function paletteIndexForColor(red, green, blue) {
  const lightness = pixelLuminance(red, green, blue);
  const saturation = saturationForColor(red, green, blue);
  if (lightness < 0.12) return ABSTRACT_PALETTE.indexOf(ART_PALETTE_FAMILIES.ink[0]);
  if (lightness > 0.84 && saturation < 0.28) {
    return ABSTRACT_PALETTE.indexOf(ART_PALETTE_FAMILIES.paper[2]);
  }

  const r = normalizedChannel(red);
  const g = normalizedChannel(green);
  const b = normalizedChannel(blue);
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  const delta = maximum - minimum;
  let hue = 0;
  if (delta > 0) {
    if (maximum === r) hue = 60 * (((g - b) / delta) % 6);
    else if (maximum === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }
  if (hue < 0) hue += 360;
  const family = hue < 35 || hue >= 340
    ? "vermilion"
    : hue < 78
      ? "gold"
      : hue < 178
        ? "teal"
        : hue < 268
          ? "cobalt"
          : "violet";
  const colors = ART_PALETTE_FAMILIES[family];
  return ABSTRACT_PALETTE.indexOf(
    colors[clamp(Math.round(lightness * (colors.length - 1)), 0, colors.length - 1)],
  );
}

export function quantizeColor(red, green, blue) {
  return ABSTRACT_PALETTE[paletteIndexForColor(red, green, blue)];
}

export function dominantPaletteColor(samples) {
  const votes = new Float32Array(ABSTRACT_PALETTE.length);
  for (const [red, green, blue] of samples || []) {
    const index = paletteIndexForColor(red, green, blue);
    votes[index] += 1 + saturationForColor(red, green, blue) * 1.35;
  }
  let winner = 0;
  for (let index = 1; index < votes.length; index += 1) {
    if (votes[index] > votes[winner]) winner = index;
  }
  return ABSTRACT_PALETTE[winner];
}

function pixelOffset(width, x, y) {
  return (Math.max(0, y) * width + clamp(x, 0, width - 1)) * 4;
}

export function analyzePixelRegion(pixels, sampleWidth, sampleHeight, region) {
  const startX = clamp(Math.floor(region.x), 0, Math.max(0, sampleWidth - 1));
  const startY = clamp(Math.floor(region.y), 0, Math.max(0, sampleHeight - 1));
  const endX = clamp(Math.ceil(region.x + region.width), startX + 1, sampleWidth);
  const endY = clamp(Math.ceil(region.y + region.height), startY + 1, sampleHeight);
  const step = Math.max(1, Math.floor(Math.min(endX - startX, endY - startY) / 7));
  let count = 0;
  let sumRed = 0;
  let sumGreen = 0;
  let sumBlue = 0;
  let sumLight = 0;
  let sumLightSquared = 0;
  let minLight = 1;
  let maxLight = 0;
  let minRed = 255;
  let maxRed = 0;
  let minGreen = 255;
  let maxGreen = 0;
  let minBlue = 255;
  let maxBlue = 0;
  let edgeTotal = 0;
  let edgeCount = 0;

  for (let y = startY; y < endY; y += step) {
    let previousLight = null;
    for (let x = startX; x < endX; x += step) {
      const offset = pixelOffset(sampleWidth, x, y);
      const red = pixels[offset] || 0;
      const green = pixels[offset + 1] || 0;
      const blue = pixels[offset + 2] || 0;
      const light = pixelLuminance(red, green, blue);
      sumRed += red;
      sumGreen += green;
      sumBlue += blue;
      sumLight += light;
      sumLightSquared += light * light;
      minLight = Math.min(minLight, light);
      maxLight = Math.max(maxLight, light);
      minRed = Math.min(minRed, red);
      maxRed = Math.max(maxRed, red);
      minGreen = Math.min(minGreen, green);
      maxGreen = Math.max(maxGreen, green);
      minBlue = Math.min(minBlue, blue);
      maxBlue = Math.max(maxBlue, blue);
      if (previousLight != null) {
        edgeTotal += Math.abs(light - previousLight);
        edgeCount += 1;
      }
      if (y - step >= startY) {
        const above = pixelOffset(sampleWidth, x, y - step);
        edgeTotal += Math.abs(light - pixelLuminance(
          pixels[above] || 0,
          pixels[above + 1] || 0,
          pixels[above + 2] || 0,
        ));
        edgeCount += 1;
      }
      previousLight = light;
      count += 1;
    }
  }

  const safeCount = Math.max(1, count);
  const meanLuminance = sumLight / safeCount;
  const deviation = Math.sqrt(Math.max(0, sumLightSquared / safeCount - meanLuminance ** 2));
  const channelSpread = ((maxRed - minRed) + (maxGreen - minGreen) + (maxBlue - minBlue)) /
    (255 * 3);
  const edgeEnergy = edgeTotal / Math.max(1, edgeCount);
  return {
    red: sumRed / safeCount,
    green: sumGreen / safeCount,
    blue: sumBlue / safeCount,
    luminance: meanLuminance,
    saturation: saturationForColor(
      sumRed / safeCount,
      sumGreen / safeCount,
      sumBlue / safeCount,
    ),
    deviation,
    edgeEnergy,
    detail: deviation * 1.7 + (maxLight - minLight) * 0.24 +
      channelSpread * 0.22 + edgeEnergy * 0.75,
  };
}

function colorDistance(first, second) {
  return Math.hypot(
    first.red - second.red,
    first.green - second.green,
    first.blue - second.blue,
  ) / 441.673;
}

function candidateSplit(pixels, sampleWidth, sampleHeight, node, axis, fraction) {
  const dimension = axis === "x" ? node.width : node.height;
  const cut = clamp(Math.round(dimension * fraction), 1, dimension - 1);
  const first = axis === "x"
    ? { x: node.x, y: node.y, width: cut, height: node.height }
    : { x: node.x, y: node.y, width: node.width, height: cut };
  const second = axis === "x"
    ? { x: node.x + cut, y: node.y, width: node.width - cut, height: node.height }
    : { x: node.x, y: node.y + cut, width: node.width, height: node.height - cut };
  const firstStats = analyzePixelRegion(pixels, sampleWidth, sampleHeight, first);
  const secondStats = analyzePixelRegion(pixels, sampleWidth, sampleHeight, second);
  return {
    first,
    second,
    score: colorDistance(firstStats, secondStats) +
      Math.abs(firstStats.luminance - secondStats.luminance) * 0.8 +
      Math.min(cut, dimension - cut) / Math.max(cut, dimension - cut) * 0.035,
  };
}

function findBestSplit(pixels, sampleWidth, sampleHeight, node, minimumWidth, minimumHeight) {
  const axes = [];
  if (node.width >= minimumWidth * 2) axes.push("x");
  if (node.height >= minimumHeight * 2) axes.push("y");
  let best = null;
  for (const axis of axes) {
    const pressure = axis === "x"
      ? node.width / Math.max(1, node.height)
      : node.height / Math.max(1, node.width);
    for (const fraction of [0.34, 0.5, 0.66]) {
      const candidate = candidateSplit(
        pixels,
        sampleWidth,
        sampleHeight,
        node,
        axis,
        fraction,
      );
      candidate.score += Math.min(1.5, pressure) * 0.018;
      if (!best || candidate.score > best.score) best = candidate;
    }
  }
  return best;
}

function rectanglesTouch(first, second) {
  const verticalEdge = Math.abs(first.x + first.width - second.x) <= 1 ||
    Math.abs(second.x + second.width - first.x) <= 1;
  const horizontalOverlap = Math.min(first.y + first.height, second.y + second.height) -
    Math.max(first.y, second.y);
  const horizontalEdge = Math.abs(first.y + first.height - second.y) <= 1 ||
    Math.abs(second.y + second.height - first.y) <= 1;
  const verticalOverlap = Math.min(first.x + first.width, second.x + second.width) -
    Math.max(first.x, second.x);
  return (verticalEdge && horizontalOverlap > 0) || (horizontalEdge && verticalOverlap > 0);
}

function overlapArea(first, second) {
  const width = Math.min(first.x + first.width, second.x + second.width) -
    Math.max(first.x, second.x);
  const height = Math.min(first.y + first.height, second.y + second.height) -
    Math.max(first.y, second.y);
  return Math.max(0, width) * Math.max(0, height);
}

function familyDistance(first, second) {
  if (first === second) return 0;
  if (first === "paper" || second === "paper") return 3;
  const wheel = ["vermilion", "gold", "teal", "cobalt", "violet"];
  const direct = Math.abs(wheel.indexOf(first) - wheel.indexOf(second));
  return Math.min(direct, wheel.length - direct);
}

function assignStructureFamilies(rectangles, seed) {
  const parents = rectangles.map((_, index) => index);
  const find = input => {
    let index = input;
    while (parents[index] !== index) index = parents[index];
    const root = index;
    index = input;
    while (parents[index] !== index) {
      const next = parents[index];
      parents[index] = root;
      index = next;
    }
    return root;
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };

  for (let left = 0; left < rectangles.length; left += 1) {
    for (let right = left + 1; right < rectangles.length; right += 1) {
      const first = rectangles[left];
      const second = rectangles[right];
      if (
        rectanglesTouch(first, second) &&
        colorDistance(first.stats, second.stats) < 0.115 &&
        Math.abs(first.stats.luminance - second.stats.luminance) < 0.09
      ) union(left, right);
    }
  }

  const components = new Map();
  rectangles.forEach((rectangle, index) => {
    const root = find(index);
    if (!components.has(root)) {
      components.set(root, { root, indices: [], area: 0, neighbours: new Set(), family: null });
    }
    const component = components.get(root);
    component.indices.push(index);
    component.area += rectangle.width * rectangle.height;
  });
  for (let left = 0; left < rectangles.length; left += 1) {
    for (let right = left + 1; right < rectangles.length; right += 1) {
      if (!rectanglesTouch(rectangles[left], rectangles[right])) continue;
      const leftRoot = find(left);
      const rightRoot = find(right);
      if (leftRoot !== rightRoot) {
        components.get(leftRoot).neighbours.add(rightRoot);
        components.get(rightRoot).neighbours.add(leftRoot);
      }
    }
  }

  const ordered = [...components.values()].sort((left, right) => right.area - left.area);
  for (const component of ordered) {
    const sample = rectangles[component.indices[0]];
    const preferredIndex = hashString(
      `${sample.id}:${Math.round(sample.stats.luminance * 5)}:` +
      `${Math.round(sample.stats.saturation * 3)}`,
      seed,
    ) % BACKGROUND_FAMILIES.length;
    const neighbours = [...component.neighbours]
      .map(root => components.get(root)?.family)
      .filter(Boolean);
    let bestFamily = BACKGROUND_FAMILIES[preferredIndex];
    let bestScore = -Infinity;
    for (let offset = 0; offset < BACKGROUND_FAMILIES.length; offset += 1) {
      const family = BACKGROUND_FAMILIES[(preferredIndex + offset) % BACKGROUND_FAMILIES.length];
      const score = neighbours.reduce(
        (total, neighbour) => total + familyDistance(family, neighbour) * 2,
        0,
      ) - offset * 0.12;
      if (score > bestScore) {
        bestScore = score;
        bestFamily = family;
      }
    }
    component.family = bestFamily;
    for (const index of component.indices) {
      rectangles[index].family = bestFamily;
      rectangles[index].structureId = component.root;
    }
  }
  return rectangles;
}

/** Uniform regions remain large; edges and texture recursively become smaller. */
export function createContentAwareRectangles(
  pixels,
  sampleWidth,
  sampleHeight,
  artWidth,
  artHeight,
  { seed = DEFAULT_SEED, maximumTiles = 210 } = {},
) {
  if (!pixels || sampleWidth < 1 || sampleHeight < 1 || artWidth < 1 || artHeight < 1) {
    return [];
  }
  const minimumWidth = Math.max(4, Math.round(sampleWidth * 0.027));
  const minimumHeight = Math.max(3, Math.round(sampleHeight * 0.045));
  const pending = [{
    x: 0,
    y: 0,
    width: sampleWidth,
    height: sampleHeight,
    depth: 0,
    id: "r",
  }];
  const leaves = [];

  while (pending.length) {
    const node = pending.pop();
    const stats = analyzePixelRegion(pixels, sampleWidth, sampleHeight, node);
    const sizeRatio = Math.max(node.width / sampleWidth, node.height / sampleHeight);
    const threshold = 0.055 + node.depth * 0.012;
    const wantsSplit = stats.detail > threshold || (sizeRatio > 0.48 && stats.detail > 0.027);
    const room = leaves.length + pending.length + 2 <= maximumTiles;
    const canSplit = node.depth < 8 && room &&
      (node.width >= minimumWidth * 2 || node.height >= minimumHeight * 2);

    if (!canSplit || !wantsSplit) {
      const x = Math.round(node.x / sampleWidth * artWidth);
      const y = Math.round(node.y / sampleHeight * artHeight);
      const right = Math.round((node.x + node.width) / sampleWidth * artWidth);
      const bottom = Math.round((node.y + node.height) / sampleHeight * artHeight);
      leaves.push({
        x,
        y,
        width: Math.max(1, right - x),
        height: Math.max(1, bottom - y),
        sampleX: node.x,
        sampleY: node.y,
        sampleWidth: node.width,
        sampleHeight: node.height,
        id: node.id,
        stats,
        family: "ink",
      });
      continue;
    }

    const split = findBestSplit(
      pixels,
      sampleWidth,
      sampleHeight,
      node,
      minimumWidth,
      minimumHeight,
    );
    if (!split) {
      pending.push({ ...node, depth: 8 });
      continue;
    }
    pending.push({ ...split.second, depth: node.depth + 1, id: `${node.id}b` });
    pending.push({ ...split.first, depth: node.depth + 1, id: `${node.id}a` });
  }
  return assignStructureFamilies(leaves, seed);
}

/**
 * Carry palette identities across nearby layout rebuilds. Geometry may adapt to
 * a moving boundary, but a persistent wall or shirt should not suddenly jump
 * from one color family to another because of a few noisy camera pixels.
 */
export function stabilizeStructureFamilies(nextRectangles, previousRectangles) {
  if (!nextRectangles?.length || !previousRectangles?.some(rectangle => rectangle.stats)) {
    return nextRectangles || [];
  }
  const groups = new Map();
  for (const rectangle of nextRectangles) {
    const id = rectangle.structureId ?? rectangle.id;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(rectangle);
  }

  for (const rectangles of groups.values()) {
    const familyScores = new Map();
    for (const rectangle of rectangles) {
      for (const previous of previousRectangles) {
        if (!previous.family || !previous.stats) continue;
        const overlap = overlapArea(rectangle, previous);
        if (overlap <= 0 || colorDistance(rectangle.stats, previous.stats) >= 0.22) continue;
        familyScores.set(
          previous.family,
          (familyScores.get(previous.family) || 0) + overlap,
        );
      }
    }
    let retainedFamily = null;
    let retainedScore = 0;
    for (const [family, score] of familyScores) {
      if (score > retainedScore) {
        retainedFamily = family;
        retainedScore = score;
      }
    }
    if (retainedFamily) {
      for (const rectangle of rectangles) rectangle.family = retainedFamily;
    }
  }
  return nextRectangles;
}

function videoContainTransform(sourceWidth, sourceHeight, artWidth, artHeight) {
  const scale = Math.min(artWidth / sourceWidth, artHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    x: (artWidth - width) / 2,
    y: (artHeight - height) / 2,
    width,
    height,
  };
}

function mapNormalizedBox(box, transform, mirror) {
  if (!box) return null;
  const firstX = transform.x + (mirror ? 1 - box.x : box.x) * transform.width;
  const secondX = transform.x +
    (mirror ? 1 - box.x - box.width : box.x + box.width) * transform.width;
  return {
    x: Math.min(firstX, secondX),
    y: transform.y + box.y * transform.height,
    width: Math.abs(secondX - firstX),
    height: box.height * transform.height,
  };
}

export function mapFaceToArtwork(
  face,
  sourceWidth,
  sourceHeight,
  artWidth,
  artHeight,
  mirror = false,
) {
  if (!face?.bbox || sourceWidth <= 0 || sourceHeight <= 0) return null;
  const transform = videoContainTransform(sourceWidth, sourceHeight, artWidth, artHeight);
  const features = {};
  for (const [name, box] of Object.entries(face.features || {})) {
    features[name] = mapNormalizedBox(box, transform, mirror);
  }
  return {
    bbox: mapNormalizedBox(face.bbox, transform, mirror),
    features,
    detectedAt: face.detectedAt,
  };
}

function expandedBox(box, horizontal, vertical = horizontal) {
  if (!box) return null;
  return {
    x: box.x - box.width * horizontal,
    y: box.y - box.height * vertical,
    width: box.width * (1 + horizontal * 2),
    height: box.height * (1 + vertical * 2),
  };
}

function appendGrid(tiles, box, columns, rows, kind, idPrefix) {
  if (!box || box.width <= 0 || box.height <= 0) return;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const left = box.x + box.width * column / columns;
      const top = box.y + box.height * row / rows;
      const right = box.x + box.width * (column + 1) / columns;
      const bottom = box.y + box.height * (row + 1) / rows;
      tiles.push({
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
        kind,
        id: `${idPrefix}-${row}-${column}`,
      });
    }
  }
}

/** Face-local grids move and scale with the smoothed landmark boxes. */
export function createTrackedFaceRectangles(mappedFace) {
  const face = mappedFace?.bbox;
  if (!face || face.width < 8 || face.height < 8) return [];
  const tiles = [];
  const columns = clamp(Math.round(face.width / 20), 7, 11);
  const rows = clamp(Math.round(face.height / 16), 9, 14);

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const normalizedX = (column + 0.5) / columns * 2 - 1;
      const normalizedY = (row + 0.5) / rows * 2 - 1;
      if ((normalizedX / 0.96) ** 2 + (normalizedY / 1.05) ** 2 > 1) continue;
      const left = face.x + face.width * column / columns;
      const top = face.y + face.height * row / rows;
      const right = face.x + face.width * (column + 1) / columns;
      const bottom = face.y + face.height * (row + 1) / rows;
      tiles.push({
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
        kind: "face",
        id: `face-${row}-${column}`,
      });
    }
  }

  const features = mappedFace.features || {};
  const leftEye = expandedBox(features.leftEye, 0.12, 0.18);
  const rightEye = expandedBox(features.rightEye, 0.12, 0.18);
  appendGrid(tiles, leftEye, 5, 2, "eye", "left-eye");
  appendGrid(tiles, rightEye, 5, 2, "eye", "right-eye");
  if (leftEye) {
    appendGrid(tiles, {
      x: leftEye.x,
      y: leftEye.y - leftEye.height * 0.45,
      width: leftEye.width,
      height: leftEye.height * 0.25,
    }, 4, 1, "brow", "left-brow");
  }
  if (rightEye) {
    appendGrid(tiles, {
      x: rightEye.x,
      y: rightEye.y - rightEye.height * 0.45,
      width: rightEye.width,
      height: rightEye.height * 0.25,
    }, 4, 1, "brow", "right-brow");
  }
  appendGrid(tiles, features.leftIris, 2, 2, "iris", "left-iris");
  appendGrid(tiles, features.rightIris, 2, 2, "iris", "right-iris");
  appendGrid(tiles, features.nose, 3, 4, "nose", "nose");
  appendGrid(tiles, features.mouth, 6, 3, "mouth", "mouth");
  return tiles;
}

export function paletteColorForStructure(family, sourceLuminance, stableId = "") {
  const colors = ART_PALETTE_FAMILIES[family] || ART_PALETTE_FAMILIES.ink;
  const light = clamp(Number(sourceLuminance) || 0, 0, 1);
  const jitter = (hashString(stableId) % 3) - 1;
  const baseIndex = Math.round(light * (colors.length - 1));
  return colors[clamp(baseIndex + jitter, 0, colors.length - 1)];
}

export function familyForFaceTile(tile) {
  if (tile.kind === "eye") return hashString(tile.id) % 4 === 0 ? "cobalt" : "paper";
  if (tile.kind === "iris") return hashString(tile.id) % 3 === 0 ? "gold" : "cobalt";
  if (tile.kind === "brow") return "ink";
  if (tile.kind === "mouth") return hashString(tile.id) % 4 === 0 ? "vermilion" : "violet";
  if (tile.kind === "nose") return "gold";
  return "vermilion";
}
