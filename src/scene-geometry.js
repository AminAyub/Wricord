// Pure low-resolution scene analysis for the abstract camera renderer.
//
// The pipeline deliberately owns the whole frame. Facial landmarks influence
// semantic roles and detail, but never create a detached face-shaped mask.

export const SCENE_SEMANTICS = Object.freeze({
  background: 0,
  hair: 1,
  bodySkin: 2,
  face: 3,
  clothes: 4,
  accessories: 5,
  neck: 6,
  torso: 7,
});

const SEMANTIC_NAMES = Object.freeze([
  "background",
  "hair",
  "body-skin",
  "face",
  "clothes",
  "accessories",
  "neck",
  "torso",
]);

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function dimensions(width, height) {
  return {
    width: Math.max(0, Math.floor(finite(width))),
    height: Math.max(0, Math.floor(finite(height))),
  };
}

function assertPixels(pixels, width, height) {
  if (!pixels || pixels.length < width * height * 4) {
    throw new RangeError("Scene pixels must contain four channels for every sample.");
  }
}

function semanticName(value) {
  return SEMANTIC_NAMES[value] || "background";
}

function isPersonSemantic(value) {
  return value !== SCENE_SEMANTICS.background;
}

function blurPlane(input, width, height) {
  const horizontal = new Float32Array(input.length);
  const output = new Float32Array(input.length);

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const left = input[row + Math.max(0, x - 1)];
      const centre = input[row + x];
      const right = input[row + Math.min(width - 1, x + 1)];
      horizontal[row + x] = (left + centre * 2 + right) * 0.25;
    }
  }

  for (let y = 0; y < height; y += 1) {
    const above = Math.max(0, y - 1) * width;
    const row = y * width;
    const below = Math.min(height - 1, y + 1) * width;
    for (let x = 0; x < width; x += 1) {
      output[row + x] = (
        horizontal[above + x] +
        horizontal[row + x] * 2 +
        horizontal[below + x]
      ) * 0.25;
    }
  }
  return output;
}

/** Convert an RGBA frame into gently blurred YCoCg feature planes. */
export function createYCoCgPlanes(pixels, width, height) {
  const size = dimensions(width, height);
  assertPixels(pixels, size.width, size.height);
  const length = size.width * size.height;
  const luminance = new Float32Array(length);
  const orange = new Float32Array(length);
  const green = new Float32Array(length);

  for (let index = 0; index < length; index += 1) {
    const offset = index * 4;
    const red = pixels[offset] / 255;
    const greenChannel = pixels[offset + 1] / 255;
    const blue = pixels[offset + 2] / 255;
    luminance[index] = red * 0.25 + greenChannel * 0.5 + blue * 0.25;
    orange[index] = (red - blue) * 0.5;
    green[index] = (-red + greenChannel * 2 - blue) * 0.25;
  }

  return {
    luminance: blurPlane(luminance, size.width, size.height),
    orange: blurPlane(orange, size.width, size.height),
    green: blurPlane(green, size.width, size.height),
  };
}

function scharrAt(plane, width, height, x, y) {
  const left = Math.max(0, x - 1);
  const right = Math.min(width - 1, x + 1);
  const top = Math.max(0, y - 1);
  const bottom = Math.min(height - 1, y + 1);
  const tl = plane[top * width + left];
  const tc = plane[top * width + x];
  const tr = plane[top * width + right];
  const ml = plane[y * width + left];
  const mr = plane[y * width + right];
  const bl = plane[bottom * width + left];
  const bc = plane[bottom * width + x];
  const br = plane[bottom * width + right];
  const xGradient = (3 * (tr - tl) + 10 * (mr - ml) + 3 * (br - bl)) / 16;
  const yGradient = (3 * (bl - tl) + 10 * (bc - tc) + 3 * (br - tr)) / 16;
  return Math.hypot(xGradient, yGradient);
}

function percentileFromHistogram(histogram, sampleCount, percentile) {
  const target = Math.max(1, Math.ceil(sampleCount * percentile));
  let total = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    total += histogram[index];
    if (total >= target) return index / (histogram.length - 1);
  }
  return 0;
}

function featureDistance(planes, first, second) {
  const deltaY = planes.luminance[first] - planes.luminance[second];
  const deltaOrange = planes.orange[first] - planes.orange[second];
  const deltaGreen = planes.green[first] - planes.green[second];
  return Math.sqrt(
    deltaY * deltaY * 1.6 +
    deltaOrange * deltaOrange * 0.62 +
    deltaGreen * deltaGreen * 0.62,
  );
}

/**
 * Build a Scharr edge field with chroma support and connected weak-edge
 * hysteresis. `right` and `down` identify boundaries between pixel pairs.
 */
