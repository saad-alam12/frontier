import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FigureView } from '../../backend/api/contract';
import { call } from '../api';
import { Dialog } from './Dialog';
import { Button } from './controls';
import './Figure.css';

const cache = new Map<string, FigureView>();

/**
 * A picture of a page from the learner's material that the tutor shows (`![caption](figure:ID)` in its
 * text), with its caption and where it is from. Clicking it opens it large.
 */
export function Figure({ figureId, caption }: { figureId: string; caption: string }) {
  const [view, setView] = useState<FigureView | null>(cache.get(figureId) ?? null);
  const [missing, setMissing] = useState(false);
  const [large, setLarge] = useState(false);
  useEffect(() => {
    if (cache.has(figureId)) return;
    let cancelled = false;
    call('figures.read', { figureId }).then(
      (loaded) => {
        cache.set(figureId, loaded);
        if (!cancelled) setView(loaded);
      },
      () => !cancelled && setMissing(true),
    );
    return () => {
      cancelled = true;
    };
  }, [figureId]);
  if (missing) return <span className="figure-missing">{caption ? `${caption} (the figure is no longer in your library)` : 'The figure is no longer in your library.'}</span>;
  if (!view) return <span className="figure figure-loading" aria-hidden="true" />;
  const label = caption || 'Figure';
  return (
    <span className="figure">
      <button type="button" className="figure-picture" onClick={() => setLarge(true)} aria-label={`${label}, open large`}>
        <img src={view.dataUrl} alt={label} width={view.width ?? undefined} height={view.height ?? undefined} />
      </button>
      <span className="figure-caption">
        {caption && <span>{caption}</span>}
        <span className="figure-where">{view.where}</span>
      </span>
      {/* the figure sits inside a paragraph, where a dialog may not: it opens at the top of the page */}
      {createPortal(
        <Dialog open={large} onClose={() => setLarge(false)} title={label} width={Math.min(1100, Math.max(480, (view.width ?? 900) + 48))} actions={<Button onClick={() => setLarge(false)}>Close</Button>}>
          <img className="figure-large" src={view.dataUrl} alt={label} />
          <span className="figure-where">{view.where}</span>
        </Dialog>,
        document.body,
      )}
    </span>
  );
}
