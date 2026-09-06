import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';
import type { Delimiter, StateCore, StateInline, Token } from 'markdown-it';
import { basename, noteTitle } from '../vault/path';
import { headingsMatch } from './headingLink';
import { frontmatterTags, normalizeTagName, parseFrontmatter, parseHeadings, parseLinkInner, TAG_BOUNDARY_CHARS, TAG_NAME_CHARS } from './links';

export interface RenderContext {
  /** Path of the note being rendered. */
  path: string;
  /** Resolve a wikilink target to a vault path, or undefined when the note does not exist. */
  resolveLink: (target: string) => string | undefined;
  /** Content of a note to embed with `![[note]]`. Embeds fall back to links when this is missing. */
  getEmbedContent?: (path: string) => string | undefined;
  /** Obsidian's "Strict line breaks": when true a single newline does not start a new line. Off by default. */
  strictLineBreaks?: boolean;
}

/** How many levels of `![[embed]]` are rendered before falling back to a link. */
export const MAX_EMBED_DEPTH = 2;
/**
 * How many `![[embeds]]` (nested ones included) one rendered note expands before the rest fall back to links. Together
 * with the cycle check in renderEmbed this keeps a note of N self-embeds, which would otherwise render N + N^2 copies of
 * itself, from freezing the page.
 */
export const MAX_EMBEDS = 100;

const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp)$/i;

type LinkParts = NonNullable<ReturnType<typeof parseLinkInner>>;

interface RenderEnv {
  ctx: RenderContext;
  depth: number;
  /** Added to markdown-it line numbers so `data-line` refers to the full source. */
  lineOffset: number;
  slugs: Map<string, number>;
  /** Shared by every document of one renderMarkdown call: how many embeds may still be expanded. */
  budget: { embeds: number };
  /** The note and sections (`path`, `path#line`) whose embedding led to this document; embedding one again is a cycle. */
  stack: string[];
}

interface CheckboxMeta {
  checked: boolean;
  line: number;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ----- slugs -----

/** Heading id: lowercase, trimmed, spaces to dashes, punctuation removed (unicode letters/digits, `-` and `_` kept). */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]+/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

/** Slug that is unique within `seen` (`foo`, `foo-1`, `foo-2`, ...). Mutates `seen`. */
export function uniqueSlug(text: string, seen: Map<string, number>): string {
  const base = slugify(text) || 'heading';
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return count === 0 ? base : `${base}-${count}`;
}

// ----- tasks -----

const TASK_PREFIX = /^\[( |x|X)\](?=\s|$)/;
const TASK_LINE = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/;

/** Flip the `[ ]` / `[x]` marker of the task on the given 0-based line. Returns the content unchanged when it is not a task. */
export function toggleTaskLine(content: string, line: number): string {
  const lines = content.split('\n');
  const text = lines[line];
  if (text === undefined) return content;
  const next = text.replace(TASK_LINE, (_m, pre: string, mark: string, post: string) => `${pre}${mark === ' ' ? 'x' : ' '}${post}`);
  if (next === text) return content;
  lines[line] = next;
  return lines.join('\n');
}

// ----- sections (for `![[note#heading]]`) -----

/** The markdown of a heading's section: from the heading to the next heading of the same or a higher level. */
export function extractSection(content: string, heading: string): { text: string; line: number } | undefined {
  const headings = parseHeadings(content);
  // Compared in link form, like navigation does: `![[Note#A B]]` is how autocomplete writes `## A | B`.
  const i = headings.findIndex((h) => headingsMatch(h.text, heading));
  if (i === -1) return undefined;
  const start = headings[i];
  const end = headings.slice(i + 1).find((h) => h.level <= start.level);
  return { text: content.slice(start.position.start, end?.position.start), line: start.position.line };
}

// ----- inline rules -----

/** `[[target|alias]]`, `[[target#heading]]`, `![[embed]]`. */
function wikilinkRule(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  let pos = state.pos;
  const embed = src.charCodeAt(pos) === 0x21; /* ! */
  if (embed) pos++;
  if (src.charCodeAt(pos) !== 0x5b || src.charCodeAt(pos + 1) !== 0x5b) return false;
  const close = src.indexOf(']]', pos + 2);
  if (close === -1 || close + 2 > state.posMax) return false;
  const inner = src.slice(pos + 2, close);
  if (inner.includes(']') || inner.includes('\n')) return false;
  const link = parseLinkInner(inner);
  if (!link) return false;
  if (!silent) {
    const token = state.push(embed ? 'embed' : 'wikilink', 'a', 0);
    token.meta = link;
    token.content = src.slice(state.pos, close + 2);
  }
  state.pos = close + 2;
  return true;
}

