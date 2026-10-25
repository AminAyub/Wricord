import {
  FaceLandmarker,
  FilesetResolver,
  ImageSegmenter,
} from "/vendor/mediapipe/vision_bundle.mjs";

const LANDMARK_COUNT = 478;
const LANDMARK_STRIDE = 3;
const MODEL_PATH = "/models/face_landmarker.task";
const SEGMENTATION_MODEL_PATH = "/models/selfie_multiclass_256x256.tflite";
const WASM_PATH = "/vendor/mediapipe/wasm";

let landmarker = null;
let segmenter = null;
let initialization = null;
let busy = false;

async function filesetFor(taskName) {
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH, true);
  // tasks-vision 1.0.1 clears its worker-global ModuleFactory after creating a
  // task. A distinct module URL re-evaluates the pinned loader for each task
  // while both tasks continue to share the same local WASM binary.
  return {
    ...fileset,
    wasmLoaderPath: `${fileset.wasmLoaderPath}?wricord-task=${taskName}`,
  };
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || "Unknown face-tracking error");
}

function packFace(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length < LANDMARK_COUNT) return null;
  const packed = new Float32Array(LANDMARK_COUNT * LANDMARK_STRIDE);
  let confidenceTotal = 0;
  let confidenceSamples = 0;

  for (let index = 0; index < LANDMARK_COUNT; index += 1) {
    const landmark = landmarks[index] || {};
    const offset = index * LANDMARK_STRIDE;
    packed[offset] = Number.isFinite(landmark.x) ? landmark.x : 0;
    packed[offset + 1] = Number.isFinite(landmark.y) ? landmark.y : 0;
    packed[offset + 2] = Number.isFinite(landmark.z) ? landmark.z : 0;
    const confidence = Number.isFinite(landmark.presence)
      ? landmark.presence
      : landmark.visibility;
    if (Number.isFinite(confidence)) {
      confidenceTotal += confidence;
      confidenceSamples += 1;
    }
  }

  return {
    landmarks: packed,
    confidence: confidenceSamples ? confidenceTotal / confidenceSamples : undefined,
  };
}

async function initialize() {
  if (landmarker && segmenter) return { landmarker, segmenter };
  if (!initialization) {
    initialization = (async () => {
      const faceFileset = await filesetFor("face");
      const nextLandmarker = await FaceLandmarker.createFromOptions(faceFileset, {
        baseOptions: {
          modelAssetPath: MODEL_PATH,
          delegate: "CPU",
        },
        runningMode: "VIDEO",
        numFaces: 1,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      });
      let nextSegmenter;
      try {
        const segmentationFileset = await filesetFor("segmenter-gpu");
        nextSegmenter = await ImageSegmenter.createFromOptions(segmentationFileset, {
          baseOptions: {
            modelAssetPath: SEGMENTATION_MODEL_PATH,
            delegate: "GPU",
          },
          canvas: new OffscreenCanvas(1, 1),
          runningMode: "VIDEO",
          outputCategoryMask: true,
          outputConfidenceMasks: false,
        });
      } catch {
        // CPU keeps the effect usable on Chrome installations where a worker
        // WebGL context is unavailable; the held-frame cadence degrades cleanly.
        const cpuFileset = await filesetFor("segmenter-cpu");
        nextSegmenter = await ImageSegmenter.createFromOptions(cpuFileset, {
          baseOptions: {
            modelAssetPath: SEGMENTATION_MODEL_PATH,
            delegate: "CPU",
          },
          runningMode: "VIDEO",
          outputCategoryMask: true,
          outputConfidenceMasks: false,
        });
      }
      landmarker = nextLandmarker;
      segmenter = nextSegmenter;
      return { landmarker, segmenter };
    })();
  }
  try {
    return await initialization;
  } catch (error) {
    initialization = null;
    throw error;
  }
}

async function handleInit() {
  try {
    await initialize();
    self.postMessage({ type: "ready" });
  } catch (error) {
    self.postMessage({ type: "error", phase: "init", message: errorMessage(error) });
  }
}

function handleDetect({ requestId, timestamp, bitmap }) {
  if (!bitmap) {
    self.postMessage({
      type: "error",
      phase: "detect",
      requestId,
      message: "No camera frame was provided.",
    });
    return;
  }
  if (!landmarker || !segmenter || busy) {
    bitmap.close?.();
    self.postMessage({
      type: "error",
      phase: "detect",
      requestId,
      message: busy ? "Scene inference is already running." : "Vision models are not ready.",
    });
    return;
  }

  busy = true;
  try {
    let segmentation = null;
    segmenter.segmentForVideo(bitmap, timestamp, result => {
      try {
        const categoryMask = result?.categoryMask;
        if (!categoryMask) return;
        segmentation = {
          width: categoryMask.width,
          height: categoryMask.height,
          data: new Uint8Array(categoryMask.getAsUint8Array()),
        };
      } finally {
        result?.close?.();
      }
    });
    const result = landmarker.detectForVideo(bitmap, timestamp);
    const packed = packFace(result?.faceLandmarks?.[0]);
    const message = {
      type: "result",
      requestId,
      timestamp,
      landmarks: packed?.landmarks || null,
      segmentation,
    };
    if (Number.isFinite(packed?.confidence)) message.confidence = packed.confidence;
    const transfer = [];
    if (packed?.landmarks) transfer.push(packed.landmarks.buffer);
    if (segmentation?.data) transfer.push(segmentation.data.buffer);
    self.postMessage(message, transfer);
  } catch (error) {
    self.postMessage({
      type: "error",
      phase: "detect",
      requestId,
      message: errorMessage(error),
    });
  } finally {
    busy = false;
    bitmap.close?.();
  }
}

self.addEventListener("message", event => {
  const message = event.data || {};
  if (message.type === "init") {
    void handleInit();
  } else if (message.type === "detect") {
    handleDetect(message);
  } else if (message.type === "dispose") {
    landmarker?.close?.();
    segmenter?.close?.();
    landmarker = null;
    segmenter = null;
    initialization = null;
    self.close();
  }
});
