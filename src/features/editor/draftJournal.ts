import type { StorageAdapter } from '../../core/types';
import { FileSystemAccessAdapter } from '../../core/vault/fsa';
import { IndexedDBAdapter } from '../../core/vault/storage';
import type { Vault } from '../../core/vault/Vault';

/*
 * Write-ahead copy of the note being typed into. The editor debounces saves, and an IndexedDB or file write
 * started while the page unloads (reload, tab close, navigation) often does not commit before the document is
 * torn down. localStorage writes are synchronous and always survive, so the latest content is mirrored there on
 * every change and replayed into the vault on the next start when the stored file is still older.
 */

const KEY = 'noto:draft';
/** How many of the contents a note had in storage a draft remembers (see `Draft.seen`). */
const MAX_SEEN = 32;

export interface Draft {
  /** Vault the draft belongs to (see `vaultDraftId`); a draft is never replayed into another vault. */
  vault: string;
  path: string;
  content: string;
  /** When the content was typed (ms since epoch); files modified later win over the draft. */
  time: number;
  /**
   * Fingerprints (`hashText`) of every content the file had in storage while it was being edited: what the
   * editor opened, then whatever each save wrote. Only a file still holding one of them can take the draft;
   * anything else at that path was never in front of the user (another folder called the same, an mtime that lies).
   */
  seen: string[];
}

/**
 * Identity of a storage backend for draft purposes. A folder is known by the id kept next to its handle,
 * never by its name: any number of folders can be called "Notes".
 */
export function vaultDraftId(adapter: StorageAdapter): string {
  if (adapter instanceof FileSystemAccessAdapter) return `fsa:${adapter.id}`;
  if (adapter instanceof IndexedDBAdapter) return `indexeddb:${adapter.vaultName}`;
  return adapter.kind;
}

/** Cheap, synchronous fingerprint of a note's content (length plus FNV-1a), enough to tell two texts apart. */
export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return `${text.length.toString(36)}-${(hash >>> 0).toString(36)}`;
}

export function writeDraft(draft: Omit<Draft, 'time'>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...draft, seen: draft.seen.slice(-MAX_SEEN), time: Date.now() } satisfies Draft));
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
    if (!Array.isArray(draft.seen) || !draft.seen.every((h) => typeof h === 'string')) return null;
    return { vault: draft.vault, path: draft.path, content: draft.content, seen: draft.seen, time: typeof draft.time === 'number' ? draft.time : 0 };
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
 * Apply the journaled draft to `vault` when it belongs to that vault and is newer than the stored file, which
 * must still hold a content the draft was typed over. Returns true when the file was updated. The draft is
 * forgotten either way, unless it belongs to another vault.
 */
export async function replayDraft(vault: Vault): Promise<boolean> {
  const draft = readDraft();
  if (!draft) return false;
  if (draft.vault !== vaultDraftId(vault.adapter)) return false;
  const file = vault.getFile(draft.path);
  const applies = file !== undefined && file.content !== draft.content && file.mtime <= draft.time && draft.seen.includes(hashText(file.content));
  if (applies) await vault.modify(draft.path, draft.content);
  removeDraft();
  return applies;
}
