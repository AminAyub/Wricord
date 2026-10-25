// Face-aware Canvas painter shared by the live preview and recording compositor.
import { MondrianPainter } from './mondrian.js';
import { RothkoPlusPainter } from './rothko-plus.js';

import {
  ABSTRACT_PALETTE,
  ART_PALETTE_FAMILIES,
  clamp,
  createAdaptiveRectangles,
  createContentAwareRectangles,
  createTrackedFaceRectangles,
  dominantPaletteColor,
  familyForFaceTile,
  mapFaceToArtwork,
  paletteColorForStructure,
  paletteIndexForColor,
  pixelLuminance,
  quantizeColor,
  stabilizeStructureFamilies,
} from "./art-geometry.js";
import {
  SCENE_SEMANTICS,
  createRothkoFacePlanes,
  createSceneArtwork,
  createScharrEdgeMap,
  createSemanticGrid,
  createYCoCgPlanes,
  labelSceneComponents,
  rectangularizeScene,
} from "./scene-geometry.js";

export {
  ABSTRACT_PALETTE,
  ART_PALETTE_FAMILIES,
  createAdaptiveRectangles,
  createContentAwareRectangles,
  createTrackedFaceRectangles,
  dominantPaletteColor,
  mapFaceToArtwork,
  paletteColorForStructure,
  paletteIndexForColor,
  quantizeColor,
  stabilizeStructureFamilies,
} from "./art-geometry.js";

export {
  SCENE_SEMANTICS,
  createRothkoFacePlanes,
  createSceneArtwork,
  createScharrEdgeMap,
  createSemanticGrid,
  createYCoCgPlanes,
  labelSceneComponents,
  rectangularizeScene,
} from "./scene-geometry.js";

const DEFAULT_SEED = 0x4d4f4e44;
const MAX_ART_WIDTH = 720;
const ANALYSIS_WIDTH = 128;
export const ART_FRAME_INTERVAL_MS = 100;

function sourceDimensions(source) {
  return {
    width: Number(source?.videoWidth || source?.naturalWidth || source?.width || 0),
    height: Number(source?.videoHeight || source?.naturalHeight || source?.height || 0),
  };
}

export function drawVideoFit(ctx, video, width, height, fit, mirror) {
  const source = sourceDimensions(video);
  if (!ctx || source.width <= 0 || source.height <= 0 || width <= 0 || height <= 0) {
    return false;
  }

  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = source.width;
  let sourceHeight = source.height;
  let destinationX = 0;
  let destinationY = 0;
  let destinationWidth = width;
  let destinationHeight = height;

  if (fit === "contain") {
    const scale = Math.min(width / source.width, height / source.height);
    destinationWidth = source.width * scale;
    destinationHeight = source.height * scale;
    destinationX = (width - destinationWidth) / 2;
    destinationY = (height - destinationHeight) / 2;
  } else {
    const sourceAspect = source.width / source.height;
    const destinationAspect = width / height;
    if (sourceAspect > destinationAspect) {
      sourceWidth = source.height * destinationAspect;
      sourceX = (source.width - sourceWidth) / 2;
    } else if (sourceAspect < destinationAspect) {
      sourceHeight = source.width / destinationAspect;
      sourceY = (source.height - sourceHeight) / 2;
    }
  }

  ctx.save();
  if (mirror) {
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
    destinationX = width - destinationX - destinationWidth;
  }
  ctx.drawImage(
    video,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    destinationX,
    destinationY,
    destinationWidth,
    destinationHeight,
  );
  ctx.restore();
  return true;
}

function paintSourceFrame(ctx, video, width, height, mirror) {
  ctx.fillStyle = ART_PALETTE_FAMILIES.ink[0];
  ctx.fillRect(0, 0, width, height);
  // Analyze one uncropped image. The former cover+contain composite duplicated
  // the face into the side fill and invented edges that were not in the scene.
  return drawVideoFit(ctx, video, width, height, "contain", mirror);
}

function containTransform(sourceWidth, sourceHeight, width, height) {
  if (sourceWidth <= 0 || sourceHeight <= 0 || width <= 0 || height <= 0) return null;
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const fittedWidth = sourceWidth * scale;
  const fittedHeight = sourceHeight * scale;
  return {
    x: (width - fittedWidth) / 2,
    y: (height - fittedHeight) / 2,
    width: fittedWidth,
    height: fittedHeight,
  };
}

