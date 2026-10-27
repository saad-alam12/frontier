import type { ScreenName } from '../components/Shell';
import { Screen } from '../components/Shell';
import { Button, Empty } from '../components/controls';

export function TodayScreen({ onNavigate }: { onNavigate: (s: ScreenName) => void }) {
  return (
    <Screen>
      <h1 className="t-display">Today</h1>
      <Empty
        action={
          <Button kind="primary" onClick={() => onNavigate('session')}>
            Go to session
          </Button>
        }
      >
        Your daily plan, what is fading and tonight&rsquo;s question arrive with practice. For now, sessions start from a goal.
      </Empty>
    </Screen>
  );
}
