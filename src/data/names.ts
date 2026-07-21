// Deterministic "flavor" names for guests, seeded from their id. A winners
// list full of "guest-47" is unreadable — this turns ids into people.
// Guests are transient (never saved), so these only need to be stable for
// the lifetime of a single run; the folded-in DailyRecord stores the
// resulting string, not the id, so saves never depend on this staying stable.

const FIRST_NAMES = [
  'Rita',
  'Marcus',
  'Dolores',
  'Chip',
  'Vivian',
  'Lonnie',
  'Gladys',
  'Duke',
  'Sammy',
  'Pearl',
  'Frankie',
  'Connie',
  'Tony',
  'Ruby',
  'Lester',
  'Wanda',
] as const;

const LAST_INITIALS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Same id always yields the same name; different ids usually differ. */
export function flavorName(id: string): string {
  const h = hashString(id);
  const first = FIRST_NAMES[h % FIRST_NAMES.length]!;
  const last = LAST_INITIALS[Math.floor(h / FIRST_NAMES.length) % LAST_INITIALS.length]!;
  return `${first} ${last}.`;
}
