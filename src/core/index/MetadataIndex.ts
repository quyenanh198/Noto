import type { GraphData, GraphEdge, GraphNode, NoteMetadata, VaultEvent, WikiLink } from '../types';
import { parseNote } from '../markdown/links';
import { isMarkdown, noteTitle } from '../vault/path';
import type { Vault } from '../vault/Vault';

export interface Backlink {
  /** Path of the note that contains the link. */
  source: string;
  links: WikiLink[];
}

export interface UnresolvedLink {
  /** Link target text as written. */
  target: string;
  sources: string[];
}

export interface GraphOptions {
  includeUnresolved?: boolean;
  includeTags?: boolean;
  /** Restrict to the neighborhood of this note. */
  localTo?: string;
  /** Neighborhood depth for `localTo` (default 1). */
  depth?: number;
}

/**
 * Derived data over the vault: parsed metadata per note, resolved links, backlinks, tags.
 * Kept in sync via vault events. `revision` bumps on every update.
 */
export class MetadataIndex {
  private meta = new Map<string, NoteMetadata>();
  /** path -> set of resolved target paths */
  private outgoing = new Map<string, Set<string>>();
  /** path -> set of source paths linking to it */
  private incoming = new Map<string, Set<string>>();
  /** unresolved link target (lower-cased) -> source paths */
  private unresolved = new Map<string, Set<string>>();
  /** tag name -> set of paths */
  private tagIndex = new Map<string, Set<string>>();
  private listeners = new Set<() => void>();
  revision = 0;
  private unsubscribe: (() => void) | null = null;

  constructor(private vault: Vault) {}

  /** Build the index from the vault and start following its events. */
  attach(): void {
    this.rebuild();
    this.unsubscribe?.();
    this.unsubscribe = this.vault.on((e) => this.handle(e));
  }