const TAG_NAME = new RegExp(`[${TAG_NAME_CHARS}]+`, 'uy');
const TAG_BOUNDARY = new RegExp(`[${TAG_BOUNDARY_CHARS}]`);

/** markdown-it raises `linkLevel` while it tokenizes a link label; the typings omit the field. */
type InlineState = StateInline & { linkLevel: number };

/** `#tag`, with the same rules as parseInlineTags. Not inside a link label, like markdown-it's own linkify rule. */
function tagRule(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const pos = state.pos;
  if (src.charCodeAt(pos) !== 0x23 /* # */) return false;
  if ((state as InlineState).linkLevel > 0) return false;
  if (pos > 0 && TAG_BOUNDARY.test(src[pos - 1])) return false;
  TAG_NAME.lastIndex = pos + 1;
  const m = TAG_NAME.exec(src);
  if (!m) return false;
  const name = normalizeTagName(m[0]);
  if (name === null || pos + 1 + name.length > state.posMax) return false;
  if (!silent) {
    const token = state.push('tag', 'a', 0);
    token.meta = { name };
    token.content = '#' + name;
  }
  state.pos = pos + 1 + name.length;
  return true;
}

const MARK = 0x3d; /* = */

/** `==highlight==`, delimiter-based like markdown-it's strikethrough. */
function highlightTokenize(state: StateInline, silent: boolean): boolean {
  if (silent || state.src.charCodeAt(state.pos) !== MARK) return false;
  const scanned = state.scanDelims(state.pos, true);
  let len = scanned.length;
  if (len < 2) return false;
  if (len % 2) {
    state.push('text', '', 0).content = '=';
    len--;
  }
  for (let i = 0; i < len; i += 2) {
    state.push('text', '', 0).content = '==';
    state.delimiters.push({ marker: MARK, length: 0, token: state.tokens.length - 1, end: -1, open: scanned.can_open, close: scanned.can_close });
  }
  state.pos += scanned.length;
  return true;
}

function pairHighlights(state: StateInline, delimiters: Delimiter[]): void {
  const lone: number[] = [];
  for (const start of delimiters) {
    if (start.marker !== MARK || start.end === -1) continue;
    const end = delimiters[start.end];
    const open = state.tokens[start.token];
    const close = state.tokens[end.token];
    Object.assign(open, { type: 'mark_open', tag: 'mark', nesting: 1, markup: '==', content: '' });
    Object.assign(close, { type: 'mark_close', tag: 'mark', nesting: -1, markup: '==', content: '' });
    const before = state.tokens[end.token - 1];
    if (before.type === 'text' && before.content === '=') lone.push(end.token - 1);
  }
  // An odd run like `=====` leaves a stray `=` before the closer; move it after the closing tags.
  while (lone.length) {
    const i = lone.pop() as number;
    let j = i + 1;
    while (j < state.tokens.length && state.tokens[j].type === 'mark_close') j++;
    j--;
    if (i !== j) [state.tokens[i], state.tokens[j]] = [state.tokens[j], state.tokens[i]];
  }
}

function highlightPostProcess(state: StateInline): boolean {
  pairHighlights(state, state.delimiters);
  for (const meta of state.tokens_meta) if (meta?.delimiters) pairHighlights(state, meta.delimiters);
  return true;
}

// ----- core rule: heading ids, source lines, task list items -----

const LINE_TYPES = new Set(['heading_open', 'paragraph_open', 'list_item_open', 'blockquote_open', 'fence', 'code_block', 'hr', 'table_open']);

function annotateBlocks(state: StateCore): void {
  const env = state.env as RenderEnv;
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'paragraph_open' && tokens[i + 1]?.type === 'inline') unwrapEmbeds(t, tokens[i + 1], tokens[i + 2], env);
    if (t.map && !t.hidden && LINE_TYPES.has(t.type)) t.attrSet('data-line', String(t.map[0] + env.lineOffset));
    if (t.type === 'heading_open' && tokens[i + 1]?.type === 'inline') {
      const text = tokens[i + 1].content.trim();
      t.attrSet('id', uniqueSlug(text, env.slugs));
      t.attrSet('data-heading', text);
    }
    if (t.type === 'inline' && tokens[i - 1]?.type === 'paragraph_open' && tokens[i - 2]?.type === 'list_item_open') {
      markTask(state, tokens[i - 2], t, env);
    }
  }
}

