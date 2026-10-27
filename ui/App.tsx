import { useState } from 'react';
import { NavRail, type ScreenName } from './components/Shell';
import { TodayScreen } from './screens/TodayScreen';
import { SessionScreen } from './screens/SessionScreen';
import { PracticeScreen } from './screens/PracticeScreen';
import { MapScreen } from './screens/MapScreen';
import { GoalsScreen } from './screens/GoalsScreen';
import { LookupScreen } from './screens/LookupScreen';
import { TrailsScreen } from './screens/TrailsScreen';
import { LibraryScreen } from './screens/LibraryScreen';
import { SettingsScreen } from './screens/SettingsScreen';

export function App() {
  const [screen, setScreen] = useState<ScreenName>('today');
  /** A practice set opened from Today; the rail keeps Today selected while it is open. */
  const [practiceSet, setPracticeSet] = useState<string | null>(null);
  const navigate = (s: ScreenName) => {
    setPracticeSet(null);
    setScreen(s);
  };
  return (
    <div className="app">
      <NavRail current={screen} onSelect={navigate} />
      {screen === 'today' && practiceSet && <PracticeScreen key={practiceSet} setId={practiceSet} onBack={() => setPracticeSet(null)} />}
      {screen === 'today' && !practiceSet && <TodayScreen onNavigate={navigate} onOpenPractice={setPracticeSet} />}
      {screen === 'session' && <SessionScreen onNavigate={navigate} />}
      {screen === 'map' && <MapScreen />}
      {screen === 'goals' && <GoalsScreen onNavigate={navigate} />}
      {screen === 'lookup' && <LookupScreen />}
      {screen === 'trails' && <TrailsScreen />}
      {screen === 'library' && <LibraryScreen />}
      {screen === 'settings' && <SettingsScreen />}
    </div>
  );
}
