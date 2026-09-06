import { CommandRegistry } from './commands/registry';
import { MetadataIndex } from './core/index/MetadataIndex';
import { activateVault, getBrowserAdapter, isSampleVaultSeeded, loadSavedVault, markSampleVaultSeeded, vaultLabelFor } from './core/vault/vaultManager';
import { Vault } from './core/vault/Vault';
import { SAMPLE_VAULT } from './core/vault/sampleVault';
import type { StorageAdapter } from './core/types';
import { replayDraft } from './features/editor/draftJournal';
import { useWorkspace } from './state/store';

/** Singleton services shared by the whole UI. */
export interface NotoApp {
  vault: Vault;
  index: MetadataIndex;
  commands: CommandRegistry;
}

function createApp(adapter: StorageAdapter): NotoApp {
  const vault = new Vault(adapter);
  const index = new MetadataIndex(vault);
  const commands = new CommandRegistry();
  vault.on((e) => {
    const ws = useWorkspace.getState();
    if (e.type === 'rename') ws.fileRenamed(e.oldPath, e.newPath);
    if (e.type === 'folder-rename') ws.folderRenamed(e.oldPath, e.newPath);
    if (e.type === 'delete') ws.fileDeleted(e.path);
    if (e.type === 'folder-delete' || e.type === 'reload') {
      // Drop tabs and history entries whose files no longer exist.
      for (const path of new Set([...ws.openTabs, ...ws.history])) if (!vault.exists(path)) ws.fileDeleted(path);
    }
  });
  return { vault, index, commands };
}

export const app: NotoApp = createApp(getBrowserAdapter());

/** Switch the running app to another storage backend (used by the settings modal). */
export function switchVault(adapter: StorageAdapter): Promise<void> {
  return activateVault(app, adapter);
}

/** Load the last-used vault (seeding the sample notes into a fresh browser vault) and attach the index. */
export async function bootstrap(): Promise<void> {
  let adapter: StorageAdapter;
  try {
    adapter = await loadSavedVault();
    await app.vault.switchAdapter(adapter);
  } catch (error) {
    // A saved folder that cannot be read any more (moved, deleted, unreadable entries) must not leave
    // the app stuck on the loading screen; browser storage keeps the shell and the settings reachable.
    console.error('Could not open the saved vault; using browser storage instead.', error);
    adapter = getBrowserAdapter();
    await app.vault.switchAdapter(adapter);
  }
  if (adapter.kind === 'indexeddb' && !(await isSampleVaultSeeded())) {
    if (app.vault.getFiles().length === 0) {
      for (const f of SAMPLE_VAULT.files) await app.vault.create(f.path, f.content);
      for (const d of SAMPLE_VAULT.folders) if (!app.vault.folderExists(d)) await app.vault.createFolder(d);
    }
    await markSampleVaultSeeded();
  }
  // Recover what was typed right before the last unload (the editor's debounced save may not have landed).
  await replayDraft(app.vault).catch((err: unknown) => console.error(err));
  app.index.attach();
  let ws = useWorkspace.getState();
  ws.setVaultLabel(vaultLabelFor(adapter));
  for (const tab of ws.openTabs) if (!app.vault.exists(tab)) ws.fileDeleted(tab);
  ws = useWorkspace.getState();
  // Go through openFile even for the restored note so it is the first history entry and Back can return to it.
  const first = (ws.activeFile && app.vault.getFile(ws.activeFile)) || app.vault.getFile('Welcome.md') || app.vault.getMarkdownFiles()[0];
  if (first) ws.openFile(first.path);
  ws.setReady(true);
}
