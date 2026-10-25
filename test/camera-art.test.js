import test from "node:test";
import assert from "node:assert/strict";

import {
  ABSTRACT_PALETTE,
  ART_FRAME_INTERVAL_MS,
  ART_PALETTE_FAMILIES,
  AbstractCameraRenderer,
  createAdaptiveRectangles,
  createContentAwareRectangles,
  dominantPaletteColor,
  drawVideoFit,
  mapFaceToArtwork,
  mapSegmentationToArtwork,
  paletteColorForStructure,
  quantizeColor,
  stabilizeStructureFamilies,
  trackSceneRectangles,
} from "../src/camera-art.js";

function solidPixels(width, height, [red, green, blue]) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = red;
    pixels[index + 1] = green;
    pixels[index + 2] = blue;
    pixels[index + 3] = 255;
  }
  return pixels;
}

test("abstract rectangles are deterministic, varied, and tile the band exactly", () => {
  const first = createAdaptiveRectangles(720, 300, 42);
  const again = createAdaptiveRectangles(720, 300, 42);
  const variation = createAdaptiveRectangles(720, 300, 43);

  assert.deepEqual(first, again);
  assert.notDeepEqual(first, variation);
  assert.ok(first.length > 100 && first.length < 680);
  assert.equal(
    first.reduce((area, rectangle) => area + rectangle.width * rectangle.height, 0),
    720 * 300,
  );

  for (const rectangle of first) {
    assert.ok(rectangle.width > 0 && rectangle.height > 0);
    assert.ok(rectangle.x >= 0 && rectangle.y >= 0);
    assert.ok(rectangle.x + rectangle.width <= 720);
    assert.ok(rectangle.y + rectangle.height <= 300);
  }

  for (let left = 0; left < first.length; left += 1) {
    for (let right = left + 1; right < first.length; right += 1) {
      const a = first[left];
      const b = first[right];
      const overlapWidth = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapHeight = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      assert.ok(overlapWidth <= 0 || overlapHeight <= 0, "rectangles must not overlap");
    }
  }
});

test("rectangles become materially smaller near the visual centre", () => {
  const rectangles = createAdaptiveRectangles(720, 300, 42);
  const distance = rectangle => Math.hypot(
    (rectangle.x + rectangle.width / 2) / 720 - 0.5,
    (rectangle.y + rectangle.height / 2) / 300 - 0.5,
  );
  const centre = rectangles.filter(rectangle => distance(rectangle) < 0.2);
  const edge = rectangles.filter(rectangle => distance(rectangle) > 0.48);
  const averageArea = group =>
    group.reduce((total, rectangle) => total + rectangle.width * rectangle.height, 0) /
    group.length;

  assert.ok(centre.length > 10 && edge.length > 10);
  assert.ok(averageArea(centre) * 2 < averageArea(edge));
});

test("camera colors map only to the strong fixed painting palette", () => {
  assert.ok(ART_PALETTE_FAMILIES.vermilion.includes(quantizeColor(255, 0, 0)));
  assert.ok(ART_PALETTE_FAMILIES.gold.includes(quantizeColor(255, 240, 0)));
  assert.ok(ART_PALETTE_FAMILIES.cobalt.includes(quantizeColor(0, 40, 255)));
  assert.equal(quantizeColor(0, 0, 0), ART_PALETTE_FAMILIES.ink[0]);
  assert.ok(ART_PALETTE_FAMILIES.paper.includes(quantizeColor(255, 255, 255)));
  assert.ok(ABSTRACT_PALETTE.includes(quantizeColor(122, 93, 181)));
});

test("a chunk chooses its dominant palette color instead of an RGB average", () => {
  const samples = [
    [255, 0, 0], [255, 0, 0], [255, 0, 0], [255, 0, 0], [255, 0, 0], [255, 0, 0],
    [0, 40, 255], [0, 40, 255], [0, 40, 255], [0, 40, 255],
  ];
  assert.ok(ART_PALETTE_FAMILIES.vermilion.includes(dominantPaletteColor(samples)));
  assert.notEqual(dominantPaletteColor(samples), "#993366");
});

