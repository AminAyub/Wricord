import test from "node:test";
import assert from "node:assert/strict";

import { drawCameraBand, drawContain, drawCover, wrapText } from "../src/compositor.js";
import {
  PortraitRecorder,
  chooseRecordingMimeType,
  extensionForMimeType,
  recordingTimesliceForMimeType,
} from "../src/recorder.js";

class FakeMediaRecorder {
  static supported = new Set();

  static isTypeSupported(mimeType) {
    return this.supported.has(mimeType);
  }
}

test("prefers long-recording-safe WebM when WebM and MP4 are both supported", () => {
  FakeMediaRecorder.supported = new Set([
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9,opus",
  ]);

  assert.equal(
    chooseRecordingMimeType(FakeMediaRecorder),
    "video/webm;codecs=vp8,opus",
  );
});

test("falls back through supported WebM variants and rejects unknown support", () => {
  FakeMediaRecorder.supported = new Set(["video/webm;codecs=vp8,opus"]);
  assert.equal(chooseRecordingMimeType(FakeMediaRecorder), "video/webm;codecs=vp8,opus");

  FakeMediaRecorder.supported = new Set();
  assert.equal(chooseRecordingMimeType(FakeMediaRecorder), "");
  assert.equal(chooseRecordingMimeType(undefined), "");
});

test("maps recorder MIME containers to download extensions", () => {
  assert.equal(extensionForMimeType("video/mp4;codecs=avc1.42E01E"), "mp4");
  assert.equal(extensionForMimeType("video/webm;codecs=vp9,opus"), "webm");
  assert.equal(extensionForMimeType("video/quicktime"), "mov");
  assert.equal(extensionForMimeType(""), "webm");
});

test("uses short WebM chunks and avoids Safari's continuous MP4 path", () => {
  assert.equal(recordingTimesliceForMimeType("video/mp4;codecs=h264,aac"), undefined);
  assert.equal(recordingTimesliceForMimeType("video/quicktime"), undefined);
  assert.equal(recordingTimesliceForMimeType(""), undefined);
  assert.equal(recordingTimesliceForMimeType("video/webm;codecs=vp8,opus"), 1_000);
});

test("wrapText respects measured widths and explicit newlines", () => {
  const context = {
    measureText(value) {
      return { width: Array.from(value).length };
    },
  };

  assert.deepEqual(wrapText(context, "small words\n\nagain", 6), [
    "small",
    "words",
    "",
    "again",
  ]);
});

test("wrapText breaks a single overlong word without splitting graphemes", () => {
  const context = {
    measureText(value) {
      return { width: Array.from(value).length };
    },
  };

  assert.deepEqual(wrapText(context, "abcdefgh", 3), ["abc", "def", "gh"]);
  assert.deepEqual(wrapText(context, "", 3), [""]);
});

function fakeDrawingContext() {
  const calls = {
    drawImage: [],
    fillRect: [],
    scale: [],
    translate: [],
  };

  return {
    calls,
    beginPath() {},
    clip() {},
    rect() {},
    restore() {},
    save() {},
    drawImage(...args) {
      calls.drawImage.push(args);
    },
    fillRect(...args) {
      calls.fillRect.push(args);
    },
    scale(...args) {
      calls.scale.push(args);
    },
    translate(...args) {
      calls.translate.push(args);
    },
  };
}

test("drawCover crops the source without stretching it", () => {
  const context = fakeDrawingContext();
  const source = { videoWidth: 1600, videoHeight: 900 };

  assert.equal(drawCover(context, source, { x: 10, y: 20, width: 100, height: 100 }), true);
  assert.deepEqual(context.calls.drawImage[0], [
    source,
    350,
    0,
    900,
    900,
    10,
    20,
    100,
    100,
  ]);
});

