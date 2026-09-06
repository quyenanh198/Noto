import { app } from '../app';
import { dirname, joinPath, validateNotePath } from '../core/vault/path';
import { useWorkspace } from '../state/store';
import { IS_MAC } from './registry';

/**
 * History navigation. Windows/Linux use the browser's Alt+Arrow convention. On macOS that chord is
 * CodeMirror's word movement (and Cmd+Alt+Arrow is the browser's own tab switching), so Ctrl+Alt+Arrow
 * is used there instead.
 */
export const NAV_BACK_HOTKEY = IS_MAC ? 'Ctrl+Alt+ArrowLeft' : 'Alt+ArrowLeft';
export const NAV_FORWARD_HOTKEY = IS_MAC ? 'Ctrl+Alt+ArrowRight' : 'Alt+ArrowRight';

/** Local date as `YYYY-MM-DD`. */
export function todayStamp(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Create a new untitled note next to the active file and open it. Returns the created path. */
export async function createNewNote(folder?: string): Promise<string> {
  const ws = useWorkspace.getState();
  const dir = folder ?? (ws.activeFile ? dirname(ws.activeFile) : '');
  const file = await app.vault.createUnique(joinPath(dir, 'Untitled.md'));
  ws.openFile(file.path);
  return file.path;
}

/** Open (creating if needed) the note a wikilink points to. */
export async function openLink(target: string, fromPath: string | null, options: { heading?: string; newTab?: boolean } = {}): Promise<void> {
  const ws = useWorkspace.getState();
  let path = app.vault.resolveLink(target, fromPath ?? '');
  if (!path) {
    const candidate = target.includes('/') ? target : joinPath(fromPath ? dirname(fromPath) : '', target);
    // Targets such as `[[/]]` or `[[..]]` would otherwise create a note literally named ".md".
    if (validateNotePath(candidate) !== null) return;
    const created = await app.vault.createUnique(candidate);
    path = created.path;
  }
  ws.openFile(path, { heading: options.heading, newTab: options.newTab });
}

/** Registers the commands that ship with the app shell. Returns an unregister function. */
export function registerCoreCommands(): () => void {
  const ws = () => useWorkspace.getState();
  const unregisters = [
    // Browsers never hand Ctrl/Cmd+N and Ctrl/Cmd+W to the page (new window, close tab), so these get the Alt variant.
    app.commands.register({ id: 'file:new', name: 'Create new note', hotkey: 'Mod+Alt+N', callback: () => void createNewNote() }),
    app.commands.register({
      id: 'file:close',
      name: 'Close current tab',
      hotkey: 'Mod+Alt+W',
      callback: () => {
        const s = ws();
        if (s.activeFile) s.closeTab(s.activeFile);
      },
    }),
    app.commands.register({
      id: 'file:delete',
      name: 'Delete current file',
      checkCallback: () => ws().activeFile !== null,
      callback: async () => {
        const path = ws().activeFile;
        if (!path) return false;
        if (!window.confirm(`Delete "${path}"?`)) return false;
        await app.vault.delete(path);
      },
    }),
    app.commands.register({
      id: 'view:toggle-mode',
      name: 'Toggle reading view',
      hotkey: 'Mod+E',
      checkCallback: () => ws().activeFile !== null && !ws().graphOpen,
      callback: () => ws().toggleViewMode(),
    }),
    app.commands.register({ id: 'view:toggle-left-sidebar', name: 'Toggle left sidebar', callback: () => ws().toggleLeftSidebar() }),
    app.commands.register({ id: 'view:toggle-right-sidebar', name: 'Toggle right sidebar', callback: () => ws().toggleRightSidebar() }),
    app.commands.register({ id: 'view:files', name: 'Show file explorer', callback: () => ws().setLeftTab('files') }),
    app.commands.register({ id: 'view:tags', name: 'Show tags pane', callback: () => ws().setLeftTab('tags') }),
    app.commands.register({ id: 'view:backlinks', name: 'Show backlinks', callback: () => ws().setRightTab('backlinks') }),
    app.commands.register({ id: 'view:outline', name: 'Show outline', callback: () => ws().setRightTab('outline') }),
    app.commands.register({ id: 'view:local-graph', name: 'Show local graph', callback: () => ws().setRightTab('graph') }),
    app.commands.register({ id: 'search:open', name: 'Search in all files', hotkey: 'Mod+Shift+F', callback: () => ws().focusSearch() }),
    app.commands.register({ id: 'graph:open', name: 'Open graph view', hotkey: 'Mod+G', callback: () => ws().setGraphOpen(!ws().graphOpen) }),
    app.commands.register({ id: 'palette:open', name: 'Open command palette', hotkey: 'Mod+P', callback: () => ws().setModal('commands') }),
    app.commands.register({ id: 'switcher:open', name: 'Quick switcher: open note', hotkey: 'Mod+O', callback: () => ws().setModal('switcher') }),
    app.commands.register({ id: 'settings:open', name: 'Open settings', hotkey: 'Mod+,', callback: () => ws().setModal('settings') }),
    app.commands.register({ id: 'theme:toggle', name: 'Toggle dark/light theme', callback: () => ws().toggleTheme() }),
    app.commands.register({ id: 'nav:back', name: 'Navigate back', hotkey: NAV_BACK_HOTKEY, callback: () => ws().goBack() }),
    app.commands.register({ id: 'nav:forward', name: 'Navigate forward', hotkey: NAV_FORWARD_HOTKEY, callback: () => ws().goForward() }),
    app.commands.register({
      id: 'daily-note:open',
      name: "Open today's daily note",
      hotkey: 'Mod+Shift+D',
      callback: async () => {
        const path = `Daily/${todayStamp()}.md`;
        if (!app.vault.exists(path)) await app.vault.create(path, `# ${todayStamp()}\n\n`);
        ws().openFile(path);
      },
    }),
    app.commands.register({
      id: 'editor:zoom-in',
      name: 'Increase font size',
      hotkey: 'Mod+=',
      callback: () => ws().setFontSize(ws().fontSize + 1),
    }),
    app.commands.register({
      id: 'editor:zoom-out',
      name: 'Decrease font size',
      hotkey: 'Mod+-',
      callback: () => ws().setFontSize(ws().fontSize - 1),
    }),
    app.commands.register({
      id: 'modal:close',
      name: 'Close modal',
      hotkey: 'Escape',
      checkCallback: () => ws().modal !== null,
      callback: () => ws().setModal(null),
    }),
  ];
  return () => unregisters.forEach((u) => u());
}
