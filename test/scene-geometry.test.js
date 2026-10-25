import test from "node:test";
import assert from "node:assert/strict";

import {
  SCENE_SEMANTICS,
  createRothkoFacePlanes,
  createSceneArtwork,
  createScharrEdgeMap,
  createSemanticGrid,
} from "../src/scene-geometry.js";

function solidPixels(width, height, red = 128, green = red, blue = red) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = red;
    pixels[index + 1] = green;
    pixels[index + 2] = blue;
    pixels[index + 3] = 255;
  }
  return pixels;
}

function setPixel(pixels, width, x, y, [red, green, blue]) {
  const offset = (y * width + x) * 4;
  pixels[offset] = red;
  pixels[offset + 1] = green;
  pixels[offset + 2] = blue;
}

function fillMask(mask, width, left, top, right, bottom, category) {
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) mask[y * width + x] = category;
  }
}

function mappedFace() {
  return {
    bbox: { x: 19, y: 6, width: 10, height: 10 },
    features: {
      leftEye: { x: 21, y: 9, width: 2, height: 1 },
      rightEye: { x: 25, y: 9, width: 2, height: 1 },
      nose: { x: 23, y: 10, width: 2, height: 3 },
      mouth: { x: 22, y: 14, width: 4, height: 1 },
    },
  };
}

function semanticFixture() {
  const width = 48;
  const height = 28;
  const mask = new Uint8Array(width * height);
  fillMask(mask, width, 18, 2, 30, 7, 1); // hair
  fillMask(mask, width, 19, 7, 29, 16, 3); // face skin
  fillMask(mask, width, 22, 15, 26, 20, 2); // body skin / neck
  fillMask(mask, width, 12, 19, 36, 28, 4); // clothing / torso
  fillMask(mask, width, 2, 20, 5, 24, 4); // unrelated second foreground island
  return { width, height, mask };
}

test("Scharr analysis retains strong luma and equal-luma chroma boundaries", () => {
  const width = 32;
  const height = 16;
  const flat = solidPixels(width, height, 110);
  const flatEdges = createScharrEdgeMap(flat, width, height);
  assert.ok(Math.max(...flatEdges.strength) < 1e-6);

  const lumaSplit = solidPixels(width, height, 20);
  for (let y = 0; y < height; y += 1) {
    for (let x = width / 2; x < width; x += 1) {
      setPixel(lumaSplit, width, x, y, [235, 235, 235]);
    }
  }
  const lumaEdges = createScharrEdgeMap(lumaSplit, width, height);
  assert.ok(lumaEdges.strength[(height / 2) * width + width / 2] > 0.35);

  const chromaSplit = solidPixels(width, height, 255, 0, 0);
  for (let y = 0; y < height; y += 1) {
    for (let x = width / 2; x < width; x += 1) {
      setPixel(chromaSplit, width, x, y, [0, 0, 255]);
    }
  }
  const chromaEdges = createScharrEdgeMap(chromaSplit, width, height);
  assert.ok(chromaEdges.strength[(height / 2) * width + width / 2] > 0.2);
});

test("Scharr hysteresis rejects weak gradients that are not linked to a strong edge", () => {
  const width = 32;
  const height = 16;
  const pixels = solidPixels(width, height, 110);
  for (let y = 0; y < height; y += 1) {
    for (let x = width / 2; x < width; x += 1) {
      setPixel(pixels, width, x, y, [160, 160, 160]);
    }
  }
  const priorWeakStrength = new Float32Array(width * height).fill(0.08);
  const edges = createScharrEdgeMap(pixels, width, height, {
    previousStrength: priorWeakStrength,
    temporalAlpha: 0,
  });
  assert.equal(edges.boundary.reduce((total, value) => total + value, 0), 0);
  assert.equal(edges.right.reduce((total, value) => total + value, 0), 0);
  assert.equal(edges.down.reduce((total, value) => total + value, 0), 0);
});

test("multiclass semantics keep one face-anchored person with material roles", () => {
  const { width, height, mask } = semanticFixture();
  const grid = createSemanticGrid(width, height, {
    categoryMask: mask,
    mappedFace: mappedFace(),
  });

  assert.ok(grid.includes(SCENE_SEMANTICS.hair));
  assert.ok(grid.includes(SCENE_SEMANTICS.face));
  assert.ok(grid.includes(SCENE_SEMANTICS.neck));
  assert.ok(grid.includes(SCENE_SEMANTICS.clothes));
  assert.equal(grid[21 * width + 3], SCENE_SEMANTICS.background);
  for (let y = 14; y < 20; y += 1) {
    assert.notEqual(grid[y * width + 24], SCENE_SEMANTICS.background);
  }
});

