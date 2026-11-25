import { FilterMode, Point, QuadCorners, ScanAdjustments } from '../types/scanner';

/**
 * Loads an HTMLImageElement from a data URL or object URL.
 */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo cargar la imagen.'));
    img.src = src;
  });
}

/**
 * Reads a File/Blob into a Data URL.
 */
export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('No se pudo leer el archivo.'));
      }
    };
    reader.onerror = () => reject(new Error('Error al leer la imagen.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Creates a canvas containing the source image rotated clockwise by 0, 90, 180, or 270 degrees.
 */
export function createRotatedCanvas(
  img: HTMLImageElement,
  rotationDeg: number,
  maxDim = 2600
): HTMLCanvasElement {
  const rot = ((rotationDeg % 360) + 360) % 360;
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;

  const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
  const drawW = Math.max(1, Math.round(srcW * scale));
  const drawH = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  if (rot === 90 || rot === 270) {
    canvas.width = drawH;
    canvas.height = drawW;
  } else {
    canvas.width = drawW;
    canvas.height = drawH;
  }

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return canvas;

  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();

  return canvas;
}

/**
 * Rotates normalized quad corners clockwise by 90 degrees.
 */
export function rotateCornersClockwise(corners: QuadCorners): QuadCorners {
  // (x, y) -> (1 - y, x)
  const rotated = corners.map((p) => ({
    x: clamp01(1 - p.y),
    y: clamp01(p.x),
  }));
  // Re-order [TL, TR, BR, BL]: old BL becomes new TL, etc.
  return [rotated[3], rotated[0], rotated[1], rotated[2]];
}

/**
 * Rotates normalized quad corners counter-clockwise by 90 degrees.
 */
export function rotateCornersCounterClockwise(corners: QuadCorners): QuadCorners {
  // (x, y) -> (y, 1 - x)
  const rotated = corners.map((p) => ({
    x: clamp01(p.y),
    y: clamp01(1 - p.x),
  }));
  return [rotated[1], rotated[2], rotated[3], rotated[0]];
}

export function fullPageCorners(): QuadCorners {
  return [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

/**
 * Automatically detects the 4 corners of a document in an oriented canvas.
 * Uses Sobel gradient detection + connected/dense edge filtering + convex hull quad fitting.
 */
export function autoDetectDocumentCorners(canvas: HTMLCanvasElement): QuadCorners {
  const defaultQuad: QuadCorners = [
    { x: 0.06, y: 0.06 },
    { x: 0.94, y: 0.06 },
    { x: 0.94, y: 0.94 },
    { x: 0.06, y: 0.94 },
  ];

  const srcW = canvas.width;
  const srcH = canvas.height;
  if (srcW < 40 || srcH < 40) return defaultQuad;

  const targetMax = 260;
  const scale = Math.min(1, targetMax / Math.max(srcW, srcH));
  const w = Math.max(32, Math.round(srcW * scale));
  const h = Math.max(32, Math.round(srcH * scale));

  const work = document.createElement('canvas');
  work.width = w;
  work.height = h;
  const wCtx = work.getContext('2d', { willReadFrequently: true });
  if (!wCtx) return defaultQuad;
  wCtx.drawImage(canvas, 0, 0, w, h);

  const imgData = wCtx.getImageData(0, 0, w, h).data;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const idx = i * 4;
    gray[i] = 0.299 * imgData[idx] + 0.587 * imgData[idx + 1] + 0.114 * imgData[idx + 2];
  }

  // 3x3 Gaussian blur to suppress fine paper grain & text noise
  const blurred = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      blurred[i] =
        (gray[i - w - 1] +
          2 * gray[i - w] +
          gray[i - w + 1] +
          2 * gray[i - 1] +
          4 * gray[i] +
          2 * gray[i + 1] +
          gray[i + w - 1] +
          2 * gray[i + w] +
          gray[i + w + 1]) /
        16;
    }
  }

  // Sobel gradient magnitude
  const grad = new Float32Array(w * h);
  let sumGrad = 0;
  let countGrad = 0;
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      const i = y * w + x;
      const gx =
        -blurred[i - w - 1] +
        blurred[i - w + 1] -
        2 * blurred[i - 1] +
        2 * blurred[i + 1] -
        blurred[i + w - 1] +
        blurred[i + w + 1];
      const gy =
        -blurred[i - w - 1] -
        2 * blurred[i - w] -
        blurred[i - w + 1] +
        blurred[i + w - 1] +
        2 * blurred[i + w] +
        blurred[i + w + 1];
      const mag = Math.hypot(gx, gy);
      grad[i] = mag;
      sumGrad += mag;
      countGrad++;
    }
  }

  const meanGrad = countGrad > 0 ? sumGrad / countGrad : 0;
  const threshold = Math.max(28, meanGrad * 1.9);

  // Collect edge points that have neighbor support (reduces isolated speckles)
  const marginX = Math.max(3, Math.round(w * 0.015));
  const marginY = Math.max(3, Math.round(h * 0.015));
  const points: Point[] = [];

  for (let y = marginY; y < h - marginY; y++) {
    for (let x = marginX; x < w - marginX; x++) {
      const i = y * w + x;
      if (grad[i] > threshold) {
        let neighbors = 0;
        if (grad[i - 1] > threshold * 0.75) neighbors++;
        if (grad[i + 1] > threshold * 0.75) neighbors++;
        if (grad[i - w] > threshold * 0.75) neighbors++;
        if (grad[i + w] > threshold * 0.75) neighbors++;
        if (grad[i - w - 1] > threshold * 0.75) neighbors++;
        if (grad[i - w + 1] > threshold * 0.75) neighbors++;
        if (grad[i + w - 1] > threshold * 0.75) neighbors++;
        if (grad[i + w + 1] > threshold * 0.75) neighbors++;

        if (neighbors >= 2) {
          points.push({ x: x / w, y: y / h });
        }
      }
    }
  }

  if (points.length < 24) {
    return defaultQuad;
  }

  // Compute convex hull
  const hull = convexHull(points);
  if (hull.length < 4) {
    return defaultQuad;
  }

  // Fit 4 corners from the convex hull by optimizing diagonal projections
  let tl = hull[0];
  let tr = hull[0];
  let br = hull[0];
  let bl = hull[0];

  let minSum = Infinity;
  let maxSum = -Infinity;
  let minDiff = Infinity;
  let maxDiff = -Infinity;

  for (const p of hull) {
    const sum = p.x + p.y;
    const diff = p.x - p.y;
    if (sum < minSum) {
      minSum = sum;
      tl = p;
    }
    if (sum > maxSum) {
      maxSum = sum;
      br = p;
    }
    if (diff > maxDiff) {
      maxDiff = diff;
      tr = p;
    }
    if (diff < minDiff) {
      minDiff = diff;
      bl = p;
    }
  }

  const quad: QuadCorners = [tl, tr, br, bl];
  const area = quadArea(quad);

  // Sanity check: document should occupy a meaningful fraction of the frame
  if (area < 0.14 || !isConvexQuad(quad)) {
    return defaultQuad;
  }

  return quad;
}

