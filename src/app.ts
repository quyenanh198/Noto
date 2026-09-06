import { CommandRegistry } from './commands/registry';
import { MetadataIndex } from './core/index/MetadataIndex';
import { activateVault, getBrowserAdapter, loadSavedVault, vaultLabelFor } from './core/vault/vaultManager';
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
    if (e.type === 'delete') ws.fileDeleted(e.path);
    if (e.type === 'folder-delete' || e.type === 'folder-rename' || e.type === 'reload') {
      // Drop tabs whose files no longer exist.
      for (const tab of ws.openTabs) if (!vault.exists(tab)) ws.fileDeleted(tab);
    }
  });
  return { vault, index, commands };
}

export const app: NotoApp = createApp(getBrowserAdapter());

/** Switch the running app to another storage backend (used by the settings modal). */
export function switchVault(adapter: StorageAdapter): Promise<void> {
  return activateVault(app, adapter);
}

/** Load the last-used vault (seeding the sample notes into an empty browser vault) and attach the index. */
export async function bootstrap(): Promise<void> {
  const adapter = await loadSavedVault();
  if (adapter !== app.vault.adapter) app.vault.adapter = adapter;
  await app.vault.load();
  if (adapter.kind === 'indexeddb' && app.vault.getFiles().length === 0) {
    for (const f of SAMPLE_VAULT.files) await app.vault.create(f.path, f.content);
    for (const d of SAMPLE_VAULT.folders) if (!app.vault.folderExists(d)) await app.vault.createFolder(d);
  }
  // Recover what was typed right before the last unload (the editor's debounced save may not have landed).
  await replayDraft(app.vault).catch((err: unknown) => console.error(err));
  app.index.attach();
  const ws = useWorkspace.getState();
  ws.setVaultLabel(vaultLabelFor(adapter));
  for (const tab of ws.openTabs) if (!app.vault.exists(tab)) ws.fileDeleted(tab);
  if (!ws.activeFile || !app.vault.exists(ws.activeFile)) {
    const first = app.vault.getFile('Welcome.md') ?? app.vault.getMarkdownFiles()[0];
    if (first) ws.openFile(first.path);
  }
  ws.setReady(true);
}
