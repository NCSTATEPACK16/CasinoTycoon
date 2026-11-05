// Bases for machines whose rounds are played by a real engine (sim/games).
// A cabinet seats one player; a table holds seats. Both own a GameMath —
// rules, shoe and the playRound bridge — and play a guest's turn as a short
// run of real rounds (enginePlay.ts).

import { ENGINE_RULES } from '../../../data/balance';
import type { GameKind } from '../../../shared/games';
import type { RulesIssue } from '../../games/types';
import type { Rng } from '../../rng';
import { CasinoGame, type PlayContext, type PlayResult } from './CasinoGame';
import { GameMath } from './GameMath';
import { playEngineRounds, roundStake, roundsForPlay } from './enginePlay';
import { SeatedCasinoGame } from './SeatedCasinoGame';

/** Keep the guest stake inside the table's limits after the rules move. */
function syncStake(machine: CasinoGame, math: GameMath): void {
  const { minBet, maxBet } = math.rules;
  machine.costToPlay = Math.min(maxBet, Math.max(minBet, machine.costToPlay));
}

function freePlay(math: GameMath, stake: number, rng: Rng): number {
  return (
    math.playRound({ unit: stake, wallet: Infinity, skillError: 0, oddsAppetite: 1 }, rng)
      ?.returned ?? 0
  );
}

export abstract class EngineCabinet extends CasinoGame {
  protected readonly game: GameMath;

  constructor(id: string, defId: string, kind: GameKind, costToPlay?: number) {
    const game = new GameMath(kind, ENGINE_RULES[defId]);
    // A cabinet's stake is its denomination × credits unless a save says otherwise.
    super(id, defId, costToPlay ?? game.rules.minBet);
    this.game = game;
  }

  override get math(): GameMath {
    return this.game;
  }

  override setRules(raw: unknown): RulesIssue[] {
    const issues = this.game.setRules(raw);
    syncStake(this, this.game);
    return issues;
  }

  protected spin(rng: Rng, ctx: PlayContext = this.defaultContext()): PlayResult {
    const rounds = roundsForPlay(this.game, this.defId, 1, ctx.dealerSpeed, rng);
    const unit = roundStake(this.defId, ctx.unit);
    return playEngineRounds(this.game, rounds, rng, { ...ctx, unit });
  }

  testSpin(rng: Rng): number {
    return freePlay(this.game, this.costToPlay, rng);
  }
}

export abstract class EngineTable extends SeatedCasinoGame {
  protected readonly game: GameMath;

  constructor(id: string, defId: string, kind: GameKind, costToPlay: number, seats: number) {
    super(id, defId, costToPlay, seats);
    this.game = new GameMath(kind, ENGINE_RULES[defId]);
  }

  override get math(): GameMath {
    return this.game;
  }

  override setRules(raw: unknown): RulesIssue[] {
    const issues = this.game.setRules(raw);
    syncStake(this, this.game);
    return issues;
  }

  protected spin(rng: Rng, ctx: PlayContext = this.defaultContext()): PlayResult {
    const rounds = roundsForPlay(this.game, this.defId, this.seatedCount, ctx.dealerSpeed, rng);
    const unit = roundStake(this.defId, ctx.unit);
    return playEngineRounds(this.game, rounds, rng, { ...ctx, unit });
  }

  testSpin(rng: Rng): number {
    return freePlay(this.game, this.costToPlay, rng);
  }
}
