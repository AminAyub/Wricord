import test from 'node:test';
import assert from 'node:assert/strict';
import { MondrianPainter, MONDRIAN_DEFAULTS, buildMondrianPartition, sanitizeMondrianOptions } from '../src/mondrian.js';

const width = 128, height = 54;
function fixture(shift = 0, clothing = [30, 50, 150]) {
  const pixels = new Uint8ClampedArray(width * height * 4), mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const head = x > 53 + shift && x < 75 + shift && y > 9 && y < 32;
    const torso = x > 39 + shift && x < 90 + shift && y >= 32;
    const color = head ? [190, 140, 105] : torso ? clothing : [235, 231, 220];
    pixels.set([...color, 255], (y * width + x) * 4);
    mask[y * width + x] = head ? 3 : torso ? 4 : 0;
  }
  return { pixels, mask, face: { bbox: { x: 53 + shift, y: 10, width: 22, height: 22 } } };
}
test('Mondrian partitions tile exactly with orthogonal T junctions and bounded region count', () => {
  const f = fixture();
  const painter = new MondrianPainter();
  const frame = painter.compose(f.pixels, width, height, f.mask, f.face, 0);
  for (const abstraction of [0, 0.55, 1]) {
    const layout = buildMondrianPartition(frame.anchors, { ...MONDRIAN_DEFAULTS, abstraction });
    assert.ok(layout.cells.length >= 10 && layout.cells.length <= 20);
    assert.ok(Math.abs(layout.cells.reduce((sum, c) => sum + c.w * c.h, 0) - 1) < 1e-9);
    for (const c of layout.cells) {
      assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.w <= 1.000001 && c.y + c.h <= 1.000001);
      for (const d of layout.cells) if (c !== d) {
        const w = Math.min(c.x + c.w, d.x + d.w) - Math.max(c.x, d.x);
        const h = Math.min(c.y + c.h, d.y + d.h) - Math.max(c.y, d.y);
        assert.ok(w <= 1e-9 || h <= 1e-9);
      }
    }
    assert.ok(layout.lines.every(l => (l.w === 0) !== (l.h === 0)));
    assert.ok(layout.lines.some(l => l.w === 1));
    assert.ok(layout.lines.some(l => l.w > 0 && l.w < 0.5));
  }
});
test('Mondrian defaults reserve white space and retain head and torso accents', () => {
  const f = fixture(), p = new MondrianPainter();
  const frame = p.compose(f.pixels, width, height, f.mask, f.face, 0);
  const colored = frame.cells.filter(c => frame.colors[c.id] !== 'white');
  assert.ok(colored.reduce((sum, c) => sum + c.w * c.h, 0) <= 0.235);
  assert.ok(colored.some(c => c.role === 'head'));
  assert.ok(colored.some(c => c.role === 'torso'));
});
test('A stationary scene is deterministic; subpixel movement is held and deliberate movement converges', () => {
  const f = fixture(), p = new MondrianPainter();
  const initial = p.compose(f.pixels, width, height, f.mask, f.face, 0);
  for (let t = 100; t < 3000; t += 100) {
    const same = p.compose(f.pixels, width, height, f.mask, f.face, t);
    assert.deepEqual(same.cells, initial.cells);
    assert.deepEqual(same.colors, initial.colors);
  }
  const moved = fixture(12);
  const first = p.compose(moved.pixels, width, height, moved.mask, moved.face, 3000);
  assert.ok(first.anchors.cx > initial.anchors.cx);
  assert.ok(first.anchors.cx < (53 + 12 + 11) / width);
  let last;
  for (let t = 3100; t < 9000; t += 100) last = p.compose(moved.pixels, width, height, moved.mask, moved.face, t);
  assert.ok(last.anchors.cx > initial.anchors.cx + 0.07);
});
test('Missing detections produce a central composition and settings are sanitized', () => {
  const f = fixture(), p = new MondrianPainter();
  const frame = p.compose(f.pixels, width, height, null, null, 0);
  assert.ok(frame.cells.some(c => c.role === 'head'));
  assert.ok(frame.cells.some(c => c.role === 'torso'));
  assert.equal(sanitizeMondrianOptions({ density: 9 }).density, 1);
  assert.equal(sanitizeMondrianOptions({ thickness: 'invalid' }).thickness, MONDRIAN_DEFAULTS.thickness);
});

test('A dark source retains primary accents instead of turning the subject entirely black', () => {
  const p = new MondrianPainter(), f = fixture();
  const pixels = new Uint8ClampedArray(width * height * 4);
  const frame = p.compose(pixels, width, height, f.mask, f.face, 0);
  const blackArea = frame.cells.filter(c => frame.colors[c.id] === 'black').reduce((sum, c) => sum + c.w * c.h, 0);
  assert.ok(blackArea <= 0.04);
  assert.ok(new Set(Object.values(frame.colors).filter(c => ['red', 'yellow', 'blue'].includes(c))).size >= 2);
});
