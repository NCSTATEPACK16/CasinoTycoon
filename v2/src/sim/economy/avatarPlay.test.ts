import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../../EventBus';
import { SANDBOX } from '../../data/campaigns';
import { runCommand } from '../../worker/commands';
import { SnapshotBuilder } from '../../worker/snapshot';
import { SeatedCasinoGame } from '../entities/machines/SeatedCasinoGame';
import { CasinoWorld, PLAYER_SEAT } from '../world';
import { casinoFinancials } from './financials';
import { PLAYER_START_WALLET, type PlayerRoundReply } from './PlayerPlay';

afterEach(() => eventBus.clear());

function setup() {
  const world = new CasinoWorld({ seed: 3, autoSpawn: false });
  world.state.cash = 100_000;
  const snap = new SnapshotBuilder();
  const ids = {
    blackjack: world.place('blackjack-table', 4, 4)!.id,
    roulette: world.place('roulette-table', 10, 4)!.id,
    craps: world.place('craps-table', 16, 4)!.id,
    uth: world.place('poker-table', 22, 4)!.id,
    slots: world.place('slot-machine', 4, 12)!.id,
  };
  return { world, snap, ids };
}

/** Play a round to the end through the commands, taking the reference action. */
function playThrough(
  world: CasinoWorld,
  snap: SnapshotBuilder,
  objectId: string,
  bets: { spot: string; amount: number }[],
): PlayerRoundReply {
  let res = runCommand(world, snap, { type: 'roundBegin', objectId, bets });
  expect(res.ok, res.ok ? '' : res.error).toBe(true);
  let reply = (res as { data: PlayerRoundReply }).data;
  for (let guard = 0; reply.options && guard < 200; guard++) {
    const math = world.machines.get(objectId)!.math!;
    // The engine's reference strategy, read from the reply's view the way a UI hint would.
    const action =
      math.kind === 'blackjack'
        ? (math.engine as typeof math.engine & { strategyFor: Function }).strategyFor(
            math.rules,
            reply.view,
            reply.options,
          )
        : math.engine.strategy(reply.view, reply.options);
    res = runCommand(world, snap, { type: 'roundAct', objectId, action });
    expect(res.ok, res.ok ? '' : res.error).toBe(true);
    reply = (res as { data: PlayerRoundReply }).data;
  }
  return reply;
}

