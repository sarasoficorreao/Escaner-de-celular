/**
 * Client-side Automatic Document Restoration & Super-Resolution Engine.
 * Runs 100% locally in the browser (free, zero API keys, preserves 100% of original data).
 */

export interface DocumentAnalysis {
  blurVariance: number;
  isBlurry: boolean;
  noiseEstimate: number;
  isNoisy: boolean;
  needsUpscale: boolean;
  recommendedUpscaleFactor: number;
  summaryParts: string[];
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

/**
 * Analyzes a perspective-corrected canvas to measure blur, sensor noise, and resolution.
 */
export function analyzeDocumentQuality(
  canvas: HTMLCanvasElement,
  forceSuperRes = false
): DocumentAnalysis {
  const w = canvas.width;
  const h = canvas.height;
  const maxEdge = Math.max(w, h);

  const sampleScale = Math.min(1, 480 / maxEdge);
  const sw = Math.max(32, Math.round(w * sampleScale));
  const sh = Math.max(32, Math.round(h * sampleScale));

  const sCanvas = document.createElement('canvas');
  sCanvas.width = sw;
  sCanvas.height = sh;
  const sCtx = sCanvas.getContext('2d', { willReadFrequently: true });
  if (!sCtx) {
    return {
      blurVariance: 200,
      isBlurry: false,
      noiseEstimate: 5,
      isNoisy: false,
      needsUpscale: false,
      recommendedUpscaleFactor: 1,
      summaryParts: [],
    };
  }

  sCtx.drawImage(canvas, 0, 0, sw, sh);
  const data = sCtx.getImageData(0, 0, sw, sh).data;
  const lum = new Float32Array(sw * sh);

  for (let i = 0; i < sw * sh; i++) {
    const idx = i * 4;
    lum[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
  }

  // Laplacian variance for sharpness / blur detection
  let lapSum = 0;
  let lapSqSum = 0;
  let lapCount = 0;
  let noiseSum = 0;
  let noiseCount = 0;

  for (let y = 1; y < sh - 1; y++) {
    for (let x = 1; x < sw - 1; x++) {
      const i = y * sw + x;
      const center = lum[i];
      const lap =
        lum[i - sw] + lum[i + sw] + lum[i - 1] + lum[i + 1] - 4 * center;
      lapSum += lap;
      lapSqSum += lap * lap;
      lapCount++;

      // Estimate high-frequency noise strictly on smooth paper regions (low local gradient)
      const dx = Math.abs(lum[i + 1] - lum[i - 1]);
      const dy = Math.abs(lum[i + sw] - lum[i - sw]);
      if (dx < 10 && dy < 10) {
        noiseSum += Math.abs(lap);
        noiseCount++;
      }
    }
  }

  const meanLap = lapCount > 0 ? lapSum / lapCount : 0;
  const blurVariance =
    lapCount > 0 ? lapSqSum / lapCount - meanLap * meanLap : 200;
  const noiseEstimate = noiseCount > 20 ? noiseSum / noiseCount : 4;

  const isBlurry = blurVariance < 280;
  const isNoisy = noiseEstimate > 4.2;

  let recommendedUpscaleFactor = 1;
  if (forceSuperRes) {
    recommendedUpscaleFactor = maxEdge < 1300 ? 2 : maxEdge < 2100 ? 1.5 : 1;
  } else if (maxEdge < 1350) {
    recommendedUpscaleFactor = Math.min(2, 1900 / Math.max(1, maxEdge));
  }

  const needsUpscale = recommendedUpscaleFactor > 1.08;
  const summaryParts: string[] = [];
  if (needsUpscale) summaryParts.push('resolución aumentada');
  if (isNoisy) summaryParts.push('ruido limpiado');
  if (isBlurry) summaryParts.push('enfoque restaurado');
  summaryParts.push('claridad optimizada');

  return {
    blurVariance,
    isBlurry,
    noiseEstimate,
    isNoisy,
    needsUpscale,
    recommendedUpscaleFactor,
    summaryParts,
  };
}

function sinc(x: number): number {
  if (x === 0) return 1;
  const pix = Math.PI * x;
  return Math.sin(pix) / pix;
}

function lanczosKernel(x: number, a = 3): number {
  const ax = Math.abs(x);
  if (ax >= a) return 0;
  return sinc(x) * sinc(x / a);
}

/**
 * Separable 2-pass Lanczos-3 Super-Resolution upscaler for sharp document typography.
 */
export function lanczosUpscaleCanvas(
  source: HTMLCanvasElement,
  scaleFactor: number
): HTMLCanvasElement {
  if (scaleFactor <= 1.02) return source;

  const srcW = source.width;
  const srcH = source.height;
  const dstW = Math.min(2600, Math.round(srcW * scaleFactor));
  const dstH = Math.min(2600, Math.round(srcH * scaleFactor));

  const srcCtx = source.getContext('2d', { willReadFrequently: true });
  if (!srcCtx) return source;
  const srcData = srcCtx.getImageData(0, 0, srcW, srcH).data;

  const a = 3;
  // Pass 1: Horizontal resampling into Float32 buffer (dstW x srcH)
  const temp = new Float32Array(dstW * srcH * 3);
  const ratioX = srcW / dstW;

  for (let x = 0; x < dstW; x++) {
    const center = (x + 0.5) * ratioX - 0.5;
    const left = Math.max(0, Math.floor(center - a + 1));
    const right = Math.min(srcW - 1, Math.floor(center + a));

    const weights: number[] = [];
    let wSum = 0;
    for (let sx = left; sx <= right; sx++) {
      const k = lanczosKernel(center - sx, a);
      weights.push(k);
      wSum += k;
    }
    const invSum = wSum !== 0 ? 1 / wSum : 1;

    for (let y = 0; y < srcH; y++) {
      let r = 0,
        g = 0,
        b = 0;
      const srcRow = y * srcW * 4;
      for (let i = 0; i < weights.length; i++) {
        const sx = left + i;
        const w = weights[i] * invSum;
        const sIdx = srcRow + sx * 4;
        r += srcData[sIdx] * w;
        g += srcData[sIdx + 1] * w;
        b += srcData[sIdx + 2] * w;
      }
      const tIdx = (y * dstW + x) * 3;
      temp[tIdx] = r;
      temp[tIdx + 1] = g;
      temp[tIdx + 2] = b;
    }
  }

  // Pass 2: Vertical resampling into dstCanvas (dstW x dstH)
  const outCanvas = document.createElement('canvas');
  outCanvas.width = dstW;
  outCanvas.height = dstH;
  const outCtx = outCanvas.getContext('2d', { willReadFrequently: true });
  if (!outCtx) return source;

  const outImg = outCtx.createImageData(dstW, dstH);
  const dstData = outImg.data;
  const ratioY = srcH / dstH;

  for (let y = 0; y < dstH; y++) {
    const center = (y + 0.5) * ratioY - 0.5;
    const top = Math.max(0, Math.floor(center - a + 1));
    const bottom = Math.min(srcH - 1, Math.floor(center + a));

    const weights: number[] = [];
    let wSum = 0;
    for (let sy = top; sy <= bottom; sy++) {
      const k = lanczosKernel(center - sy, a);
      weights.push(k);
      wSum += k;
    }
    const invSum = wSum !== 0 ? 1 / wSum : 1;

    for (let x = 0; x < dstW; x++) {
      let r = 0,
        g = 0,
        b = 0;
      for (let i = 0; i < weights.length; i++) {
        const sy = top + i;
        const w = weights[i] * invSum;
        const tIdx = (sy * dstW + x) * 3;
        r += temp[tIdx] * w;
        g += temp[tIdx + 1] * w;
        b += temp[tIdx + 2] * w;
      }
      const dIdx = (y * dstW + x) * 4;
      dstData[dIdx] = clampByte(r);
      dstData[dIdx + 1] = clampByte(g);
      dstData[dIdx + 2] = clampByte(b);
      dstData[dIdx + 3] = 255;
    }
  }

  outCtx.putImageData(outImg, 0, 0);
  return outCanvas;
}

/**
 * Fast Edge-Preserving Bilateral Denoiser.
 * Smooths camera sensor noise on paper backgrounds while keeping text edges razor sharp.
 */
function applyBilateralDenoise(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  rangeSigma: number
): void {
  const src = new Uint8ClampedArray(data);
  const invTwoSigmaSq = 1 / (2 * rangeSigma * rangeSigma);

  // Precompute LUT for color difference weighting (0..765)
  const rangeLut = new Float32Array(768);
  for (let i = 0; i < 768; i++) {
    rangeLut[i] = Math.exp(-(i * i) * invTwoSigmaSq);
  }

  // 3x3 edge-preserving spatial pass (spatial sigma ~1.2)
  const spatialWeights = [0.6, 0.85, 0.6, 0.85, 1.0, 0.85, 0.6, 0.85, 0.6];

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const cIdx = (y * w + x) * 4;
      const cr = src[cIdx];
      const cg = src[cIdx + 1];
      const cb = src[cIdx + 2];

      let sumR = 0,
        sumG = 0,
        sumB = 0,
        sumW = 0;
      let k = 0;

      for (let dy = -1; dy <= 1; dy++) {
        const rowOffset = (y + dy) * w;
        for (let dx = -1; dx <= 1; dx++) {
          const nIdx = (rowOffset + x + dx) * 4;
          const nr = src[nIdx];
          const ng = src[nIdx + 1];
          const nb = src[nIdx + 2];

          const diff =
            (Math.abs(nr - cr) + Math.abs(ng - cg) + Math.abs(nb - cb)) | 0;
          const weight = spatialWeights[k++] * rangeLut[diff < 768 ? diff : 767];

          sumR += nr * weight;
          sumG += ng * weight;
          sumB += nb * weight;
          sumW += weight;
        }
      }

      if (sumW > 0) {
        const inv = 1 / sumW;
        data[cIdx] = clampByte(sumR * inv);
        data[cIdx + 1] = clampByte(sumG * inv);
        data[cIdx + 2] = clampByte(sumB * inv);
      }
    }
  }
}

