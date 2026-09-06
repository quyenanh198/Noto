import { describe, expect, it } from 'vitest';
import { findNavigationTarget } from './ReadingView';

describe('findNavigationTarget', () => {
  it('finds headings by their link text', () => {
    const root = document.createElement('div');
    root.innerHTML = '<h2 id="a-b" data-heading="A | B">A | B</h2><h2 id="ef" data-heading="E]F">E]F</h2><p data-line="4">x</p>';
    const [first, second] = [...root.querySelectorAll('h2')];
    expect(findNavigationTarget(root, { path: 'n.md', heading: 'A | B' })).toBe(first);
    expect(findNavigationTarget(root, { path: 'n.md', heading: 'A B' })).toBe(first);
    expect(findNavigationTarget(root, { path: 'n.md', heading: 'e f' })).toBe(second);
    expect(findNavigationTarget(root, { path: 'n.md', heading: 'nope' })).toBeNull();
  });
});
