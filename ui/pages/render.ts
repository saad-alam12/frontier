/**
 * The page a hidden window loads to make pictures of PDF pages (design §7, "Pages that are pictures"):
 * the browser engine draws the page, the main process asks for it page by page
 * (`backend/render/pagePictures.ts`). It never shows, has no access to the backend and loads nothing
 * from outside the app.
 */
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { pictureScale } from '../../backend/ingest/pictures';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

let task: PDFDocumentLoadingTask | null = null;
let open: PDFDocumentProxy | null = null;

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const api = {
  /** Open a PDF given as base64; returns its number of pages. */
  async open(data: string): Promise<number> {
    await task?.destroy();
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    task = pdfjs.getDocument({ data: bytes, verbosity: 0 });
    open = await task.promise;
    return open.numPages;
  },
  /** One page as a WebP picture, base64, with its size in pixels. */
  async render(pageNumber: number): Promise<{ data: string; width: number; height: number }> {
    if (!open) throw new Error('no document is open');
    const page = await open.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: pictureScale(base.width, base.height) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no drawing surface');
    // a white page, as it is printed: a transparent background would read as black to some readers
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    page.cleanup();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9));
    if (!blob) throw new Error('the picture could not be encoded');
    return { data: await toBase64(blob), width: canvas.width, height: canvas.height };
  },
  async close(): Promise<void> {
    await task?.destroy();
    task = null;
    open = null;
  },
};

(window as unknown as { pagePictures: typeof api }).pagePictures = api;
