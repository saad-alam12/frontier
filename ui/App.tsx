import { useState } from 'react';
import { Sidebar, type ScreenName } from './components/Sidebar';
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
    <div className="flex h-full">
      <Sidebar current={screen} onSelect={setScreen} />
      <main className="min-w-0 flex-1 overflow-y-auto">
        {screen === 'today' && <TodayScreen />}
        {screen === 'session' && <SessionScreen />}
        {screen === 'map' && <MapScreen />}
        {screen === 'goals' && <GoalsScreen />}
        {screen === 'lookup' && <LookupScreen />}
        {screen === 'trails' && <TrailsScreen />}
        {screen === 'library' && <LibraryScreen />}
        {screen === 'settings' && <SettingsScreen />}
      </main>
    </div>
  );
}
