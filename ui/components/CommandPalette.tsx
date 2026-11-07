import { useEffect, useMemo, useRef, useState } from 'react';
import { call } from '../api';
import { rankItems } from '../lib/palette';
import type { PaletteItem } from '../lib/palette';
import { Markdown } from './Markdown';
import './CommandPalette.css';

/** Ideas are searched in the backend once the query is this long. */
const IDEA_QUERY_MIN = 2;

/**
 * One search box for everything (⌘K): places, goals, ideas on the map and the common actions. Arrow
 * keys move, Enter opens, Esc closes. Built on the native `<dialog>` like the sheets.
 */
export function CommandPalette({ items, onRun, onClose }: { items: PaletteItem[]; onRun: (item: PaletteItem) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState('');
  const [ideas, setIdeas] = useState<PaletteItem[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  // ideas come from the map, by name, a moment after typing stops
  useEffect(() => {
    const q = query.trim();
    if (q.length < IDEA_QUERY_MIN) {
      setIdeas([]);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      void call('cards.findIdeas', { query: q }).then((found) => {
        if (!cancelled) setIdeas(found.map((i) => ({ id: `idea:${i.id}`, group: 'Ideas' as const, label: i.name })));
      });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [query]);

  // a question is always one Enter away from Lookup, after whatever matches by name
  const shown = useMemo(() => {
    const q = query.trim();
    const ranked = rankItems([...items, ...ideas], query);
    return q.length >= IDEA_QUERY_MIN ? [...ranked, { id: `ask:${q}`, group: 'Actions' as const, label: `Ask: “${q}”`, hint: 'Look it up in what you have learned' }] : ranked;
  }, [items, ideas, query]);
  const current = Math.min(active, Math.max(0, shown.length - 1));

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  const run = (item: PaletteItem | undefined) => {
    if (!item) return;
    onClose();
    onRun(item);
  };

  return (
    <dialog
      ref={ref}
      className="sheet palette"
      aria-label="Go to or do"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <input
        className="palette-input"
        autoFocus
        placeholder="Go to a place, a goal or an idea, or do something"
        value={query}
        role="combobox"
        aria-expanded="true"
        aria-controls="palette-list"
        aria-activedescendant={shown[current] ? `palette-${shown[current].id}` : undefined}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((current + 1) % Math.max(1, shown.length));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((current - 1 + shown.length) % Math.max(1, shown.length));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            run(shown[current]);
          }
        }}
      />
      {shown.length > 0 ? (
        <ul id="palette-list" ref={listRef} className="palette-list" role="listbox" aria-label="Results">
          {shown.map((item, i) => (
            <li
              key={item.id}
              id={`palette-${item.id}`}
              role="option"
              aria-selected={i === current}
              className="palette-item"
              onMouseMove={() => i !== current && setActive(i)}
              onClick={() => run(item)}
            >
              <span className="palette-label">
                <Markdown text={item.label} inline />
              </span>
              {item.hint && <span className="palette-hint">{item.hint}</span>}
              <span className="palette-group">{item.group === 'Ideas' ? 'Idea' : item.group === 'Goals' ? 'Goal' : item.group === 'Places' ? 'Place' : ''}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="palette-empty">Nothing matches. Try another word, or ask Lookup.</p>
      )}
      <div className="palette-foot">
        <span>
          <kbd>↑</kbd> <kbd>↓</kbd> to move
        </span>
        <span>
          <kbd>↵</kbd> to open
        </span>
        <span>
          <kbd>esc</kbd> to close
        </span>
      </div>
    </dialog>
  );
}
