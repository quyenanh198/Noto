import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { frontmatter } from './frontmatter';
import { activeLines, collectPreviewSpecs, isRevealed, type PreviewSpec, tagAt, wikilinkAt } from './previewSpecs';

function stateFor(doc: string, selection = EditorSelection.cursor(0)) {
  return EditorState.create({ doc, selection, extensions: [markdown({ base: markdownLanguage, extensions: [frontmatter] })] });
}

function specsFor(doc: string): PreviewSpec[] {
  const state = stateFor(doc);
  const tree = ensureSyntaxTree(state, doc.length, 5000);
  if (!tree) throw new Error('parse did not finish');
  return collectPreviewSpecs(state, 0, doc.length, tree);
}

const hides = (specs: PreviewSpec[]) => specs.filter((s) => s.kind === 'hide').map((s) => [s.from, s.to]);
const ofKind = <K extends PreviewSpec['kind']>(specs: PreviewSpec[], kind: K) => specs.filter((s): s is Extract<PreviewSpec, { kind: K }> => s.kind === kind);

describe('collectPreviewSpecs', () => {
  it('hides heading hashes and marks the heading line', () => {
    const specs = specsFor('## Title');
    expect(hides(specs)).toEqual([[0, 3]]);
    expect(ofKind(specs, 'line')).toEqual([{ kind: 'line', from: 0, cls: 'cm-heading-line cm-heading-2' }]);
  });

  it('hides emphasis, strong, strikethrough and inline code markers', () => {
    const specs = specsFor('*a* **b** ~~c~~ `d`');
    expect(hides(specs)).toEqual([
      [0, 1],
      [2, 3],
      [4, 6],
      [7, 9],
      [10, 12],
      [13, 15],
      [16, 17],
      [18, 19],
    ]);
  });

  it('renders wikilinks and hides their brackets', () => {
    const specs = specsFor('See [[Welcome]] now');
    expect(ofKind(specs, 'wikilink')).toEqual([{ kind: 'wikilink', from: 4, to: 15, target: 'Welcome' }]);
    expect(hides(specs)).toEqual([
      [4, 6],
      [13, 15],
    ]);
  });

  it('shows only the alias of an aliased link', () => {
    const specs = specsFor('[[Welcome|alias]]');
    expect(hides(specs)).toEqual([
      [0, 10],
      [15, 17],
    ]);
  });

  it('keeps the embed bang outside the link mark', () => {
    const specs = specsFor('![[Image]]');
    expect(ofKind(specs, 'wikilink')[0]).toMatchObject({ from: 1, to: 10, target: 'Image' });
  });

  it('ignores links, tags and highlights inside code', () => {
    const specs = specsFor('`[[x]] #tag ==hi==`\n\n```\n[[y]] #other\n```');
    expect(ofKind(specs, 'wikilink')).toEqual([]);
    expect(ofKind(specs, 'tag')).toEqual([]);
    expect(ofKind(specs, 'mark').filter((m) => m.cls === 'cm-highlight')).toEqual([]);
  });

  it('finds tags', () => {
    const specs = specsFor('hello #tag/sub world');
    expect(ofKind(specs, 'tag')).toEqual([{ kind: 'tag', from: 6, to: 14, name: 'tag/sub' }]);
  });

  it('does not paint tags inside wikilinks', () => {
    const specs = specsFor('x [[#Explore]] y [[Other|see #todo]] #real');
    expect(ofKind(specs, 'tag')).toEqual([{ kind: 'tag', from: 37, to: 42, name: 'real' }]);
    expect(ofKind(specs, 'wikilink').map((w) => w.target)).toEqual(['', 'Other']);
  });

  it('marks highlights and hides the equals signs', () => {
    const specs = specsFor('a ==hi== b');
    expect(ofKind(specs, 'mark')).toEqual([{ kind: 'mark', from: 4, to: 6, cls: 'cm-highlight' }]);
    expect(hides(specs)).toEqual([
      [2, 4],
      [6, 8],
    ]);
  });

  it('describes task markers and strikes done tasks', () => {
    const specs = specsFor('- [ ] todo\n- [x] done');
    expect(ofKind(specs, 'task')).toEqual([
      { kind: 'task', from: 2, to: 5, checked: false },
      { kind: 'task', from: 13, to: 16, checked: true },
    ]);
    expect(ofKind(specs, 'mark')).toEqual([{ kind: 'mark', from: 16, to: 21, cls: 'cm-task-done' }]);
  });

  it('marks every line of a fenced code block, with start and end classes', () => {
    const specs = specsFor('```js\nlet x;\n```');
    expect(ofKind(specs, 'line').map((l) => l.cls)).toEqual([
      'cm-codeblock-line cm-codeblock-start',
      'cm-codeblock-line',
      'cm-codeblock-line cm-codeblock-end',
    ]);
  });

  it('marks quote lines and horizontal rules', () => {
    const specs = specsFor('> quoted\n\ntext\n\n---\n');
    expect(ofKind(specs, 'line')).toEqual([{ kind: 'line', from: 0, cls: 'cm-quote-line' }]);
    expect(ofKind(specs, 'hr')).toEqual([{ kind: 'hr', from: 16, to: 19 }]);
  });

  it('treats front matter as one block without rules, headings or links', () => {
    const specs = specsFor('---\ntags: [a]\nsee: [[Welcome]]\n---\n\n# Title');
    expect(ofKind(specs, 'line').map((l) => l.cls)).toEqual([
      'cm-frontmatter-line',
      'cm-frontmatter-line',
      'cm-frontmatter-line',
      'cm-frontmatter-line',
      'cm-heading-line cm-heading-1',
    ]);
    expect(ofKind(specs, 'hr')).toEqual([]);
    expect(ofKind(specs, 'wikilink')).toEqual([]);
    expect(hides(specs)).toEqual([[36, 38]]);
    // Unclosed front matter runs to the end of the document; `---` elsewhere is still a rule.
    expect(ofKind(specsFor('---\nkey: v\n\n# Not a heading'), 'line').every((l) => l.cls === 'cm-frontmatter-line')).toBe(true);
    expect(ofKind(specsFor('text\n\n---\n'), 'hr')).toHaveLength(1);
  });

  it('only collects specs for the requested range', () => {
    const doc = '# One\n\n# Two';
    const state = stateFor(doc);
    const tree = ensureSyntaxTree(state, doc.length, 5000);
    if (!tree) throw new Error('parse did not finish');
    const specs = collectPreviewSpecs(state, 7, doc.length, tree);
    expect(hides(specs)).toEqual([[7, 9]]);
  });
});

