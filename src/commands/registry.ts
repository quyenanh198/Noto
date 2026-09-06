export interface Command {
  id: string;
  name: string;
  /** Hotkey like `Mod+P`, `Mod+Shift+F`, `Alt+ArrowLeft`. `Mod` is Ctrl (Cmd on macOS). */
  hotkey?: string;
  /** Return false to indicate the command did nothing. */
  callback: () => void | boolean | Promise<void | boolean>;
  /** Commands that don't apply right now can hide from the palette. */
  checkCallback?: () => boolean;
}

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

function normalizeKeyName(key: string): string {
  const map: Record<string, string> = {
    esc: 'escape',
    return: 'enter',
    space: ' ',
    up: 'arrowup',
    down: 'arrowdown',
    left: 'arrowleft',
    right: 'arrowright',
  };
  const k = key.toLowerCase();
  return map[k] ?? k;
}

/** Normalize a hotkey string to a canonical form for matching. */
export function normalizeHotkey(hotkey: string): string {
  const parts = hotkey.split('+').map((p) => p.trim());
  const key = parts.pop() ?? '';
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  const out = new Set<string>();
  if (mods.has('mod')) out.add(IS_MAC ? 'meta' : 'ctrl');
  if (mods.has('ctrl') || mods.has('control')) out.add('ctrl');
  if (mods.has('meta') || mods.has('cmd') || mods.has('command')) out.add('meta');
  if (mods.has('alt') || mods.has('option')) out.add('alt');
  if (mods.has('shift')) out.add('shift');
  return [...out].sort().join('+') + '+' + normalizeKeyName(key);
}

export function hotkeyFromEvent(e: KeyboardEvent): string {
  const mods: string[] = [];
  if (e.ctrlKey) mods.push('ctrl');
  if (e.metaKey) mods.push('meta');
  if (e.altKey) mods.push('alt');
  if (e.shiftKey) mods.push('shift');
  return mods.sort().join('+') + '+' + normalizeKeyName(e.key);
}

/** Human-readable hotkey, e.g. `Ctrl+Shift+F` on Linux/Windows or `⌘⇧F` on macOS. */
export function formatHotkey(hotkey: string): string {
  const parts = hotkey.split('+').map((p) => p.trim());
  const key = parts.pop() ?? '';
  const keyLabel = key.length === 1 ? key.toUpperCase() : key.replace(/^Arrow/, '');
  if (IS_MAC) {
    const sym: Record<string, string> = { mod: '⌘', meta: '⌘', ctrl: '⌃', alt: '⌥', shift: '⇧' };
    return parts.map((p) => sym[p.toLowerCase()] ?? p).join('') + keyLabel;
  }
  const label: Record<string, string> = { mod: 'Ctrl', meta: 'Win', ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift' };
  return [...parts.map((p) => label[p.toLowerCase()] ?? p), keyLabel].join('+');
}

const BARE_KEYS = new Set(['escape', 'f1', 'f2', 'f3', 'f5', 'f11']);

export class CommandRegistry {
  private commands = new Map<string, Command>();
  private byHotkey = new Map<string, string>();
  private listeners = new Set<() => void>();

  register(command: Command): () => void {
    this.commands.set(command.id, command);
    if (command.hotkey) this.byHotkey.set(normalizeHotkey(command.hotkey), command.id);
    this.notify();
    return () => this.unregister(command.id);
  }

  unregister(id: string): void {
    const cmd = this.commands.get(id);
    if (!cmd) return;
    this.commands.delete(id);
    if (cmd.hotkey) {
      const key = normalizeHotkey(cmd.hotkey);
      if (this.byHotkey.get(key) === id) this.byHotkey.delete(key);
    }
    this.notify();
  }

  get(id: string): Command | undefined {
    return this.commands.get(id);
  }

  /** Commands available right now, sorted by name. */
  list(): Command[] {
    return [...this.commands.values()]
      .filter((c) => !c.checkCallback || c.checkCallback())
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async execute(id: string): Promise<boolean> {
    const cmd = this.commands.get(id);
    if (!cmd) return false;
    if (cmd.checkCallback && !cmd.checkCallback()) return false;
    const result = await cmd.callback();
    return result !== false;
  }

  /** Hotkey handler for `keydown`. Returns true when a command consumed the event. */
  handleKeydown(e: KeyboardEvent): boolean {
    if (e.defaultPrevented) return false;
    const bare = !e.ctrlKey && !e.metaKey && !e.altKey;
    if (bare && !BARE_KEYS.has(e.key.toLowerCase())) return false;
    const id = this.byHotkey.get(hotkeyFromEvent(e));
    if (!id) return false;
    const cmd = this.commands.get(id);
    if (!cmd || (cmd.checkCallback && !cmd.checkCallback())) return false;
    e.preventDefault();
    e.stopPropagation();
    void cmd.callback();
    return true;
  }

  on(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }
}
