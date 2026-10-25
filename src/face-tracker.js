// Lightweight main-thread bridge for the scene-analysis worker. Face landmarks
// and a six-class person/background mask are inferred together off the render loop.

export const FACE_LANDMARK_COUNT = 478;
export const LANDMARK_STRIDE = 3;

export const FEATURE_LANDMARKS = Object.freeze({
  leftEye: Object.freeze([
    362, 382, 381, 380, 374, 373, 390, 249,
    263, 466, 388, 387, 386, 385, 384, 398,
  ]),
  rightEye: Object.freeze([
    33, 7, 163, 144, 145, 153, 154, 155,
    133, 173, 157, 158, 159, 160, 161, 246,
  ]),
  leftIris: Object.freeze([474, 475, 476, 477]),
  rightIris: Object.freeze([469, 470, 471, 472]),
  mouth: Object.freeze([
    61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291,
    409, 270, 269, 267, 0, 37, 39, 40, 185, 78, 95, 88,
    178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311,
    312, 13, 82, 81, 80, 191,
  ]),
  nose: Object.freeze([
    1, 2, 4, 5, 6, 19, 45, 48, 64, 94, 97, 98, 115,
    168, 195, 197, 220, 275, 278, 294, 326, 327, 344,
  ]),
});

const ALL_LANDMARKS = Object.freeze(
  Array.from({ length: FACE_LANDMARK_COUNT }, (_, index) => index),
);
const DEFAULT_WORKER_URL = new URL("./face-worker.js", import.meta.url);

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/** Produce timestamps accepted by MediaPipe's VIDEO mode, even after clock jitter. */
export function monotonicTimestamp(value, previous = Number.NEGATIVE_INFINITY) {
  const candidate = finiteNumber(value, 0);
  return candidate > previous ? candidate : previous + 0.001;
}

/** Pack MediaPipe landmark objects into one transferable, allocation-light buffer. */
export function packLandmarks(landmarks) {
  const requiredLength = FACE_LANDMARK_COUNT * LANDMARK_STRIDE;
  if (ArrayBuffer.isView(landmarks)) {
    if (landmarks.length < requiredLength) {
      throw new RangeError(`Expected ${FACE_LANDMARK_COUNT} face landmarks.`);
    }
    return new Float32Array(landmarks.slice(0, requiredLength));
  }
  if (!Array.isArray(landmarks) || landmarks.length < FACE_LANDMARK_COUNT) {
    throw new RangeError(`Expected ${FACE_LANDMARK_COUNT} face landmarks.`);
  }

  const packed = new Float32Array(requiredLength);
  for (let index = 0; index < FACE_LANDMARK_COUNT; index += 1) {
    const landmark = landmarks[index] || {};
    const offset = index * LANDMARK_STRIDE;
    packed[offset] = finiteNumber(landmark.x);
    packed[offset + 1] = finiteNumber(landmark.y);
    packed[offset + 2] = finiteNumber(landmark.z);
  }
  return packed;
}

/** Pure exponential smoothing for a complete landmark buffer. */
export function smoothLandmarks(previous, current, alpha = 0.46) {
  const next = packLandmarks(current);
  const requiredLength = FACE_LANDMARK_COUNT * LANDMARK_STRIDE;
  if (!ArrayBuffer.isView(previous) || previous.length < requiredLength) return next;

  const blend = clamp(finiteNumber(alpha, 0.46), 0, 1);
  for (let index = 0; index < requiredLength; index += 1) {
    next[index] = previous[index] + (next[index] - previous[index]) * blend;
  }
  return next;
}