export function createScharrEdgeMap(
  pixels,
  width,
  height,
  { previousStrength = null, temporalAlpha = 0.55, percentile = 0.82 } = {},
) {
  const size = dimensions(width, height);
  assertPixels(pixels, size.width, size.height);
  const length = size.width * size.height;
  const planes = createYCoCgPlanes(pixels, size.width, size.height);
  const strength = new Float32Array(length);
  const histogram = new Uint32Array(256);
  const blend = clamp(finite(temporalAlpha, 0.55), 0, 1);

  for (let y = 0; y < size.height; y += 1) {
    for (let x = 0; x < size.width; x += 1) {
      const index = y * size.width + x;
      const luma = scharrAt(planes.luminance, size.width, size.height, x, y);
      const orange = scharrAt(planes.orange, size.width, size.height, x, y);
      const green = scharrAt(planes.green, size.width, size.height, x, y);
      const chroma = Math.hypot(orange, green);
      let value = clamp(Math.max(luma, chroma * 0.48), 0, 1);
      if (previousStrength?.length === length) {
        value = previousStrength[index] + (value - previousStrength[index]) * blend;
      }
      strength[index] = value;
      histogram[Math.round(value * 255)] += 1;
    }
  }

  const adaptive = percentileFromHistogram(
    histogram,
    length,
    clamp(finite(percentile, 0.82), 0.5, 0.98),
  );
  const highThreshold = clamp(adaptive * 1.12, 0.105, 0.32);
  const lowThreshold = highThreshold * 0.46;
  const state = new Uint8Array(length);
  const boundary = new Uint8Array(length);
  const queue = new Int32Array(length);
  let head = 0;
  let tail = 0;

  for (let index = 0; index < length; index += 1) {
    if (strength[index] >= highThreshold) {
      state[index] = 2;
      boundary[index] = 1;
      queue[tail++] = index;
    } else if (strength[index] >= lowThreshold) {
      state[index] = 1;
    }
  }

  while (head < tail) {
    const index = queue[head++];
    const x = index % size.width;
    const y = Math.floor(index / size.width);
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      const nextY = y + offsetY;
      if (nextY < 0 || nextY >= size.height) continue;
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        if (offsetX === 0 && offsetY === 0) continue;
        const nextX = x + offsetX;
        if (nextX < 0 || nextX >= size.width) continue;
        const next = nextY * size.width + nextX;
        if (state[next] !== 1) continue;
        state[next] = 2;
        boundary[next] = 1;
        queue[tail++] = next;
      }
    }
  }

  const right = new Uint8Array(length);
  const down = new Uint8Array(length);
  const colorThreshold = 0.13;
  for (let y = 0; y < size.height; y += 1) {
    for (let x = 0; x < size.width; x += 1) {
      const index = y * size.width + x;
      if (x + 1 < size.width) {
        const next = index + 1;
        const difference = featureDistance(planes, index, next);
        right[index] = Number(
          difference >= colorThreshold * 1.6 ||
          (difference >= colorThreshold * 0.42 &&
            (boundary[index] || boundary[next])),
        );
      }
      if (y + 1 < size.height) {
        const next = index + size.width;
        const difference = featureDistance(planes, index, next);
        down[index] = Number(
          difference >= colorThreshold * 1.6 ||
          (difference >= colorThreshold * 0.42 &&
            (boundary[index] || boundary[next])),
        );
      }
    }
  }

  return {
    strength,
    boundary,
    right,
    down,
    planes,
    highThreshold,
    lowThreshold,
  };
}

function normalizeBox(box, width, height) {
  if (!box) return null;
  const x = clamp(finite(box.x), 0, width);
  const y = clamp(finite(box.y), 0, height);
  const right = clamp(x + Math.max(0, finite(box.width)), x, width);
  const bottom = clamp(y + Math.max(0, finite(box.height)), y, height);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

function setBox(grid, width, height, box, semantic, predicate = null) {
  const safe = normalizeBox(box, width, height);
  if (!safe) return;
  const left = clamp(Math.floor(safe.x), 0, width);
  const top = clamp(Math.floor(safe.y), 0, height);
  const right = clamp(Math.ceil(safe.x + safe.width), left, width);
  const bottom = clamp(Math.ceil(safe.y + safe.height), top, height);
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const index = y * width + x;
      if (!predicate || predicate(index, x, y)) grid[index] = semantic;
    }
  }
}

function fillTorsoWedge(grid, width, height, face, predicate = null) {
  const startY = clamp(Math.floor(face.y + face.height * 0.86), 0, height - 1);
  const endY = height;
  const centreX = face.x + face.width / 2;
  for (let y = startY; y < endY; y += 1) {
    const progress = (y - startY) / Math.max(1, endY - startY - 1);
    const halfWidth = face.width * (0.31 + progress * 0.72);
    const left = clamp(Math.floor(centreX - halfWidth), 0, width);
    const right = clamp(Math.ceil(centreX + halfWidth), left, width);
    for (let x = left; x < right; x += 1) {
      const index = y * width + x;
      if (!predicate || predicate(index, x, y)) grid[index] = SCENE_SEMANTICS.torso;
    }
  }
}

