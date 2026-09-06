import type { StorageAdapter, VaultEvent, VaultFile, VaultSnapshot } from '../types';
import { applyLinkRewrites, planLinkRewrites, type LinkRewritePlan } from './linkRewrite';
import { ancestors, basename, dirname, isMarkdown, isWithin, joinPath, normalizePath, stripExt, withMdExt } from './path';

export type VaultListener = (event: VaultEvent) => void;

/**
 * In-memory vault of files. All mutations go through here; the storage adapter mirrors them.
 * Emits events after each mutation. `revision` increments on every change (handy for React deps).
 */
export class Vault {
  private files = new Map<string, VaultFile>();
  private folders = new Set<string>();
  private listeners = new Set<VaultListener>();
  revision = 0;
  loaded = false;

  constructor(public adapter: StorageAdapter) {}

  async load(): Promise<void> {
    this.applySnapshot(await this.adapter.load());
  }

  /**
   * Swap the storage backend and reload from it. The new adapter is adopted only once its contents
   * have loaded: until then (and if loading fails) every write still goes to the current backend.
   */
  async switchAdapter(adapter: StorageAdapter): Promise<void> {
    const snap = await adapter.load();
    this.adapter = adapter;
    this.applySnapshot(snap);
  }

  private applySnapshot(snap: VaultSnapshot): void {
    this.files.clear();
    this.folders.clear();
    for (const f of snap.files) {
      const path = normalizePath(f.path);
      this.files.set(path, { ...f, path });
    }
    for (const folder of snap.folders) {
      const p = normalizePath(folder);
      if (p) this.folders.add(p);
    }
    this.loaded = true;
    this.emit({ type: 'reload' });
  }

  // ----- queries -----

  getFile(path: string): VaultFile | undefined {
    return this.files.get(normalizePath(path));
  }

  exists(path: string): boolean {
    return this.files.has(normalizePath(path));
  }

  folderExists(path: string): boolean {
    const p = normalizePath(path);
    if (p === '') return true;
    return this.folders.has(p) || this.getFolders().includes(p);
  }

