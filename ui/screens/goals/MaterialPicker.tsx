import { plainError } from '../../lib/errors';
import { useEffect, useState } from 'react';
import { call } from '../../api';
import type { MaterialRole, SourceSummary } from '../../../backend/api/contract';
import { Button, Notice } from '../../components/controls';
import { ROLE_OPTIONS } from './labels';

export type Material = { sourceId: string; title: string; role: MaterialRole; reason?: string };

/**
 * Files for a goal: dropped or picked files are added to the library unread and their role is guessed
 * from their content; library sources can be added too. Each file's role can be changed.
 */
export function MaterialPicker({ materials, onChange, big }: { materials: Material[]; onChange: (next: Material[]) => void; big?: boolean }) {
  const [library, setLibrary] = useState<SourceSummary[]>([]);
  const [adding, setAdding] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void call('library.list').then((list) => setLibrary(list.filter((s) => s.kind !== 'session')));
  }, []);

  const add = async (pick: () => Promise<Material[]>) => {
    setAdding(true);
    setError(null);
    try {
      const found = await pick();
      onChange([...materials.filter((m) => !found.some((f) => f.sourceId === m.sourceId)), ...found]);
    } catch (e) {
      setError(plainError(e instanceof Error ? e.message : String(e)));
    } finally {
      setAdding(false);
    }
  };
  const unused = library.filter((s) => !materials.some((m) => m.sourceId === s.id));

  return (
    <div
      className={`drop-zone${dragging ? ' is-dragging' : ''}${big ? ' is-big' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const paths = [...e.dataTransfer.files].map((f) => window.frontier.pathForFile(f)).filter(Boolean);
        if (paths.length) void add(() => call('materials.addPaths', { paths }));
      }}
    >
      {big && materials.length === 0 && (
        <div className="drop-hint">
          <span className="drop-icon" aria-hidden="true">
            ↓
          </span>
          <span>Drop PDFs, slides, notes or saved web pages here</span>
        </div>
      )}
      {materials.length > 0 && (
        <ul className="list-card">
          {materials.map((m) => (
            <li key={m.sourceId} className="row items-center" title={m.reason}>
              <span className="min-w-0 truncate">{m.title}</span>
              <span className="flex shrink-0 items-center gap-[12px]">
                <select
                  className={m.role === 'assessment' ? 'role-tag is-accent' : 'role-tag'}
                  aria-label={`Role of ${m.title}`}
                  value={m.role}
                  onChange={(e) => onChange(materials.map((x) => (x.sourceId === m.sourceId ? { ...x, role: e.target.value as MaterialRole } : x)))}
                >
                  {ROLE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <button type="button" className="remove-x" aria-label={`Remove ${m.title}`} onClick={() => onChange(materials.filter((x) => x.sourceId !== m.sourceId))}>
                  ×
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {error && <Notice error>{error}</Notice>}
      <div className="button-row">
        <Button onClick={() => void add(() => call('materials.pick'))} disabled={adding}>
          {adding ? 'Looking at the files…' : 'Add files'}
        </Button>
        {unused.length > 0 && (
          <select
            className="input w-auto max-w-[280px]"
            aria-label="Add from your library"
            value=""
            onChange={(e) => {
              const source = unused.find((s) => s.id === e.target.value);
              if (source) onChange([...materials, { sourceId: source.id, title: source.title, role: 'teaching' }]);
            }}
          >
            <option value="">From your library…</option>
            {unused.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
