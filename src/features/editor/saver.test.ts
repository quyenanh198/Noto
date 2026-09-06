import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAVE_DELAY_MS, Saver } from './saver';

describe('Saver', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounces writes and remembers what was saved', () => {
    const writes: string[] = [];
    const saver = new Saver('initial', (c) => writes.push(c));
    saver.schedule('a');
    saver.schedule('ab');
    vi.advanceTimersByTime(SAVE_DELAY_MS - 1);
    expect(writes).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(writes).toEqual(['ab']);
    expect(saver.lastSaved).toBe('ab');
  });

  it('flushes pending content immediately and skips unchanged content', () => {
    const writes: string[] = [];
    const saver = new Saver('initial', (c) => writes.push(c));
    saver.flush();
    saver.schedule('initial');
    saver.flush();
    expect(writes).toEqual([]);
    saver.schedule('changed');
    saver.flush();
    expect(writes).toEqual(['changed']);
    vi.runAllTimers();
    expect(writes).toEqual(['changed']);
  });

  it('cancel drops pending content', () => {
    const writes: string[] = [];
    const saver = new Saver('', (c) => writes.push(c));
    saver.schedule('x');
    saver.cancel();
    vi.runAllTimers();
    saver.flush();
    expect(writes).toEqual([]);
  });

  describe('with a draft journal', () => {
    const settle = async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    };

    it('journals content synchronously on schedule and clears it once the write has landed', async () => {
      const journal = { write: vi.fn(), clear: vi.fn() };
      let finish!: () => void;
      const saver = new Saver('initial', () => new Promise<void>((resolve) => (finish = resolve)), SAVE_DELAY_MS, journal);
      saver.schedule('a');
      saver.schedule('ab');
      expect(journal.write.mock.calls).toEqual([['a'], ['ab']]);
      saver.flush();
      await settle();
      expect(journal.clear).not.toHaveBeenCalled();
      finish();
      await settle();
      expect(journal.clear.mock.calls).toEqual([['ab']]);
    });

    it('clears the journal when the flushed content was already saved', () => {
      const journal = { write: vi.fn(), clear: vi.fn() };
      const saver = new Saver('same', () => undefined, SAVE_DELAY_MS, journal);
      saver.schedule('same');
      saver.flush();
      expect(journal.clear.mock.calls).toEqual([['same']]);
    });

    it('keeps the journal when the write fails', async () => {
      const journal = { write: vi.fn(), clear: vi.fn() };
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const saver = new Saver('initial', () => Promise.reject(new Error('disk full')), SAVE_DELAY_MS, journal);
      saver.schedule('a');
      saver.flush();
      await settle();
      expect(journal.clear).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalled();
      error.mockRestore();
    });
  });
});
