import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Camera,
  Check,
  Crop,
  Download,
  Eye,
  FileDown,
  ImagePlus,
  Loader2,
  Mail,
  RotateCw,
  Send,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import {
  DEFAULT_ADJUSTMENTS,
  FILTER_PRESETS,
  FilterMode,
  PdfPageSize,
  PdfQuality,
  QuadCorners,
  ScanAdjustments,
  ScanDocument,
  ScannedPage,
} from '../types/scanner';
import {
  applyDocumentEnhancement,
  createRotatedCanvas,
  loadImage,
  processScannedPage,
  rotateCornersClockwise,
  warpPerspectiveCanvas,
} from '../utils/imageProcessing';
import {
  buildDocumentPdf,
  canShareFilesNatively,
  formatBytes,
  triggerBlobDownload,
} from '../utils/pdfExport';

interface DocumentEditorProps {
  document: ScanDocument;
  onUpdateDocument: (updated: ScanDocument) => void;
  onBack: () => void;
  onAddFromCamera: () => void;
  onAddFromFiles: (files: FileList) => void;
  onRequestRecrop: (pageId: string) => void;
}

export const DocumentEditor: React.FC<DocumentEditorProps> = ({
  document: doc,
  onUpdateDocument,
  onBack,
  onAddFromCamera,
  onAddFromFiles,
  onRequestRecrop,
}) => {
  const [selectedPageId, setSelectedPageId] = useState<string>(
    doc.pages[0]?.id ?? ''
  );
  const [isProcessing, setIsProcessing] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<'preview' | 'filters' | 'export'>('preview');
  const [filterThumbs, setFilterThumbs] = useState<Partial<Record<FilterMode, string>>>({});
  const [pdfBusy, setPdfBusy] = useState<'download' | 'share' | null>(null);
  const [statusNotice, setStatusNotice] = useState<{
    type: 'success' | 'info' | 'error';
    text: string;
  } | null>(null);
  const [showShareFallback, setShowShareFallback] = useState<{
    filename: string;
    sizeBytes: number;
    blob: Blob;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activePage =
    doc.pages.find((p) => p.id === selectedPageId) ?? doc.pages[0] ?? null;

  useEffect(() => {
    if (doc.pages.length > 0 && !doc.pages.some((p) => p.id === selectedPageId)) {
      setSelectedPageId(doc.pages[0].id);
    }
  }, [doc.pages, selectedPageId]);

  // Generate lightweight live thumbnails for each filter preset whenever the active page geometry changes
  useEffect(() => {
    let cancelled = false;
    if (!activePage) {
      setFilterThumbs({});
      return;
    }

    const generateThumbs = async () => {
      try {
        const img = await loadImage(activePage.originalDataUrl);
        const rotated = createRotatedCanvas(img, activePage.rotation, 600);
        const warped = warpPerspectiveCanvas(rotated, activePage.corners, 220);

        const nextThumbs: Partial<Record<FilterMode, string>> = {};
        for (const preset of FILTER_PRESETS) {
          if (cancelled) return;
          const out = applyDocumentEnhancement(warped, preset.id, DEFAULT_ADJUSTMENTS);
          nextThumbs[preset.id] = out.toDataURL('image/jpeg', 0.8);
        }
        if (!cancelled) {
          setFilterThumbs(nextThumbs);
        }
      } catch {
        // Ignore thumbnail generation error
      }
    };

    generateThumbs();
    return () => {
      cancelled = true;
    };
  }, [activePage?.id, activePage?.originalDataUrl, activePage?.rotation, activePage?.corners]);

  const showToast = (type: 'success' | 'info' | 'error', text: string) => {
    setStatusNotice({ type, text });
    setTimeout(() => {
      setStatusNotice((prev) => (prev?.text === text ? null : prev));
    }, 4500);
  };

  const reprocessAndSavePage = async (
    pageId: string,
    updates: {
      rotation?: number;
      corners?: QuadCorners;
      filter?: FilterMode;
      adjustments?: ScanAdjustments;
    }
  ) => {
    const target = doc.pages.find((p) => p.id === pageId);
    if (!target) return;

    const nextRotation = updates.rotation ?? target.rotation;
    const nextCorners = updates.corners ?? target.corners;
    const nextFilter = updates.filter ?? target.filter;
    const nextAdjustments = updates.adjustments ?? target.adjustments;

    setIsProcessing(true);
    try {
      const result = await processScannedPage(
        target.originalDataUrl,
        nextRotation,
        nextCorners,
        nextFilter,
        nextAdjustments
      );

      const updatedPages = doc.pages.map((p) =>
        p.id === pageId
          ? {
              ...p,
              rotation: nextRotation,
              corners: nextCorners,
              filter: nextFilter,
              adjustments: nextAdjustments,
              processedDataUrl: result.dataUrl,
              processedWidth: result.width,
              processedHeight: result.height,
            }
          : p
      );

      onUpdateDocument({
        ...doc,
        pages: updatedPages,
        updatedAt: Date.now(),
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleApplyFilterToAll = async () => {
    if (!activePage || doc.pages.length < 2) return;
    setIsProcessing(true);
    try {
      const updatedPages: ScannedPage[] = [];
      for (const page of doc.pages) {
        const res = await processScannedPage(
          page.originalDataUrl,
          page.rotation,
          page.corners,
          activePage.filter,
          activePage.adjustments
        );
        updatedPages.push({
          ...page,
          filter: activePage.filter,
          adjustments: { ...activePage.adjustments },
          processedDataUrl: res.dataUrl,
          processedWidth: res.width,
          processedHeight: res.height,
        });
      }
      onUpdateDocument({
        ...doc,
        pages: updatedPages,
        updatedAt: Date.now(),
      });
      showToast('success', 'Filtro aplicado a todas las páginas del documento.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRotateActive = () => {
    if (!activePage) return;
    const nextRot = (activePage.rotation + 90) % 360;
    const nextCorners = rotateCornersClockwise(activePage.corners);
    reprocessAndSavePage(activePage.id, {
      rotation: nextRot,
      corners: nextCorners,
    });
  };

  const handleMovePage = (index: number, direction: -1 | 1) => {
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= doc.pages.length) return;
    const next = [...doc.pages];
    [next[index], next[targetIdx]] = [next[targetIdx], next[index]];
    onUpdateDocument({
      ...doc,
      pages: next,
      updatedAt: Date.now(),
    });
  };

  const handleDeletePage = (pageId: string) => {
    const remaining = doc.pages.filter((p) => p.id !== pageId);
    onUpdateDocument({
      ...doc,
      pages: remaining,
      updatedAt: Date.now(),
    });
    if (remaining.length > 0 && selectedPageId === pageId) {
      setSelectedPageId(remaining[0].id);
    }
  };

  const handleDownloadPdf = async () => {
    if (doc.pages.length === 0) return;
    setPdfBusy('download');
    try {
      const result = await buildDocumentPdf(doc);
      triggerBlobDownload(result.blob, result.filename);
      showToast(
        'success',
        `PDF descargado (${result.pageCount} pág. · ${formatBytes(result.sizeBytes)})`
      );
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error al generar el PDF.');
    } finally {
      setPdfBusy(null);
    }
  };

  const handleSharePdfDirect = async () => {
    if (doc.pages.length === 0) return;
    setPdfBusy('share');
    try {
      const result = await buildDocumentPdf(doc);
      if (canShareFilesNatively()) {
        try {
          await navigator.share({
            files: [result.file],
            title: doc.title,
            text: `Documento escaneado: ${doc.title}`,
          });
          showToast('success', 'PDF enviado correctamente.');
          return;
        } catch (shareErr) {
          if (shareErr instanceof Error && shareErr.name === 'AbortError') {
            return;
          }
        }
      }
      // Browser doesn't support native file sharing (common on desktop Chrome/Linux)
      setShowShareFallback({
        filename: result.filename,
        sizeBytes: result.sizeBytes,
        blob: result.blob,
      });
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'No se pudo preparar el PDF.');
    } finally {
      setPdfBusy(null);
    }
  };

  const handleDownloadPageImage = () => {
    if (!activePage) return;
    const a = window.document.createElement('a');
    a.href = activePage.processedDataUrl;
    const pageIndex = doc.pages.findIndex((p) => p.id === activePage.id) + 1;
    a.download = `${doc.title.trim() || 'Escaneo'}_pag_${pageIndex}.jpg`;
    window.document.body.appendChild(a);
    a.click();
    window.document.body.removeChild(a);
    showToast('success', 'Imagen JPG guardada.');
  };

  const updatePdfSetting = (patch: Partial<{ pageSize: PdfPageSize; quality: PdfQuality }>) => {
    onUpdateDocument({
      ...doc,
      pdfSettings: {
        ...doc.pdfSettings,
        ...patch,
      },
      updatedAt: Date.now(),
    });
  };

  const activeIndex = doc.pages.findIndex((p) => p.id === activePage?.id);

  return (
    <div className="flex flex-col min-h-[calc(100vh-65px)] bg-[#F6F7F8]">
      {/* Studio Sub-header */}
      <div className="bg-white border-b border-slate-200 px-4 sm:px-6 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <button
              type="button"
              onClick={onBack}
              className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Documentos</span>
            </button>

            <span className="text-slate-300" aria-hidden="true">
              /
            </span>

            <input
              type="text"
              value={doc.title}
              onChange={(e) =>
                onUpdateDocument({
                  ...doc,
                  title: e.target.value,
                  updatedAt: Date.now(),
                })
              }
              aria-label="Nombre del documento"
              placeholder="Nombre del documento"
              className="min-w-0 flex-1 max-w-sm px-2.5 py-1.5 text-sm sm:text-base font-semibold text-slate-900 bg-transparent border border-transparent hover:border-slate-200 focus:border-teal-600 focus:bg-white rounded-lg outline-none transition-colors"
            />

            <span className="hidden md:inline text-xs text-slate-500 tabular-nums whitespace-nowrap">
              {doc.pages.length} {doc.pages.length === 1 ? 'página' : 'páginas'}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleSharePdfDirect}
              disabled={doc.pages.length === 0 || pdfBusy !== null}
              className="min-h-[40px] inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-sm font-medium transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
            >
              {pdfBusy === 'share' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4 text-teal-700" />
              )}
              <span>Enviar PDF</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={doc.pages.length === 0 || pdfBusy !== null}
              className="min-h-[40px] inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
            >
              {pdfBusy === 'download' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <FileDown className="w-4 h-4" />
              )}
              <span>Descargar PDF</span>
            </button>
          </div>
        </div>
      </div>

      {/* Status Toast */}
      {statusNotice && (
        <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 pt-3">
          <div
            className={`px-4 py-2.5 rounded-lg text-sm font-medium flex items-center justify-between border ${
              statusNotice.type === 'error'
                ? 'bg-red-50 text-red-800 border-red-200'
                : statusNotice.type === 'success'
                  ? 'bg-teal-50 text-teal-900 border-teal-200'
                  : 'bg-slate-100 text-slate-800 border-slate-200'
            }`}
          >
            <span>{statusNotice.text}</span>
            <button
              type="button"
              onClick={() => setStatusNotice(null)}
              className="text-xs underline ml-4 cursor-pointer"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      {/* Mobile Tab Switcher */}
      <div className="lg:hidden bg-white border-b border-slate-200 px-4 py-2">
        <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg">
          <button
            type="button"
            onClick={() => setMobilePanel('preview')}
            className={`min-h-[40px] text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              mobilePanel === 'preview'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600'
            }`}
          >
            Vista y Páginas
          </button>
          <button
            type="button"
            onClick={() => setMobilePanel('filters')}
            className={`min-h-[40px] text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              mobilePanel === 'filters'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600'
            }`}
          >
            Filtros y Mejora
          </button>
          <button
            type="button"
            onClick={() => setMobilePanel('export')}
            className={`min-h-[40px] text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              mobilePanel === 'export'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600'
            }`}
          >
            Ajustes PDF
          </button>
        </div>
      </div>

      {/* Main 3-Column Studio Grid */}
      <div className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-5 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Column 1: Pages Filmstrip */}
        <aside
          className={`lg:col-span-3 bg-white border border-slate-200 rounded-xl p-4 ${
            mobilePanel === 'preview' ? 'block' : 'hidden lg:block'
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-900">
              Páginas ({doc.pages.length})
            </h3>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onAddFromCamera}
                title="Añadir página con cámara"
                className="min-h-[36px] inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-800 text-xs font-semibold transition-colors cursor-pointer"
              >
                <Camera className="w-3.5 h-3.5" />
                <span>Cámara</span>
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="Añadir foto desde archivo"
                className="min-h-[36px] inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium transition-colors cursor-pointer"
              >
                <ImagePlus className="w-3.5 h-3.5" />
                <span>Foto</span>
              </button>
            </div>
          </div>

          {doc.pages.length === 0 ? (
            <div className="py-10 text-center border border-dashed border-slate-200 rounded-lg">
              <p className="text-sm text-slate-500 mb-3">
                No hay páginas en este documento.
              </p>
              <button
                type="button"
                onClick={onAddFromCamera}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-700 text-white text-xs font-semibold cursor-pointer"
              >
                <Camera className="w-4 h-4" />
                <span>Agregar primera página</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-1 gap-2.5 max-h-[66vh] overflow-y-auto pr-0.5">
              {doc.pages.map((page, index) => {
                const isSelected = page.id === activePage?.id;
                const filterLabel =
                  FILTER_PRESETS.find((f) => f.id === page.filter)?.label ?? page.filter;

                return (
                  <div
                    key={page.id}
                    onClick={() => setSelectedPageId(page.id)}
                    className={`group flex flex-col lg:flex-row items-center gap-3 p-2 rounded-lg border transition-colors cursor-pointer ${
                      isSelected
                        ? 'border-teal-600 bg-teal-50/50'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <div className="w-full lg:w-16 h-24 lg:h-20 rounded bg-slate-100 border border-slate-200 overflow-hidden shrink-0 flex items-center justify-center">
                      <img
                        src={page.processedDataUrl}
                        alt={`Página ${index + 1}`}
                        className="w-full h-full object-contain"
                      />
                    </div>

                    <div className="w-full min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-semibold text-slate-900 tabular-nums">
                          Página {index + 1}
                        </span>
                        <div
                          className="flex items-center gap-0.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => handleMovePage(index, -1)}
                            disabled={index === 0}
                            aria-label="Mover página arriba"
                            className="p-1 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 disabled:opacity-30 cursor-pointer"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMovePage(index, 1)}
                            disabled={index === doc.pages.length - 1}
                            aria-label="Mover página abajo"
                            className="p-1 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 disabled:opacity-30 cursor-pointer"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeletePage(page.id)}
                            aria-label="Eliminar página"
                            className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      <p className="text-[11px] text-slate-500 truncate mt-0.5">
                        {filterLabel}
                      </p>
                      <p className="text-[11px] font-mono text-slate-400 tabular-nums mt-0.5">
                        {page.processedWidth} × {page.processedHeight}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </aside>

        {/* Column 2: High-Resolution Central Preview */}
        <section
          className={`lg:col-span-5 flex flex-col gap-3 ${
            mobilePanel === 'preview' ? 'block' : 'hidden lg:flex'
          }`}
        >
          {activePage ? (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              {/* Page Action Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-200 bg-slate-50/70">
                <span className="text-xs font-medium text-slate-600 tabular-nums">
                  Página {activeIndex + 1} de {doc.pages.length} ·{' '}
                  {showOriginal ? 'Foto original' : 'Escaneo mejorado'}
                </span>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onRequestRecrop(activePage.id)}
                    className="min-h-[36px] inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-200/70 transition-colors cursor-pointer"
                  >
                    <Crop className="w-3.5 h-3.5 text-teal-700" />
                    <span>Encuadrar</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleRotateActive}
                    disabled={isProcessing}
                    className="min-h-[36px] inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-200/70 transition-colors cursor-pointer"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                    <span>Rotar</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowOriginal((v) => !v)}
                    className={`min-h-[36px] inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      showOriginal
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-700 hover:bg-slate-200/70'
                    }`}
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Original</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleDownloadPageImage}
                    title="Descargar esta página como JPG"
                    className="min-h-[36px] inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-200/70 transition-colors cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>JPG</span>
                  </button>
                </div>
              </div>

              {/* Preview Stage */}
              <div className="relative p-4 sm:p-6 bg-[#ECEFF2] flex items-center justify-center min-h-[420px] max-h-[68vh]">
                <img
                  src={
                    showOriginal
                      ? activePage.originalDataUrl
                      : activePage.processedDataUrl
                  }
                  alt={`Vista de página ${activeIndex + 1}`}
                  className="max-h-[62vh] w-auto object-contain rounded shadow-md bg-white"
                />
                {isProcessing && (
                  <div className="absolute inset-0 bg-white/70 backdrop-blur-[1px] flex items-center justify-center">
                    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium shadow">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Procesando imagen...</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-slate-500 text-sm">
              Selecciona o agrega una página para visualizarla.
            </div>
          )}
        </section>

        {/* Column 3: Filters, Adjustments & PDF Export */}
        <aside className="lg:col-span-4 flex flex-col gap-5">
          {/* Filters Panel */}
          <div
            className={`bg-white border border-slate-200 rounded-xl p-4 sm:p-5 ${
              mobilePanel === 'filters' ? 'block' : 'hidden lg:block'
            }`}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-900">
                Filtros de mejora
              </h3>
              {doc.pages.length > 1 && activePage && (
                <button
                  type="button"
                  onClick={handleApplyFilterToAll}
                  disabled={isProcessing}
                  className="text-xs font-medium text-teal-700 hover:text-teal-800 hover:underline cursor-pointer"
                >
                  Aplicar a todas
                </button>
              )}
            </div>

            {activePage && (
              <>
                <div className="grid grid-cols-5 gap-2 mb-4">
                  {FILTER_PRESETS.map((preset) => {
                    const isSelected = activePage.filter === preset.id;
                    const thumbSrc = filterThumbs[preset.id] || activePage.processedDataUrl;

                    return (
                      <button
                        key={preset.id}
                        type="button"
                        disabled={isProcessing}
                        onClick={() =>
                          reprocessAndSavePage(activePage.id, { filter: preset.id })
                        }
                        className={`flex flex-col items-center p-1.5 rounded-lg border text-center transition-colors cursor-pointer ${
                          isSelected
                            ? 'border-teal-600 bg-teal-50/70'
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                        }`}
                      >
                        <div className="w-full aspect-[3/4] rounded bg-slate-100 overflow-hidden mb-1.5 border border-slate-200/80">
                          <img
                            src={thumbSrc}
                            alt={preset.label}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <span
                          className={`text-[11px] leading-tight font-medium line-clamp-2 ${
                            isSelected ? 'text-teal-900 font-semibold' : 'text-slate-700'
                          }`}
                        >
                          {preset.label}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <p className="text-xs text-slate-500 mb-4">
                  {FILTER_PRESETS.find((f) => f.id === activePage.filter)?.description}
                </p>

                {/* Fine-Tune Sliders */}
                <div className="pt-4 border-t border-slate-100 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                      <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500" />
                      Ajuste fino
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        reprocessAndSavePage(activePage.id, {
                          adjustments: DEFAULT_ADJUSTMENTS,
                        })
                      }
                      className="text-xs text-slate-500 hover:text-slate-900 underline cursor-pointer"
                    >
                      Restablecer
                    </button>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs text-slate-600 mb-1">
                      <span>Brillo</span>
                      <span className="font-mono tabular-nums">
                        {activePage.adjustments.brightness > 0 ? '+' : ''}
                        {activePage.adjustments.brightness}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={-40}
                      max={40}
                      value={activePage.adjustments.brightness}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        reprocessAndSavePage(activePage.id, {
                          adjustments: { ...activePage.adjustments, brightness: val },
                        });
                      }}
                      className="w-full accent-teal-700 cursor-pointer"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-xs text-slate-600 mb-1">
                      <span>Contraste</span>
                      <span className="font-mono tabular-nums">
                        {activePage.adjustments.contrast > 0 ? '+' : ''}
                        {activePage.adjustments.contrast}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={-40}
                      max={40}
                      value={activePage.adjustments.contrast}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        reprocessAndSavePage(activePage.id, {
                          adjustments: { ...activePage.adjustments, contrast: val },
                        });
                      }}
                      className="w-full accent-teal-700 cursor-pointer"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-xs text-slate-600 mb-1">
                      <span>Nitidez de texto</span>
                      <span className="font-mono tabular-nums">
                        {activePage.adjustments.sharpness}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={activePage.adjustments.sharpness}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        reprocessAndSavePage(activePage.id, {
                          adjustments: { ...activePage.adjustments, sharpness: val },
                        });
                      }}
                      className="w-full accent-teal-700 cursor-pointer"
                    />
                  </div>
                </div>
              </>
            )}
          </div>

          {/* PDF Export & Share Settings Panel */}
          <div
            className={`bg-white border border-slate-200 rounded-xl p-4 sm:p-5 ${
              mobilePanel === 'export' ? 'block' : 'hidden lg:block'
            }`}
          >
            <h3 className="text-sm font-semibold text-slate-900 mb-3">
              Configuración de PDF
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">
                  Tamaño de página
                </label>
                <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg">
                  {(
                    [
                      { id: 'a4', label: 'A4' },
                      { id: 'letter', label: 'Carta' },
                      { id: 'auto', label: 'Ajustado' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => updatePdfSetting({ pageSize: opt.id })}
                      className={`py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                        doc.pdfSettings.pageSize === opt.id
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">
                  Calidad del archivo
                </label>
                <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
                  {(
                    [
                      { id: 'high', label: 'Alta calidad' },
                      { id: 'standard', label: 'Ligero' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => updatePdfSetting({ quality: opt.id })}
                      className={`py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                        doc.pdfSettings.quality === opt.id
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-2 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={handleDownloadPdf}
                  disabled={doc.pages.length === 0 || pdfBusy !== null}
                  className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold transition-colors cursor-pointer disabled:opacity-50"
                >
                  {pdfBusy === 'download' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <FileDown className="w-4 h-4" />
                  )}
                  <span>Descargar PDF</span>
                </button>

                <button
                  type="button"
                  onClick={handleSharePdfDirect}
                  disabled={doc.pages.length === 0 || pdfBusy !== null}
                  className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-sm font-medium transition-colors cursor-pointer disabled:opacity-50"
                >
                  {pdfBusy === 'share' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4 text-teal-700" />
                  )}
                  <span>Enviar PDF directo</span>
                </button>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* Desktop Share Fallback Modal */}
      {showShareFallback && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 p-6 shadow-xl">
            <h3 className="text-base font-semibold text-slate-900 mb-2">
              PDF listo para enviar
            </h3>
            <p className="text-sm text-slate-600 leading-relaxed mb-4">
              Este navegador de escritorio no permite enviar archivos adjuntos directamente a otras aplicaciones. Descarga el PDF ({formatBytes(showShareFallback.sizeBytes)}) para adjuntarlo en WhatsApp Web, correo o Telegram.
            </p>
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700 font-mono truncate mb-5">
              {showShareFallback.filename}
            </div>
            <div className="flex flex-col sm:flex-row gap-2.5 justify-end">
              <button
                type="button"
                onClick={() => {
                  triggerBlobDownload(showShareFallback.blob, showShareFallback.filename);
                  window.location.href = `mailto:?subject=${encodeURIComponent(
                    doc.title
                  )}&body=${encodeURIComponent(
                    'Adjunto el documento escaneado en PDF.'
                  )}`;
                  setShowShareFallback(null);
                }}
                className="min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                <Mail className="w-4 h-4" />
                <span>Descargar y abrir correo</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  triggerBlobDownload(showShareFallback.blob, showShareFallback.filename);
                  setShowShareFallback(null);
                  showToast('success', `PDF guardado: ${showShareFallback.filename}`);
                }}
                className="min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold cursor-pointer"
              >
                <Check className="w-4 h-4" />
                <span>Descargar PDF ahora</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            onAddFromFiles(e.target.files);
          }
          e.target.value = '';
        }}
      />
    </div>
  );
};
