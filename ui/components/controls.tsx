import type { ReactNode } from 'react';

export function Button({
  children,
  onClick,
  kind = 'secondary',
  disabled,
  type = 'button',
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: 'primary' | 'secondary' | 'quiet' | 'danger';
  disabled?: boolean;
  type?: 'button' | 'submit';
  title?: string;
}) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title} className={`btn btn-${kind}`}>
      {children}
    </button>
  );
}

/** Pills where exactly one (or none) is chosen. */
export function ChoiceChips<T extends string>({
  label,
  options,
  value,
  onChange,
  small,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
  /** A quiet toggle for list controls (13 px), not a question to answer. */
  small?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={small ? 'chip-group is-small' : 'chip-group'}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={small ? 'mini-chip' : 'chip'} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <div className="field-hint">{hint}</div>}
    </div>
  );
}

/** One plain sentence and, where useful, one action. */
export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <p className="m-0">{children}</p>
      {action}
    </div>
  );
}

export function Notice({ children, error }: { children: ReactNode; error?: boolean }) {
  return (
    <p className={error ? 'notice is-error m-0' : 'notice m-0'} role={error ? 'alert' : 'status'}>
      {children}
    </p>
  );
}

/** A section in the main column: an 18 px heading with optional metadata on the right. */
export function Section({ title, meta, children, gap = 14, id }: { title: ReactNode; meta?: ReactNode; children: ReactNode; gap?: number; id?: string }) {
  const headingId = id ? `${id}-h` : undefined;
  return (
    <section className="section" style={{ gap }} aria-labelledby={headingId} id={id}>
      <div className="section-head">
        <h2 className="t-heading" id={headingId}>
          {title}
        </h2>
        {meta && <div className="t-small text-muted">{meta}</div>}
      </div>
      {children}
    </section>
  );
}

export function Meter({ value, accent }: { value: number; accent?: boolean }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <span className={accent ? 'meter is-accent' : 'meter'} role="img" aria-label={`${pct} percent`}>
      <span style={{ width: `${pct}%` }} />
    </span>
  );
}

/** Label/value pairs with a fixed label column so the values align. */
export function DefGrid({ rows, wide }: { rows: { label: string; value: ReactNode }[]; wide?: boolean }) {
  return (
    <dl className={wide ? 'def-grid is-wide' : 'def-grid'}>
      {rows.map((r) => (
        <div key={r.label} style={{ display: 'contents' }}>
          <dt>{r.label}</dt>
          <dd>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** `Course · Written exam · 12 February 2027`: muted dots between items. */
export function MetaLine({ items, small }: { items: ReactNode[]; small?: boolean }) {
  const shown = items.filter((i) => i !== null && i !== undefined && i !== false && i !== '');
  return (
    <div className={small ? 'meta-line is-small' : 'meta-line'}>
      {shown.map((item, i) => (
        <span key={i} style={{ display: 'contents' }}>
          {i > 0 && (
            <span className="sep" aria-hidden="true">
              ·
            </span>
          )}
          <span>{item}</span>
        </span>
      ))}
    </div>
  );
}
