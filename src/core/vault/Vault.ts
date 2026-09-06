import type { StorageAdapter, VaultEvent, VaultFile, VaultSnapshot } from '../types';
import { applyLinkRewrites, ownLinkRewrites, planLinkRewrites, planOwnLinks, type LinkRewritePlan } from './linkRewrite';
import { ancestors, basename, dirname, folderMatchesHint, isMarkdown, isWithin, joinPath, normalizePath, noteKey, stripExt, withMdExt } from './path';

export type VaultListener = (event: VaultEvent) => void;

/** Among files sharing a name, `[[links]]` prefer notes over attachments, then the shortest path, then alphabetical. */
function closerLink(a: string, b: string): boolean {
  if (isMarkdown(a) !== isMarkdown(b)) return isMarkdown(a);
  return a.length < b.length || (a.length === b.length && a < b);
}

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

  /** The file at `path`, or the one whose path differs only in case: on macOS and Windows the two are one entry on disk. */
  findFile(path: string): VaultFile | undefined {
    const p = normalizePath(path);
    const exact = this.files.get(p);
    if (exact) return exact;
    const variant = this.caseVariantOf(p, this.files.keys(), '');
    return variant === undefined ? undefined : this.files.get(variant);
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
   * Resolve a wikilink target to an existing file path, Obsidian-style: exact path (with or without .md), then
   * relative to the source note's folder, then any file with that name (case-insensitive; a folder given in the
   * target must match whole segments of the file's folder; notes before attachments, then the shortest path).
   * Only `.md` is implied, so `[[Node.js]]` finds `Node.js.md` and `[[notes.txt]]` finds the attachment.
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
    const wantKey = noteKey(basename(raw)).toLowerCase();
    const wantDir = dirname(raw).toLowerCase();
    let best: string | undefined;
    for (const path of this.files.keys()) {
      if (noteKey(basename(path)).toLowerCase() !== wantKey) continue;
      if (!folderMatchesHint(dirname(path).toLowerCase(), wantDir)) continue;
      if (best === undefined || closerLink(path, best)) best = path;
    }
    return best;
  }

  /**
   * Obsidian-style shortest link text for a file, as written from `fromPath`: its name (without `.md` for notes)
   * when no other file shares that name the way links match it (ignoring case) and it resolves back to the file
   * from there; otherwise the full path, which always does.
   */
  linkTextFor(path: string, fromPath = ''): string {
    const p = normalizePath(path);
    const short = noteKey(basename(p));
    const key = short.toLowerCase();
    for (const other of this.files.keys()) {
      if (other !== p && noteKey(basename(other)).toLowerCase() === key) return noteKey(p);
    }
    return this.resolveLink(short, fromPath) === p ? short : noteKey(p);
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

  /**
   * `path` with each folder segment spelled like the existing folder it matches ignoring case, so a new entry
   * in `projects/` lands in an existing `Projects/` (in memory as it would on disk) rather than in a look-alike.
   */
  private inExistingFolders(path: string): string {
    const folders = this.getFolders();
    const segments = path.split('/');
    let prefix = '';
    for (const segment of segments.slice(0, -1)) {
      const candidate = prefix ? `${prefix}/${segment}` : segment;
      prefix = folders.includes(candidate) ? candidate : (this.caseVariantOf(candidate, folders, '') ?? candidate);
    }
    return prefix ? `${prefix}/${segments[segments.length - 1]}` : path;
  }

  /** Whether a file at `path` exists, ignoring case. */
  private fileTaken(path: string): boolean {
    return this.files.has(path) || this.caseVariantOf(path, this.files.keys(), '') !== undefined;
  }

  /** Register the folders a new path implies, so they outlive their files like explicitly created ones do. */
  private async registerFolders(path: string): Promise<void> {
    for (const a of ancestors(path)) {
      if (this.folders.has(a)) continue;
      this.folders.add(a);
      await this.adapter.createFolder(a);
    }
  }

  // ----- mutations -----

  async create(path: string, content = ''): Promise<VaultFile> {
    const p = this.inExistingFolders(normalizePath(path));
    if (!p) throw new Error('Path cannot be empty.');
    if (this.files.has(p)) throw new Error(`File already exists: ${p}`);
    const clash = this.caseVariantOf(p, this.files.keys(), '');
    if (clash !== undefined) throw new Error(`File already exists: ${clash}`);
    const file: VaultFile = { path: p, content, mtime: Date.now() };
    await this.registerFolders(p);
    this.files.set(p, file);
    try {
      // The backend may hold an entry the vault never listed (a hidden file on disk); it refuses rather than replace it.
      await this.adapter.createFile(p, content);
    } catch (error) {
      if (this.files.get(p) === file) this.files.delete(p);
      throw error;
    }
    this.emit({ type: 'create', path: p });
    return file;
  }

  /** Create a note, appending ` 1`, ` 2`... to the name if it already exists (in any casing). Returns the created path. */
  async createUnique(path: string, content = ''): Promise<VaultFile> {
    const normalized = normalizePath(path);
    if (!normalized) throw new Error('Path cannot be empty.');
    let p = this.inExistingFolders(withMdExt(normalized));
    if (this.fileTaken(p)) {
      const base = stripExt(p);
      let i = 1;
      while (this.fileTaken(`${base} ${i}.md`)) i++;
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
    const to = this.inExistingFolders(normalizePath(newPath));
    const file = this.files.get(from);
    if (!file) throw new Error(`File not found: ${from}`);
    if (from === to) return;
    if (this.files.has(to)) throw new Error(`File already exists: ${to}`);
    const clash = this.caseVariantOf(to, this.files.keys(), from);
    if (clash !== undefined) throw new Error(`File already exists: ${clash}`);
    const moves = new Map([[from, to]]);
    const plan = this.planLinkRewrites(moves);
    const own = this.planOwnLinks(moves);
    await this.registerFolders(to);
    this.files.delete(from);
    this.files.set(to, { ...file, path: to, mtime: Date.now() });
    await this.adapter.renameFile(from, to);
    this.emit({ type: 'rename', oldPath: from, newPath: to });
    await this.rewriteLinks(plan, own, moves);
  }

  async createFolder(path: string): Promise<void> {
    const p = this.inExistingFolders(normalizePath(path));
    if (!p) return;
    if (this.folderExists(p)) throw new Error(`Folder already exists: ${p}`);
    const clash = this.caseVariantOf(p, this.getFolders(), '');
    if (clash !== undefined) throw new Error(`Folder already exists: ${clash}`);
    await this.registerFolders(p);
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
    const to = this.inExistingFolders(normalizePath(newPath));
    if (!from || !to) throw new Error('Invalid folder path.');
    if (from === to) return;
    // Names that differ only in case are one folder on macOS and Windows, so inside such a variant is inside `from`.
    const sameEntry = from.toLowerCase() === to.toLowerCase();
    if (!sameEntry && isWithin(to.toLowerCase(), from.toLowerCase())) throw new Error('Cannot move a folder into itself.');
    if (this.folderExists(to)) throw new Error(`Folder already exists: ${to}`);
    const clash = this.caseVariantOf(to, this.getFolders(), from);
    if (clash !== undefined) throw new Error(`Folder already exists: ${clash}`);
    const moves = new Map<string, string>();
    for (const path of this.files.keys()) if (isWithin(path, from)) moves.set(path, to + path.slice(from.length));
    const plan = this.planLinkRewrites(moves);
    const own = this.planOwnLinks(moves);
    await this.registerFolders(to);
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
    await this.rewriteLinks(plan, own, moves);
  }

  /** Links that point at notes about to move (old path -> new path), found while those notes are still in place. */
  private planLinkRewrites(moves: ReadonlyMap<string, string>): LinkRewritePlan {
    return planLinkRewrites(this.getMarkdownFiles(), moves, (target, from) => this.resolveLink(target, from));
  }

  /** What the links written in the notes about to move resolve to, found while those notes are still in place. */
  private planOwnLinks(moves: ReadonlyMap<string, string>): LinkRewritePlan {
    const moved = [...moves.keys()].filter((p) => isMarkdown(p)).map((p) => this.files.get(p)!);
    return planOwnLinks(moved, (target, from) => this.resolveLink(target, from));
  }

  /**
   * Rewrite links now that the notes have moved: links to a moved note become `[[New]]` like in Obsidian, and a
   * moved note's own links keep pointing at the notes they did from its old folder.
   */
  private async rewriteLinks(plan: LinkRewritePlan, own: LinkRewritePlan, moves: ReadonlyMap<string, string>): Promise<void> {
    const resolve = (target: string, from: string) => this.resolveLink(target, from);
    for (const source of new Set([...plan.keys(), ...own.keys()])) {
      const path = moves.get(source) ?? source;
      const file = this.files.get(path);
      if (!file) continue;
      const rewrites = new Map(plan.get(source));
      const before = own.get(source);
      if (before) for (const [raw, target] of ownLinkRewrites(path, file.content, before, moves, resolve)) rewrites.set(raw, target);
      const next = applyLinkRewrites(path, file.content, rewrites, (p) => this.linkTextFor(p, path));
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
