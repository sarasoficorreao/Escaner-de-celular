import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  FileDown,
  FileText,
  ImagePlus,
  Loader2,
  Search,
  Send,
  Sparkles,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { CameraCaptureModal } from './components/CameraCaptureModal';
import { CornerCropper } from './components/CornerCropper';
import { DocumentEditor } from './components/DocumentEditor';
import {
  DEFAULT_ADJUSTMENTS,
  DEFAULT_PDF_SETTINGS,
  QuadCorners,
  ScanDocument,
  ScannedPage,
} from './types/scanner';
import {
  fileToDataUrl,
  generateSampleDocumentPhoto,
  loadImage,
  processScannedPage,
} from './utils/imageProcessing';
import {
  buildDocumentPdf,
  canShareFilesNatively,
  formatBytes,
  triggerBlobDownload,
} from './utils/pdfExport';
import {
  deleteDocumentById,
  loadAllDocuments,
  saveDocument,
} from './utils/storage';

interface CropJob {
  mode: 'append' | 'recrop';
  targetDocId: string | null;
  recropPageId?: string;
  queue: string[];
  currentIndex: number;
  initialRotation: number;
  initialCorners?: QuadCorners;
  accumulatedPages: ScannedPage[];
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatDateShort(ts: number): string {
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ts));
}

