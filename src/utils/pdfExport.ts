import { jsPDF } from 'jspdf';
import { PdfSettings, ScanDocument } from '../types/scanner';
import { loadImage } from './imageProcessing';

export interface GeneratedPdfResult {
  blob: Blob;
  file: File;
  filename: string;
  sizeBytes: number;
  pageCount: number;
}

function sanitizeFilename(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '_');
  return cleaned || 'Documento_Escaneado';
}

/**
 * Scales/compresses a processed page image according to PDF quality settings
 * without changing any text or content.
 */
async function preparePageImageForPdf(
  dataUrl: string,
  quality: 'high' | 'standard'
): Promise<{ dataUrl: string; width: number; height: number }> {
  const img = await loadImage(dataUrl);
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;

  const maxEdge = quality === 'high' ? 2200 : 1400;
  const jpegQuality = quality === 'high' ? 0.94 : 0.78;
  const scale = Math.min(1, maxEdge / Math.max(srcW, srcH));
  const targetW = Math.max(1, Math.round(srcW * scale));
  const targetH = Math.max(1, Math.round(srcH * scale));

  if (scale >= 0.999 && quality === 'high') {
    return { dataUrl, width: srcW, height: srcH };
  }

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { dataUrl, width: srcW, height: srcH };

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, targetW, targetH);
  ctx.drawImage(img, 0, 0, targetW, targetH);

  return {
    dataUrl: canvas.toDataURL('image/jpeg', jpegQuality),
    width: targetW,
    height: targetH,
  };
}

/**
 * Builds a multi-page PDF document in memory from all scanned pages.
 */
export async function buildDocumentPdf(
  doc: ScanDocument,
  overrideSettings?: PdfSettings
): Promise<GeneratedPdfResult> {
  if (doc.pages.length === 0) {
    throw new Error('El documento no tiene páginas para exportar.');
  }

  const settings = overrideSettings ?? doc.pdfSettings;
  const filename = `${sanitizeFilename(doc.title)}.pdf`;

  let pdf: jsPDF | null = null;

  for (let i = 0; i < doc.pages.length; i++) {
    const page = doc.pages[i];
    const prepared = await preparePageImageForPdf(page.processedDataUrl, settings.quality);
    const isLandscape = prepared.width > prepared.height;
    const orientation: 'portrait' | 'landscape' = isLandscape ? 'landscape' : 'portrait';

    let format: string | [number, number];
    if (settings.pageSize === 'a4') {
      format = 'a4';
    } else if (settings.pageSize === 'letter') {
      format = 'letter';
    } else {
      // Auto fit to image proportion in mm (at ~150 DPI base)
      const mmPerPx = 25.4 / 150;
      format = [
        Math.max(40, prepared.width * mmPerPx),
        Math.max(40, prepared.height * mmPerPx),
      ];
    }

    if (i === 0) {
      pdf = new jsPDF({
        orientation,
        unit: 'mm',
        format,
        compress: true,
      });
    } else if (pdf) {
      pdf.addPage(format, orientation);
    }

    if (!pdf) continue;

    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = settings.pageSize === 'auto' ? 0 : Math.max(0, settings.marginMm);

    const availW = Math.max(10, pageW - margin * 2);
    const availH = Math.max(10, pageH - margin * 2);
    const imgRatio = prepared.width / prepared.height;
    const boxRatio = availW / availH;

    let drawW = availW;
    let drawH = availH;
    if (imgRatio > boxRatio) {
      drawH = availW / imgRatio;
    } else {
      drawW = availH * imgRatio;
    }

    const offsetX = (pageW - drawW) / 2;
    const offsetY = (pageH - drawH) / 2;

    pdf.addImage(prepared.dataUrl, 'JPEG', offsetX, offsetY, drawW, drawH, undefined, 'FAST');
  }

  if (!pdf) {
    throw new Error('No se pudo inicializar el archivo PDF.');
  }

  const blob = pdf.output('blob');
  const file = new File([blob], filename, { type: 'application/pdf' });

  return {
    blob,
    file,
    filename,
    sizeBytes: blob.size,
    pageCount: doc.pages.length,
  };
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function canShareFilesNatively(): boolean {
  if (typeof navigator === 'undefined' || !navigator.share || !navigator.canShare) {
    return false;
  }
  try {
    const dummy = new File(['test'], 'test.pdf', { type: 'application/pdf' });
    return navigator.canShare({ files: [dummy] });
  } catch {
    return false;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}
