// A persistent composition, expressed in normalized canvas coordinates.
export const MONDRIAN_PALETTE = Object.freeze({ white: '#f4f1e7', red: '#cf3025', blue: '#173e88', yellow: '#efc72c', black: '#171817', grey: '#deddd5' });
export const MONDRIAN_DEFAULTS = Object.freeze({ abstraction: 0.55, density: 0.28, responsiveness: 0.3, thickness: 0.65, recognizability: 0.7, texture: 0, debug: false });
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export function sanitizeMondrianOptions(options = {}) {
  return Object.fromEntries(Object.entries(MONDRIAN_DEFAULTS).map(([key, fallback]) => [key,
    key === 'debug' ? options[key] === true : Number.isFinite(Number(options[key]))
      ? clamp(Number(options[key]), 0, 1) : fallback]));
}
const area = r => r.w * r.h;
function sample(pixels, width, height, r, mask = null) {
  let red = 0, green = 0, blue = 0, count = 0, dark = 0, foreground = 0;
  for (let y = Math.max(0, Math.floor(r.y * height)); y < Math.min(height, Math.ceil((r.y + r.h) * height)); y++) {
    for (let x = Math.max(0, Math.floor(r.x * width)); x < Math.min(width, Math.ceil((r.x + r.w) * width)); x++) {
      const i = y * width + x, p = i * 4;
      red += pixels[p]; green += pixels[p + 1]; blue += pixels[p + 2]; count++;
      if (pixels[p] + pixels[p + 1] + pixels[p + 2] < 210) dark++;
      if (mask?.[i]) foreground++;
    }
  }
  count = Math.max(1, count);
  return { red: red / count / 255, green: green / count / 255, blue: blue / count / 255,
    light: (red + green + blue) / count / 765, dark: dark / count, foreground: foreground / count };
}

export function extractMondrianAnchors(pixels, width, height, mask, face) {
  const box = face?.bbox;
  const cx = clamp(box ? (box.x + box.width / 2) / width : 0.51, 0.24, 0.76);
  const headWidth = clamp(box ? box.width / width * 1.18 : 0.18, 0.12, 0.29);
  const top = clamp(box ? (box.y - box.height * 0.14) / height : 0.16, 0.06, 0.43);
  const shoulder = clamp(box ? (box.y + box.height * 1.25) / height : 0.58, top + 0.2, 0.79);
  let left = cx - headWidth * 1.18, right = cx + headWidth * 1.36;
  let count = 0, min = width, max = 0;
  for (let y = Math.floor(shoulder * height); y < Math.min(height, Math.ceil((shoulder + 0.16) * height)); y++) {
    for (let x = Math.floor(width * 0.08); x < width * 0.92; x++) {
      if (mask?.[y * width + x]) { min = Math.min(min, x); max = Math.max(max, x); count++; }
    }
  }
  if (count > width * height * 0.008) { left = min / width; right = (max + 1) / width; }
  // Only a coarse, reliable foreground mass can move an arm accent.
  const arm = side => {
    let sum = 0, n = 0;
    for (let y = Math.floor(height * 0.35); y < height * 0.92; y++) {
      for (let x = 0; x < width; x++) {
        if ((side < 0 ? x / width < cx - headWidth : x / width > cx + headWidth) && mask?.[y * width + x] === 2) { sum += y / height; n++; }
      }
    }
    return n > width * height * 0.008 ? clamp(sum / n, 0.38, 0.86) : 0.76;
  };
  // One background division chosen from long axis-aligned contrast, excluding the subject.
  let best = 0, division = 0.24;
  for (let y = Math.floor(height * 0.12); y < height * 0.45; y++) {
    let score = 0;
    for (let x = 1; x < width - 1; x++) {
      if (Math.abs(x / width - cx) < headWidth || mask?.[y * width + x]) continue;
      const i = (y * width + x) * 4, prev = i - width * 4;
      score += Math.abs(pixels[i] - pixels[prev]) + Math.abs(pixels[i + 1] - pixels[prev + 1]);
    }
    if (score > best) { best = score; division = y / height; }
  }
  return { cx, headWidth, top, shoulder, left: clamp(left, 0.1, cx - 0.1), right: clamp(right, cx + 0.1, 0.91), leftArm: arm(-1), rightArm: arm(1), division };
}

