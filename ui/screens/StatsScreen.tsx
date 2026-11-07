import { useEffect, useState } from 'react';
import type { CardStats, StatsFilter, StatsRange, StatsView } from '../../backend/api/contract';
import { formatHours } from '../../backend/core/budget';
import { call } from '../api';
import { Screen } from '../components/Shell';
import { DefGrid, Meter } from '../components/controls';
import { Markdown } from '../components/Markdown';
import { BudgetBar } from '../components/budget';
import { Calendar, Calibration, FREE_STUDY, HourBars, Lines, WeeklyBars, seriesColor, shortDate } from '../components/charts';

const RANGES: { value: StatsRange; label: string }[] = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: 'all', label: 'All time' },
];

const pct = (x: number) => `${Math.round(x * 100)}%`;

/**
 * Stats: how you learn, from everything Frontier logs. Filters sit in one row on top (time range,
 * goal, topic); a few plain sentences say what stands out; the charts below carry the detail.
 */
export function StatsScreen() {
  const [filter, setFilter] = useState<StatsFilter>({ goalId: null, topicId: null, range: '30d' });
  const [view, setView] = useState<StatsView | null>(null);
  const [cards, setCards] = useState<CardStats | null>(null);

  useEffect(() => {
    let live = true;
    void call('stats.view', filter).then((v) => live && setView(v));
    void call('cards.stats', { goalId: filter.goalId, range: filter.range }).then((c) => live && setCards(c));
    return () => {
      live = false;
    };
  }, [filter]);

  if (!view) return <Screen wide>{null}</Screen>;
  // a goal keeps its colour whatever the filter: colours follow the order of all goals
  const colorOf = new Map(view.goals.map((g, i) => [g.id, seriesColor(i)]));
  const series = view.goals.filter((g) => view.weeks.some((w) => w.minutes[g.id])).map((g) => ({ id: g.id, label: g.title, color: colorOf.get(g.id) ?? seriesColor(-1) }));
  // free study is a line of its own: time in sessions the learner chose that no goal counts
  const anyFree = view.weeks.some((w) => w.minutes['free']);
  if (anyFree) series.push({ id: 'free', label: 'Free study', color: FREE_STUDY });
  const empty = view.headline.minutes === 0 && view.headline.answers === 0 && view.headline.ideasOwned === 0;
  const h = view.headline;

  return (
    <Screen wide>
      <div className="flex flex-col gap-[18px]">
        <div className="flex flex-col gap-[10px]">
          <h1 className="t-display">Stats</h1>
          <p className="t-lead m-0">Where your time goes and how far each goal has come.</p>
        </div>
        <div className="stats-filters">
          <div role="radiogroup" aria-label="Time range" className="segmented is-small">
            {RANGES.map((r) => (
              <button key={r.value} type="button" role="radio" aria-checked={filter.range === r.value} onClick={() => setFilter({ ...filter, range: r.value })}>
                {r.label}
              </button>
            ))}
          </div>
          <div className="chip-group is-small" role="radiogroup" aria-label="Goal">
            <button type="button" role="radio" className="mini-chip" aria-checked={filter.goalId === null} onClick={() => setFilter({ ...filter, goalId: null })}>
              All goals
            </button>
            {view.goals.map((g) => (
              <button key={g.id} type="button" role="radio" className="mini-chip" aria-checked={filter.goalId === g.id} onClick={() => setFilter({ ...filter, goalId: g.id })}>
                <i className="legend-swatch" style={{ background: colorOf.get(g.id) }} />
                {g.title}
              </button>
            ))}
          </div>
          {view.topics.length > 0 && (
            <select className="select-quiet" aria-label="Topic" value={filter.topicId ?? ''} onChange={(e) => setFilter({ ...filter, topicId: e.target.value || null })}>
              <option value="">Every topic</option>
              {view.topics.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.size})
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {empty ? (
        <div className="stats-empty">
          <p className="t-lead m-0">Stats fill in as you study: time per goal, what you learned and keep, when you learn best, and where your confidence is right.</p>
          <p className="t-small m-0 text-muted">Nothing in this range yet. Try a longer range, or start a session from Today.</p>
        </div>
      ) : (
        <>
          {view.facts.length > 0 && (
            <section className="facts" aria-label="Worth knowing">
              <div className="panel-label">Worth knowing</div>
              <ul>
                {view.facts.map((f) => (
                  <li key={f}>
                    <Markdown text={f} inline />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="tiles">
            <Tile label="Studied" value={formatHours(h.minutes)} sub={`${h.sessions} ${h.sessions === 1 ? 'session' : 'sessions'}${view.freeMinutes ? ` · ${formatHours(view.freeMinutes)} free study` : ''}`} />
            <Tile label="Ideas learned" value={String(h.ideasLearned)} sub={`${h.ideasOwned} yours in all`} />
            <Tile label="Days in a row" value={String(h.streakDays)} sub={h.streakDays ? 'keep it going' : 'start one today'} />
            <Tile label="Average score" value={h.avgScore === null ? '—' : pct(h.avgScore)} sub={`${h.answers} answers`} />
          </div>

          <div className="stats-grid">
            <Card title="Time per week" wide note={`Stacked by goal. Time on an idea two goals share is split between them.${anyFree ? ' Free study is time in sessions you chose that count toward no goal.' : ''}`}>
              <WeeklyBars weeks={view.weeks} series={series} format={formatHours} />
            </Card>

            <Card title="Every day" note="The last twelve weeks.">
              <Calendar days={view.days} format={formatHours} />
            </Card>

            <Card title="What you know" note="Ideas you recognize, own (can explain), and know in depth.">
              <Lines
                points={view.growth.map((g) => ({ x: g.date, values: [g.recognized, g.owned, g.deep] }))}
                series={[
                  { label: 'Recognize', color: '#8c877c' },
                  { label: 'Own', color: '#7489e6' },
                  { label: 'In depth', color: '#c98500' },
                ]}
                yFormat={(v) => String(Math.round(v))}
                xLabel={shortDate}
              />
            </Card>

            <Card title="What you keep" note={view.retention.now !== null ? `Average recall of what you own, if you stopped practising today. Now ${pct(view.retention.now)}, in a month ${pct(view.retention.inAMonth ?? 0)}.` : 'Appears once you own a few ideas.'}>
              {view.retention.curve.length > 0 && (
                <Lines points={view.retention.curve.map((c) => ({ x: String(c.day), values: [c.recall] }))} series={[{ label: 'Recall', color: '#7489e6' }]} yFormat={pct} xLabel={(d) => (d === '0' ? 'Today' : `In ${d} days`)} yMax={1} area height={160} />
              )}
            </Card>

            {cards && cards.total > 0 && !filter.topicId && (
              <Card title="Flashcards" note="Reviews on the Cards screen, and the facts your answers in sessions and practice recalled on their own.">
                <DefGrid
                  rows={[
                    { label: 'Reviews', value: cards.reviews ? `${cards.reviews}${cards.remembered !== null ? `, ${pct(cards.remembered)} remembered` : ''}` : 'None in this range' },
                    { label: 'Time', value: formatHours(cards.minutes) },
                    { label: 'Recalled in use', value: `${cards.recalledInUse} in sessions and practice` },
                    { label: 'Cards', value: `${cards.total}, ${cards.toReview} to review now` },
                  ]}
                />
              </Card>
            )}

            <Card title="How sure, how right" note="Your average score at each confidence. The tick marks what the confidence claims; a bar short of it means overconfidence.">
              <Calibration rows={view.calibration} />
            </Card>

            <Card title="When you study" note="Hover a bar for your average score at that hour.">
              <HourBars hours={view.hours} format={formatHours} />
            </Card>

            <Card title="Hardest ideas" note="Lowest average over at least two answers.">
              {view.hardest.length ? (
                <ul className="stat-list">
                  {view.hardest.map((x) => (
                    <li key={x.nodeId}>
                      <span className="min-w-0">
                        <Markdown text={x.name} inline />
                        <span className="t-caption text-muted"> · {x.attempts} answers, last {pct(x.lastScore)}</span>
                      </span>
                      <Meter value={x.avgScore} />
                      <span className="recall-pct">{pct(x.avgScore)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="t-small m-0 text-muted">Nothing stands out as hard.</p>
              )}
            </Card>

            <Card title="Shared ideas" note={`Ideas more than one goal needs, learned once and counted once.${view.overlap.savedMinutes >= 1 ? ` About ${formatHours(view.overlap.savedMinutes)} saved so far.` : ''}`}>
              {view.overlap.ideas.length === 0 && <p className="t-small m-0 text-muted">No idea is shared between your goals yet.</p>}
              {view.overlap.ideas.length > 0 && (
                <ul className="stat-list">
                  {view.overlap.ideas.map((o) => (
                    <li key={o.nodeId}>
                      <span className="min-w-0">
                        <Markdown text={o.name} inline />
                        <span className="t-caption text-muted"> · {o.goals.join(', ')}</span>
                      </span>
                      <span className="t-small shrink-0 text-secondary">{o.depth ? `depth ${o.depth}` : 'not yet'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {view.misconceptions.length > 0 && (
              <Card title="Misconceptions" note="Wrong ideas the grader noticed; the ones that came back are marked.">
                <ul className="stat-list">
                  {view.misconceptions.map((m) => (
                    <li key={`${m.nodeId}-${m.description}`} className="is-stacked">
                      <span className="t-small text-secondary">
                        <Markdown text={m.idea} inline />
                        {m.cameBack && !m.resolved && <span className="badge">came back</span>}
                        {m.resolved && <span className="badge is-quiet">resolved</span>}
                      </span>
                      <span>{m.description}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {(view.budgets.length > 0 || view.freeMinutes > 0) && (
              <Card title="Time against plans" wide note={`New ideas take you about ${view.speed.toFixed(1)}× the time the plans estimate.`}>
                <ul className="budget-list">
                  {view.budgets.map((b) => (
                    <li key={b.goalId}>
                      <span className="flex items-baseline justify-between gap-[12px]">
                        <span className="flex items-center gap-[8px]">
                          <i className="legend-swatch" style={{ background: colorOf.get(b.goalId) }} />
                          {b.title}
                        </span>
                        <span className="t-small text-secondary">
                          {b.noLimit ? 'No time limit · ' : ''}
                          {b.ready} of {b.planned} ideas ready
                        </span>
                      </span>
                      <BudgetBar progress={{ totalMinutes: b.totalMinutes, spentMinutes: b.spentMinutes, plannedMinutes: b.plannedMinutes, expectedByNow: null, noLimit: b.noLimit }} />
                    </li>
                  ))}
                  {view.freeMinutes > 0 && (
                    <li>
                      <span className="flex items-baseline justify-between gap-[12px]">
                        <span className="flex items-center gap-[8px]">
                          <i className="legend-swatch" style={{ background: FREE_STUDY }} />
                          Free study
                        </span>
                        <span className="t-small text-secondary">{formatHours(view.freeMinutes)} in sessions you chose, outside every budget</span>
                      </span>
                    </li>
                  )}
                </ul>
              </Card>
            )}
          </div>
        </>
      )}
    </Screen>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="tile">
      <span className="tile-label">{label}</span>
      <span className="tile-value">{value}</span>
      <span className="t-small text-muted">{sub}</span>
    </div>
  );
}

function Card({ title, note, wide, children }: { title: string; note?: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <section className={wide ? 'stat-card is-wide' : 'stat-card'}>
      <div className="flex flex-col gap-[4px]">
        <h2 className="t-heading">{title}</h2>
        {note && <p className="t-small m-0 text-muted">{note}</p>}
      </div>
      {children}
    </section>
  );
}