function convexHull(pts: Point[]): Point[] {
  const sorted = [...pts].sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y));
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: Point[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: Point[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

function quadArea(q: QuadCorners): number {
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

function isConvexQuad(q: QuadCorners): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = q[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-6) return false;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/**
 * Solves 8x8 linear system to find a 3x3 homography matrix mapping dst -> src.
 */
function computeHomography(dstPts: Point[], srcPts: Point[]): number[] {
  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const x = dstPts[i].x;
    const y = dstPts[i].y;
    const u = srcPts[i].x;
    const v = srcPts[i].y;

    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);

    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }

  // Gaussian elimination with partial pivoting
  const n = 8;
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    let maxVal = Math.abs(A[col][col]);
    for (let row = col + 1; row < n; row++) {
      const val = Math.abs(A[row][col]);
      if (val > maxVal) {
        maxVal = val;
        maxRow = row;
      }
    }

    if (maxRow !== col) {
      [A[col], A[maxRow]] = [A[maxRow], A[col]];
      [b[col], b[maxRow]] = [b[maxRow], b[col]];
    }

    const pivot = A[col][col];
    if (Math.abs(pivot) < 1e-12) continue;

    for (let row = col + 1; row < n; row++) {
      const factor = A[row][col] / pivot;
      for (let k = col; k < n; k++) {
        A[row][k] -= factor * A[col][k];
      }
      b[row] -= factor * b[col];
    }
  }

  const h = new Array<number>(9).fill(0);
  h[8] = 1;
  for (let i = n - 1; i >= 0; i--) {
    let sum = b[i];
    for (let j = i + 1; j < n; j++) {
      sum -= A[i][j] * h[j];
    }
    h[i] = Math.abs(A[i][i]) > 1e-12 ? sum / A[i][i] : 0;
  }

  return h;
}