test("uniform surfaces collapse into broad fields while texture gains detail", () => {
  const width = 96;
  const height = 48;
  const wall = solidPixels(width, height, [232, 230, 222]);
  const texture = wall.slice();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const value = ((Math.floor(x / 4) + Math.floor(y / 4)) % 2) ? 238 : 28;
      texture[offset] = value;
      texture[offset + 1] = value;
      texture[offset + 2] = value;
    }
  }

  const wallRectangles = createContentAwareRectangles(wall, width, height, 720, 300);
  const textureRectangles = createContentAwareRectangles(texture, width, height, 720, 300);
  assert.equal(wallRectangles.length, 1);
  assert.ok(textureRectangles.length > 80);
  assert.ok(
    Math.max(...wallRectangles.map(rectangle => rectangle.width * rectangle.height)) >
      Math.max(...textureRectangles.map(rectangle => rectangle.width * rectangle.height)) * 10,
  );
});

test("separate adjacent structures receive intentionally contrasting color families", () => {
  const width = 96;
  const height = 48;
  const pixels = solidPixels(width, height, [235, 235, 230]);
  for (let y = 0; y < height; y += 1) {
    for (let x = width / 2; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      pixels[offset] = 25;
      pixels[offset + 1] = 38;
      pixels[offset + 2] = 175;
    }
  }
  const rectangles = createContentAwareRectangles(pixels, width, height, 720, 300);
  assert.equal(rectangles.length, 2);
  assert.notEqual(rectangles[0].family, rectangles[1].family);
  assert.ok(
    ART_PALETTE_FAMILIES.cobalt.includes(
      paletteColorForStructure("cobalt", 0.55, "same-structure"),
    ),
  );
});

test("persistent structures retain their palette family across layout refreshes", () => {
  const stats = { red: 220, green: 215, blue: 205, luminance: 0.82 };
  const previous = [
    { x: 0, y: 0, width: 400, height: 300, family: "teal", stats },
  ];
  const next = [
    {
      x: 0,
      y: 0,
      width: 200,
      height: 300,
      family: "violet",
      structureId: 1,
      stats: { ...stats, red: 218 },
    },
    {
      x: 200,
      y: 0,
      width: 200,
      height: 300,
      family: "violet",
      structureId: 1,
      stats: { ...stats, blue: 207 },
    },
  ];

  stabilizeStructureFamilies(next, previous);
  assert.deepEqual(next.map(rectangle => rectangle.family), ["teal", "teal"]);
});

test("scene component tracks survive scan-order relabelling", () => {
  const previous = [
    {
      x: 0, y: 0, width: 60, height: 40,
      structureId: 4, role: "background", owner: "scene:4", trackId: "wall-a",
    },
    {
      x: 60, y: 0, width: 40, height: 40,
      structureId: 5, role: "face", owner: "person", trackId: "person-a",
    },
  ];
  const next = [
    {
      x: 0, y: 0, width: 58, height: 40,
      structureId: 17, role: "background", owner: "scene:17",
    },
    {
      x: 58, y: 0, width: 42, height: 40,
      structureId: 19, role: "face", owner: "person",
    },
  ];

  const tracked = trackSceneRectangles(next, previous, 10);
  assert.equal(next[0].trackId, "wall-a");
  assert.equal(next[1].trackId, "person-a");
  assert.equal(tracked.nextTrackId, 10);
});

test("a merged scene field keeps the dominant prior component identity", () => {
  const previous = [
    {
      x: 0, y: 0, width: 10, height: 40,
      structureId: 1, role: "background", owner: "scene:1", trackId: "small-fragment",
    },
    {
      x: 20, y: 0, width: 90, height: 40,
      structureId: 2, role: "background", owner: "scene:2", trackId: "dominant-wall",
    },
  ];
  const next = [
    {
      x: 0, y: 0, width: 100, height: 40,
      structureId: 9, role: "background", owner: "scene:9",
    },
  ];

  trackSceneRectangles(next, previous, 3);
  assert.equal(next[0].trackId, "dominant-wall");
});

test("tracked facial geometry maps movement and mirroring into the contained frame", () => {
  const face = {
    bbox: { x: 0.3, y: 0.1, width: 0.4, height: 0.7 },
    features: {
      leftEye: { x: 0.38, y: 0.3, width: 0.07, height: 0.04 },
      rightEye: { x: 0.55, y: 0.3, width: 0.07, height: 0.04 },
      leftIris: { x: 0.4, y: 0.31, width: 0.02, height: 0.02 },
      rightIris: { x: 0.57, y: 0.31, width: 0.02, height: 0.02 },
      nose: { x: 0.46, y: 0.34, width: 0.08, height: 0.22 },
      mouth: { x: 0.42, y: 0.62, width: 0.16, height: 0.07 },
    },
  };
  const mapped = mapFaceToArtwork(face, 1280, 720, 720, 300, false);
  const mirrored = mapFaceToArtwork(face, 1280, 720, 720, 300, true);
  assert.ok(Math.abs(mapped.bbox.x + mirrored.bbox.x + mapped.bbox.width - 720) < 1e-6);

  const moved = mapFaceToArtwork({
    ...face,
    bbox: { ...face.bbox, x: face.bbox.x + 0.1 },
  }, 1280, 720, 720, 300, false);
  assert.ok(moved.bbox.x > mapped.bbox.x);
});

