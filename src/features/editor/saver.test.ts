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
});