export default function App() {
  const [documents, setDocuments] = useState<ScanDocument[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCamera, setShowCamera] = useState(false);
  const [cameraTargetDocId, setCameraTargetDocId] = useState<string | null>(null);
  const [cropJob, setCropJob] = useState<CropJob | null>(null);
  const [processingScan, setProcessingScan] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [libraryNotice, setLibraryNotice] = useState<string | null>(null);

  const fileUploadRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    loadAllDocuments().then((docs) => {
      setDocuments(docs);
      setLoadingDocs(false);
    });
  }, []);

  const activeDoc = documents.find((d) => d.id === activeDocId) ?? null;

  const notifyLibrary = (msg: string) => {
    setLibraryNotice(msg);
    setTimeout(() => {
      setLibraryNotice((prev) => (prev === msg ? null : prev));
    }, 4500);
  };

  const handleUpdateDocument = async (updated: ScanDocument) => {
    setDocuments((prev) => {
      const exists = prev.some((d) => d.id === updated.id);
      const next = exists
        ? prev.map((d) => (d.id === updated.id ? updated : d))
        : [updated, ...prev];
      return [...next].sort((a, b) => b.updatedAt - a.updatedAt);
    });
    await saveDocument(updated);
  };

  const handleDeleteDocument = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDocuments((prev) => prev.filter((d) => d.id !== id));
    if (activeDocId === id) setActiveDocId(null);
    await deleteDocumentById(id);
  };

  const startCropQueue = (images: string[], targetDocId: string | null) => {
    if (images.length === 0) return;
    setCropJob({
      mode: 'append',
      targetDocId,
      queue: images,
      currentIndex: 0,
      initialRotation: 0,
      accumulatedPages: [],
    });
  };

  const handleFilesAdded = async (files: FileList, targetDocId: string | null) => {
    const urls: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (f.type.startsWith('image/')) {
        urls.push(await fileToDataUrl(f));
      }
    }
    if (urls.length > 0) {
      startCropQueue(urls, targetDocId);
    }
  };

  const handleLoadSampleDocument = () => {
    const sampleUrl = generateSampleDocumentPhoto();
    if (sampleUrl) {
      startCropQueue([sampleUrl], null);
    }
  };

  const handleCropConfirm = async (rotation: number, corners: QuadCorners) => {
    if (!cropJob) return;
    setProcessingScan(true);

    try {
      const currentUrl = cropJob.queue[cropJob.currentIndex];
      const img = await loadImage(currentUrl);

      if (cropJob.mode === 'recrop' && cropJob.targetDocId && cropJob.recropPageId) {
        const doc = documents.find((d) => d.id === cropJob.targetDocId);
        const page = doc?.pages.find((p) => p.id === cropJob.recropPageId);
        if (doc && page) {
          const processed = await processScannedPage(
            page.originalDataUrl,
            rotation,
            corners,
            page.filter,
            page.adjustments
          );
          const updatedDoc: ScanDocument = {
            ...doc,
            pages: doc.pages.map((p) =>
              p.id === page.id
                ? {
                    ...p,
                    rotation,
                    corners,
                    processedDataUrl: processed.dataUrl,
                    processedWidth: processed.width,
                    processedHeight: processed.height,
                  }
                : p
            ),
            updatedAt: Date.now(),
          };
          await handleUpdateDocument(updatedDoc);
        }
        setCropJob(null);
        return;
      }

      // Append mode
      const processed = await processScannedPage(
        currentUrl,
        rotation,
        corners,
        'magic',
        DEFAULT_ADJUSTMENTS
      );

      const newPage: ScannedPage = {
        id: createId('pag'),
        originalDataUrl: currentUrl,
        originalWidth: img.naturalWidth || img.width,
        originalHeight: img.naturalHeight || img.height,
        rotation,
        corners,
        filter: 'magic',
        adjustments: { ...DEFAULT_ADJUSTMENTS },
        processedDataUrl: processed.dataUrl,
        processedWidth: processed.width,
        processedHeight: processed.height,
        createdAt: Date.now(),
      };

      const nextAccumulated = [...cropJob.accumulatedPages, newPage];
      const nextIdx = cropJob.currentIndex + 1;

      if (nextIdx < cropJob.queue.length) {
        setCropJob({
          ...cropJob,
          currentIndex: nextIdx,
          accumulatedPages: nextAccumulated,
          initialRotation: 0,
          initialCorners: undefined,
        });
      } else {
        // All photos in batch cropped & enhanced
        if (cropJob.targetDocId) {
          const existing = documents.find((d) => d.id === cropJob.targetDocId);
          if (existing) {
            const updated: ScanDocument = {
              ...existing,
              pages: [...existing.pages, ...nextAccumulated],
              updatedAt: Date.now(),
            };
            await handleUpdateDocument(updated);
            setActiveDocId(updated.id);
          }
        } else {
          const now = Date.now();
          const dateLabel = new Intl.DateTimeFormat('es-ES', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
            .format(new Date(now))
            .replace(/[,/:]/g, '-');

          const newDoc: ScanDocument = {
            id: createId('doc'),
            title: `Escaneo ${dateLabel}`,
            pages: nextAccumulated,
            pdfSettings: { ...DEFAULT_PDF_SETTINGS },
            createdAt: now,
            updatedAt: now,
          };
          await handleUpdateDocument(newDoc);
          setActiveDocId(newDoc.id);
        }
        setCropJob(null);
      }
    } finally {
      setProcessingScan(false);
    }
  };

  const handleQuickDownloadDoc = async (doc: ScanDocument, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await buildDocumentPdf(doc);
      triggerBlobDownload(res.blob, res.filename);
      notifyLibrary(`PDF descargado: ${res.filename} (${formatBytes(res.sizeBytes)})`);
    } catch {
      notifyLibrary('No se pudo generar el PDF.');
    }
  };

  const handleQuickShareDoc = async (doc: ScanDocument, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await buildDocumentPdf(doc);
      if (canShareFilesNatively()) {
        await navigator.share({
          files: [res.file],
          title: doc.title,
          text: `Documento escaneado: ${doc.title}`,
        });
        return;
      }
      triggerBlobDownload(res.blob, res.filename);
      notifyLibrary(
        `PDF descargado (${res.filename}). Adjúntalo en tu correo o WhatsApp Web.`
      );
    } catch {
      // User cancelled share sheet or error
    }
  };

  const filteredDocs = documents.filter((d) =>
    d.title.toLowerCase().includes(searchQuery.trim().toLowerCase())
  );

  return (
    <div
      className="min-h-screen flex flex-col bg-[#F6F7F8] text-slate-900"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDraggingOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setIsDraggingOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDraggingOver(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          handleFilesAdded(e.dataTransfer.files, activeDocId);
        }
      }}
    >
      {/* Top Bar Contract: 3 Zones */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Single-line Brand Wordmark */}
        <button
          type="button"
          onClick={() => setActiveDocId(null)}
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 cursor-pointer hover:text-teal-700 transition-colors"
        >
          FolioScan
        </button>

        {/* Zone 2: Concise Navigation Links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
          <button
            type="button"
            onClick={() => setActiveDocId(null)}
            className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeDocId === null ? 'text-slate-900 underline underline-offset-4' : ''
            }`}
          >
            Mis documentos
          </button>
          <button
            type="button"
            onClick={() => fileUploadRef.current?.click()}
            className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Subir foto
          </button>
          <button
            type="button"
            onClick={handleLoadSampleDocument}
            className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Probar ejemplo
          </button>
        </nav>

        {/* Zone 3: 1 Primary CTA */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={() => {
              setCameraTargetDocId(activeDocId);
              setShowCamera(true);
            }}
            className="min-h-[40px] inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Camera className="w-4 h-4" />
            <span>Escanear</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      {activeDoc ? (
        <DocumentEditor
          document={activeDoc}
          onUpdateDocument={handleUpdateDocument}
          onBack={() => setActiveDocId(null)}
          onAddFromCamera={() => {
            setCameraTargetDocId(activeDoc.id);
            setShowCamera(true);
          }}
          onAddFromFiles={(files) => handleFilesAdded(files, activeDoc.id)}
          onRequestRecrop={(pageId) => {
            const targetPage = activeDoc.pages.find((p) => p.id === pageId);
            if (!targetPage) return;
            setCropJob({
              mode: 'recrop',
              targetDocId: activeDoc.id,
              recropPageId: pageId,
              queue: [targetPage.originalDataUrl],
              currentIndex: 0,
              initialRotation: targetPage.rotation,
              initialCorners: targetPage.corners,
              accumulatedPages: [],
            });
          }}
        />
      ) : (
        <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8">
          {/* Header & Search */}
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
                Escáner de documentos a PDF
              </h1>
              <p className="text-sm text-slate-600 mt-1 max-w-2xl">
                Captura o sube fotos de tus documentos. El sistema encuadra la perspectiva, limpia sombras sin alterar ningún dato y exporta en PDF de alta calidad.
              </p>
            </div>

            {documents.length > 0 && (
              <div className="relative w-full sm:w-64">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar documento..."
                  className="w-full min-h-[42px] pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-teal-600"
                />
              </div>
            )}
          </div>

          {libraryNotice && (
            <div className="mb-6 px-4 py-3 rounded-xl bg-teal-50 border border-teal-200 text-sm text-teal-900 flex items-center justify-between">
              <span>{libraryNotice}</span>
              <button
                type="button"
                onClick={() => setLibraryNotice(null)}
                className="text-xs font-medium underline ml-4 cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          )}

          {/* Quick Capture Actions Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            <button
              type="button"
              onClick={() => {
                setCameraTargetDocId(null);
                setShowCamera(true);
              }}
              className="flex items-center gap-4 p-4 rounded-xl bg-white border border-slate-200 hover:border-teal-600 text-left transition-colors cursor-pointer"
            >
              <div className="w-11 h-11 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center shrink-0">
                <Camera className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <span className="block text-sm font-semibold text-slate-900">
                  Tomar foto ahora
                </span>
                <span className="block text-xs text-slate-500 truncate">
                  Usa la cámara en vivo o nativa
                </span>
              </div>
            </button>

            <button
              type="button"
              onClick={() => fileUploadRef.current?.click()}
              className="flex items-center gap-4 p-4 rounded-xl bg-white border border-slate-200 hover:border-teal-600 text-left transition-colors cursor-pointer"
            >
              <div className="w-11 h-11 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
                <ImagePlus className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <span className="block text-sm font-semibold text-slate-900">
                  Subir desde galería
                </span>
                <span className="block text-xs text-slate-500 truncate">
                  Una o varias fotos a la vez
                </span>
              </div>
            </button>

            <button
              type="button"
              onClick={handleLoadSampleDocument}
              className="flex items-center gap-4 p-4 rounded-xl bg-white border border-slate-200 hover:border-teal-600 text-left transition-colors cursor-pointer"
            >
              <div className="w-11 h-11 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
                <Sparkles className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <span className="block text-sm font-semibold text-slate-900">
                  Probar hoja de ejemplo
                </span>
                <span className="block text-xs text-slate-500 truncate">
                  Comprueba el encuadre y filtros
                </span>
              </div>
            </button>
          </div>

          {/* Document Grid / Empty State */}
          {loadingDocs ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {[1, 2, 3].map((k) => (
                <div
                  key={k}
                  className="h-64 rounded-xl bg-white border border-slate-200 animate-pulse"
                />
              ))}
            </div>
          ) : documents.length === 0 ? (
            <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-10 sm:p-14 text-center">
              <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-slate-100 text-slate-600 flex items-center justify-center">
                <FileText className="w-7 h-7" />
              </div>
              <h2 className="text-lg font-semibold text-slate-900 mb-2">
                Aún no tienes documentos escaneados
              </h2>
              <p className="text-sm text-slate-600 max-w-md mx-auto mb-6 leading-relaxed">
                Toma una foto con tu cámara, arrastra imágenes aquí o prueba con una hoja de ejemplo para ajustar las esquinas, elegir tu filtro y generar tu PDF.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setCameraTargetDocId(null);
                    setShowCamera(true);
                  }}
                  className="w-full sm:w-auto min-h-[44px] inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold transition-colors cursor-pointer"
                >
                  <Camera className="w-4 h-4" />
                  <span>Escanear con cámara</span>
                </button>
                <button
                  type="button"
                  onClick={() => fileUploadRef.current?.click()}
                  className="w-full sm:w-auto min-h-[44px] inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-sm font-medium transition-colors cursor-pointer"
                >
                  <UploadCloud className="w-4 h-4" />
                  <span>Seleccionar imagen</span>
                </button>
              </div>
            </div>
          ) : filteredDocs.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
              <p className="text-sm text-slate-600">
                No hay documentos que coincidan con "{searchQuery}".
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredDocs.map((doc) => {
                const cover = doc.pages[0]?.processedDataUrl;
                return (
                  <article
                    key={doc.id}
                    onClick={() => setActiveDocId(doc.id)}
                    className="group bg-white border border-slate-200 hover:border-teal-600 rounded-xl overflow-hidden transition-colors cursor-pointer flex flex-col"
                  >
                    <div className="h-52 bg-[#ECEFF2] p-4 flex items-center justify-center border-b border-slate-100">
                      {cover ? (
                        <img
                          src={cover}
                          alt={doc.title}
                          className="max-h-full w-auto object-contain rounded shadow-sm bg-white"
                        />
                      ) : (
                        <FileText className="w-10 h-10 text-slate-400" />
                      )}
                    </div>

                    <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                      <div>
                        <h3 className="text-base font-semibold text-slate-900 truncate group-hover:text-teal-800">
                          {doc.title}
                        </h3>
                        <p className="text-xs text-slate-500 mt-1 tabular-nums">
                          {doc.pages.length}{' '}
                          {doc.pages.length === 1 ? 'página' : 'páginas'} ·{' '}
                          {formatDateShort(doc.updatedAt)} ·{' '}
                          {doc.pdfSettings.pageSize.toUpperCase()}
                        </p>
                      </div>

                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={(e) => handleQuickDownloadDoc(doc, e)}
                            title="Descargar PDF"
                            className="min-h-[36px] inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-teal-800 bg-teal-50 hover:bg-teal-100 transition-colors cursor-pointer"
                          >
                            <FileDown className="w-3.5 h-3.5" />
                            <span>PDF</span>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => handleQuickShareDoc(doc, e)}
                            title="Enviar PDF directo"
                            className="min-h-[36px] inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                          >
                            <Send className="w-3.5 h-3.5" />
                            <span>Enviar</span>
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => handleDeleteDocument(doc.id, e)}
                          title="Eliminar documento"
                          aria-label={`Eliminar ${doc.title}`}
                          className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </main>
      )}

      {/* Drag & Drop Overlay */}
      {isDraggingOver && (
        <div className="fixed inset-0 z-40 bg-teal-950/60 backdrop-blur-xs flex items-center justify-center p-6 pointer-events-none">
          <div className="bg-white rounded-2xl border-2 border-dashed border-teal-600 px-10 py-8 text-center shadow-2xl">
            <UploadCloud className="w-10 h-10 text-teal-700 mx-auto mb-3" />
            <p className="text-base font-semibold text-slate-900">
              Suelta tus fotos aquí para escanearlas
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Encuadre automático y conversión a PDF
            </p>
          </div>
        </div>
      )}

      {/* Camera Modal */}
      {showCamera && (
        <CameraCaptureModal
          onClose={() => setShowCamera(false)}
          onCaptureComplete={(images) => {
            setShowCamera(false);
            startCropQueue(images, cameraTargetDocId);
          }}
        />
      )}

      {/* Corner Perspective Cropper Modal */}
      {cropJob && (
        <CornerCropper
          key={`${cropJob.currentIndex}-${cropJob.queue[cropJob.currentIndex].slice(-24)}`}
          originalDataUrl={cropJob.queue[cropJob.currentIndex]}
          initialRotation={cropJob.initialRotation}
          initialCorners={cropJob.initialCorners}
          pageLabel={
            cropJob.queue.length > 1
              ? `Página ${cropJob.currentIndex + 1} de ${cropJob.queue.length}`
              : undefined
          }
          onCancel={() => setCropJob(null)}
          onConfirm={handleCropConfirm}
        />
      )}

      {/* Fullscreen Processing Overlay */}
      {processingScan && (
        <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-xs flex items-center justify-center">
          <div className="bg-white rounded-xl px-6 py-4 flex items-center gap-3 shadow-xl">
            <Loader2 className="w-5 h-5 text-teal-700 animate-spin" />
            <span className="text-sm font-medium text-slate-900">
              Enderezando y mejorando documento...
            </span>
          </div>
        </div>
      )}

      {/* Hidden Gallery Input */}
      <input
        ref={fileUploadRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            handleFilesAdded(e.target.files, null);
          }
          e.target.value = '';
        }}
      />
    </div>
  );
}