/** Resample raw-camera semantic categories into the contained artwork frame. */
export function mapSegmentationToArtwork(
  segmentation,
  sourceWidth,
  sourceHeight,
  width,
  height,
  mirror = false,
) {
  const maskWidth = Math.round(Number(segmentation?.width) || 0);
  const maskHeight = Math.round(Number(segmentation?.height) || 0);
  const source = segmentation?.data;
  const transform = containTransform(sourceWidth, sourceHeight, width, height);
  if (
    !transform || !ArrayBuffer.isView(source) || maskWidth < 1 || maskHeight < 1 ||
    source.length < maskWidth * maskHeight
  ) return null;

  const outputWidth = Math.max(1, Math.round(width));
  const outputHeight = Math.max(1, Math.round(height));
  const output = new Uint8Array(outputWidth * outputHeight);
  for (let y = 0; y < outputHeight; y += 1) {
    const sourceY = (y + 0.5 - transform.y) / transform.height;
    if (sourceY < 0 || sourceY >= 1) continue;
    const maskY = clamp(Math.floor(sourceY * maskHeight), 0, maskHeight - 1);
    for (let x = 0; x < outputWidth; x += 1) {
      let sourceX = (x + 0.5 - transform.x) / transform.width;
      if (sourceX < 0 || sourceX >= 1) continue;
      if (mirror) sourceX = 1 - sourceX;
      const maskX = clamp(Math.floor(sourceX * maskWidth), 0, maskWidth - 1);
      output[y * outputWidth + x] = source[maskY * maskWidth + maskX];
    }
  }
  return output;
}

function sampleRectangleLuminance(
  pixels,
  sampleWidth,
  sampleHeight,
  rectangle,
  artWidth,
  artHeight,
) {
  let total = 0;
  let count = 0;
  for (const vertical of [0.25, 0.5, 0.75]) {
    for (const horizontal of [0.25, 0.5, 0.75]) {
      const artX = rectangle.x + rectangle.width * horizontal;
      const artY = rectangle.y + rectangle.height * vertical;
      const sampleX = clamp(Math.floor(artX / artWidth * sampleWidth), 0, sampleWidth - 1);
      const sampleY = clamp(Math.floor(artY / artHeight * sampleHeight), 0, sampleHeight - 1);
      const offset = (sampleY * sampleWidth + sampleX) * 4;
      total += pixelLuminance(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
      count += 1;
    }
  }
  return total / Math.max(1, count);
}

function paintRectangle(ctx, rectangle, color, overlap = 0.35) {
  ctx.fillStyle = color;
  ctx.fillRect(
    rectangle.x - overlap,
    rectangle.y - overlap,
    Math.max(0, rectangle.width + overlap * 2),
    Math.max(0, rectangle.height + overlap * 2),
  );
}

function stableHash(value) {
  let hash = 0x811c9dc5;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function overlapArea(first, second) {
  const width = Math.min(first.x + first.width, second.x + second.width) -
    Math.max(first.x, second.x);
  const height = Math.min(first.y + first.height, second.y + second.height) -
    Math.max(first.y, second.y);
  return Math.max(0, width) * Math.max(0, height);
}

function sceneGroups(rectangles, previous = false) {
  const groups = new Map();
  for (const rectangle of rectangles || []) {
    const key = previous
      ? rectangle.trackId
      : `${rectangle.owner === "person" ? "person" : "background"}:` +
        `${rectangle.role}:${rectangle.structureId}`;
    if (!key) continue;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        rectangles: [],
        area: 0,
        role: rectangle.role,
        person: rectangle.owner === "person",
      });
    }
    const group = groups.get(key);
    group.rectangles.push(rectangle);
    group.area += rectangle.width * rectangle.height;
  }
  return [...groups.values()];
}

