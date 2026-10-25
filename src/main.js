import { AbstractCameraRenderer } from "./camera-art.js";
import { renderComposition } from "./compositor.js";
import { FaceTracker } from "./face-tracker.js";
import { PagedEditor } from "./pages.js";
import {
  applyBlockMarkdownShortcut,
  applyInlineMarkdownKeystroke,
  applyInlineMarkdownShortcut,
  editorToMarkdown,
  exitFormattedBlockOnEnter,
  markdownToHtml,
  toggleInlineFormat,
} from "./markdown.js";
import { PortraitRecorder } from "./recorder.js";
import { saveRecordingPair } from "./saver.js";
import {
  formatTimestamp,
  parseLocalDateTime,
  recordingFilename,
  toDateInputValue,
  toTimeInputValue,
} from "./time.js";

const elements = {
  stage: document.querySelector("#portraitStage"),
  cameraPane: document.querySelector(".camera-pane"),
  video: document.querySelector("#cameraPreview"),
  cameraBackdrop: document.querySelector("#cameraBackdrop"),
  cameraArt: document.querySelector("#cameraArt"),
  cameraScrim: document.querySelector("#cameraScrim"),
  cameraMessage: document.querySelector("#cameraMessage"),
  enableCamera: document.querySelector("#enableCamera"),
  statusDot: document.querySelector("#statusDot"),
  statusLabel: document.querySelector("#statusLabel"),
  recordButton: document.querySelector("#recordButton"),
  recordButtonText: document.querySelector("#recordButtonText"),
  artButton: document.querySelector("#artButton"),
  micButton: document.querySelector("#micButton"),
  mirrorButton: document.querySelector("#mirrorButton"),
  editor: document.querySelector("#editor"),
  timestampButton: document.querySelector("#timestampButton"),
  timestamp: document.querySelector("#timestamp"),
  timeDialog: document.querySelector("#timeDialog"),
  timeForm: document.querySelector("#timeForm"),
  manualDate: document.querySelector("#manualDate"),
  manualTime: document.querySelector("#manualTime"),
  cancelTime: document.querySelector("#cancelTime"),
  toast: document.querySelector("#toast"),
  canvas: document.querySelector("#captureCanvas"),
};

const storageKeys = {
  text: "wricord.text",
  timeMode: "wricord.timeMode",
  manualTime: "wricord.manualTime",
  mirrored: "wricord.mirrored",
  abstractCamera: "wricord.abstractCamera",
  paintingMode: "wricord.paintingMode",
  mondrianOptions: "wricord.mondrianOptions",
};

const readStorage = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeStorage = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The app still works when private browsing blocks persistent storage.
  }
};

const state = {
  cameraStream: null,
  microphoneStream: null,
  cameraReady: false,
  microphoneEnabled: false,
  mirrored: readStorage(storageKeys.mirrored) !== "false",
  abstractEnabled: readStorage(storageKeys.abstractCamera) === "true",
  paintingMode: ['mondrian', 'rothko-plus'].includes(readStorage(storageKeys.paintingMode)) ? readStorage(storageKeys.paintingMode) : 'rothko',
  recorder: null,
  recording: false,
  recordingExtension: null,
  timestampMode: readStorage(storageKeys.timeMode) === "manual" ? "manual" : "current",
  manualTimestamp: null,
  lastRecording: null,
  saveDirectory: null,
  directoryPromptAttempted: false,
  toastTimer: null,
  controlsTimer: null,
  wakeLock: null,
  visionFailureReported: false,
};

const faceTracker = new FaceTracker();
const abstractCamera = new AbstractCameraRenderer({
  canvas: elements.cameraArt,
  video: elements.video,
  faceTracker,
  getMirror: () => state.mirrored,
});
abstractCamera.setMode(state.paintingMode);
abstractCamera.debugCanvas = document.querySelector('#paintingDebug');
try { abstractCamera.mondrian.setOptions(JSON.parse(readStorage(storageKeys.mondrianOptions) || '{}')); } catch { /* Defaults remain usable. */ }