  detach(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  rebuild(): void {
    this.meta.clear();
    this.tagIndex.clear();
    for (const f of this.vault.getMarkdownFiles()) this.parse(f.path, f.content);
    this.resolveAll();
    this.bump();
  }

  private handle(e: VaultEvent): void {
    switch (e.type) {
      case 'reload':
      case 'folder-delete':
      case 'folder-rename':
        this.rebuild();
        return;
      case 'folder-create':
        return;
      case 'create':
      case 'modify': {
        const file = this.vault.getFile(e.path);
        if (!file || !isMarkdown(file.path)) return;
        this.parse(file.path, file.content);
        // A new file may resolve links that were previously unresolved; a modified file only changes its own edges.
        if (e.type === 'create') this.resolveAll();
        else this.resolveOne(file.path);
        this.bump();
        return;
      }
      case 'delete':
        this.forget(e.path);
        this.resolveAll();
        this.bump();
        return;
      case 'rename': {
        this.forget(e.oldPath);
        const file = this.vault.getFile(e.newPath);
        if (file && isMarkdown(file.path)) this.parse(file.path, file.content);
        this.resolveAll();
        this.bump();
        return;
      }
    }
  }

  private parse(path: string, content: string): void {
    const old = this.meta.get(path);
    if (old) for (const t of old.tags) this.tagIndex.get(t.name)?.delete(path);
    const m = parseNote(path, content);
    this.meta.set(path, m);
    for (const t of m.tags) {
      let set = this.tagIndex.get(t.name);
      if (!set) this.tagIndex.set(t.name, (set = new Set()));
      set.add(path);
    }
    for (const [tag, set] of [...this.tagIndex]) if (set.size === 0) this.tagIndex.delete(tag);
  }

  private forget(path: string): void {
    const old = this.meta.get(path);
    if (!old) return;
    for (const t of old.tags) {
      const set = this.tagIndex.get(t.name);
      set?.delete(path);
      if (set && set.size === 0) this.tagIndex.delete(t.name);
    }
    this.meta.delete(path);
  }

  private resolveAll(): void {
    this.outgoing.clear();
    this.incoming.clear();
    this.unresolved.clear();
    for (const path of this.meta.keys()) this.resolveOne(path, false);
  }

  private resolveOne(path: string, clearOld = true): void {
    if (clearOld) {
      for (const target of this.outgoing.get(path) ?? []) this.incoming.get(target)?.delete(path);
      for (const [target, set] of [...this.unresolved]) {
        set.delete(path);
        if (set.size === 0) this.unresolved.delete(target);
      }
    }
    const m = this.meta.get(path);
    if (!m) return;
    const out = new Set<string>();
    for (const link of m.links) {
      if (!link.target) continue; // same-note heading/block link
      const resolved = this.vault.resolveLink(link.target, path);
      if (resolved) {
        out.add(resolved);
        let inc = this.incoming.get(resolved);
        if (!inc) this.incoming.set(resolved, (inc = new Set()));
        inc.add(path);
      } else {
        const key = link.target.toLowerCase();
        let set = this.unresolved.get(key);
        if (!set) this.unresolved.set(key, (set = new Set()));
        set.add(path);
      }
    }
    this.outgoing.set(path, out);
  }

  // ----- queries -----

  getMetadata(path: string): NoteMetadata | undefined {
    return this.meta.get(path);
  }

  getAllMetadata(): NoteMetadata[] {
    return [...this.meta.values()];
  }

  /** Paths this note links to (resolved). */
  getOutgoingLinks(path: string): string[] {
    return [...(this.outgoing.get(path) ?? [])].sort();
  }

  /** Notes linking to `path`, with the specific link occurrences. */
  getBacklinks(path: string): Backlink[] {
    const sources = [...(this.incoming.get(path) ?? [])].sort();
    return sources.map((source) => {
      const m = this.meta.get(source);
      const links = (m?.links ?? []).filter((l) => l.target && this.vault.resolveLink(l.target, source) === path);
      return { source, links };
    });
  }

  /** Link targets that do not resolve to any file, with the notes that use them. */
  getUnresolvedLinks(): UnresolvedLink[] {
    const out: UnresolvedLink[] = [];
    for (const [key, sources] of this.unresolved) {
      // Recover the original casing from the first source that uses it.
      const first = [...sources][0];
      const link = this.meta.get(first)?.links.find((l) => l.target.toLowerCase() === key);
      out.push({ target: link?.target ?? key, sources: [...sources].sort() });
    }
    return out.sort((a, b) => a.target.localeCompare(b.target));
  }

  /** Unresolved link targets written in `path`. */
  getUnresolvedLinksFrom(path: string): string[] {
    const m = this.meta.get(path);
    if (!m) return [];
    const out = new Set<string>();
    for (const l of m.links) if (l.target && !this.vault.resolveLink(l.target, path)) out.add(l.target);
    return [...out];
  }

  /** All tags with their usage counts, sorted by name. */
  getTags(): Array<{ name: string; count: number }> {
    return [...this.tagIndex]
      .map(([name, set]) => ({ name, count: set.size }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Paths tagged with `tag` (exact) or any nested tag under it (`tag/...`). Case-insensitive. */
  getFilesWithTag(tag: string): string[] {
    const t = tag.replace(/^#/, '').toLowerCase();
    const out = new Set<string>();
    for (const [name, set] of this.tagIndex) {
      const n = name.toLowerCase();
      if (n === t || n.startsWith(t + '/')) for (const p of set) out.add(p);
    }
    return [...out].sort();
  }

  /** Graph of notes. Unresolved links become ghost nodes when `includeUnresolved` (default true). */
  getGraph(options: GraphOptions = {}): GraphData {
    const { includeUnresolved = true, includeTags = false } = options;
    const nodes = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];
    const seenEdge = new Set<string>();
    const addNode = (id: string, label: string, kind: GraphNode['kind']) => {
      if (!nodes.has(id)) nodes.set(id, { id, label, kind, degree: 0 });
    };
    const addEdge = (source: string, target: string) => {
      const key = `${source} ${target}`;
      if (seenEdge.has(key) || source === target || !nodes.has(source) || !nodes.has(target)) return;
      seenEdge.add(key);
      edges.push({ source, target });
    };
    for (const path of this.meta.keys()) addNode(path, noteTitle(path), 'note');
    for (const [source, targets] of this.outgoing) {
      for (const target of targets) addEdge(source, target);
    }
    if (includeUnresolved) {
      for (const u of this.getUnresolvedLinks()) {
        const id = `unresolved:${u.target.toLowerCase()}`;
        addNode(id, u.target, 'unresolved');
        for (const s of u.sources) addEdge(s, id);
      }
    }
    if (includeTags) {
      for (const [tag, paths] of this.tagIndex) {
        const id = `tag:${tag}`;
        addNode(id, `#${tag}`, 'tag');
        for (const p of paths) addEdge(p, id);
      }
    }
    let keptNodes = [...nodes.values()];
    let keptEdges = edges;
    if (options.localTo !== undefined) {
      const depth = options.depth ?? 1;
      const keep = new Set<string>([options.localTo]);
      let frontier = new Set<string>([options.localTo]);
      for (let d = 0; d < depth; d++) {
        const next = new Set<string>();
        for (const e of edges) {
          if (frontier.has(e.source) && !keep.has(e.target)) { keep.add(e.target); next.add(e.target); }
          if (frontier.has(e.target) && !keep.has(e.source)) { keep.add(e.source); next.add(e.source); }
        }
        frontier = next;
      }
      keptEdges = edges.filter((e) => keep.has(e.source) && keep.has(e.target));
      keptNodes = keptNodes.filter((n) => keep.has(n.id));
    }
    const degree = new Map<string, number>();
    for (const e of keptEdges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    }
    return { nodes: keptNodes.map((n) => ({ ...n, degree: degree.get(n.id) ?? 0 })), edges: keptEdges };
  }

  // ----- events -----

  on(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private bump(): void {
    this.revision++;
    for (const l of this.listeners) l();
  }
}