/** Match full-scene components by overlap so palette/tone identities survive relabelling. */
export function trackSceneRectangles(
  rectangles,
  previousRectangles = [],
  nextTrackId = 1,
) {
  const nextGroups = sceneGroups(rectangles);
  const previousGroups = sceneGroups(previousRectangles, true);
  const candidates = [];
  for (const next of nextGroups) {
    for (const previous of previousGroups) {
      if (next.person !== previous.person || next.role !== previous.role) continue;
      let overlap = 0;
      for (const currentRectangle of next.rectangles) {
        for (const previousRectangle of previous.rectangles) {
          overlap += overlapArea(currentRectangle, previousRectangle);
        }
      }
      if (overlap <= 0) continue;
      const largestArea = Math.max(1, next.area, previous.area);
      candidates.push({
        next,
        previous,
        // Intersection / largest-area coverage prevents a tiny fragment that is
        // swallowed by a merge from stealing the dominant structure's identity.
        score: overlap / largestArea,
        overlap,
      });
    }
  }
  candidates.sort((left, right) =>
    right.overlap - left.overlap || right.score - left.score ||
    String(left.previous.key).localeCompare(String(right.previous.key)));

  const matchedNext = new Set();
  const matchedPrevious = new Set();
  for (const candidate of candidates) {
    if (candidate.score < 0.12) continue;
    if (matchedNext.has(candidate.next.key) || matchedPrevious.has(candidate.previous.key)) continue;
    for (const rectangle of candidate.next.rectangles) rectangle.trackId = candidate.previous.key;
    matchedNext.add(candidate.next.key);
    matchedPrevious.add(candidate.previous.key);
  }

  let counter = Math.max(1, Math.floor(Number(nextTrackId) || 1));
  for (const group of nextGroups) {
    if (!group.rectangles[0].trackId) {
      const trackId = `scene-track-${counter++}`;
      for (const rectangle of group.rectangles) rectangle.trackId = trackId;
    }
  }
  return { rectangles, nextTrackId: counter };
}

function rectangleToneKey(rectangle) {
  return `${rectangle.trackId}:${rectangle.role}`;
}

function familyForSceneRectangle(rectangle) {
  if (rectangle.owner === "person") {
    if (rectangle.role === "hair") return "ink";
    if (rectangle.role === "clothes" || rectangle.role === "torso") return "violet";
    if (rectangle.role === "accessories") return "gold";
    return "vermilion";
  }
  const background = ["teal", "cobalt", "gold"];
  return background[stableHash(rectangle.trackId ?? rectangle.structureId ?? rectangle.id) % background.length];
}

function familyForFacePlane(plane) {
  if (plane.kind === "hair") return "ink";
  if (plane.kind === "brow") return "ink";
  if (plane.kind === "eye") return plane.tone === "deep" ? "ink" : "cobalt";
  if (plane.kind === "mouth") return plane.tone === "deep" ? "ink" : "violet";
  if (plane.kind === "nose") return plane.tone === "shadow" ? "gold" : "vermilion";
  return "vermilion";
}

function toneOffset(tone) {
  if (tone === "deep") return -0.34;
  if (tone === "dark") return -0.23;
  if (tone === "shadow") return -0.14;
  if (tone === "light") return 0.18;
  if (tone === "warm") return 0.07;
  return 0;
}

function paintRothkoField(ctx, rectangle, color, innerColor = null) {
  paintRectangle(ctx, rectangle, color);
  if (!innerColor || rectangle.width < 10 || rectangle.height < 7) return;
  const insetX = Math.min(rectangle.width * 0.055, 3.5);
  const insetY = Math.min(rectangle.height * 0.08, 3);
  ctx.save();
  ctx.globalAlpha = 0.24;
  ctx.fillStyle = innerColor;
  ctx.fillRect(
    rectangle.x + insetX,
    rectangle.y + insetY,
    Math.max(0, rectangle.width - insetX * 2),
    Math.max(0, rectangle.height - insetY * 2),
  );
  ctx.restore();
}

export class AbstractCameraRenderer {
  constructor({
    canvas,
    video,
    faceTracker = null,
    getMirror = () => false,
    seed = DEFAULT_SEED,
    now = () => globalThis.performance?.now?.() ?? Date.now(),
  } = {}) {
    if (!canvas || typeof canvas.getContext !== "function") {
      throw new TypeError("AbstractCameraRenderer requires a canvas");
    }
    this.canvas = canvas;
    this.video = video;
    this.faceTracker = faceTracker;
    this.getMirror = getMirror;
    this.seed = seed;
    this.mode = 'rothko';
    this.mondrian = new MondrianPainter();
    this.rothkoPlus = new RothkoPlusPainter();
    this.debugCanvas = null;
    this.now = now;
    this.context = canvas.getContext("2d", { alpha: false });
    if (!this.context) throw new Error("The camera artwork canvas is unavailable");

    const document = canvas.ownerDocument;
    this.analysisCanvas = document.createElement("canvas");
    this.analysisContext = this.analysisCanvas.getContext("2d", {
      alpha: false,
      willReadFrequently: true,
    });
    if (!this.analysisContext) throw new Error("The camera analysis canvas is unavailable");

    this.rectangles = [];
    this.facePlanes = [];
    this.previousEdgeStrength = null;
    this.nextTrackId = 1;
    this.toneMemory = new Map();
    this.lastMirror = null;
    this.lastMediaTime = Number.NaN;
    this.lastArtworkTime = Number.NEGATIVE_INFINITY;
    this.toneMemory.clear();
    this.hasFrame = false;
    this.running = false;
    this.frameHandle = null;
    this.videoFrameHandle = null;
    this.resizeObserver = null;
    this.resizeHandler = null;
    this.sizeDirty = true;
    this.syncSize();
  }

