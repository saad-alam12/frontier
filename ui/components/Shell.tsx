import type { ReactNode } from 'react';
import { Markdown } from './Markdown';

export type ScreenName = 'today' | 'session' | 'map' | 'goals' | 'lookup' | 'trails' | 'library' | 'settings';

const ITEMS: { name: ScreenName; label: string }[] = [
  { name: 'today', label: 'Today' },
  { name: 'session', label: 'Session' },
  { name: 'map', label: 'Map' },
  { name: 'goals', label: 'Goals' },
  { name: 'lookup', label: 'Lookup' },
  { name: 'trails', label: 'Trails' },
  { name: 'library', label: 'Library' },
];

/** The 96 px left rail: brand mark, the seven screens, Settings at the bottom. */
export function NavRail({ current, onSelect }: { current: ScreenName; onSelect: (s: ScreenName) => void }) {
  const item = (name: ScreenName, label: string) => (
    <button key={name} type="button" className="nav-item" aria-current={current === name ? 'page' : undefined} onClick={() => onSelect(name)}>
      {label}
    </button>
  );
  return (
    <nav aria-label="Main" className="nav-rail">
      <div className="brand-mark" aria-hidden="true">
        <span />
      </div>
      {ITEMS.map((i) => item(i.name, i.label))}
      <div className="nav-spacer" />
      {item('settings', 'Settings')}
    </nav>
  );
}

/** A screen: the main column (content max 720 px, left-aligned) and an optional right panel. */
export function Screen({
  children,
  aside,
  asideLabel,
  asideGap = 28,
  asideNarrow,
  mainRef,
}: {
  children: ReactNode;
  aside?: ReactNode;
  asideLabel?: string;
  /** 22 for the session's map panel, 28 elsewhere (visual-design §4). */
  asideGap?: 22 | 28;
  /** The Map gives the canvas the room: a 400 px panel. */
  asideNarrow?: boolean;
  mainRef?: React.Ref<HTMLElement>;
}) {
  return (
    <div className="screen">
      <main className="main-column" ref={mainRef}>
        {children}
      </main>
      {aside && (
        <aside className={asideNarrow ? 'side-panel is-narrow' : 'side-panel'} aria-label={asideLabel} style={{ gap: asideGap }}>
          {aside}
        </aside>
      )}
    </div>
  );
}

export interface Crumb {
  label: string;
  onClick?: () => void;
}

/** `Course / Lecture 5 / Idea`: earlier items clickable, the last one is the current page. */
export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="breadcrumb">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${i}-${c.label}`} style={{ display: 'contents' }}>
              {i > 0 && (
                <span className="sep" aria-hidden="true">
                  /
                </span>
              )}
              {last ? (
                <span aria-current="page">
                  <Markdown text={c.label} inline />
                </span>
              ) : c.onClick ? (
                <button type="button" onClick={c.onClick}>
                  <Markdown text={c.label} inline />
                </button>
              ) : (
                <span className="text-secondary">
                  <Markdown text={c.label} inline />
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