function markTask(state: StateCore, item: Token, inline: Token, env: RenderEnv): void {
  const first = inline.children?.[0];
  if (!first || first.type !== 'text') return;
  const m = TASK_PREFIX.exec(first.content);
  if (!m) return;
  const checked = m[1] !== ' ';
  const line = (item.map?.[0] ?? 0) + env.lineOffset;
  first.content = first.content.slice(m[0].length).replace(/^ /, '');
  item.attrJoin('class', checked ? 'task-list-item is-checked' : 'task-list-item');
  const box = new state.Token('checkbox', 'input', 0);
  box.meta = { checked, line } satisfies CheckboxMeta;
  inline.children?.unshift(box);
}

/**
 * A paragraph holding nothing but `![[embeds]]` renders them as blocks (as Obsidian does): the embed takes over the
 * paragraph's source line and the `<p>` is dropped, instead of being split around the block by the HTML parser.
 */
function unwrapEmbeds(open: Token, inline: Token, close: Token | undefined, env: RenderEnv): void {
  const children = inline.children ?? [];
  const embeds = children.filter((c) => c.type === 'embed');
  if (open.hidden || embeds.length === 0 || close?.type !== 'paragraph_close') return;
  if (!children.every((c) => c.type === 'embed' || c.type === 'softbreak' || (c.type === 'text' && c.content.trim() === ''))) return;
  let line = (open.map?.[0] ?? 0) + env.lineOffset;
  for (const c of children) {
    if (c.type === 'softbreak') line++;
    else if (c.type === 'embed') c.attrSet('data-line', String(line));
  }
  inline.children = embeds;
  open.hidden = true;
  close.hidden = true;
}

// ----- markdown-it instance -----

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });
// Only auto-link text that carries a scheme, as Obsidian does: `README.md`, `main.py` or `example.com` stay plain text.
md.linkify.set({ fuzzyLink: false, fuzzyEmail: false });
md.inline.ruler.before('link', 'wikilink', wikilinkRule);
md.inline.ruler.before('emphasis', 'highlight', highlightTokenize);
md.inline.ruler2.before('emphasis', 'highlight', highlightPostProcess);
md.inline.ruler.push('tag', tagRule);
md.core.ruler.after('inline', 'noto_blocks', annotateBlocks);

function renderTagLink(name: string): string {
  return `<a class="tag" data-tag="${escapeHtml(name)}" href="#">#${escapeHtml(name)}</a>`;
}

function renderInternalLink(link: LinkParts, env: RenderEnv): string {
  const unresolved = link.target !== '' && env.ctx.resolveLink(link.target) === undefined;
  const cls = unresolved ? 'internal-link is-unresolved' : 'internal-link';
  const heading = link.heading !== undefined ? ` data-heading="${escapeHtml(link.heading)}"` : '';
  return `<a class="${cls}" data-href="${escapeHtml(link.target)}"${heading} href="#">${escapeHtml(link.display)}</a>`;
}

/**
 * `line` is set when the embed was unwrapped from its paragraph (see unwrapEmbeds): the block then carries the source
 * line itself, and an inline fallback (missing note, image) gets its paragraph back.
 */
function renderEmbed(link: LinkParts, env: RenderEnv, line: string | null): string {
  const inline = (html: string) => (line === null ? html : `<p data-line="${escapeHtml(line)}">${html}</p>`);
  if (IMAGE_EXT.test(link.target)) return inline(`<span class="embed-missing">${escapeHtml(basename(link.target))}</span>`);
  const resolved = link.target === '' ? env.ctx.path : env.ctx.resolveLink(link.target);
  const expand = resolved !== undefined && env.depth < MAX_EMBED_DEPTH && env.budget.embeds > 0;
  const content = expand ? env.ctx.getEmbedContent?.(resolved) : undefined;
  if (resolved === undefined || content === undefined) return inline(renderInternalLink(link, env));
  let body = { text: content, line: 0 };
  if (link.heading !== undefined) {
    const section = extractSection(content, link.heading);
    if (!section) return inline(renderInternalLink(link, env));
    body = section;
  }
  // A note embedding itself (or two notes embedding each other) would otherwise be copied N^2 times for N embeds.
  const key = link.heading === undefined ? resolved : `${resolved}#${body.line}`;
  if (env.stack.includes(key)) return inline(renderInternalLink(link, env));
  env.budget.embeds--;
  const title = link.heading !== undefined ? `${noteTitle(resolved)} > ${link.heading}` : noteTitle(resolved);
  const inner = renderDocument(body.text, { ...env.ctx, path: resolved }, env.depth + 1, body.line, env.budget, [...env.stack, key]);
  const heading = link.heading !== undefined ? ` data-heading="${escapeHtml(link.heading)}"` : '';
  const lineAttr = line === null ? '' : ` data-line="${escapeHtml(line)}"`;
  return (
    `<div class="markdown-embed" data-href="${escapeHtml(link.target || resolved)}"${heading}${lineAttr}>` +
    `<div class="markdown-embed-title">${escapeHtml(title)}</div>` +
    `<div class="markdown-embed-content">${inner}</div></div>`
  );
}