/**
 * Performs perspective rectification (homography warp) with bilinear interpolation.
 */
export function warpPerspectiveCanvas(
  sourceCanvas: HTMLCanvasElement,
  corners: QuadCorners,
  maxEdge = 2000
): HTMLCanvasElement {
  const srcW = sourceCanvas.width;
  const srcH = sourceCanvas.height;

  const srcPts: Point[] = corners.map((c) => ({
    x: c.x * (srcW - 1),
    y: c.y * (srcH - 1),
  }));

  const topW = Math.hypot(srcPts[1].x - srcPts[0].x, srcPts[1].y - srcPts[0].y);
  const bottomW = Math.hypot(srcPts[2].x - srcPts[3].x, srcPts[2].y - srcPts[3].y);
  const leftH = Math.hypot(srcPts[3].x - srcPts[0].x, srcPts[3].y - srcPts[0].y);
  const rightH = Math.hypot(srcPts[2].x - srcPts[1].x, srcPts[2].y - srcPts[1].y);

  let outW = Math.max(60, Math.round(Math.max(topW, bottomW)));
  let outH = Math.max(60, Math.round(Math.max(leftH, rightH)));

  const scale = Math.min(1, maxEdge / Math.max(outW, outH));
  outW = Math.max(60, Math.round(outW * scale));
  outH = Math.max(60, Math.round(outH * scale));

  const outCanvas = document.createElement('canvas');
  outCanvas.width = outW;
  outCanvas.height = outH;

  const srcCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  const outCtx = outCanvas.getContext('2d', { willReadFrequently: true });
  if (!srcCtx || !outCtx) return outCanvas;

  // Fast path: if corners are essentially full frame (0,0 -> 1,1), just draw scaled
  const eps = 0.002;
  const isFullRect =
    Math.abs(corners[0].x) < eps &&
    Math.abs(corners[0].y) < eps &&
    Math.abs(corners[1].x - 1) < eps &&
    Math.abs(corners[1].y) < eps &&
    Math.abs(corners[2].x - 1) < eps &&
    Math.abs(corners[2].y - 1) < eps &&
    Math.abs(corners[3].x) < eps &&
    Math.abs(corners[3].y - 1) < eps;

  if (isFullRect) {
    outCtx.drawImage(sourceCanvas, 0, 0, outW, outH);
    return outCanvas;
  }

  const dstPts: Point[] = [
    { x: 0, y: 0 },
    { x: outW - 1, y: 0 },
    { x: outW - 1, y: outH - 1 },
    { x: 0, y: outH - 1 },
  ];

  const H = computeHomography(dstPts, srcPts);
  const srcData = srcCtx.getImageData(0, 0, srcW, srcH).data;
  const outImageData = outCtx.createImageData(outW, outH);
  const dstData = outImageData.data;

  const h0 = H[0],
    h1 = H[1],
    h2 = H[2];
  const h3 = H[3],
    h4 = H[4],
    h5 = H[5];
  const h6 = H[6],
    h7 = H[7],
    h8 = H[8];

  const maxX = srcW - 1;
  const maxY = srcH - 1;

  for (let y = 0; y < outH; y++) {
    const rowBaseX = h1 * y + h2;
    const rowBaseY = h4 * y + h5;
    const rowBaseW = h7 * y + h8;
    const dstRowOffset = y * outW * 4;

    for (let x = 0; x < outW; x++) {
      const denom = h6 * x + rowBaseW;
      const invD = denom !== 0 ? 1 / denom : 1;
      let sx = (h0 * x + rowBaseX) * invD;
      let sy = (h3 * x + rowBaseY) * invD;

      if (sx < 0) sx = 0;
      else if (sx > maxX) sx = maxX;
      if (sy < 0) sy = 0;
      else if (sy > maxY) sy = maxY;

      const x0 = sx | 0;
      const y0 = sy | 0;
      const x1 = x0 < maxX ? x0 + 1 : maxX;
      const y1 = y0 < maxY ? y0 + 1 : maxY;
      const fx = sx - x0;
      const fy = sy - y0;
      const ifx = 1 - fx;
      const ify = 1 - fy;

      const w00 = ifx * ify;
      const w10 = fx * ify;
      const w01 = ifx * fy;
      const w11 = fx * fy;

      const i00 = (y0 * srcW + x0) * 4;
      const i10 = (y0 * srcW + x1) * 4;
      const i01 = (y1 * srcW + x0) * 4;
      const i11 = (y1 * srcW + x1) * 4;

      const dIdx = dstRowOffset + x * 4;
      dstData[dIdx] =
        (srcData[i00] * w00 + srcData[i10] * w10 + srcData[i01] * w01 + srcData[i11] * w11 + 0.5) |
        0;
      dstData[dIdx + 1] =
        (srcData[i00 + 1] * w00 +
          srcData[i10 + 1] * w10 +
          srcData[i01 + 1] * w01 +
          srcData[i11 + 1] * w11 +
          0.5) |
        0;
      dstData[dIdx + 2] =
        (srcData[i00 + 2] * w00 +
          srcData[i10 + 2] * w10 +
          srcData[i01 + 2] * w01 +
          srcData[i11 + 2] * w11 +
          0.5) |
        0;
      dstData[dIdx + 3] = 255;
    }
  }

  outCtx.putImageData(outImageData, 0, 0);
  return outCanvas;
}

