/**
 * What a PDF page is made of, from its drawing operations: how much of it pictures cover and how much
 * is drawn with lines and shapes (a diagram, a plot, a formula set as paths). Pure: the operator list
 * comes from pdfjs, the decision is made here (design §7, "Pages that are pictures").
 */

/** The pdfjs operator codes this module reads (`pdfjs.OPS`), passed in so the module stays pure. */
export interface OpCodes {
  save: number;
  restore: number;
  transform: number;
  paintFormXObjectBegin: number;
  paintFormXObjectEnd: number;
  paintImageXObject: number;
  paintInlineImageXObject: number;
  paintImageMaskXObject: number;
  paintImageXObjectRepeat: number;
  constructPath: number;
}

export interface PageMeasure {
  /** Characters of text on the page. */
  textChars: number;
  /** Share of the page that pictures cover (0–1; overlapping pictures count twice, capped at 1). */
  imageShare: number;
  /** Shapes drawn with paths (each filled or stroked path counts once). */
  shapes: number;
  /** Share of the page inside the box around all drawn shapes (0–1). */
  shapeShare: number;
}

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m: Matrix, n: Matrix): Matrix {
  // n applied first, then m (PDF's `cm` pre-multiplies the current matrix)
  return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function asMatrix(value: unknown): Matrix | null {
  if (!value || typeof value !== 'object' || !('length' in value)) return null;
  const list = Array.from(value as ArrayLike<unknown>);
  if (list.length !== 6 || !list.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  return list as Matrix;
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** The box around a local rectangle after a transform, clipped to the page. */
function boxOf(m: Matrix, x0: number, y0: number, x1: number, y1: number, page: Box): Box | null {
  const corners = [apply(m, x0, y0), apply(m, x1, y0), apply(m, x0, y1), apply(m, x1, y1)];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const box = { minX: Math.max(page.minX, Math.min(...xs)), minY: Math.max(page.minY, Math.min(...ys)), maxX: Math.min(page.maxX, Math.max(...xs)), maxY: Math.min(page.maxY, Math.max(...ys)) };
  return box.maxX > box.minX && box.maxY > box.minY ? box : null;
}

const area = (b: Box) => (b.maxX - b.minX) * (b.maxY - b.minY);

/**
 * Measure a page from its operator list (`page.getOperatorList()`): `view` is the page's box in PDF
 * units ([x0, y0, x1, y1]). Pictures are the unit square under the current transform; shapes are the
 * box pdfjs gives each path, under the same transform.
 */
export function measureOperators(fnArray: ArrayLike<number>, argsArray: ArrayLike<unknown>, ops: OpCodes, view: number[], textChars: number): PageMeasure {
  const page: Box = { minX: Math.min(view[0] ?? 0, view[2] ?? 0), minY: Math.min(view[1] ?? 0, view[3] ?? 0), maxX: Math.max(view[0] ?? 0, view[2] ?? 0), maxY: Math.max(view[1] ?? 0, view[3] ?? 0) };
  const pageArea = area(page) || 1;
  const images = new Set([ops.paintImageXObject, ops.paintInlineImageXObject, ops.paintImageMaskXObject, ops.paintImageXObjectRepeat]);
  const stack: Matrix[] = [];
  let ctm: Matrix = IDENTITY;
  let imageArea = 0;
  let shapes = 0;
  let drawn: Box | null = null;
  for (let i = 0; i < fnArray.length; i += 1) {
    const fn = fnArray[i];
    const args = argsArray[i] as unknown[] | null | undefined;
    if (fn === ops.save) stack.push(ctm);
    else if (fn === ops.restore) ctm = stack.pop() ?? IDENTITY;
    else if (fn === ops.transform) {
      const m = asMatrix(args);
      if (m) ctm = multiply(ctm, m);
    } else if (fn === ops.paintFormXObjectBegin) {
      stack.push(ctm);
      const m = asMatrix(args?.[0]);
      if (m) ctm = multiply(ctm, m);
    } else if (fn === ops.paintFormXObjectEnd) ctm = stack.pop() ?? IDENTITY;
    else if (fn !== undefined && images.has(fn)) {
      const box = boxOf(ctm, 0, 0, 1, 1, page);
      if (box) imageArea += area(box);
    } else if (fn === ops.constructPath) {
      const minMax = args?.[2];
      const b = minMax && typeof minMax === 'object' && 'length' in minMax ? Array.from(minMax as ArrayLike<number>) : [];
      if (b.length !== 4 || !b.every(Number.isFinite)) continue;
      const box = boxOf(ctm, b[0] as number, b[1] as number, b[2] as number, b[3] as number, page) ?? boxOf(ctm, (b[0] as number) - 0.5, (b[1] as number) - 0.5, (b[2] as number) + 0.5, (b[3] as number) + 0.5, page);
      if (!box) continue;
      shapes += 1;
      drawn = drawn ? { minX: Math.min(drawn.minX, box.minX), minY: Math.min(drawn.minY, box.minY), maxX: Math.max(drawn.maxX, box.maxX), maxY: Math.max(drawn.maxY, box.maxY) } : box;
    }
  }
  return { textChars, imageShare: Math.min(1, imageArea / pageArea), shapes, shapeShare: drawn ? area(drawn) / pageArea : 0 };
}

/**
 * Pages whose meaning is in a picture: a scan, a slide that is mostly a diagram, a paper's page with a
 * large figure. Such a page goes to the extractor as a picture as well as its text, and the picture is
 * kept for the tutor to show. A page of plain text, or a title with a small logo, is not one.
 */
export function isPicturePage(m: PageMeasure): boolean {
  const figure = m.imageShare >= 0.05 || (m.shapes >= 4 && m.shapeShare >= 0.1);
  const mostlyFigure = m.imageShare >= 0.35 || (m.shapes >= 12 && m.shapeShare >= 0.25);
  // little text: the picture is what the page says
  if (m.textChars < 250) return figure;
  // a page of text with a large figure; a page dense with text says it in words
  return mostlyFigure && m.textChars < 3000;
}