test("the compositor uses the filtered artwork across the whole camera band", () => {
  const context = fakeDrawingContext();
  const video = { videoWidth: 1280, videoHeight: 720 };
  const artwork = { width: 720, height: 300 };
  const band = { x: 0, y: 0, width: 1080, height: 450 };

  drawCameraBand(context, video, artwork, band, true, true);

  assert.equal(context.calls.drawImage.length, 1);
  assert.equal(context.calls.drawImage[0][0], artwork);
  assert.deepEqual(context.calls.drawImage[0].slice(-4), [0, 0, 1080, 450]);
  assert.deepEqual(context.calls.scale, []);
});

test("drawContain preserves the full source and centers mirrored output", () => {
  const context = fakeDrawingContext();
  const source = { videoWidth: 1600, videoHeight: 900 };

  assert.equal(
    drawContain(context, source, { x: 10, y: 20, width: 100, height: 100 }, true),
    true,
  );
  assert.deepEqual(context.calls.translate, [[110, 41.875]]);
  assert.deepEqual(context.calls.scale, [[-1, 1]]);
  assert.deepEqual(context.calls.drawImage[0], [
    source,
    0,
    0,
    1600,
    900,
    0,
    0,
    100,
    56.25,
  ]);
});

function fakeCanvas(onVideoTrackStop) {
  const videoTrack = { stop: onVideoTrackStop };
  const stream = {
    addTrack() {},
    getVideoTracks() {
      return [videoTrack];
    },
    removeTrack() {},
  };

  return {
    captureStream(frameRate) {
      assert.equal(frameRate, 30);
      return stream;
    },
  };
}

class VirtualRecordingClock {
  constructor() {
    this.now = 0;
    this.nextId = 1;
    this.animationFrames = new Map();
    this.timers = new Map();
  }

  requestAnimationFrame(callback) {
    const id = this.nextId++;
    this.animationFrames.set(id, callback);
    return id;
  }

  cancelAnimationFrame(id) {
    this.animationFrames.delete(id);
  }

  setTimeout(callback, delay = 0) {
    return this.#addTimer(callback, delay, false);
  }

  clearTimeout(id) {
    this.timers.delete(id);
  }

  setInterval(callback, interval = 0) {
    return this.#addTimer(callback, interval, true);
  }

  clearInterval(id) {
    this.timers.delete(id);
  }

  #addTimer(callback, delay, repeating) {
    const id = this.nextId++;
    const normalizedDelay = Math.max(1, Number(delay) || 0);
    this.timers.set(id, {
      callback,
      dueAt: this.now + normalizedDelay,
      interval: normalizedDelay,
      repeating,
    });
    return id;
  }

  advanceTimers(milliseconds) {
    const target = this.now + milliseconds;

    while (true) {
      let nextId = null;
      let nextTimer = null;
      for (const [id, timer] of this.timers) {
        if (timer.dueAt <= target && (!nextTimer || timer.dueAt < nextTimer.dueAt)) {
          nextId = id;
          nextTimer = timer;
        }
      }
      if (!nextTimer) {
        break;
      }

      this.now = nextTimer.dueAt;
      if (nextTimer.repeating && this.timers.has(nextId)) {
        nextTimer.dueAt += nextTimer.interval;
      } else {
        this.timers.delete(nextId);
      }
      nextTimer.callback();
    }

    this.now = target;
  }

  fireAnimationFrame() {
    const callbacks = [...this.animationFrames.values()];
    this.animationFrames.clear();
    for (const callback of callbacks) {
      callback(this.now);
    }
  }
}

class FakeVisibilityDocument {
  constructor() {
    this.visibilityState = "visible";
    this.listeners = new Set();
  }

  addEventListener(type, callback) {
    if (type === "visibilitychange") {
      this.listeners.add(callback);
    }
  }

  removeEventListener(type, callback) {
    if (type === "visibilitychange") {
      this.listeners.delete(callback);
    }
  }

  setVisibility(state) {
    this.visibilityState = state;
    for (const callback of this.listeners) {
      callback({ type: "visibilitychange", target: this });
    }
  }
}