/**
 * Estimates smooth local paper background color on a downsampled grid using
 * sliding-window morphological dilation (local maximum) followed by separable box blur.
 * Removes uneven lighting, desk shadows, and yellow paper cast while preserving text/ink.
 */
function estimatePaperIllumination(
  data: Uint8ClampedArray,
  w: number,
  h: number
): { bgR: Float32Array; bgG: Float32Array; bgB: Float32Array; dw: number; dh: number } {
  const ds = Math.max(1, Math.round(Math.max(w, h) / 360));
  const dw = Math.max(16, Math.ceil(w / ds));
  const dh = Math.max(16, Math.ceil(h / ds));

  const rArr = new Float32Array(dw * dh);
  const gArr = new Float32Array(dw * dh);
  const bArr = new Float32Array(dw * dh);

  for (let y = 0; y < dh; y++) {
    const sy = Math.min(h - 1, y * ds);
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(w - 1, x * ds);
      const sIdx = (sy * w + sx) * 4;
      const dIdx = y * dw + x;
      rArr[dIdx] = data[sIdx];
      gArr[dIdx] = data[sIdx + 1];
      bArr[dIdx] = data[sIdx + 2];
    }
  }

  const maxRadius = Math.max(5, Math.round(Math.max(dw, dh) * 0.032));
  const blurRadius = Math.max(6, Math.round(Math.max(dw, dh) * 0.04));

  const dilateChannel = (ch: Float32Array) => {
    const temp = new Float32Array(dw * dh);
    const out = new Float32Array(dw * dh);
    const deque = new Int32Array(Math.max(dw, dh));

    // Horizontal max
    for (let y = 0; y < dh; y++) {
      const row = y * dw;
      let head = 0;
      let tail = 0;
      for (let x = 0; x < dw + maxRadius; x++) {
        if (x < dw) {
          const val = ch[row + x];
          while (tail > head && ch[row + deque[tail - 1]] <= val) tail--;
          deque[tail++] = x;
        }
        const outX = x - maxRadius;
        if (outX >= 0) {
          while (head < tail && deque[head] < outX - maxRadius) head++;
          temp[row + outX] = ch[row + deque[head]];
        }
      }
    }

    // Vertical max
    for (let x = 0; x < dw; x++) {
      let head = 0;
      let tail = 0;
      for (let y = 0; y < dh + maxRadius; y++) {
        if (y < dh) {
          const val = temp[y * dw + x];
          while (tail > head && temp[deque[tail - 1] * dw + x] <= val) tail--;
          deque[tail++] = y;
        }
        const outY = y - maxRadius;
        if (outY >= 0) {
          while (head < tail && deque[head] < outY - maxRadius) head++;
          out[outY * dw + x] = temp[deque[head] * dw + x];
        }
      }
    }
    return out;
  };

  const boxBlurChannel = (ch: Float32Array) => {
    const temp = new Float32Array(dw * dh);
    const out = new Float32Array(dw * dh);

    for (let y = 0; y < dh; y++) {
      const row = y * dw;
      let sum = 0;
      let count = 0;
      for (let x = 0; x < Math.min(dw, blurRadius); x++) {
        sum += ch[row + x];
        count++;
      }
      for (let x = 0; x < dw; x++) {
        if (x + blurRadius < dw) {
          sum += ch[row + x + blurRadius];
          count++;
        }
        if (x - blurRadius - 1 >= 0) {
          sum -= ch[row + x - blurRadius - 1];
          count--;
        }
        temp[row + x] = sum / count;
      }
    }

    for (let x = 0; x < dw; x++) {
      let sum = 0;
      let count = 0;
      for (let y = 0; y < Math.min(dh, blurRadius); y++) {
        sum += temp[y * dw + x];
        count++;
      }
      for (let y = 0; y < dh; y++) {
        if (y + blurRadius < dh) {
          sum += temp[(y + blurRadius) * dw + x];
          count++;
        }
        if (y - blurRadius - 1 >= 0) {
          sum -= temp[(y - blurRadius - 1) * dw + x];
          count--;
        }
        out[y * dw + x] = sum / count;
      }
    }
    return out;
  };

  return {
    bgR: boxBlurChannel(dilateChannel(rArr)),
    bgG: boxBlurChannel(dilateChannel(gArr)),
    bgB: boxBlurChannel(dilateChannel(bArr)),
    dw,
    dh,
  };
}

