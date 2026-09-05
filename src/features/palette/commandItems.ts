import type { Command } from '../../commands/registry';
import { fuzzyFilter } from '../../core/search/fuzzy';

export const RECENT_COMMANDS_KEY = 'noto-recent-commands';
export const MAX_RECENT_COMMANDS = 5;

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Ids of the most recently executed commands, most recent first. Never throws. */
export function loadRecentCommands(): string[] {
  try {
    const raw = storage()?.getItem(RECENT_COMMANDS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENT_COMMANDS) : [];
  } catch {
    return [];
  }
}

/** Move `id` to the front of the recent list and persist it. Returns the new list. */
export function pushRecentCommand(id: string): string[] {
  const next = [id, ...loadRecentCommands().filter((x) => x !== id)].slice(0, MAX_RECENT_COMMANDS);
  try {
    storage()?.setItem(RECENT_COMMANDS_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private mode, quota): the list is still returned for this session.
  }
  return next;
}

export interface CommandRow {
  command: Command;
  /** Matched character indices in the command name. */
  indices: number[];
  /** True for rows in the "Recently used" section. */
  recent: boolean;
}

/** Rows for the command palette: recent commands first when the query is blank, otherwise fuzzy-ranked by name. */
export function commandRows(query: string, commands: Command[], recentIds: string[]): CommandRow[] {
  if (!query.trim()) {
    const byId = new Map(commands.map((c) => [c.id, c]));
    const recent = recentIds.map((id) => byId.get(id)).filter((c): c is Command => c !== undefined);
    const recentSet = new Set(recent.map((c) => c.id));
    return [
      ...recent.map((command) => ({ command, indices: [], recent: true })),
      ...commands.filter((c) => !recentSet.has(c.id)).map((command) => ({ command, indices: [], recent: false })),
    ];
  }
  return fuzzyFilter(query, commands, (c) => c.name).map((r) => ({ command: r.item, indices: r.indices, recent: false }));
}
