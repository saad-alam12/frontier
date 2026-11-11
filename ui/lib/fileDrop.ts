import { useEffect, useRef, useState } from 'react';

/** True when a drag carries files (not text or a link being dragged inside the app). */
function hasFiles(e: DragEvent): boolean {
  return [...(e.dataTransfer?.types ?? [])].includes('Files');
}

/** A place that takes dropped files itself (a goal's material step) keeps them. */
function ownZone(e: DragEvent): boolean {
  return e.target instanceof Element && e.target.closest('.drop-zone') !== null;
}

/**
 * Files dropped anywhere on the window. Returns true while files are dragged over it, for a hint.
 * Without this a dropped file does nothing, or the window tries to open it.
 */
export function useWindowFileDrop(onPaths: (paths: string[]) => void): boolean {
  const [dragging, setDragging] = useState(false);
  const handler = useRef(onPaths);
  handler.current = onPaths;
  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth += 1;
      setDragging(!ownZone(e));
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragging(!ownZone(e));
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      depth = 0;
      setDragging(false);
      if (!hasFiles(e)) return;
      e.preventDefault();
      const paths = [...(e.dataTransfer?.files ?? [])].map((f) => window.frontier.pathForFile(f)).filter(Boolean);
      if (paths.length) handler.current(paths);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);
  return dragging;
}
