import { describe, expect, it } from 'vitest';
import type { GameKind } from '../shared/games';
import { ENGINES } from '../sim/games';
import type { CasinoEngine } from '../sim/games/types';
import { RULE_FIELDS } from './rulesSchema';

describe('rules editor schema', () => {
  it('offers levers for every engine, and every offered choice is legal', () => {
    for (const kind of Object.keys(ENGINES) as GameKind[]) {
      const engine = ENGINES[kind] as unknown as CasinoEngine;
      expect(RULE_FIELDS[kind].length, `${kind} has no levers`).toBeGreaterThan(0);
      for (const f of RULE_FIELDS[kind]) {
        if (f.type !== 'select') continue;
        for (const o of f.options) {
          const { issues } = engine.validateRules({ [f.key]: o.value });
          expect(issues, `${kind}.${f.key} = ${o.value}`).toEqual([]);
        }
      }
    }
  });

  it('every lever of an engine is a field its validator keeps', () => {
    for (const kind of Object.keys(ENGINES) as GameKind[]) {
      const engine = ENGINES[kind] as unknown as CasinoEngine;
      const rules = engine.defaultRules() as unknown as Record<string, unknown>;
      for (const f of RULE_FIELDS[kind]) expect(rules, `${kind}.${f.key}`).toHaveProperty(f.key);
    }
  });
});
