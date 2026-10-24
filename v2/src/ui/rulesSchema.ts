// The levers the rules editor offers per game. Each field maps one key of the
// engine's rules object to a control; the engine still validates and clamps
// whatever comes back (setRules replies with the rules as applied).

import type { GameKind } from '../shared/games';
import { ODDS_OPTIONS } from '../sim/games/craps/craps';
import { DENOMINATIONS } from '../sim/games/slots/slots';
import { PAR_SHEETS } from '../sim/games/slots/sheets';
import { TRIPS_PAYTABLES } from '../sim/games/uth/uth';

export type RuleField =
  | { key: string; label: string; type: 'number'; min: number; max: number; step: number }
  | { key: string; label: string; type: 'bool' }
  | {
      key: string;
      label: string;
      type: 'select';
      options: { value: string | number; label: string }[];
    };

const LIMITS: RuleField[] = [
  { key: 'minBet', label: 'Table minimum', type: 'number', min: 1, max: 5000, step: 5 },
  { key: 'maxBet', label: 'Table maximum', type: 'number', min: 10, max: 100000, step: 50 },
];

export const RULE_FIELDS: Record<GameKind, RuleField[]> = {
  blackjack: [
    ...LIMITS,
    {
      key: 'blackjackPays',
      label: 'Blackjack pays',
      type: 'select',
      options: [
        { value: '3:2', label: '3:2' },
        { value: '6:5', label: '6:5' },
      ],
    },
    { key: 'h17', label: 'Dealer hits soft 17', type: 'bool' },
    {
      key: 'decks',
      label: 'Decks',
      type: 'select',
      options: [1, 2, 6, 8].map((d) => ({ value: d, label: String(d) })),
    },
    { key: 'das', label: 'Double after split', type: 'bool' },
    { key: 'rsa', label: 'Re-split aces', type: 'bool' },
    {
      key: 'surrender',
      label: 'Surrender',
      type: 'select',
      options: [
        { value: 'none', label: 'None' },
        { value: 'late', label: 'Late' },
      ],
    },
  ],
  roulette: [
    ...LIMITS,
    {
      key: 'wheel',
      label: 'Wheel',
      type: 'select',
      options: [
        { value: 'single', label: 'Single zero (European)' },
        { value: 'double', label: 'Double zero (American)' },
      ],
    },
    { key: 'laPartage', label: 'La Partage', type: 'bool' },
  ],
  craps: [
    ...LIMITS,
    {
      key: 'odds',
      label: 'Free odds',
      type: 'select',
      options: ODDS_OPTIONS.map((o) => ({ value: o, label: o.replace('x', '×') })),
    },
    {
      key: 'field12Pays',
      label: 'Field 12 pays',
      type: 'select',
      options: [
        { value: 2, label: '2:1' },
        { value: 3, label: '3:1' },
      ],
    },
  ],
  slots: [
    {
      key: 'sheet',
      label: 'Par sheet',
      type: 'select',
      options: Object.values(PAR_SHEETS).map((s) => ({
        value: s.id,
        label: `${s.name} · ${(s.rtp * 100).toFixed(1)}% · ${s.volatility}`,
      })),
    },
    {
      key: 'denomination',
      label: 'Denomination',
      type: 'select',
      options: DENOMINATIONS.map((d) => ({ value: d, label: d < 1 ? `${d * 100}¢` : `$${d}` })),
    },
  ],
  uth: [
    ...LIMITS,
    {
      key: 'trips',
      label: 'Trips paytable',
      type: 'select',
      options: Object.keys(TRIPS_PAYTABLES).map((k) => ({ value: k, label: k })),
    },
  ],
};
