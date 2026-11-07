import { useState } from 'react';
import type { ReactNode } from 'react';
import type { MapState, MapView } from '../../backend/api/contract';
import { DEFAULT_SETTINGS } from '../lib/mapGraph';
import type { ColorBy, MapSettings } from '../lib/mapGraph';

const STATES: { value: MapState; label: string }[] = [
  { value: 'owned', label: 'Yours' },
  { value: 'fringe', label: 'Learnable now' },
  { value: 'beyond', label: 'Beyond your edge' },
];

const COLOR_BY: { value: ColorBy; label: string }[] = [
  { value: 'state', label: 'Your edge' },
  { value: 'goal', label: 'Goal' },
  { value: 'topic', label: 'Topic' },
  { value: 'depth', label: 'Depth' },
];

/**
 * How the map is shown, in four folding groups like Obsidian's graph settings: what to show, how to
 * colour it, how it looks, and the forces that lay it out. Every change applies at once.
 */
export function MapViewPanel({ view, settings, onChange }: { view: MapView; settings: MapSettings; onChange: (s: MapSettings) => void }) {
  const set = (patch: Partial<MapSettings>) => onChange({ ...settings, ...patch });
  return (
    <div className="map-panel" role="region" aria-label="View settings">
      <Group title="Filters" open>
        <div className="toggle-row" role="group" aria-label="Show">
          {STATES.map((s) => (
            <Toggle key={s.value} on={settings.show[s.value]} onClick={() => set({ show: { ...settings.show, [s.value]: !settings.show[s.value] } })}>
              {s.label}
            </Toggle>
          ))}
        </div>
        {view.goals.length > 0 && (
          <label className="panel-field">
            <span>Goal</span>
            <select className="input panel-select" value={settings.goalId ?? ''} onChange={(e) => set({ goalId: e.target.value || null })}>
              <option value="">Everything</option>
              {view.goals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="toggle-row">
          <Toggle on={settings.simplifiedOnly} onClick={() => set({ simplifiedOnly: !settings.simplifiedOnly })}>
            Only simplified ideas
          </Toggle>
          <Toggle on={settings.cardsOnly} onClick={() => set({ cardsOnly: !settings.cardsOnly })}>
            Only ideas with flashcards
          </Toggle>
          <Toggle on={settings.hideLoose} onClick={() => set({ hideLoose: !settings.hideLoose })}>
            Hide ideas with no links
          </Toggle>
        </div>
      </Group>
      <Group title="Colour">
        <div className="toggle-row" role="radiogroup" aria-label="Colour by">
          {COLOR_BY.map((c) => (
            <button key={c.value} type="button" role="radio" aria-checked={settings.colorBy === c.value} className="mini-chip" onClick={() => set({ colorBy: c.value })}>
              {c.label}
            </button>
          ))}
        </div>
      </Group>
      <Group title="Display">
        <Slider label="Labels from zoom" min={0.3} max={2} step={0.05} value={settings.labelZoom} onChange={(labelZoom) => set({ labelZoom })} />
        <Slider label="Idea size" min={0.5} max={2} step={0.05} value={settings.nodeSize} onChange={(nodeSize) => set({ nodeSize })} />
        <Slider label="Link thickness" min={0.5} max={3} step={0.1} value={settings.linkWidth} onChange={(linkWidth) => set({ linkWidth })} />
        <div className="toggle-row">
          <Toggle on={settings.arrows} onClick={() => set({ arrows: !settings.arrows })}>
            Arrows
          </Toggle>
        </div>
      </Group>
      <Group title="Forces">
        <div className="toggle-row">
          <Toggle on={settings.flow} onClick={() => set({ flow: !settings.flow })}>
            Prerequisites left to right
          </Toggle>
        </div>
        <Slider label="Centre" min={0} max={1} step={0.01} value={settings.center} onChange={(center) => set({ center })} />
        <Slider label="Repel" min={0} max={1} step={0.01} value={settings.repel} onChange={(repel) => set({ repel })} />
        <Slider label="Link strength" min={0} max={1} step={0.01} value={settings.linkStrength} onChange={(linkStrength) => set({ linkStrength })} />
        <Slider label="Link distance" min={20} max={200} step={1} value={settings.linkDistance} onChange={(linkDistance) => set({ linkDistance })} />
      </Group>
      <button type="button" className="link-button self-start" onClick={() => onChange(DEFAULT_SETTINGS)}>
        Reset to defaults
      </button>
    </div>
  );
}

function Group({ title, open: initial, children }: { title: string; open?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(initial ?? false);
  return (
    <section className="panel-group">
      <button type="button" className="panel-group-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={open ? 'chevron is-open' : 'chevron'} aria-hidden="true" />
        {title}
      </button>
      {open && <div className="panel-group-body">{children}</div>}
    </section>
  );
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" role="switch" aria-checked={on} className={on ? 'mini-chip is-on' : 'mini-chip'} onClick={onClick}>
      {children}
    </button>
  );
}

function Slider({ label, min, max, step, value, onChange }: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <label className="panel-field">
      <span>{label}</span>
      <input type="range" className="time-slider" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}