test("a collar gap is bridged before primary-subject selection discards the torso", () => {
  const width = 48;
  const height = 28;
  const mask = new Uint8Array(width * height);
  fillMask(mask, width, 19, 5, 29, 14, 3);
  // Deliberately leave several empty rows between the face and clothing.
  fillMask(mask, width, 12, 19, 36, 28, 4);
  const grid = createSemanticGrid(width, height, {
    categoryMask: mask,
    mappedFace: mappedFace(),
  });

  assert.ok(grid.includes(SCENE_SEMANTICS.clothes));
  for (let y = 13; y < 20; y += 1) {
    assert.notEqual(grid[y * width + 24], SCENE_SEMANTICS.background);
  }
});

test("an empty segmenter frame falls back to a connected landmark subject", () => {
  const width = 48;
  const height = 28;
  const emptyMask = new Uint8Array(width * height);
  const grid = createSemanticGrid(width, height, {
    categoryMask: emptyMask,
    mappedFace: mappedFace(),
  });

  assert.ok(grid.includes(SCENE_SEMANTICS.hair));
  assert.ok(grid.includes(SCENE_SEMANTICS.face));
  assert.ok(grid.includes(SCENE_SEMANTICS.neck));
  assert.ok(grid.includes(SCENE_SEMANTICS.torso));

  const scene = createSceneArtwork(
    solidPixels(width, height, 128),
    width,
    height,
    240,
    140,
    { categoryMask: emptyMask, mappedFace: mappedFace() },
  );
  assert.equal(scene.usedCategoryMask, false);
});

test("scene rectangles remain bounded, tile the frame, and connect face to clothing", () => {
  const { width, height, mask } = semanticFixture();
  const pixels = solidPixels(width, height, 218, 214, 202);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const category = mask[y * width + x];
      const color = category === 1 ? [32, 25, 29]
        : category === 3 ? [194, 134, 102]
          : category === 2 ? [170, 111, 88]
            : category === 4 ? [47, 72, 117]
              : [218, 214, 202];
      setPixel(pixels, width, x, y, color);
    }
  }

  const artWidth = 240;
  const artHeight = 140;
  const scene = createSceneArtwork(pixels, width, height, artWidth, artHeight, {
    categoryMask: mask,
    mappedFace: mappedFace(),
    maximumRectangles: 60,
  });
  assert.ok(scene.rectangles.length > 8 && scene.rectangles.length <= 60);
  assert.ok(scene.components.some(component => component.role === "hair"));
  assert.ok(scene.components.some(component => component.role === "clothes"));
  for (const component of scene.components.filter(component => component.role !== "background")) {
    assert.equal(component.owner, "person");
    assert.equal(component.groupId, "person:0");
  }

  const coverage = new Uint8Array(artWidth * artHeight);
  for (const rectangle of scene.rectangles) {
    for (let y = rectangle.y; y < rectangle.y + rectangle.height; y += 1) {
      for (let x = rectangle.x; x < rectangle.x + rectangle.width; x += 1) {
        coverage[y * artWidth + x] += 1;
      }
    }
  }
  assert.ok(coverage.every(value => value === 1), "scene blocks tile without gaps or overlaps");

  const faceComponents = scene.components.filter(component => component.role === "face");
  const clothesIds = new Set(
    scene.components.filter(component => component.role === "clothes").map(component => component.id),
  );
  const visited = new Set(faceComponents.map(component => component.id));
  const queue = [...visited];
  while (queue.length) {
    const id = queue.shift();
    for (const neighbour of scene.components[id].neighbours) {
      if (visited.has(neighbour)) continue;
      visited.add(neighbour);
      queue.push(neighbour);
    }
  }
  assert.ok([...clothesIds].some(id => visited.has(id)), "face and clothing share one adjacency chain");
});

test("Rothko face uses a sparse, deliberate feature grammar", () => {
  const planes = createRothkoFacePlanes(mappedFace(), 48, 28, {
    artWidth: 240,
    artHeight: 140,
  });
  const count = kind => planes.filter(plane => plane.kind === kind).length;
  assert.equal(count("hair"), 2);
  assert.equal(count("brow"), 2);
  assert.equal(count("eye"), 4);
  assert.equal(count("nose"), 2);
  assert.equal(count("mouth"), 2);
  assert.ok(count("face") >= 4);
  assert.ok(planes.length <= 18);
  assert.ok(planes.every(plane => plane.owner === "person"));
});