test("semantic categories follow contain gutters and mirroring", () => {
  const segmentation = {
    width: 4,
    height: 2,
    data: new Uint8Array([
      1, 2, 3, 4,
      1, 2, 3, 4,
    ]),
  };
  // A 2:1 source contained in a 4:3 frame leaves one row of gutters above/below.
  const normal = mapSegmentationToArtwork(segmentation, 4, 2, 8, 6, false);
  const mirrored = mapSegmentationToArtwork(segmentation, 4, 2, 8, 6, true);
  assert.deepEqual([...normal.slice(0, 8)], new Array(8).fill(0));
  assert.deepEqual([...normal.slice(8, 16)], [1, 1, 2, 2, 3, 3, 4, 4]);
  assert.deepEqual([...mirrored.slice(8, 16)], [4, 4, 3, 3, 2, 2, 1, 1]);
  assert.equal(mapSegmentationToArtwork(null, 4, 2, 8, 6), null);
});

test("renderer holds complete artwork frames at a deliberate ten-fps cadence", () => {
  let clock = 0;
  let reads = 0;
  const outputContext = {
    fillStyle: "",
    globalAlpha: 1,
    fillRect() {},
    drawImage() {},
    save() {},
    restore() {},
    translate() {},
    scale() {},
  };
  const analysisContext = {
    ...outputContext,
    getImageData(_x, _y, width, height) {
      reads += 1;
      return { data: solidPixels(width, height, [180, 180, 180]) };
    },
  };
  const document = {
    defaultView: { devicePixelRatio: 1 },
    createElement() {
      return {
        width: 1,
        height: 1,
        getContext: () => analysisContext,
      };
    },
  };
  const canvas = {
    ownerDocument: document,
    clientWidth: 48,
    clientHeight: 24,
    width: 48,
    height: 24,
    getContext: () => outputContext,
    getBoundingClientRect: () => ({ width: 48, height: 24 }),
  };
  const video = { videoWidth: 160, videoHeight: 90, readyState: 4, currentTime: 0 };
  const tracker = {
    start() {},
    update() {},
    getFace: () => null,
    getSegmentation: () => null,
  };
  const renderer = new AbstractCameraRenderer({ canvas, video, faceTracker: tracker, now: () => clock });

  assert.equal(renderer.render(false), true);
  for (clock = 16; clock < ART_FRAME_INTERVAL_MS; clock += 16) {
    video.currentTime = clock / 1000;
    assert.equal(renderer.render(false), false);
  }
  assert.equal(reads, 1);
  clock = ART_FRAME_INTERVAL_MS;
  video.currentTime = clock / 1000;
  assert.equal(renderer.render(false), true);
  assert.equal(reads, 2);
  assert.equal(renderer.render(true, true), true, "forced mirror redraw bypasses cadence");
  assert.equal(reads, 3);
  renderer.setMode('mondrian');
  assert.equal(renderer.render(true, true), true, 'Mondrian paints into the same recorded canvas');
  assert.equal(renderer.hasFrame, true);
  assert.ok(Object.keys(renderer.mondrian.colors).length > 0);
  renderer.setMode('rothko-plus');
  Object.assign(outputContext, {beginPath(){}, moveTo(){}, lineTo(){}, closePath(){}, fill(){}});
  assert.equal(renderer.render(true, true), true, 'Rothko+ paints into the shared recording canvas');
  renderer.setMode('rothko');
  assert.equal(renderer.render(true, true), true, 'Rothko remains available after switching modes');
});

test("camera sampling applies mirroring before color analysis", () => {
  const calls = { drawImage: [], scale: [], translate: [] };
  const context = {
    save() {},
    restore() {},
    drawImage(...values) { calls.drawImage.push(values); },
    scale(...values) { calls.scale.push(values); },
    translate(...values) { calls.translate.push(values); },
  };
  const video = { videoWidth: 1600, videoHeight: 900 };

  assert.equal(drawVideoFit(context, video, 192, 80, "cover", true), true);
  assert.deepEqual(calls.translate, [[192, 0]]);
  assert.deepEqual(calls.scale, [[-1, 1]]);
  assert.equal(calls.drawImage[0][0], video);
});