function installVirtualRecordingEnvironment(clock, MediaRecorderCtor, document) {
  const originalDescriptors = new Map();
  const replacements = {
    MediaRecorder: MediaRecorderCtor,
    performance: { now: () => clock.now },
    requestAnimationFrame: (callback) => clock.requestAnimationFrame(callback),
    cancelAnimationFrame: (id) => clock.cancelAnimationFrame(id),
    setTimeout: (callback, delay) => clock.setTimeout(callback, delay),
    clearTimeout: (id) => clock.clearTimeout(id),
    setInterval: (callback, interval) => clock.setInterval(callback, interval),
    clearInterval: (id) => clock.clearInterval(id),
  };
  if (document) {
    replacements.document = document;
  }

  for (const [name, replacement] of Object.entries(replacements)) {
    originalDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value: replacement,
    });
  }

  return () => {
    for (const [name, descriptor] of originalDescriptors) {
      if (descriptor) {
        Object.defineProperty(globalThis, name, descriptor);
      } else {
        delete globalThis[name];
      }
    }
  };
}

function simulatedMediaRecorder(clock) {
  return class SimulatedMediaRecorder {
    static lastInstance = null;

    static isTypeSupported(mimeType) {
      return mimeType === "video/webm;codecs=vp8,opus";
    }

    constructor(_stream, { mimeType } = {}) {
      this.mimeType = mimeType || "video/webm";
      this.state = "inactive";
      this.timeslice = null;
      this.chunkTimer = null;
      this.constructor.lastInstance = this;
    }

    start(timeslice) {
      this.state = "recording";
      this.timeslice = timeslice;
      this.chunkTimer = clock.setInterval(() => {
        this.ondataavailable?.({ data: new Blob(["x"], { type: this.mimeType }) });
      }, timeslice);
    }

    stop() {
      this.state = "inactive";
      clock.clearInterval(this.chunkTimer);
      this.ondataavailable?.({ data: new Blob(["x"], { type: this.mimeType }) });
      this.onstop?.();
    }
  };
}

test("PortraitRecorder preserves four minutes of chunks and monotonic duration", async () => {
  const clock = new VirtualRecordingClock();
  const MediaRecorderCtor = simulatedMediaRecorder(clock);
  const restore = installVirtualRecordingEnvironment(clock, MediaRecorderCtor);
  let renderCount = 0;
  const elapsed = [];

  try {
    const recorder = new PortraitRecorder({
      canvas: fakeCanvas(() => {}),
      renderFrame() {
        renderCount += 1;
      },
      onElapsed(milliseconds) {
        elapsed.push(milliseconds);
      },
    });

    await recorder.start();
    for (let frame = 0; frame < 7_200; frame += 1) {
      clock.advanceTimers(1_000 / 30);
      clock.fireAnimationFrame();
    }
    // Avoid floating-point drift from the simulated 30 Hz cadence.
    clock.advanceTimers(240_000 - clock.now);

    const result = await recorder.stop();

    assert.equal(MediaRecorderCtor.lastInstance.timeslice, 1_000);
    assert.equal(result.mimeType, "video/webm;codecs=vp8,opus");
    assert.equal(result.durationMs, 240_000);
    assert.equal(result.blob.size, 241);
    assert.ok(renderCount >= 7_200, `expected continuous frames, received ${renderCount}`);
    assert.equal(elapsed.at(-1), 240_000);
  } finally {
    restore();
  }
});

