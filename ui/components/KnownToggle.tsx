/**
 * "I already know this material" on a source (R8 E1, design §3.1): a quiet checkbox. Ticked, the ideas
 * the source covers open with a check instead of teaching; it writes nothing about what the learner
 * knows, so it can be ticked and unticked at any time.
 */
export function KnownToggle({ checked, onChange, label = 'I already know this material', hint, disabled }: { checked: boolean; onChange: (known: boolean) => void; label?: string; hint?: string; disabled?: boolean }) {
  return (
    <label className="known-toggle" title={hint ? undefined : 'Its ideas start with a check of how well you know them, instead of teaching from scratch.'}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="flex flex-col gap-[2px]">
        <span>{label}</span>
        {hint && <span className="t-small text-muted">{hint}</span>}
      </span>
    </label>
  );
}
