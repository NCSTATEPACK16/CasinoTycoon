import { describe, expect, it } from 'vitest';
import { isCloudConfigured } from './supabase';

describe('supabase config', () => {
  it('reports unconfigured when either env var is missing', () => {
    expect(isCloudConfigured({ url: '', key: '' })).toBe(false);
    expect(isCloudConfigured({ url: 'https://x.supabase.co', key: '' })).toBe(false);
    expect(isCloudConfigured({ url: '', key: 'sb_publishable_x' })).toBe(false);
  });

  it('reports configured only when both are present', () => {
    expect(isCloudConfigured({ url: 'https://x.supabase.co', key: 'sb_publishable_x' })).toBe(true);
  });
});
