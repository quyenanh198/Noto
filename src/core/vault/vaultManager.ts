import { openDB, type IDBPDatabase } from 'idb';
import { useWorkspace } from '../../state/store';
import type { StorageAdapter } from '../types';
import { FileSystemAccessAdapter, type DirectoryHandle } from './fsa';
import { IndexedDBAdapter } from './storage';
import type { Vault } from './Vault';

/*
 * Remembers which vault the user opened last. The choice lives in a small IndexedDB
 * key-value store because directory handles can be stored there (unlike localStorage).
 */

export type SavedVault = { kind: 'indexeddb' } | { kind: 'fsa'; handle: DirectoryHandle; name: string };

export interface PendingFolder {
  name: string;
  handle: DirectoryHandle;
}

/** The services a vault switch touches. `NotoApp` satisfies this. */
export interface VaultHost {
  vault: Vault;
  index: { attach(): void };
}

export const BROWSER_VAULT_LABEL = 'Browser storage';

const SETTINGS_DB = 'noto-settings';
const KV_STORE = 'kv';
const VAULT_KEY = 'vault';

interface SettingsDB {
  kv: { key: string; value: unknown };
}

let settingsDb: Promise<IDBPDatabase<SettingsDB>> | null = null;

function openSettings(): Promise<IDBPDatabase<SettingsDB>> {
  settingsDb ??= openDB<SettingsDB>(SETTINGS_DB, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(KV_STORE)) db.createObjectStore(KV_STORE);
    },
  });
  return settingsDb;
}

export async function saveVaultChoice(choice: SavedVault): Promise<void> {
  const db = await openSettings();
  await db.put(KV_STORE, choice, VAULT_KEY);
}

export async function loadVaultChoice(): Promise<SavedVault | null> {
  const db = await openSettings();
  const value = (await db.get(KV_STORE, VAULT_KEY)) as SavedVault | undefined;
  return value ?? null;
}

interface DirectoryPickerWindow {
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite'; id?: string }) => Promise<DirectoryHandle>;
}

function pickerWindow(): DirectoryPickerWindow {
  return typeof window === 'undefined' ? {} : (window as unknown as DirectoryPickerWindow);
}

export function isFsaSupported(): boolean {
  return typeof pickerWindow().showDirectoryPicker === 'function';
}

let browserAdapter: IndexedDBAdapter | null = null;

/** The default browser-storage vault; created once so the app and the manager share one connection. */
export function getBrowserAdapter(): IndexedDBAdapter {
  browserAdapter ??= new IndexedDBAdapter('default');
  return browserAdapter;
}

export function vaultLabelFor(adapter: StorageAdapter): string {
  return adapter instanceof FileSystemAccessAdapter ? adapter.name : BROWSER_VAULT_LABEL;
}

async function hasReadWrite(handle: DirectoryHandle): Promise<boolean> {
  try {
    return (await handle.queryPermission({ mode: 'readwrite' })) === 'granted';
  } catch {
    return false;
  }
}

/** Pick the adapter for a saved choice: the folder when still permitted, otherwise browser storage. */
export async function resolveSavedVault(saved: SavedVault | null): Promise<StorageAdapter> {
  if (saved?.kind === 'fsa' && (await hasReadWrite(saved.handle))) return new FileSystemAccessAdapter(saved.handle);
  return getBrowserAdapter();
}

export async function loadSavedVault(): Promise<StorageAdapter> {
  return resolveSavedVault(await loadVaultChoice());
}

/** A saved folder whose permission lapsed; reconnecting needs a user gesture. */
export async function pendingFolderFrom(saved: SavedVault | null): Promise<PendingFolder | null> {
  if (saved?.kind !== 'fsa' || (await hasReadWrite(saved.handle))) return null;
  return { name: saved.name, handle: saved.handle };
}

export async function getPendingFolder(): Promise<PendingFolder | null> {
  return pendingFolderFrom(await loadVaultChoice());
}

/** Point the running app at another adapter: reload, rebuild the index, and start from the first note. */
export async function activateVault(host: VaultHost, adapter: StorageAdapter): Promise<void> {
  await host.vault.switchAdapter(adapter);
  host.index.attach();
  const ws = useWorkspace.getState();
  ws.closeAllTabs();
  ws.setVaultLabel(vaultLabelFor(adapter));
  const first = host.vault.getFile('Welcome.md') ?? host.vault.getMarkdownFiles()[0];
  if (first) ws.openFile(first.path);
}

async function connectFolder(host: VaultHost, handle: DirectoryHandle): Promise<void> {
  const permission = await handle.requestPermission({ mode: 'readwrite' });
  if (permission !== 'granted') throw new Error(`Permission to use the folder "${handle.name}" was not granted.`);
  await saveVaultChoice({ kind: 'fsa', handle, name: handle.name });
  await activateVault(host, new FileSystemAccessAdapter(handle));
}

/** Ask the user for a folder and make it the vault. Returns false when the picker was cancelled. */
export async function openFolderVault(host: VaultHost): Promise<boolean> {
  const picker = pickerWindow().showDirectoryPicker;
  if (!picker) throw new Error('This browser does not support opening folders.');
  let handle: DirectoryHandle;
  try {
    handle = await picker({ mode: 'readwrite', id: 'noto-vault' });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return false;
    throw error;
  }
  await connectFolder(host, handle);
  return true;
}

/** Re-request access to a saved folder. Must be called from a user gesture (a click handler). */
export async function reconnectFolder(host: VaultHost, pending: PendingFolder): Promise<void> {
  await connectFolder(host, pending.handle);
}

/** Switch back to the vault kept in the browser and forget the folder handle. */
export async function useBrowserVault(host: VaultHost): Promise<void> {
  await saveVaultChoice({ kind: 'indexeddb' });
  await activateVault(host, getBrowserAdapter());
}
