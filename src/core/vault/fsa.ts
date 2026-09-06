import type { StorageAdapter, VaultFile, VaultSnapshot } from '../types';
import { errorMessage } from '../util';
import { basename, dirname, extname, isHiddenName, isWithin, joinPath, normalizePath } from './path';

/*
 * The DOM lib types for the File System Access API omit the members we rely on
 * (`values()` for iteration and the permission methods), so the handles are typed
 * with these minimal structural interfaces. Real browser handles satisfy them.
 */

export type PermissionMode = 'read' | 'readwrite';

/** The subset of `File` the adapter reads. Kept structural so tests can use plain objects. */
export interface FileLike {
  readonly lastModified: number;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface WritableLike {
  write(data: string | ArrayBuffer): Promise<void>;
  close(): Promise<void>;
}

export interface FileHandle {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<FileLike>;
  createWritable(): Promise<WritableLike>;
  /** Browsers provide it; fakes may not. */
  isSameEntry?(other: FileHandle | DirectoryHandle): Promise<boolean>;
}

export interface DirectoryHandle {
  readonly kind: 'directory';
  readonly name: string;
  values(): AsyncIterable<DirectoryHandle | FileHandle>;
  getDirectoryHandle(name: string, options?: FileSystemGetDirectoryOptions): Promise<DirectoryHandle>;
  getFileHandle(name: string, options?: FileSystemGetFileOptions): Promise<FileHandle>;
  removeEntry(name: string, options?: FileSystemRemoveOptions): Promise<void>;
  queryPermission(descriptor: { mode: PermissionMode }): Promise<PermissionState>;
  requestPermission(descriptor: { mode: PermissionMode }): Promise<PermissionState>;
  /** Browsers provide it; fakes may not. */
  isSameEntry?(other: FileHandle | DirectoryHandle): Promise<boolean>;
}

/** Extensions read into the vault; everything else (images, PDFs…) is left untouched on disk. */
const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.canvas', '.json']);

export function isTextFile(name: string): boolean {
  return TEXT_EXTENSIONS.has(extname(name).toLowerCase());
}

/** Hidden entries (`.obsidian`, `.git`, …) and dependency folders are never walked; `validateName` refuses them for the same reason. */
export function shouldSkipEntry(name: string): boolean {
  return isHiddenName(name);
}

/** A sibling name that cannot clash with anything the vault knows: `Note.md` -> `Note.md.k3x9q1.tmp`. */
function temporaryPath(path: string): string {
  return `${path}.${Math.random().toString(36).slice(2, 8)}.tmp`;
}

/** Vault stored in a folder on disk, accessed through a `FileSystemDirectoryHandle`. */
export class FileSystemAccessAdapter implements StorageAdapter {
  readonly kind = 'fsa' as const;
  /** Directory handles by vault-relative path; `''` is the root. */
  private dirs = new Map<string, DirectoryHandle>();

  /**
   * @param id Identity of this folder connection, kept in the settings database next to the handle. Folder
   * names are not unique (every drive can have a "Notes"), so anything that must tell folders apart uses this.
   */
  constructor(
    public readonly root: DirectoryHandle,
    public readonly id: string = crypto.randomUUID(),
  ) {
    this.dirs.set('', root);
  }

  /** Name of the folder on disk. */
  get name(): string {
    return this.root.name;
  }

  async load(): Promise<VaultSnapshot> {
    this.dirs.clear();
    this.dirs.set('', this.root);
    const files: VaultFile[] = [];
    const folders: string[] = [];
    await this.walk(this.root, '', files, folders);
    return { files, folders };
  }

  private async walk(dir: DirectoryHandle, prefix: string, files: VaultFile[], folders: string[]): Promise<void> {
    for await (const entry of dir.values()) {
      if (shouldSkipEntry(entry.name)) continue;
      const path = joinPath(prefix, entry.name);
      if (entry.kind === 'directory') {
        folders.push(path);
        this.dirs.set(path, entry);
        await this.walk(entry, path, files, folders);
      } else if (isTextFile(entry.name)) {
        const file = await entry.getFile();
        files.push({ path, content: await file.text(), mtime: file.lastModified });
      }
    }
  }

  /**
   * `load()` leaves hidden entries and non-text files unread, so the vault cannot tell whether a path it does not
   * know is free on disk. Creating looks first and refuses, rather than truncating whatever is there.
   */
  async createFile(path: string, content: string): Promise<void> {
    const p = normalizePath(path);
    const dir = await this.getDirectory(dirname(p), true);
    if (await this.hasFile(dir, basename(p), p)) throw new Error(`File already exists: ${p}`);
    await this.writeFile(p, content);
  }

  /** Whether `dir` holds a file called `name`, without creating one. */
  private async hasFile(dir: DirectoryHandle, name: string, path: string): Promise<boolean> {
    try {
      await dir.getFileHandle(name);
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') return false;
      throw new Error(`Cannot write ${path}: ${errorMessage(error)}`);
    }
  }

  async writeFile(path: string, content: string): Promise<void> {
    const p = normalizePath(path);
    const dir = await this.getDirectory(dirname(p), true);
    let writable: WritableLike;
    try {
      const handle = await dir.getFileHandle(basename(p), { create: true });
      writable = await handle.createWritable();
    } catch (error) {
      throw new Error(`Cannot write ${p}: ${errorMessage(error)}`);
    }
    await writable.write(content);
    await writable.close();
  }

  async deleteFile(path: string): Promise<void> {
    const p = normalizePath(path);
    const dir = await this.getDirectory(dirname(p), false);
    try {
      await dir.removeEntry(basename(p));
    } catch (error) {
      throw new Error(`Cannot delete ${p}: ${errorMessage(error)}`);
    }
  }

