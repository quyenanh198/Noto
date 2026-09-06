/**
 * Path helpers for vault-relative paths. Vault paths use `/`, never start with `/`, never contain `.` or `..` segments.
 * Segments are kept verbatim: names on disk may start or end with spaces, and trimming them would make the vault
 * address a different entry than the one it listed. User-typed names are trimmed by the UI before they get here.
 */

export function normalizePath(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  const out: string[] = [];
  for (const seg of parts) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.join('/');
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

export function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

export function extname(path: string): string {
  const base = basename(path);
  const i = base.lastIndexOf('.');
  return i <= 0 ? '' : base.slice(i);
}

export function stripExt(path: string): string {
  const ext = extname(path);
  return ext ? path.slice(0, -ext.length) : path;
}

export function joinPath(...parts: string[]): string {
  return normalizePath(parts.filter(Boolean).join('/'));
}

export function isMarkdown(path: string): boolean {
  return extname(path).toLowerCase() === '.md';
}

/** Ensure a note path ends with `.md`. */
export function withMdExt(path: string): string {
  return isMarkdown(path) ? path : `${path}.md`;
}

/** Title of a note: basename without extension. */
export function noteTitle(path: string): string {
  return stripExt(basename(path));
}

/** True if `child` is `parent` itself or nested under it. */
export function isWithin(child: string, parent: string): boolean {
  if (parent === '') return true;
  return child === parent || child.startsWith(parent + '/');
}

/** All ancestor folders of a path, shallowest first: `a/b/c.md` -> [`a`, `a/b`]. */
export function ancestors(path: string): string[] {
  const out: string[] = [];
  let i = path.indexOf('/');
  while (i !== -1) {
    out.push(path.slice(0, i));
    i = path.indexOf('/', i + 1);
  }
  return out;
}

const INVALID_NAME = /[\\/:*?"<>|#^[\]]/;

/** Validate a single file or folder name (not a path). Returns an error message or null. */
export function validateName(name: string): string | null {
  const n = name.trim();
  if (!n) return 'Name cannot be empty.';
  if (n === '.' || n === '..') return 'Invalid name.';
  if (INVALID_NAME.test(n)) return 'Name contains invalid characters: \\ / : * ? " < > | # ^ [ ]';
  return null;
}