function closeSubjectMask(categories, width, height) {
  const output = new Uint8Array(categories);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (categories[index] > 0) continue;
      let foreground = 0;
      const votes = new Uint8Array(6);
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        const nextY = y + offsetY;
        if (nextY < 0 || nextY >= height) continue;
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) continue;
          const nextX = x + offsetX;
          if (nextX < 0 || nextX >= width) continue;
          const category = clamp(categories[nextY * width + nextX], 0, 5);
          if (category > 0) {
            foreground += 1;
            votes[category] += 1;
          }
        }
      }
      const horizontalBridge = x > 0 && x + 1 < width &&
        categories[index - 1] > 0 && categories[index + 1] > 0;
      const verticalBridge = y > 0 && y + 1 < height &&
        categories[index - width] > 0 && categories[index + width] > 0;
      if (foreground < 5 && !horizontalBridge && !verticalBridge) continue;
      let winner = 1;
      for (let category = 2; category < votes.length; category += 1) {
        if (votes[category] > votes[winner]) winner = category;
      }
      output[index] = winner;
    }
  }
  return output;
}

function bridgeFaceToLowerSubject(categories, width, height, face) {
  const faceBox = normalizeBox(face, width, height);
  if (!faceBox) return;
  const faceBottom = faceBox.y + faceBox.height;
  const searchTop = clamp(Math.ceil(faceBottom + 1), 0, height);
  const searchBottom = clamp(
    Math.ceil(faceBottom + faceBox.height * 1.65),
    searchTop,
    height,
  );
  const faceCentre = faceBox.x + faceBox.width / 2;
  const searchHalfWidth = Math.max(2, faceBox.width * 1.25);
  let target = null;

  for (let y = searchTop; y < searchBottom && !target; y += 1) {
    const left = clamp(Math.floor(faceCentre - searchHalfWidth), 0, width);
    const right = clamp(Math.ceil(faceCentre + searchHalfWidth), left, width);
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let x = left; x < right; x += 1) {
      if (categories[y * width + x] <= SCENE_SEMANTICS.background) continue;
      const distance = Math.abs(x + 0.5 - faceCentre);
      if (distance < bestDistance) {
        target = { x: x + 0.5, y };
        bestDistance = distance;
      }
    }
  }
  if (!target) return;

  const startY = clamp(Math.floor(faceBottom - faceBox.height * 0.12), 0, height - 1);
  for (let y = startY; y <= target.y; y += 1) {
    const progress = (y - startY) / Math.max(1, target.y - startY);
    const centre = faceCentre + (target.x - faceCentre) * progress;
    const halfWidth = Math.max(1, faceBox.width * (0.14 + progress * 0.1));
    const left = clamp(Math.floor(centre - halfWidth), 0, width);
    const right = clamp(Math.ceil(centre + halfWidth), left, width);
    for (let x = left; x < right; x += 1) {
      const index = y * width + x;
      if (categories[index] === SCENE_SEMANTICS.background) {
        categories[index] = SCENE_SEMANTICS.bodySkin;
      }
    }
  }
}

function selectPrimarySubject(categories, width, height, face) {
  const length = width * height;
  const visited = new Uint8Array(length);
  const queue = new Int32Array(length);
  const candidates = [];
  const faceBox = normalizeBox(face, width, height);

  for (let start = 0; start < length; start += 1) {
    if (visited[start] || categories[start] <= 0) continue;
    let head = 0;
    let tail = 0;
    let faceOverlap = 0;
    visited[start] = 1;
    queue[tail++] = start;
    const indices = [];
    while (head < tail) {
      const index = queue[head++];
      indices.push(index);
      const x = index % width;
      const y = Math.floor(index / width);
      if (
        faceBox &&
        x + 0.5 >= faceBox.x && x + 0.5 < faceBox.x + faceBox.width &&
        y + 0.5 >= faceBox.y && y + 0.5 < faceBox.y + faceBox.height
      ) faceOverlap += 1;
      for (const next of [
        x > 0 ? index - 1 : -1,
        x + 1 < width ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y + 1 < height ? index + width : -1,
      ]) {
        if (next < 0 || visited[next] || categories[next] <= 0) continue;
        visited[next] = 1;
        queue[tail++] = next;
      }
    }
    candidates.push({ indices, faceOverlap });
  }

  if (!candidates.length) return new Uint8Array(length);
  candidates.sort((first, second) =>
    second.faceOverlap - first.faceOverlap ||
    second.indices.length - first.indices.length ||
    first.indices[0] - second.indices[0]);
  const selected = new Uint8Array(length);
  for (const index of candidates[0].indices) selected[index] = categories[index];
  return selected;
}

function hasForeground(categories) {
  for (const category of categories) {
    if (category > SCENE_SEMANTICS.background) return true;
  }
  return false;
}

function hasFaceMaskSupport(categories, width, height, face) {
  const faceBox = normalizeBox(face, width, height);
  if (!faceBox) return hasForeground(categories);
  const left = clamp(Math.floor(faceBox.x), 0, width);
  const top = clamp(Math.floor(faceBox.y), 0, height);
  const right = clamp(Math.ceil(faceBox.x + faceBox.width), left, width);
  const bottom = clamp(Math.ceil(faceBox.y + faceBox.height), top, height);
  const area = Math.max(1, (right - left) * (bottom - top));
  const required = Math.min(area, Math.max(1, Math.ceil(area * 0.02)));
  let foreground = 0;
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      if (categories[y * width + x] <= SCENE_SEMANTICS.background) continue;
      foreground += 1;
      if (foreground >= required) return true;
    }
  }
  return false;
}

