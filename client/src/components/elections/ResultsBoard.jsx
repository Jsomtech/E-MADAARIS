/**
 * The live results board.
 *
 * One seat at a time: a circle for the split, a ranked list beside it, turnout underneath. It is
 * deliberately canvas-free — a chart library sized to a wide card is what pushed a learner three
 * screens down to read two numbers — so the whole result fits above the fold on a laptop and the
 * ring stays a ring on a phone.
 *
 * Nothing here connects a learner to a choice. It reads the tally the server already grouped by
 * seat, which is the same data the officer sees and the same reason the ballot stays secret.
 */
import { useEffect, useMemo, useState } from 'react';
import { Trophy } from 'lucide-react';
import { Badge } from '../ui/Basics.jsx';

const PALETTE = ['#6027ff', '#8b5cf6', '#22c55e', '#f59e0b', '#0ea5e9', '#ef4444', '#4c1fe0', '#64748b'];
const TRACK = '#e9e7f2';

const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();

/** '#rrggbb' + alpha → 'rgba(...)' so a dimmed slice keeps its own hue. */
function alpha(hex, value) {
  const digits = String(hex).replace('#', '');
  const n = parseInt(digits.length === 3 ? digits.split('').map((c) => c + c).join('') : digits, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${value})`;
}

export default function ResultsBoard({
  seats = [], turnout, live, title, subtitle, onPick, showTurnout = true, compact = false, t,
}) {
  const [seatIndex, setSeatIndex] = useState(0);
  const [focus, setFocus] = useState(null);

  /* A refresh can reorder or shrink the seat list; never point at a seat that is gone. */
  useEffect(() => {
    setSeatIndex((index) => Math.min(index, Math.max(0, seats.length - 1)));
    setFocus(null);
  }, [seats.length]);

  const seat = seats[Math.min(seatIndex, seats.length - 1)] || null;

  const ranked = useMemo(() => {
    const rows = seat?.candidates || [];
    return [...rows].sort((a, b) => (b.votes || 0) - (a.votes || 0) || String(a.full_name).localeCompare(String(b.full_name)));
  }, [seat]);

  const total = useMemo(() => {
    const reported = Number(seat?.total_valid_votes);
    if (Number.isFinite(reported)) return reported;
    return ranked.reduce((sum, row) => sum + (row.votes || 0), 0);
  }, [seat, ranked]);

  const colourOf = (index) => PALETTE[index % PALETTE.length];

  const leader = ranked[0] || null;
  const active = ranked.find((row) => row.candidate_id === focus) || leader;
  const activeShare = total > 0 && active ? Math.round(((active.votes || 0) / total) * 1000) / 10 : 0;

  /** Conic sweep of the valid votes; an empty seat is a plain track, not a guess. */
  const ring = useMemo(() => {
    if (!total || !ranked.length) return `conic-gradient(${TRACK} 0turn 1turn)`;
    let cursor = 0;
    const stops = ranked.map((row, index) => {
      const share = (row.votes || 0) / total;
      const from = cursor;
      cursor += share;
      const dim = active && row.candidate_id !== active.candidate_id;
      const colour = dim ? alpha(colourOf(index), 0.32) : colourOf(index);
      return `${colour} ${from}turn ${Math.min(cursor, 1)}turn`;
    });
    return `conic-gradient(${stops.join(', ')})`;
  }, [ranked, total, active]);

  if (!seat) return null;

  return (
    <section className={`results-board card-soft ${compact ? 'is-compact' : ''}`}>
      <header className="results-board-head">
        <div className="min-width-0">
          <div className="results-board-title">
            {title || seat.position_name}
            {live && <span className="results-live" aria-hidden="true"><i />{t('elections.liveNow', { defaultValue: 'live' })}</span>}
          </div>
          {subtitle && <div className="small text-muted">{subtitle}</div>}
        </div>
        {seats.length > 1 && (
          <div className="results-seats" role="tablist" aria-label={t('elections.pickSeat', { defaultValue: 'Choose a seat' })}>
            {seats.map((row, index) => (
              <button type="button" role="tab" key={row.position_id} aria-selected={index === seatIndex}
                className={`results-seat-chip ${index === seatIndex ? 'is-on' : ''}`}
                onClick={() => { setSeatIndex(index); setFocus(null); }}>
                {row.position_name}
              </button>
            ))}
          </div>
        )}
      </header>

      {ranked.length === 0 ? (
        <div className="small text-muted py-3">{t('elections.nothingToCount', { defaultValue: 'Nothing to count yet.' })}</div>
      ) : (
        <div className="results-board-body">
          <div className="results-ring-wrap">
            <div className="results-ring" style={{ background: ring }} role="img"
              aria-label={t('elections.ringLabel', {
                defaultValue: '{{name}} — {{share}}% of {{total}} valid votes',
                name: active?.full_name || '—', share: activeShare, total,
              })}>
              <div className="results-ring-hole">
                <div className="results-ring-share">{total ? `${activeShare}%` : '—'}</div>
                <div className="results-ring-name">{active?.full_name || t('elections.noVotesYet', { defaultValue: 'no votes yet' })}</div>
              </div>
            </div>
            <div className="results-ring-caption">
              {t('elections.validForSeat', { defaultValue: '{{total}} valid votes for this seat', total })}
            </div>
          </div>

          <ol className="results-list" role="list">
            {ranked.map((row, index) => {
              const share = total > 0 ? Math.round(((row.votes || 0) / total) * 1000) / 10 : 0;
              const on = active && row.candidate_id === active.candidate_id;
              const colour = colourOf(index);
              return (
                <li key={row.candidate_id} role="listitem">
                  <div className={`results-row ${on ? 'is-on' : ''}`}
                    role={onPick ? 'button' : undefined} tabIndex={onPick ? 0 : undefined}
                    onMouseEnter={() => setFocus(row.candidate_id)}
                    onMouseLeave={() => setFocus(null)}
                    onFocus={() => setFocus(row.candidate_id)}
                    onBlur={() => setFocus(null)}
                    onClick={onPick ? () => onPick(row, seat) : undefined}
                    onKeyDown={onPick ? (event) => {
                      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onPick(row, seat); }
                    } : undefined}>
                    <span className="results-rank">{index + 1}</span>
                    <span className="avatar results-avatar" style={{ background: `linear-gradient(135deg, ${colour}, ${alpha(colour, 0.72)})` }}>
                      {row.photograph_url ? <img src={row.photograph_url} alt="" /> : initials(row.full_name)}
                    </span>
                    <span className="results-id">
                      <span className="results-name">
                        {row.full_name}
                        {row.status === 'winner' && <Trophy size={13} className="results-trophy" />}
                      </span>
                      <span className="results-sub">
                        {row.class_name || t('elections.classUnknown', { defaultValue: 'class not recorded' })}
                        {row.status === 'tied' && <Badge tone="warn" className="ms-1">{t('elections.tied', { defaultValue: 'TIED' })}</Badge>}
                        {row.status === 'winner' && (
                          <Badge tone="ok" className="ms-1">
                            {live ? t('elections.leading', { defaultValue: 'leading' }) : t('elections.electedFinal', { defaultValue: 'ELECTED' })}
                          </Badge>
                        )}
                      </span>
                      <span className="results-bar" aria-hidden="true">
                        <span style={{ width: `${share}%`, background: colour }} />
                      </span>
                    </span>
                    <span className="results-count">
                      <span className="results-votes">{row.votes || 0}</span>
                      <span className="results-share">{share}%</span>
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {showTurnout && turnout && (
        <footer className="results-board-foot">
          <div className="results-turnout" aria-hidden="true">
            <span style={{ width: `${Math.min(100, turnout.percentage || 0)}%` }} />
          </div>
          <div className="results-turnout-text">
            {t('elections.turnoutLine', {
              defaultValue: '{{voted}} of {{eligible}} eligible learners have voted ({{pct}}%).',
              voted: turnout.voted ?? 0, eligible: turnout.eligible ?? 0, pct: turnout.percentage ?? 0,
            })}
          </div>
        </footer>
      )}
    </section>
  );
}
