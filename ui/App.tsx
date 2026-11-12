import { Toasts } from './components/Toasts';
import { useWindowFileDrop } from './lib/fileDrop';
import { Fragment, useEffect, useRef, useState } from 'react';
import { call, onEvent } from './api';
import { NavRail, type ScreenName } from './components/Shell';
import { startActivityTicker, useSurface } from './lib/activity';
import { startSessionInBackground, startSessionWork, useSessionWork } from './lib/sessionWork';
import { ChooseSheet, type ChooseInit } from './components/ChooseSheet';
import { TodayScreen } from './screens/TodayScreen';
import { SessionScreen } from './screens/SessionScreen';
import { PracticeScreen } from './screens/PracticeScreen';
import { MapScreen } from './screens/MapScreen';
import { GoalsScreen, type GoalsView } from './screens/GoalsScreen';
import { StatsScreen } from './screens/StatsScreen';
import { LookupScreen } from './screens/LookupScreen';
import { TrailsScreen } from './screens/TrailsScreen';
import { LibraryScreen } from './screens/LibraryScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { CardsScreen, type CardsView } from './screens/CardsScreen';
import { CommandPalette } from './components/CommandPalette';
import { placeForKey, PLACE_SHORTCUTS } from './lib/palette';
import type { PaletteItem } from './lib/palette';
import type { GoalDetail } from '../backend/api/contract';

/** Places in the palette: the sidebar's, with the other words they answer to. */
const PLACES: { name: ScreenName; label: string; hint: string; keywords?: string[] }[] = [
  { name: 'today', label: 'Today', hint: 'What to do now', keywords: ['home', 'start'] },
  { name: 'goals', label: 'Goals', hint: 'What you are learning toward', keywords: ['plans', 'courses'] },
  { name: 'map', label: 'Map', hint: 'Every idea and how they connect', keywords: ['graph', 'ideas'] },
  { name: 'cards', label: 'Cards', hint: 'Flashcards to review', keywords: ['flashcards', 'review', 'memorize'] },
  { name: 'stats', label: 'Stats', hint: 'Your time and progress', keywords: ['progress', 'time'] },
  { name: 'lookup', label: 'Lookup', hint: 'Ask about what you have learned', keywords: ['ask', 'question', 'search'] },
  { name: 'trails', label: 'Trails', hint: 'Your past sessions', keywords: ['history', 'sessions'] },
  { name: 'library', label: 'Library', hint: 'The material your maps come from', keywords: ['sources', 'files', 'pdf'] },
  { name: 'settings', label: 'Settings', hint: 'Models, data and your map', keywords: ['preferences', 'model'] },
];

/** What each screen's time counts as; screens with none are not study. */
const SURFACE: Partial<Record<ScreenName, 'session' | 'map' | 'lookup' | 'reading'>> = { session: 'session', map: 'map', lookup: 'lookup', trails: 'reading', library: 'reading' };

