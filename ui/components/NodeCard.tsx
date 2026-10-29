import type { IdeaRef, MapState, NodeCard } from '../../backend/api/contract';
import { Markdown } from './Markdown';
import { VerticalPath } from './paths';
import { depthName } from '../lib/stages';

const STATE_WORD: Record<MapState, string> = { owned: 'Yours', fringe: 'Learnable now', beyond: 'Beyond your edge' };
const KIND_WORD = { claim: 'Claim', procedure: 'Procedure', term: 'Term' } as const;

/**
 * Everything about one idea (design §8): your own words first, depth and freshness, what it is built
 * on and leads to, how you get there from what you own, and where it came from. Used by Map and Lookup.
 */
export function NodeCardView({ card, onSelect, onTrail, compact }: { card: NodeCard; onSelect: (nodeId: string) => void; onTrail?: (sessionId: string) => void; compact?: boolean }) {
  const link = (r: IdeaRef) => (
    <button key={r.id} type="button" className="link-button idea-link" onClick={() => onSelect(r.id)}>
      <Markdown text={r.name} inline />
    </button>
  );
  /** Separators stay attached to the link before them, so a wrapped list never starts a line with one. */
  const joined = (refs: IdeaRef[], sep: string) =>
    refs.map((r, i) => (
      <span key={r.id} className="idea-item">
        {link(r)}
        {i < refs.length - 1 && <span className="text-muted">{sep}</span>}
      </span>
    ));
  const showPath = card.derivation.length > 1 && card.state !== 'owned';
  return (
    <article className="node-card">
      <div className="flex flex-col gap-[10px]">
        <div className="t-caption text-muted">
          {KIND_WORD[card.kind]} · {STATE_WORD[card.state]}
          {card.unverified ? ' · not in your material yet' : ''}
        </div>
        <Markdown text={card.name} className={compact ? 't-heading' : 't-title'} />
        <Markdown text={card.statement} className="text-[15px] text-soft" />
      </div>

      {card.ownStatement && (
        <div className="answer-block flex flex-col gap-[6px]">
          <div className="t-caption text-muted">In your words</div>
          <div className="learner-text">{card.ownStatement}</div>
          {card.handle && <div className="t-caption text-secondary">Handle: {card.handle}</div>}
        </div>
      )}

      <div className="flex flex-col gap-[10px]">
        <div className="depth-ladder" role="img" aria-label={`Depth ${card.depth} of 5${card.targetDepth ? `, target ${card.targetDepth}` : ''}`}>
          {[1, 2, 3, 4, 5].map((d) => (
            <span key={d} className={`rung${d <= card.depth ? ' is-reached' : ''}${d === card.targetDepth ? ' is-target' : ''}`} />
          ))}
        </div>
        <div className="t-small text-secondary">
          {depthName(card.depth)}
          {card.targetDepth > card.depth ? `, aiming for ${depthName(card.targetDepth).toLowerCase()}` : ''}
          {card.depth > 0 ? ` · ${Math.round(card.recall * 100)}% recall now` : ''}
        </div>
      </div>

      {(card.builtOn.length > 0 || card.leadsTo.length > 0) && (
        <dl className="def-grid">
          {card.builtOn.map((chain, i) => (
            <div key={i} style={{ display: 'contents' }}>
              <dt>{i === 0 ? 'Built on' : 'Or built on'}</dt>
              <dd className="idea-links">{joined(chain, ' +')}</dd>
            </div>
          ))}
          {card.leadsTo.length > 0 && (
            <>
              <dt>Leads to</dt>
              <dd className="idea-links">{joined(card.leadsTo.slice(0, 8), ',')}</dd>
            </>
          )}
        </dl>
      )}

      {showPath && (
        <div className="flex flex-col gap-[14px]">
          <div className="panel-label">How you get here from what you own</div>
          <VerticalPath
            items={card.derivation.map((d) => ({
              key: d.id,
              state: d.owned ? 'done' : d.id === card.id ? 'current' : 'upcoming',
              children: (
                <div className="flex flex-col gap-[2px]">
                  {d.id === card.id ? <Markdown text={d.name} inline /> : link(d)}
                  <span className="t-small text-muted">{d.owned ? 'Yours' : d.premises.length ? `from ${d.premises.map((p) => p.name.replace(/\$/g, '')).join(' + ')}` : 'A starting point'}</span>
                </div>
              ),
            }))}
          />
        </div>
      )}

      {card.bugs.length > 0 && (
        <div className="flex flex-col gap-[6px]">
          <div className="panel-label">Noted to repair</div>
          {card.bugs.map((b) => (
            <p key={b} className="t-small m-0 text-secondary">
              {b}
            </p>
          ))}
        </div>
      )}

      {(card.sources.length > 0 || card.firstSession) && (
        <div className="flex flex-col gap-[6px]">
          {card.sources.length > 0 && <div className="t-small text-muted">From {card.sources.map((s) => (s.locator ? `${s.title}, ${s.locator}` : s.title)).join('; ')}</div>}
          {card.firstSession && onTrail && (
            <button type="button" className="link-button self-start" onClick={() => onTrail(card.firstSession?.id ?? '')}>
              First taught {formatDay(card.firstSession.date)}: {card.firstSession.title}
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function formatDay(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
}
