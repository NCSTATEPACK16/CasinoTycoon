import { describe, expect, it, vi } from 'vitest';
import { FILE_ASSETS, preloadFileAssets } from './atlas';

describe('FILE_ASSETS', () => {
  it('has unique keys', () => {
    const keys = FILE_ASSETS.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every entry has a non-empty key and a relative url', () => {
    for (const asset of FILE_ASSETS) {
      expect(asset.key.length).toBeGreaterThan(0);
      expect(asset.url.length).toBeGreaterThan(0);
      expect(asset.url.startsWith('/')).toBe(false); // Vite public/ paths are relative here
    }
  });

  it('includes the three real casino table sprites', () => {
    const keys = FILE_ASSETS.map((a) => a.key);
    expect(keys).toContain('img-slot-machine');
    expect(keys).toContain('img-blackjack-table');
    expect(keys).toContain('img-craps-table');
  });
});

describe('preloadFileAssets', () => {
  it('calls scene.load.image once per FILE_ASSETS entry with its key and url', () => {
    const image = vi.fn();
    preloadFileAssets({ load: { image } } as unknown as Pick<Phaser.Scene, 'load'>);
    expect(image).toHaveBeenCalledTimes(FILE_ASSETS.length);
    for (const asset of FILE_ASSETS) {
      expect(image).toHaveBeenCalledWith(asset.key, asset.url);
    }
  });
});