export function buildMondrianPartition(anchor, options = MONDRIAN_DEFAULTS) {
  const strength = options.recognizability;
  const cx = 0.51 + (anchor.cx - 0.51) * (0.35 + strength * 0.65);
  const hw = anchor.headWidth * (0.9 + strength * 0.15);
  const l = clamp(cx - hw * 0.53, 0.18, 0.64), r = clamp(cx + hw * 0.47, l + 0.1, 0.82);
  const top = anchor.top, shoulder = anchor.shoulder;
  const sl = clamp(anchor.left, 0.07, l - 0.035), sr = clamp(anchor.right, r + 0.035, 0.94);
  const cells = [], lines = [];
  const add = (id, x, y, w, h, role = 'background') => { if (w > 0 && h > 0) cells.push({ id, x, y, w, h, role }); };
  const line = (id, x, y, w, h, major = false) => lines.push({ id, x, y, w, h, major });
  // Unequal side wings and a head-to-torso axis. T junctions preserve quiet fields.
  add('left-quiet', 0, 0, l, anchor.division);
  add('left-middle', 0, anchor.division, l, shoulder - anchor.division);
  add('crown-space', l, 0, r - l, top);
  add('head-main', l, top, (r - l) * 0.68, shoulder - top, 'head');
  add('head-side', l + (r - l) * 0.68, top, (r - l) * 0.32, shoulder - top, 'head');
  add('right-quiet', r, 0, 1 - r, shoulder);
  add('left-base', 0, shoulder, sl, 1 - shoulder);
  add('left-arm', sl, shoulder, l - sl, 1 - shoulder, 'arm');
  add('torso', l, shoulder, sr - l, 1 - shoulder, 'torso');
  add('right-base', sr, shoulder, 1 - sr, 1 - shoulder);
  line('axis', l, 0, 0, 1, true);
  line('shoulders', 0, shoulder, 1, 0, true);
  line('head-right', r, 0, 0, shoulder);
  line('head-top', l, top, r - l, 0);
  line('head-inner', l + (r - l) * 0.68, top, 0, shoulder - top);
  line('left-division', 0, anchor.division, l, 0);
  line('body-right', sr, shoulder, 0, 1 - shoulder, true);
  line('arm-left', sl, shoulder, 0, 1 - shoulder);
  const split = (id, at, vertical, suffix) => {
    const index = cells.findIndex(c => c.id === id), cell = cells[index];
    if (!cell) return;
    const first = { ...cell, id: id + '-a' }, second = { ...cell, id: id + '-b' };
    if (vertical) { first.w *= at; second.x += first.w; second.w -= first.w; }
    else { first.h *= at; second.y += first.h; second.h -= first.h; }
    cells.splice(index, 1, first, second);
    line(suffix, second.x, second.y, vertical ? 0 : cell.w, vertical ? cell.h : 0);
  };
  split('torso', 0.72 - strength * 0.18, true, 'torso-axis');
  split('left-arm', clamp((anchor.leftArm - shoulder) / (1 - shoulder), 0.25, 0.8), false, 'arm-height');
  if (options.abstraction < 0.8) {
    split('right-quiet', 0.71, true, 'far-right');
    split('right-quiet-b', 0.33, false, 'right-accent');
    split('right-base', clamp((anchor.rightArm - shoulder) / (1 - shoulder), 0.25, 0.8), false, 'right-motion');
  }
  if (options.abstraction < 0.4) {
    split('head-main', 0.31, false, 'head-mass');
    split('left-base', 0.61, false, 'base-accent');
    split('left-middle', 0.3, true, 'room-accent');
  }
  return { cells, lines };
}

