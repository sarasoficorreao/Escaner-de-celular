import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  FlipHorizontal,
  Grid3x3,
  ImagePlus,
  Smartphone,
  X,
  Zap,
  ZapOff,
} from 'lucide-react';
import { fileToDataUrl } from '../utils/imageProcessing';

interface CameraCaptureModalProps {
  onClose: () => void;
  onCaptureComplete: (images: string[]) => void;
}

export const CameraCaptureModal: React.FC<CameraCaptureModalProps> = ({
  onClose,
  onCaptureComplete,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nativeCameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [showGrid, setShowGrid] = useState(true);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [capturedList, setCapturedList] = useState<string[]>([]);
  const [flashEffect, setFlashEffect] = useState(false);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraReady(false);
    setTorchSupported(false);
    setTorchOn(false);
  }, []);

  const startCamera = useCallback(async () => {
    stopStream();
    setCameraError(null);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError('Este navegador no permite acceso directo a la cámara en vivo.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 2560 },
          height: { ideal: 1920 },
        },
        audio: false,
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      const track = stream.getVideoTracks()[0];
      if (track && typeof track.getCapabilities === 'function') {
        const caps = track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean };
        if (caps.torch) {
          setTorchSupported(true);
        }
      }

      setCameraReady(true);
    } catch {
      setCameraError(
        'No se pudo iniciar la cámara. Puedes usar la cámara nativa del dispositivo o subir una foto.'
      );
    }
  }, [facingMode, stopStream]);

  useEffect(() => {
    startCamera();
    return () => {
      stopStream();
    };
  }, [startCamera, stopStream]);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet],
      });
      setTorchOn(next);
    } catch {
      setTorchSupported(false);
    }
  };

  const handleSnap = () => {
    const video = videoRef.current;
    if (!video || !cameraReady) return;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;

    const canvas = document.createElement('canvas');
    canvas.width = vw;
    canvas.height = vh;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, vw, vh);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.94);

    setFlashEffect(true);
    setTimeout(() => setFlashEffect(false), 160);
    setCapturedList((prev) => [...prev, dataUrl]);
  };

  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const urls: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (f.type.startsWith('image/')) {
        urls.push(await fileToDataUrl(f));
      }
    }
    e.target.value = '';

    if (urls.length > 0) {
      stopStream();
      onCaptureComplete([...capturedList, ...urls]);
    }
  };

  const handleFinish = () => {
    if (capturedList.length === 0) return;
    stopStream();
    onCaptureComplete(capturedList);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-[#0D1013] text-white"
      role="dialog"
      aria-modal="true"
      aria-label="Cámara de escaneo"
    >
      {/* Top Bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-[#111519]/90 backdrop-blur-md">
        <button
          type="button"
          onClick={() => {
            stopStream();
            onClose();
          }}
          className="min-h-[44px] min-w-[44px] inline-flex items-center gap-2 px-3 rounded-lg text-sm font-medium text-slate-200 hover:bg-white/10 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
          <span>Cerrar</span>
        </button>

        <span className="text-sm font-semibold tracking-tight text-white">
          Capturar documento
        </span>

        <div className="flex items-center gap-1">
          {torchSupported && (
            <button
              type="button"
              onClick={toggleTorch}
              aria-label={torchOn ? 'Apagar flash' : 'Encender flash'}
              className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg transition-colors cursor-pointer ${
                torchOn ? 'bg-amber-500/20 text-amber-300' : 'text-slate-300 hover:bg-white/10'
              }`}
            >
              {torchOn ? <Zap className="w-5 h-5" /> : <ZapOff className="w-5 h-5" />}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowGrid((v) => !v)}
            aria-label="Mostrar u ocultar cuadrícula"
            className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg transition-colors cursor-pointer ${
              showGrid ? 'bg-teal-500/20 text-teal-300' : 'text-slate-300 hover:bg-white/10'
            }`}
          >
            <Grid3x3 className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() =>
              setFacingMode((m) => (m === 'environment' ? 'user' : 'environment'))
            }
            aria-label="Cambiar cámara"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-300 hover:bg-white/10 transition-colors cursor-pointer"
          >
            <FlipHorizontal className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Viewfinder */}
      <div className="relative flex-1 flex items-center justify-center overflow-hidden bg-black">
        {!cameraError ? (
          <>
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className="w-full h-full object-contain"
            />
            {showGrid && cameraReady && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 sm:p-12">
                <div className="relative w-full h-full max-w-2xl max-h-[82vh] border border-white/25 rounded-lg">
                  <div className="absolute inset-y-0 left-1/3 w-px bg-white/15" />
                  <div className="absolute inset-y-0 left-2/3 w-px bg-white/15" />
                  <div className="absolute inset-x-0 top-1/3 h-px bg-white/15" />
                  <div className="absolute inset-x-0 top-2/3 h-px bg-white/15" />
                  {/* Corner guides */}
                  <div className="absolute -top-0.5 -left-0.5 w-6 h-6 border-t-2 border-l-2 border-teal-400 rounded-tl-sm" />
                  <div className="absolute -top-0.5 -right-0.5 w-6 h-6 border-t-2 border-r-2 border-teal-400 rounded-tr-sm" />
                  <div className="absolute -bottom-0.5 -left-0.5 w-6 h-6 border-b-2 border-l-2 border-teal-400 rounded-bl-sm" />
                  <div className="absolute -bottom-0.5 -right-0.5 w-6 h-6 border-b-2 border-r-2 border-teal-400 rounded-br-sm" />
                </div>
              </div>
            )}
            {flashEffect && (
              <div className="pointer-events-none absolute inset-0 bg-white/70 transition-opacity" />
            )}
          </>
        ) : (
          <div className="max-w-md mx-auto px-6 py-8 text-center">
            <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-white/10 flex items-center justify-center text-teal-400">
              <Camera className="w-7 h-7" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">
              Cámara en vivo no disponible
            </h3>
            <p className="text-sm text-slate-300 leading-relaxed mb-6">
              {cameraError}
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => nativeCameraInputRef.current?.click()}
                className="w-full sm:w-auto min-h-[44px] inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-sm font-semibold transition-colors cursor-pointer"
              >
                <Smartphone className="w-4 h-4" />
                <span>Abrir cámara del dispositivo</span>
              </button>
              <button
                type="button"
                onClick={() => galleryInputRef.current?.click()}
                className="w-full sm:w-auto min-h-[44px] inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-sm font-medium transition-colors cursor-pointer"
              >
                <ImagePlus className="w-4 h-4" />
                <span>Elegir foto de galería</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Capture Controls */}
      <div className="px-4 py-4 sm:py-5 bg-[#111519] border-t border-white/10">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-4">
          {/* Gallery / Native Photo */}
          <button
            type="button"
            onClick={() => galleryInputRef.current?.click()}
            className="min-h-[44px] min-w-[44px] inline-flex flex-col sm:flex-row items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-medium text-slate-200 hover:bg-white/10 transition-colors cursor-pointer"
          >
            <ImagePlus className="w-5 h-5 text-slate-300" />
            <span>Galería</span>
          </button>

          {/* Shutter Button */}
          <button
            type="button"
            onClick={handleSnap}
            disabled={!cameraReady}
            aria-label="Tomar foto"
            className={`w-16 h-16 rounded-full border-4 border-white flex items-center justify-center transition-transform active:scale-95 ${
              cameraReady
                ? 'bg-teal-500 hover:bg-teal-400 cursor-pointer shadow-lg shadow-teal-900/40'
                : 'bg-slate-700 opacity-40 cursor-not-allowed'
            }`}
          >
            <span className="w-12 h-12 rounded-full border-2 border-white/40" />
          </button>

          {/* Done / Confirm batch */}
          <div className="min-w-[88px] flex justify-end">
            {capturedList.length > 0 ? (
              <button
                type="button"
                onClick={handleFinish}
                className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap"
              >
                <img
                  src={capturedList[capturedList.length - 1]}
                  alt="Última captura"
                  className="w-6 h-6 rounded object-cover border border-white/40"
                />
                <span className="tabular-nums">Listo ({capturedList.length})</span>
                <Check className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => nativeCameraInputRef.current?.click()}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-medium text-slate-300 hover:bg-white/10 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Smartphone className="w-4 h-4" />
                <span className="hidden sm:inline">Cámara nativa</span>
                <span className="sm:hidden">Nativa</span>
              </button>
            )}
          </div>
        </div>
      </div>

      <input
        ref={nativeCameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFilesSelected}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFilesSelected}
      />
    </div>
  );
};