/**
 * Produce one semantic raster for the whole scene. A supplied mask determines
 * the silhouette; without one, the face supplies a conservative connected
 * head/neck/torso prior. Semantic roles remain separate, but all person roles
 * receive one owner/group during component labelling.
 */
function createSemanticScene(
  width,
  height,
  { categoryMask = null, personMask = null, mappedFace = null } = {},
) {
  const size = dimensions(width, height);
  const length = size.width * size.height;
  const grid = new Uint8Array(length);
  const suppliedMask = categoryMask || personMask;
  const receivedMask = suppliedMask != null;
  let useMask = receivedMask;
  const face = normalizeBox(mappedFace?.bbox, size.width, size.height);
  if (receivedMask && suppliedMask.length < length) {
    throw new RangeError("The subject category mask must cover the complete analysis frame.");
  }

  if (receivedMask) {
    const categories = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) {
      const raw = Number(suppliedMask[index]);
      // A legacy binary mask has no material category information, so its
      // foreground becomes the generic torso role.
      categories[index] = categoryMask
        ? clamp(Number.isFinite(raw) ? Math.round(raw) : 0, 0, 5)
        : raw ? SCENE_SEMANTICS.torso : SCENE_SEMANTICS.background;
    }
    // A valid-shaped but empty/stale mask is not useful. Face landmarks remain
    // available for longer than a single segmenter result, so fall back to the
    // connected landmark silhouette instead of blinking the complete person.
    useMask = hasFaceMaskSupport(categories, size.width, size.height, face);
    if (useMask) {
      // Connect a face island to the nearest plausible lower-body island before
      // selecting the primary subject; otherwise a collar gap can discard the
      // complete torso and recreate a floating head.
      bridgeFaceToLowerSubject(categories, size.width, size.height, face);
      const closed = closeSubjectMask(categories, size.width, size.height);
      const primary = selectPrimarySubject(closed, size.width, size.height, face);
      useMask = hasForeground(primary);
      if (useMask) grid.set(primary);
    }
  }

  if (!face) {
    return {
      grid,
      usedSubjectMask: useMask,
      usedCategoryMask: useMask && categoryMask != null,
    };
  }
  const insideMask = index => !useMask || grid[index] > SCENE_SEMANTICS.background;

  if (!useMask) {
    fillTorsoWedge(grid, size.width, size.height, face);
    setBox(grid, size.width, size.height, face, SCENE_SEMANTICS.face);
  }

  const hair = {
    x: face.x - face.width * 0.09,
    y: face.y - face.height * 0.22,
    width: face.width * 1.18,
    height: face.height * 0.35,
  };
  if (!useMask) {
    setBox(grid, size.width, size.height, hair, SCENE_SEMANTICS.hair);
  } else {
    // Preserve SelfieMulticlass material categories. Only pixels the model
    // already considers hair retain the hair role.
    setBox(
      grid,
      size.width,
      size.height,
      hair,
      SCENE_SEMANTICS.hair,
      index => insideMask(index) && grid[index] === SCENE_SEMANTICS.hair,
    );
  }

  const neck = {
    x: face.x + face.width * 0.32,
    y: face.y + face.height * 0.86,
    width: face.width * 0.36,
    height: face.height * 0.42,
  };
  // The narrow central bridge is intentional. It keeps the inferred head and
  // torso one visual mass if a noisy binary mask misses a few neck pixels.
  setBox(grid, size.width, size.height, neck, SCENE_SEMANTICS.neck);
  return {
    grid,
    usedSubjectMask: useMask,
    usedCategoryMask: useMask && categoryMask != null,
  };
}

export function createSemanticGrid(width, height, options = {}) {
  return createSemanticScene(width, height, options).grid;
}

function makeDisjointSet(length) {
  const parent = new Int32Array(length);
  const weight = new Uint32Array(length);
  for (let index = 0; index < length; index += 1) {
    parent[index] = index;
    weight[index] = 1;
  }
  const find = input => {
    let root = input;
    while (parent[root] !== root) root = parent[root];
    let index = input;
    while (parent[index] !== index) {
      const next = parent[index];
      parent[index] = root;
      index = next;
    }
    return root;
  };
  const union = (first, second, preferred = null) => {
    let left = find(first);
    let right = find(second);
    if (left === right) return left;
    if (preferred != null) {
      const target = find(preferred);
      if (target === right) [left, right] = [right, left];
    } else if (weight[left] < weight[right]) {
      [left, right] = [right, left];
    }
    parent[right] = left;
    weight[left] += weight[right];
    return left;
  };
  return { parent, find, union };
}