const EXTERNAL_HREF = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/** `Note.md#Heading` (as written in `[text](...)`, percent-encoded by markdown-it) into a wikilink-style target and heading. */
function markdownLinkParts(href: string): { target: string; heading: string | undefined } {
  let decoded = href;
  try {
    decoded = decodeURIComponent(href);
  } catch {
    // Keep the raw href when it is not valid percent-encoding.
  }
  const hash = decoded.indexOf('#');
  const target = (hash === -1 ? decoded : decoded.slice(0, hash)).trim().replace(/\.md$/i, '');
  const heading = hash === -1 ? '' : decoded.slice(hash + 1).trim();
  return { target, heading: heading || undefined };
}

md.renderer.rules.wikilink = (tokens, idx, _options, env) => renderInternalLink(tokens[idx].meta as LinkParts, env as RenderEnv);
md.renderer.rules.embed = (tokens, idx, _options, env) => renderEmbed(tokens[idx].meta as LinkParts, env as RenderEnv, tokens[idx].attrGet('data-line'));
md.renderer.rules.tag = (tokens, idx) => renderTagLink((tokens[idx].meta as { name: string }).name);
md.renderer.rules.checkbox = (tokens, idx) => {
  const { checked, line } = tokens[idx].meta as CheckboxMeta;
  return `<input type="checkbox" class="task-list-item-checkbox" data-line="${line}"${checked ? ' checked' : ''}>`;
};
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const href = token.attrGet('href') ?? '';
  if (EXTERNAL_HREF.test(href)) {
    token.attrJoin('class', 'external-link');
    token.attrSet('target', '_blank');
    token.attrSet('rel', 'noopener');
  } else if (href !== '') {
    // `[text](Note.md#Heading)` and `[text](#heading)` open notes like wikilinks instead of navigating the browser.
    const { target, heading } = markdownLinkParts(href);
    const unresolved = target !== '' && (env as RenderEnv).ctx.resolveLink(target) === undefined;
    token.attrJoin('class', unresolved ? 'internal-link is-unresolved' : 'internal-link');
    token.attrSet('data-href', target);
    if (heading !== undefined) token.attrSet('data-heading', heading);
    token.attrSet('href', '#');
  }
  return self.renderToken(tokens, idx, options);
};
md.renderer.rules.table_open = (tokens, idx, options, _env, self) => {
  tokens[idx].attrJoin('class', 'table');
  return self.renderToken(tokens, idx, options);
};

// ----- front matter -----

/** Front matter as a compact key/value block. Empty string when there are no properties. */
export function renderProperties(data: Record<string, unknown>): string {
  const keys = Object.keys(data);
  if (keys.length === 0) return '';
  const rows = keys.map((key) => {
    const value = data[key];
    let html: string;
    if (key === 'tags' || key === 'tag') html = frontmatterTags({ [key]: value }).map(renderTagLink).join('');
    else if (Array.isArray(value)) html = value.map((v) => `<span class="property-chip">${escapeHtml(String(v))}</span>`).join('');
    else html = escapeHtml(String(value));
    return `<div class="property"><div class="property-key">${escapeHtml(key)}</div><div class="property-value">${html}</div></div>`;
  });
  return `<div class="properties">${rows.join('')}</div>`;
}

function countLines(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/** Render a note body (front matter stripped) without sanitizing. `depth` > 0 for embedded notes. */
function renderDocument(content: string, ctx: RenderContext, depth: number, lineOffset: number, budget: { embeds: number }, stack: string[]): string {
  const fm = parseFrontmatter(content);
  const env: RenderEnv = { ctx, depth, lineOffset: lineOffset + countLines(content.slice(0, fm.bodyStart)), slugs: new Map(), budget, stack };
  const props = depth === 0 ? renderProperties(fm.data) : '';
  return props + md.render(content.slice(fm.bodyStart), env);
}

const PURIFY_OPTIONS = { ADD_ATTR: ['data-href', 'data-heading', 'data-tag', 'data-line', 'target'] };

/** Render a note to sanitized HTML for the reading view. */
export function renderMarkdown(content: string, ctx: RenderContext): string {
  md.set({ breaks: !ctx.strictLineBreaks });
  return DOMPurify.sanitize(renderDocument(content, ctx, 0, 0, { embeds: MAX_EMBEDS }, [ctx.path]), PURIFY_OPTIONS);
}
