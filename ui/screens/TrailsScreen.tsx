import { Screen } from '../components/Shell';
import { Empty } from '../components/controls';

export function TrailsScreen() {
  return (
    <Screen>
      <h1 className="t-display">Trails</h1>
      <Empty>Replaying past sessions arrives in a later version. Every session is already recorded.</Empty>
    </Screen>
  );
}
