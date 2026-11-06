/**
 * Answer images as files in the data folder's attachments/ directory. Answers keep only the file
 * name, so the database stays small and the images survive restarts with it.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AttachmentNameSchema, IMAGE_EXTENSION, ImageUploadSchema, mediaTypeOfName } from '../core/attachments';
import type { ImageMediaType } from '../core/attachments';

export interface StoredImage {
  mediaType: ImageMediaType;
  /** base64, as the model APIs take it */
  data: string;
}

/** Validate and store one image; returns its file name. Saving the same bytes again reuses the file. */
export function saveAttachment(dir: string, upload: unknown): string {
  const parsed = ImageUploadSchema.safeParse(upload);
  // the first plain-language issue is what the learner sees, not zod's JSON dump
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'That image cannot be attached.');
  const { mediaType, data } = parsed.data;
  const bytes = Buffer.from(data, 'base64');
  const name = `${createHash('sha256').update(bytes).digest('hex')}.${IMAGE_EXTENSION[mediaType]}`;
  const path = join(dir, name);
  if (!existsSync(path)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, bytes);
  }
  return name;
}

export function readAttachment(dir: string, name: string): StoredImage {
  // the name is checked before it touches the file system, so it can never point outside dir
  const safe = AttachmentNameSchema.parse(name);
  const path = join(dir, safe);
  if (!existsSync(path)) throw new Error('That image is no longer in the attachments folder.');
  return { mediaType: mediaTypeOfName(safe), data: readFileSync(path).toString('base64') };
}

export function attachmentExists(dir: string, name: string): boolean {
  return AttachmentNameSchema.safeParse(name).success && existsSync(join(dir, name));
}

/** A data URL for the renderer, whose content security policy allows data: images only. */
export function attachmentDataUrl(dir: string, name: string): string {
  const image = readAttachment(dir, name);
  return `data:${image.mediaType};base64,${image.data}`;
}