/**
 * Applies deterministic CamScanner-grade enhancement filters + adjustments to a rectified canvas.
 */
export function applyDocumentEnhancement(
  rectifiedCanvas: HTMLCanvasElement,
  filter: FilterMode,
  adjustments: ScanAdjustments
): HTMLCanvasElement {
  const w = rectifiedCanvas.width;
  const h = rectifiedCanvas.height;

  const outCanvas = document.createElement('canvas');
  outCanvas.width = w;
  outCanvas.height = h;

  const srcCtx = rectifiedCanvas.getContext('2d', { willReadFrequently: true });
  const outCtx = outCanvas.getContext('2d', { willReadFrequently: true });
  if (!srcCtx || !outCtx) return outCanvas;

  const imgData = srcCtx.getImageData(0, 0, w, h);
  const src = imgData.data;
  const result = new Uint8ClampedArray(src.length);

  if (filter === 'original') {
    result.set(src);
  } else {
    const { bgR, bgG, bgB, dw, dh } = estimatePaperIllumination(src, w, h);
    const scaleX = (dw - 1) / Math.max(1, w - 1);
    const scaleY = (dh - 1) / Math.max(1, h - 1);

    for (let y = 0; y < h; y++) {
      const fy = y * scaleY;
      const y0 = fy | 0;
      const y1 = y0 < dh - 1 ? y0 + 1 : dh - 1;
      const wy = fy - y0;
      const iwy = 1 - wy;

      for (let x = 0; x < w; x++) {
        const fx = x * scaleX;
        const x0 = fx | 0;
        const x1 = x0 < dw - 1 ? x0 + 1 : dw - 1;
        const wx = fx - x0;
        const iwx = 1 - wx;

        const w00 = iwx * iwy;
        const w10 = wx * iwy;
        const w01 = iwx * wy;
        const w11 = wx * wy;

        const i00 = y0 * dw + x0;
        const i10 = y0 * dw + x1;
        const i01 = y1 * dw + x0;
        const i11 = y1 * dw + x1;

        const estR = Math.max(35, bgR[i00] * w00 + bgR[i10] * w10 + bgR[i01] * w01 + bgR[i11] * w11);
        const estG = Math.max(35, bgG[i00] * w00 + bgG[i10] * w10 + bgG[i01] * w01 + bgG[i11] * w11);
        const estB = Math.max(35, bgB[i00] * w00 + bgB[i10] * w10 + bgB[i01] * w01 + bgB[i11] * w11);

        const idx = (y * w + x) * 4;
        const r = src[idx];
        const g = src[idx + 1];
        const b = src[idx + 2];

        // Normalized pixel relative to local paper illumination
        let nr = (r / estR) * 255;
        let ng = (g / estG) * 255;
        let nb = (b / estB) * 255;

        if (filter === 'magic') {
          // Gentle white snap for near-paper values + slight contrast & saturation boost
          nr = nr > 224 ? 255 : Math.max(0, (nr - 12) * 1.07);
          ng = ng > 224 ? 255 : Math.max(0, (ng - 12) * 1.07);
          nb = nb > 224 ? 255 : Math.max(0, (nb - 12) * 1.07);

          const lum = 0.299 * nr + 0.587 * ng + 0.114 * nb;
          const satBoost = 1.18;
          nr = lum + (nr - lum) * satBoost;
          ng = lum + (ng - lum) * satBoost;
          nb = lum + (nb - lum) * satBoost;
        } else if (filter === 'clear') {
          // Softer shadow removal preserving natural tones of photos & stamps
          nr = nr * 0.78 + r * 0.22;
          ng = ng * 0.78 + g * 0.22;
          nb = nb * 0.78 + b * 0.22;
          if (nr > 235 && ng > 235 && nb > 235) {
            nr = 255;
            ng = 255;
            nb = 255;
          }
        } else if (filter === 'grayscale') {
          const lum = 0.299 * nr + 0.587 * ng + 0.114 * nb;
          const stretched = lum > 226 ? 255 : Math.max(0, (lum - 14) * 1.1);
          nr = stretched;
          ng = stretched;
          nb = stretched;
        } else if (filter === 'bw') {
          // Crisp adaptive photocopy B&W with anti-aliased ink edges
          const lum = 0.299 * nr + 0.587 * ng + 0.114 * nb;
          const low = 138;
          const high = 198;
          let bwVal: number;
          if (lum <= low) {
            bwVal = 0;
          } else if (lum >= high) {
            bwVal = 255;
          } else {
            const t = (lum - low) / (high - low);
            bwVal = t * t * (3 - 2 * t) * 255;
          }
          nr = bwVal;
          ng = bwVal;
          nb = bwVal;
        }

        result[idx] = clampByte(nr);
        result[idx + 1] = clampByte(ng);
        result[idx + 2] = clampByte(nb);
        result[idx + 3] = 255;
      }
    }
  }

  // Apply manual brightness & contrast
  const bOffset = adjustments.brightness * 1.6;
  const cFactor = (259 * (adjustments.contrast * 2.2 + 255)) / (255 * (259 - adjustments.contrast * 2.2));
  if (adjustments.brightness !== 0 || adjustments.contrast !== 0) {
    for (let i = 0; i < result.length; i += 4) {
      result[i] = clampByte(cFactor * (result[i] + bOffset - 128) + 128);
      result[i + 1] = clampByte(cFactor * (result[i + 1] + bOffset - 128) + 128);
      result[i + 2] = clampByte(cFactor * (result[i + 2] + bOffset - 128) + 128);
    }
  }

  // Apply unsharp mask sharpening for crisp text legibility
  const sharpAmount = (adjustments.sharpness / 100) * 0.85;
  if (sharpAmount > 0.02 && w > 4 && h > 4) {
    const copy = new Uint8ClampedArray(result);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = (y * w + x) * 4;
        const up = idx - w * 4;
        const down = idx + w * 4;
        const left = idx - 4;
        const right = idx + 4;

        for (let c = 0; c < 3; c++) {
          const center = copy[idx + c];
          const avg =
            (copy[up + c] + copy[down + c] + copy[left + c] + copy[right + c]) * 0.25;
          result[idx + c] = clampByte(center + (center - avg) * sharpAmount * 2.2);
        }
      }
    }
  }

  const finalData = new ImageData(result, w, h);
  outCtx.putImageData(finalData, 0, 0);
  return outCanvas;
}

