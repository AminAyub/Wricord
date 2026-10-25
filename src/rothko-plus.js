import { createSemanticGrid, createScharrEdgeMap } from './scene-geometry.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const centre = box => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

// Translucent plum pigment diffuses into the warm washes, without an ink core.
function depositPigment(ctx, fill = false) {
  ctx.save();
  const opacity = Number.isFinite(ctx.globalAlpha) ? ctx.globalAlpha : 1;
  const weight = ctx.lineWidth;
  ctx.globalCompositeOperation = 'multiply';
  ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
  ctx.shadowColor = '#963c57';
  ctx.shadowBlur = weight * 5;
  ctx.filter = `blur(${weight * 1.4}px)`;
  ctx.globalAlpha = opacity * 0.22;
  ctx.lineWidth = weight * 4;
  if (fill) ctx.fill(); else ctx.stroke();
  ctx.shadowBlur = weight * 2;
  ctx.filter = `blur(${weight * 0.65}px)`;
  ctx.lineWidth = weight * 1.5;
  ctx.globalAlpha = opacity * 0.42;
  if (fill) ctx.fill(); else ctx.stroke();
  ctx.restore();
}

// Fixed fibre positions: texture belongs to the canvas, never to camera noise.
function canvasWeave(ctx, width, height) {
  ctx.save(); ctx.filter = 'none'; ctx.globalCompositeOperation = 'soft-light';
  for (let i = 0; i < 1600; i++) {
    const x = ((i * 73.193) % 997) / 997 * width;
    const y = ((i * 137.71) % 991) / 991 * height;
    ctx.fillStyle = i % 3 ? '#e7b58c' : '#572a40';
    ctx.globalAlpha = 0.035 + (i % 5) * 0.005;
    ctx.fillRect(x, y, Math.max(0.5, width / 1600), 1 + i % 4);
  }
  ctx.restore();
}

function paintField(ctx, field, width, height, contours) {
  // Pull a little colour along contour crossings, like wet pigment wicking
  // through a stroke. The deformation is local and follows the smoothed person.
  const boundary = (y, direction) => {
    const crossings = [];
    for (const path of contours) for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
        crossings.push(a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y));
      }
    }
    return Array.from({length:49}, (_, i) => {
      const x = field.x + field.w * i / 48;
      const pull = crossings.reduce((sum, crossing) => sum + Math.exp(-(((x - crossing) / 0.022) ** 2)), 0);
      return {x:x * width, y:(y + direction * Math.min(1.4, pull) * 0.022) * height};
    });
  };
  const top = boundary(field.y, -1), bottom = boundary(field.y + field.h, 1).reverse();
  ctx.beginPath(); ctx.moveTo(top[0].x, top[0].y);
  for (const p of [...top.slice(1), ...bottom]) ctx.lineTo(p.x,p.y);
  ctx.closePath(); ctx.fill();
}

// Inner lip separation divided by mouth width, corrected for source aspect.
export function mouthOpening(landmarks, aspect = 1) {
  if (!landmarks || landmarks.length < 309 * 3) return 0;
  const distance = (a, b) => Math.hypot(
    (landmarks[a * 3] - landmarks[b * 3]) * aspect,
    landmarks[a * 3 + 1] - landmarks[b * 3 + 1]);
  const width = distance(78, 308);
  const value = distance(13, 14) / width;
  return width > 0.0001 && Number.isFinite(value) ? clamp(value, 0, 2) : 0;
}

export class ButterflyFlight {
  constructor() { this.reset(); }
  reset() { this.open = false; this.since = null; this.lastBirth = -Infinity; this.serial = 0; this.particles = []; }
  update(ratio, mouth, now) {
    this.particles = this.particles.filter(p => now - p.born < 5500);
    if (!mouth || ratio < 0.14) { this.open = false; this.since = null; }
    else if (ratio > 0.24) {
      if (this.since == null) this.since = now;
      if (now - this.since >= 180) this.open = true;
    }
    if (this.open && mouth && now - this.lastBirth >= 650 && this.particles.length < 9) {
      const id = this.serial++;
      this.particles.push({ id, born: now, x: mouth.x, y: mouth.y,
        targetX: id % 2 ? 1.08 : -0.08, targetY: 0.08 + ((id * 37) % 70) / 100,
        size: 0.011 + (id % 3) * 0.003 });
      this.lastBirth = now;
    }
    return this.particles;
  }
}