function rootSummaries(set, semanticGrid, planes, width, height) {
  const summaries = new Map();
  const length = width * height;
  for (let index = 0; index < length; index += 1) {
    const root = set.find(index);
    let summary = summaries.get(root);
    if (!summary) {
      summary = {
        root,
        semantic: semanticGrid[index],
        area: 0,
        sumY: 0,
        sumOrange: 0,
        sumGreen: 0,
      };
      summaries.set(root, summary);
    }
    summary.area += 1;
    summary.sumY += planes.luminance[index];
    summary.sumOrange += planes.orange[index];
    summary.sumGreen += planes.green[index];
  }
  for (const summary of summaries.values()) {
    summary.meanY = summary.sumY / summary.area;
    summary.meanOrange = summary.sumOrange / summary.area;
    summary.meanGreen = summary.sumGreen / summary.area;
  }
  return summaries;
}

function summaryDistance(first, second) {
  const y = first.meanY - second.meanY;
  const orange = first.meanOrange - second.meanOrange;
  const green = first.meanGreen - second.meanGreen;
  return Math.sqrt(y * y * 1.6 + orange * orange * 0.62 + green * green * 0.62);
}

function componentAdjacency(set, semanticGrid, edgeMap, width, height) {
  const adjacency = new Map();
  const add = (firstIndex, secondIndex) => {
    const first = set.find(firstIndex);
    const second = set.find(secondIndex);
    if (first === second || semanticGrid[firstIndex] !== semanticGrid[secondIndex]) return;
    const low = Math.min(first, second);
    const high = Math.max(first, second);
    const key = `${low}:${high}`;
    let value = adjacency.get(key);
    if (!value) {
      value = { first: low, second: high, border: 0, edge: 0 };
      adjacency.set(key, value);
    }
    value.border += 1;
    value.edge += Math.max(edgeMap.strength[firstIndex], edgeMap.strength[secondIndex]);
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (x + 1 < width) add(index, index + 1);
      if (y + 1 < height) add(index, index + width);
    }
  }
  return adjacency;
}

/** Connected component labelling that never merges unlike semantic roles. */
export function labelSceneComponents(
  pixels,
  width,
  height,
  {
    edgeMap = null,
    semanticGrid = null,
    minimumRegionSize = 7,
    colorThreshold = 0.13,
  } = {},
) {
  const size = dimensions(width, height);
  assertPixels(pixels, size.width, size.height);
  const length = size.width * size.height;
  const semantics = semanticGrid || new Uint8Array(length);
  if (semantics.length < length) throw new RangeError("Semantic grid is too small.");
  const edges = edgeMap || createScharrEdgeMap(pixels, size.width, size.height);
  const planes = edges.planes || createYCoCgPlanes(pixels, size.width, size.height);
  const set = makeDisjointSet(length);
  const threshold = Math.max(0.02, finite(colorThreshold, 0.13));

  for (let y = 0; y < size.height; y += 1) {
    for (let x = 0; x < size.width; x += 1) {
      const index = y * size.width + x;
      if (
        x > 0 &&
        semantics[index] === semantics[index - 1] &&
        !edges.right[index - 1] &&
        featureDistance(planes, index, index - 1) <= threshold
      ) set.union(index, index - 1);
      if (
        y > 0 &&
        semantics[index] === semantics[index - size.width] &&
        !edges.down[index - size.width] &&
        featureDistance(planes, index, index - size.width) <= threshold
      ) set.union(index, index - size.width);
    }
  }

  const minimum = Math.max(1, Math.floor(finite(minimumRegionSize, 7)));
  let summaries = rootSummaries(set, semantics, planes, size.width, size.height);
  const adjacency = componentAdjacency(set, semantics, edges, size.width, size.height);
  const contactsByRoot = new Map();
  for (const contact of adjacency.values()) {
    if (!contactsByRoot.has(contact.first)) contactsByRoot.set(contact.first, []);
    if (!contactsByRoot.has(contact.second)) contactsByRoot.set(contact.second, []);
    contactsByRoot.get(contact.first).push(contact);
    contactsByRoot.get(contact.second).push(contact);
  }
  const small = [...summaries.values()]
    .filter(summary => summary.area < minimum)
    .sort((first, second) => first.area - second.area || first.root - second.root);

  for (const summary of small) {
    const root = set.find(summary.root);
    if (root !== summary.root) continue;
    let best = null;
    for (const contact of contactsByRoot.get(summary.root) || []) {
      const first = set.find(contact.first);
      const second = set.find(contact.second);
      if (first === second || (first !== root && second !== root)) continue;
      const neighbour = first === root ? second : first;
      const neighbourSummary = summaries.get(neighbour) || summaries.get(
        [...summaries.keys()].find(key => set.find(key) === neighbour),
      );
      if (!neighbourSummary || neighbourSummary.semantic !== summary.semantic) continue;
      const meanEdge = contact.edge / Math.max(1, contact.border);
      const distance = summaryDistance(summary, neighbourSummary);
      const score = contact.border * 8 - meanEdge * 3 - distance;
      if (!best || score > best.score || (score === best.score && neighbour < best.root)) {
        best = { root: neighbour, score };
      }
    }
    if (best) set.union(best.root, root, best.root);
  }

  summaries = rootSummaries(set, semantics, planes, size.width, size.height);
  const rootToLabel = new Map();
  const labels = new Int32Array(length);
  const components = [];

  for (let index = 0; index < length; index += 1) {
    const root = set.find(index);
    if (!rootToLabel.has(root)) {
      const id = rootToLabel.size;
      rootToLabel.set(root, id);
      const semantic = semantics[index];
      const role = semanticName(semantic);
      const person = isPersonSemantic(semantic);
      components.push({
        id,
        semantic,
        role,
        owner: person ? "person" : `scene:${id}`,
        groupId: person ? "person:0" : `scene:${id}`,
        area: 0,
        x: size.width,
        y: size.height,
        right: 0,
        bottom: 0,
        sumX: 0,
        sumY: 0,
        edgeTotal: 0,
        stats: { red: 0, green: 0, blue: 0, luminance: 0, co: 0, cg: 0 },
        neighbours: new Set(),
      });
    }
    const label = rootToLabel.get(root);
    labels[index] = label;
    const component = components[label];
    const x = index % size.width;
    const y = Math.floor(index / size.width);
    const offset = index * 4;
    component.area += 1;
    component.x = Math.min(component.x, x);
    component.y = Math.min(component.y, y);
    component.right = Math.max(component.right, x + 1);
    component.bottom = Math.max(component.bottom, y + 1);
    component.sumX += x + 0.5;
    component.sumY += y + 0.5;
    component.edgeTotal += edges.strength[index];
    component.stats.red += pixels[offset];
    component.stats.green += pixels[offset + 1];
    component.stats.blue += pixels[offset + 2];
    component.stats.luminance += planes.luminance[index];
    component.stats.co += planes.orange[index];
    component.stats.cg += planes.green[index];
  }

  for (const component of components) {
    component.width = component.right - component.x;
    component.height = component.bottom - component.y;
    component.centroid = {
      x: component.sumX / component.area,
      y: component.sumY / component.area,
    };
    component.edgeDensity = component.edgeTotal / component.area;
    for (const key of Object.keys(component.stats)) component.stats[key] /= component.area;
    delete component.right;
    delete component.bottom;
    delete component.sumX;
    delete component.sumY;
    delete component.edgeTotal;
  }

  for (let y = 0; y < size.height; y += 1) {
    for (let x = 0; x < size.width; x += 1) {
      const index = y * size.width + x;
      const label = labels[index];
      if (x + 1 < size.width && labels[index + 1] !== label) {
        components[label].neighbours.add(labels[index + 1]);
        components[labels[index + 1]].neighbours.add(label);
      }
      if (y + 1 < size.height && labels[index + size.width] !== label) {
        components[label].neighbours.add(labels[index + size.width]);
        components[labels[index + size.width]].neighbours.add(label);
      }
    }
  }

  return { labels, components, semanticGrid: semantics, edgeMap: edges };
}

