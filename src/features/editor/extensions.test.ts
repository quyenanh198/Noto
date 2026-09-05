import { defaultKeymap } from '@codemirror/commands';
import { searchKeymap } from '@codemirror/search';
import { describe, expect, it } from 'vitest';
import { normalizeHotkey } from '../../commands/registry';
import { cmKeyToHotkey, withoutReserved } from './extensions';

describe('cmKeyToHotkey', () => {
  it('maps CodeMirror key names onto registry hotkeys', () => {
    expect(cmKeyToHotkey('Mod-b')).toBe(normalizeHotkey('Mod+B'));
    expect(cmKeyToHotkey('Shift-Mod-f')).toBe(normalizeHotkey('Mod+Shift+F'));
    expect(cmKeyToHotkey('Alt-ArrowLeft')).toBe(normalizeHotkey('Alt+ArrowLeft'));
    expect(cmKeyToHotkey('Mod--')).toBe(normalizeHotkey('Mod+-'));
    expect(cmKeyToHotkey('Mod-/')).toBe(normalizeHotkey('Mod+/'));
  });
});

describe('withoutReserved', () => {
  it('drops bindings for chords the app owns and keeps the rest', () => {
    const reserved = new Set(['Mod+I', 'Mod+F', 'Alt+ArrowLeft'].map(normalizeHotkey));
    const keys = (bindings: readonly { key?: string }[]) => bindings.map((b) => b.key);
    const kept = withoutReserved(defaultKeymap, reserved);
    expect(keys(kept)).not.toContain('Mod-i');
    expect(keys(kept)).not.toContain('Alt-ArrowLeft');
    expect(keys(kept)).toContain('Mod-a');
    expect(keys(kept)).toContain('Enter');
    expect(keys(withoutReserved(searchKeymap, reserved))).not.toContain('Mod-f');
    expect(keys(withoutReserved(searchKeymap, reserved))).toContain('Escape');
  });
});
