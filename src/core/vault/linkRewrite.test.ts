import { describe, expect, it } from 'vitest';
import { applyLinkRewrites, ownLinkRewrites, planLinkRewrites, planOwnLinks, replaceLinkTarget } from './linkRewrite';

describe('replaceLinkTarget', () => {
  it('replaces only the target part of a wikilink', () => {
    expect(replaceLinkTarget('[[Old]]', 'New')).toBe('[[New]]');
    expect(replaceLinkTarget('[[Old|alias]]', 'New')).toBe('[[New|alias]]');
    expect(replaceLinkTarget('[[Old#Heading]]', 'New')).toBe('[[New#Heading]]');
    expect(replaceLinkTarget('[[Old#^block|alias]]', 'New')).toBe('[[New#^block|alias]]');
    expect(replaceLinkTarget('![[Old]]', 'dir/New')).toBe('![[dir/New]]');
    expect(replaceLinkTarget('[[ Old.md | alias ]]', 'New')).toBe('[[New| alias ]]');
  });

  it('keeps the backslash that escapes the alias separator inside tables', () => {
    expect(replaceLinkTarget('[[Old\\|alias]]', 'New')).toBe('[[New\\|alias]]');
    expect(replaceLinkTarget('![[Old\\|alias]]', 'New')).toBe('![[New\\|alias]]');
    expect(replaceLinkTarget('[[Old#H\\|alias]]', 'New')).toBe('[[New#H\\|alias]]');
  });
});

describe('planLinkRewrites / applyLinkRewrites', () => {
  const files = [
    { path: 'A.md', content: 'See [[Old]], [[Old|alias]], [[old#H]], ![[Old]], `[[Old]]` and [[Other]].', mtime: 1 },
    { path: 'Old.md', content: 'Self [[Old]] and [[#Heading]]', mtime: 1 },
    { path: 'B.md', content: 'Nothing here', mtime: 1 },
  ];
  const resolve = (target: string) => (['old', 'old.md'].includes(target.toLowerCase()) ? 'Old.md' : target === 'Other' ? 'Other.md' : undefined);
  const moves = new Map([['Old.md', 'New.md']]);

  it('finds the links that resolve to moved notes, skipping code and other targets', () => {
    const plan = planLinkRewrites(files, moves, resolve);
    expect([...plan.keys()]).toEqual(['A.md', 'Old.md']);
    expect([...plan.get('A.md')!.keys()]).toEqual(['[[Old]]', '[[Old|alias]]', '[[old#H]]', '![[Old]]']);
    expect(plan.get('Old.md')).toEqual(new Map([['[[Old]]', 'New.md']]));
  });

  it('rewrites the planned links and leaves everything else alone', () => {
    const plan = planLinkRewrites(files, moves, resolve);
    expect(applyLinkRewrites('A.md', files[0].content, plan.get('A.md')!, () => 'New')).toBe(
      'See [[New]], [[New|alias]], [[New#H]], ![[New]], `[[Old]]` and [[Other]].',
    );
    // Content that changed since planning is re-parsed, so shifted positions cannot corrupt it.
    expect(applyLinkRewrites('A.md', 'typed more [[Old]] [[Other]]', plan.get('A.md')!, () => 'New')).toBe('typed more [[New]] [[Other]]');
  });

  it('plans links to notes whose names contain dots or keep an extension', () => {
    const dotted = [
      { path: 'A.md', content: 'See [[Release 1.2]], [[Release 1.2.md|v]], [[notes.txt]] and [[Release 1]]', mtime: 1 },
      { path: 'Release 1.2.md', content: '', mtime: 1 },
    ];
    const byName = new Map([
      ['release 1.2', 'Release 1.2.md'],
      ['release 1.2.md', 'Release 1.2.md'],
      ['notes.txt', 'notes.txt'],
    ]);
    const plan = planLinkRewrites(dotted, new Map([['Release 1.2.md', 'Release 1.3.md'], ['notes.txt', 'Archive/notes.txt']]), (t) => byName.get(t.toLowerCase()));
    expect(plan.get('A.md')).toEqual(
      new Map([
        ['[[Release 1.2]]', 'Release 1.3.md'],
        ['[[Release 1.2.md|v]]', 'Release 1.3.md'],
        ['[[notes.txt]]', 'Archive/notes.txt'],
      ]),
    );
  });
});

describe('planOwnLinks / ownLinkRewrites', () => {
  const note = { path: 'a/Note.md', content: 'See [[Local]], [[Global]], [[b/Local]], [[Missing]] and [[#Heading]]', mtime: 1 };
  const files = new Set(['a/Local.md', 'b/Local.md', 'Global.md']);
  /** Like the vault: exact path, then relative to the source folder, then any note with that name. */
  const resolve = (target: string, from: string): string | undefined => {
    if (files.has(`${target}.md`)) return `${target}.md`;
    const rel = `${from.slice(0, from.lastIndexOf('/'))}/${target}.md`;
    if (files.has(rel)) return rel;
    return [...files].find((f) => f.endsWith(`/${target}.md`));
  };

  it('records what each link of a note about to move resolves to from its old place', () => {
    const plan = planOwnLinks([note], resolve);
    expect(plan.get('a/Note.md')).toEqual(
      new Map([
        ['[[Local]]', 'a/Local.md'],
        ['[[Global]]', 'Global.md'],
        ['[[b/Local]]', 'b/Local.md'],
      ]),
    );
    expect(planOwnLinks([{ path: 'b/Empty.md', content: 'nothing', mtime: 1 }], resolve).size).toBe(0);
  });

  it('rewrites only the links that would resolve elsewhere from the new place', () => {
    const before = planOwnLinks([note], resolve).get('a/Note.md')!;
    const moves = new Map([['a/Note.md', 'b/Note.md']]);
    expect(ownLinkRewrites('b/Note.md', note.content, before, moves, resolve)).toEqual(new Map([['[[Local]]', 'a/Local.md']]));
    // A link to a note that moved too keeps pointing at that note's new path.
    files.delete('a/Local.md');
    files.add('c/Local.md');
    const both = new Map([...moves, ['a/Local.md', 'c/Local.md']]);
    expect(ownLinkRewrites('b/Note.md', note.content, before, both, resolve)).toEqual(new Map([['[[Local]]', 'c/Local.md']]));
  });
});
