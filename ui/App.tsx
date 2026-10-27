import { useState } from 'react';
import { NavRail, type ScreenName } from './components/Shell';
import { TodayScreen } from './screens/TodayScreen';
import { SessionScreen } from './screens/SessionScreen';
import { MapScreen } from './screens/MapScreen';
import { GoalsScreen } from './screens/GoalsScreen';
import { LookupScreen } from './screens/LookupScreen';
import { TrailsScreen } from './screens/TrailsScreen';
import { LibraryScreen } from './screens/LibraryScreen';
import { SettingsScreen } from './screens/SettingsScreen';

export function App() {
  const [screen, setScreen] = useState<ScreenName>('today');
  return (
    <div className="app">
      <NavRail current={screen} onSelect={setScreen} />
      {screen === 'today' && <TodayScreen onNavigate={setScreen} />}
      {screen === 'session' && <SessionScreen onNavigate={setScreen} />}
      {screen === 'map' && <MapScreen />}
      {screen === 'goals' && <GoalsScreen onNavigate={setScreen} />}
      {screen === 'lookup' && <LookupScreen />}
      {screen === 'trails' && <TrailsScreen />}
      {screen === 'library' && <LibraryScreen />}
      {screen === 'settings' && <SettingsScreen />}
    </div>
  );
}
