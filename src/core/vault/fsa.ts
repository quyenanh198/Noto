import type { StorageAdapter, VaultFile, VaultSnapshot } from '../types';
import { basename, dirname, extname, isWithin, joinPath, normalizePath } from './path';

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
}

/** Extensions read into the vault; everything else (images, PDFs…) is left untouched on disk. */
const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.canvas', '.json']);

export function isTextFile(name: string): boolean {
  return TEXT_EXTENSIONS.has(extname(name).toLowerCase());
}

/** Hidden entries (`.obsidian`, `.git`, …) and dependency folders are never walked. */
export function shouldSkipEntry(name: string): boolean {
  return name.startsWith('.') || name === 'node_modules';
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Vault stored in a folder on disk, accessed through a `FileSystemDirectoryHandle`. */
export class FileSystemAccessAdapter implements StorageAdapter {
  readonly kind = 'fsa' as const;
  /** Directory handles by vault-relative path; `''` is the root. */
  private dirs = new Map<string, DirectoryHandle>();

  constructor(public readonly root: DirectoryHandle) {
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

  async writeFile(path: string, content: string): Promise<void> {
    const p = normalizePath(path);
    const dir = await this.getDirectory(dirname(p), true);
    let writable: WritableLike;
    try {
      const handle = await dir.getFileHandle(basename(p), { create: true });
      writable = await handle.createWritable();
    } catch (error) {
      throw new Error(`Cannot write ${p}: ${describe(error)}`);
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
      throw new Error(`Cannot delete ${p}: ${describe(error)}`);
    }
  }

  /** `FileSystemHandle.move()` is not portable, so rename is copy + delete. */
  async renameFile(oldPath: string, newPath: string): Promise<void> {
    const content = await this.readFile(normalizePath(oldPath));
    await this.writeFile(newPath, content);
    await this.deleteFile(oldPath);
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
      throw new Error(`Cannot delete folder ${p}: ${describe(error)}`);
    }
    this.forgetDirectories(p);
  }

  /** Copies the whole tree (including non-text files) to the new location, then removes the old one. */
  async renameFolder(oldPath: string, newPath: string): Promise<void> {
    const from = normalizePath(oldPath);
    const to = normalizePath(newPath);
    if (!from || !to) throw new Error('Invalid folder path.');
    const source = await this.getDirectory(from, false);
    await this.copyTree(source, to);
    await this.deleteFolder(from);
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
      throw new Error(`Cannot read ${path}: ${describe(error)}`);
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
      throw new Error(`Folder not found: ${path} (${describe(error)})`);
    }
    this.dirs.set(path, handle);
    return handle;
  }

  private forgetDirectories(path: string): void {
    for (const key of [...this.dirs.keys()]) if (key && isWithin(key, path)) this.dirs.delete(key);
  }
}
