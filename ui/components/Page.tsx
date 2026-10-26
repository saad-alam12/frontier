import type { ReactNode } from 'react';

export function Page({ title, subtitle, children, actions }: { title: string; subtitle?: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl px-8 py-6">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-stone-600">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
      </header>
      {children}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-stone-300 p-8 text-center text-sm text-stone-500">{children}</div>;
}

export function Button({
  children,
  onClick,
  kind = 'secondary',
  disabled,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  const base = 'rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed ';
  const styles =
    kind === 'primary'
      ? 'bg-stone-900 text-white hover:bg-stone-700'
      : kind === 'danger'
        ? 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200'
        : 'bg-white text-stone-800 border border-stone-300 hover:bg-stone-50';
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={base + styles}>
      {children}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-sm font-medium text-stone-800">{label}</div>
      {children}
      {hint && <div className="mt-1 text-xs text-stone-500">{hint}</div>}
    </label>
  );
}

export const inputClass = 'w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm focus:border-stone-500 focus:outline-none';