// Extract only the main subject's side contours and a few hair-mass anchors.
export function personContours(pixels, width, height, mask, face) {
  const semantics = createSemanticGrid(width, height, { categoryMask: mask, mappedFace: face });
  const edges = createScharrEdgeMap(pixels, width, height);
  const left = [], right = [], hair = [], hairline = [];
  const box = face?.bbox;
  const startY = box ? Math.floor(box.y + box.height * 0.22) : Math.floor(height * 0.3);
  for (let y = Math.max(0, startY); y < height; y += Math.max(1, Math.round(height / 24))) {
    let lo = width, hi = -1;
    for (let x = 0; x < width; x++) if (semantics[y * width + x]) { lo = Math.min(lo, x); hi = x; }
    if (hi < lo) continue;
    const snap = x => {
      let best = x, value = -1;
      for (let i = Math.max(0, x - 1); i <= Math.min(width - 1, x + 1); i++) {
        const strength = edges.strength[y * width + i];
        if (strength > value) { best = i; value = strength; }
      }
      return best / width;
    };
    left.push({ x: snap(lo), y: y / height }); right.push({ x: snap(hi), y: y / height });
  }
  if (box) {
    for (let x = Math.max(0, Math.floor(box.x - box.width * 0.18)); x < Math.min(width, box.x + box.width * 1.18); x += Math.max(1, Math.round(box.width / 12))) {
      let bottom = -1;
      for (let y = Math.max(0, Math.floor(box.y - box.height * 0.4)); y < Math.min(height, box.y + box.height * 0.4); y++) {
        if (semantics[y * width + x] === 1) {
          if (bottom < 0) hair.push({ x: x / width, y: y / height });
          bottom = y;
        }
      }
      if (bottom >= box.y && x > box.x + box.width * 0.08 && x < box.x + box.width * 0.92) hairline.push({ x:x / width, y:bottom / height });
    }
  }
  return { left, right, hair, hairline };
}

function smoothPath(previous, next) {
  // Fixed arc-length samples keep contour correspondence when mask rows change.
  if (next.length < 2) return [];
  const lengths = [0];
  for (let i = 1; i < next.length; i++) lengths.push(lengths[i - 1] + Math.hypot(next[i].x - next[i - 1].x, next[i].y - next[i - 1].y));
  const sampled = Array.from({length:20}, (_, i) => {
    const distance = lengths.at(-1) * i / 19;
    let j = 1; while (j < lengths.length - 1 && lengths[j] < distance) j++;
    const t = (distance - lengths[j - 1]) / Math.max(1e-8, lengths[j] - lengths[j - 1]);
    return {x:next[j - 1].x + (next[j].x - next[j - 1].x) * t, y:next[j - 1].y + (next[j].y - next[j - 1].y) * t};
  });
  return sampled.map((p, i) => previous?.length === sampled.length ? {
    x: previous[i].x + (p.x - previous[i].x) * 0.28,
    y: previous[i].y + (p.y - previous[i].y) * 0.28,
  } : p);
}
function strokePath(ctx, points, width, height) {
  if (points.length < 2) return;
  ctx.beginPath(); ctx.moveTo(points[0].x * width, points[0].y * height);
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    ctx.quadraticCurveTo(a.x * width, a.y * height, (a.x + b.x) / 2 * width, (a.y + b.y) / 2 * height);
  }
  const end = points.at(-1); ctx.lineTo(end.x * width, end.y * height); depositPigment(ctx);
}