describe('active lines', () => {
  it('reveals markup only on lines touched by the selection', () => {
    const doc = '# One\n**two**\nthree';
    const cursor = stateFor(doc, EditorSelection.cursor(8));
    const active = activeLines(cursor);
    expect([...active]).toEqual([2]);
    expect(isRevealed(cursor, active, 0)).toBe(false);
    expect(isRevealed(cursor, active, 6)).toBe(true);

    const range = stateFor(doc, EditorSelection.range(2, 15));
    expect([...activeLines(range)]).toEqual([1, 2, 3]);
  });
});

describe('lookups at a position', () => {
  it('finds the wikilink and tag under a position', () => {
    const state = stateFor('x [[Note#Head|alias]] #tag y');
    expect(wikilinkAt(state, 5)).toMatchObject({ target: 'Note', heading: 'Head', alias: 'alias' });
    expect(wikilinkAt(state, 0)).toBeUndefined();
    expect(tagAt(state, 24)).toMatchObject({ name: 'tag' });
    expect(tagAt(state, 5)).toBeUndefined();
  });

  it('sees a same-note heading link as a link, not a tag', () => {
    const state = stateFor('[[#Explore]] #tag');
    expect(tagAt(state, 4)).toBeUndefined();
    expect(wikilinkAt(state, 4)).toMatchObject({ target: '', heading: 'Explore' });
  });
});
