import { Screen } from '../components/Shell';
import { Empty } from '../components/controls';

export function MapScreen() {
  return (
    <Screen>
      <h1 className="t-display">Map</h1>
      <Empty>The full map of what you know arrives in a later version. The session panel already shows the part around what you are learning.</Empty>
    </Screen>
  );
}
