/**
 * Small PDFs written from scratch, for tests and the screenshot sandbox: pages of text, pages that are
 * one picture (a scan), and pages drawn with lines and boxes (a diagram). Not used by the app itself.
 */

export interface FixturePage {
  /** Lines of text, set from the top of the page. */
  lines?: string[];
  /** A grey picture covering this share of the page (0–1), placed under the text. */
  picture?: number;
  /** Boxes joined by lines, as a diagram drawn in vectors. */
  boxes?: number;
}

const WIDTH = 595;
const HEIGHT = 842;

function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function content(page: FixturePage): string {
  const ops: string[] = [];
  if (page.picture) {
    const side = Math.sqrt(page.picture);
    const w = WIDTH * side;
    const h = HEIGHT * side;
    ops.push(`q ${w.toFixed(1)} 0 0 ${h.toFixed(1)} ${((WIDTH - w) / 2).toFixed(1)} ${((HEIGHT - h) / 2).toFixed(1)} cm /Im1 Do Q`);
  }
  for (let i = 0; i < (page.boxes ?? 0); i += 1) {
    const x = 80 + (i % 4) * 110;
    const y = 200 + Math.floor(i / 4) * 90;
    ops.push(`${x} ${y} 80 50 re S`);
    if (i > 0) ops.push(`${x - 30} ${y + 25} m ${x} ${y + 25} l S`);
  }
  if (page.lines?.length) {
    ops.push('BT /F1 11 Tf 14 TL 60 790 Td');
    page.lines.forEach((line, i) => ops.push(`${i ? 'T* ' : ''}(${escapeText(line)}) Tj`));
    ops.push('ET');
  }
  return ops.join('\n');
}

/** A PDF with these pages. The picture, when a page has one, is an 8 × 8 grey gradient stretched to its size. */
export function fixturePdf(pages: FixturePage[], title?: string): Uint8Array {
  const objects: (string | Uint8Array)[] = [];
  const add = (body: string | Uint8Array) => {
    objects.push(body);
    return objects.length;
  };
  const catalog = add('');
  const pagesId = add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pixels = new Uint8Array(8 * 8 * 3);
  for (let i = 0; i < 64; i += 1) pixels.fill(40 + i * 3, i * 3, i * 3 + 3);
  const image = add(concat(`<< /Type /XObject /Subtype /Image /Width 8 /Height 8 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${pixels.length} >>\nstream\n`, pixels, '\nendstream'));
  const info = title ? add(`<< /Title (${escapeText(title)}) >>`) : null;
  const kids: number[] = [];
  for (const page of pages) {
    const stream = content(page);
    const contents = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${WIDTH} ${HEIGHT}] /Resources << /Font << /F1 ${font} 0 R >> /XObject << /Im1 ${image} 0 R >> >> /Contents ${contents} 0 R >>`));
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

  const parts: Uint8Array[] = [bytes('%PDF-1.4\n')];
  const offsets: number[] = [];
  let length = parts[0]?.length ?? 0;
  objects.forEach((body, i) => {
    offsets.push(length);
    const chunk = concat(`${i + 1} 0 obj\n`, typeof body === 'string' ? bytes(body) : body, '\nendobj\n');
    parts.push(chunk);
    length += chunk.length;
  });
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
  parts.push(bytes(`${xref}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R${info ? ` /Info ${info} 0 R` : ''} >>\nstartxref\n${length}\n%%EOF\n`));
  return concat(...parts);
}

function bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function concat(...pieces: (string | Uint8Array)[]): Uint8Array {
  const arrays = pieces.map((p) => (typeof p === 'string' ? bytes(p) : p));
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let at = 0;
  for (const a of arrays) {
    out.set(a, at);
    at += a.length;
  }
  return out;
}
