const RECORDING_MIME_TYPES = [
  "video/webm;codecs=vp8,opus",
  "video/webm;codecs=vp9,opus",
  "video/webm",
];

export const RECORDING_FRAME_RATE = 30;
const FRAME_INTERVAL_MS = 1_000 / RECORDING_FRAME_RATE;
const FRAME_WATCHDOG_INTERVAL_MS = 1_000;
const STALE_FRAME_THRESHOLD_MS = 750;

function monotonicNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

export function chooseRecordingMimeType(MediaRecorderCtor = globalThis.MediaRecorder) {
  if (!MediaRecorderCtor || typeof MediaRecorderCtor.isTypeSupported !== "function") {
    return "";
  }

  for (const mimeType of RECORDING_MIME_TYPES) {
    try {
      if (MediaRecorderCtor.isTypeSupported(mimeType)) {
        return mimeType;
      }
    } catch {
      // Some engines throw for unfamiliar codec strings; try the next candidate.
    }
  }

  return "";
}

export function extensionForMimeType(mimeType) {
  const container = String(mimeType || "").split(";", 1)[0].trim().toLowerCase();

  if (container.includes("mp4")) {
    return "mp4";
  }
  if (container.includes("quicktime")) {
    return "mov";
  }
  if (container.includes("ogg")) {
    return "ogv";
  }
  if (container.includes("webm")) {
    return "webm";
  }

  return "webm";
}

export function recordingTimesliceForMimeType(mimeType) {
  const container = String(mimeType || "").split(";", 1)[0].trim().toLowerCase();
  return container === "video/webm" ? 1_000 : undefined;
}

export class PortraitRecorder {
  constructor({ canvas, renderFrame, audioStream = null, onElapsed = null } = {}) {
    if (!canvas) {
      throw new TypeError("PortraitRecorder requires a canvas");
    }
    if (typeof renderFrame !== "function") {
      throw new TypeError("PortraitRecorder requires a renderFrame function");
    }

    this.canvas = canvas;
    this.renderFrame = renderFrame;
    this.audioStream = audioStream;
    this.onElapsed = typeof onElapsed === "function" ? onElapsed : null;
    this.state = "idle";

    this._canvasStream = null;
    this._borrowedAudioTracks = [];
    this._ownedAudioTracks = [];
    this._recorder = null;
    this._chunks = [];
    this._mimeType = "";
    this._startedAt = 0;
    this._frameHandle = null;
    this._frameHandleIsAnimationFrame = false;
    this._frameWatchdog = null;
    this._lastFrameAt = 0;
    this._elapsedTimer = null;
    this._completion = null;
    this._resolveCompletion = null;
    this._rejectCompletion = null;
    this._settled = false;
    this._lastResult = null;
  }

  async start() {
    if (this.state !== "idle") {
      throw new Error(`Cannot start a recorder while it is ${this.state}`);
    }
    if (typeof this.canvas.captureStream !== "function") {
      throw new Error("This browser cannot capture a canvas stream");
    }

    const MediaRecorderCtor = globalThis.MediaRecorder;
    if (typeof MediaRecorderCtor !== "function") {
      throw new Error("This browser does not support MediaRecorder");
    }

    this.state = "starting";
    this._chunks = [];
    this._lastResult = null;
    this._settled = false;

    try {
      await this.renderFrame();
      this._canvasStream = this.canvas.captureStream(RECORDING_FRAME_RATE);
      this._copyAudioTracks();

      const requestedMimeType = chooseRecordingMimeType(MediaRecorderCtor);
      if (!requestedMimeType) {
        throw new Error(
          "Reliable long recording needs WebM support. Update Safari or use current Chrome.",
        );
      }
      try {
        this._recorder = new MediaRecorderCtor(this._canvasStream, {
          mimeType: requestedMimeType,
        });
        this._mimeType = this._recorder.mimeType || requestedMimeType;
      } catch (error) {
        throw new Error(
          "The browser couldn’t start its reliable WebM encoder. Update it or use current Chrome.",
          { cause: error },
        );
      }

      this._completion = new Promise((resolve, reject) => {
        this._resolveCompletion = resolve;
        this._rejectCompletion = reject;
      });

      this._recorder.ondataavailable = (event) => {
        if (event.data?.size > 0) {
          this._chunks.push(event.data);
        }
      };
      this._recorder.onstop = () => this._finalize();
      this._recorder.onerror = (event) => {
        this._fail(event.error || new Error("The browser stopped recording unexpectedly"));
      };

      this._startedAt = monotonicNow();
      const timeslice = recordingTimesliceForMimeType(this._mimeType);
      this._recorder.start(timeslice);
      this.state = "recording";
      this._notifyElapsed(0);
      this._renderFrame();
      this._scheduleFrame();
      this._startFrameWatchdog();
      this._elapsedTimer = globalThis.setInterval(() => {
        this._notifyElapsed(monotonicNow() - this._startedAt);
      }, 250);

      return {
        mimeType: this._mimeType,
        extension: extensionForMimeType(this._mimeType),
      };
    } catch (error) {
      this._cleanup();
      this.state = "idle";
      throw error;
    }
  }

  async stop() {
    if (this.state === "stopping") {
      return this._completion;
    }
    if (this.state === "idle") {
      if (this._lastResult) {
        return this._lastResult;
      }
      throw new Error("Cannot stop a recorder that has not started");
    }
    if (this.state !== "recording") {
      throw new Error(`Cannot stop a recorder while it is ${this.state}`);
    }

    this.state = "stopping";
    const completion = this._completion;
    this._cancelFrame();
    this._clearFrameWatchdog();
    this._clearElapsedTimer();

    try {
      await this.renderFrame();
    } catch {
      // Preserve the recording even if the final visual refresh fails.
    }

    this._notifyElapsed(monotonicNow() - this._startedAt);

    try {
      if (this._recorder?.state && this._recorder.state !== "inactive") {
        this._recorder.stop();
      } else {
        globalThis.queueMicrotask(() => this._finalize());
      }
    } catch (error) {
      this._fail(error);
    }

    return completion;
  }

