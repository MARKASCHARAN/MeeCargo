import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from '../utils/errors.js';

export const ALLOWED_DRIVER_DOC_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

export const MAX_DRIVER_DOC_BYTES = 5 * 1024 * 1024; // 5 MB
const DRIVER_DOCS_UPLOAD_DIR = path.resolve(process.cwd(), 'uploads', 'tier2-docs');

export function validateDriverDocumentFile(file: {
  mimetype: string;
  size: number;
}): void {
  if (!ALLOWED_DRIVER_DOC_MIME.has(file.mimetype)) {
    throw new HttpError(
      400,
      'Unsupported document file type. Allowed types: JPEG, PNG, WebP, or PDF.',
      'INVALID_FILE_TYPE'
    );
  }
  if (file.size <= 0 || file.size > MAX_DRIVER_DOC_BYTES) {
    throw new HttpError(
      400,
      'Document size must be between 1 byte and 5 MB.',
      'INVALID_FILE_SIZE'
    );
  }
}

export async function saveDriverDocumentLocal(file: {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname?: string;
}): Promise<{
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  originalName: string;
}> {
  validateDriverDocumentFile(file);
  await fs.mkdir(DRIVER_DOCS_UPLOAD_DIR, { recursive: true });

  const ext =
    file.mimetype === 'application/pdf'
      ? 'pdf'
      : file.mimetype === 'image/png'
        ? 'png'
        : file.mimetype === 'image/webp'
          ? 'webp'
          : 'jpg';

  const storageKey = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  await fs.writeFile(path.join(DRIVER_DOCS_UPLOAD_DIR, storageKey), file.buffer);

  return {
    storageKey,
    mimeType: file.mimetype,
    sizeBytes: file.size,
    originalName: path.basename(file.originalname || `document.${ext}`).slice(0, 120),
  };
}

export async function readDriverDocumentLocal(storageKey: string): Promise<Buffer> {
  const safeName = path.basename(storageKey);
  if (safeName !== storageKey || !/^[a-f0-9]+\.(jpg|png|webp|pdf)$/i.test(safeName)) {
    throw new HttpError(400, 'Invalid document storage key', 'VALIDATION_ERROR');
  }
  return fs.readFile(path.join(DRIVER_DOCS_UPLOAD_DIR, safeName));
}