function tileCaps(role, width, height) {
  switch (role) {
    case "face":
      return { width: Math.max(3, Math.round(width * 0.085)), height: Math.max(2, Math.round(height * 0.13)) };
    case "hair":
      return { width: Math.max(5, Math.round(width * 0.18)), height: Math.max(2, Math.round(height * 0.15)) };
    case "neck":
      return { width: Math.max(3, Math.round(width * 0.09)), height: Math.max(3, Math.round(height * 0.19)) };
    case "person":
    case "torso":
      return { width: Math.max(6, Math.round(width * 0.24)), height: Math.max(4, Math.round(height * 0.28)) };
    default:
      return { width, height };
  }
}

function bestRunRectangle(labels, claimed, width, height, x, y, label, caps) {
  const maximumWidth = Math.min(caps.width, width - x);
  const maximumHeight = Math.min(caps.height, height - y);
  let availableWidth = 0;
  while (
    availableWidth < maximumWidth &&
    labels[y * width + x + availableWidth] === label &&
    !claimed[y * width + x + availableWidth]
  ) availableWidth += 1;

  let bestWidth = Math.max(1, availableWidth);
  let bestHeight = 1;
  let bestArea = bestWidth;
  let rowWidth = bestWidth;
  for (let row = 1; row < maximumHeight; row += 1) {
    let run = 0;
    const offset = (y + row) * width + x;
    while (
      run < rowWidth &&
      labels[offset + run] === label &&
      !claimed[offset + run]
    ) run += 1;
    rowWidth = Math.min(rowWidth, run);
    if (rowWidth <= 0) break;
    const area = rowWidth * (row + 1);
    if (area > bestArea || (area === bestArea && rowWidth < bestWidth)) {
      bestArea = area;
      bestWidth = rowWidth;
      bestHeight = row + 1;
    }
  }
  return { width: bestWidth, height: bestHeight };
}

