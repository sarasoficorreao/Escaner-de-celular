export interface Point {
  /** Normalized coordinate in [0, 1] relative to the rotated/oriented source image */
  x: number;
  /** Normalized coordinate in [0, 1] relative to the rotated/oriented source image */
  y: number;
}

export type QuadCorners = [Point, Point, Point, Point]; // [topLeft, topRight, bottomRight, bottomLeft]

export type FilterMode = 'original' | 'magic' | 'clear' | 'bw' | 'grayscale';

export interface ScanAdjustments {
  brightness: number; // -50 to 50, default 0
  contrast: number; // -50 to 50, default 0
  sharpness: number; // 0 to 100, default 35
}

export interface ScannedPage {
  id: string;
  /** Original raw photo data URL (never modified, preserves 100% original data) */
  originalDataUrl: string;
  /** Natural width of original photo */
  originalWidth: number;
  /** Natural height of original photo */
  originalHeight: number;
  /** Clockwise rotation in degrees: 0 | 90 | 180 | 270 */
  rotation: number;
  /** Four corner points in normalized [0..1] coordinates of the rotated image */
  corners: QuadCorners;
  /** Selected enhancement filter */
  filter: FilterMode;
  /** Manual fine-tuning adjustments */
  adjustments: ScanAdjustments;
  /** Whether automatic clarity & restoration enhancement is active */
  autoEnhance?: boolean;
  /** Whether adaptive 2x super-resolution upscaling is active */
  superResolution?: boolean;
  /** Human-readable summary of automatic enhancements applied */
  autoEnhanceSummary?: string;
  /** High-resolution processed scan data URL (perspective-corrected + filtered) */
  processedDataUrl: string;
  /** Processed output dimensions */
  processedWidth: number;
  processedHeight: number;
  createdAt: number;
}

export type PdfPageSize = 'auto' | 'a4' | 'letter';
export type PdfQuality = 'high' | 'standard';

export interface PdfSettings {
  pageSize: PdfPageSize;
  quality: PdfQuality;
  marginMm: number;
}

export interface ScanDocument {
  id: string;
  title: string;
  pages: ScannedPage[];
  pdfSettings: PdfSettings;
  createdAt: number;
  updatedAt: number;
}

export interface FilterPresetInfo {
  id: FilterMode;
  label: string;
  description: string;
}

export const FILTER_PRESETS: FilterPresetInfo[] = [
  {
    id: 'magic',
    label: 'Color Mágico',
    description: 'Realza colores, elimina sombras y aclara el fondo del papel',
  },
  {
    id: 'clear',
    label: 'Documento Claro',
    description: 'Blanquea el papel manteniendo tonos naturales y firmas',
  },
  {
    id: 'bw',
    label: 'Blanco y Negro',
    description: 'Máximo contraste para texto nítido tipo fotocopia limpia',
  },
  {
    id: 'grayscale',
    label: 'Escala de Grises',
    description: 'Tonos monocromáticos equilibrados y sin sombras',
  },
  {
    id: 'original',
    label: 'Original',
    description: 'Solo encuadre corregido sin alterar colores ni brillo',
  },
];

export const DEFAULT_ADJUSTMENTS: ScanAdjustments = {
  brightness: 0,
  contrast: 0,
  sharpness: 30,
};

export const DEFAULT_PDF_SETTINGS: PdfSettings = {
  pageSize: 'a4',
  quality: 'high',
  marginMm: 6,
};
