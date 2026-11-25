import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  Maximize2,
  RotateCcw,
  RotateCw,
  ScanLine,
  X,
} from 'lucide-react';
import { QuadCorners } from '../types/scanner';
import {
  autoDetectDocumentCorners,
  createRotatedCanvas,
  fullPageCorners,
  loadImage,
  rotateCornersClockwise,
  rotateCornersCounterClockwise,
} from '../utils/imageProcessing';

interface CornerCropperProps {
  originalDataUrl: string;
  initialRotation: number;
  initialCorners?: QuadCorners;
  pageLabel?: string;
  onCancel: () => void;
  onConfirm: (rotation: number, corners: QuadCorners) => void;
}

type DragTarget =
  | { kind: 'corner'; index: number }
  | { kind: 'edge'; edgeIndex: number; lastNorm: { x: number; y: number } };

export const CornerCropper: React.FC<CornerCropperProps> = ({
  originalDataUrl,
  initialRotation,
  initialCorners,
  pageLabel,
  onCancel,
  onConfirm,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const displayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const loupeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const orientedCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [rotation, setRotation] = useState(initialRotation);
  const [corners, setCorners] = useState<QuadCorners>(
    initialCorners ?? [
      { x: 0.08, y: 0.08 },
      { x: 0.92, y: 0.08 },
      { x: 0.92, y: 0.92 },
      { x: 0.08, y: 0.92 },
    ]
  );
  const [canvasRect, setCanvasRect] = useState<{
    width: number;
    height: number;
    left: number;
    top: number;
  }>({ width: 0, height: 0, left: 0, top: 0 });
  const [dragTarget, setDragTarget] = useState<DragTarget | null>(null);
  const [activePoint, setActivePoint] = useState<{ x: number; y: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const hasAutoDetectedRef = useRef(Boolean(initialCorners));

  // Render rotated image to offscreen orientedCanvas and visible displayCanvas
  const renderImage = useCallback(async () => {
    setLoading(true);
    try {
      const img = await loadImage(originalDataUrl);
      const oriented = createRotatedCanvas(img, rotation, 1800);
      orientedCanvasRef.current = oriented;

      if (!hasAutoDetectedRef.current) {
        hasAutoDetectedRef.current = true;
        const detected = autoDetectDocumentCorners(oriented);
        setCorners(detected);
      }

      const display = displayCanvasRef.current;
      if (display) {
        display.width = oriented.width;
        display.height = oriented.height;
        const dCtx = display.getContext('2d');
        if (dCtx) {
          dCtx.drawImage(oriented, 0, 0);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [originalDataUrl, rotation]);

  useEffect(() => {
    renderImage();
  }, [renderImage]);

  // Measure rendered canvas bounding box inside container
  const syncCanvasRect = useCallback(() => {
    const canvas = displayCanvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const cRect = container.getBoundingClientRect();
    const dRect = canvas.getBoundingClientRect();
    setCanvasRect({
      width: dRect.width,
      height: dRect.height,
      left: dRect.left - cRect.left,
      top: dRect.top - cRect.top,
    });
  }, []);

  useEffect(() => {
    syncCanvasRect();
    const obs = new ResizeObserver(syncCanvasRect);
    if (containerRef.current) obs.observe(containerRef.current);
    if (displayCanvasRef.current) obs.observe(displayCanvasRef.current);
    window.addEventListener('resize', syncCanvasRect);
    return () => {
      obs.disconnect();
      window.removeEventListener('resize', syncCanvasRect);
    };
  }, [syncCanvasRect, loading]);

  // Draw magnifying loupe when dragging a corner
  useEffect(() => {
    if (!activePoint || !loupeCanvasRef.current || !orientedCanvasRef.current) return;
    const loupe = loupeCanvasRef.current;
    const src = orientedCanvasRef.current;
    const ctx = loupe.getContext('2d');
    if (!ctx) return;

    const size = loupe.width;
    const zoom = 2.4;
    const srcSize = size / zoom;
    const sx = activePoint.x * src.width - srcSize / 2;
    const sy = activePoint.y * src.height - srcSize / 2;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(src, sx, sy, srcSize, srcSize, 0, 0, size, size);

    // Precision crosshair
    ctx.strokeStyle = 'rgba(20, 184, 166, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(size / 2, 0);
    ctx.lineTo(size / 2, size);
    ctx.moveTo(0, size / 2);
    ctx.lineTo(size, size / 2);
    ctx.stroke();

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, 5, 0, Math.PI * 2);
    ctx.stroke();
  }, [activePoint]);

  const clientToNormalized = (clientX: number, clientY: number) => {
    const canvas = displayCanvasRef.current;
    if (!canvas) return { x: 0.5, y: 0.5 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width))),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / Math.max(1, rect.height))),
    };
  };

  const handleCornerPointerDown = (index: number, e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragTarget({ kind: 'corner', index });
    setActivePoint(corners[index]);
  };

  const handleEdgePointerDown = (edgeIndex: number, e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const norm = clientToNormalized(e.clientX, e.clientY);
    setDragTarget({ kind: 'edge', edgeIndex, lastNorm: norm });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragTarget) return;
    const norm = clientToNormalized(e.clientX, e.clientY);

    if (dragTarget.kind === 'corner') {
      setCorners((prev) => {
        const next = [...prev] as QuadCorners;
        next[dragTarget.index] = norm;
        return next;
      });
      setActivePoint(norm);
    } else {
      const dx = norm.x - dragTarget.lastNorm.x;
      const dy = norm.y - dragTarget.lastNorm.y;
      const i1 = dragTarget.edgeIndex;
      const i2 = (dragTarget.edgeIndex + 1) % 4;
      setCorners((prev) => {
        const next = [...prev] as QuadCorners;
        next[i1] = {
          x: Math.max(0, Math.min(1, next[i1].x + dx)),
          y: Math.max(0, Math.min(1, next[i1].y + dy)),
        };
        next[i2] = {
          x: Math.max(0, Math.min(1, next[i2].x + dx)),
          y: Math.max(0, Math.min(1, next[i2].y + dy)),
        };
        return next;
      });
      setDragTarget({ ...dragTarget, lastNorm: norm });
    }
  };

  const handlePointerUp = () => {
    setDragTarget(null);
    setActivePoint(null);
  };

  const handleAutoDetect = () => {
    if (!orientedCanvasRef.current) return;
    setCorners(autoDetectDocumentCorners(orientedCanvasRef.current));
  };

  const handleRotateLeft = () => {
    setRotation((r) => (r + 270) % 360);
    setCorners((c) => rotateCornersCounterClockwise(c));
  };

  const handleRotateRight = () => {
    setRotation((r) => (r + 90) % 360);
    setCorners((c) => rotateCornersClockwise(c));
  };

  // Polygon points in display pixel space
  const polyPoints = corners
    .map((c) => `${c.x * canvasRect.width},${c.y * canvasRect.height}`)
    .join(' ');

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-[#111418] text-white select-none"
      role="dialog"
      aria-modal="true"
      aria-label="Ajustar encuadre del documento"
    >
      {/* Top Bar */}
      <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-white/10 bg-[#161A20]">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-[44px] inline-flex items-center gap-2 px-3 rounded-lg text-sm font-medium text-slate-200 hover:bg-white/10 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
          <span>Cancelar</span>
        </button>

        <div className="text-center min-w-0">
          <h2 className="text-sm sm:text-base font-semibold text-white truncate">
            Ajustar encuadre {pageLabel ? `· ${pageLabel}` : ''}
          </h2>
          <p className="text-xs text-slate-400 hidden sm:block">
            Arrastra las 4 esquinas para enderezar la perspectiva del documento
          </p>
        </div>

        <button
          type="button"
          onClick={() => onConfirm(rotation, corners)}
          disabled={loading}
          className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          <Check className="w-4 h-4" />
          <span>Escanear</span>
        </button>
      </div>

      {/* Main Cropper Workspace */}
      <div
        ref={containerRef}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="relative flex-1 flex items-center justify-center p-4 sm:p-8 overflow-hidden studio-grid-bg touch-none"
      >
        <canvas
          ref={displayCanvasRef}
          className="max-w-full max-h-full object-contain rounded shadow-2xl"
        />

        {/* SVG Dark Mask + Quad Border + Handles */}
        {canvasRect.width > 0 && canvasRect.height > 0 && (
          <div
            className="absolute pointer-events-none"
            style={{
              left: canvasRect.left,
              top: canvasRect.top,
              width: canvasRect.width,
              height: canvasRect.height,
            }}
          >
            <svg
              width={canvasRect.width}
              height={canvasRect.height}
              className="overflow-visible"
            >
              <defs>
                <mask id="doc-crop-mask">
                  <rect width={canvasRect.width} height={canvasRect.height} fill="white" />
                  <polygon points={polyPoints} fill="black" />
                </mask>
              </defs>
              <rect
                width={canvasRect.width}
                height={canvasRect.height}
                fill="rgba(0, 0, 0, 0.56)"
                mask="url(#doc-crop-mask)"
              />
              <polygon
                points={polyPoints}
                fill="none"
                stroke="#14B8A6"
                strokeWidth="2.5"
                strokeLinejoin="round"
              />
            </svg>

            {/* Edge midpoint drag handles */}
            {[0, 1, 2, 3].map((edgeIdx) => {
              const p1 = corners[edgeIdx];
              const p2 = corners[(edgeIdx + 1) % 4];
              const mx = ((p1.x + p2.x) / 2) * canvasRect.width;
              const my = ((p1.y + p2.y) / 2) * canvasRect.height;
              const angle =
                (Math.atan2(
                  (p2.y - p1.y) * canvasRect.height,
                  (p2.x - p1.x) * canvasRect.width
                ) *
                  180) /
                Math.PI;

              return (
                <div
                  key={`edge-${edgeIdx}`}
                  onPointerDown={(e) => handleEdgePointerDown(edgeIdx, e)}
                  style={{
                    left: mx,
                    top: my,
                    transform: `translate(-50%, -50%) rotate(${angle}deg)`,
                  }}
                  className="pointer-events-auto absolute w-11 h-11 flex items-center justify-center cursor-grab active:cursor-grabbing"
                >
                  <span className="w-6 h-2 rounded-full bg-teal-400 border border-slate-900 shadow" />
                </div>
              );
            })}

            {/* 4 Corner Handles (48x48 touch target) */}
            {corners.map((corner, idx) => {
              const cx = corner.x * canvasRect.width;
              const cy = corner.y * canvasRect.height;
              const isDragging =
                dragTarget?.kind === 'corner' && dragTarget.index === idx;

              return (
                <div
                  key={`corner-${idx}`}
                  onPointerDown={(e) => handleCornerPointerDown(idx, e)}
                  style={{
                    left: cx,
                    top: cy,
                    transform: 'translate(-50%, -50%)',
                  }}
                  className="pointer-events-auto absolute w-12 h-12 flex items-center justify-center cursor-grab active:cursor-grabbing"
                >
                  <span
                    className={`w-6 h-6 rounded-full border-2 border-white shadow-md transition-transform ${
                      isDragging
                        ? 'scale-125 bg-teal-400'
                        : 'bg-teal-500 hover:scale-110'
                    }`}
                  />
                </div>
              );
            })}
          </div>
        )}

        {/* Magnifying Loupe while dragging a corner */}
        {activePoint && (
          <div
            className={`pointer-events-none absolute top-4 ${
              activePoint.x < 0.5 ? 'right-4' : 'left-4'
            } rounded-full border-2 border-teal-400 shadow-2xl overflow-hidden bg-slate-900`}
          >
            <canvas ref={loupeCanvasRef} width={116} height={116} className="block" />
          </div>
        )}
      </div>

      {/* Bottom Adjustment Toolbar */}
      <div className="px-4 py-3 bg-[#161A20] border-t border-white/10">
        <div className="max-w-2xl mx-auto flex items-center justify-center gap-2 sm:gap-4 overflow-x-auto">
          <button
            type="button"
            onClick={handleAutoDetect}
            className="min-h-[44px] inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-medium text-slate-200 hover:bg-white/10 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <ScanLine className="w-4 h-4 text-teal-400" />
            <span>Auto-encuadre</span>
          </button>

          <button
            type="button"
            onClick={() => setCorners(fullPageCorners())}
            className="min-h-[44px] inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-medium text-slate-200 hover:bg-white/10 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Maximize2 className="w-4 h-4 text-slate-300" />
            <span>Todo completo</span>
          </button>

          <button
            type="button"
            onClick={handleRotateLeft}
            className="min-h-[44px] inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-medium text-slate-200 hover:bg-white/10 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <RotateCcw className="w-4 h-4 text-slate-300" />
            <span>90° Izq</span>
          </button>

          <button
            type="button"
            onClick={handleRotateRight}
            className="min-h-[44px] inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-medium text-slate-200 hover:bg-white/10 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <RotateCw className="w-4 h-4 text-slate-300" />
            <span>90° Der</span>
          </button>
        </div>
      </div>
    </div>
  );
};
