import { type Completion, CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { beforeAll, describe, expect, it } from 'vitest';
import { MetadataIndex } from '../../core/index/MetadataIndex';
import { MemoryAdapter } from '../../core/vault/storage';
import { Vault } from '../../core/vault/Vault';
import { closingBrackets, createCompletionSources, noteCompletions } from './completion';

const vault = new Vault(
  new MemoryAdapter({
    folders: [],
    files: [
      { path: 'Welcome.md', content: '# Welcome\n\nSee [[Missing note]] and #getting-started', mtime: 0 },
      { path: 'Markdown syntax.md', content: '# Markdown syntax\n\n## Text\n\n## Code\n\n#reference/links', mtime: 0 },
      { path: 'Projects/Plan.md', content: 'a', mtime: 0 },
      { path: 'Archive/Plan.md', content: 'b', mtime: 0 },
      { path: 'image.png', content: '', mtime: 0 },
    ],
  }),
);
const index = new MetadataIndex(vault);

beforeAll(async () => {
  await vault.load();
  index.attach();
});

async function complete(doc: string, path = 'Welcome.md', explicit = false): Promise<CompletionResult | null> {
  const state = EditorState.create({ doc, selection: { anchor: doc.length } });
  for (const source of createCompletionSources({ vault, index, path })) {
    const result = await source(new CompletionContext(state, doc.length, explicit));
    if (result) return result;
  }
  return null;
}

const labels = (r: CompletionResult | null) => (r?.options ?? []).map((o) => o.label);

describe('closingBrackets', () => {
  it('adds only the brackets that are missing after the cursor', () => {
    expect(closingBrackets(']]')).toBe('');
    expect(closingBrackets(']] tail')).toBe('');
    expect(closingBrackets(']')).toBe(']');
    expect(closingBrackets('')).toBe(']]');
    expect(closingBrackets(' x')).toBe(']]');
  });
});

describe('noteCompletions', () => {
  it('lists markdown notes by link text, using full paths for duplicate names, plus unresolved targets', () => {
    const options = noteCompletions(vault, index);
    const byLabel = new Map(options.map((o) => [o.label, o]));
    expect(byLabel.get('Welcome')?.detail).toBe('Welcome.md');
    expect(byLabel.has('Projects/Plan')).toBe(true);
    expect(byLabel.has('Archive/Plan')).toBe(true);
    expect(byLabel.has('Plan')).toBe(false);
    expect(byLabel.has('image')).toBe(false);
    expect(byLabel.get('Missing note')?.detail).toBe('new');
  });
});

describe('completion sources', () => {
  it('suggests notes after [[', async () => {
    const result = await complete('Go to [[Wel');
    expect(result?.from).toBe(8);
    expect(labels(result)).toContain('Welcome');
    expect(labels(result)).toContain('Missing note');
  });

  it('suggests headings after [[Note#', async () => {
    const result = await complete('[[Markdown syntax#Co');
    expect(result?.from).toBe(18);
    expect(labels(result)).toEqual(['Markdown syntax', 'Text', 'Code']);
  });

  it('suggests headings of the current note after [[#', async () => {
    const result = await complete('[[#', 'Markdown syntax.md');
    expect(labels(result)).toEqual(['Markdown syntax', 'Text', 'Code']);
  });

  it('suggests tags after a # preceded by whitespace, but not at the line start', async () => {
    const result = await complete('note #ge');
    expect(result?.from).toBe(6);
    expect(labels(result)).toEqual(['getting-started', 'reference/links']);
    expect(await complete('#ge')).toBeNull();
    expect(await complete('plain text')).toBeNull();
  });

  it('inserts the link text and closes the brackets exactly once', async () => {
    const apply = async (doc: string) => {
      const result = await complete(doc);
      const option = result?.options.find((o) => o.label === 'Welcome') as Completion;
      const view = new EditorView({ state: EditorState.create({ doc, selection: { anchor: doc.length } }) });
      (option.apply as (view: EditorView, c: Completion, from: number, to: number) => void)(view, option, result?.from ?? 0, doc.length);
      const out = { doc: view.state.doc.toString(), cursor: view.state.selection.main.head };
      view.destroy();
      return out;
    };
    expect(await apply('[[Wel')).toEqual({ doc: '[[Welcome]]', cursor: 11 });
    const state = EditorState.create({ doc: '[[Wel]]', selection: { anchor: 5 } });
    const source = createCompletionSources({ vault, index, path: 'Welcome.md' })[1];
    const result = (await source(new CompletionContext(state, 5, false))) as CompletionResult;
    const option = result.options.find((o) => o.label === 'Welcome') as Completion;
    const view = new EditorView({ state });
    (option.apply as (view: EditorView, c: Completion, from: number, to: number) => void)(view, option, result.from, 5);
    expect(view.state.doc.toString()).toBe('[[Welcome]]');
    expect(view.state.selection.main.head).toBe(11);
    view.destroy();
  });
});