export function App() {
  const [screen, setScreen] = useState<ScreenName>('today');
  /** A practice set opened from Today; the rail keeps Today selected while it is open. */
  const [practiceSet, setPracticeSet] = useState<string | null>(null);
  /** A trail opened from a node card. */
  const [trailId, setTrailId] = useState<string | null>(null);
  /** Where Goals opens when another screen sends you there (a new goal, a draft, a goal page). */
  const [goalsView, setGoalsView] = useState<{ view: GoalsView; key: number } | null>(null);
  const [sessionActive, setSessionActive] = useState(false);
  const { last: lastWork } = useSessionWork();
  /** "Choose what to learn", open over any screen. */
  const [choose, setChoose] = useState<(ChooseInit & { key: number }) | null>(null);
  const openChoose = (init: ChooseInit = {}) => setChoose({ ...init, key: Date.now() });
  /** Where Cards opens when another screen sends you there (Review for one goal). */
  const [cardsView, setCardsView] = useState<{ view: Partial<CardsView>; key: number } | null>(null);
  /** An idea to open on the Map ("Show on map"). */
  const [mapIdea, setMapIdea] = useState<{ id: string; key: number } | null>(null);
  const [cardsDue, setCardsDue] = useState(0);
  /** Bumped when the sidebar's current place is clicked again: the place opens at its top level. */
  const [visit, setVisit] = useState(0);
  /** The command palette (⌘K) and the goals it offers, read when it opens. */
  const [palette, setPalette] = useState(false);
  const [paletteGoals, setPaletteGoals] = useState<GoalDetail[]>([]);
  /** A question asked from the palette, for Lookup to answer. */
  const [lookupQuery, setLookupQuery] = useState<{ query: string; key: number } | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((open) => !open);
        return;
      }
      // ⌘1 to ⌘8 and ⌘, open a place; not while a sheet is open, whose work it would hide
      const place = placeForKey(e.key);
      if (place && !document.querySelector('dialog[open]')) {
        e.preventDefault();
        navigateRef.current(place);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (palette) void call('goals.list').then(setPaletteGoals);
  }, [palette]);

  useEffect(() => {
    startActivityTicker();
    startSessionWork();
  }, []);
  // a session planned in the background opens while the learner is elsewhere
  useEffect(() => {
    void call('session.current').then((s) => setSessionActive(s !== null && s.phase !== 'done'));
  }, [screen, lastWork]);
  useSurface(practiceSet && screen === 'today' ? 'practice' : (SURFACE[screen] ?? null), { practiceSetId: screen === 'today' ? practiceSet : null });
  useEffect(() => {
    const count = () => void call('cards.summary', { goalId: null }).then((s) => setCardsDue(s.toReview));
    count();
    return onEvent('cards.changed', count);
  }, [screen]);

  const navigate = (s: ScreenName) => {
    if (s === screen) setVisit((v) => v + 1);
    setPracticeSet(null);
    setTrailId(null);
    setGoalsView(null);
    setCardsView(null);
    setMapIdea(null);
    setLookupQuery(null);
    setScreen(s);
  };
  // the key handler is set up once; it reaches the current navigate through this ref
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const openCards = (view: Partial<CardsView>) => {
    setCardsView({ view, key: Date.now() });
    setScreen('cards');
  };
  const showOnMap = (nodeId: string) => {
    setMapIdea({ id: nodeId, key: Date.now() });
    setScreen('map');
  };
  const openGoals = (view: GoalsView) => {
    setGoalsView({ view, key: Date.now() });
    setScreen('goals');
  };
  /** Practice lives on Today: a set started elsewhere opens there. */
  const openPractice = (setId: string) => {
    setPracticeSet(setId);
    setScreen('today');
  };
  // files dropped anywhere on the window go to the Library and are read
  const droppingFiles = useWindowFileDrop((paths) => {
    void call('library.addPaths', { paths }).then(
      (result) => {
        if (result.added.length) navigateRef.current('library');
      },
      () => navigateRef.current('library'), // the Library is where adding files can be tried again
    );
  });
  const openTrail = (sessionId: string) => {
    setTrailId(sessionId);
    setScreen('trails');
  };
  /** Go deeper on simplified ideas: their time joins the goal, and a session on them opens. */
  const goDeeper = async (goalId: string, nodeIds?: string[]) => {
    const deeper = await call('goals.goDeeper', { goalId, nodeIds });
    if (deeper.nodeIds.length) startSessionInBackground(goalId, deeper.nodeIds);
    navigate('session');
  };
  const paletteItems: PaletteItem[] = [
    { id: 'do:choose', group: 'Actions', label: 'Choose what to learn', hint: 'Pick ideas or describe a session', keywords: ['learn', 'study', 'free session'] },
    { id: 'do:new-goal', group: 'Actions', label: 'New goal', hint: 'Say what you want to learn', keywords: ['add goal', 'create'] },
    { id: 'do:review', group: 'Actions', label: 'Review flashcards', hint: 'The cards due now', keywords: ['cards'] },
    ...(sessionActive ? [{ id: 'place:session', group: 'Places' as const, label: 'Session', hint: 'Your open session', keywords: ['continue'] }] : []),
    ...PLACES.map((p) => {
      const n = PLACE_SHORTCUTS.indexOf(p.name as (typeof PLACE_SHORTCUTS)[number]);
      const key = p.name === 'settings' ? '⌘,' : n >= 0 ? `⌘${n + 1}` : null;
      return { id: `place:${p.name}`, group: 'Places' as const, label: p.label, hint: key ? `${p.hint} · ${key}` : p.hint, keywords: p.keywords };
    }),
    ...paletteGoals.map((g) => ({ id: `goal:${g.goal.id}`, group: 'Goals' as const, label: g.goal.title ?? g.goal.text, hint: g.goal.status === 'draft' ? 'Plan waiting for you' : g.goal.text, keywords: [g.goal.text] })),
  ];
  const runPalette = (item: PaletteItem) => {
    const [kind, ...rest] = item.id.split(':');
    const id = rest.join(':');
    if (kind === 'place') navigate(id as ScreenName);
    else if (kind === 'goal') {
      const draft = paletteGoals.find((g) => g.goal.id === id)?.goal.status === 'draft';
      openGoals(draft ? { name: 'draft', goalId: id } : { name: 'goal', goalId: id });
    } else if (kind === 'idea') showOnMap(id);
    else if (kind === 'ask') {
      setLookupQuery({ query: id, key: Date.now() });
      setScreen('lookup');
    }
    else if (id === 'choose') openChoose();
    else if (id === 'new-goal') openGoals({ name: 'new' });
    else if (id === 'review') openCards({ tab: 'review' });
  };
  return (
    <div className="app">
      <div className="window-drag" aria-hidden="true" />
      <NavRail current={screen} onSelect={navigate} sessionActive={sessionActive} counts={{ cards: cardsDue }} onSearch={() => setPalette(true)} />
      {palette && <CommandPalette items={paletteItems} onRun={runPalette} onClose={() => setPalette(false)} />}
      <Fragment key={visit}>
        {screen === 'today' && practiceSet && <PracticeScreen key={practiceSet} setId={practiceSet} onBack={() => setPracticeSet(null)} />}
        {screen === 'today' && !practiceSet && <TodayScreen onNavigate={navigate} onOpenGoals={openGoals} onOpenPractice={setPracticeSet} onChoose={openChoose} onOpenCards={() => openCards({ tab: 'review' })} />}
        {screen === 'session' && <SessionScreen onNavigate={navigate} onChoose={openChoose} />}
        {screen === 'map' && <MapScreen key={mapIdea?.key ?? 'map'} initialId={mapIdea?.id ?? null} onOpenTrail={openTrail} onGoDeeper={goDeeper} onChoose={openChoose} />}
        {screen === 'cards' && <CardsScreen key={cardsView?.key ?? 'cards'} initial={cardsView?.view} onShowOnMap={showOnMap} />}
        {screen === 'goals' && <GoalsScreen key={goalsView?.key ?? 'goals'} initial={goalsView?.view} onNavigate={navigate} onGoDeeper={goDeeper} onChoose={openChoose} onReviewCards={(goalId) => openCards({ tab: 'review', goalId })} onOpenPractice={openPractice} />}
        {screen === 'stats' && (
          <StatsScreen
            actions={{
              onOpenGoal: (goalId) => openGoals({ name: 'goal', goalId }),
              onTestMe: (nodeIds) => openChoose({ pick: nodeIds, testMe: true }),
              onToday: () => navigate('today'),
              onOpenPractice: openPractice,
              onShowOnMap: showOnMap,
            }}
          />
        )}
        {screen === 'lookup' && <LookupScreen key={lookupQuery?.key ?? 'lookup'} initialQuery={lookupQuery?.query} onOpenTrail={openTrail} onGoDeeper={goDeeper} />}
        {screen === 'trails' && <TrailsScreen key={trailId ?? 'trails'} initialId={trailId} />}
        {screen === 'library' && <LibraryScreen />}
        {screen === 'settings' && <SettingsScreen />}
      </Fragment>
      {choose && (
        <ChooseSheet
          key={choose.key}
          init={choose}
          onClose={() => setChoose(null)}
          onStarted={() => {
            setChoose(null);
            navigate('session');
          }}
          onOpenSession={() => {
            setChoose(null);
            navigate('session');
          }}
        />
      )}
      {droppingFiles && (
        <div className="drop-overlay" aria-hidden="true">
          <span>Drop to add to your library</span>
        </div>
      )}
      <Toasts />
    </div>
  );
}
