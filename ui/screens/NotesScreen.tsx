import { useEffect, useState } from 'react';
import type { CheatSheetView, GoalNotesView, NoteIdeaView } from '../../backend/api/contract';
import { call } from '../api';
import { plainError } from '../lib/errors';
import { Breadcrumb, Screen } from '../components/Shell';
import { Button, Notice } from '../components/controls';
import { Markdown } from '../components/Markdown';
import { IdeaNote } from '../components/IdeaNote';

type Tab = 'notes' | 'sheet';

/**
 * A goal's notes (design §10, "Notes"): every idea with what it says, the learner's own words, handle
 * and note, worked examples and flashcards; and the same on one page as a cheat sheet. Both print and
 * save as PDF as they are shown.
 */
export function NotesScreen({ goalId, goalTitle, onBack, onBackToGoals }: { goalId: string; goalTitle: string; onBack: () => void; onBackToGoals: () => void }) {
  const [tab, setTab] = useState<Tab>('notes');
  const [notes, setNotes] = useState<GoalNotesView | null>(null);
  const [sheet, setSheet] = useState<CheatSheetView | null>(null);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const failed = (e: unknown) => setError(plainError(e instanceof Error ? e.message : String(e)));

  useEffect(() => {
    void call('notes.goal', { goalId }).then(setNotes, failed);
  }, [goalId]);
  useEffect(() => {
    if (tab === 'sheet') void call('notes.sheet', { goalId, all }).then(setSheet, failed);
  }, [goalId, tab, all]);
  useEffect(() => {
    if (!saved) return;
    const t = window.setTimeout(() => setSaved(null), 2600);
    return () => window.clearTimeout(t);
  }, [saved]);

  const act = async (label: string, fn: () => Promise<string | null>) => {
    setBusy(label);
    setError(null);
    try {
      setSaved(await fn());
    } catch (e) {
      failed(e);
    } finally {
      setBusy(null);
    }
  };

  const title = notes?.title ?? goalTitle;
  return (
    <Screen>
      <div className="notes-page">
        <div className="flex flex-col gap-[22px] no-print">
          <Breadcrumb items={[{ label: 'Goals', onClick: onBackToGoals }, { label: goalTitle || title || 'Goal', onClick: onBack }, { label: 'Notes' }]} />
          <div className="notes-toolbar">
            <div role="radiogroup" aria-label="Show" className="segmented is-small">
              {(['notes', 'sheet'] as const).map((t) => (
                <button key={t} type="button" role="radio" aria-checked={tab === t} onClick={() => setTab(t)}>
                  {t === 'notes' ? 'Notes' : 'Cheat sheet'}
                </button>
              ))}
            </div>
            <span className="notes-toolbar-end">
              <Button onClick={() => void act('print', async () => ((await call('notes.print')).printed ? 'Sent to the printer.' : null))} disabled={busy !== null}>
                Print
              </Button>
              <Button onClick={() => void act('pdf', async () => ((await call('notes.savePdf', { goalId, kind: tab })).path ? 'Saved as PDF.' : null))} disabled={busy !== null}>
                {busy === 'pdf' ? 'Saving…' : 'Save as PDF'}
              </Button>
              {tab === 'notes' && (
                <Button
                  kind="quiet"
                  title="Your notes as a Markdown file, for Obsidian or any notes app"
                  onClick={() => void act('md', async () => ((await call('goals.exportNotes', { goalId })).path ? 'Saved as Markdown.' : null))}
                  disabled={busy !== null}
                >
                  Export Markdown
                </Button>
              )}
            </span>
          </div>
          {saved && (
            <p className="t-small m-0 text-secondary" role="status">
              {saved}
            </p>
          )}
          {error && <Notice error>{error}</Notice>}
        </div>

        {tab === 'notes' && notes && <NotesView notes={notes} onNote={(nodeId, note) => setNotes(withNote(notes, nodeId, note))} />}
        {tab === 'sheet' && sheet && <SheetView sheet={sheet} all={all} onAll={() => setAll((a) => !a)} />}
      </div>
    </Screen>
  );
}

function withNote(notes: GoalNotesView, nodeId: string, note: string | null): GoalNotesView {
  return { ...notes, skills: notes.skills.map((s) => ({ ...s, ideas: s.ideas.map((i) => (i.nodeId === nodeId ? { ...i, note } : i)) })) };
}