  syncSize() {
    this.sizeDirty = false;
    const bounds = this.canvas.getBoundingClientRect?.();
    const cssWidth = Number(this.canvas.clientWidth || bounds?.width || this.canvas.width || 540);
    const cssHeight = Number(this.canvas.clientHeight || bounds?.height || this.canvas.height || 240);
    const view = this.canvas.ownerDocument?.defaultView;
    const pixelRatio = clamp(Number(view?.devicePixelRatio) || 1, 1, 2);
    const scale = Math.min(pixelRatio, MAX_ART_WIDTH / Math.max(1, cssWidth));
    const width = Math.max(1, Math.round(cssWidth * scale));
    const height = Math.max(1, Math.round(cssHeight * scale));

    if (this.canvas.width === width && this.canvas.height === height && this.rectangles.length) {
      return false;
    }
    this.canvas.width = width;
    this.canvas.height = height;
    this.rectangles = createAdaptiveRectangles(width, height, this.seed);
    const analysisWidth = Math.min(ANALYSIS_WIDTH, width);
    this.analysisCanvas.width = Math.max(1, analysisWidth);
    this.analysisCanvas.height = Math.max(
      1,
      Math.min(160, Math.round(analysisWidth * height / width)),
    );
    this.lastMediaTime = Number.NaN;
    this.lastArtworkTime = Number.NEGATIVE_INFINITY;
    this.previousEdgeStrength = null;
    this.facePlanes = [];
    this.nextTrackId = 1;
    this.drawFallback();
    return true;
  }

