import { describe, expect, it } from 'vitest';
import { OBJECT_CATALOG } from '../data/objects';
import { OBJECT_3D } from './catalog';

describe('OBJECT_3D', () => {
  it('covers every placeable def', () => {
    const missing = OBJECT_CATALOG.map((d) => d.id).filter((id) => !(id in OBJECT_3D));
    expect(missing).toEqual([]);
  });
});
