import { describe, expect, it } from 'vitest';
import { applyLinkRewrites, planLinkRewrites, replaceLinkTarget } from './linkRewrite';

describe('replaceLinkTarget', () => {
  it('replaces only the target part of a wikilink', () => {
    expect(replaceLinkTarget('[[Old]]', 'New')).toBe('[[New]]');
    expect(replaceLinkTarget('[[Old|alias]]', 'New')).toBe('[[New|alias]]');
    expect(replaceLinkTarget('[[Old#Heading]]', 'New')).toBe('[[New#Heading]]');
    expect(replaceLinkTarget('[[Old#^block|alias]]', 'New')).toBe('[[New#^block|alias]]');
    expect(replaceLinkTarget('![[Old]]', 'dir/New')).toBe('![[dir/New]]');
    expect(replaceLinkTarget('[[ Old.md | alias ]]', 'New')).toBe('[[New| alias ]]');
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
});
