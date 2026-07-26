import { el, formatCash } from '../dom';
import type { PanelSpec } from '../WindowManager';
import { leaderboard } from '../../services/LeaderboardService';
import { CAMPAIGNS } from '../../data/campaigns';

// Reads work signed-out (public SELECT via the publishable key), so this panel
// is populated for everyone — local shows a leaderboard of one, cloud shows
// the global Top 10.
export function makeLeaderboardPanel(): PanelSpec {
  const content = el('div');
  let campaignId = CAMPAIGNS[0]?.id ?? '';

  const render = () => {
    content.textContent = '';
    content.appendChild(el('div', 'p-heading', 'Leaderboard'));

    const tabs = el('div', 'p-row');
    for (const def of CAMPAIGNS) {
      const btn = el('button', def.id === campaignId ? 'p-tool selected' : 'p-tool', def.name);
      btn.addEventListener('click', () => {
        campaignId = def.id;
        render();
      });
      tabs.appendChild(btn);
    }
    content.appendChild(tabs);

    const body = el('div');
    body.appendChild(el('div', 'p-note', 'Loading…'));
    content.appendChild(body);

    // Captured so a tab switched mid-request cannot have its rows overwritten
    // by the slower earlier one.
    const requested = campaignId;
    void leaderboard.getTop(requested, 10).then((rows) => {
      if (requested !== campaignId) return;
      body.textContent = '';
      if (rows.length === 0) {
        body.appendChild(el('div', 'p-note', 'Nobody has beaten this campaign yet.'));
        return;
      }
      for (const r of rows) {
        const line = el('div', 'p-save-row');
        line.appendChild(el('div', 'p-save-label', `${r.rank}. ${r.displayName || '—'}`));
        line.appendChild(
          el(
            'div',
            'p-save-meta',
            `${Math.round(r.score)} pts · ${formatCash(r.bestDailyProfit)} · ${r.completedInDays} days`,
          ),
        );
        body.appendChild(line);
      }
    });
  };

  render();
  return { title: 'Leaderboard', width: 360, content };
}