const storedManualTimestamp = Number(readStorage(storageKeys.manualTime));
if (Number.isFinite(storedManualTimestamp) && storedManualTimestamp > 0) {
  state.manualTimestamp = new Date(storedManualTimestamp);
}
if (!state.manualTimestamp || Number.isNaN(state.manualTimestamp.getTime())) {
  state.manualTimestamp = new Date();
}

elements.editor.innerHTML = markdownToHtml(readStorage(storageKeys.text) ?? "");
elements.editor.setAttribute("aria-label", "Writing area");
const pagedEditor = new PagedEditor(elements.editor, {
  previous: document.querySelector("#previousPage"),
  next: document.querySelector("#nextPage"),
  label: document.querySelector("#pageNumber"),
});
requestAnimationFrame(() => pagedEditor.paginate());
let paginationFrame;
new ResizeObserver(() => {
  cancelAnimationFrame(paginationFrame);
  paginationFrame = requestAnimationFrame(() => pagedEditor.paginate());
}).observe(elements.editor);

function persistEditor() {
  pagedEditor.paginate();
  const markdown = pagedEditor.markdown(editorToMarkdown);
  writeStorage(storageKeys.text, markdown);
  return markdown;
}

function currentTimestampDate() {
  return state.timestampMode === "manual" ? state.manualTimestamp : new Date();
}

function refreshTimestamp() {
  const value = currentTimestampDate();
  const displayValue = formatTimestamp(value);
  elements.timestamp.dateTime = value.toISOString();
  if (elements.timestamp.textContent !== displayValue) {
    elements.timestamp.textContent = displayValue;
  }
}

function formatElapsed(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function setStatus(label, active = false) {
  elements.statusLabel.textContent = label;
  elements.statusDot.classList.toggle("is-active", active);
}

function showToast(message, actionLabel, action) {
  window.clearTimeout(state.toastTimer);
  elements.toast.hidden = false;
  elements.toast.replaceChildren();

  const messageNode = document.createElement("span");
  messageNode.textContent = message;
  elements.toast.append(messageNode);

  const actions = Array.isArray(actionLabel)
    ? actionLabel
    : actionLabel && action
      ? [[actionLabel, action]]
      : [];

  for (const [label, callback] of actions) {
    const actionButton = document.createElement("button");
    actionButton.type = "button";
    actionButton.textContent = label;
    actionButton.addEventListener("click", callback);
    elements.toast.append(actionButton);
  }

  elements.toast.classList.add("is-visible");
  state.toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
    elements.toast.hidden = true;
  }, actions.length ? 10_000 : 4_000);
}

function setCameraMessage(message, buttonLabel = "Enable camera") {
  elements.cameraMessage.textContent = message;
  elements.enableCamera.textContent = buttonLabel;
  elements.cameraScrim.hidden = false;
}

function stopStream(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}

async function enableCamera() {
  if (state.cameraReady && state.cameraStream?.active) {
    return true;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    setCameraMessage("Camera access needs a current browser opened on localhost.", "Try again");
    setStatus("Camera unavailable");
    return false;
  }

  elements.enableCamera.disabled = true;
  elements.cameraMessage.textContent = "Connecting to your camera…";
  elements.cameraScrim.hidden = false;

  try {
    stopStream(state.cameraStream);
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: "user",
        width: { ideal: 1280, max: 1920 },
        height: { ideal: 720, max: 1080 },
        frameRate: { ideal: 30, max: 30 },
      },
    });

    state.cameraStream = stream;
    const cameraViews = [elements.video, elements.cameraBackdrop].filter(Boolean);
    for (const cameraView of cameraViews) {
      cameraView.srcObject = stream;
    }
    await Promise.all(cameraViews.map((cameraView) => cameraView.play()));
    if (state.abstractEnabled) abstractCamera.restart();
    state.cameraReady = true;
    document.body.classList.add("camera-ready");
    elements.cameraScrim.hidden = true;
    setStatus("Ready");

    stream.getVideoTracks()[0]?.addEventListener("ended", () => {
      abstractCamera.stop();
      state.cameraReady = false;
      document.body.classList.remove("camera-ready");
      setCameraMessage("Your camera stopped. Reconnect it to keep recording.", "Reconnect");
      setStatus("Camera stopped");
    });

    return true;
  } catch (error) {
    state.cameraReady = false;
    document.body.classList.remove("camera-ready");
    const blocked = error?.name === "NotAllowedError" || error?.name === "SecurityError";
    setCameraMessage(
      blocked
        ? "Camera access is off. Allow it in your browser, then try again."
        : "I couldn’t find an available camera. Check the connection and try again.",
      "Try again",
    );
    setStatus(blocked ? "Camera permission needed" : "Camera unavailable");
    return false;
  } finally {
    elements.enableCamera.disabled = false;
  }
}

