/**
 * Images a learner attaches to an answer, and the quote they reply to. Pure: the limits and zod
 * schemas here are shared by the renderer (to refuse early) and the backend (to refuse for real).
 */
import { z } from 'zod';
import { CodeAnswerSchema } from './code';

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export type ImageMediaType = (typeof IMAGE_TYPES)[number];

export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_QUOTE_CHARS = 4000;

export const IMAGE_EXTENSION: Record<ImageMediaType, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

/** Stored files are named by the SHA-256 of their bytes, so the same image saved twice is one file. */
export const AttachmentNameSchema = z.string().regex(/^[a-f0-9]{64}\.(png|jpg|gif|webp)$/, 'not an attachment name');

export function mediaTypeOfName(name: string): ImageMediaType {
  const ext = name.slice(name.lastIndexOf('.') + 1);
  const found = IMAGE_TYPES.find((t) => IMAGE_EXTENSION[t] === ext);
  if (!found) throw new Error(`not an attachment name: ${name}`);
  return found;
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Decoded size of a base64 string, without decoding it. */
export function base64Bytes(data: string): number {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return (data.length / 4) * 3 - padding;
}

/** The file's own first bytes decide its type; the declared type must agree, so a renamed file is refused. */
function sniff(data: string): ImageMediaType | null {
  let head: string;
  try {
    head = atob(data.slice(0, 16));
  } catch {
    return null;
  }
  const bytes = Array.from(head, (c) => c.charCodeAt(0));
  const starts = (sig: number[], at = 0) => sig.every((b, i) => bytes[at + i] === b);
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return 'image/gif';
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** One image as it crosses IPC: base64 without the data-URL prefix. */
export const ImageUploadSchema = z
  .object({
    mediaType: z.enum(IMAGE_TYPES, { message: 'Only PNG, JPEG, GIF and WebP images can be attached.' }),
    // base64 grows bytes by 4/3; anything longer is over the limit before decoding
    data: z.string().min(16, 'The image is empty.').max(Math.ceil(MAX_IMAGE_BYTES / 3) * 4, 'Each image can be at most 5 MB.'),
  })
  .superRefine((value, ctx) => {
    if (value.data.length % 4 !== 0 || !BASE64.test(value.data)) {
      ctx.addIssue({ code: 'custom', path: ['data'], message: 'The image data is not valid base64.' });
      return;
    }
    if (base64Bytes(value.data) > MAX_IMAGE_BYTES) ctx.addIssue({ code: 'custom', path: ['data'], message: 'Each image can be at most 5 MB.' });
    if (sniff(value.data) !== value.mediaType) ctx.addIssue({ code: 'custom', path: ['mediaType'], message: 'The file is not the kind of image it says it is.' });
  });
export type ImageUpload = z.infer<typeof ImageUploadSchema>;

/** What a stored answer carries besides its text: attachment file names and the quoted part it replies to. */
export const ResponseExtrasSchema = z.object({
  attachments: z.array(AttachmentNameSchema).max(MAX_IMAGES, `At most ${MAX_IMAGES} images per answer.`).optional(),
  quote: z.string().trim().min(1).max(MAX_QUOTE_CHARS).optional(),
  /** Python the learner wrote, with the last run of it (design §4.4, "Code"). */
  code: CodeAnswerSchema.optional(),
});
export type ResponseExtras = z.infer<typeof ResponseExtrasSchema>;
