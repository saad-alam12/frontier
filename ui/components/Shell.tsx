import type { ReactNode } from 'react';
import { ChartNoAxesColumn, Command, GalleryVerticalEnd, History, LibraryBig, Search, Settings, Sun, Target, Waypoints, type LucideIcon } from 'lucide-react';
import { Markdown } from './Markdown';
import { useSessionWork } from '../lib/sessionWork';

export type ScreenName = 'today' | 'session' | 'map' | 'cards' | 'goals' | 'stats' | 'lookup' | 'trails' | 'library' | 'settings';

interface NavEntry {
  name: ScreenName;
  label: string;
  icon: LucideIcon;
  /** Shown on hover: what the place is for, for a learner who has not used it yet. */
  hint: string;
}

/** Where you work. */
const PRIMARY: NavEntry[] = [
  { name: 'today', label: 'Today', icon: Sun, hint: 'What to do now' },
  { name: 'goals', label: 'Goals', icon: Target, hint: 'What you are learning toward, and the time you give it' },
  { name: 'map', label: 'Map', icon: Waypoints, hint: 'Every idea and how they connect' },
  { name: 'cards', label: 'Cards', icon: GalleryVerticalEnd, hint: 'Flashcards for the facts to know by heart' },
  { name: 'stats', label: 'Stats', icon: ChartNoAxesColumn, hint: 'Your time and progress' },
];
/** Where you look back and look things up. */
const SECONDARY: NavEntry[] = [
  { name: 'lookup', label: 'Lookup', icon: Search, hint: 'Ask about anything you have learned' },
  { name: 'trails', label: 'Trails', icon: History, hint: 'Your past sessions, step by step' },
  { name: 'library', label: 'Library', icon: LibraryBig, hint: 'The material your maps are built from' },
];

/**
 * The Frontier mark: what you know (the filled half), what lies beyond (the dashed half), and you,
 * the accent dot, standing on the edge between them.
 */
export function BrandMark({ size = 22, on = 'var(--bg-sidebar)' }: { size?: number; /** The colour behind the mark, so the dot's ring reads as a gap. */ on?: string }) {
  return (
    <svg className="brand-svg" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2a10 10 0 0 0 0 20z" fill="var(--text)" />
      <path d="M12 2a10 10 0 0 1 0 20" fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeDasharray="2.1 2.4" strokeLinecap="round" />
      <circle cx="12" cy="12" r="4" fill={on} />
      <circle cx="12" cy="12" r="2.5" fill="var(--accent)" />
    </svg>
  );
}

/**
 * The sidebar: the mark, a live Session entry while a session is open (or being planned), the places
 * you work in, the places you look back in, and Settings at the bottom.
 */
export function NavRail({
  current,
  onSelect,
  sessionActive,
  counts = {},
  onSearch,
}: {
  current: ScreenName;
  onSelect: (s: ScreenName) => void;
  /** Open the command palette. */
  onSearch: () => void;
  sessionActive: boolean;
  /** A quiet number beside a place: the flashcards to review now. */
  counts?: Partial<Record<ScreenName, number>>;
}) {
  const { work, unseen } = useSessionWork();
  const here = current === 'session';
  // quiet live status: the tutor at work, or a card (or a failed answer) waiting for the learner
  const status = work?.status === 'running' ? 'Thinking…' : unseen && !here ? 'Your turn' : here ? 'Open now' : 'Continue';
  const item = ({ name, label, icon: Icon, hint }: NavEntry) => {
    const count = counts[name] ?? 0;
    return (
      <button key={name} type="button" className="nav-item" aria-current={current === name ? 'page' : undefined} onClick={() => onSelect(name)} title={count ? `${hint} · ${count} to review` : hint}>
        <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
        <span>{label}</span>
        {count > 0 && (
          <span className="nav-count" aria-label={`${count} to review`}>
            {count}
          </span>
        )}
      </button>
    );
  };
  return (
    <nav aria-label="Main" className="nav-rail">
      <div className="nav-titlebar" aria-hidden="true" />
      <div className="brand">
        <BrandMark />
        <span className="brand-name">Frontier</span>
      </div>
      {(sessionActive || work !== null || here) && (
        <button type="button" className="nav-live" aria-current={here ? 'page' : undefined} onClick={() => onSelect('session')} title={work?.status === 'running' ? 'Frontier is working on your session' : 'Your session is open'}>
          <span className="live-dot" aria-hidden="true" />
          <span>Session</span>
          <span className="nav-live-hint" aria-live="polite">
            {status}
          </span>
        </button>
      )}
      <div className="nav-group">
        <button type="button" className="nav-item" onClick={onSearch} title="Go to any place, goal or idea, or do something, by typing">
          <Command size={16} strokeWidth={1.75} aria-hidden="true" />
          <span>Search</span>
          <span className="nav-count" aria-label="Command K">
            ⌘K
          </span>
        </button>
      </div>
      <div className="nav-group">{PRIMARY.map(item)}</div>
      <div className="nav-group">
        <div className="nav-heading">Look back</div>
        {SECONDARY.map(item)}
      </div>
      <div className="nav-spacer" />
      <div className="nav-group">{item({ name: 'settings', label: 'Settings', icon: Settings, hint: 'Models, data and your map' })}</div>
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
