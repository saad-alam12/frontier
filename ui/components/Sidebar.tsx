export type ScreenName = 'today' | 'session' | 'map' | 'goals' | 'lookup' | 'trails' | 'library' | 'settings';

const ITEMS: { name: ScreenName; label: string }[] = [
  { name: 'today', label: 'Today' },
  { name: 'session', label: 'Session' },
  { name: 'map', label: 'Map' },
  { name: 'goals', label: 'Goals' },
  { name: 'lookup', label: 'Lookup' },
  { name: 'trails', label: 'Trails' },
  { name: 'library', label: 'Library' },
  { name: 'settings', label: 'Settings' },
];

export function Sidebar({ current, onSelect }: { current: ScreenName; onSelect: (s: ScreenName) => void }) {
  return (
    <nav className="flex w-48 shrink-0 flex-col border-r border-stone-200 bg-white">
      <div className="px-4 py-4 text-lg font-semibold tracking-tight">Frontier</div>
      <ul className="flex-1">
        {ITEMS.map((item) => (
          <li key={item.name}>
            <button
              type="button"
              onClick={() => onSelect(item.name)}
              className={
                'w-full px-4 py-2 text-left text-sm ' +
                (current === item.name ? 'bg-stone-100 font-medium text-stone-900' : 'text-stone-600 hover:bg-stone-50')
              }
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
