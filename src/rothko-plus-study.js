import { RothkoPlusPainter } from './rothko-plus.js';
const canvas = document.querySelector('#study'), ctx = canvas.getContext('2d');
const painter = new RothkoPlusPainter();
const width = 128, height = 52, pixels = new Uint8ClampedArray(width * height * 4).fill(170), mask = new Uint8Array(width * height);
for (let y = 5; y < height; y++) for (let x = 0; x < width; x++) {
  const half = y < 31 ? 12 : 12 + (y - 31) * 1.3;
  if (Math.abs(x - 64) < half) mask[y * width + x] = y < 10 ? 1 : y < 31 ? 3 : 4;
}
const face = { bbox:{x:52,y:10,width:24,height:24}, features: {
  leftEye:{x:55,y:16,width:5,height:2}, rightEye:{x:68,y:16,width:5,height:2},
  nose:{x:61,y:18,width:5,height:8}, mouth:{x:59,y:28,width:10,height:3},
} };
const landmarks = new Float32Array(478 * 3);
landmarks[78 * 3] = 0.45; landmarks[308 * 3] = 0.55;
landmarks[13 * 3 + 1] = 0.5;
let open = false, timer;
document.querySelector('#mouth').addEventListener('click', event => {
  open = !open; event.currentTarget.setAttribute('aria-pressed', String(open));
  event.currentTarget.textContent = open ? 'Close mouth' : 'Open mouth';
});
function draw() {
  landmarks[14 * 3 + 1] = open ? 0.61 : 0.51;
  painter.render(ctx, canvas.width, canvas.height, pixels, width, height, mask, face, {landmarks}, width / height, performance.now());
}
draw(); timer = setInterval(draw, 100);
window.addEventListener('pagehide', () => clearInterval(timer));
