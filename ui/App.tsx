import { useEffect, useState } from 'react';
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
    setPracticeSet(null);
    setGoalsView(null);
    setCardsView(null);
    setMapIdea(null);
    setScreen(s);
  };
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
  return (
    <div className="app">
      <div className="window-drag" aria-hidden="true" />
      <NavRail current={screen} onSelect={navigate} sessionActive={sessionActive} counts={{ cards: cardsDue }} />
      {screen === 'today' && practiceSet && <PracticeScreen key={practiceSet} setId={practiceSet} onBack={() => setPracticeSet(null)} />}
      {screen === 'today' && !practiceSet && <TodayScreen onNavigate={navigate} onOpenGoals={openGoals} onOpenPractice={setPracticeSet} onChoose={openChoose} onOpenCards={() => openCards({ tab: 'review' })} />}
      {screen === 'session' && <SessionScreen onNavigate={navigate} onChoose={openChoose} />}
      {screen === 'map' && <MapScreen key={mapIdea?.key ?? 'map'} initialId={mapIdea?.id ?? null} onOpenTrail={openTrail} onGoDeeper={goDeeper} onChoose={openChoose} />}
      {screen === 'cards' && <CardsScreen key={cardsView?.key ?? 'cards'} initial={cardsView?.view} onShowOnMap={showOnMap} />}
      {screen === 'goals' && <GoalsScreen key={goalsView?.key ?? 'goals'} initial={goalsView?.view} onNavigate={navigate} onGoDeeper={goDeeper} onChoose={openChoose} onReviewCards={(goalId) => openCards({ tab: 'review', goalId })} />}
      {screen === 'stats' && <StatsScreen />}
      {screen === 'lookup' && <LookupScreen onOpenTrail={openTrail} onGoDeeper={goDeeper} />}
      {screen === 'trails' && <TrailsScreen key={trailId ?? 'trails'} initialId={trailId} />}
      {screen === 'library' && <LibraryScreen />}
      {screen === 'settings' && <SettingsScreen />}
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
    </div>
  );
}
