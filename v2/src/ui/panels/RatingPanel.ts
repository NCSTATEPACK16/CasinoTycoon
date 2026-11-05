// The rating, explained: all nine terms the sim adds up, each with where it
// stands in its range and what the player can do about it, plus reputation —
// the slow number behind who walks in the door.

import type { RatingReport, RatingTermId } from '../../worker/inspect';
import { el, escapeHtml } from '../dom';

type Facts = RatingReport['facts'];

const LABEL: Record<RatingTermId, string> = {
  happiness: 'Guest happiness',
  machines: 'Games on the floor',
  variety: 'Variety',
  cleanliness: 'Cleanliness',
  broken: 'Broken games',
  signage: 'Signage',
  security: 'Security',
  dealers: 'Dealt tables',
  rage: 'Rage-quits',
};

/** What to do about a term, in the player's terms, from the counts behind it. */
export function ratingAdvice(id: RatingTermId, value: number, best: number, f: Facts): string {
  const maxed = value >= best - 1e-6;
  switch (id) {
    case 'happiness':
      return f.guests === 0
        ? 'No guests yet: an empty floor counts as fairly happy.'
        : `Guests average ${Math.round(f.avgHappiness)}% happy. Unmet needs and losing streaks sour them: add restrooms, food and a bar, keep prices fair, and comp your players.`;
    case 'machines':
      return maxed
        ? `${f.games} games: this term is full.`
        : `${f.games} game${f.games === 1 ? '' : 's'}. Each adds 5, up to 5 games.`;
    case 'variety':
      return maxed
        ? `${f.gameKinds} kinds of game: full marks.`
        : 'Only one kind of game. Add a second kind for +10.';
    case 'cleanliness':
      return f.messes === 0
        ? 'Spotless.'
        : `${f.messes} mess${f.messes === 1 ? '' : 'es'} on the floor, −3 each. Hire janitors.`;
    case 'broken':
      return f.brokenGames === 0
        ? 'Nothing broken.'
        : `${f.brokenGames} broken game${f.brokenGames === 1 ? '' : 's'}, −5 each. Hire a mechanic.`;
    case 'signage':
      return maxed
        ? 'Signage is at its cap.'
        : 'Neon signs and marquees add a little each, up to +10.';
    case 'security':
      return maxed
        ? `${f.guards} on the floor: as safe as it gets.`
        : `${f.guards} security or pit boss${f.guards === 1 ? '' : 'es'}: +1.5 each, up to +8.`;
    case 'dealers':
      return f.tablesWithoutDealer > 0
        ? `${f.tablesWithoutDealer} table${f.tablesWithoutDealer === 1 ? '' : 's'} without a dealer. Each dealt table adds 2, up to +10.`
        : maxed
          ? 'Dealt tables are at the cap.'
          : 'Each dealt table adds 2, up to +10.';
    case 'rage':
      return value < 0
        ? 'Guests stormed out broke and unhappy. It fades by 1 an hour; lower table minimums and comp losers to stop more.'
        : 'Nobody has stormed out lately.';
  }
}

export class RatingPanel {
  readonly root = el('div', 'rating-panel');

  update(r: RatingReport): void {
    const rep = r.reputation;
    const trend =
      Math.abs(rep.today) < 0.05
        ? 'steady today'
        : `${rep.today > 0 ? '+' : ''}${rep.today.toFixed(1)} today`;
    const rows = r.terms
      .map((t) => {
        const span = Math.max(1e-6, t.best - t.worst);
        // A bonus bar fills with what it earns; a penalty bar with what it costs.
        const neg = t.best <= 0;
        const share = neg ? (t.best - t.value) / span : (t.value - t.worst) / span;
        const fill = Math.max(0, Math.min(100, share * 100));
        const val = `${t.value > 0 ? '+' : ''}${t.value.toFixed(1)}`;
        return `<div class="rt-row${neg ? ' neg' : ''}${t.value < 0 ? ' hurting' : ''}" data-term="${t.id}">
          <span class="rt-name">${LABEL[t.id]}</span>
          <b class="rt-val">${val}</b>
          <i class="rt-bar" style="--v:${fill}%"></i>
          <small>${escapeHtml(ratingAdvice(t.id, t.value, t.best, r.facts))}</small>
        </div>`;
      })
      .join('');
    this.root.innerHTML = `
      <div class="rt-head"><span class="rt-total">★ ${r.total}</span><span class="dim">out of 100: decides how many guests arrive</span></div>
      <div class="rt-rep"><b>Reputation ${Math.round(rep.value)}</b> · ${escapeHtml(rep.label)} <span class="dim">(${trend})</span>
        <small>Settles at midnight. Happy leavers and jackpots raise it; rage-quits lower it. A good name brings high rollers and tourists.</small></div>
      <h3>What makes the rating</h3>
      ${rows}`;
  }
}