const micIcons = {
  on: `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 15.25a3.75 3.75 0 0 0 3.75-3.75v-5a3.75 3.75 0 1 0-7.5 0v5A3.75 3.75 0 0 0 12 15.25Z"/><path d="M5.75 11.25a6.25 6.25 0 0 0 12.5 0M12 17.5v3M9.25 20.5h5.5"/></svg>`,
  off: `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m4 4 16 16M9.25 10.25V6.5a2.75 2.75 0 0 1 5.5 0v6.75M5.75 11.25a6.25 6.25 0 0 0 10.8 4.28M18.25 11.25a6.2 6.2 0 0 1-.39 2.18M12 17.5v3M9.25 20.5h5.5"/></svg>`,
};

const mirrorIcon = `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3v18M8.25 6.5H5.5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2.75M15.75 6.5h2.75a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-2.75"/></svg>`;

function updateMicrophoneButton() {
  elements.micButton.innerHTML = state.microphoneEnabled ? micIcons.on : micIcons.off;
  elements.micButton.classList.toggle("is-active", state.microphoneEnabled);
  elements.micButton.setAttribute("aria-pressed", String(state.microphoneEnabled));
  elements.micButton.setAttribute(
    "aria-label",
    state.microphoneEnabled ? "Turn microphone off" : "Turn microphone on",
  );
  elements.micButton.title = state.microphoneEnabled ? "Microphone on" : "Microphone off";
}

async function toggleMicrophone() {
  if (state.recording) {
    return;
  }

  if (state.microphoneEnabled) {
    stopStream(state.microphoneStream);
    state.microphoneStream = null;
    state.microphoneEnabled = false;
    updateMicrophoneButton();
    showToast("Microphone off");
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    showToast("Microphone access is unavailable in this browser.");
    return;
  }

  elements.micButton.disabled = true;
  try {
    state.microphoneStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true,
      },
      video: false,
    });
    state.microphoneEnabled = true;
    updateMicrophoneButton();
    showToast("Microphone on");

    state.microphoneStream.getAudioTracks()[0]?.addEventListener("ended", () => {
      state.microphoneEnabled = false;
      state.microphoneStream = null;
      updateMicrophoneButton();
    });
  } catch {
    state.microphoneEnabled = false;
    showToast("Microphone permission wasn’t granted.");
  } finally {
    elements.micButton.disabled = false;
  }
}

function updateMirrorButton() {
  for (const cameraView of [elements.video, elements.cameraBackdrop]) {
    cameraView?.classList.toggle("is-mirrored", state.mirrored);
    cameraView?.classList.toggle("is-unmirrored", !state.mirrored);
  }
  elements.mirrorButton.innerHTML = mirrorIcon;
  elements.mirrorButton.classList.toggle("is-active", state.mirrored);
  elements.mirrorButton.setAttribute("aria-pressed", String(state.mirrored));
  elements.mirrorButton.setAttribute(
    "aria-label",
    state.mirrored ? "Turn camera mirroring off" : "Turn camera mirroring on",
  );
  elements.mirrorButton.title = state.mirrored ? "Camera mirrored" : "Camera not mirrored";
}

