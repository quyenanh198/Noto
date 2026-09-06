import type { CommandRegistry } from '../../commands/registry';
import { EDITOR_COMMANDS } from '../editor/editorCommands';

export interface HotkeyRow {
  id: string;
  name: string;
  hotkey?: string;
}

/**
 * Rows of the Settings > Hotkeys reference: every command the app knows, whether or not it applies right now
 * (the palette is where `checkCallback` filters). Editor commands are registered only while an editor is mounted,
 * so the static list fills them in for the reading view, the graph and the empty state; internal plumbing stays out.
 */
export function hotkeyReference(commands: Pick<CommandRegistry, 'all'>): HotkeyRow[] {
  const rows = new Map<string, HotkeyRow>();
  for (const c of commands.all()) if (!c.internal) rows.set(c.id, { id: c.id, name: c.name, hotkey: c.hotkey });
  for (const c of EDITOR_COMMANDS) if (!rows.has(c.id)) rows.set(c.id, { id: c.id, name: c.name, hotkey: c.hotkey });
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
}
