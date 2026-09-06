import { expect, test, type Page } from '@playwright/test';
import { mod, openApp, openViaSwitcher } from './helpers';

/** Content of a note as persisted in the browser vault. */
function persisted(page: Page, path: string): Promise<string | null> {
  return page.evaluate(
    (p) =>
      new Promise<string | null>((resolve, reject) => {
        const req = indexedDB.open('noto-vault-default', 1);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const get = req.result.transaction('files').objectStore('files').get(p);
          get.onsuccess = () => resolve((get.result as { content?: string } | undefined)?.content ?? null);
        };
      }),
    path,
  );
}

async function renameInExplorer(page: Page, path: string, name: string) {
  await page.locator(`[data-testid="explorer-item"][data-path="${path}"]`).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const input = page.getByTestId('explorer-rename-input');
  await input.fill(name);
  await input.press('Enter');
}

test.describe('vault operations', () => {
  test('renaming a folder keeps the open note and its unsaved edit', async ({ page }) => {
    const errors = await openApp(page);
    await openViaSwitcher(page, 'roadmap');
    await page.locator('.cm-content').click();
    await page.keyboard.press(`${mod}+End`);
    await page.keyboard.type('\nPending edit');
    await renameInExplorer(page, 'Projects', 'Work');
    await expect(page.getByTestId('view-title')).toHaveText('Work/Noto roadmap.md');
    await expect(page.getByTestId('tab-bar').locator('.tab')).toHaveCount(1);
    await expect(page.locator('.cm-content')).toContainText('Pending edit');
    await page.waitForTimeout(500);
    expect(await persisted(page, 'Work/Noto roadmap.md')).toContain('Pending edit');
    expect(errors).toEqual([]);
  });

  test('renaming a note rewrites the links to it and keeps its backlinks', async ({ page }) => {
    await openApp(page);
    await openViaSwitcher(page, 'Linking');
    await renameInExplorer(page, 'Linking notes.md', 'Linked notes');
    await expect(page.getByTestId('view-title')).toHaveText('Linked notes.md');
    await page.getByRole('tab', { name: 'Backlinks' }).click();
    await expect(page.getByTestId('backlinks-pane')).toContainText('[[Linked notes]]');
    await expect(page.getByTestId('status-bar')).toContainText('3 backlinks');
    expect(await persisted(page, 'Welcome.md')).toContain('[[Linked notes]] explains');
    // The old link text is gone, so clicking a link does not create a duplicate note.
    await openViaSwitcher(page, 'Welcome');
    await page.getByTestId('toggle-view-mode').click();
    await page.getByTestId('reading-view').locator('a.internal-link', { hasText: 'Linked notes' }).first().click();
    await expect(page.getByTestId('view-title')).toHaveText('Linked notes.md');
    await expect(page.locator('[data-testid="explorer-item"][data-path="Linking notes.md"]')).toHaveCount(0);
  });
});

test.describe('navigation history', () => {
  test('back returns to the restored note after a reload', async ({ page }) => {
    await openApp(page);
    await page.reload();
    await page.getByTestId('app').waitFor();
    await expect(page.getByTestId('view-title')).toHaveText('Welcome.md');
    await openViaSwitcher(page, 'Markdown syntax');
    await expect(page.getByRole('button', { name: 'Navigate back' })).toBeEnabled();
    await page.keyboard.press('Alt+ArrowLeft');
    await expect(page.getByTestId('view-title')).toHaveText('Welcome.md');
  });

  test('deleted notes do not come back through back/forward', async ({ page }) => {
    await openApp(page);
    page.on('dialog', (d) => d.accept());
    await openViaSwitcher(page, 'Linking');
    await page.keyboard.press(`${mod}+p`);
    await page.getByTestId('command-palette-input').fill('Delete current file');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('empty-state')).toBeVisible();
    await page.keyboard.press('Alt+ArrowLeft');
    await expect(page.getByTestId('view-title')).toHaveText('Welcome.md');
    await page.keyboard.press('Alt+ArrowRight');
    await expect(page.getByTestId('view-title')).toHaveText('Welcome.md');
    await expect(page.getByTestId('tab-bar').locator('.tab')).toHaveCount(1);
    await expect(page.getByTestId('empty-state')).toBeHidden();
  });
});

test.describe('views', () => {
  test('the reading view toggle keeps the scroll position', async ({ page }) => {
    await openApp(page);
    await page.locator('.cm-content').click();
    await page.keyboard.press(`${mod}+End`);
    await page.keyboard.insertText(Array.from({ length: 60 }, (_, i) => `\n\nParagraph ${i + 1} of a long note, long enough to need scrolling.`).join(''));
    await page.waitForTimeout(500);
    const editor = page.locator('.markdown-editor');
    await editor.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await page.keyboard.press(`${mod}+e`);
    const reading = page.getByTestId('reading-view');
    await expect(reading).toBeVisible();
    await expect.poll(() => reading.evaluate((el) => el.scrollTop)).toBeGreaterThan(1000);
    await page.keyboard.press(`${mod}+e`);
    await expect(editor).toBeVisible();
    await expect.poll(() => editor.evaluate((el) => el.scrollTop)).toBeGreaterThan(1000);
  });

  test('undo history survives switching tabs', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press(`${mod}+Alt+n`);
    await expect(page.getByTestId('view-title')).toHaveText('Untitled.md');
    await page.locator('.cm-content').click();
    await page.keyboard.type('Undo me');
    await page.waitForTimeout(500);
    await page.locator('[data-testid="explorer-item"][data-path="Welcome.md"]').click({ modifiers: [mod] });
    await expect(page.getByTestId('view-title')).toHaveText('Welcome.md');
    await page.getByTestId('tab-bar').locator('.tab', { hasText: 'Untitled' }).click();
    await expect(page.locator('.cm-content')).toContainText('Undo me');
    await page.keyboard.press(`${mod}+z`);
    await expect(page.locator('.cm-content')).not.toContainText('Undo me');
  });

  test('the search hotkey focuses the search box even when the pane is showing', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press(`${mod}+Shift+f`);
    await expect(page.getByTestId('search-input')).toBeFocused();
    await page.locator('.cm-content').click();
    await page.keyboard.press(`${mod}+Shift+f`);
    await expect(page.getByTestId('search-input')).toBeFocused();
  });

  test('toggling reading view while the graph is open does not change the note', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press(`${mod}+g`);
    await expect(page.getByTestId('graph-view')).toBeVisible();
    await page.keyboard.press(`${mod}+e`);
    await page.keyboard.press(`${mod}+g`);
    await expect(page.getByTestId('editor')).toBeVisible();
  });
});
