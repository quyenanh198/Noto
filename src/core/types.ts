export interface VaultFile {
  /** Normalized vault-relative path, e.g. `folder/note.md`. */
  path: string;
  content: string;
  mtime: number;
}

export interface VaultSnapshot {
  files: VaultFile[];
  /** Explicitly created folders (may be empty). Implicit folders come from file paths. */
  folders: string[];
}

export type VaultEvent =
  | { type: 'create'; path: string }
  | { type: 'modify'; path: string }
  | { type: 'delete'; path: string }
  | { type: 'rename'; oldPath: string; newPath: string }
  | { type: 'folder-create'; path: string }
  | { type: 'folder-delete'; path: string }
  | { type: 'folder-rename'; oldPath: string; newPath: string }
  | { type: 'reload' };

export type StorageKind = 'memory' | 'indexeddb' | 'fsa' | 'server';

/** Persistence backend. The Vault keeps the in-memory truth and mirrors changes here. */
export interface StorageAdapter {
  readonly kind: StorageKind;
  load(): Promise<VaultSnapshot>;
  /** Store a new file. Rejects when the backend already holds an entry at `path`, even one `load()` did not report. */
  createFile(path: string, content: string): Promise<void>;
  /** Store the content of a file, replacing whatever is at `path`. */
  writeFile(path: string, content: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  renameFile(oldPath: string, newPath: string): Promise<void>;
  createFolder(path: string): Promise<void>;
  deleteFolder(path: string): Promise<void>;
  renameFolder(oldPath: string, newPath: string): Promise<void>;
}

export interface TextRange {
  start: number;
  end: number;
  line: number;
}

export interface WikiLink {
  /** Raw link target as written, without alias/heading, e.g. `My Note` or `folder/My Note`. */
  target: string;
  alias?: string;
  heading?: string;
  block?: string;
  embed: boolean;
  /** Text to show for the link (alias, or target plus heading). */
  display: string;
  /** The full original text including brackets. */
  raw: string;
  position: TextRange;
}

export interface TagRef {
  /** Tag without the leading `#`, e.g. `project/alpha`. */
  name: string;
  position: TextRange;
}

export interface HeadingRef {
  level: number;
  text: string;
  position: TextRange;
}

export interface NoteMetadata {
  path: string;
  /** Basename without extension. */
  title: string;
  links: WikiLink[];
  tags: TagRef[];
  headings: HeadingRef[];
  frontmatter: Record<string, unknown>;
  /** Content with frontmatter stripped; offsets in links/tags/headings refer to the full content. */
  wordCount: number;
}

export interface GraphNode {
  id: string;
  /** Display label (title). */
  label: string;
  /** `note` for existing files, `unresolved` for links to missing notes, `tag` for tag nodes. */
  kind: 'note' | 'unresolved' | 'tag';
  /** Number of incoming + outgoing edges. */
  degree: number;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
