import { describe, expect, it } from 'vitest';
import { CommandRegistry, formatHotkey, hotkeyFromEvent, normalizeHotkey } from './registry';

describe('hotkeys', () => {
  it('normalizes modifier order and Mod', () => {
    expect(normalizeHotkey('Shift+Mod+F')).toBe('ctrl+shift+f');
    expect(normalizeHotkey('Ctrl+Mod+p')).toBe('ctrl+p');
    expect(normalizeHotkey('Alt+ArrowLeft')).toBe('alt+arrowleft');
    expect(normalizeHotkey('Escape')).toBe('+escape');
  });
  it('matches events', () => {
    const e = new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true });
    expect(hotkeyFromEvent(e)).toBe(normalizeHotkey('Mod+Shift+P'));
  });
  it('formats', () => {
    expect(formatHotkey('Mod+Shift+F')).toBe('Ctrl+Shift+F');
    expect(formatHotkey('Alt+ArrowLeft')).toBe('Alt+Left');
  });
});

describe('CommandRegistry', () => {
  it('registers, lists, executes, dispatches hotkeys', async () => {
    const reg = new CommandRegistry();
    const calls: string[] = [];
    const off = reg.register({ id: 'b', name: 'Bravo', hotkey: 'Mod+B', callback: () => void calls.push('b') });
    reg.register({ id: 'a', name: 'Alpha', callback: () => { calls.push('a'); return false; } });
    reg.register({ id: 'hidden', name: 'Hidden', hotkey: 'Mod+H', checkCallback: () => false, callback: () => void calls.push('hidden') });
    expect(reg.list().map((c) => c.id)).toEqual(['a', 'b']);
    expect(await reg.execute('a')).toBe(false);
    expect(await reg.execute('b')).toBe(true);
    expect(await reg.execute('missing')).toBe(false);
    expect(await reg.execute('hidden')).toBe(false);
    expect(reg.handleKeydown(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, cancelable: true }))).toBe(true);
    expect(reg.handleKeydown(new KeyboardEvent('keydown', { key: 'h', ctrlKey: true }))).toBe(false);
    expect(reg.handleKeydown(new KeyboardEvent('keydown', { key: 'b' }))).toBe(false);
    off();
    expect(reg.handleKeydown(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true }))).toBe(false);
    expect(calls).toEqual(['a', 'b', 'b']);
  });
});
