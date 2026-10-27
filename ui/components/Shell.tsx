import type { ReactNode } from 'react';

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
export function Screen({ children, aside, asideLabel, mainRef }: { children: ReactNode; aside?: ReactNode; asideLabel?: string; mainRef?: React.Ref<HTMLElement> }) {
  return (
    <div className="screen">
      <main className="main-column" ref={mainRef}>
        {children}
      </main>
      {aside && (
        <aside className="side-panel" aria-label={asideLabel}>
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
                <span aria-current="page">{c.label}</span>
              ) : c.onClick ? (
                <button type="button" onClick={c.onClick}>
                  {c.label}
                </button>
              ) : (
                <span className="text-secondary">{c.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