function colorEvidence(s, role, color) {
  if (color === 'black') return s.dark * 0.9 + (role === 'head' ? 0.15 : 0);
  if (color === 'red') return s.red - (s.blue + s.green) * 0.35;
  if (color === 'blue') return s.blue - s.red * 0.6 + (1 - s.light) * 0.22;
  if (color === 'yellow') return (s.red + s.green) * 0.4 - s.blue * 0.5;
  return 0;
}
export function chooseMondrianColors(cells, evidence, density, previous = {}) {
  const budget = 0.08 + density * 0.55;
  let winner, best = -Infinity;
  for (let variant = 0; variant < 6; variant++) {
    const colors = Object.fromEntries(cells.map(c => [c.id, 'white']));
    const palette = ['red', 'blue', 'yellow', 'black'];
    let used = 0, blackArea = 0, momentX = 0, momentY = 0, score = 0;
    const colorCounts = {};
    const ordered = [...cells].sort((a, b) => {
      const rank = c => (c.role === 'torso' ? (c.id.endsWith('-a') ? 4 : 0.7)
        : c.role === 'head' ? (c.id.includes('main') ? 3.7 : 1.1)
          : c.role === 'background' && area(c) < 0.055 ? 2.6 : c.role === 'arm' ? 1 : 0) +
        (evidence[c.id]?.foreground || 0) * 0.4 + ((c.x + variant * 0.13) % 1) * 0.4;
      return rank(b) - rank(a);
    });
    for (const c of ordered) {
      const a = area(c);
      if (a > budget - used || a < 0.002) continue;
      let choice = null, value = -Infinity;
      for (const color of palette) {
        // Darkness can suggest a compact black plane, never swallow the figure.
        if (color === 'black' && blackArea + a > 0.04) continue;
        const intensity = color === 'yellow' ? 0.55 : color === 'black' ? 1.15 : 1;
        const mx = momentX + a * (c.x + c.w / 2 - 0.5) * intensity;
        const my = momentY + a * (c.y + c.h / 2 - 0.5) * intensity;
        const utility = colorEvidence(evidence[c.id], c.role, color) +
          (previous[c.id] === color ? 0.38 : 0) - (colorCounts[color] || 0) * 0.24 - Math.abs(mx) * 3 - Math.abs(my) * 1.2 +
          (palette[(variant + ordered.indexOf(c)) % 4] === color ? 0.12 : 0);
        if (utility > value) { value = utility; choice = { color, mx, my }; }
      }
      colors[c.id] = choice.color; momentX = choice.mx; momentY = choice.my;
      colorCounts[choice.color] = (colorCounts[choice.color] || 0) + 1;
      if (choice.color === 'black') blackArea += a;
      used += a; score += value * a;
      if (c.role === 'torso' || c.role === 'head') score += a * 0.7;
    }
    const distinct = new Set(Object.values(colors).filter(c => c !== 'white')).size;
    score += distinct * 0.014 - Math.abs(used - budget) * 0.4 - Math.abs(momentX) * 2;
    if (score > best) { best = score; winner = colors; }
  }
  return winner;
}