test("PortraitRecorder keeps refreshing when animation frames are suspended", async () => {
  const clock = new VirtualRecordingClock();
  const MediaRecorderCtor = simulatedMediaRecorder(clock);
  const document = new FakeVisibilityDocument();
  const restore = installVirtualRecordingEnvironment(clock, MediaRecorderCtor, document);
  let renderCount = 0;

  try {
    const recorder = new PortraitRecorder({
      canvas: fakeCanvas(() => {}),
      renderFrame() {
        renderCount += 1;
      },
    });

    await recorder.start();
    // Browsers may suspend RAF for an occluded or backgrounded page while
    // MediaRecorder itself continues accepting the canvas stream.
    document.setVisibility("hidden");
    clock.advanceTimers(240_000);
    const result = await recorder.stop();

    assert.equal(result.durationMs, 240_000);
    assert.ok(
      renderCount >= 241,
      `the canvas froze after its initial frame (received ${renderCount} renders)`,
    );
  } finally {
    restore();
  }
});

test("PortraitRecorder refuses an MP4-only browser for long sessions", async () => {
  const originalMediaRecorder = globalThis.MediaRecorder;
  let stoppedTracks = 0;

  class Mp4OnlyRecorder {
    static isTypeSupported(mimeType) {
      return mimeType.startsWith("video/mp4");
    }
  }

  globalThis.MediaRecorder = Mp4OnlyRecorder;
  try {
    const recorder = new PortraitRecorder({
      canvas: fakeCanvas(() => {
        stoppedTracks += 1;
      }),
      renderFrame() {},
    });

    await assert.rejects(recorder.start(), /needs WebM support/);
    assert.equal(recorder.state, "idle");
    assert.equal(stoppedTracks, 1);
  } finally {
    if (originalMediaRecorder === undefined) {
      delete globalThis.MediaRecorder;
    } else {
      globalThis.MediaRecorder = originalMediaRecorder;
    }
  }
});

test("PortraitRecorder returns its result when a recorder stops synchronously", async () => {
  const originalMediaRecorder = globalThis.MediaRecorder;
  let stoppedTracks = 0;

  class ImmediateMediaRecorder {
    static isTypeSupported() {
      return true;
    }

    constructor() {
      this.mimeType = "video/webm";
      this.state = "inactive";
    }

    start() {
      this.state = "recording";
    }

    stop() {
      this.state = "inactive";
      this.ondataavailable?.({
        data: new Blob(["frame"], { type: this.mimeType }),
      });
      this.onstop?.();
    }
  }

  globalThis.MediaRecorder = ImmediateMediaRecorder;
  try {
    const recorder = new PortraitRecorder({
      canvas: fakeCanvas(() => {
        stoppedTracks += 1;
      }),
      renderFrame() {},
    });

    await recorder.start();
    const result = await recorder.stop();

    assert.equal(result.mimeType, "video/webm");
    assert.equal(result.extension, "webm");
    assert.equal(result.blob.size, 5);
    assert.equal(recorder.state, "idle");
    assert.equal(stoppedTracks, 1);
  } finally {
    if (originalMediaRecorder === undefined) {
      delete globalThis.MediaRecorder;
    } else {
      globalThis.MediaRecorder = originalMediaRecorder;
    }
  }
});

test("PortraitRecorder rejects a synchronous stop error and still cleans up", async () => {
  const originalMediaRecorder = globalThis.MediaRecorder;
  let stoppedTracks = 0;

  class FailingMediaRecorder {
    static isTypeSupported() {
      return true;
    }

    constructor() {
      this.mimeType = "video/webm";
      this.state = "inactive";
    }

    start() {
      this.state = "recording";
    }

    stop() {
      throw new Error("encoder stopped accepting data");
    }
  }

  globalThis.MediaRecorder = FailingMediaRecorder;
  try {
    const recorder = new PortraitRecorder({
      canvas: fakeCanvas(() => {
        stoppedTracks += 1;
      }),
      renderFrame() {},
    });

    await recorder.start();
    await assert.rejects(recorder.stop(), /encoder stopped accepting data/);
    assert.equal(recorder.state, "idle");
    assert.equal(stoppedTracks, 1);
  } finally {
    if (originalMediaRecorder === undefined) {
      delete globalThis.MediaRecorder;
    } else {
      globalThis.MediaRecorder = originalMediaRecorder;
    }
  }
});