  /** All files, sorted by path. */
  getFiles(): VaultFile[] {
    return [...this.files.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  /** Markdown files only, sorted by path. */
  getMarkdownFiles(): VaultFile[] {
    return this.getFiles().filter((f) => isMarkdown(f.path));
  }

  /** All folders (explicit and implicit from file paths), sorted, excluding root. */
  getFolders(): string[] {
    const set = new Set(this.folders);
    for (const path of this.files.keys()) {
      for (const a of ancestors(path)) set.add(a);
    }
    for (const folder of [...set]) {
      for (const a of ancestors(folder)) set.add(a);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  /** Direct children of a folder (`''` for root). */
  listChildren(folder: string): { folders: string[]; files: VaultFile[] } {
    const dir = normalizePath(folder);
    const folders = this.getFolders().filter((f) => dirname(f) === dir);
    const files = this.getFiles().filter((f) => dirname(f.path) === dir);
    return { folders, files };
  }

  /**
   * Resolve a wikilink target to an existing file path, Obsidian-style:
   * exact path (with or without .md), then relative to the source note's folder,
   * then any file whose basename matches (shortest path wins). Case-insensitive fallback.
   */
  resolveLink(target: string, fromPath = ''): string | undefined {
    const raw = normalizePath(target);
    if (!raw) return undefined;
    const candidates = [withMdExt(raw), raw];
    for (const c of candidates) if (this.files.has(c)) return c;
    const dir = dirname(normalizePath(fromPath));
    if (dir) {
      for (const c of candidates) {
        const rel = joinPath(dir, c);
        if (this.files.has(rel)) return rel;
      }
    }
    const wantBase = stripExt(basename(raw)).toLowerCase();
    const wantDir = dirname(raw).toLowerCase();
    let best: string | undefined;
    for (const path of this.files.keys()) {
      if (!isMarkdown(path)) continue;
      if (stripExt(basename(path)).toLowerCase() !== wantBase) continue;
      if (wantDir && !dirname(path).toLowerCase().endsWith(wantDir)) continue;
      if (best === undefined || path.length < best.length || (path.length === best.length && path < best)) best = path;
    }
    return best;
  }

  /** Obsidian-style shortest unique link text for a file: basename if unique, else full path. */
  linkTextFor(path: string): string {
    const title = stripExt(basename(path));
    const dupes = [...this.files.keys()].filter((p) => stripExt(basename(p)) === title);
    return dupes.length > 1 ? stripExt(path) : title;
  }

  /**
   * An existing path among `candidates` that equals `path` ignoring case, other than `self`.
   * The default file systems on macOS and Windows treat such names as the same entry, so a
   * rename onto one would overwrite (or, copying then deleting, destroy) the other entry.
   */
  private caseVariantOf(path: string, candidates: Iterable<string>, self: string): string | undefined {
    const wanted = path.toLowerCase();
    for (const candidate of candidates) {
      if (candidate !== self && candidate.toLowerCase() === wanted) return candidate;
    }
    return undefined;
  }

  // ----- mutations -----

  async create(path: string, content = ''): Promise<VaultFile> {
    const p = normalizePath(path);
    if (!p) throw new Error('Path cannot be empty.');
    if (this.files.has(p)) throw new Error(`File already exists: ${p}`);
    const file: VaultFile = { path: p, content, mtime: Date.now() };
    this.files.set(p, file);
    await this.adapter.writeFile(p, content);
    this.emit({ type: 'create', path: p });
    return file;
  }

  /** Create a note, appending ` 1`, ` 2`... to the name if it already exists. Returns the created path. */
  async createUnique(path: string, content = ''): Promise<VaultFile> {
    const normalized = normalizePath(path);
    if (!normalized) throw new Error('Path cannot be empty.');
    let p = withMdExt(normalized);
    if (this.files.has(p)) {
      const base = stripExt(p);
      let i = 1;
      while (this.files.has(`${base} ${i}.md`)) i++;
      p = `${base} ${i}.md`;
    }
    return this.create(p, content);
  }

  async modify(path: string, content: string): Promise<void> {
    const p = normalizePath(path);
    const file = this.files.get(p);
    if (!file) throw new Error(`File not found: ${p}`);
    if (file.content === content) return;
    file.content = content;
    file.mtime = Date.now();
    await this.adapter.writeFile(p, content);
    this.emit({ type: 'modify', path: p });
  }

  async delete(path: string): Promise<void> {
    const p = normalizePath(path);
    if (!this.files.has(p)) throw new Error(`File not found: ${p}`);
    this.files.delete(p);
    await this.adapter.deleteFile(p);
    this.emit({ type: 'delete', path: p });
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const from = normalizePath(oldPath);
    const to = normalizePath(newPath);
    const file = this.files.get(from);
    if (!file) throw new Error(`File not found: ${from}`);
    if (from === to) return;
    if (this.files.has(to)) throw new Error(`File already exists: ${to}`);
    const clash = this.caseVariantOf(to, this.files.keys(), from);
    if (clash !== undefined) throw new Error(`File already exists: ${clash}`);
    const moves = new Map([[from, to]]);
    const plan = this.planLinkRewrites(moves);
    this.files.delete(from);
    this.files.set(to, { ...file, path: to, mtime: Date.now() });
    await this.adapter.renameFile(from, to);
    this.emit({ type: 'rename', oldPath: from, newPath: to });
    await this.rewriteLinks(plan, moves);
  }

  async createFolder(path: string): Promise<void> {
    const p = normalizePath(path);
    if (!p) return;
    if (this.folderExists(p)) throw new Error(`Folder already exists: ${p}`);
    this.folders.add(p);
    await this.adapter.createFolder(p);
    this.emit({ type: 'folder-create', path: p });
  }

  /** Delete a folder and everything inside it. */
  async deleteFolder(path: string): Promise<void> {
    const p = normalizePath(path);
    if (!p) throw new Error('Cannot delete the vault root.');
    for (const file of [...this.files.keys()]) {
      if (isWithin(file, p)) this.files.delete(file);
    }
    for (const folder of [...this.folders]) {
      if (isWithin(folder, p)) this.folders.delete(folder);
    }
    await this.adapter.deleteFolder(p);
    this.emit({ type: 'folder-delete', path: p });
  }

  async renameFolder(oldPath: string, newPath: string): Promise<void> {
    const from = normalizePath(oldPath);
    const to = normalizePath(newPath);
    if (!from || !to) throw new Error('Invalid folder path.');
    if (from === to) return;
    if (isWithin(to, from)) throw new Error('Cannot move a folder into itself.');
    if (this.folderExists(to)) throw new Error(`Folder already exists: ${to}`);
    const clash = this.caseVariantOf(to, this.getFolders(), from);
    if (clash !== undefined) throw new Error(`Folder already exists: ${clash}`);
    const moves = new Map<string, string>();
    for (const path of this.files.keys()) if (isWithin(path, from)) moves.set(path, to + path.slice(from.length));
    const plan = this.planLinkRewrites(moves);
    for (const [path, next] of moves) {
      const file = this.files.get(path)!;
      this.files.delete(path);
      this.files.set(next, { ...file, path: next });
    }
    for (const folder of [...this.folders]) {
      if (!isWithin(folder, from)) continue;
      this.folders.delete(folder);
      this.folders.add(to + folder.slice(from.length));
    }
    this.folders.add(to);
    await this.adapter.renameFolder(from, to);
    this.emit({ type: 'folder-rename', oldPath: from, newPath: to });
    await this.rewriteLinks(plan, moves);
  }

  /** Links that point at notes about to move (old path -> new path), found while those notes are still in place. */
  private planLinkRewrites(moves: ReadonlyMap<string, string>): LinkRewritePlan {
    return planLinkRewrites(this.getMarkdownFiles(), moves, (target, from) => this.resolveLink(target, from));
  }

  /** Rewrite the planned links now that the notes have moved, so `[[Old]]` becomes `[[New]]` like in Obsidian. */
  private async rewriteLinks(plan: LinkRewritePlan, moves: ReadonlyMap<string, string>): Promise<void> {
    for (const [source, rewrites] of plan) {
      const path = moves.get(source) ?? source;
      const file = this.files.get(path);
      if (!file) continue;
      const next = applyLinkRewrites(path, file.content, rewrites, (p) => this.linkTextFor(p));
      if (next !== file.content) await this.modify(path, next);
    }
  }

  // ----- events -----

  on(listener: VaultListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: VaultEvent): void {
    this.revision++;
    for (const l of this.listeners) l(event);
  }
}
