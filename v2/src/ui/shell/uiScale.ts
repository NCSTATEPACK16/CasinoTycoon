// B15b: the UI scale (80–125%). One number on <html> (--ui-scale) sets the
// root font size, and every surface is sized in rem, so this is the whole
// mechanism. Saved with the other settings.

export const UI_SCALE_KEY = 'v2-ui-scale';
export const UI_SCALE_MIN = 0.8;
export const UI_SCALE_MAX = 1.25;
export const UI_SCALE_STEP = 0.05;

/** Into range and onto the 5% steps the slider offers; junk becomes 100%. */
export function clampUiScale(v: number): number {
  if (!Number.isFinite(v)) return 1;
  const stepped = Math.round(v / UI_SCALE_STEP) * UI_SCALE_STEP;
  return Math.round(Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, stepped)) * 100) / 100;
}

export function loadUiScale(storage: Pick<Storage, 'getItem'> | null): number {
  try {
    const raw = storage?.getItem(UI_SCALE_KEY);
    if (raw != null && raw !== '') return clampUiScale(Number(raw));
  } catch {
    // Storage blocked: 100%.
  }
  return 1;
}

export function saveUiScale(storage: Pick<Storage, 'setItem'> | null, v: number): void {
  try {
    storage?.setItem(UI_SCALE_KEY, String(clampUiScale(v)));
  } catch {
    // Applies for this session only.
  }
}

export function applyUiScale(root: Pick<HTMLElement, 'style'>, v: number): void {
  root.style.setProperty('--ui-scale', String(clampUiScale(v)));
}