  _copyAudioTracks() {
    const sourceTracks = this.audioStream?.getAudioTracks?.() || [];

    for (const sourceTrack of sourceTracks) {
      if (sourceTrack?.readyState === "ended") {
        continue;
      }

      let track = sourceTrack;
      if (typeof sourceTrack?.clone === "function") {
        track = sourceTrack.clone();
        this._ownedAudioTracks.push(track);
      } else {
        this._borrowedAudioTracks.push(track);
      }

      try {
        this._canvasStream.addTrack(track);
      } catch (error) {
        if (track !== sourceTrack) {
          track.stop?.();
          this._ownedAudioTracks = this._ownedAudioTracks.filter((item) => item !== track);
        } else {
          this._borrowedAudioTracks = this._borrowedAudioTracks.filter((item) => item !== track);
        }
        throw error;
      }
    }
  }

  _scheduleFrame() {
    const tick = (frameTime) => {
      this._frameHandle = null;
      if (this.state !== "recording") {
        return;
      }

      const now = Number.isFinite(frameTime) ? frameTime : monotonicNow();
      if (now - this._lastFrameAt >= FRAME_INTERVAL_MS * 0.9) {
        this._renderFrame();
      }

      this._scheduleFrame();
    };

    if (typeof globalThis.requestAnimationFrame === "function") {
      this._frameHandleIsAnimationFrame = true;
      this._frameHandle = globalThis.requestAnimationFrame(tick);
    } else {
      this._frameHandleIsAnimationFrame = false;
      this._frameHandle = globalThis.setTimeout(tick, FRAME_INTERVAL_MS);
    }
  }

  _renderFrame() {
    try {
      this.renderFrame();
      this._lastFrameAt = monotonicNow();
      return true;
    } catch {
      // A transient frame error should not discard already recorded media.
      return false;
    }
  }

  _startFrameWatchdog() {
    this._clearFrameWatchdog();
    this._frameWatchdog = globalThis.setInterval(() => {
      if (
        this.state === "recording" &&
        monotonicNow() - this._lastFrameAt >= STALE_FRAME_THRESHOLD_MS
      ) {
        this._renderFrame();
      }
    }, FRAME_WATCHDOG_INTERVAL_MS);
  }

  _clearFrameWatchdog() {
    if (this._frameWatchdog != null) {
      globalThis.clearInterval(this._frameWatchdog);
      this._frameWatchdog = null;
    }
  }

  refreshFramePump() {
    if (this.state !== "recording") {
      return false;
    }
    this._cancelFrame();
    this._renderFrame();
    this._scheduleFrame();
    return true;
  }

  _cancelFrame() {
    if (this._frameHandle == null) {
      return;
    }

    if (
      this._frameHandleIsAnimationFrame &&
      typeof globalThis.cancelAnimationFrame === "function"
    ) {
      globalThis.cancelAnimationFrame(this._frameHandle);
    } else {
      globalThis.clearTimeout(this._frameHandle);
    }

    this._frameHandle = null;
  }

  _clearElapsedTimer() {
    if (this._elapsedTimer != null) {
      globalThis.clearInterval(this._elapsedTimer);
      this._elapsedTimer = null;
    }
  }

  _notifyElapsed(durationMs) {
    if (!this.onElapsed) {
      return;
    }

    try {
      this.onElapsed(Math.max(0, Math.round(durationMs)));
    } catch {
      // A display callback cannot be allowed to interrupt the recording.
    }
  }

  _finalize() {
    if (this._settled) {
      return;
    }
    this._settled = true;

    const durationMs = Math.max(0, Math.round(monotonicNow() - this._startedAt));
    const chunkMimeType = this._chunks.find((chunk) => chunk.type)?.type || "";
    const mimeType = this._recorder?.mimeType || chunkMimeType || this._mimeType || "video/webm";
    const blob = new Blob(this._chunks, { type: mimeType });
    const result = {
      blob,
      mimeType,
      extension: extensionForMimeType(mimeType),
      durationMs,
    };
    const resolve = this._resolveCompletion;

    this._lastResult = result;
    this._notifyElapsed(durationMs);
    this._cleanup();
    this.state = "idle";
    resolve?.(result);
  }

  _fail(error) {
    if (this._settled) {
      return;
    }
    this._settled = true;
    const reject = this._rejectCompletion;
    this._cleanup();
    this.state = "idle";
    reject?.(error);
  }

  _cleanup() {
    this._cancelFrame();
    this._clearFrameWatchdog();
    this._clearElapsedTimer();

    for (const track of this._ownedAudioTracks) {
      track.stop?.();
    }
    for (const track of this._borrowedAudioTracks) {
      this._canvasStream?.removeTrack?.(track);
    }
    for (const track of this._canvasStream?.getVideoTracks?.() || []) {
      track.stop?.();
    }

    if (this._recorder) {
      this._recorder.ondataavailable = null;
      this._recorder.onstop = null;
      this._recorder.onerror = null;
    }

    this._ownedAudioTracks = [];
    this._borrowedAudioTracks = [];
    this._canvasStream = null;
    this._recorder = null;
    this._chunks = [];
    this._mimeType = "";
    this._lastFrameAt = 0;
    this._frameHandleIsAnimationFrame = false;
    this._completion = null;
    this._resolveCompletion = null;
    this._rejectCompletion = null;
  }
}
