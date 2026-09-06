import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../app';
import { useWorkspace } from '../../state/store';
import { click, flush, keydown, mount, seedApp } from '../paneTestUtils';
import { BacklinksPane } from './BacklinksPane';

const unlinked = (root: Element) => root.querySelectorAll('[data-testid="unlinked-mention"]');
const linked = (root: Element) => root.querySelectorAll('[data-testid="backlink-item"]');

function openWelcome() {
  useWorkspace.getState().openFile('Welcome.md');
  const view = mount(<BacklinksPane path="Welcome.md" />);
  click(view.container.querySelector('.backlinks-toggle')!);
  return view;
}

describe('BacklinksPane', () => {
  beforeEach(async () => {
    await seedApp({
      'Welcome.md': '# Welcome',
      'Mention.md': '[[Welcome]] one\nWelcome two\nWelcome three',
    });
  });

  it('lists the plain mentions of a note that already links to it', () => {
    const { container, unmount } = openWelcome();
    expect(linked(container)).toHaveLength(1);
    expect(unlinked(container)).toHaveLength(2);
    unmount();
  });

  it('keeps listing the remaining mentions after one is linked', async () => {
    const { container, unmount } = openWelcome();
    click(unlinked(container)[0].querySelector('button')!);
    await flush();
    expect(app.vault.getFile('Mention.md')?.content).toBe('[[Welcome]] one\n[[Welcome]] two\nWelcome three');
    expect(unlinked(container)).toHaveLength(1);
    expect(useWorkspace.getState().activeFile).toBe('Welcome.md');
    unmount();
  });

  it('does not run the row action when Enter is pressed on a nested button', async () => {
    const { container, unmount } = openWelcome();
    keydown(container.querySelector('button[aria-label="Link to Welcome"]')!, 'Enter');
    keydown(container.querySelector('.backlink-group-title button.pane-chevron')!, 'Enter');
    await flush();
    expect(useWorkspace.getState().activeFile).toBe('Welcome.md');
    expect(app.vault.getFile('Mention.md')?.content).toBe('[[Welcome]] one\nWelcome two\nWelcome three');
    unmount();
  });

  it('opens the source on Enter on the row itself and swallows the key', () => {
    const { container, unmount } = openWelcome();
    const event = keydown(unlinked(container)[1], 'Enter');
    expect(event.defaultPrevented).toBe(true);
    expect(useWorkspace.getState().activeFile).toBe('Mention.md');
    expect(useWorkspace.getState().pendingNavigation).toMatchObject({ path: 'Mention.md', line: 2 });
    unmount();
  });
});
