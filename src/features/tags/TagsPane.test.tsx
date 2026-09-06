import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspace } from '../../state/store';
import { click, keydown, mount, seedApp } from '../paneTestUtils';
import { TagsPane } from './TagsPane';

const rows = (root: Element) => [...root.querySelectorAll('[data-testid="tag-item"]')].map((el) => [el.getAttribute('data-tag'), el.querySelector('.tag-item-count')?.textContent]);

describe('TagsPane', () => {
  beforeEach(async () => {
    await seedApp({
      'Tagcase.md': 'one #Project/Alpha',
      'Tagcase2.md': 'two #project/alpha',
      'Roadmap.md': 'three #project/noto',
    });
  });

  it('shows one row per tag regardless of casing, with a header that matches the rows', () => {
    const { container, unmount } = mount(<TagsPane />);
    const shown = rows(container);
    expect(shown.map(([tag]) => tag?.toLowerCase())).toEqual(['project', 'project/alpha', 'project/noto']);
    expect(shown.map(([, count]) => count)).toEqual(['3', '2', '1']);
    expect(container.querySelector('.pane-count')?.textContent).toBe(String(shown.length));
    unmount();
  });

  it('lets Enter on a chevron reach the button without starting a search', () => {
    const { container, unmount } = mount(<TagsPane />);
    const before = { query: useWorkspace.getState().searchQuery, tab: useWorkspace.getState().leftTab };
    keydown(container.querySelector('button.pane-chevron')!, 'Enter');
    expect(useWorkspace.getState().searchQuery).toBe(before.query);
    expect(useWorkspace.getState().leftTab).toBe(before.tab);
    click(container.querySelector('button.pane-chevron')!);
    expect(rows(container)).toHaveLength(1);
    unmount();
  });

  it('searches on Enter on the row itself', () => {
    const { container, unmount } = mount(<TagsPane />);
    const event = keydown(container.querySelectorAll('[data-testid="tag-item"]')[2], 'Enter');
    expect(event.defaultPrevented).toBe(true);
    expect(useWorkspace.getState().searchQuery.toLowerCase()).toBe('tag:#project/noto');
    unmount();
  });
});
