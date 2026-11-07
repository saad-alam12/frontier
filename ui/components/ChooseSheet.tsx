import { plainError } from '../lib/errors';
import { useEffect, useId, useMemo, useState } from 'react';
import type { FreeChoice, FreePlanView, MakerView, MapState, MapView } from '../../backend/api/contract';
import { MAX_FREE_IDEAS, joinNames } from '../../backend/core/freeSession';
import { call, onEvent } from '../api';
import { useDrafts } from '../hooks/useDrafts';
import { useSessionWork } from '../lib/sessionWork';
import { aimLabel } from '../lib/stages';
import { submitOnModEnter } from './AnswerSurface';
import { Button, Notice } from './controls';
import { Dialog } from './Dialog';
import { Markdown } from './Markdown';
import './ChooseSheet.css';

/** Where the sheet opens: a goal (from a goal's page) and ideas already picked (from the map or a skill). */
export interface ChooseInit {
  goalId?: string | null;
  pick?: string[];
}

type Mode = 'pick' | 'describe';
type Description = { text: string };
const EMPTY_DESCRIPTION: Description = { text: '' };
const DESCRIPTION_KEY = 'choose:description';
/** Rows shown at once; a search finds the rest. */
const LIST_LIMIT = 80;
/** Missing background shown before "more": enough to decide, not a wall of warnings. */
const BACKGROUND_SHOWN = 3;
const STATE_ORDER: Record<MapState, number> = { fringe: 0, beyond: 1, owned: 2 };
const STATE_WORD: Record<MapState | 'new', string> = { fringe: 'Learnable now', beyond: 'Needs something first', owned: 'Yours', new: 'New to your map' };

/**
 * "Choose what to learn" (design §4.5): pick ideas from the map or describe what you want, optionally
 * for a goal, see what the ideas still need and how long it takes, and start. A description goes to the
 * session maker in the background; the sheet can close meanwhile and shows the result when it reopens.
 */
