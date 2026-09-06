import { describe, expect, it } from 'vitest';
import { headingLinkText, headingsMatch } from './headingLink';

describe('headingLinkText', () => {
  it('replaces characters that cannot appear inside [[Note#heading]] and collapses whitespace', () => {
    expect(headingLinkText('A | B')).toBe('A B');
    expect(headingLinkText('E]F')).toBe('E F');
    expect(headingLinkText('C# [notes] ^ref')).toBe('C notes ref');
    expect(headingLinkText('  Plain heading ')).toBe('Plain heading');
  });
});

describe('headingsMatch', () => {
  it('matches a heading against its link text, ignoring case', () => {
    expect(headingsMatch('A | B', 'A B')).toBe(true);
    expect(headingsMatch('E]F', 'e f')).toBe(true);
    expect(headingsMatch('Plain', 'plain')).toBe(true);
    expect(headingsMatch('Plain', 'Other')).toBe(false);
  });
});
