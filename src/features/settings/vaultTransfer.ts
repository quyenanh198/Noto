import type { VaultSnapshot } from '../../core/types';
import { isTextFile } from '../../core/vault/fsa';
import { hasHiddenSegment, normalizePath } from '../../core/vault/path';

/** The bits of `File` the import needs; `webkitRelativePath` is set for folder pickers. */
export interface ImportCandidate {
  name: string;
  webkitRelativePath?: string;
}

export interface ImportPlan<T extends ImportCandidate> {
  /** Files to create, with their vault-relative target path. */
  create: Array<{ file: T; path: string }>;
  /** Files skipped because the path exists already, is hidden, or the type is not text. */
  skipped: number;
}

/**
 * Vault path for an imported file. Folder imports report `Top/sub/note.md`; the top
 * folder (the one the user picked) is dropped so its contents land at the vault root.
 */
export function importPath(file: ImportCandidate): string {
  const rel = normalizePath(file.webkitRelativePath ?? '');
  if (!rel.includes('/')) return normalizePath(file.name);
  return rel.slice(rel.indexOf('/') + 1);
}

/**
 * Decide which files to import. Skipped: existing paths (as `exists` judges them), non-text files, hidden paths
 * (`.obsidian/…`, `.trash/…`, `node_modules/…`) — a folder vault never lists those, so `exists` cannot protect what
 * is on disk there — and a file differing only in case from an earlier one, since the vault (like macOS and Windows)
 * treats such names as one entry.
 */
export function planImport<T extends ImportCandidate>(files: Iterable<T>, exists: (path: string) => boolean): ImportPlan<T> {
  const create: Array<{ file: T; path: string }> = [];
  const taken = new Set<string>();
  let skipped = 0;
  for (const file of files) {
    const path = importPath(file);
    if (!path || !isTextFile(path) || hasHiddenSegment(path) || exists(path) || taken.has(path.toLowerCase())) {
      skipped++;
      continue;
    }
    taken.add(path.toLowerCase());
    create.push({ file, path });
  }
  return { create, skipped };
}

export function importSummary(imported: number, skipped: number): string {
  const files = imported === 1 ? 'file' : 'files';
  return `Imported ${imported} ${files}, skipped ${skipped}`;
}

/** JSON body of a vault export: `{ files, folders }`, pretty-printed. */
export function serializeVault(snapshot: VaultSnapshot): string {
  return JSON.stringify({ files: snapshot.files, folders: snapshot.folders }, null, 2);
}