function coarsenLabels(labels, components, width, height, cellSize) {
  if (cellSize <= 1) return { labels, width, height, cellSize: 1 };
  const coarseWidth = Math.ceil(width / cellSize);
  const coarseHeight = Math.ceil(height / cellSize);
  const coarse = new Int32Array(coarseWidth * coarseHeight);

  for (let cellY = 0; cellY < coarseHeight; cellY += 1) {
    for (let cellX = 0; cellX < coarseWidth; cellX += 1) {
      const counts = new Map();
      const personCounts = new Map();
      let samples = 0;
      let personSamples = 0;
      const top = cellY * cellSize;
      const left = cellX * cellSize;
      const bottom = Math.min(height, top + cellSize);
      const right = Math.min(width, left + cellSize);
      for (let y = top; y < bottom; y += 1) {
        for (let x = left; x < right; x += 1) {
          const label = labels[y * width + x];
          counts.set(label, (counts.get(label) || 0) + 1);
          samples += 1;
          if (components[label]?.owner === "person") {
            personCounts.set(label, (personCounts.get(label) || 0) + 1);
            personSamples += 1;
          }
        }
      }
      const candidates = personSamples >= Math.max(1, Math.ceil(samples * 0.28))
        ? personCounts
        : counts;
      let winner = 0;
      let winnerCount = -1;
      for (const [label, count] of candidates) {
        if (count > winnerCount || (count === winnerCount && label < winner)) {
          winner = label;
          winnerCount = count;
        }
      }
      coarse[cellY * coarseWidth + cellX] = winner;
    }
  }
  return { labels: coarse, width: coarseWidth, height: coarseHeight, cellSize };
}

function decomposeGrid(grid, components) {
  const claimed = new Uint8Array(grid.width * grid.height);
  const rectangles = [];
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const index = y * grid.width + x;
      if (claimed[index]) continue;
      const label = grid.labels[index];
      const component = components[label];
      const run = bestRunRectangle(
        grid.labels,
        claimed,
        grid.width,
        grid.height,
        x,
        y,
        label,
        tileCaps(component?.role, grid.width, grid.height),
      );
      for (let row = 0; row < run.height; row += 1) {
        const offset = (y + row) * grid.width + x;
        claimed.fill(1, offset, offset + run.width);
      }
      rectangles.push({ x, y, width: run.width, height: run.height, label });
    }
  }
  return rectangles;
}

/** Exact, non-overlapping, same-component rectangular decomposition. */
export function rectangularizeScene(
  segmentation,
  width,
  height,
  artWidth = width,
  artHeight = height,
  { maximumRectangles = 78 } = {},
) {
  const size = dimensions(width, height);
  const labels = segmentation?.labels;
  const components = segmentation?.components;
  if (!labels || labels.length < size.width * size.height || !components) return [];
  const limit = Math.max(12, Math.floor(finite(maximumRectangles, 78)));
  const candidateSizes = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16];
  let grid = null;
  let logical = null;
  for (const cellSize of candidateSizes) {
    grid = coarsenLabels(labels, components, size.width, size.height, cellSize);
    logical = decomposeGrid(grid, components);
    if (logical.length <= limit) break;
  }
  while (logical.length > limit) {
    const nextSize = grid.cellSize + 4;
    grid = coarsenLabels(labels, components, size.width, size.height, nextSize);
    logical = decomposeGrid(grid, components);
  }

  return logical.map(logicalRectangle => {
      const x = logicalRectangle.x * grid.cellSize;
      const y = logicalRectangle.y * grid.cellSize;
      const sourceRight = Math.min(
        size.width,
        (logicalRectangle.x + logicalRectangle.width) * grid.cellSize,
      );
      const sourceBottom = Math.min(
        size.height,
        (logicalRectangle.y + logicalRectangle.height) * grid.cellSize,
      );
      const sourceWidth = sourceRight - x;
      const sourceHeight = sourceBottom - y;
      const label = logicalRectangle.label;
      const component = components[label];
      const left = Math.round(x / size.width * artWidth);
      const top = Math.round(y / size.height * artHeight);
      const right = Math.round(sourceRight / size.width * artWidth);
      const bottom = Math.round(sourceBottom / size.height * artHeight);
      return {
        x: left,
        y: top,
        width: Math.max(1, right - left),
        height: Math.max(1, bottom - top),
        sampleX: x,
        sampleY: y,
        sampleWidth: sourceWidth,
        sampleHeight: sourceHeight,
        id: `component-${label}:${x}:${y}:${sourceWidth}:${sourceHeight}`,
        componentId: label,
        structureId: label,
        semantic: component?.semantic ?? SCENE_SEMANTICS.background,
        role: component?.role || "background",
        owner: component?.owner || `scene:${label}`,
        groupId: component?.groupId || `scene:${label}`,
        stats: component?.stats,
      };
    });
}

function scaleBox(box, horizontal, vertical) {
  if (!box) return null;
  return {
    x: box.x * horizontal,
    y: box.y * vertical,
    width: box.width * horizontal,
    height: box.height * vertical,
  };
}

function relativeBox(face, x, y, width, height) {
  return {
    x: face.x + face.width * x,
    y: face.y + face.height * y,
    width: face.width * width,
    height: face.height * height,
  };
}

function expandedBox(box, horizontal, vertical) {
  return {
    x: box.x - box.width * horizontal,
    y: box.y - box.height * vertical,
    width: box.width * (1 + horizontal * 2),
    height: box.height * (1 + vertical * 2),
  };
}