function NotesView({ notes, onNote }: { notes: GoalNotesView; onNote: (nodeId: string, note: string | null) => void }) {
  return (
    <article className="notes-article">
      <header className="flex flex-col gap-[10px]">
        <h1 className="t-display">{notes.title}</h1>
        {notes.title !== notes.text && <p className="t-lead m-0">{notes.text}</p>}
        {notes.scope && <p className="m-0 text-secondary">{notes.scope}</p>}
      </header>
      {notes.skills.length === 0 && <p className="text-secondary">This goal has no skills yet. Its notes fill in as its map is made and you learn.</p>}
      {notes.skills.map((skill, k) => (
        <section key={k} className="notes-skill">
          <h2 className="t-title">{skill.statement}</h2>
          {skill.ideas.map((idea) => (idea.repeat ? <p key={idea.nodeId} className="m-0 text-muted t-small">{idea.name} (above)</p> : <NoteIdea key={idea.nodeId} idea={idea} onNote={(note) => onNote(idea.nodeId, note)} />))}
        </section>
      ))}
    </article>
  );
}

function NoteIdea({ idea, onNote }: { idea: NoteIdeaView; onNote: (note: string | null) => void }) {
  return (
    <section className="notes-idea">
      <div className="flex flex-wrap items-baseline gap-x-[12px] gap-y-[2px]">
        <h3 className="notes-idea-name">
          <Markdown text={idea.name} inline />
        </h3>
        <span className="t-caption text-muted">{idea.reached ? `Learned to ${idea.reached}` : 'Not learned yet'}</span>
      </div>
      <Markdown text={idea.statement} className="text-soft" />
      {idea.ownWords && (
        <div className="notes-field">
          <span className="t-caption text-muted">In your words</span>
          <p className="m-0 learner-text">{idea.ownWords}</p>
        </div>
      )}
      {idea.handle && (
        <div className="notes-field">
          <span className="t-caption text-muted">Handle</span>
          <p className="m-0 learner-text">{idea.handle}</p>
        </div>
      )}
      <IdeaNote nodeId={idea.nodeId} note={idea.note} onSaved={onNote} />
      {idea.examples.map((example, i) => (
        <div key={i} className="notes-field notes-example">
          <span className="t-caption text-muted">Worked example</span>
          <Markdown text={example} />
        </div>
      ))}
      {idea.cards.length > 0 && (
        <div className="notes-field">
          <span className="t-caption text-muted">Flashcards</span>
          <dl className="notes-cards">
            {idea.cards.map((c, i) => (
              <div key={i}>
                <dt>
                  <Markdown text={c.front} />
                </dt>
                <dd>
                  <Markdown text={c.back} />
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </section>
  );
}

function SheetView({ sheet, all, onAll }: { sheet: CheatSheetView; all: boolean; onAll: () => void }) {
  return (
    <article className="cheat-sheet">
      <header className="cheat-sheet-head">
        <h1>{sheet.title}</h1>
        {(sheet.left > 0 || all) && (
          <p className="m-0 t-small text-muted no-print">
            {all ? 'Every idea of the goal; it may take more than one page. ' : `${sheet.left === 1 ? 'One idea' : `${sheet.left} ideas`} left out to fit one page: the core ideas and those fading come first. `}
            <button type="button" className="link-button" onClick={onAll}>
              {all ? 'Fit one page' : 'Show all'}
            </button>
          </p>
        )}
      </header>
      {sheet.skills.length === 0 && <p className="text-secondary no-print">Nothing to put on the sheet yet. It fills in as the goal's map is made.</p>}
      <div className="cheat-sheet-columns">
        {sheet.skills.map((skill, k) => (
          <section key={k} className="cheat-sheet-skill">
            <h2>{skill.statement}</h2>
            {skill.ideas.map((idea) => (
              <div key={idea.nodeId} className="cheat-sheet-idea">
                <p>
                  <strong>
                    <Markdown text={idea.name} inline />
                  </strong>{' '}
                  <Markdown text={idea.text} inline />
                  {idea.handle && <em> ({idea.handle})</em>}
                </p>
                {idea.formulas.map((f, i) => (
                  <p key={i} className="cheat-sheet-formula">
                    <Markdown text={f.front} inline />: <Markdown text={f.back} inline />
                  </p>
                ))}
              </div>
            ))}
          </section>
        ))}
      </div>
    </article>
  );
}
