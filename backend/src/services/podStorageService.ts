import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from '../utils/errors.js';

const ALLOWED_IMAGE_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const MAX_POD_BYTES = 5 * 1024 * 1024; // 5 MB
const POD_UPLOAD_DIR = path.resolve(process.cwd(), 'uploads', 'pod');

export function validatePodImageFile(file: {
  mimetype: string;
  size: number;
}): void {
  if (!ALLOWED_IMAGE_MIME.has(file.mimetype)) {
    throw new HttpError(
      400,
      'Unsupported POD image type. Allowed types: JPEG, PNG, WebP.',
      'INVALID_FILE_TYPE'
    );
  }
  if (file.size <= 0 || file.size > MAX_POD_BYTES) {
    throw new HttpError(
      400,
      'POD image size must be between 1 byte and 5 MB.',
      'INVALID_FILE_SIZE'
    );
  }
}

export async function savePodPhotoLocal(file: {
  buffer: Buffer;
  mimetype: string;
  size: number;
}): Promise<{
  photoStorageKey: string;
  photoMimeType: string;
  photoAccessToken: string;
}> {
  validatePodImageFile(file);
  await fs.mkdir(POD_UPLOAD_DIR, { recursive: true });

  const ext =
    file.mimetype === 'image/png'
      ? 'png'
      : file.mimetype === 'image/webp'
        ? 'webp'
        : 'jpg';
  const photoStorageKey = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  const photoAccessToken = crypto.randomBytes(24).toString('hex');

  await fs.writeFile(path.join(POD_UPLOAD_DIR, photoStorageKey), file.buffer);
  return {
    photoStorageKey,
    photoMimeType: file.mimetype,
    photoAccessToken,
  };
}

export async function readPodPhotoLocal(photoStorageKey: string): Promise<Buffer> {
  const safeName = path.basename(photoStorageKey);
  if (safeName !== photoStorageKey) {
    throw new HttpError(400, 'Invalid photo storage key', 'VALIDATION_ERROR');
  }
  return fs.readFile(path.join(POD_UPLOAD_DIR, safeName));
}