/** Stabilize the six semantic classes while retaining a crisp category mask. */
export function smoothCategoryMask(
  previous,
  current,
  width,
  height,
  alpha = 0.46,
  classCount = 6,
) {
  const maskWidth = Math.max(1, Math.round(finiteNumber(width, 1)));
  const maskHeight = Math.max(1, Math.round(finiteNumber(height, 1)));
  const length = maskWidth * maskHeight;
  if (!ArrayBuffer.isView(current) || current.length < length) {
    throw new RangeError(`Expected a ${maskWidth} × ${maskHeight} category mask.`);
  }
  const categories = Math.max(2, Math.round(finiteNumber(classCount, 6)));
  const blend = clamp(finiteNumber(alpha, 0.46), 0, 1);
  const probabilities = new Float32Array(length * categories);
  const mask = new Uint8Array(length);
  const canReuse = ArrayBuffer.isView(previous) && previous.length === probabilities.length;
  for (let index = 0; index < length; index += 1) {
    const observed = clamp(Math.round(finiteNumber(current[index])), 0, categories - 1);
    let winner = observed;
    let winnerProbability = Number.NEGATIVE_INFINITY;
    for (let category = 0; category < categories; category += 1) {
      const offset = index * categories + category;
      const target = category === observed ? 1 : 0;
      const probability = canReuse
        ? previous[offset] + (target - previous[offset]) * blend
        : target;
      probabilities[offset] = probability;
      if (probability > winnerProbability) {
        winnerProbability = probability;
        winner = category;
      }
    }
    mask[index] = winner;
  }
  return { probabilities, mask, width: maskWidth, height: maskHeight };
}