export class MondrianPainter {
  constructor(options = {}) { this.options = sanitizeMondrianOptions(options); this.reset(); }
  reset() { this.anchors = null; this.colors = {}; this.pending = {}; this.lastTime = null; this.lastColors = -Infinity; }
  setOptions(options) { this.options = sanitizeMondrianOptions({ ...this.options, ...options }); this.lastColors = -Infinity; }
  compose(pixels, width, height, mask, face, now) {
    const target = extractMondrianAnchors(pixels, width, height, mask, face);
    const elapsed = this.lastTime == null ? 100 : clamp(now - this.lastTime, 0, 500);
    this.lastTime = now;
    if (!this.anchors) this.anchors = { ...target };
    const alpha = 1 - Math.exp(-elapsed / (1500 - this.options.responsiveness * 1350));
    for (const key of Object.keys(target)) {
      const difference = target[key] - this.anchors[key];
      if (Math.abs(difference) > 0.009) this.anchors[key] += difference * alpha;
    }
    // Maintain ordering even when independently smoothed anchors cross.
    this.anchors.division = Math.min(this.anchors.division, this.anchors.shoulder - 0.06);
    const layout = buildMondrianPartition(this.anchors, this.options);
    if (now - this.lastColors >= 700) {
      const evidence = Object.fromEntries(layout.cells.map(c => [c.id, sample(pixels, width, height, c, mask)]));
      const candidate = chooseMondrianColors(layout.cells, evidence, this.options.density, this.colors);
      if (!Object.keys(this.colors).length) this.colors = candidate;
      else {
        const signature = JSON.stringify(candidate);
        if (this.pending.signature !== signature) this.pending = { signature, since: now };
        if (now - this.pending.since >= 1400) this.colors = candidate;
      }
      this.lastColors = now;
    }
    return { ...layout, colors: this.colors, anchors: { ...this.anchors }, mask, width, height };
  }
  paint(ctx, width, height, layout) {
    ctx.save();
    ctx.fillStyle = MONDRIAN_PALETTE.white; ctx.fillRect(0, 0, width, height);
    for (const c of layout.cells) {
      ctx.fillStyle = MONDRIAN_PALETTE[layout.colors[c.id] || 'white'];
      const x = Math.round(c.x * width), y = Math.round(c.y * height);
      ctx.fillRect(x, y, Math.round((c.x + c.w) * width) - x, Math.round((c.y + c.h) * height) - y);
    }
    ctx.fillStyle = MONDRIAN_PALETTE.black;
    const thickness = Math.max(1, width * (0.003 + this.options.thickness * 0.007));
    for (const l of layout.lines) {
      const t = Math.max(1, Math.round(thickness * (l.major ? 1.12 : 0.78)));
      const x = Math.round(l.x * width), y = Math.round(l.y * height);
      if (l.w === 0) ctx.fillRect(x - Math.floor(t / 2), y, t, Math.ceil(l.h * height));
      else ctx.fillRect(x, y - Math.floor(t / 2), Math.ceil(l.w * width), t);
    }
    if (this.options.texture > 0) {
      ctx.globalAlpha = this.options.texture * 0.035;
      for (let y = 3; y < height; y += 5) for (let x = 2; x < width; x += 7) {
        if ((x * 13 + y * 7) % 11 < 3) ctx.fillRect(x, y, 1, 1);
      }
    }
    ctx.restore();
  }
  paintDebug(ctx, width, height, layout) {
    ctx.clearRect(0, 0, width, height);
    if (!this.options.debug) return;
    ctx.save(); ctx.fillStyle = '#00c5b333';
    for (let y = 0; y < layout.height; y++) for (let x = 0; x < layout.width; x++) {
      if (layout.mask?.[y * layout.width + x]) ctx.fillRect(x / layout.width * width, y / layout.height * height, width / layout.width + 1, height / layout.height + 1);
    }
    ctx.strokeStyle = '#e000bc'; ctx.lineWidth = 1;
    for (const c of layout.cells) ctx.strokeRect(c.x * width + 1, c.y * height + 1, c.w * width - 2, c.h * height - 2);
    ctx.fillStyle = '#008d83'; ctx.font = '11px sans-serif';
    const a = layout.anchors;
    for (const [label, x, y] of [['head', a.cx, a.top], ['shoulder', a.left, a.shoulder], ['torso', a.cx, 0.9], ['arm', a.right, a.rightArm]]) {
      ctx.fillRect(x * width - 3, y * height - 3, 6, 6); ctx.fillText(label, x * width + 5, y * height + 12);
    }
    ctx.restore();
  }
}