  /**
   * `FileSystemHandle.move()` is not portable, so rename is copy + delete. When both names address the
   * same entry on disk (a case-only rename on macOS or Windows, a different Unicode form on APFS) the copy
   * would land on the original and the delete would remove the only copy, so the rename goes through a
   * temporary name instead; a full copy exists at every step.
   */
  async renameFile(oldPath: string, newPath: string): Promise<void> {
    const from = normalizePath(oldPath);
    const to = normalizePath(newPath);
    const content = await this.readFile(from);
    if (await this.isSameEntry(from, to, 'file')) {
      const tmp = temporaryPath(from);
      await this.writeFile(tmp, content);
      await this.deleteFile(from);
      await this.writeFile(to, content);
      await this.deleteFile(tmp);
      return;
    }
    await this.writeFile(to, content);
    await this.deleteFile(from);
  }

  async createFolder(path: string): Promise<void> {
    await this.getDirectory(normalizePath(path), true);
  }

  async deleteFolder(path: string): Promise<void> {
    const p = normalizePath(path);
    if (!p) throw new Error('Cannot delete the vault root.');
    const parent = await this.getDirectory(dirname(p), false);
    try {
      await parent.removeEntry(basename(p), { recursive: true });
    } catch (error) {
      throw new Error(`Cannot delete folder ${p}: ${errorMessage(error)}`);
    }
    this.forgetDirectories(p);
  }

  /**
   * Copies the whole tree (including non-text files) to the new location, then removes the old one.
   * Same-entry targets take the detour through a temporary folder, as in `renameFile`.
   */
  async renameFolder(oldPath: string, newPath: string): Promise<void> {
    const from = normalizePath(oldPath);
    const to = normalizePath(newPath);
    if (!from || !to) throw new Error('Invalid folder path.');
    const source = await this.getDirectory(from, false);
    await this.assertNotInside(source, from, to);
    if (await this.isSameEntry(from, to, 'directory')) {
      const tmp = temporaryPath(from);
      await this.copyTree(source, tmp);
      await this.deleteFolder(from);
      await this.copyTree(await this.getDirectory(tmp, false), to);
      await this.deleteFolder(tmp);
      return;
    }
    await this.copyTree(source, to);
    await this.deleteFolder(from);
  }

  /**
   * Refuse a destination inside the source directory: copying a tree into itself never ends. Names that differ
   * only in case are one directory on macOS and Windows; for any other spelling of one entry the browser is asked
   * about every existing folder on the way to `to`. Handles are looked up directly so nothing stale is cached.
   */
  private async assertNotInside(source: DirectoryHandle, from: string, to: string): Promise<void> {
    const sameEntry = from.toLowerCase() === to.toLowerCase();
    if (!sameEntry && isWithin(to.toLowerCase(), from.toLowerCase())) throw new Error('Cannot move a folder into itself.');
    if (!source.isSameEntry) return;
    let dir = this.root;
    for (const segment of to.split('/').slice(0, -1)) {
      try {
        dir = await dir.getDirectoryHandle(segment);
      } catch {
        return; // nothing beyond this point exists yet, so the source cannot be there
      }
      if (await source.isSameEntry(dir)) throw new Error('Cannot move a folder into itself.');
    }
  }

  /**
   * Whether `from` (which exists) and `to` name the same entry on disk: names equal ignoring case are
   * assumed to (case-insensitive file systems are the default on macOS and Windows), and otherwise the
   * browser is asked when `to` already exists. Handles are looked up directly so nothing stale is cached.
   */
  private async isSameEntry(from: string, to: string, kind: 'file' | 'directory'): Promise<boolean> {
    if (from.toLowerCase() === to.toLowerCase()) return true;
    try {
      const a = await this.getDirectory(dirname(from), false);
      const b = await this.getDirectory(dirname(to), false);
      const source = kind === 'file' ? await a.getFileHandle(basename(from)) : await a.getDirectoryHandle(basename(from));
      const target = kind === 'file' ? await b.getFileHandle(basename(to)) : await b.getDirectoryHandle(basename(to));
      return source.isSameEntry ? await source.isSameEntry(target) : false;
    } catch {
      return false; // `to` does not exist yet, so it cannot be the same entry
    }
  }

  private async copyTree(source: DirectoryHandle, destPath: string): Promise<void> {
    const dest = await this.getDirectory(destPath, true);
    for await (const entry of source.values()) {
      if (entry.kind === 'directory') {
        await this.copyTree(entry, joinPath(destPath, entry.name));
        continue;
      }
      const file = await entry.getFile();
      const target = await dest.getFileHandle(entry.name, { create: true });
      const writable = await target.createWritable();
      await writable.write(await file.arrayBuffer());
      await writable.close();
    }
  }

  private async readFile(path: string): Promise<string> {
    const dir = await this.getDirectory(dirname(path), false);
    try {
      const handle = await dir.getFileHandle(basename(path));
      return (await handle.getFile()).text();
    } catch (error) {
      throw new Error(`Cannot read ${path}: ${errorMessage(error)}`);
    }
  }

  /** Resolve (and optionally create) the directory handle for a vault-relative folder path. */
  private async getDirectory(path: string, create: boolean): Promise<DirectoryHandle> {
    const cached = this.dirs.get(path);
    if (cached) return cached;
    const parent = await this.getDirectory(dirname(path), create);
    let handle: DirectoryHandle;
    try {
      handle = await parent.getDirectoryHandle(basename(path), { create });
    } catch (error) {
      throw new Error(`Folder not found: ${path} (${errorMessage(error)})`);
    }
    this.dirs.set(path, handle);
    return handle;
  }

  private forgetDirectories(path: string): void {
    for (const key of [...this.dirs.keys()]) if (key && isWithin(key, path)) this.dirs.delete(key);
  }
}
