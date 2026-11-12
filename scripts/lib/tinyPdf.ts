/**
 * A tiny valid PDF, for tests and the sandbox: each page is a line of text, or several lines, set in
 * Helvetica with no compression, so its text can be read back and selected.
 */
export function makePdf(pages: (string | string[])[]): Buffer {
  const objs: (string | null)[] = [];
  const add = (s: string | null) => {
    objs.push(s);
    return objs.length;
  };
  const catalog = add(null);
  const pagesObj = add(null);
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids: string[] = [];
  const escape = (text: string) => text.replace(/[()\\]/g, (c) => `\\${c}`);
  for (const page of pages) {
    const lines = typeof page === 'string' ? [page] : page;
    const stream = lines.map((line, i) => `BT /F1 ${i === 0 && lines.length > 1 ? 20 : 12} Tf 72 ${720 - i * 22} Td (${escape(line)}) Tj ET`).join('\n');
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const pageObj = add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`);
    kids.push(`${pageObj} 0 R`);
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
