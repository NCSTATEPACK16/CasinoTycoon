import type { CasinoWorldJSON } from '../sim/world';
import { acceptEnvelope, SAVE_VERSION, type EnvelopeResult } from './migrations';
import type { SaveEnvelope } from './SaveService';

/**
 * Save portability — export and import the save envelope as a file.
 *
 * Browser storage can be cleared without warning, by the browser itself or by
 * anything the player runs to tidy their machine, and a campaign is hours of
 * play. With the migration ladder in place a manual backup path costs almost
 * nothing: an exported file is the *same envelope* a slot holds, so it reads
 * back through `acceptEnvelope` and migrates forward exactly like a slot does.
 * A file exported today still loads after the next three schema changes.
 *
 * Everything here is pure. The DOM half — a download link and a file input —
 * lives in the panel, so the format and its failure modes stay testable.
 */

/** The envelope, pretty-printed. A save the player can open in a text editor
 *  is a save they can reason about when something has gone wrong. */
export function exportSaveText(world: CasinoWorldJSON, now: Date = new Date()): string {
  const env: SaveEnvelope = { version: SAVE_VERSION, savedAt: now.toISOString(), world };
  return `${JSON.stringify(env, null, 2)}\n`;
}

/**
 * A filename that says what the file is without being opened.
 *
 * Day and scenario go in the name because the common case is several exports
 * in one downloads folder, and a timestamp alone makes the player open each
 * one to find the run they wanted.
 */
export function exportFileName(world: CasinoWorldJSON, now: Date = new Date()): string {
  const scenario = world.scenario?.def.name ?? 'sandbox';
  const slug = scenario
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const stamp = now.toISOString().slice(0, 10);
  return `casino-tycoon-${slug || 'sandbox'}-day-${world.time.day}-${stamp}.json`;
}

/**
 * Read a file the player picked.
 *
 * Reuses the same gate both save backends read through, so an imported file
 * gets migrations, the newer-than-this-build report, and the unreadable case
 * with identical behaviour. A file is not a more trusted input than a slot —
 * it is less — so nothing here parses more leniently.
 */
export function importSaveText(text: string): EnvelopeResult {
  try {
    return acceptEnvelope(JSON.parse(text));
  } catch {
    return { status: 'unreadable', savedAt: null, world: null };
  }
}

/** What to tell the player about an import that did not load. */
export const IMPORT_FAILURE_MESSAGE: Record<'newer' | 'unreadable', string> = {
  newer: 'That file was made by a newer version of the game — update to load it.',
  unreadable: 'That file is not a Casino Tycoon save.',
};
