import { useEffect, useState, useSyncExternalStore } from 'react';
import { call } from '../api';
import type { LearnerResponse } from '../../backend/api/contract';
import { IMAGE_TYPES, MAX_IMAGES, MAX_IMAGE_BYTES } from '../../backend/core/attachments';
import type { ImageMediaType } from '../../backend/core/attachments';
import { Markdown } from './Markdown';
import './AnswerExtras.css';

/**
 * Images and a quoted reply that ride along with a session answer. They live in a small module store
 * rather than in the answer step's state because the step unmounts while the tutor works, and Esc
 * must hand the answer back with its images and quote intact. Images are saved to the backend as
 * soon as they are attached, so a response only carries their file names.
 */
interface AttachedImage {
  name: string;
  url: string;
}

interface ExtrasState {
  images: AttachedImage[];
  quote: string | null;
  /** A plain message after an image was refused. */
  notice: string | null;
  /** How many answer boxes accept extras right now; the Reply pill shows only when one does. */
  targets: number;
  /** Bumped when a quote is set, so the answer box can take focus. */
  quoteVersion: number;
}

let state: ExtrasState = { images: [], quote: null, notice: null, targets: 0, quoteVersion: 0 };
const listeners = new Set<() => void>();
/** Data URLs by file name: thumbnails just attached need no round trip, older ones load once. */
const urlCache = new Map<string, string>();

function update(patch: Partial<ExtrasState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAnswerExtras(): ExtrasState {
  return useSyncExternalStore(subscribe, () => state);
}

export function setQuote(text: string): void {
  update({ quote: text, quoteVersion: state.quoteVersion + 1 });
}

export function clearQuote(): void {
  update({ quote: null });
}

/** After an answer was accepted: the next answer starts without images or a quote. */
export function clearAnswerExtras(): void {
  update({ images: [], quote: null, notice: null });
}

/** Add the pending images and quote to a response, leaving it unchanged when there are none. */
export function withExtras(response: LearnerResponse, extras: ExtrasState): LearnerResponse {
  return {
    ...response,
    ...(extras.images.length ? { attachments: extras.images.map((i) => i.name) } : {}),
    ...(extras.quote ? { quote: extras.quote } : {}),
  };
}

/** Register an answer box that accepts extras while it is mounted. */
export function useExtrasTarget(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    update({ targets: state.targets + 1 });
    return () => update({ targets: state.targets - 1 });
  }, [enabled]);
}

const TYPE_SET: ReadonlySet<string> = new Set(IMAGE_TYPES);

/** Check, read and save files one by one; the first refusal is shown and the rest still go through. */
export async function addImageFiles(files: File[]): Promise<void> {
  let notice: string | null = null;
  for (const file of files) {
    if (!TYPE_SET.has(file.type)) {
      notice = 'Only PNG, JPEG, GIF and WebP images can be attached.';
      continue;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      notice = 'Each image can be at most 5 MB.';
      continue;
    }
    if (state.images.length >= MAX_IMAGES) {
      notice = `You can attach up to ${MAX_IMAGES} images.`;
      break;
    }
    try {
      const url = await readAsDataUrl(file);
      const { name } = await call('attachments.save', { mediaType: file.type as ImageMediaType, data: url.slice(url.indexOf(',') + 1) });
      urlCache.set(name, url);
      // the same image twice is one file; attaching it again changes nothing
      if (!state.images.some((i) => i.name === name)) update({ images: [...state.images, { name, url }] });
    } catch (e) {
      notice = e instanceof Error ? e.message : String(e);
    }
  }
  update({ notice });
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('That image could not be read.'));
    reader.readAsDataURL(file);
  });
}

function imageFiles(list: FileList | null | undefined): File[] {
  return list ? Array.from(list) : [];
}