export class RothkoPlusPainter {
  constructor() { this.reset(); }
  reset() { this.flight = new ButterflyFlight(); this.paths = {}; this.light = 0.5; }
  render(ctx, width, height, pixels, sampleWidth, sampleHeight, mask, face, rawFace, aspect, now) {
    let light = 0;
    for (let i = 0; i < pixels.length; i += 4) light += (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 765;
    this.light += (light / (pixels.length / 4) - this.light) * 0.025;
    const paths = personContours(pixels, sampleWidth, sampleHeight, mask, face);
    for (const name of ['left', 'right', 'hair', 'hairline']) this.paths[name] = smoothPath(this.paths[name], paths[name]);
    const fieldContours = [this.paths.left, this.paths.right];
    ctx.save();
    ctx.fillStyle = '#3f152e'; ctx.fillRect(0, 0, width, height);
    // Thin luminous washes: orange above crimson, feathered into plum ground.
    const breath = Math.sin(now / 11000) * 0.009;
    const fields = [
      { x: 0.045, y: 0.065, w: 0.91, h: 0.43 + breath, hue: 24, sat: 90, light: 48 + this.light * 8 },
      { x: 0.065, y: 0.555 + breath, w: 0.87, h: 0.36 - breath, hue: 350, sat: 83, light: 35 + this.light * 8 },
    ];
    for (const f of fields) {
      ctx.save(); ctx.fillStyle = `hsl(${f.hue} ${f.sat}% ${f.light}%)`;
      ctx.globalAlpha = 0.9;
      ctx.filter = `blur(${Math.max(2, width * 0.008)}px)`;
      paintField(ctx, f, width, height, fieldContours);
      ctx.filter = `blur(${Math.max(3, width * 0.013)}px)`; ctx.globalAlpha = 0.32;
      ctx.fillStyle = `hsl(${f.hue + 5} ${f.sat}% ${f.light + 5 + Math.sin(now / 15000) * 1.5}%)`;
      paintField(ctx, {...f,x:f.x+0.009,y:f.y+0.018,w:f.w-0.018,h:f.h-0.036},width,height,fieldContours);
      ctx.restore();
    }
    // A translucent body mass, not just an outline, shares the fields' pigment.
    if (this.paths.left.length && this.paths.right.length) {
      ctx.save(); ctx.globalAlpha = 0.12; ctx.globalCompositeOperation = 'soft-light';
      ctx.filter = `blur(${width * 0.013}px)`; ctx.fillStyle = '#f5aa79';
      const silhouette = [...this.paths.left, ...this.paths.right.slice().reverse()];
      ctx.beginPath(); ctx.moveTo(silhouette[0].x * width, silhouette[0].y * height);
      for (const p of silhouette.slice(1)) ctx.lineTo(p.x * width,p.y * height);
      ctx.closePath(); ctx.fill(); ctx.restore();
    }
    ctx.filter = 'none'; ctx.strokeStyle = '#963e58'; ctx.lineWidth = Math.max(1.2, width * 0.0032);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const name of ['left', 'right', 'hair', 'hairline']) {
      strokePath(ctx, this.paths[name], width, height);
    }
    const sx = width / sampleWidth, sy = height / sampleHeight;
    const features = face?.features;
    const ratio = mouthOpening(rawFace?.landmarks, aspect);
    let mouth = null;
    if (face?.bbox) {
      const b = face.bbox;
      const jawIndices = [234, 132, 172, 150, 152, 379, 397, 361, 454];
      const raw = rawFace?.bbox;
      const jaw = raw && raw.width > 0 && raw.height > 0 ? jawIndices.map(i => ({
        x:(b.x + (rawFace.landmarks[i * 3] - raw.x) / raw.width * b.width) / sampleWidth,
        y:(b.y + (rawFace.landmarks[i * 3 + 1] - raw.y) / raw.height * b.height) / sampleHeight,
      })) : [[0.08,0.48],[0.14,0.72],[0.32,0.91],[0.5,0.97],[0.68,0.91],[0.86,0.72],[0.92,0.48]].map(([x,y]) => ({x:(b.x+x*b.width)/sampleWidth,y:(b.y+y*b.height)/sampleHeight}));
      this.paths.jaw = smoothPath(this.paths.jaw, jaw);
      ctx.save(); ctx.lineWidth *= 0.8; strokePath(ctx,this.paths.jaw,width,height);
      // Two restrained collar curves articulate the neck/upper chest.
      for (const side of [-1,1]) {
        const x = (b.x + b.width * (0.5 + side * 0.2)) * sx;
        const y = (b.y + b.height * 0.93) * sy;
        ctx.beginPath(); ctx.moveTo(x,y);
        ctx.quadraticCurveTo(x - side*b.width*sx*0.03,y+b.height*sy*0.18,(b.x+b.width*(0.5+side*0.46))*sx,y+b.height*sy*0.3);
        depositPigment(ctx);
      }
      ctx.restore();
      // Broad cheek/temple washes suggest volume rather than traced features.
      ctx.save(); ctx.globalAlpha = 0.48; ctx.lineWidth *= 3.2;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo((b.x + b.width * (0.5 + side * 0.31)) * sx, (b.y + b.height * 0.27) * sy);
        ctx.bezierCurveTo((b.x+b.width*(0.5+side*0.43))*sx,(b.y+b.height*0.43)*sy,
          (b.x+b.width*(0.5+side*0.25))*sx,(b.y+b.height*0.6)*sy,
          (b.x+b.width*(0.5+side*0.2))*sx,(b.y+b.height*0.76)*sy);
        depositPigment(ctx);
      }
      ctx.restore();
    }
    if (features) {
      for (const eye of [features.leftEye, features.rightEye]) {
        if (!eye) continue;
        const p = centre(eye), half = Math.max(3, eye.width * sx * 0.4);
        const lid = Math.max(0.8, Math.min(half * 0.62, eye.height * sy * 0.62));
        ctx.fillStyle = '#85374f';
        ctx.beginPath(); ctx.moveTo(p.x*sx-half,p.y*sy);
        ctx.quadraticCurveTo(p.x*sx,p.y*sy-lid*1.25,p.x*sx+half,p.y*sy);
        ctx.quadraticCurveTo(p.x*sx,p.y*sy+lid,p.x*sx-half,p.y*sy);
        ctx.closePath(); depositPigment(ctx, true);
      }
      if (features.nose) {
        const n = features.nose;
        ctx.beginPath(); ctx.moveTo((n.x + n.width * 0.55) * sx, n.y * sy);
        ctx.lineTo((n.x + n.width * 0.38) * sx, (n.y + n.height * 0.85) * sy);
        ctx.lineTo((n.x + n.width * 0.8) * sx, (n.y + n.height * 0.9) * sy); depositPigment(ctx);
      }
      if (features.mouth) {
        const m = features.mouth, p = centre(m), half = m.width * sx * 0.38;
        const gap = Math.max(1.5, Math.min(half * 0.8, ratio * half));
        // A soft cupid's bow and lower lip; the aperture follows inner lip distance.
        ctx.beginPath(); ctx.moveTo(p.x * sx - half, p.y * sy);
        ctx.bezierCurveTo(p.x*sx-half*0.55,p.y*sy-gap*1.3,p.x*sx-half*0.22,p.y*sy-gap*1.2,p.x*sx,p.y*sy-gap*0.75);
        ctx.bezierCurveTo(p.x*sx+half*0.22,p.y*sy-gap*1.2,p.x*sx+half*0.55,p.y*sy-gap*1.3,p.x*sx+half,p.y*sy);
        ctx.quadraticCurveTo(p.x*sx,p.y*sy+gap*1.9,p.x*sx-half,p.y*sy);
        depositPigment(ctx);
        mouth = { x: p.x / sampleWidth, y: p.y / sampleHeight };
      }
    }
    // The same veil and cotton grain cover the person and both fields.
    ctx.save(); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 0.18;
    ctx.filter = `blur(${Math.max(2, width * 0.008)}px)`;
    for (const f of fields) {
      ctx.fillStyle = `hsl(${f.hue} ${f.sat}% ${f.light}%)`;
      paintField(ctx, f, width, height, fieldContours);
    }
    ctx.restore();
    canvasWeave(ctx, width, height);
    for (const p of this.flight.update(ratio, mouth, now)) {
      const age = clamp((now - p.born) / 5500, 0, 1);
      const x = (p.x + (p.targetX - p.x) * age) * width;
      const y = (p.y + (p.targetY - p.y) * age - Math.sin(age * Math.PI) * 0.17) * height;
      const size = p.size * width, flap = 0.45 + Math.abs(Math.sin(now / 180 + p.id)) * 0.55;
      ctx.save(); ctx.translate(x, y); ctx.rotate((p.targetX < p.x ? -1 : 1) * 0.25);
      ctx.strokeStyle = '#100e12'; ctx.filter = 'none'; ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = Math.min(1, (1 - age) * 6); ctx.lineWidth = Math.max(1, width * 0.0018);
      // Exactly four wing strokes; no extra body or antenna detail.
      for (const direction of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(direction * size * flap, -size * 1.15, direction * size * flap, -size * 0.35);
        ctx.quadraticCurveTo(direction * size * 0.75 * flap, size * 0.6, 0, 0); ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
  }
}
