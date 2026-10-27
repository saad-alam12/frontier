import type { ReactNode } from 'react';

export type PointState = 'done' | 'current' | 'upcoming' | 'milestone';

/**
 * The horizontal step path: spans the column, first point on the left edge, last label ending on the
 * right edge, points evenly spaced, labels left-aligned under their points. Done points can be clicked.
 */
export function StepPath({ steps, label = 'Steps' }: { steps: { key: string; label: string; state: PointState; onClick?: () => void }[]; label?: string }) {
  return (
    <ol className="step-path" aria-label={label}>
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        const inner = (
          <>
            <span className="track" aria-hidden="true">
              <span className={`dot is-${s.state}`} />
              {!last && <span className="connector" />}
            </span>
            <span className="label">{s.label}</span>
          </>
        );
        return (
          <li key={s.key} aria-current={s.state === 'current' ? 'step' : undefined}>
            {s.onClick && s.state === 'done' ? (
              <button type="button" className="step" onClick={s.onClick} title={`Go to ${s.label}`}>
                {inner}
              </button>
            ) : (
              <span className="step">{inner}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** The same points running down: lecture timelines and other sequences. */
export function VerticalPath({ items }: { items: { key: string; state: PointState; children: ReactNode }[] }) {
  return (
    <ol className="v-path">
      {items.map((item, i) => (
        <li key={item.key} aria-current={item.state === 'current' ? 'step' : undefined}>
          <span className="rail" aria-hidden="true">
            <span className={`dot is-${item.state}`} />
            {i < items.length - 1 && <span className="line" />}
          </span>
          <div className="body">{item.children}</div>
        </li>
      ))}
    </ol>
  );
}
