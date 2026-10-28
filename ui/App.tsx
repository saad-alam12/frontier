import { useEffect, useState } from 'react';
import { call } from './api';
import { NavRail, type ScreenName } from './components/Shell';
import { startActivityTicker, useSurface } from './lib/activity';
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

  useEffect(() => startActivityTicker(), []);
  useEffect(() => {
    void call('session.current').then((s) => setSessionActive(s !== null && s.phase !== 'done'));
  }, [screen]);
  useSurface(practiceSet && screen === 'today' ? 'practice' : (SURFACE[screen] ?? null), { practiceSetId: screen === 'today' ? practiceSet : null });

  const navigate = (s: ScreenName) => {
    setPracticeSet(null);
    setGoalsView(null);
    setScreen(s);
  };
  const openGoals = (view: GoalsView) => {
    setGoalsView({ view, key: Date.now() });
    setScreen('goals');
  };
  const openTrail = (sessionId: string) => {
    setTrailId(sessionId);
    setScreen('trails');
  };
  return (
    <div className="app">
      <NavRail current={screen} onSelect={navigate} sessionActive={sessionActive} />
      {screen === 'today' && practiceSet && <PracticeScreen key={practiceSet} setId={practiceSet} onBack={() => setPracticeSet(null)} />}
      {screen === 'today' && !practiceSet && <TodayScreen onNavigate={navigate} onOpenGoals={openGoals} onOpenPractice={setPracticeSet} />}
      {screen === 'session' && <SessionScreen onNavigate={navigate} />}
      {screen === 'map' && <MapScreen onOpenTrail={openTrail} />}
      {screen === 'goals' && <GoalsScreen key={goalsView?.key ?? 'goals'} initial={goalsView?.view} onNavigate={navigate} />}
      {screen === 'stats' && <StatsScreen />}
      {screen === 'lookup' && <LookupScreen onOpenTrail={openTrail} />}
      {screen === 'trails' && <TrailsScreen key={trailId ?? 'trails'} initialId={trailId} />}
      {screen === 'library' && <LibraryScreen />}
      {screen === 'settings' && <SettingsScreen />}
    </div>
  );
}