function toggleMirror() {
  state.mirrored = !state.mirrored;
  writeStorage(storageKeys.mirrored, String(state.mirrored));
  updateMirrorButton();
  if (state.abstractEnabled) abstractCamera.render(state.mirrored, true);
}

function updateArtButton() {
  elements.cameraPane.classList.toggle("is-abstract", state.abstractEnabled);
  for (const [button, mode] of [[elements.artButton, 'rothko'], [document.querySelector('#mondrianButton'), 'mondrian'], [document.querySelector('#rothkoPlusButton'), 'rothko-plus']]) {
    const active = state.abstractEnabled && state.paintingMode === mode;
    const name = mode === 'rothko' ? 'Rothko' : mode === 'rothko-plus' ? 'Rothko+' : 'Mondrian';
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-label', `Turn ${name} painting ${active ? 'off' : 'on'}`);
    button.title = `${name} painting ${active ? 'on' : 'off'}`;
  }
  abstractCamera.debugCanvas.hidden = !state.abstractEnabled || state.paintingMode !== 'mondrian';
}

function toggleAbstractCamera(mode = 'rothko') {
  state.abstractEnabled = !(state.abstractEnabled && state.paintingMode === mode);
  state.paintingMode = mode;
  abstractCamera.setMode(mode);
  writeStorage(storageKeys.paintingMode, mode);
  state.visionFailureReported = false;
  writeStorage(storageKeys.abstractCamera, String(state.abstractEnabled));
  updateArtButton();
  if (state.abstractEnabled && state.cameraReady) {
    abstractCamera.restart();
  } else if (!state.abstractEnabled) {
    abstractCamera.stop();
  }
}

function reportVisionTrackingFailure() {
  if (!state.abstractEnabled || faceTracker.status !== "failed") return;
  if (state.visionFailureReported) return;
  state.visionFailureReported = true;
  showToast(
    "Scene tracking is unavailable; the edge-aware painting is still running.",
    "Retry",
    () => {
      state.visionFailureReported = false;
      if (state.abstractEnabled && state.cameraReady) abstractCamera.restart();
    },
  );
}

function renderFrame() {
  if (state.abstractEnabled) abstractCamera.render(state.mirrored);
  renderComposition({
    canvas: elements.canvas,
    stage: elements.stage,
    video: elements.video,
    cameraArt: state.abstractEnabled ? elements.cameraArt : null,
    editor: elements.editor,
    timestamp: elements.timestamp,
    mirror: state.mirrored,
  });
}

function downloadLastRecording() {
  if (!state.lastRecording) {
    return;
  }

  const downloads = [
    [state.lastRecording.markdownUrl, state.lastRecording.markdownFilename],
    [state.lastRecording.url, state.lastRecording.filename],
  ];

  for (const [url, filename] of downloads) {
    if (!url || !filename) {
      continue;
    }
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }
}

