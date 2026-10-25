import test from 'node:test';
import assert from 'node:assert/strict';
import { ButterflyFlight, mouthOpening, personContours, RothkoPlusPainter } from '../src/rothko-plus.js';

test('Inner lip opening is aspect-corrected and rejects missing/degenerate landmarks', () => {
  const points = new Float32Array(478 * 3);
  points[78 * 3] = 0.4; points[308 * 3] = 0.6;
  points[13 * 3 + 1] = 0.4; points[14 * 3 + 1] = 0.5;
  assert.ok(Math.abs(mouthOpening(points, 2) - 0.25) < 1e-6);
  assert.equal(mouthOpening(null), 0);
  assert.equal(mouthOpening(new Float32Array(478 * 3)), 0);
});

test('Butterflies require sustained opening, respect hysteresis, stop spawning on loss, and expire', () => {
  const flight = new ButterflyFlight(), mouth = { x: 0.5, y: 0.6 };
  flight.update(0.3, mouth, 0);
  assert.equal(flight.particles.length, 0);
  flight.update(0.3, mouth, 200);
  assert.equal(flight.particles.length, 1);
  flight.update(0.18, mouth, 300);
  assert.equal(flight.open, true);
  flight.update(0.1, mouth, 400);
  assert.equal(flight.open, false);
  flight.update(0.5, null, 1500);
  assert.equal(flight.particles.length, 1);
  flight.update(0, null, 6000);
  assert.equal(flight.particles.length, 0);
  for (let t = 6100; t < 100000; t += 100) flight.update(0.5, mouth, t);
  assert.ok(flight.particles.length <= 9);
  assert.ok(flight.particles.some(p => p.targetX < 0));
  assert.ok(flight.particles.some(p => p.targetX > 1));
});

test('Contours stay sparse and person-bound rather than reproducing background texture', () => {
  const width = 64, height = 32, pixels = new Uint8ClampedArray(width * height * 4).fill(180);
  const mask = new Uint8Array(width * height);
  for (let y = 8; y < height; y++) for (let x = 22; x < 42; x++) mask[y * width + x] = y < 18 ? 3 : 4;
  const paths = personContours(pixels, width, height, mask, { bbox: {x:22,y:8,width:20,height:12} });
  assert.ok(paths.left.length > 2 && paths.left.length < 32);
  assert.ok(paths.left.every(p => p.x > 0.25 && p.x < 0.4));
  assert.ok(paths.right.every(p => p.x > 0.6 && p.x < 0.72));
});

test('Rothko+ paints a complete frame with filled eyes and curved lips', () => {
  let eyeFills = 0, lipCurves = 0, fills = 0;
  const ctx = { save(){}, restore(){}, fillRect(){ fills++; }, beginPath(){}, moveTo(){}, lineTo(){},
    quadraticCurveTo(){}, stroke(){}, closePath(){}, translate(){}, rotate(){}, fill(){ eyeFills++; }, bezierCurveTo(){ lipCurves++; } };
  const face = { bbox:{x:20,y:4,width:20,height:20}, features: {
    leftEye:{x:24,y:10,width:4,height:2}, rightEye:{x:32,y:10,width:4,height:2},
    nose:{x:28,y:12,width:3,height:5}, mouth:{x:26,y:19,width:8,height:3},
  } };
  new RothkoPlusPainter().render(ctx, 640, 320, new Uint8ClampedArray(64*32*4).fill(160), 64,32,null,face,null,2,0);
  assert.equal(eyeFills, 11); // Four eye deposits, body wash, six colour-field passes.
  assert.equal(lipCurves, 4); // Lips plus two broad cheek washes.
  assert.ok(fills >= 1);
});

test('Portrait pigment is coloured and diffuse; butterflies alone use unblurred black', () => {
  const strokes = [], stack = [];
  const ctx = { globalAlpha:1, lineWidth:1, filter:'none',
    save(){ stack.push({globalAlpha:this.globalAlpha,lineWidth:this.lineWidth,
      filter:this.filter,strokeStyle:this.strokeStyle,fillStyle:this.fillStyle}); },
    restore(){ Object.assign(this,stack.pop()); },
    fillRect(){}, beginPath(){}, moveTo(){}, lineTo(){}, quadraticCurveTo(){},
    closePath(){}, translate(){}, rotate(){}, fill(){}, bezierCurveTo(){},
    stroke(){ strokes.push({colour:this.strokeStyle,filter:this.filter}); },
  };
  const landmarks = new Float32Array(478 * 3);
  landmarks[78*3]=0.4; landmarks[308*3]=0.6;
  landmarks[13*3+1]=0.4; landmarks[14*3+1]=0.6;
  const face = {bbox:{x:20,y:4,width:20,height:20},
    features:{mouth:{x:26,y:19,width:8,height:3}}};
  const painter = new RothkoPlusPainter();
  const render = now => painter.render(ctx,640,320,new Uint8ClampedArray(64*32*4).fill(160),
    64,32,null,face,{landmarks},2,now);
  render(0);
  assert.ok(strokes.length > 0);
  assert.ok(strokes.every(s => s.colour === '#963e58' && s.filter.startsWith('blur(')));
  strokes.length = 0; render(300);
  const butterflies = strokes.filter(s => s.colour === '#100e12');
  assert.equal(butterflies.length,2); // Two paths, each containing two wing curves.
  assert.ok(butterflies.every(s => s.filter === 'none'));
});
