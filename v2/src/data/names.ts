// Deterministic "flavor" names for guests, seeded from their id. A winners
// list full of "guest-47" is unreadable — this turns ids into people.
//
// Ordinary guests are transient (never saved), so their names only need to be
// stable for the lifetime of a single run. A1b's carded patrons are the
// exception: their name is persisted with the record, not re-derived, so a
// returning patron keeps the name the player learned even across a rebuild of
// this table.
//
// **Pool size is load-bearing, not decoration.** The specific documented
// immersion break for persistent named entities is name repetition — the
// Prison Architect critique. The registry caps at 150 records, and 150 draws
// from a 416-name pool collide with near-certainty, so the pool was widened to
// 64 x 64 = 4,096 before patrons shipped. `uniqueFlavorName` closes the last
// gap by probing past a name already on the roster.

const FIRST_NAMES = [
  'Rita', 'Marcus', 'Dolores', 'Chip', 'Vivian', 'Lonnie', 'Gladys', 'Duke',
  'Sammy', 'Pearl', 'Frankie', 'Connie', 'Tony', 'Ruby', 'Lester', 'Wanda',
  'Sal', 'Estelle', 'Cyril', 'Marlene', 'Bugsy', 'Loretta', 'Herb', 'Rosalind',
  'Ace', 'Doris', 'Vince', 'Bernice', 'Roscoe', 'Ida', 'Gus', 'Thelma',
  'Jules', 'Opal', 'Milton', 'Sylvia', 'Rocco', 'Eunice', 'Dean', 'Bobbie',
  'Nate', 'Harriet', 'Cliff', 'Josephine', 'Mickey', 'Lorna', 'Abe', 'Delia',
  'Buster', 'Norma', 'Reggie', 'Adele', 'Solly', 'Peggy', 'Hank', 'Yvette',
  'Moe', 'Clara', 'Dominic', 'Greta', 'Ellis', 'Mabel', 'Curtis', 'Roxie',
] as const;

const LAST_NAMES = [
  'Calloway', 'Braddock', 'Vitale', 'Okonkwo', 'Marchetti', 'Delgado', 'Farrow', 'Nakamura',
  'Kowalski', 'Sinclair', 'Ferraro', 'Whitlock', 'Ibarra', 'Donnelly', 'Petrosyan', 'Blackwood',
  'Ramirez', 'Halloran', 'Castellano', 'Ashby', 'Novak', 'Guerrero', 'Prescott', 'Rossi',
  'Lindqvist', 'Beaumont', 'Adeyemi', 'Corrigan', 'Salvatore', 'Hobbs', 'Marchand', 'Tanaka',
  'Vasquez', 'Ainsworth', 'Kaminski', 'Duval', 'Osei', 'Falconer', 'Bianchi', 'Mercer',
  'Sandoval', 'Thorne', 'Lombardi', 'Quinlan', 'Reyes', 'Ashcroft', 'Moretti', 'Bhandari',
  'Larkin', 'Esposito', 'Redgrave', 'Amari', 'Sokolov', 'Fitzgerald', 'Pham', 'Vandermeer',
  'Cordova', 'Ellington', 'Radcliffe', 'Zabala', 'Mwangi', 'Stavros', 'Boudreaux', 'Kilbride',
] as const;

/** Distinct "First Last" combinations this table can produce. The registry's
 *  cap must stay well under it — see the header. */
export const NAME_POOL_SIZE = FIRST_NAMES.length * LAST_NAMES.length;

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
  return h;
}

/** The nth name in the pool, in a fixed order. */
function nameAt(index: number): string {
  const i = ((index % NAME_POOL_SIZE) + NAME_POOL_SIZE) % NAME_POOL_SIZE;
  return `${FIRST_NAMES[i % FIRST_NAMES.length]!} ${LAST_NAMES[Math.floor(i / FIRST_NAMES.length)]!}`;
}

/** Same id always yields the same name; different ids usually differ. */
export function flavorName(id: string): string {
  return nameAt(hashString(id));
}

/**
 * `flavorName`, but never one of `taken`.
 *
 * The roster is small against the pool, so the first probe almost always wins;
 * the walk exists because "almost always" over 150 records and a long campaign
 * is not the same as always, and a duplicated patron name is precisely the
 * failure this pool was widened to avoid. Falls back to the plain name once
 * every combination is spoken for, which cannot happen under the roster cap.
 */
export function uniqueFlavorName(id: string, taken: ReadonlySet<string>): string {
  const start = hashString(id);
  for (let probe = 0; probe < NAME_POOL_SIZE; probe++) {
    // A prime stride so the walk tours the whole table rather than clustering
    // on one first name.
    const name = nameAt(start + probe * 61);
    if (!taken.has(name)) return name;
  }
  return nameAt(start);
}