export function ChooseSheet({ init, onClose, onStarted, onOpenSession }: { init: ChooseInit; onClose: () => void; onStarted: () => void; onOpenSession: () => void }) {
  const [map, setMap] = useState<MapView | null>(null);
  const [maker, setMaker] = useState<MakerView | null>(null);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('pick');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<string>(init.goalId ?? 'all');
  const [picked, setPicked] = useState<string[]>(init.pick ?? []);
  const [addFirst, setAddFirst] = useState<string[]>([]);
  const [goalId, setGoalId] = useState<string | null>(init.goalId ?? null);
  const [counted, setCounted] = useState(true);
  const [preview, setPreview] = useState<FreePlanView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [allBackground, setAllBackground] = useState(false);
  const { work } = useSessionWork();
  const drafts = useDrafts<Description>([DESCRIPTION_KEY], EMPTY_DESCRIPTION);
  const description = (drafts.values[DESCRIPTION_KEY] ?? EMPTY_DESCRIPTION).text;
  const ids = { search: useId(), goal: useId(), counted: useId(), describe: useId() };

  useEffect(() => {
    void call('map.view').then(setMap);
    void call('session.current').then((s) => setSessionOpen(s !== null && s.phase !== 'done'));
    void call('session.maker').then((m) => {
      setMaker(m);
      // a description still being made, or made while the sheet was closed, is what the learner came back for
      if (m && m.status !== 'failed' && !init.pick?.length) {
        setMode('describe');
        setGoalId(m.goalId);
      }
    });
    return onEvent('session.maker', ({ maker: m }) => setMaker(m));
  }, [init.pick]);

  const proposalFits = maker?.status === 'ready' && maker.description === description.trim() && maker.goalId === goalId;
  const choice: FreeChoice | null =
    mode === 'pick'
      ? picked.length > 0
        ? { goalId, counted, pick: picked, addFirst }
        : null
      : proposalFits && maker
        ? { goalId, counted, proposalId: maker.id, addFirst }
        : null;
  const choiceKey = JSON.stringify(choice);

  // the plan as it would be, re-read as the choice changes (cheap: no model call)
  useEffect(() => {
    if (!choice) {
      setPreview(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      call('session.freePreview', choice).then(
        (p) => {
          if (!live) return;
          setPreview(p);
          setError(null);
        },
        (e: unknown) => live && setError(plainError(e instanceof Error ? e.message : String(e))),
      );
    }, 120);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // choiceKey stands for the choice's content, which is a new object every render
  }, [choiceKey]);

  const chosen = new Set([...picked, ...addFirst]);
  const toggle = (id: string) => {
    setError(null);
    if (addFirst.includes(id)) setAddFirst(addFirst.filter((x) => x !== id));
    else if (picked.includes(id)) setPicked(picked.filter((x) => x !== id));
    else if (chosen.size >= MAX_FREE_IDEAS) setError(`A session holds up to ${MAX_FREE_IDEAS} ideas.`);
    else setPicked([...picked, id]);
  };
  const switchMode = (next: Mode) => {
    setMode(next);
    setAddFirst([]);
    setError(null);
  };

  const plan = async () => {
    setError(null);
    setAddFirst([]);
    try {
      setMaker(await call('session.make', { description, goalId }));
    } catch (e) {
      setError(plainError(e instanceof Error ? e.message : String(e)));
    }
  };
  const start = async () => {
    if (!choice) return;
    setStarting(true);
    setError(null);
    try {
      await call('session.startFree', choice);
      if (mode === 'describe') drafts.set(DESCRIPTION_KEY, EMPTY_DESCRIPTION);
      onStarted();
    } catch (e) {
      setError(plainError(e instanceof Error ? e.message : String(e)));
      setStarting(false);
    }
  };

  const gaps = groupGaps(preview?.background ?? []);
  const busyElsewhere = sessionOpen || work?.status === 'running';
  if (busyElsewhere) {
    return (
      <Dialog
        open
        onClose={onClose}
        title="Choose what to learn"
        actions={
          <>
            <Button onClick={onClose}>Not now</Button>
            <Button kind="primary" onClick={onOpenSession}>
              Go to the session
            </Button>
          </>
        }
      >
        <p>{sessionOpen ? 'A session is open. Finish or end it first, then choose what to learn next.' : 'A session is being planned. Open it, or wait until it is ready.'}</p>
      </Dialog>
    );
  }

  const making = mode === 'describe' && maker?.status === 'running';
  const canPlan = mode === 'describe' && !proposalFits;
  const ready = preview !== null && choice !== null && !preview.tooMany;
  const primary = canPlan ? (
    <Button kind="primary" onClick={() => void plan()} disabled={making || !description.trim()}>
      {making ? 'Planning…' : 'Plan the session'}
    </Button>
  ) : (
    <Button kind="primary" onClick={() => void start()} disabled={!ready || starting}>
      {starting ? 'Starting…' : 'Start session'}
    </Button>
  );

  return (
    <Dialog
      open
      onClose={onClose}
      width={620}
      title="Choose what to learn"
      actions={
        <>
          <span className="choose-estimate" aria-live="polite">
            {preview && choice ? estimate(preview) : ''}
          </span>
          <Button onClick={onClose}>Cancel</Button>
          {primary}
        </>
      }
    >
      <div className="choose">
        <div role="radiogroup" aria-label="How to choose" className="segmented is-small">
          <button type="button" role="radio" aria-checked={mode === 'pick'} onClick={() => switchMode('pick')}>
            Pick ideas
          </button>
          <button type="button" role="radio" aria-checked={mode === 'describe'} onClick={() => switchMode('describe')}>
            Describe it
          </button>
        </div>

        {mode === 'pick' ? (
          <PickIdeas
            map={map}
            query={query}
            onQuery={setQuery}
            filter={filter}
            onFilter={setFilter}
            chosen={chosen}
            onToggle={toggle}
            searchId={ids.search}
            order={choice && preview ? preview.ideas.map((i) => i.name) : []}
            onClear={() => {
              setPicked([]);
              setAddFirst([]);
            }}
          />
        ) : (
          <div className="choose-describe">
            <label className="choose-label" htmlFor={ids.describe}>
              What do you want to learn?
            </label>
            <textarea
              id={ids.describe}
              className="input choose-textarea"
              rows={3}
              value={description}
              placeholder="For example: how attention lets a language model look back at earlier words"
              onChange={(e) => drafts.set(DESCRIPTION_KEY, { text: e.target.value })}
              onKeyDown={(e) =>
                submitOnModEnter(e, () => {
                  if (canPlan && !making && description.trim()) void plan();
                })
              }
              autoFocus
            />
            {making && (
              <div className="choose-making" role="status">
                <span className="work-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span>Making your session. You can close this; it keeps going.</span>
              </div>
            )}
            {maker?.status === 'failed' && !making && <Notice error>{`The session could not be made: ${maker.error ?? 'unknown error'}`}</Notice>}
            {!making && maker?.status === 'ready' && !proposalFits && description.trim() && <p className="choose-hint">You changed the description or the goal. Plan it again to see the session.</p>}
            {proposalFits && preview && <ProposalView plan={preview} />}
            {!maker && <p className="choose-hint">Frontier turns it into a session of about 45 minutes: ideas from your map where it has them, new ones where it does not.</p>}
          </div>
        )}

        <div className="settings-group">
          <div className="settings-row">
            <label className="settings-label" htmlFor={ids.goal}>
              Goal
            </label>
            <div className="settings-control">
              <select id={ids.goal} className="select-quiet" value={goalId ?? ''} onChange={(e) => setGoalId(e.target.value || null)}>
                <option value="">No goal</option>
                {map?.goals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {goalId && (
            <div className="settings-row">
              <div className="flex flex-col gap-[2px]">
                <label className="settings-label" htmlFor={ids.counted}>
                  Count this in the goal&rsquo;s time
                </label>
                <span className="choose-row-hint">{counted ? 'The time counts as spent on the goal.' : 'The time is free study and leaves the goal’s time alone.'}</span>
              </div>
              <div className="settings-control">
                <button id={ids.counted} type="button" role="switch" aria-checked={counted} className="switch" onClick={() => setCounted(!counted)}>
                  <span className="switch-knob" />
                </button>
              </div>
            </div>
          )}
        </div>

        {preview && choice && gaps.length > 0 && (
          <div className="choose-background" aria-label="Missing background">
            <ul>
              {gaps.slice(0, allBackground ? undefined : BACKGROUND_SHOWN).map((g) => (
                <li key={g.refs.join(' ')}>
                  <span className="choose-background-text">
                    <Markdown text={`${g.neededBy.length ? joinNames(g.neededBy) : 'This session'} ${g.neededBy.length > 1 ? 'build' : 'builds'} on ${joinNames(g.names.map((n) => `**${n}**`))}, which you have not learned yet.`} inline />
                    {g.reason && <span className="choose-row-hint">{g.reason}</span>}
                  </span>
                  <button
                    type="button"
                    className="link-button shrink-0"
                    onClick={() => setAddFirst([...addFirst, ...g.refs])}
                    disabled={chosen.size + g.refs.length > MAX_FREE_IDEAS}
                    title={chosen.size + g.refs.length > MAX_FREE_IDEAS ? `A session holds up to ${MAX_FREE_IDEAS} ideas. Leave one out to make room.` : undefined}
                  >
                    {g.refs.length === 1 ? 'Add it first' : 'Add them first'}
                  </button>
                </li>
              ))}
            </ul>
            {gaps.length > BACKGROUND_SHOWN && !allBackground && (
              <button type="button" className="link-button self-start" onClick={() => setAllBackground(true)}>
                {gaps.length - BACKGROUND_SHOWN} more
              </button>
            )}
            <p className="choose-row-hint">Or start anyway: the tutor explains what it needs as it goes.</p>
          </div>
        )}

        {preview?.tooMany && <Notice error>{`A session holds up to ${MAX_FREE_IDEAS} ideas. Leave some for next time.`}</Notice>}
        {error && <Notice error>{error}</Notice>}
      </div>
    </Dialog>
  );
}

function PickIdeas({
  map,
  query,
  onQuery,
  filter,
  onFilter,
  chosen,
  onToggle,
  onClear,
  searchId,
  order,
}: {
  map: MapView | null;
  query: string;
  onQuery: (q: string) => void;
  filter: string;
  onFilter: (goalId: string) => void;
  chosen: Set<string>;
  onToggle: (id: string) => void;
  onClear: () => void;
  searchId: string;
  /** The chosen ideas in the order they will be taught. */
  order: string[];
}) {
  // ideas chosen when the sheet opened (from the map or a skill) lead the list, so they are in view
  const [pinned] = useState(() => new Set(chosen));
  const shown = useMemo(() => {
    if (!map) return [];
    const q = plain(query).trim();
    const rank = (n: MapView['nodes'][number]) => (pinned.has(n.id) ? -1 : STATE_ORDER[n.state]);
    return map.nodes
      .filter((n) => (filter === 'all' || n.goals.includes(filter)) && (!q || plain(n.name).includes(q)))
      .sort((a, b) => rank(a) - rank(b) || plain(a.name).localeCompare(plain(b.name)));
  }, [map, query, filter, pinned]);
  if (!map) return <div className="choose-list is-loading" />;
  if (map.nodes.length === 0) return <p className="choose-hint">Your map has no ideas yet. Describe what you want to learn instead.</p>;
  return (
    <div className="choose-pick">
      <div className="choose-search">
        <input id={searchId} className="input" type="search" placeholder="Find an idea" aria-label="Find an idea" value={query} onChange={(e) => onQuery(e.target.value)} autoFocus />
        {map.goals.length > 0 && (
          <select className="select-quiet" aria-label="Show ideas of" value={filter} onChange={(e) => onFilter(e.target.value)}>
            <option value="all">All ideas</option>
            {map.goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
        )}
      </div>
      <ul className="choose-list" aria-label="Ideas">
        {shown.slice(0, LIST_LIMIT).map((n) => (
          <li key={n.id}>
            <label className={chosen.has(n.id) ? 'choose-item is-chosen' : 'choose-item'}>
              <input type="checkbox" checked={chosen.has(n.id)} onChange={() => onToggle(n.id)} />
              <Markdown text={n.name} inline className="choose-name" />
              <span className="choose-state">
                <i className={`state-dot is-${n.state}`} aria-hidden="true" />
                {STATE_WORD[n.state]}
              </span>
            </label>
          </li>
        ))}
        {shown.length === 0 && <li className="choose-empty">No idea matches. Try other words, or describe it instead.</li>}
      </ul>
      <div className="choose-count">
        <span>{shown.length > LIST_LIMIT ? `${LIST_LIMIT} of ${shown.length} shown · search to find the rest` : `${shown.length} ${shown.length === 1 ? 'idea' : 'ideas'}`}</span>
        {chosen.size > 0 && (
          <span>
            {chosen.size} chosen ·{' '}
            <button type="button" className="link-button" onClick={onClear}>
              Clear
            </button>
          </span>
        )}
      </div>
      {order.length > 1 && <Markdown text={`In this order: ${order.join(' → ')}`} className="choose-order" />}
    </div>
  );
}

/** The session the session maker made: its title, what it covers, and its ideas with how deep each goes. */
function ProposalView({ plan }: { plan: FreePlanView }) {
  return (
    <div className="choose-proposal">
      <div className="flex flex-col gap-[4px]">
        <Markdown text={plan.title} className="choose-proposal-title" />
        <Markdown text={plan.summary} className="choose-row-hint" />
      </div>
      <ul className="choose-plan">
        {plan.ideas.map((i) => (
          <li key={i.ref}>
            <Markdown text={i.name} inline className="choose-name" />
            {i.state === 'new' && <span className="choose-tag">New</span>}
            <span className="choose-aim">
              {aimLabel(i.aim)} · {i.minutes} min
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Premises the same ideas need, without a reason of their own, read as one sentence with one action. */
function groupGaps(background: FreePlanView['background']): { refs: string[]; names: string[]; neededBy: string[]; reason: string | null }[] {
  const groups = new Map<string, { refs: string[]; names: string[]; neededBy: string[]; reason: string | null }>();
  for (const b of background) {
    const key = b.reason ? `reason:${b.ref}` : `needs:${b.neededBy.join('\n')}`;
    const group = groups.get(key);
    if (group) {
      group.refs.push(b.ref);
      group.names.push(b.name);
    } else groups.set(key, { refs: [b.ref], names: [b.name], neededBy: b.neededBy, reason: b.reason });
  }
  return [...groups.values()];
}

function estimate(plan: FreePlanView): string {
  const m = plan.minutes;
  const time = m < 60 ? `${m} minutes` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
  // a session is about 45 minutes; more is fine, but the learner should know it will take longer
  return `About ${time} · ${plan.ideas.length} ${plan.ideas.length === 1 ? 'idea' : 'ideas'}${m > 75 ? ' · more than one sitting, Pause keeps your place' : ''}`;
}

function plain(name: string): string {
  return name.toLowerCase().replace(/\$/g, '');
}
