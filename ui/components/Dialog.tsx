import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from './controls';

/**
 * A modal sheet built on the native `<dialog>`: `showModal()` gives focus trapping, Esc to close
 * and an inert background for free, so no focus-trap library is needed.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  actions,
  width = 440,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children?: ReactNode;
  /** The button row, right-aligned; the primary action goes last. */
  actions: ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="sheet"
      style={{ width }}
      aria-labelledby={titleId}
      // Esc fires `cancel`; route it through onClose so React state stays the source of truth.
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // A click on the backdrop lands on the dialog element itself, never on its children.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <div className="sheet-body">
          <h2 className="sheet-title" id={titleId}>
            {title}
          </h2>
          {children && <div className="sheet-text">{children}</div>}
          <div className="sheet-actions">{actions}</div>
        </div>
      )}
    </dialog>
  );
}

/**
 * Asks before something happens. With `typeToConfirm`, the confirm button stays disabled until
 * that word is typed, for actions that cannot be undone (erasing data).
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive,
  typeToConfirm,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: ReactNode;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  typeToConfirm?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState('');
  const inputId = useId();
  useEffect(() => {
    if (!open) setTyped('');
  }, [open]);
  const ready = !busy && (!typeToConfirm || typed.trim().toLowerCase() === typeToConfirm.toLowerCase());
  return (
    <Dialog
      open={open}
      onClose={() => !busy && onCancel()}
      title={title}
      actions={
        <>
          <Button kind="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button kind={destructive ? 'danger' : 'primary'} onClick={onConfirm} disabled={!ready}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
      {typeToConfirm && (
        <div className="field mt-[18px]">
          <label className="field-label" htmlFor={inputId}>
            Type <strong className="font-medium text-text">{typeToConfirm}</strong> to confirm
          </label>
          <input
            id={inputId}
            className="input"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && ready) onConfirm();
            }}
          />
        </div>
      )}
    </Dialog>
  );
}