function downloadVideoAgain() {
  if (!state.lastRecording?.url) {
    return;
  }
  const anchor = document.createElement("a");
  anchor.href = state.lastRecording.url;
  anchor.download = state.lastRecording.filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

function downloadMarkdownAgain() {
  if (!state.lastRecording?.markdownUrl) {
    return;
  }
  const anchor = document.createElement("a");
  anchor.href = state.lastRecording.markdownUrl;
  anchor.download = state.lastRecording.markdownFilename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

function revokeLastRecordingUrls() {
  if (!state.lastRecording) {
    return;
  }
  for (const url of [state.lastRecording.url, state.lastRecording.markdownUrl]) {
    if (url) {
      URL.revokeObjectURL(url);
    }
  }
}

function clearEditor() {
  pagedEditor.reset();
  writeStorage(storageKeys.text, "");
  elements.editor.focus();
}

function recordingFiles(result, markdown, stoppedAt) {
  const markdownBlob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  return {
    ...result,
    filename: recordingFilename(stoppedAt, result.extension),
    url: URL.createObjectURL(result.blob),
    markdownFilename: recordingFilename(stoppedAt, "md"),
    markdownBlob,
    markdownUrl: URL.createObjectURL(markdownBlob),
  };
}

async function prepareSaveDirectory() {
  if (state.saveDirectory || state.directoryPromptAttempted) {
    return;
  }
  state.directoryPromptAttempted = true;

  if (typeof window.showDirectoryPicker !== "function") {
    return;
  }

  try {
    state.saveDirectory = await window.showDirectoryPicker({
      id: "wricord-recordings",
      mode: "readwrite",
      startIn: "downloads",
    });
  } catch (error) {
    if (error?.name !== "AbortError") {
      showToast("That folder couldn’t be opened. Downloads will be used instead.");
    }
  }
}

async function requestWakeLock() {
  try {
    const wakeLock = await navigator.wakeLock?.request("screen");
    state.wakeLock = wakeLock || null;
    wakeLock?.addEventListener("release", () => {
      if (state.wakeLock === wakeLock) {
        state.wakeLock = null;
      }
    });
  } catch {
    state.wakeLock = null;
  }
}

async function releaseWakeLock() {
  try {
    await state.wakeLock?.release();
  } catch {
    // The browser may already have released the lock after a visibility change.
  }
  state.wakeLock = null;
}

async function startRecording() {
  if (state.recording) {
    return;
  }

  await prepareSaveDirectory();

  if (!(await enableCamera())) {
    return;
  }

  if (!window.MediaRecorder || typeof elements.canvas.captureStream !== "function") {
    showToast("This browser can’t record the portrait canvas. Try current Safari or Chrome.");
    return;
  }

  elements.recordButton.disabled = true;

  try {
    renderFrame();
    state.recorder = new PortraitRecorder({
      canvas: elements.canvas,
      renderFrame,
      audioStream: state.microphoneEnabled ? state.microphoneStream : null,
      onElapsed: (milliseconds) => {
        const format = state.recordingExtension
          ? ` ${state.recordingExtension.toUpperCase()}`
          : "";
        setStatus(`REC${format}  ${formatElapsed(milliseconds)}`, true);
      },
    });
    const recordingInfo = await state.recorder.start();
    state.recordingExtension = recordingInfo.extension;
    state.recording = true;
    document.body.classList.add("is-recording");
    document.body.classList.remove("controls-hidden");
    elements.recordButton.classList.add("is-recording");
    elements.recordButton.setAttribute("aria-pressed", "true");
    elements.recordButtonText.textContent = "Stop recording";
    elements.recordButton.setAttribute("aria-label", "Stop recording");
    elements.micButton.disabled = true;
    elements.mirrorButton.disabled = true;
    setStatus(`REC ${state.recordingExtension.toUpperCase()}  00:00`, true);
    scheduleControlsFade();
    await requestWakeLock();
  } catch (error) {
    state.recorder = null;
    state.recordingExtension = null;
    showToast(error?.message || "Recording couldn’t start.");
    setStatus("Ready");
  } finally {
    elements.recordButton.disabled = false;
  }
}

async function stopRecording() {
  if (!state.recording || !state.recorder) {
    return;
  }

  elements.recordButton.disabled = true;
  const markdownAtStop = pagedEditor.markdown(editorToMarkdown);
  const stoppedAt = new Date();

  try {
    const result = await state.recorder.stop();
    revokeLastRecordingUrls();
    state.lastRecording = recordingFiles(result, markdownAtStop, stoppedAt);
    let savedToFolder = false;
    if (state.saveDirectory) {
      try {
        await saveRecordingPair(state.saveDirectory, state.lastRecording);
        savedToFolder = true;
      } catch {
        state.saveDirectory = null;
        downloadLastRecording();
      }
    } else {
      downloadLastRecording();
    }
    clearEditor();
    if (savedToFolder) {
      showToast(`Saved video and Markdown to ${state.saveDirectory.name}`);
    } else {
      showToast("Saved to Downloads. Missing a file?", [
        ["Video", downloadVideoAgain],
        ["Text", downloadMarkdownAgain],
      ]);
    }
  } catch (error) {
    showToast(error?.message || "The recording couldn’t be saved.");
  } finally {
    state.recorder = null;
    state.recording = false;
    state.recordingExtension = null;
    document.body.classList.remove("is-recording");
    elements.recordButton.classList.remove("is-recording");
    elements.recordButton.setAttribute("aria-pressed", "false");
    elements.recordButtonText.textContent = "Start recording";
    elements.recordButton.setAttribute("aria-label", "Start recording");
    elements.micButton.disabled = false;
    elements.mirrorButton.disabled = false;
    elements.recordButton.disabled = false;
    setStatus("Ready");
    await releaseWakeLock();
    scheduleControlsFade();
  }
}

function toggleRecording() {
  return state.recording ? stopRecording() : startRecording();
}

function openTimeDialog() {
  const referenceDate = currentTimestampDate();
  elements.manualDate.value = toDateInputValue(referenceDate);
  elements.manualTime.value = toTimeInputValue(referenceDate);

  const activeMode = elements.timeForm.querySelector(
    `input[name="timeMode"][value="${state.timestampMode}"]`,
  );
  if (activeMode) {
    activeMode.checked = true;
  }
  updateManualInputs();

  if (typeof elements.timeDialog.showModal === "function") {
    elements.timeDialog.showModal();
  } else {
    elements.timeDialog.setAttribute("open", "");
  }
}

function closeTimeDialog() {
  if (typeof elements.timeDialog.close === "function") {
    elements.timeDialog.close();
  } else {
    elements.timeDialog.removeAttribute("open");
  }
}

function updateManualInputs() {
  const manualSelected =
    elements.timeForm.querySelector('input[name="timeMode"]:checked')?.value === "manual";
  elements.manualDate.disabled = !manualSelected;
  elements.manualTime.disabled = !manualSelected;
}

function saveTimeSelection(event) {
  event.preventDefault();
  const mode = elements.timeForm.querySelector('input[name="timeMode"]:checked')?.value;

  if (mode === "manual") {
    const manualValue = parseLocalDateTime(elements.manualDate.value, elements.manualTime.value);
    if (!manualValue) {
      elements.manualDate.setCustomValidity("Choose a valid date and time.");
      elements.manualDate.reportValidity();
      return;
    }

    elements.manualDate.setCustomValidity("");
    state.manualTimestamp = manualValue;
    writeStorage(storageKeys.manualTime, String(manualValue.getTime()));
    state.timestampMode = "manual";
  } else {
    state.timestampMode = "current";
  }

  writeStorage(storageKeys.timeMode, state.timestampMode);
  refreshTimestamp();
  closeTimeDialog();
}

function scheduleControlsFade() {
  window.clearTimeout(state.controlsTimer);
  document.body.classList.remove("controls-hidden");
  state.controlsTimer = window.setTimeout(() => {
    if (!elements.stage.querySelector(".record-cluster:focus-within") && !elements.timeDialog.open) {
      document.body.classList.add("controls-hidden");
    }
  }, 2_800);
}

elements.enableCamera.addEventListener("click", enableCamera);
elements.artButton.addEventListener("click", () => toggleAbstractCamera('rothko'));
document.querySelector('#mondrianButton').addEventListener('click', () => toggleAbstractCamera('mondrian'));
document.querySelector('#rothkoPlusButton').addEventListener('click', () => toggleAbstractCamera('rothko-plus'));
const paintingDialog = document.querySelector('#paintingDialog');
const paintingControls = document.querySelector('#paintingControls');
const populatePaintingControls = () => {
  for (const input of paintingControls.querySelectorAll('input')) {
    const value = abstractCamera.mondrian.options[input.name];
    if (input.type === 'checkbox') input.checked = value;
    else input.value = value;
  }
};
document.querySelector('#paintingSettings').addEventListener('click', () => { populatePaintingControls(); paintingDialog.showModal(); });
document.querySelector('#closePaintingSettings').addEventListener('click', () => paintingDialog.close());
paintingControls.addEventListener('input', () => {
  const options = Object.fromEntries([...paintingControls.querySelectorAll('input')].map(input => [input.name, input.type === 'checkbox' ? input.checked : Number(input.value)]));
  abstractCamera.mondrian.setOptions(options);
  writeStorage(storageKeys.mondrianOptions, JSON.stringify(options));
  if (state.abstractEnabled) abstractCamera.render(state.mirrored, true);
});
elements.recordButton.addEventListener("click", toggleRecording);
elements.micButton.addEventListener("click", toggleMicrophone);
elements.mirrorButton.addEventListener("click", toggleMirror);
elements.timestampButton.addEventListener("click", openTimeDialog);
elements.cancelTime.addEventListener("click", closeTimeDialog);
elements.timeForm.addEventListener("submit", saveTimeSelection);
elements.timeForm.addEventListener("change", updateManualInputs);
elements.editor.addEventListener("compositionend", persistEditor);
elements.editor.addEventListener("input", (event) => {
  if (event.isComposing) return;
  applyInlineMarkdownShortcut(elements.editor);
  persistEditor();
});
elements.editor.addEventListener("beforeinput", (event) => {
  if (event.isComposing) return;
  if (
    event.inputType === "insertText" &&
    typeof event.data === "string" &&
    applyInlineMarkdownKeystroke(elements.editor, event.data)
  ) {
    event.preventDefault();
    persistEditor();
  }
});
elements.editor.addEventListener("keydown", (event) => {
  if (event.isComposing) return;
  const formattingShortcut = (event.metaKey || event.ctrlKey) && !event.altKey;
  const key = event.key.toLowerCase();

  if (formattingShortcut && (key === "b" || key === "i")) {
    event.preventDefault();
    toggleInlineFormat(elements.editor, key === "b" ? "strong" : "em");
    persistEditor();
    return;
  }

  if (
    !event.metaKey &&
    !event.altKey &&
    !event.ctrlKey &&
    applyInlineMarkdownKeystroke(elements.editor, event.key)
  ) {
    event.preventDefault();
    persistEditor();
    return;
  }

  if (
    !event.metaKey &&
    !event.altKey &&
    !event.ctrlKey &&
    exitFormattedBlockOnEnter(elements.editor, event.key)
  ) {
    event.preventDefault();
    persistEditor();
    return;
  }

  if (
    !event.metaKey &&
    !event.altKey &&
    !event.ctrlKey &&
    applyBlockMarkdownShortcut(elements.editor, event.key)
  ) {
    event.preventDefault();
    persistEditor();
  }
});
elements.stage.addEventListener("pointermove", scheduleControlsFade);
elements.stage.addEventListener("pointerleave", scheduleControlsFade);
elements.stage.addEventListener("focusin", () => document.body.classList.remove("controls-hidden"));
elements.timeDialog.addEventListener("click", (event) => {
  if (event.target === elements.timeDialog) {
    closeTimeDialog();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.metaKey && event.key === "Enter") {
    event.preventDefault();
    toggleRecording();
  }

  if (event.metaKey && event.shiftKey && event.key.toLowerCase() === "d") {
    event.preventDefault();
    openTimeDialog();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.recording) {
    state.recorder?.refreshFramePump();
    if (!state.wakeLock) {
      requestWakeLock();
    }
  }
});

window.addEventListener("focus", () => {
  state.recorder?.refreshFramePump();
});

window.addEventListener("pageshow", () => {
  state.recorder?.refreshFramePump();
});

window.addEventListener("beforeunload", () => {
  abstractCamera.dispose();
  stopStream(state.cameraStream);
  stopStream(state.microphoneStream);
  revokeLastRecordingUrls();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Local use remains fully functional if installation support is unavailable.
    });
  });
}

refreshTimestamp();
window.setInterval(() => {
  refreshTimestamp();
  reportVisionTrackingFailure();
}, 1_000);
updateMicrophoneButton();
updateMirrorButton();
updateArtButton();
setStatus("Camera starting");
scheduleControlsFade();

// Ask once on launch so the upper half becomes useful without extra chrome.
enableCamera();
