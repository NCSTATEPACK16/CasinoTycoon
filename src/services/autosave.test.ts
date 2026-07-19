import { describe, expect, it, vi } from 'vitest';
import { TypedEventBus } from '../EventBus';
import { AUTOSAVE_SLOT, type SaveService } from './SaveService';
import { CasinoWorld } from '../sim/world';
import { wireAutosave } from './autosave';

function makeSaveService(overrides: Partial<SaveService> = {}): SaveService {
  return {
    save: vi.fn().mockResolvedValue(undefined),
    load: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('wireAutosave', () => {
  it('does not save on dayEnded before any worldReset/worldLoaded this session', async () => {
    const bus = new TypedEventBus();
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    const svc = makeSaveService();
    wireAutosave(bus, svc, world);

    bus.emit('dayEnded', { day: 1, profit: 0 });
    await Promise.resolve();

    expect(svc.save).not.toHaveBeenCalled();
  });

  it('saves to the autosave slot once armed by worldReset', async () => {
    const bus = new TypedEventBus();
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    const svc = makeSaveService();
    wireAutosave(bus, svc, world);

    bus.emit('worldReset', { scenarioId: null });
    bus.emit('dayEnded', { day: 1, profit: 100 });
    await Promise.resolve();

    expect(svc.save).toHaveBeenCalledTimes(1);
    expect(svc.save).toHaveBeenCalledWith(AUTOSAVE_SLOT, world.toJSON());
  });

  it('saves to the autosave slot once armed by worldLoaded', async () => {
    const bus = new TypedEventBus();
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    const svc = makeSaveService();
    wireAutosave(bus, svc, world);

    bus.emit('worldLoaded', { scenarioId: null });
    bus.emit('dayEnded', { day: 1, profit: 100 });
    await Promise.resolve();

    expect(svc.save).toHaveBeenCalledTimes(1);
  });

  it('tickers a success message only after the save resolves', async () => {
    const bus = new TypedEventBus();
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    const svc = makeSaveService();
    const messages: string[] = [];
    bus.on('tickerMessage', ({ text }) => messages.push(text));
    wireAutosave(bus, svc, world);

    bus.emit('worldReset', { scenarioId: null });
    bus.emit('dayEnded', { day: 1, profit: 100 });
    expect(messages).toEqual([]); // not yet — save is still pending
    await Promise.resolve();
    await Promise.resolve();

    expect(messages).toEqual(['Autosaved.']);
  });

  it('tickers a failure message and never a success message when save rejects', async () => {
    const bus = new TypedEventBus();
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    const svc = makeSaveService({ save: vi.fn().mockRejectedValue(new Error('quota')) });
    const messages: string[] = [];
    bus.on('tickerMessage', ({ text }) => messages.push(text));
    wireAutosave(bus, svc, world);

    bus.emit('worldReset', { scenarioId: null });
    bus.emit('dayEnded', { day: 1, profit: 100 });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(messages).toEqual(['Autosave failed!']);
  });
});
