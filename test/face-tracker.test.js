import test from "node:test";
import assert from "node:assert/strict";

import {
  FACE_LANDMARK_COUNT,
  FEATURE_LANDMARKS,
  FaceTracker,
  boxFromLandmarks,
  buildFaceModel,
  monotonicTimestamp,
  packLandmarks,
  smoothCategoryMask,
  smoothLandmarks,
} from "../src/face-tracker.js";

function makeFace(xOffset = 0) {
  return Array.from({ length: FACE_LANDMARK_COUNT }, (_, index) => ({
    x: 0.35 + (index % 19) * 0.015 + xOffset,
    y: 0.22 + (index % 23) * 0.02,
    z: (index % 7) * -0.002,
  }));
}

function nextTask() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

test("landmarks pack into a lean fixed-size transferable buffer", () => {
  const packed = packLandmarks(makeFace());
  assert.ok(packed instanceof Float32Array);
  assert.equal(packed.length, FACE_LANDMARK_COUNT * 3);
  assert.ok(Math.abs(packed[0] - 0.35) < 1e-6);
  assert.throws(() => packLandmarks([{ x: 0, y: 0, z: 0 }]), /478/);
});

test("feature model exposes clamped raw-video boxes for face details", () => {
  const packed = packLandmarks(makeFace());
  const model = buildFaceModel(packed, { detectedAt: 125, confidence: 1.4 });

  assert.equal(model.detectedAt, 125);
  assert.equal(model.confidence, 1);
  assert.deepEqual(Object.keys(model.features), [
    "leftEye", "rightEye", "leftIris", "rightIris", "mouth", "nose",
  ]);
  for (const box of [model.bbox, ...Object.values(model.features)]) {
    assert.ok(box.x >= 0 && box.y >= 0);
    assert.ok(box.width > 0 && box.height > 0);
    assert.ok(box.x + box.width <= 1);
    assert.ok(box.y + box.height <= 1);
  }

  const eye = boxFromLandmarks(packed, FEATURE_LANDMARKS.leftEye);
  assert.ok(eye.width < model.bbox.width);
  assert.ok(eye.height < model.bbox.height);
});

test("smoothing dampens motion while preserving all 478 landmarks", () => {
  const before = packLandmarks(makeFace(0));
  const after = packLandmarks(makeFace(0.2));
  const smoothed = smoothLandmarks(before, after, 0.25);

  assert.equal(smoothed.length, FACE_LANDMARK_COUNT * 3);
  assert.ok(Math.abs(smoothed[0] - 0.4) < 1e-5);
  assert.ok(Math.abs(after[0] - 0.55) < 1e-5, "input remains unchanged");
  assert.equal(monotonicTimestamp(10, 10), 10.001);
  assert.equal(monotonicTimestamp(9, 10), 10.001);
});

test("semantic mask smoothing suppresses one-frame class flicker", () => {
  const first = smoothCategoryMask(null, new Uint8Array([0, 1, 3, 4]), 2, 2, 0.62);
  assert.deepEqual([...first.mask], [0, 1, 3, 4]);

  const flicker = smoothCategoryMask(
    first.probabilities,
    new Uint8Array([0, 1, 0, 4]),
    2,
    2,
    0.45,
  );
  assert.equal(flicker.mask[2], 3, "a single changed sample retains the prior semantic class");

  const settled = smoothCategoryMask(
    flicker.probabilities,
    new Uint8Array([0, 1, 0, 4]),
    2,
    2,
    0.62,
  );
  assert.equal(settled.mask[2], 0, "repeated evidence changes the semantic class");
  assert.throws(
    () => smoothCategoryMask(null, new Uint8Array(3), 2, 2),
    /2 × 2 category mask/,
  );
});

test("tracker reports an unavailable browser pipeline without throwing", () => {
  const tracker = new FaceTracker({ workerFactory: null, createBitmap: null });
  assert.equal(tracker.start(), false);
  assert.equal(tracker.status, "failed");
  assert.match(tracker.error.message, /Worker and createImageBitmap/);
  assert.equal(tracker.getFace(0), null);
});

test("tracker throttles capture, allows one request, smooths, holds, and resumes", async () => {
  let clock = 0;
  let workerCreations = 0;
  const captures = [];
  const listeners = new Map();
  const posted = [];
  const worker = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener() {},
    postMessage(message) {
      posted.push(message);
      if (message.type === "init") listeners.get("message")?.({ data: { type: "ready" } });
    },
    terminate() {},
  };
  const bitmap = { close() {} };
  const tracker = new FaceTracker({
    now: () => clock,
    workerFactory: () => {
      workerCreations += 1;
      return worker;
    },
    createBitmap: async (...arguments_) => {
      captures.push(arguments_);
      return bitmap;
    },
    inferenceIntervalMs: 100,
    holdMs: 300,
    smoothing: 0.5,
  });
  const video = { videoWidth: 1280, videoHeight: 720 };

  assert.equal(tracker.start(), true);
  assert.equal(tracker.status, "ready");
  assert.equal(tracker.update(video, clock), true);
  assert.equal(tracker.update(video, clock), false, "a second request cannot overlap");
  await nextTask();
  const firstRequest = posted.find(message => message.type === "detect");
  assert.ok(firstRequest);
  assert.equal(captures[0][5].resizeWidth, 320);
  assert.equal(captures[0][5].resizeHeight, 180);

  const firstLandmarks = packLandmarks(makeFace(0));
  listeners.get("message")({
    data: {
      type: "result",
      requestId: firstRequest.requestId,
      timestamp: firstRequest.timestamp,
      landmarks: firstLandmarks,
      segmentation: {
        width: 2,
        height: 2,
        data: new Uint8Array([0, 3, 4, 0]),
      },
    },
  });
  assert.equal(tracker.status, "tracking");
  assert.ok(tracker.getFace(250));
  assert.deepEqual([...tracker.getSegmentation(250).data], [0, 3, 4, 0]);
  assert.equal(tracker.getFace(301), null, "face expires after the hold window");

  clock = 150;
  assert.equal(tracker.update(video, clock), true);
  await nextTask();
  const secondRequest = posted.filter(message => message.type === "detect")[1];
  const movedLandmarks = packLandmarks(makeFace(0.2));
  listeners.get("message")({
    data: {
      type: "result",
      requestId: secondRequest.requestId,
      timestamp: secondRequest.timestamp,
      landmarks: movedLandmarks,
    },
  });
  assert.ok(Math.abs(tracker.getFace(150).landmarks[0] - 0.45) < 1e-5);

  tracker.stop();
  assert.equal(tracker.status, "paused");
  assert.equal(tracker.update(video, 300), false);
  assert.equal(tracker.start(), true);
  assert.equal(workerCreations, 1, "resume retains the initialized model worker");
  tracker.dispose();
  assert.equal(tracker.status, "disposed");
});
