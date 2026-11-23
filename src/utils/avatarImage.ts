export const AVATAR_MAX_BYTES = 92000;
export const AVATAR_TARGET_SIZE = 256;
export const AVATAR_MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB upload cap

const ALLOWED_IMAGE_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

export interface SquareCropRect {
  sx: number;
  sy: number;
  size: number;
}

export function computeSquareCrop(width: number, height: number): SquareCropRect {
  if (width <= 0 || height <= 0) {
    throw new Error('Image or camera frame has zero dimensions.');
  }
  const size = Math.min(width, height);
  const sx = Math.floor((width - size) / 2);
  const sy = Math.floor((height - size) / 2);
  return { sx, sy, size };
}

export function isValidAvatarDataUrl(value: string): boolean {
  if (!value) return false;
  if (value.length > AVATAR_MAX_BYTES) return false;
  return /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value);
}

export function getMemberInitials(fullName?: string | null): string {
  const parts = String(fullName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'NX';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function mapCameraError(err: unknown): string {
  const name =
    typeof err === 'object' && err !== null && 'name' in err
      ? String((err as { name: unknown }).name)
      : '';

  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Camera permission was denied. Allow camera access in your browser settings or upload a photo from your device instead.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No camera was detected on this device. You can upload an image file from your device instead.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'Your camera is currently in use by another app or tab. Close it and try again, or upload a photo.';
    case 'OverconstrainedError':
      return 'Selected camera mode is not supported on this device.';
    default:
      return err instanceof Error && err.message
        ? err.message
        : 'Unable to access camera. You can upload an image file from your device instead.';
  }
}

export function renderSquareAvatarDataUrl(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  mirrorHorizontal = false
): string {
  const crop = computeSquareCrop(sourceWidth, sourceHeight);
  const sizes = [AVATAR_TARGET_SIZE, 192, 144];
  const qualities = [0.85, 0.72, 0.58, 0.45];

  for (const dim of sizes) {
    const canvas = document.createElement('canvas');
    canvas.width = dim;
    canvas.height = dim;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Unable to initialize canvas for image processing.');
    }

    ctx.save();
    if (mirrorHorizontal) {
      ctx.translate(dim, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(source, crop.sx, crop.sy, crop.size, crop.size, 0, 0, dim, dim);
    ctx.restore();

    for (const quality of qualities) {
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      if (isValidAvatarDataUrl(dataUrl)) {
        return dataUrl;
      }
    }
  }

  throw new Error('Processed image is still too large. Please select a simpler photo.');
}

export function validateSelectedImageFile(file: File): string | null {
  if (!ALLOWED_IMAGE_MIME.has(file.type)) {
    return 'Unsupported file format. Please choose a JPG, PNG, WebP, or GIF image.';
  }
  if (file.size > AVATAR_MAX_FILE_BYTES) {
    return 'Selected file is larger than 10 MB. Please choose a smaller image.';
  }
  return null;
}

export async function processImageFileToAvatar(file: File): Promise<string> {
  const fileErr = validateSelectedImageFile(file);
  if (fileErr) {
    throw new Error(fileErr);
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not decode the selected image file.'));
      el.src = objectUrl;
    });
    return renderSquareAvatarDataUrl(img, img.naturalWidth, img.naturalHeight, false);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