/**
 * Halo-clamped Multi-Scale Edge Restoration (Deblurring + Residual Edge Boost).
 * Restores soft/blurry text strokes without introducing bright white overshoot halos.
 */
function applyAdaptiveClarityBoost(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  strength: number
): void {
  if (w < 6 || h < 6 || strength <= 0) return;
  const src = new Uint8ClampedArray(data);

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = (y * w + x) * 4;
      const up = idx - w * 4;
      const down = idx + w * 4;
      const left = idx - 4;
      const right = idx + 4;
      const ul = up - 4;
      const ur = up + 4;
      const dl = down - 4;
      const dr = down + 4;

      for (let c = 0; c < 3; c++) {
        const center = src[idx + c];
        const blur =
          (src[up + c] * 2 +
            src[down + c] * 2 +
            src[left + c] * 2 +
            src[right + c] * 2 +
            src[ul + c] +
            src[ur + c] +
            src[dl + c] +
            src[dr + c]) /
          12;

        const detail = center - blur;
        // Skip tiny flat-paper micro-noise (threshold = 3)
        if (Math.abs(detail) < 3) continue;

        const minLocal = Math.min(
          center,
          src[up + c],
          src[down + c],
          src[left + c],
          src[right + c]
        );
        const maxLocal = Math.max(
          center,
          src[up + c],
          src[down + c],
          src[left + c],
          src[right + c]
        );

        let sharpened = center + detail * strength;
        // Clamp overshoot within tight local range to eliminate white halos on black text
        const margin = 10;
        sharpened = Math.max(minLocal - margin, Math.min(maxLocal + margin, sharpened));
        data[idx + c] = clampByte(sharpened);
      }
    }
  }
}

