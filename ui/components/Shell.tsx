import type { ReactNode } from 'react';
import { Markdown } from './Markdown';

export type ScreenName = 'today' | 'session' | 'map' | 'goals' | 'stats' | 'lookup' | 'trails' | 'library' | 'settings';

/** Where you work, then the places you go to look things up. */
const PRIMARY: { name: ScreenName; label: string }[] = [
  { name: 'today', label: 'Today' },
  { name: 'goals', label: 'Goals' },
  { name: 'map', label: 'Map' },
  { name: 'stats', label: 'Stats' },
];
const SECONDARY: { name: ScreenName; label: string }[] = [
  { name: 'lookup', label: 'Lookup' },
  { name: 'trails', label: 'Trails' },
  { name: 'library', label: 'Library' },
];

/**
 * The 96 px left rail: brand mark, a live Session entry while a session is open, the four places
 * you work in, the three you look things up in, and Settings at the bottom.
 */
export function NavRail({ current, onSelect, sessionActive }: { current: ScreenName; onSelect: (s: ScreenName) => void; sessionActive: boolean }) {
  const item = (name: ScreenName, label: string, small?: boolean) => (
    <button key={name} type="button" className={small ? 'nav-item is-small' : 'nav-item'} aria-current={current === name ? 'page' : undefined} onClick={() => onSelect(name)}>
      {label}
    </button>
  );
  return (
    <nav aria-label="Main" className="nav-rail">
      <div className="brand-mark" aria-hidden="true">
        <span />
      </div>
      {(sessionActive || current === 'session') && (
        <button type="button" className="nav-live" aria-current={current === 'session' ? 'page' : undefined} onClick={() => onSelect('session')} title="Your session is open">
          <span className="live-dot" aria-hidden="true" />
          Session
        </button>
      )}
      {PRIMARY.map((i) => item(i.name, i.label))}
      <div className="nav-divider" aria-hidden="true" />
      {SECONDARY.map((i) => item(i.name, i.label, true))}
      <div className="nav-spacer" />
      {item('settings', 'Settings', true)}
    </nav>
  );
}

/** A screen: the main column (content max 720 px, left-aligned) and an optional right panel. */
export function Screen({
  children,
  aside,
  asideLabel,
  asideGap = 28,
  wide,
  mainRef,
}: {
  children: ReactNode;
  aside?: ReactNode;
  asideLabel?: string;
  /** 22 for the session's map panel, 28 elsewhere (visual-design §4). */
  asideGap?: 22 | 28;
  /** Stats and the goal wizard use the full width. */
  wide?: boolean;
  mainRef?: React.Ref<HTMLElement>;
}) {
  return (
    <div className="screen">
      <main className={wide ? 'main-column is-wide' : 'main-column'} ref={mainRef}>
        {children}
      </main>
      {aside && (
        <aside className="side-panel" aria-label={asideLabel} style={{ gap: asideGap }}>
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
