/** Read model for a figure the tutor shows (design §4.2, "Figures"). */
import { z } from 'zod';
import type { FigureView } from '../api/contract';
import { attachmentDataUrl } from '../store/attachments';
import type { Database } from '../store/db';
import { getFigure } from '../store/figures';
import { getSource } from '../store/sources';

export const FigureRequestSchema = z.object({ figureId: z.string().regex(/^fig_[a-z0-9]{1,40}$/, 'not a figure') });

export function figureView(db: Database, figuresDir: string, figureId: string): FigureView {
  const figure = getFigure(db, figureId);
  // a source removed from the Library takes its pictures with it
  if (!figure?.file) throw new Error('This figure is no longer in your library.');
  const source = getSource(db, figure.sourceId);
  return { dataUrl: attachmentDataUrl(figuresDir, figure.file), where: `${source?.title ?? 'Source'}, ${figure.locator}`, width: figure.width, height: figure.height };
}
