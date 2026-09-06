import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../app';
import { registerCoreCommands } from '../../commands/coreCommands';
import { CommandRegistry } from '../../commands/registry';
import { useWorkspace } from '../../state/store';
import { EDITOR_COMMANDS } from '../editor/editorCommands';
import { hotkeyReference } from './hotkeyReference';
import { SettingsModal } from './SettingsModal';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('hotkeyReference', () => {
  it('lists commands whose checkCallback fails, fills in unregistered editor commands, hides internal ones', () => {
    const reg = new CommandRegistry();
    reg.register({ id: 'file:delete', name: 'Delete current file', checkCallback: () => false, callback: () => {} });
    reg.register({ id: 'modal:close', name: 'Close modal', hotkey: 'Escape', internal: true, callback: () => {} });
    reg.register({ id: 'editor:toggle-bold', name: 'Toggle bold', hotkey: 'Mod+B', checkCallback: () => false, callback: () => {} });
    const rows = hotkeyReference(reg);
    const expected = ['Delete current file', ...EDITOR_COMMANDS.map((c) => c.name)].sort((a, b) => a.localeCompare(b));
    expect(rows.map((r) => r.name)).toEqual(expected);
    expect(rows.filter((r) => r.id === 'editor:toggle-bold')).toHaveLength(1);
    expect(rows.find((r) => r.id === 'editor:toggle-bold')?.hotkey).toBe('Mod+B');
    expect(rows.some((r) => r.id === 'modal:close')).toBe(false);
  });
});

describe('Settings > Hotkeys', () => {
  let container: HTMLDivElement;
  let root: Root;
  let unregister: () => void;

  beforeEach(() => {
    unregister = registerCoreCommands();
    // No file open and no editor mounted: file:delete and view:toggle-mode fail their checkCallback and the
    // editor commands are not registered at all.
    useWorkspace.setState({ activeFile: null, openTabs: [], graphOpen: false });
    useWorkspace.getState().setModal('settings');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<SettingsModal />));
    act(() => (container.querySelector('[data-testid="settings-nav-hotkeys"]') as HTMLButtonElement).click());
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    useWorkspace.getState().setModal(null);
    unregister();
  });

  const rowNames = () => [...container.querySelectorAll('[data-testid="settings-hotkeys"] tbody tr[data-command] td:first-child')].map((td) => td.textContent);

  it('is a static reference that does not follow the app state', () => {
    expect(app.commands.list().some((c) => c.id === 'view:toggle-mode')).toBe(false);
    expect(app.commands.get('editor:toggle-bold')).toBeUndefined();
    const names = rowNames();
    expect(names).toContain('Toggle reading view');
    expect(names).toContain('Delete current file');
    expect(names).toContain('Toggle bold');
    expect(names).toContain('Search current file');
    expect(names).not.toContain('Close modal');
    expect(names).toEqual(hotkeyReference(app.commands).map((r) => r.name));
  });

  it('filters by name', () => {
    const input = container.querySelector('[data-testid="settings-hotkey-filter"]') as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setValue.call(input, 'toggle bold');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(rowNames()).toEqual(['Toggle bold']);
  });
});
