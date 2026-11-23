import { describe, expect, it } from 'vitest';
import { AgentKind, Anim, type ObjectView } from '../shared/contracts';
import { CLIP_CHIPS, CLIP_PRESS, CLIP_SPIN, FEMALE_NEVER, lookFor, MALE_NEVER, partBit, PARTS, simClip } from './Crowd';
import { GameSpots } from './gameSpots';

const has = (style: number, p: (typeof PARTS)[number]) => (style & partBit(p)) !== 0;

describe('lookFor', () => {
  it('always picks exactly one body build, and wears one at most of each hat', () => {
    for (let h = 0; h < 4000; h++) {
      for (const kind of [AgentKind.Guest, AgentKind.Dealer, AgentKind.Janitor, AgentKind.Security, AgentKind.Staff]) {
        const { style, female } = lookFor(kind, h % 6, Math.imul(h, 2654435761) >>> 0);
        expect(has(style, 'male')).toBe(!female);
        expect(has(style, 'female')).toBe(female);
        const hats = ['fedora', 'cap', 'cowboy'].filter((p) => has(style, p as never)).length;
        expect(hats).toBeLessThanOrEqual(1);
        // A build-specific garment always matches the build.
        if (has(style, 'vestM') || has(style, 'bibM')) expect(female).toBe(false);
        if (has(style, 'vestF') || has(style, 'bibF')) expect(female).toBe(true);
        expect(style).toBeLessThan(1 << PARTS.length);
        // Each build's draw leaves out parts that build never wears; nobody may wear one.
        expect(style & (female ? FEMALE_NEVER : MALE_NEVER)).toBe(0);
      }
    }
  });

  it('gives guests visible variety: both builds, several hairstyles, skirts and hats', () => {
    const looks = Array.from({ length: 500 }, (_, i) => lookFor(AgentKind.Guest, i % 4, Math.imul(i + 1, 2246822519) >>> 0));
    const styles = new Set(looks.map((l) => l.style));
    expect(styles.size).toBeGreaterThan(40);
    expect(looks.filter((l) => l.female).length).toBeGreaterThan(150);
    expect(looks.some((l) => has(l.style, 'skirt'))).toBe(true);
    expect(looks.some((l) => has(l.style, 'cowboy'))).toBe(true);
    for (const p of ['hairLong', 'hairBun', 'hairPony', 'hairCurly'] as const) expect(looks.some((l) => has(l.style, p))).toBe(true);
    // Bald men exist; nobody has a bun under a hat.
    expect(looks.some((l) => !l.female && !(l.style & (partBit('hairCap') | partBit('hairCurly'))))).toBe(true);
    for (const l of looks) if (has(l.style, 'cap') || has(l.style, 'fedora') || has(l.style, 'cowboy')) expect(has(l.style, 'hairBun')).toBe(false);
  });

  it('dresses each staff role in its uniform', () => {
    const at = (kind: number, variant: number) => lookFor(kind, variant, 0x55555555).style;
    expect(has(at(AgentKind.Dealer, 0), 'bowtie')).toBe(true);
    expect(has(at(AgentKind.Dealer, 0), 'vestM') || has(at(AgentKind.Dealer, 0), 'vestF')).toBe(true);
    expect(has(at(AgentKind.Security, 0), 'jacket')).toBe(true);
    expect(has(at(AgentKind.Janitor, 0), 'cap')).toBe(true);
    expect(has(at(AgentKind.Staff, 1), 'apron')).toBe(true); // bartender
    expect(has(at(AgentKind.Staff, 2), 'apron')).toBe(true); // waitress
    expect(has(at(AgentKind.Staff, 4), 'jacket')).toBe(true); // pit boss
    const mech = at(AgentKind.Staff, 5);
    expect(has(mech, 'bibM') || has(mech, 'bibF')).toBe(true);
    expect(lookFor(AgentKind.Staff, 5, 1).outfit).not.toBe(lookFor(AgentKind.Janitor, 0, 1).outfit);
  });
});

describe('simClip', () => {
  it('maps play to a button press at machines, chips at tables, and the spin for a roulette croupier', () => {
    expect(simClip(Anim.Play, AgentKind.Guest, 'slots')).toBe(CLIP_PRESS);
    expect(simClip(Anim.Play, AgentKind.Guest, '')).toBe(CLIP_PRESS);
    expect(simClip(Anim.Play, AgentKind.Guest, 'blackjack')).toBe(CLIP_CHIPS);
    expect(simClip(Anim.Play, AgentKind.Guest, undefined)).toBe(Anim.Play);
    expect(simClip(Anim.Play, AgentKind.Dealer, 'roulette')).toBe(CLIP_SPIN);
    expect(simClip(Anim.Play, AgentKind.Dealer, 'blackjack')).toBe(7);
    expect(simClip(Anim.Walk, AgentKind.Guest, 'slots')).toBe(Anim.Walk);
  });
});

describe('GameSpots', () => {
  const o = (id: string, defId: string, col: number, row: number): ObjectView => ({ id, defId, col, row, rot: 0, broken: false, open: true, occupants: 0 });

  it('finds the nearest gaming object around a seat', () => {
    const g = new GameSpots();
    g.set([o('a', 'slot-machine', 5, 5), o('b', 'roulette-table', 10, 5), o('c', 'plant', 20, 20)]);
    expect(g.at(5.5, 6.6)).toBe('slots'); // the stool in front of the slot
    expect(g.at(11.2, 4.4)).toBe('roulette');
    expect(g.at(20.5, 20.5)).toBeUndefined(); // a plant isn't a game
    expect(g.at(40, 40)).toBeUndefined();
  });
});
