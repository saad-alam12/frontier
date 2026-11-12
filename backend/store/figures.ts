/**
 * Pages of a source whose meaning is in a picture (design §7). A row exists from the moment the
 * source is split into parts; its picture is made when the source is read, and the extractor adds
 * what it shows and the ideas it shows. Only the ingestion service writes here.
 */
import type { Database } from './db';
import { newId } from './ids';

export interface Figure {
  id: string;
  sourceId: string;
  /** The PDF page the picture is made from. */
  page: number;
  /** Its marker in the source's text (`p12`, or `p10–p12` for slide builds collapsed into one page). */
  locator: string;
  /** The picture's file in the data folder's figures/ directory, once it is made. */
  file: string | null;
  width: number | null;
  height: number | null;
  /** What the page shows, in the extractor's words; null until the page was read. */
  caption: string | null;
}

interface FigureRow {
  id: string;
  source_id: string;
  page: number;
  locator: string;
  file: string | null;
  width: number | null;
  height: number | null;
  caption: string | null;
}

const toFigure = (r: FigureRow): Figure => ({ id: r.id, sourceId: r.source_id, page: r.page, locator: r.locator, file: r.file, width: r.width, height: r.height, caption: r.caption });

/**
 * The source's picture pages are now these: rows for the same page stay (with their picture, so it is
 * not made again), rows for pages that are no longer picture pages go, new pages get a row.
 */
export function syncFigurePages(db: Database, sourceId: string, pages: { page: number; locator: string }[]): void {
  const wanted = new Map(pages.map((p) => [p.page, p.locator]));
  for (const figure of listFigures(db, sourceId)) {
    const locator = wanted.get(figure.page);
    if (locator === undefined) db.prepare('DELETE FROM source_figures WHERE id = ?').run(figure.id);
    else if (locator !== figure.locator) db.prepare('UPDATE source_figures SET locator = ? WHERE id = ?').run(locator, figure.id);
    wanted.delete(figure.page);
  }
  const insert = db.prepare('INSERT INTO source_figures (id, source_id, page, locator) VALUES (?, ?, ?, ?)');
  for (const [page, locator] of wanted) insert.run(newId('fig'), sourceId, page, locator);
}

export function listFigures(db: Database, sourceId: string): Figure[] {
  return (db.prepare('SELECT * FROM source_figures WHERE source_id = ? ORDER BY page').all(sourceId) as unknown as FigureRow[]).map(toFigure);
}

export function getFigure(db: Database, id: string): Figure | null {
  const row = db.prepare('SELECT * FROM source_figures WHERE id = ?').get(id) as FigureRow | undefined;
  return row ? toFigure(row) : null;
}

export function setFigurePicture(db: Database, id: string, picture: { file: string; width: number; height: number }): void {
  db.prepare('UPDATE source_figures SET file = ?, width = ?, height = ? WHERE id = ?').run(picture.file, picture.width, picture.height, id);
}

/** What the extractor said a page shows, and the ideas it shows (they replace what an earlier read said). */
export function describeFigure(db: Database, id: string, caption: string, nodeIds: string[]): void {
  db.prepare('UPDATE source_figures SET caption = ? WHERE id = ?').run(caption, id);
  db.prepare('DELETE FROM figure_ideas WHERE figure_id = ?').run(id);
  const link = db.prepare('INSERT OR IGNORE INTO figure_ideas (figure_id, node_id) VALUES (?, ?)');
  for (const nodeId of nodeIds) link.run(id, nodeId);
}

export interface IdeaFigure extends Figure {
  file: string;
  sourceTitle: string;
}

/** The pictures that show an idea, from its sources, in page order. */
export function figuresForNode(db: Database, nodeId: string): IdeaFigure[] {
  const rows = db
    .prepare(
      `SELECT f.*, s.title AS source_title FROM figure_ideas fi JOIN source_figures f ON f.id = fi.figure_id JOIN sources s ON s.id = f.source_id
       WHERE fi.node_id = ? AND f.file IS NOT NULL ORDER BY s.added_at, f.page`,
    )
    .all(nodeId) as unknown as (FigureRow & { source_title: string })[];
  return rows.map((r) => ({ ...toFigure(r), file: r.file as string, sourceTitle: r.source_title }));
}

/** Every picture file a figure still uses, so removing a source can delete the ones nothing uses. */
export function figureFilesInUse(db: Database): Set<string> {
  return new Set((db.prepare('SELECT DISTINCT file FROM source_figures WHERE file IS NOT NULL').all() as { file: string }[]).map((r) => r.file));
}