describe('avatar play', () => {
  it('plays one round of every game through roundBegin / roundAct', () => {
    const { world, snap, ids } = setup();
    const bets = {
      blackjack: [{ spot: 'main', amount: 25 }],
      roulette: [{ spot: 'red', amount: 20 }],
      craps: [{ spot: 'pass', amount: 10 }],
      uth: [{ spot: 'ante', amount: 10 }],
      slots: [{ spot: 'spin', amount: 10 }],
    };
    for (const [game, id] of Object.entries(ids)) {
      const reply = playThrough(world, snap, id, bets[game as keyof typeof bets]);
      expect(reply.options, game).toBeNull();
      expect(reply.result!.wagered, game).toBeGreaterThan(0);
      expect(reply.result!.summary.length, game).toBeGreaterThan(0);
    }
    expect(world.ledger.todayPlayer.rounds).toBe(5);
  });

  it('needs a free seat: a full table turns the avatar away, and it holds its seat', () => {
    const { world, snap, ids } = setup();
    const table = world.machines.get(ids.blackjack) as SeatedCasinoGame;
    for (let i = 0; i < table.seatCount; i++) table.claimSeat(`g${i}`);
    const bet = [{ spot: 'main', amount: 25 }];
    expect(runCommand(world, snap, { type: 'sit', objectId: ids.blackjack })).toEqual({
      ok: false,
      error: 'every seat is taken',
    });
    expect(
      runCommand(world, snap, { type: 'roundBegin', objectId: ids.blackjack, bets: bet }).ok,
    ).toBe(false);
    // A guest leaves: the avatar takes that seat, and the next guest can't.
    table.release('g1');
    expect(runCommand(world, snap, { type: 'sit', objectId: ids.blackjack }).ok).toBe(true);
    expect(table.seatOf(PLAYER_SEAT)).toBe(1);
    expect(table.isAvailable).toBe(false);
    expect(snap.build(world, 0).objects!.find((o) => o.id === ids.blackjack)!.occupants).toBe(
      table.seatCount,
    );
    // Standing frees it again; a single-player machine in use is refused too.
    runCommand(world, snap, { type: 'stand' });
    expect(table.isSeatFree(1)).toBe(true);
    world.machines.get(ids.slots)!.reservedBy = 'g9';
    expect(runCommand(world, snap, { type: 'sit', objectId: ids.slots })).toEqual({
      ok: false,
      error: 'someone is already playing',
    });
  });

  it('moves money between the player wallet and the house, through the ledger', () => {
    const { world, snap, ids } = setup();
    const cash = world.state.cash;
    const reply = playThrough(world, snap, ids.roulette, [{ spot: 'black', amount: 50 }]);
    const net = reply.result!.wagered - reply.result!.returned;
    expect(reply.wallet).toBe(PLAYER_START_WALLET - net);
    expect(reply.onTable).toBe(0);
    expect(world.player.wallet).toBe(reply.wallet);
    expect(world.state.cash).toBe(cash + net);
    const row = world.ledger.sources.get(ids.roulette)!;
    expect(row).toMatchObject({ wagered: 50, rounds: 1, revenue: net });
    expect(casinoFinancials(world.ledger).player).toMatchObject({ wagered: 50, rounds: 1 });
  });

  it('refuses bets outside the limits or beyond the wallet, and actions out of turn', () => {
    const { world, snap, ids } = setup();
    const bad = (cmd: Parameters<typeof runCommand>[2]) => {
      const res = runCommand(world, snap, cmd);
      expect(res.ok).toBe(false);
      return (res as { error: string }).error;
    };
    expect(
      bad({ type: 'roundBegin', objectId: ids.blackjack, bets: [{ spot: 'main', amount: 2 }] }),
    ).toMatch(/\$5–\$1000/);
    world.player.wallet = 40;
    expect(
      bad({ type: 'roundBegin', objectId: ids.roulette, bets: [{ spot: 'red', amount: 50 }] }),
    ).toMatch(/wallet/);
    expect(bad({ type: 'roundAct', objectId: ids.roulette, action: 'spin' })).toMatch(/no round/);
    expect(
      bad({ type: 'roundBegin', objectId: 'nope', bets: [{ spot: 'red', amount: 10 }] }),
    ).toBeTruthy();
  });

  it('reports the stake in play until the round settles', () => {
    const { world, snap, ids } = setup();
    const res = runCommand(world, snap, {
      type: 'roundBegin',
      objectId: ids.blackjack,
      bets: [{ spot: 'main', amount: 25 }],
    });
    const reply = (res as { data: PlayerRoundReply }).data;
    expect(reply.options).not.toBeNull();
    // The bankroll moves only on settlement; the stake is reported beside it.
    expect(reply.wallet).toBe(PLAYER_START_WALLET);
    expect(reply.onTable).toBe(25);
    const fin = runCommand(world, snap, { type: 'financials' }) as { data: { onTable: number } };
    expect(fin.data.onTable).toBe(25);
    const done = playThrough(world, snap, ids.roulette, [{ spot: 'red', amount: 20 }]);
    expect(done.onTable).toBe(25);
  });

  it('a double the wallet cannot cover is refused mid-round', () => {
    const { world, snap, ids } = setup();
    world.player.wallet = 30;
    const begin = runCommand(world, snap, {
      type: 'roundBegin',
      objectId: ids.blackjack,
      bets: [{ spot: 'main', amount: 25 }],
    });
    expect(begin.ok).toBe(true);
    const reply = (begin as { data: PlayerRoundReply }).data;
    if (reply.options?.includes('double')) {
      const res = runCommand(world, snap, {
        type: 'roundAct',
        objectId: ids.blackjack,
        action: 'double',
      });
      expect(res.ok).toBe(false);
    }
  });

  it('the wallet is saved and restored', () => {
    const { world, ids, snap } = setup();
    playThrough(world, snap, ids.slots, [{ spot: 'spin', amount: 10 }]);
    const wallet = world.player.wallet;
    const copy = CasinoWorld.fromJSON(JSON.parse(JSON.stringify(world.toJSON())));
    expect(copy.player.wallet).toBe(wallet);
  });

  it('setRules replies with the applied rules and every clamp', () => {
    const { world, snap, ids } = setup();
    const res = runCommand(world, snap, {
      type: 'setRules',
      objectId: ids.blackjack,
      rules: { blackjackPays: '6:5', decks: 5 },
    });
    expect(res.ok).toBe(true);
    const data = (
      res as { data: { rules: { blackjackPays: string }; issues: { field: string }[] } }
    ).data;
    expect(data.rules.blackjackPays).toBe('6:5');
    expect(data.issues.map((i) => i.field)).toEqual(['decks']);
    expect(runCommand(world, snap, { type: 'setRules', objectId: 'nope', rules: {} }).ok).toBe(
      false,
    );
  });
});

describe('Sandbox', () => {
  it('starts endless with money no object', () => {
    const { world, snap } = setup();
    expect(runCommand(world, snap, { type: 'startScenario', scenarioId: 'sandbox' }).ok).toBe(true);
    expect(world.state.cash).toBe(SANDBOX.startingCash);
    expect(world.scenario!.status).toBe('endless');
    expect(world.scenario!.isAllowed('high-limit-table')).toBe(true);
  });
});
