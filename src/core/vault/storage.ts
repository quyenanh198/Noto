import { openDB, type IDBPDatabase } from 'idb';
import type { StorageAdapter, VaultFile, VaultSnapshot } from '../types';
import { isWithin } from './path';

/** Non-persistent adapter for tests and as a base for others. */
export class MemoryAdapter implements StorageAdapter {
  readonly kind = 'memory' as const;
  files = new Map<string, VaultFile>();
  folders = new Set<string>();

  constructor(initial: VaultSnapshot = { files: [], folders: [] }) {
    for (const f of initial.files) this.files.set(f.path, { ...f });
    for (const d of initial.folders) this.folders.add(d);
  }

  async load(): Promise<VaultSnapshot> {
    return { files: [...this.files.values()].map((f) => ({ ...f })), folders: [...this.folders] };
  }
  async createFile(path: string, content: string): Promise<void> {
    if (this.files.has(path)) throw new Error(`File already exists: ${path}`);
    await this.writeFile(path, content);
  }
  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, { path, content, mtime: Date.now() });
  }
  async deleteFile(path: string): Promise<void> {
    this.files.delete(path);
  }
  async renameFile(oldPath: string, newPath: string): Promise<void> {
    const f = this.files.get(oldPath);
    if (!f) return;
    this.files.delete(oldPath);
    this.files.set(newPath, { ...f, path: newPath });
  }
  async createFolder(path: string): Promise<void> {
    this.folders.add(path);
  }
  async deleteFolder(path: string): Promise<void> {
    for (const p of [...this.files.keys()]) if (isWithin(p, path)) this.files.delete(p);
    for (const d of [...this.folders]) if (isWithin(d, path)) this.folders.delete(d);
  }
  async renameFolder(oldPath: string, newPath: string): Promise<void> {
    for (const [p, f] of [...this.files]) {
      if (!isWithin(p, oldPath)) continue;
      const next = newPath + p.slice(oldPath.length);
      this.files.delete(p);
      this.files.set(next, { ...f, path: next });
    }
    for (const d of [...this.folders]) {
      if (!isWithin(d, oldPath)) continue;
      this.folders.delete(d);
      this.folders.add(newPath + d.slice(oldPath.length));
    }
    this.folders.add(newPath);
  }
}

interface NotoDB {
  files: { key: string; value: VaultFile };
  folders: { key: string; value: { path: string } };
}

const DB_VERSION = 1;

/** Persists the vault in the browser's IndexedDB. One database per vault name. */
export class IndexedDBAdapter implements StorageAdapter {
  readonly kind = 'indexeddb' as const;
  private dbPromise: Promise<IDBPDatabase<NotoDB>>;

  constructor(public readonly vaultName = 'default') {
    this.dbPromise = openDB<NotoDB>(`noto-vault-${vaultName}`, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'path' });
        if (!db.objectStoreNames.contains('folders')) db.createObjectStore('folders', { keyPath: 'path' });
      },
    });
  }

  async load(): Promise<VaultSnapshot> {
    const db = await this.dbPromise;
    const files = await db.getAll('files');
    const folders = (await db.getAll('folders')).map((f) => f.path);
    return { files, folders };
  }

  async createFile(path: string, content: string): Promise<void> {
    const db = await this.dbPromise;
    try {
      await db.add('files', { path, content, mtime: Date.now() });
    } catch (error) {
      // Checked by name: the DOMException may come from another realm (the test double does) and fail `instanceof`.
      if (typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'ConstraintError') {
        throw new Error(`File already exists: ${path}`);
      }
      throw error;
    }
  }

  async writeFile(path: string, content: string): Promise<void> {
    const db = await this.dbPromise;
    await db.put('files', { path, content, mtime: Date.now() });
  }

  async deleteFile(path: string): Promise<void> {
    const db = await this.dbPromise;
    await db.delete('files', path);
  }

  async renameFile(oldPath: string, newPath: string): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction('files', 'readwrite');
    const f = await tx.store.get(oldPath);
    if (f) {
      await tx.store.delete(oldPath);
      await tx.store.put({ ...f, path: newPath, mtime: Date.now() });
    }
    await tx.done;
  }

  async createFolder(path: string): Promise<void> {
    const db = await this.dbPromise;
    await db.put('folders', { path });
  }

  async deleteFolder(path: string): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction(['files', 'folders'], 'readwrite');
    for (const key of await tx.objectStore('files').getAllKeys()) {
      if (isWithin(String(key), path)) await tx.objectStore('files').delete(key);
    }
    for (const key of await tx.objectStore('folders').getAllKeys()) {
      if (isWithin(String(key), path)) await tx.objectStore('folders').delete(key);
    }
    await tx.done;
  }

  async renameFolder(oldPath: string, newPath: string): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction(['files', 'folders'], 'readwrite');
    const files = tx.objectStore('files');
    for (const f of await files.getAll()) {
      if (!isWithin(f.path, oldPath)) continue;
      await files.delete(f.path);
      await files.put({ ...f, path: newPath + f.path.slice(oldPath.length) });
    }
    const folders = tx.objectStore('folders');
    for (const rawKey of await folders.getAllKeys()) {
      const key = String(rawKey);
      if (!isWithin(key, oldPath)) continue;
      await folders.delete(key);
      await folders.put({ path: newPath + key.slice(oldPath.length) });
    }
    await folders.put({ path: newPath });
    await tx.done;
  }

  /** Replace the whole database contents (used when importing a vault). */
  async replaceAll(snapshot: VaultSnapshot): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction(['files', 'folders'], 'readwrite');
    await tx.objectStore('files').clear();
    await tx.objectStore('folders').clear();
    for (const f of snapshot.files) await tx.objectStore('files').put(f);
    for (const d of snapshot.folders) await tx.objectStore('folders').put({ path: d });
    await tx.done;
  }
}
