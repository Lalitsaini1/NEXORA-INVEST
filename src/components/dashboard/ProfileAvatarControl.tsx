import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { mapFirebaseError, updateUserAvatar } from '../../services/authService';
import {
  getMemberInitials,
  mapCameraError,
  processImageFileToAvatar,
  renderSquareAvatarDataUrl,
} from '../../utils/avatarImage';

interface ProfileAvatarControlProps {
  uid: string;
  fullName: string;
  avatarUrl?: string;
  hasProfileDoc: boolean;
  onUpdated?: (message: string) => void;
}

type PickerTab = 'camera' | 'upload';

export function ProfileAvatarControl({
  uid,
  fullName,
  avatarUrl,
  hasProfileDoc,
  onUpdated,
}: ProfileAvatarControlProps) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<PickerTab>('camera');
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');

  const [cameraReady, setCameraReady] = useState(false);
  const [startingCamera, setStartingCamera] = useState(false);
  const [capturedPreview, setCapturedPreview] = useState<string | null>(null);
  const [processingFile, setProcessingFile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const stopCameraStream = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraReady(false);
  }, []);

  const startCameraStream = useCallback(async () => {
    stopCameraStream();
    setError(null);

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('Camera access is not supported in this browser. Use Upload Image instead.');
      return;
    }

    setStartingCamera(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode,
          width: { ideal: 640 },
          height: { ideal: 640 },
        },
        audio: false,
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setCameraReady(true);
    } catch (err) {
      setError(mapCameraError(err));
    } finally {
      setStartingCamera(false);
    }
  }, [facingMode, stopCameraStream]);

  useEffect(() => {
    if (open && activeTab === 'camera' && !capturedPreview) {
      void startCameraStream();
    } else {
      stopCameraStream();
    }

    return () => {
      stopCameraStream();
    };
  }, [open, activeTab, capturedPreview, startCameraStream, stopCameraStream]);

  const handleClose = () => {
    stopCameraStream();
    setCapturedPreview(null);
    setError(null);
    setOpen(false);
  };

  const handleCapturePhoto = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth <= 0 || video.videoHeight <= 0) {
      setError('Camera feed is still initializing. Wait a moment and try capturing again.');
      return;
    }
    try {
      const dataUrl = renderSquareAvatarDataUrl(
        video,
        video.videoWidth,
        video.videoHeight,
        facingMode === 'user'
      );
      stopCameraStream();
      setCapturedPreview(dataUrl);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to capture camera frame.');
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setError(null);
    setProcessingFile(true);
    try {
      const dataUrl = await processImageFileToAvatar(file);
      setCapturedPreview(dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not process the selected image.');
    } finally {
      setProcessingFile(false);
    }
  };

  const handleSaveAvatar = async () => {
    if (!capturedPreview || saving) return;
    if (!hasProfileDoc) {
      setError('A registered member profile document is required before saving an avatar.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await updateUserAvatar(uid, capturedPreview);
      onUpdated?.('Profile avatar updated successfully.');
      handleClose();
    } catch (err) {
      setError(mapFirebaseError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveAvatar = async () => {
    if (!avatarUrl || saving) return;
    if (!hasProfileDoc) {
      setError('A registered member profile document is required before updating your avatar.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await updateUserAvatar(uid, '');
      onUpdated?.('Profile avatar removed.');
      handleClose();
    } catch (err) {
      setError(mapFirebaseError(err));
    } finally {
      setSaving(false);
    }
  };

  const initials = getMemberInitials(fullName);

  return (
    <>
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => {
            setCapturedPreview(null);
            setError(null);
            setActiveTab('camera');
            setOpen(true);
          }}
          aria-label="Update profile avatar"
          className="group relative h-16 w-16 sm:h-20 sm:w-20 rounded-xl overflow-hidden border border-[#C59B3B]/60 bg-[#13284A] shrink-0 flex items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C59B3B] cursor-pointer"
        >
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={`${fullName} profile avatar`}
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="font-display text-lg sm:text-xl font-bold text-[#D8B45A] select-none">
              {initials}
            </span>
          )}
          <span
            aria-hidden="true"
            className="absolute inset-0 bg-[#0B1A30]/70 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white"
          >
            <Camera className="h-5 w-5" />
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            setCapturedPreview(null);
            setError(null);
            setActiveTab('camera');
            setOpen(true);
          }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#D8B45A] border border-white/20 hover:border-[#C59B3B] hover:bg-white/5 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Camera className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{avatarUrl ? 'Change Photo' : 'Add Photo'}</span>
        </button>
      </div>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="avatar-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
        >
          <div className="w-full max-w-md bg-white text-slate-900 rounded-xl border border-slate-200 overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <div>
                <h2 id="avatar-modal-title" className="font-display text-base font-bold text-[#0B1A30]">
                  Profile Avatar
                </h2>
                <p className="text-xs text-slate-500">
                  Capture with your camera or upload an image file.
                </p>
              </div>
              <button
                type="button"
                onClick={handleClose}
                disabled={saving}
                aria-label="Close avatar dialog"
                className="p-2 text-slate-500 hover:text-[#0B1A30] rounded-lg cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {!hasProfileDoc && (
                <div
                  role="status"
                  className="p-3 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg"
                >
                  Profile document is not provisioned for this account yet. Complete member
                  registration before saving an avatar.
                </div>
              )}

              {error && (
                <div
                  role="alert"
                  className="p-3 text-xs sm:text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg"
                >
                  {error}
                </div>
              )}

              {/* Mode Switcher */}
              {!capturedPreview && (
                <div
                  role="tablist"
                  aria-label="Avatar source"
                  className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'camera'}
                    onClick={() => {
                      setError(null);
                      setActiveTab('camera');
                    }}
                    className={`inline-flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                      activeTab === 'camera'
                        ? 'bg-white text-[#0B1A30] shadow-xs'
                        : 'text-slate-600 hover:text-[#0B1A30]'
                    }`}
                  >
                    <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Use Camera</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'upload'}
                    onClick={() => {
                      setError(null);
                      setActiveTab('upload');
                    }}
                    className={`inline-flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                      activeTab === 'upload'
                        ? 'bg-white text-[#0B1A30] shadow-xs'
                        : 'text-slate-600 hover:text-[#0B1A30]'
                    }`}
                  >
                    <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Upload Image</span>
                  </button>
                </div>
              )}

              {/* Preview Stage */}
              {capturedPreview ? (
                <div className="space-y-4">
                  <div className="flex flex-col items-center gap-3 py-2">
                    <img
                      src={capturedPreview}
                      alt="Selected profile avatar preview"
                      className="h-44 w-44 rounded-xl object-cover border border-slate-200"
                    />
                    <p className="text-xs text-slate-500">
                      Cropped 1:1 square preview ready to save.
                    </p>
                  </div>

                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        setCapturedPreview(null);
                        setError(null);
                      }}
                      disabled={saving}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 px-4 text-xs font-semibold text-[#0B1A30] border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer whitespace-nowrap"
                    >
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{activeTab === 'camera' ? 'Retake' : 'Choose Another'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveAvatar}
                      disabled={saving || !hasProfileDoc}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 px-4 text-xs font-semibold text-[#0B1A30] bg-[#C59B3B] hover:bg-[#D8B45A] disabled:opacity-60 rounded-lg cursor-pointer whitespace-nowrap"
                    >
                      {saving ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      <span>{saving ? 'Saving...' : 'Save Avatar'}</span>
                    </button>
                  </div>
                </div>
              ) : activeTab === 'camera' ? (
                <div className="space-y-3">
                  <div className="relative aspect-square w-full max-w-[280px] mx-auto rounded-xl overflow-hidden bg-[#0B1A30] border border-slate-200 flex items-center justify-center">
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className={`h-full w-full object-cover ${
                        facingMode === 'user' ? '-scale-x-100' : ''
                      }`}
                    />
                    {startingCamera && (
                      <div className="absolute inset-0 bg-[#0B1A30]/80 flex flex-col items-center justify-center gap-2 text-xs text-white">
                        <Loader2 className="h-5 w-5 animate-spin text-[#C59B3B]" aria-hidden="true" />
                        <span>Starting camera...</span>
                      </div>
                    )}
                    {!startingCamera && !cameraReady && (
                      <div className="absolute inset-0 bg-[#0B1A30] flex flex-col items-center justify-center gap-2 p-4 text-center text-xs text-slate-300">
                        <Camera className="h-6 w-6 text-[#C59B3B]" aria-hidden="true" />
                        <span>Camera preview unavailable</span>
                        <button
                          type="button"
                          onClick={() => void startCameraStream()}
                          className="mt-1 px-3 py-1.5 text-xs font-semibold text-[#0B1A30] bg-[#C59B3B] hover:bg-[#D8B45A] rounded-lg cursor-pointer"
                        >
                          Retry Camera
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() =>
                        setFacingMode((prev) => (prev === 'user' ? 'environment' : 'user'))
                      }
                      disabled={startingCamera}
                      className="px-3.5 py-2.5 text-xs font-semibold text-[#0B1A30] border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap cursor-pointer"
                    >
                      Flip Camera
                    </button>
                    <button
                      type="button"
                      onClick={handleCapturePhoto}
                      disabled={!cameraReady || startingCamera}
                      className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 px-4 text-xs font-semibold text-white bg-[#0B1A30] hover:bg-[#13284A] disabled:opacity-60 rounded-lg whitespace-nowrap cursor-pointer"
                    >
                      <Camera className="h-4 w-4 text-[#C59B3B]" aria-hidden="true" />
                      <span>Capture Photo</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={processingFile}
                    className="w-full py-10 px-4 border border-dashed border-slate-300 hover:border-[#0B1A30] bg-slate-50 hover:bg-slate-100/70 rounded-xl flex flex-col items-center justify-center gap-2 text-center transition-colors cursor-pointer"
                  >
                    {processingFile ? (
                      <Loader2 className="h-6 w-6 animate-spin text-[#0B1A30]" aria-hidden="true" />
                    ) : (
                      <Upload className="h-6 w-6 text-[#A37B22]" aria-hidden="true" />
                    )}
                    <span className="text-sm font-semibold text-[#0B1A30]">
                      {processingFile ? 'Processing image...' : 'Select an image from device'}
                    </span>
                    <span className="text-xs text-slate-500">
                      JPG, PNG, WebP or GIF up to 10 MB (auto-cropped square)
                    </span>
                  </button>
                </div>
              )}

              {/* Remove existing avatar */}
              {avatarUrl && !capturedPreview && (
                <div className="pt-3 border-t border-slate-200 flex items-center justify-between">
                  <span className="text-xs text-slate-500">Current photo is active</span>
                  <button
                    type="button"
                    onClick={handleRemoveAvatar}
                    disabled={saving || !hasProfileDoc}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700 hover:underline disabled:opacity-60 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Remove Photo</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