/**
 * Runs the automatic restoration pipeline on a rectified document canvas:
 * 1. Quality analysis (resolution, sensor noise, blur)
 * 2. Lanczos-3 super-resolution if low-res or requested
 * 3. Edge-preserving bilateral denoise (when grainy)
 * 4. Adaptive halo-clamped deblurring / clarity boost
 */
export function runAutoQualityRestoration(
  rectifiedCanvas: HTMLCanvasElement,
  options: { autoEnhance: boolean; superResolution: boolean }
): { canvas: HTMLCanvasElement; analysis: DocumentAnalysis } {
  const analysis = analyzeDocumentQuality(rectifiedCanvas, options.superResolution);

  let working = rectifiedCanvas;
  if ((options.autoEnhance || options.superResolution) && analysis.needsUpscale) {
    working = lanczosUpscaleCanvas(rectifiedCanvas, analysis.recommendedUpscaleFactor);
  }

  if (!options.autoEnhance) {
    return { canvas: working, analysis };
  }

  const w = working.width;
  const h = working.height;
  const ctx = working.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { canvas: working, analysis };

  const imgData = ctx.getImageData(0, 0, w, h);

  if (analysis.isNoisy) {
    const rangeSigma = Math.min(48, Math.max(20, analysis.noiseEstimate * 4.5));
    applyBilateralDenoise(imgData.data, w, h, rangeSigma);
  }

  const clarityStrength = analysis.isBlurry ? 1.45 : 0.85;
  applyAdaptiveClarityBoost(imgData.data, w, h, clarityStrength);

  ctx.putImageData(imgData, 0, 0);
  return { canvas: working, analysis };
}
