import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

interface Tip {
  x: number;
  y: number;
  content: ReactNode;
  /** Centred above the point instead of beside the pointer, so it never covers a row of small targets. */
  above?: boolean;
}

const TIP_WIDTH = 240;
/** Tips above a target carry a short description, so they get a little more room. */
const ABOVE_WIDTH = 288;

/**
 * A frame with a hover tooltip: its measured width (charts draw in real pixels, so text stays at its
 * size), `show` near the pointer, `showAt` beside an element (for keyboard focus), and `layer`, the
 * tooltip to render inside the frame. The frame needs `position: relative`.
 */
export function useTip() {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(280, Math.round(el.clientWidth)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const place = (clientX: number, clientY: number, content: ReactNode, above?: boolean) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setTip({ x: clientX - box.left, y: clientY - box.top, content, above });
  };
  const show = (e: React.PointerEvent, content: ReactNode) => place(e.clientX, e.clientY, content);
  const showAt = (el: Element, content: ReactNode) => {
    const r = el.getBoundingClientRect();
    place(r.right, r.top + r.height / 2, content);
  };
  /** Above an element, centred on it: for dots and other small targets laid out in rows. */
  const showAbove = (el: Element, content: ReactNode) => {
    const r = el.getBoundingClientRect();
    place(r.left + r.width / 2, r.top, content, true);
  };
  const hide = () => setTip(null);
  const frame = ref.current?.clientWidth ?? 400;
  const layer =
    tip &&
    (tip.above ? (
      <div className="tip is-above" style={{ left: Math.max(0, Math.min(tip.x - ABOVE_WIDTH / 2, frame - ABOVE_WIDTH)), top: tip.y - 10, width: ABOVE_WIDTH }}>
        {tip.content}
      </div>
    ) : (
      <div className="tip" style={{ left: Math.max(0, Math.min(tip.x + 12, frame - TIP_WIDTH)), top: Math.max(0, tip.y - 12) }}>
        {tip.content}
      </div>
    ));
  return { ref, show, showAt, showAbove, hide, layer, width };
}
