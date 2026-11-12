/**
 * Pictures of PDF pages (design §7, "Pages that are pictures"). The app makes them with the browser
 * engine it already ships (a hidden window, `backend/render/pagePictures.ts`); tests use a fake. Each
 * picture is sized for the model to read without scaling it down: at most about 1.15 megapixels and
 * 1,568 pixels on its long side.
 */
import type { ImageMediaType } from '../core/attachments';

export interface PagePicture {
  /** The PDF page it shows, 1-based. */
  page: number;
  mediaType: ImageMediaType;
  bytes: Uint8Array;
  width: number;
  height: number;
}

export interface PageRenderer {
  /** Pictures of these pages of a PDF, in the order asked. */
  render(pdf: Uint8Array, pages: number[]): Promise<PagePicture[]>;
}

const MAX_PIXELS = 1_150_000;
const MAX_SIDE = 1568;

/** The scale from PDF units (1/72 inch) to pixels for a page of this size. Pure. */
export function pictureScale(width: number, height: number): number {
  if (!(width > 0 && height > 0)) return 1;
  return Math.min(MAX_SIDE / Math.max(width, height), Math.sqrt(MAX_PIXELS / (width * height)));
}
