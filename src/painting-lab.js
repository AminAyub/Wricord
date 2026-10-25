import { AbstractCameraRenderer } from './camera-art.js';
import { FaceTracker } from './face-tracker.js';
const output = document.querySelector('#output');
const video = document.querySelector('#sourceVideo');
const imageCanvas = document.querySelector('#sourceImage');
const status = document.querySelector('#sourceStatus');
let renderer = null, sourceUrl = null, revision = 0;
function release() {
  renderer?.dispose(); renderer = null;
  video.pause(); video.removeAttribute('src'); video.load();
  if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  sourceUrl = null;
}
document.querySelector('#sourceFile').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  const current = ++revision;
  release(); sourceUrl = URL.createObjectURL(file);
  status.textContent = 'Opening source…';
  try {
    let source;
    if (file.type.startsWith('video/')) {
      video.hidden = false; video.src = sourceUrl; video.loop = true;
      await video.play(); source = video;
    } else {
      video.hidden = true;
      const image = new Image(); image.src = sourceUrl; await image.decode();
      if (current !== revision) return;
      const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
      imageCanvas.width = Math.round(image.naturalWidth * scale); imageCanvas.height = Math.round(image.naturalHeight * scale);
      imageCanvas.getContext('2d').drawImage(image, 0, 0, imageCanvas.width, imageCanvas.height); source = imageCanvas;
    }
    if (current !== revision) return;
    renderer = new AbstractCameraRenderer({ canvas: output, video: source, faceTracker: new FaceTracker() });
    renderer.setMode('mondrian'); renderer.debugCanvas = document.querySelector('#debugOutput');
    renderer.mondrian.setOptions({ debug: document.querySelector('#debug').getAttribute('aria-pressed') === 'true' });
    renderer.start();
    status.textContent = 'Local source active. Allow a few seconds for detection to settle.';
  } catch (error) { if (current === revision) status.textContent = `Cannot open this source: ${error.message}`; }
});
document.querySelector('#replay').addEventListener('click', () => {
  if (!renderer) return;
  if (!video.hidden) video.currentTime = 0;
  renderer.faceTracker.dispose(); renderer.faceTracker = new FaceTracker();
  renderer.mondrian.reset(); renderer.restart();
});
document.querySelector('#debug').addEventListener('click', event => {
  const enabled = event.currentTarget.getAttribute('aria-pressed') !== 'true';
  event.currentTarget.setAttribute('aria-pressed', String(enabled));
  renderer?.mondrian.setOptions({ debug: enabled });
  renderer?.render(false, true);
});
window.addEventListener('pagehide', release);