function clippedPlane(plane, width, height) {
  const box = normalizeBox(plane, width, height);
  return box ? { ...plane, ...box } : null;
}

/**
 * A sparse landmark-guided face treatment: broad color fields instead of a
 * literal facial grid. Boxes are expected in the same coordinate system as
 * `width`/`height` and can optionally be scaled into another canvas.
 */
export function createRothkoFacePlanes(
  mappedFace,
  width,
  height,
  { artWidth = width, artHeight = height } = {},
) {
  const size = dimensions(width, height);
  const face = normalizeBox(mappedFace?.bbox, size.width, size.height);
  if (!face) return [];
  const features = mappedFace.features || {};
  const leftEye = normalizeBox(features.leftEye, size.width, size.height) ||
    relativeBox(face, 0.17, 0.3, 0.25, 0.1);
  const rightEye = normalizeBox(features.rightEye, size.width, size.height) ||
    relativeBox(face, 0.58, 0.3, 0.25, 0.1);
  const nose = normalizeBox(features.nose, size.width, size.height) ||
    relativeBox(face, 0.39, 0.38, 0.22, 0.29);
  const mouth = normalizeBox(features.mouth, size.width, size.height) ||
    relativeBox(face, 0.28, 0.7, 0.44, 0.11);
  const shared = { owner: "person", groupId: "person:0" };
  const planes = [];
  const add = (id, kind, box, tone) => {
    planes.push({ id: `rothko-${id}`, kind, role: kind === "hair" ? "hair" : "face", tone, ...shared, ...box });
  };

  add("hair-crown", "hair", relativeBox(face, -0.07, -0.2, 1.14, 0.25), "deep");
  add("hair-fringe", "hair", relativeBox(face, 0.05, -0.01, 0.9, 0.15), "dark");
  add("forehead", "face", relativeBox(face, 0.12, 0.07, 0.76, 0.23), "light");
  add("left-cheek", "face", relativeBox(face, 0.04, 0.33, 0.46, 0.39), "mid");
  add("right-cheek", "face", relativeBox(face, 0.5, 0.33, 0.46, 0.39), "warm");
  add("jaw", "face", relativeBox(face, 0.18, 0.68, 0.64, 0.25), "shadow");

  for (const [side, eye] of [["left", leftEye], ["right", rightEye]]) {
    add(
      `${side}-brow`,
      "brow",
      relativeBox(eye, -0.04, -0.55, 1.08, 0.28),
      "deep",
    );
    add(`${side}-eye-field`, "eye", expandedBox(eye, 0.15, 0.62), "shadow");
    add(`${side}-eye-core`, "eye", relativeBox(eye, 0.2, 0.27, 0.6, 0.46), "deep");
  }

  add("nose-bridge", "nose", relativeBox(nose, 0.31, 0, 0.38, 0.72), "light");
  add("nose-base", "nose", relativeBox(nose, 0.08, 0.67, 0.84, 0.33), "shadow");
  add("mouth-field", "mouth", expandedBox(mouth, 0.08, 0.24), "warm");
  add("mouth-core", "mouth", relativeBox(mouth, 0.13, 0.34, 0.74, 0.34), "deep");

  const horizontal = finite(artWidth, size.width) / Math.max(1, size.width);
  const vertical = finite(artHeight, size.height) / Math.max(1, size.height);
  return planes
    .map(plane => clippedPlane(plane, size.width, size.height))
    .filter(Boolean)
    .map(plane => ({
      ...plane,
      ...scaleBox(plane, horizontal, vertical),
    }));
}

/** Complete deterministic scene-analysis result consumed by camera-art. */
export function createSceneArtwork(
  pixels,
  sampleWidth,
  sampleHeight,
  artWidth,
  artHeight,
  {
    categoryMask = null,
    personMask = null,
    mappedFace = null,
    previousEdgeStrength = null,
    minimumRegionSize = 7,
    colorThreshold = 0.13,
    maximumRectangles = 78,
  } = {},
) {
  const size = dimensions(sampleWidth, sampleHeight);
  assertPixels(pixels, size.width, size.height);
  const semanticScene = createSemanticScene(size.width, size.height, {
    categoryMask,
    personMask,
    mappedFace,
  });
  const semanticGrid = semanticScene.grid;
  const edgeMap = createScharrEdgeMap(pixels, size.width, size.height, {
    previousStrength: previousEdgeStrength,
  });
  const segmentation = labelSceneComponents(pixels, size.width, size.height, {
    edgeMap,
    semanticGrid,
    minimumRegionSize,
    colorThreshold,
  });
  const rectangles = rectangularizeScene(
    segmentation,
    size.width,
    size.height,
    artWidth,
    artHeight,
    { maximumRectangles },
  );
  const facePlanes = createRothkoFacePlanes(mappedFace, size.width, size.height, {
    artWidth,
    artHeight,
  });
  return {
    ...segmentation,
    rectangles,
    facePlanes,
    usedSubjectMask: semanticScene.usedSubjectMask,
    usedCategoryMask: semanticScene.usedCategoryMask,
    previousEdgeStrength: edgeMap.strength,
  };
}