  drawFallback() {
    this.context.fillStyle = ART_PALETTE_FAMILIES.ink[0];
    this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);
    for (let index = 0; index < this.rectangles.length; index += 1) {
      const rectangle = this.rectangles[index];
      const family = index % 17 === 0 ? "cobalt" : index % 11 === 0 ? "violet" : "ink";
      paintRectangle(
        this.context,
        rectangle,
        paletteColorForStructure(family, 0.25, rectangle.id),
        0.35,
      );
    }
    this.hasFrame = false;
  }

  smoothedTone(key, current, alpha) {
    const previous = this.toneMemory.get(key);
    const next = previous == null ? current : previous + (current - previous) * alpha;
    this.toneMemory.set(key, next);
    if (this.toneMemory.size > 1_024) this.toneMemory.clear();
    return next;
  }

  setMode(mode) {
    this.mode = ['mondrian', 'rothko-plus'].includes(mode) ? mode : 'rothko';
    this.rothkoPlus.reset();
    this.lastArtworkTime = Number.NEGATIVE_INFINITY;
    this.debugCanvas?.getContext('2d')?.clearRect(0, 0, this.debugCanvas.width, this.debugCanvas.height);
  }

  render(mirror = this.getMirror(), force = false) {
    const resized = this.sizeDirty ? this.syncSize() : false;
    const readyState = Number(this.video?.readyState);
    const dimensions = sourceDimensions(this.video);
    const sourceReady = dimensions.width > 0 && dimensions.height > 0 &&
      (!Number.isFinite(readyState) || readyState >= 2);
    if (!sourceReady) return false;

    const now = this.now();
    const mirrorChanged = this.lastMirror !== Boolean(mirror);
    if (
      !force && !resized && !mirrorChanged &&
      now - this.lastArtworkTime < ART_FRAME_INTERVAL_MS
    ) return false;

    const mediaTime = Number(this.video?.currentTime);
    if (
      !force && !resized && !mirrorChanged &&
      Number.isFinite(mediaTime) && mediaTime === this.lastMediaTime
    ) {
      return false;
    }

    const sampleWidth = this.analysisCanvas.width;
    const sampleHeight = this.analysisCanvas.height;
    // Failed or slow frames should also be rate-limited. The last completed
    // painting remains visible until this attempt produces a replacement.
    this.lastArtworkTime = now;
    if (mirrorChanged) {
      this.mondrian.reset();
      this.rothkoPlus.reset();
      this.lastMirror = Boolean(mirror);
      this.toneMemory.clear();
      this.previousEdgeStrength = null;
    }
    try {
      if (!paintSourceFrame(
        this.analysisContext,
        this.video,
        sampleWidth,
        sampleHeight,
        Boolean(mirror),
      )) return false;
      const pixels = this.analysisContext.getImageData(0, 0, sampleWidth, sampleHeight).data;

      this.faceTracker?.update?.(this.video, now);
      const mappedFace = mapFaceToArtwork(
        this.faceTracker?.getFace?.(now),
        dimensions.width,
        dimensions.height,
        sampleWidth,
        sampleHeight,
        Boolean(mirror),
      );
      const categoryMask = mapSegmentationToArtwork(
        this.faceTracker?.getSegmentation?.(now),
        dimensions.width,
        dimensions.height,
        sampleWidth,
        sampleHeight,
        Boolean(mirror),
      );
      if (this.mode === 'rothko-plus') {
        this.rothkoPlus.render(this.context, this.canvas.width, this.canvas.height, pixels,
          sampleWidth, sampleHeight, categoryMask, mappedFace,
          this.faceTracker?.getFace?.(now), dimensions.width / dimensions.height, now);
        this.lastMediaTime = mediaTime;
        this.hasFrame = true;
        return true;
      }
      if (this.mode === 'mondrian') {
        const layout = this.mondrian.compose(pixels, sampleWidth, sampleHeight, categoryMask, mappedFace, now);
        this.mondrian.paint(this.context, this.canvas.width, this.canvas.height, layout);
        if (this.debugCanvas) {
          if (this.debugCanvas.width !== this.canvas.width || this.debugCanvas.height !== this.canvas.height) {
            this.debugCanvas.width = this.canvas.width;
            this.debugCanvas.height = this.canvas.height;
          }
          this.mondrian.paintDebug(this.debugCanvas.getContext('2d'), this.canvas.width, this.canvas.height, layout);
        }
        this.lastMediaTime = mediaTime;
        this.hasFrame = true;
        return true;
      }
      const scene = createSceneArtwork(
        pixels,
        sampleWidth,
        sampleHeight,
        this.canvas.width,
        this.canvas.height,
        {
          categoryMask,
          mappedFace,
          previousEdgeStrength: this.previousEdgeStrength,
          minimumRegionSize: 9,
          colorThreshold: 0.14,
        },
      );
      this.previousEdgeStrength = scene.previousEdgeStrength;

      const previousFamilyByTrack = new Map(
        this.rectangles
          .filter(rectangle => rectangle.trackId && rectangle.family)
          .map(rectangle => [rectangle.trackId, rectangle.family]),
      );
      const tracked = trackSceneRectangles(
        scene.rectangles.map(rectangle => ({ ...rectangle })),
        this.rectangles,
        this.nextTrackId,
      );
      this.nextTrackId = tracked.nextTrackId;
      const nextRectangles = tracked.rectangles;
      for (const rectangle of nextRectangles) {
        rectangle.family = previousFamilyByTrack.get(rectangle.trackId) ||
          familyForSceneRectangle(rectangle);
      }
      stabilizeStructureFamilies(nextRectangles, this.rectangles);
      // Semantic ownership wins over color-overlap identity transfer. This is
      // what makes face, neck, and clothing read as one deliberate subject.
      for (const rectangle of nextRectangles) {
        if (rectangle.owner === "person") rectangle.family = familyForSceneRectangle(rectangle);
      }
      this.rectangles = nextRectangles;
      this.facePlanes = scene.facePlanes.filter(
        plane => plane.kind !== "hair" || !scene.usedCategoryMask,
      );

      this.context.fillStyle = ART_PALETTE_FAMILIES.ink[0];
      this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);

      const orderedRectangles = [...this.rectangles].sort(
        (left, right) => Number(left.owner === "person") - Number(right.owner === "person"),
      );
      const toneSamples = new Map();
      for (const rectangle of orderedRectangles) {
        const toneKey = rectangleToneKey(rectangle);
        const measuredLight = sampleRectangleLuminance(
          pixels,
          sampleWidth,
          sampleHeight,
          rectangle,
          this.canvas.width,
          this.canvas.height,
        );
        const weight = Math.max(1, rectangle.width * rectangle.height);
        const sample = toneSamples.get(toneKey) || { weightedLight: 0, weight: 0 };
        sample.weightedLight += measuredLight * weight;
        sample.weight += weight;
        toneSamples.set(toneKey, sample);
      }
      const stableTones = new Map();
      for (const [toneKey, sample] of toneSamples) {
        stableTones.set(
          toneKey,
          this.smoothedTone(
            `scene:${toneKey}`,
            sample.weightedLight / Math.max(1, sample.weight),
            0.34,
          ),
        );
      }
      for (const rectangle of orderedRectangles) {
        const toneKey = rectangleToneKey(rectangle);
        const sourceLight = stableTones.get(toneKey) ?? 0.5;
        const color = paletteColorForStructure(
          rectangle.family,
          sourceLight,
          toneKey,
        );
        const innerLight = clamp(
          sourceLight + (stableHash(toneKey) % 2 ? 0.11 : -0.09),
          0,
          1,
        );
        const innerColor = paletteColorForStructure(
          rectangle.family,
          innerLight,
          `${toneKey}:inner`,
        );
        paintRothkoField(
          this.context,
          rectangle,
          color,
          innerColor,
        );
      }

      const personRectangles = this.rectangles.filter(rectangle => rectangle.owner === "person");
      const canClipFace = personRectangles.length > 0 &&
        typeof this.context.beginPath === "function" &&
        typeof this.context.rect === "function" &&
        typeof this.context.clip === "function";
      if (canClipFace) {
        this.context.save();
        this.context.beginPath();
        for (const rectangle of personRectangles) {
          this.context.rect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
        }
        this.context.clip();
      }
      for (const rectangle of personRectangles.length ? this.facePlanes : []) {
        const measuredLight = sampleRectangleLuminance(
          pixels,
          sampleWidth,
          sampleHeight,
          rectangle,
          this.canvas.width,
          this.canvas.height,
        );
        const sourceLight = clamp(this.smoothedTone(
          `feature:${rectangle.id}`,
          measuredLight,
          0.42,
        ) + toneOffset(rectangle.tone), 0, 1);
        const color = paletteColorForStructure(
          familyForFacePlane(rectangle),
          sourceLight,
          rectangle.id,
        );
        if (rectangle.kind === "face" || rectangle.kind === "hair") {
          const innerColor = paletteColorForStructure(
            familyForFacePlane(rectangle),
            clamp(sourceLight + 0.1, 0, 1),
            `${rectangle.id}:inner`,
          );
          paintRothkoField(this.context, rectangle, color, innerColor);
        } else {
          paintRectangle(this.context, rectangle, color, 0.18);
        }
      }
      if (canClipFace) this.context.restore();
    } catch {
      // Retain the last complete artwork if a webcam frame is briefly unreadable.
      return false;
    }

    this.lastMediaTime = mediaTime;
    this.hasFrame = true;
    return true;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.sizeDirty = true;
    this.faceTracker?.start?.();
    const view = this.canvas.ownerDocument?.defaultView;
    const drawNextFrame = () => {
      if (!this.running) return;
      this.render();
      if (typeof this.video?.requestVideoFrameCallback === "function") {
        this.videoFrameHandle = this.video.requestVideoFrameCallback(drawNextFrame);
      } else {
        this.frameHandle = view.requestAnimationFrame(drawNextFrame);
      }
    };

    this.resizeHandler = () => {
      this.sizeDirty = true;
      this.render(this.getMirror(), true);
    };
    if (typeof view?.ResizeObserver === "function") {
      this.resizeObserver = new view.ResizeObserver(this.resizeHandler);
      this.resizeObserver.observe(this.canvas);
    }
    view?.addEventListener?.("resize", this.resizeHandler, { passive: true });
    drawNextFrame();
  }

  restart() {
    this.stop();
    this.start();
    this.render(this.getMirror(), true);
  }

  stop() {
    const view = this.canvas.ownerDocument?.defaultView;
    this.running = false;
    if (this.frameHandle != null) view?.cancelAnimationFrame?.(this.frameHandle);
    if (this.videoFrameHandle != null) {
      this.video?.cancelVideoFrameCallback?.(this.videoFrameHandle);
    }
    this.frameHandle = null;
    this.videoFrameHandle = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.resizeHandler) view?.removeEventListener?.("resize", this.resizeHandler);
    this.resizeHandler = null;
    this.faceTracker?.stop?.();
  }

  dispose() {
    this.stop();
    this.faceTracker?.dispose?.();
  }
}