/**
 * Full pipeline: loads original image, rotates, rectifies perspective, and applies filter.
 */
export async function processScannedPage(
  originalDataUrl: string,
  rotation: number,
  corners: QuadCorners,
  filter: FilterMode,
  adjustments: ScanAdjustments,
  maxEdge = 1900
): Promise<{ dataUrl: string; width: number; height: number }> {
  const img = await loadImage(originalDataUrl);
  const rotated = createRotatedCanvas(img, rotation, 2600);
  const warped = warpPerspectiveCanvas(rotated, corners, maxEdge);
  const enhanced = applyDocumentEnhancement(warped, filter, adjustments);

  return {
    dataUrl: enhanced.toDataURL('image/jpeg', 0.92),
    width: enhanced.width,
    height: enhanced.height,
  };
}

/**
 * Generates a realistic skewed & shadowed Spanish document photo on a desk
 * so desktop users without a camera can immediately test cropping, shadow removal, and PDF export.
 */
export function generateSampleDocumentPhoto(): string {
  const w = 1200;
  const h = 1500;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Warm dark wooden desk background
  const deskGrad = ctx.createLinearGradient(0, 0, w, h);
  deskGrad.addColorStop(0, '#3a2e25');
  deskGrad.addColorStop(0.5, '#4b3b2f');
  deskGrad.addColorStop(1, '#2b221b');
  ctx.fillStyle = deskGrad;
  ctx.fillRect(0, 0, w, h);

  // Subtle wood grain lines
  ctx.strokeStyle = 'rgba(20, 14, 10, 0.16)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 45; i++) {
    ctx.beginPath();
    const y = (i / 45) * h;
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(w * 0.3, y + 18, w * 0.7, y - 16, w, y + 8);
    ctx.stroke();
  }

  // Draw offscreen crisp paper sheet first
  const sheetW = 840;
  const sheetH = 1140;
  const sheet = document.createElement('canvas');
  sheet.width = sheetW;
  sheet.height = sheetH;
  const sCtx = sheet.getContext('2d')!;

  sCtx.fillStyle = '#f3efe6';
  sCtx.fillRect(0, 0, sheetW, sheetH);

  // Header bar
  sCtx.fillStyle = '#0f766e';
  sCtx.fillRect(60, 64, 12, 68);
  sCtx.fillStyle = '#1e293b';
  sCtx.font = 'bold 34px sans-serif';
  sCtx.fillText('COMPROBANTE DE SERVICIO', 90, 98);
  sCtx.fillStyle = '#64748b';
  sCtx.font = '18px sans-serif';
  sCtx.fillText('N.º de Referencia: FS-2026-0849  ·  Fecha: 25/11/2026', 90, 128);

  sCtx.strokeStyle = '#cbd5e1';
  sCtx.lineWidth = 2;
  sCtx.beginPath();
  sCtx.moveTo(60, 165);
  sCtx.lineTo(sheetW - 60, 165);
  sCtx.stroke();

  // Details block
  sCtx.fillStyle = '#334155';
  sCtx.font = 'bold 20px sans-serif';
  sCtx.fillText('TITULAR DEL DOCUMENTO', 60, 220);
  sCtx.font = '20px sans-serif';
  sCtx.fillStyle = '#1e293b';
  sCtx.fillText('Nombre: Laura Mendoza Ríos', 60, 256);
  sCtx.fillText('Documento ID: 1094837261', 60, 290);
  sCtx.fillText('Dirección: Calle 42 # 18-35, Oficina 402', 60, 324);

  // Table
  sCtx.fillStyle = '#e2e8f0';
  sCtx.fillRect(60, 385, sheetW - 120, 48);
  sCtx.fillStyle = '#0f172a';
  sCtx.font = 'bold 19px sans-serif';
  sCtx.fillText('Concepto', 80, 416);
  sCtx.fillText('Cantidad', 470, 416);
  sCtx.fillText('Importe', 650, 416);

  const rows = [
    ['Certificación documental notarial', '1', '$ 145.000'],
    ['Revisión técnica de expediente', '2', '$ 210.000'],
    ['Copias autenticadas y folio', '4', '$ 64.000'],
    ['Gestión de archivo digital', '1', '$ 35.000'],
  ];

  rows.forEach(([label, qty, price], idx) => {
    const ry = 478 + idx * 60;
    sCtx.fillStyle = '#1e293b';
    sCtx.font = '20px sans-serif';
    sCtx.fillText(label, 80, ry);
    sCtx.fillText(qty, 500, ry);
    sCtx.fillText(price, 650, ry);
    sCtx.strokeStyle = '#e2e8f0';
    sCtx.beginPath();
    sCtx.moveTo(60, ry + 20);
    sCtx.lineTo(sheetW - 60, ry + 20);
    sCtx.stroke();
  });

  // Total box
  sCtx.fillStyle = '#0f766e';
  sCtx.font = 'bold 26px sans-serif';
  sCtx.fillText('TOTAL PAGADO:  $ 454.000', 410, 770);

  // Stamp & Signature
  sCtx.strokeStyle = '#1d4ed8';
  sCtx.lineWidth = 4;
  sCtx.beginPath();
  sCtx.arc(210, 930, 74, 0, Math.PI * 2);
  sCtx.stroke();
  sCtx.fillStyle = '#1d4ed8';
  sCtx.font = 'bold 17px sans-serif';
  sCtx.fillText('VERIFICADO', 156, 926);
  sCtx.font = '14px sans-serif';
  sCtx.fillText('25 NOV 2026', 165, 950);

  sCtx.strokeStyle = '#0f172a';
  sCtx.lineWidth = 3;
  sCtx.beginPath();
  sCtx.moveTo(470, 945);
  sCtx.bezierCurveTo(520, 890, 560, 975, 610, 915);
  sCtx.bezierCurveTo(645, 880, 680, 955, 730, 935);
  sCtx.stroke();
  sCtx.fillStyle = '#475569';
  sCtx.font = '16px sans-serif';
  sCtx.fillText('Firma autorizada', 530, 985);

  // Warp sheet onto desk with perspective skew (simulating hand-held camera photo)
  const dstQuad: QuadCorners = [
    { x: 185, y: 155 },
    { x: 985, y: 110 },
    { x: 1090, y: 1320 },
    { x: 120, y: 1265 },
  ];

  // Drop shadow behind paper
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.moveTo(dstQuad[0].x + 14, dstQuad[0].y + 18);
  ctx.lineTo(dstQuad[1].x + 14, dstQuad[1].y + 18);
  ctx.lineTo(dstQuad[2].x + 14, dstQuad[2].y + 18);
  ctx.lineTo(dstQuad[3].x + 14, dstQuad[3].y + 18);
  ctx.closePath();
  ctx.fill();

  // Forward-inverse warp sheet onto desk
  const H = computeHomography(dstQuad, [
    { x: 0, y: 0 },
    { x: sheetW - 1, y: 0 },
    { x: sheetW - 1, y: sheetH - 1 },
    { x: 0, y: sheetH - 1 },
  ]);

  const sheetData = sCtx.getImageData(0, 0, sheetW, sheetH).data;
  const deskImg = ctx.getImageData(0, 0, w, h);
  const deskData = deskImg.data;

  for (let y = 90; y < 1340; y++) {
    for (let x = 100; x < 1110; x++) {
      const denom = H[6] * x + H[7] * y + H[8];
      const sx = (H[0] * x + H[1] * y + H[2]) / denom;
      const sy = (H[3] * x + H[4] * y + H[5]) / denom;
      if (sx >= 0 && sx < sheetW - 1 && sy >= 0 && sy < sheetH - 1) {
        const x0 = sx | 0;
        const y0 = sy | 0;
        const sIdx = (y0 * sheetW + x0) * 4;
        const dIdx = (y * w + x) * 4;

        // Add diagonal shadow across top-right & bottom-left to showcase filter shadow removal
        const shadowFactor =
          0.74 + 0.24 * Math.sin((x / w) * Math.PI) * Math.cos(((y - h * 0.3) / h) * 1.4);

        deskData[dIdx] = clampByte(sheetData[sIdx] * shadowFactor);
        deskData[dIdx + 1] = clampByte(sheetData[sIdx + 1] * (shadowFactor * 0.99));
        deskData[dIdx + 2] = clampByte(sheetData[sIdx + 2] * (shadowFactor * 0.96));
        deskData[dIdx + 3] = 255;
      }
    }
  }
  ctx.putImageData(deskImg, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.9);
}
