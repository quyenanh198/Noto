import { beforeEach, describe, expect, it } from 'vitest';
import type { Command } from '../../commands/registry';
import { commandRows, loadRecentCommands, MAX_RECENT_COMMANDS, pushRecentCommand, RECENT_COMMANDS_KEY } from './commandItems';

const cmd = (id: string, name: string): Command => ({ id, name, callback: () => undefined });
const commands = [cmd('file:new', 'Create new note'), cmd('graph:open', 'Open graph view'), cmd('palette:open', 'Open command palette'), cmd('view:toggle-mode', 'Toggle reading view')];

describe('recent commands persistence', () => {
  beforeEach(() => localStorage.clear());

  it('starts empty and remembers the last executed ids, most recent first', () => {
    expect(loadRecentCommands()).toEqual([]);
    pushRecentCommand('a');
    pushRecentCommand('b');
    pushRecentCommand('a');
    expect(loadRecentCommands()).toEqual(['a', 'b']);
    expect(JSON.parse(localStorage.getItem(RECENT_COMMANDS_KEY) ?? '[]')).toEqual(['a', 'b']);
  });

  it('keeps at most five entries', () => {
    for (const id of ['1', '2', '3', '4', '5', '6', '7']) pushRecentCommand(id);
    expect(loadRecentCommands()).toEqual(['7', '6', '5', '4', '3']);
    expect(loadRecentCommands()).toHaveLength(MAX_RECENT_COMMANDS);
  });

  it('ignores corrupt storage', () => {
    localStorage.setItem(RECENT_COMMANDS_KEY, '{not json');
    expect(loadRecentCommands()).toEqual([]);
    localStorage.setItem(RECENT_COMMANDS_KEY, JSON.stringify([1, 'ok', null]));
    expect(loadRecentCommands()).toEqual(['ok']);
  });
});

describe('commandRows', () => {
  it('puts existing recent commands first for a blank query, without duplicates', () => {
    const rows = commandRows('', commands, ['graph:open', 'missing:id', 'file:new']);
    expect(rows.map((r) => r.command.id)).toEqual(['graph:open', 'file:new', 'palette:open', 'view:toggle-mode']);
    expect(rows.map((r) => r.recent)).toEqual([true, true, false, false]);
  });

  it('fuzzy-filters by name with match indices when a query is given', () => {
    const rows = commandRows('toggle reading', commands, ['graph:open']);
    expect(rows.map((r) => r.command.id)).toEqual(['view:toggle-mode']);
    expect(rows[0].recent).toBe(false);
    expect(rows[0].indices).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    const open = commandRows('open', commands, []);
    expect(open.map((r) => r.command.id)).toEqual(['graph:open', 'palette:open']);
  });
});
