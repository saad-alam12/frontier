/**
 * Pictures of PDF pages, made by the browser engine Electron already ships (no image library is added,
 * so the licence rule holds). A hidden window loads `ui/pages/pages.html`, which draws one page at a
 * time with pdfjs; it lives only while a source's pictures are made. Design §7, "Pages that are pictures".
 */
import { join } from 'node:path';
import { BrowserWindow } from 'electron';
import type { PagePicture, PageRenderer } from '../ingest/pictures';

/** Where the hidden window's page is: the dev server in development, the built file otherwise. */
function pageLocation(): { url: string } | { file: string } {
  const dev = process.env['ELECTRON_RENDERER_URL'];
  return dev ? { url: `${dev}/pages/pages.html` } : { file: join(import.meta.dirname, '../renderer/pages/pages.html') };
}

export class ChromiumPageRenderer implements PageRenderer {
  /** One source at a time: each run opens its own window and closes it. */
  private queue: Promise<unknown> = Promise.resolve();

  render(pdf: Uint8Array, pages: number[]): Promise<PagePicture[]> {
    const run = this.queue.then(() => this.renderNow(pdf, pages));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async renderNow(pdf: Uint8Array, pages: number[]): Promise<PagePicture[]> {
    if (pages.length === 0) return [];
    const window = new BrowserWindow({
      show: false,
      width: 400,
      height: 300,
      // a hidden window is throttled like a background tab unless told otherwise
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    });
    // the page never goes anywhere else and opens nothing
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    try {
      const where = pageLocation();
      await ('url' in where ? window.loadURL(where.url) : window.loadFile(where.file));
      const call = <T>(code: string) => window.webContents.executeJavaScript(code, true) as Promise<T>;
      await call<number>(`window.pagePictures.open(${JSON.stringify(Buffer.from(pdf).toString('base64'))})`);
      const out: PagePicture[] = [];
      for (const page of pages) {
        const picture = await call<{ data: string; width: number; height: number }>(`window.pagePictures.render(${Number(page)})`);
        out.push({ page, mediaType: 'image/webp', bytes: Buffer.from(picture.data, 'base64'), width: picture.width, height: picture.height });
      }
      await call('window.pagePictures.close()');
      return out;
    } finally {
      window.destroy();
    }
  }
}
