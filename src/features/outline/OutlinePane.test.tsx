import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspace } from '../../state/store';
import { click, keydown, mount, seedApp } from '../paneTestUtils';
import { OutlinePane } from './OutlinePane';

const item = (root: Element, i: number) => root.querySelectorAll('[data-testid="outline-item"]')[i];
const lines = (root: Element) => [...root.querySelectorAll('[data-testid="outline-item"]')].map((el) => el.getAttribute('data-line'));
const chevron = (root: Element, i: number) => item(root, i).querySelector('button.pane-chevron')!;

describe('OutlinePane', () => {
  beforeEach(async () => {
    await seedApp({
      'Dup.md': '# A\n\n## Notes\nfirst notes\n\n## Notes\nsecond notes\n',
      'Kids.md': '# A\n\n## Notes\n\n### x\n\n## Notes\n\n### y\n',
      'Other.md': '# B\n\n## Notes\n\n### z\n',
    });
    useWorkspace.getState().openFile('Dup.md');
  });

  it('navigates by the heading position, so duplicate headings are reachable', () => {
    const { container, unmount } = mount(<OutlinePane path="Dup.md" />);
    expect(lines(container)).toEqual(['0', '2', '5']);
    click(item(container, 2));
    expect(useWorkspace.getState().pendingNavigation).toMatchObject({ path: 'Dup.md', line: 5 });
    unmount();
  });

  it('gives same-text headings independent collapse state', () => {
    const { container, unmount } = mount(<OutlinePane path="Kids.md" />);
    expect(lines(container)).toEqual(['0', '2', '4', '6', '8']);
    click(chevron(container, 1));
    expect(lines(container)).toEqual(['0', '2', '6', '8']);
    click(chevron(container, 1));
    expect(lines(container)).toEqual(['0', '2', '4', '6', '8']);
    unmount();
  });

  it('does not carry collapse state over to another note', () => {
    const { container, rerender, unmount } = mount(<OutlinePane path="Kids.md" />);
    click(chevron(container, 1));
    expect(lines(container)).toEqual(['0', '2', '6', '8']);
    rerender(<OutlinePane path="Other.md" />);
    expect(lines(container)).toEqual(['0', '2', '4']);
    unmount();
  });

  it('lets Enter on a chevron reach the button without navigating', () => {
    const { container, unmount } = mount(<OutlinePane path="Kids.md" />);
    keydown(chevron(container, 1), 'Enter');
    expect(useWorkspace.getState().pendingNavigation).toBeNull();
    expect(useWorkspace.getState().activeFile).toBe('Dup.md');
    unmount();
  });

  it('navigates on Enter on the row itself and swallows the key', () => {
    const { container, unmount } = mount(<OutlinePane path="Dup.md" />);
    const event = keydown(item(container, 2), 'Enter');
    expect(event.defaultPrevented).toBe(true);
    expect(useWorkspace.getState().pendingNavigation).toMatchObject({ path: 'Dup.md', line: 5 });
    unmount();
  });
});