/** Return a clamped raw-video normalized box for selected landmarks. */
export function boxFromLandmarks(
  landmarks,
  indices,
  paddingX = 0,
  paddingY = paddingX,
) {
  if (!ArrayBuffer.isView(landmarks)) return null;
  let minimumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;

  for (const index of indices || []) {
    const offset = Number(index) * LANDMARK_STRIDE;
    const x = landmarks[offset];
    const y = landmarks[offset + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minimumX = Math.min(minimumX, x);
    minimumY = Math.min(minimumY, y);
    maximumX = Math.max(maximumX, x);
    maximumY = Math.max(maximumY, y);
  }
  if (!Number.isFinite(minimumX)) return null;

  const width = maximumX - minimumX;
  const height = maximumY - minimumY;
  const horizontalPadding = width * Math.max(0, finiteNumber(paddingX));
  const verticalPadding = height * Math.max(0, finiteNumber(paddingY));
  const x = clamp(minimumX - horizontalPadding, 0, 1);
  const y = clamp(minimumY - verticalPadding, 0, 1);
  const right = clamp(maximumX + horizontalPadding, 0, 1);
  const bottom = clamp(maximumY + verticalPadding, 0, 1);
  return { x, y, width: right - x, height: bottom - y };
}

/** Derive renderer-friendly, raw-video normalized feature regions. */
export function buildFaceModel(landmarks, { detectedAt = 0, confidence } = {}) {
  const packed = packLandmarks(landmarks);
  const model = {
    landmarks: packed,
    bbox: boxFromLandmarks(packed, ALL_LANDMARKS, 0.035, 0.045),
    features: {
      leftEye: boxFromLandmarks(packed, FEATURE_LANDMARKS.leftEye, 0.16, 0.42),
      rightEye: boxFromLandmarks(packed, FEATURE_LANDMARKS.rightEye, 0.16, 0.42),
      leftIris: boxFromLandmarks(packed, FEATURE_LANDMARKS.leftIris, 0.45, 0.45),
      rightIris: boxFromLandmarks(packed, FEATURE_LANDMARKS.rightIris, 0.45, 0.45),
      mouth: boxFromLandmarks(packed, FEATURE_LANDMARKS.mouth, 0.12, 0.34),
      nose: boxFromLandmarks(packed, FEATURE_LANDMARKS.nose, 0.12, 0.1),
    },
    detectedAt: finiteNumber(detectedAt),
  };
  if (Number.isFinite(Number(confidence))) {
    model.confidence = clamp(Number(confidence), 0, 1);
  }
  return model;
}

function defaultWorkerFactory(url) {
  if (typeof globalThis.Worker !== "function") {
    throw new Error("Module Web Workers are unavailable in this browser.");
  }
  return new globalThis.Worker(url, {
    type: "module",
    name: "wricord-scene-analysis",
  });
}

function defaultCreateBitmap(...arguments_) {
  if (typeof globalThis.createImageBitmap !== "function") {
    throw new Error("createImageBitmap is unavailable in this browser.");
  }
  return globalThis.createImageBitmap(...arguments_);
}

function videoDimensions(video) {
  return {
    width: Math.max(0, Math.round(finiteNumber(video?.videoWidth || video?.width))),
    height: Math.max(0, Math.round(finiteNumber(video?.videoHeight || video?.height))),
  };
}

export class FaceTracker {
  constructor({
    workerUrl = DEFAULT_WORKER_URL,
    now = () => globalThis.performance?.now?.() ?? Date.now(),
    workerFactory = defaultWorkerFactory,
    createBitmap = defaultCreateBitmap,
    inferenceIntervalMs = 100,
    holdMs = 650,
    segmentationHoldMs = 1200,
    smoothing = 0.46,
    maskSmoothing = 0.46,
    analysisWidth = 320,
    requestTimeoutMs = 5000,
  } = {}) {
    this.workerUrl = workerUrl;
    this.now = now;
    this.workerFactory = workerFactory;
    this.createBitmap = createBitmap;
    this.inferenceIntervalMs = Math.max(50, finiteNumber(inferenceIntervalMs, 100));
    this.holdMs = Math.max(0, finiteNumber(holdMs, 650));
    this.segmentationHoldMs = Math.max(0, finiteNumber(segmentationHoldMs, 1200));
    this.smoothing = clamp(finiteNumber(smoothing, 0.46), 0, 1);
    this.maskSmoothing = clamp(finiteNumber(maskSmoothing, 0.46), 0, 1);
    this.analysisWidth = Math.max(128, Math.round(finiteNumber(analysisWidth, 320)));
    this.requestTimeoutMs = Math.max(500, finiteNumber(requestTimeoutMs, 5000));

    this._worker = null;
    this._running = false;
    this._disposed = false;
    this._workerReady = false;
    this._inFlight = false;
    this._requestId = 0;
    this._activeRequestId = null;
    this._requestTimer = null;
    this._nextCaptureAt = 0;
    this._clockFloor = Number.NEGATIVE_INFINITY;
    this._lastSubmittedAt = Number.NEGATIVE_INFINITY;
    this._latestFace = null;
    this._latestSegmentation = null;
    this._maskProbabilities = null;
    this._consecutiveErrors = 0;
    this._status = "idle";
    this._error = null;

    this._handleMessage = event => this._onWorkerMessage(event);
    this._handleError = event => this._onWorkerError(event);
  }

  get status() {
    return this._status;
  }

  get error() {
    return this._error;
  }

  get inFlight() {
    return this._inFlight;
  }

  /** Lazily construct and initialize the worker. Safe to call repeatedly. */
  start() {
    if (this._disposed) return false;
    this._running = true;
    this._nextCaptureAt = 0;
    if (this._worker) {
      this._status = this._workerReady ? "ready" : "loading";
      return true;
    }
    const missingNativeWorker = this.workerFactory === defaultWorkerFactory &&
      typeof globalThis.Worker !== "function";
    const missingNativeBitmap = this.createBitmap === defaultCreateBitmap &&
      typeof globalThis.createImageBitmap !== "function";
    if (
      typeof this.workerFactory !== "function" ||
      typeof this.createBitmap !== "function" ||
      missingNativeWorker ||
      missingNativeBitmap
    ) {
      this._fail(new Error("Scene tracking requires a module Worker and createImageBitmap."));
      return false;
    }

    try {
      const worker = this.workerFactory(this.workerUrl, {
        type: "module",
        name: "wricord-scene-analysis",
      });
      if (!worker || typeof worker.postMessage !== "function") {
        throw new Error("The face-tracking Worker could not be created.");
      }
      this._worker = worker;
      worker.addEventListener?.("message", this._handleMessage);
      worker.addEventListener?.("error", this._handleError);
      if (!worker.addEventListener) {
        worker.onmessage = this._handleMessage;
        worker.onerror = this._handleError;
      }
      this._status = "loading";
      worker.postMessage({ type: "init" });
      return true;
    } catch (error) {
      this._fail(error);
      return false;
    }
  }

  /** Pause capture while retaining the loaded model and last landmark state. */
  stop() {
    if (this._disposed) return;
    this._running = false;
    this._nextCaptureAt = 0;
    if (this._status !== "failed") this._status = "paused";
  }

  /**
   * Non-blocking frame submission. Returns true only when a capture was queued.
   * Repeated render-loop calls are cheap and never create overlapping requests.
   */
  update(video, nowMs) {
    if (!this._running || this._disposed || !this._workerReady || this._inFlight) {
      return false;
    }
    const dimensions = videoDimensions(video);
    if (dimensions.width <= 0 || dimensions.height <= 0) return false;

    const observedNow = finiteNumber(nowMs, this.now());
    this._clockFloor = Math.max(this._clockFloor, observedNow);
    if (this._clockFloor < this._nextCaptureAt) return false;

    const timestamp = monotonicTimestamp(this._clockFloor, this._lastSubmittedAt);
    this._lastSubmittedAt = timestamp;
    this._nextCaptureAt = timestamp + this.inferenceIntervalMs;
    this._inFlight = true;
    void this._captureAndSend(video, dimensions, timestamp);
    return true;
  }

  /** Return the held smoothed face, or null once it has gone stale. */
  getFace(nowMs) {
    if (!this._latestFace) return null;
    const observedNow = finiteNumber(nowMs, this.now());
    if (Math.max(0, observedNow - this._latestFace.detectedAt) > this.holdMs) {
      return null;
    }
    return this._latestFace;
  }

  /** Return the latest stabilized raw-video person mask while it is fresh. */
  getSegmentation(nowMs) {
    if (!this._latestSegmentation) return null;
    const observedNow = finiteNumber(nowMs, this.now());
    if (
      Math.max(0, observedNow - this._latestSegmentation.detectedAt) >
      this.segmentationHoldMs
    ) return null;
    return this._latestSegmentation;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._running = false;
    this._clearRequest();
    if (this._worker) {
      try {
        this._worker.postMessage({ type: "dispose" });
      } catch {
        // A failed worker may already be detached.
      }
      this._worker.removeEventListener?.("message", this._handleMessage);
      this._worker.removeEventListener?.("error", this._handleError);
      this._worker.terminate?.();
    }
    this._worker = null;
    this._workerReady = false;
    this._latestFace = null;
    this._latestSegmentation = null;
    this._maskProbabilities = null;
    this._status = "disposed";
  }

  async _captureAndSend(video, dimensions, timestamp) {
    let bitmap = null;
    try {
      const targetWidth = Math.min(this.analysisWidth, dimensions.width);
      const targetHeight = Math.max(
        1,
        Math.round(dimensions.height * (targetWidth / dimensions.width)),
      );
      bitmap = await this.createBitmap(
        video,
        0,
        0,
        dimensions.width,
        dimensions.height,
        {
          resizeWidth: targetWidth,
          resizeHeight: targetHeight,
          resizeQuality: "low",
        },
      );

      if (!this._running || this._disposed || !this._workerReady) {
        bitmap?.close?.();
        this._inFlight = false;
        return;
      }

      const requestId = ++this._requestId;
      this._activeRequestId = requestId;
      this._worker.postMessage(
        { type: "detect", requestId, timestamp, bitmap },
        [bitmap],
      );
      bitmap = null;
      this._requestTimer = setTimeout(() => {
        if (this._activeRequestId !== requestId) return;
        this._clearRequest();
        this._recordRuntimeError(new Error("Scene inference timed out."));
      }, this.requestTimeoutMs);
      this._requestTimer?.unref?.();
    } catch (error) {
      bitmap?.close?.();
      this._inFlight = false;
      this._activeRequestId = null;
      this._recordRuntimeError(error);
    }
  }

  _onWorkerMessage(event) {
    const message = event?.data || {};
    if (message.type === "ready") {
      this._workerReady = true;
      this._consecutiveErrors = 0;
      this._error = null;
      this._status = this._running ? "ready" : "paused";
      return;
    }

    if (message.type === "result") {
      if (message.requestId !== this._activeRequestId) return;
      this._clearRequest();
      this._consecutiveErrors = 0;
      this._error = null;
      const timestamp = finiteNumber(message.timestamp, this._lastSubmittedAt);
      if (message.segmentation?.data) {
        try {
          const width = Number(message.segmentation.width);
          const height = Number(message.segmentation.height);
          const expectedLength = Math.round(width) * Math.round(height);
          const sameDimensions = this._latestSegmentation &&
            this._latestSegmentation.width === Math.round(width) &&
            this._latestSegmentation.height === Math.round(height);
          const stabilized = smoothCategoryMask(
            sameDimensions ? this._maskProbabilities : null,
            message.segmentation.data,
            width,
            height,
            this.maskSmoothing,
          );
          if (stabilized.mask.length !== expectedLength) {
            throw new RangeError("Person mask dimensions do not match its data.");
          }
          this._maskProbabilities = stabilized.probabilities;
          this._latestSegmentation = {
            data: stabilized.mask,
            width: stabilized.width,
            height: stabilized.height,
            detectedAt: timestamp,
          };
        } catch (error) {
          this._recordRuntimeError(error);
        }
      }
      if (!message.landmarks) {
        this._status = this._running && this._latestSegmentation ? "tracking" :
          this._running ? "ready" : "paused";
        return;
      }
      try {
        const previous = this._latestFace &&
          timestamp - this._latestFace.detectedAt <= this.holdMs
          ? this._latestFace.landmarks
          : null;
        const landmarks = smoothLandmarks(previous, message.landmarks, this.smoothing);
        this._latestFace = buildFaceModel(landmarks, {
          detectedAt: timestamp,
          confidence: message.confidence,
        });
        this._status = this._running ? "tracking" : "paused";
      } catch (error) {
        this._recordRuntimeError(error);
      }
      return;
    }

    if (message.type === "error") {
      if (message.requestId === this._activeRequestId) this._clearRequest();
      const error = new Error(message.message || "Scene tracking failed.");
      if (message.phase === "init") this._fail(error);
      else this._recordRuntimeError(error);
    }
  }

  _onWorkerError(event) {
    this._fail(new Error(event?.message || "The scene-analysis Worker stopped unexpectedly."));
  }

  _recordRuntimeError(error) {
    this._error = error instanceof Error ? error : new Error(String(error));
    this._consecutiveErrors += 1;
    if (this._consecutiveErrors >= 3) {
      this._fail(this._error);
      return;
    }
    if (this._status !== "paused") this._status = this._workerReady ? "ready" : "loading";
  }

  _clearRequest() {
    if (this._requestTimer !== null) clearTimeout(this._requestTimer);
    this._requestTimer = null;
    this._inFlight = false;
    this._activeRequestId = null;
  }

  _fail(error) {
    this._clearRequest();
    this._error = error instanceof Error ? error : new Error(String(error));
    if (typeof globalThis.document !== "undefined") {
      globalThis.console?.warn?.("Wricord scene tracking stopped:", this._error);
    }
    this._status = "failed";
    this._running = false;
    this._workerReady = false;
    if (this._worker) {
      this._worker.removeEventListener?.("message", this._handleMessage);
      this._worker.removeEventListener?.("error", this._handleError);
      this._worker.terminate?.();
      this._worker = null;
    }
  }
}
