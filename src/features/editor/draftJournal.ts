import type { StorageAdapter } from '../../core/types';
import { vaultLabelFor } from '../../core/vault/vaultManager';
import type { Vault } from '../../core/vault/Vault';

/*
 * Write-ahead copy of the note being typed into. The editor debounces saves, and an IndexedDB or file write
 * started while the page unloads (reload, tab close, navigation) often does not commit before the document is
 * torn down. localStorage writes are synchronous and always survive, so the latest content is mirrored there on
 * every change and replayed into the vault on the next start when the stored file is still older.
 */

const KEY = 'noto:draft';

export interface Draft {
  /** Vault the draft belongs to (see `vaultDraftId`); a draft is never replayed into another vault. */
  vault: string;
  path: string;
  content: string;
  /** When the content was typed (ms since epoch); files modified later win over the draft. */
  time: number;
}

/** Identity of a storage backend for draft purposes: its kind plus the label shown to the user. */
export function vaultDraftId(adapter: StorageAdapter): string {
  return `${adapter.kind}:${vaultLabelFor(adapter)}`;
}

export function writeDraft(draft: Omit<Draft, 'time'>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...draft, time: Date.now() } satisfies Draft));
  } catch {
    // Quota exceeded or storage unavailable: the debounced save is still on its way.
  }
}

export function readDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as Partial<Draft>;
    if (typeof draft.vault !== 'string' || typeof draft.path !== 'string' || typeof draft.content !== 'string') return null;
    return { vault: draft.vault, path: draft.path, content: draft.content, time: typeof draft.time === 'number' ? draft.time : 0 };
  } catch {
    return null;
  }
}

function removeDraft(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to do; a stale draft is skipped on replay when the file is already up to date.
  }
}

/** Forget the draft once `content` has been stored; a draft holding newer content is kept. */
export function clearDraft(content: string): void {
  if (readDraft()?.content === content) removeDraft();
}

/**
 * Apply the journaled draft to `vault` when it belongs to that vault and is newer than the stored file.
 * Returns true when the file was updated. The draft is forgotten either way, unless it belongs to another vault.
 */
export async function replayDraft(vault: Vault): Promise<boolean> {
  const draft = readDraft();
  if (!draft) return false;
  if (draft.vault !== vaultDraftId(vault.adapter)) return false;
  const file = vault.getFile(draft.path);
  const stale = !file || file.content === draft.content || file.mtime > draft.time;
  if (!stale) await vault.modify(draft.path, draft.content);
  removeDraft();
  return !stale;
}