/** Paste and drop handlers for the answer surface. Text pastes and drags pass through untouched. */
export function attachHandlers(disabled: boolean | undefined) {
  return {
    onPaste: (e: React.ClipboardEvent) => {
      const files = imageFiles(e.clipboardData.files);
      if (disabled || files.length === 0) return;
      e.preventDefault();
      void addImageFiles(files);
    },
    onDragOver: (e: React.DragEvent) => {
      // without this the drop would open the file in the window
      if (e.dataTransfer.types.includes('Files')) e.preventDefault();
    },
    onDrop: (e: React.DragEvent) => {
      const files = imageFiles(e.dataTransfer.files);
      if (files.length === 0) return;
      e.preventDefault();
      if (!disabled) void addImageFiles(files);
    },
  };
}

/** The quote and thumbnails above the answer text, and the message after a refused image. */
export function PendingExtras({ disabled }: { disabled?: boolean }) {
  const { images, quote, notice } = useAnswerExtras();
  if (!quote && images.length === 0 && !notice) return null;
  return (
    <div className="answer-extras">
      {quote && <QuoteBlock text={quote} onRemove={disabled ? undefined : clearQuote} />}
      {images.length > 0 && (
        <ul className="thumb-row" aria-label="Attached images">
          {images.map((image, i) => (
            <li key={image.name} className="thumb">
              <img src={image.url} alt={`Attached image ${i + 1}`} />
              {!disabled && (
                <button type="button" className="thumb-remove" aria-label={`Remove image ${i + 1}`} onClick={() => update({ images: state.images.filter((x) => x.name !== image.name), notice: null })}>
                  <CloseIcon />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {notice && (
        <p className="answer-extras-notice" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}

/** Paperclip button with a file picker for the image types the model reads. */
export function AttachButton({ disabled }: { disabled?: boolean }) {
  const { images } = useAnswerExtras();
  return (
    <label className={disabled || images.length >= MAX_IMAGES ? 'attach-button is-disabled' : 'attach-button'} title="Attach images">
      <input
        type="file"
        className="sr-only-input"
        aria-label="Attach images"
        accept={IMAGE_TYPES.join(',')}
        multiple
        disabled={disabled || images.length >= MAX_IMAGES}
        onChange={(e) => {
          const files = imageFiles(e.target.files);
          e.target.value = ''; // picking the same file again should fire again
          void addImageFiles(files);
        }}
      />
      <PaperclipIcon />
    </label>
  );
}

export function QuoteBlock({ text, onRemove }: { text: string; onRemove?: () => void }) {
  return (
    <div className="quote-block">
      <Markdown text={text} inline className="quote-text" />
      {onRemove && (
        <button type="button" className="quote-remove" aria-label="Remove quote" onClick={onRemove}>
          <CloseIcon />
        </button>
      )}
    </div>
  );
}

/** A stored answer's quote and images, above its text in the session history and in Trails. */
export function ResponseExtras({ response }: { response: Pick<LearnerResponse, 'attachments' | 'quote'> }) {
  const names = response.attachments ?? [];
  if (!response.quote && names.length === 0) return null;
  return (
    <div className="answer-extras">
      {response.quote && <QuoteBlock text={response.quote} />}
      {names.length > 0 && (
        <ul className="thumb-row" aria-label="Attached images">
          {names.map((name, i) => (
            <li key={name} className="thumb">
              <StoredImage name={name} alt={`Attached image ${i + 1}`} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** An image kept in the attachments folder (an attached image, a plot of a code run). */
export function StoredImage({ name, alt }: { name: string; alt: string }) {
  const [url, setUrl] = useState(urlCache.get(name) ?? null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (urlCache.has(name)) return;
    let cancelled = false;
    call('attachments.read', { name }).then(
      (loaded) => {
        urlCache.set(name, loaded);
        if (!cancelled) setUrl(loaded);
      },
      () => !cancelled && setMissing(true),
    );
    return () => {
      cancelled = true;
    };
  }, [name]);
  if (missing) return <span className="thumb-missing">Image not found</span>;
  if (!url) return null;
  return <img src={url} alt={alt} />;
}

function PaperclipIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M13.5 7.5 8 13a3.5 3.5 0 0 1-5-5l5.8-5.8a2.3 2.3 0 0 1 3.3 3.3L6.3 11.3a1.1 1.1 0 0 1-1.6-1.6L10 4.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path d="M2 2l6 6M8 2 2 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
