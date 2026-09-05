import { expect, test } from '@playwright/test';
import { mod, openApp, openViaSwitcher } from './helpers';

test.describe('shell', () => {
  test('loads the sample vault and shows the welcome note', async ({ page }) => {
    const errors = await openApp(page);
    await expect(page.getByTestId('tab-bar').locator('.tab')).toHaveCount(1);
    await expect(page.getByTestId('status-bar')).toContainText('backlinks');
    await expect(page.getByTestId('file-explorer')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('theme toggle persists across reloads', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('body')).toHaveClass(/theme-dark/);
    await page.getByRole('button', { name: 'Toggle theme' }).click();
    await expect(page.locator('body')).toHaveClass(/theme-light/);
    await page.reload();
    await page.getByTestId('app').waitFor();
    await expect(page.locator('body')).toHaveClass(/theme-light/);
  });

  test('view mode toggle switches between editor and reading view', async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId('editor')).toBeVisible();
    await page.getByTestId('toggle-view-mode').click();
    await expect(page.getByTestId('reading-view')).toBeVisible();
    await expect(page.getByTestId('reading-view')).toContainText('Welcome to Noto');
    await page.keyboard.press(`${mod}+e`);
    await expect(page.getByTestId('editor')).toBeVisible();
  });
});

test.describe('file explorer', () => {
  test('opens notes and folders', async ({ page }) => {
    await openApp(page);
    const explorer = page.getByTestId('file-explorer');
    await explorer.locator('[data-testid="explorer-item"][data-path="Projects"]').click();
    await explorer.locator('[data-testid="explorer-item"][data-path="Projects/Noto roadmap.md"]').click();
    await expect(page.getByTestId('view-title')).toHaveText('Projects/Noto roadmap.md');
    await expect(page.getByTestId('tab-bar').locator('.tab.is-active')).toContainText('Noto roadmap');
  });

  test('creates, renames and deletes a note', async ({ page }) => {
    await openApp(page);
    page.on('dialog', (d) => d.accept());
    await page.getByTestId('explorer-new-note').click();
    await expect(page.getByTestId('view-title')).toHaveText('Untitled.md');
    const row = page.locator('[data-testid="explorer-item"][data-path="Untitled.md"]');
    await expect(row).toBeVisible();
    await row.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    const input = page.getByTestId('explorer-rename-input');
    await input.fill('My renamed note');
    await input.press('Enter');
    await expect(page.getByTestId('view-title')).toHaveText('My renamed note.md');
    const renamed = page.locator('[data-testid="explorer-item"][data-path="My renamed note.md"]');
    await renamed.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await expect(renamed).toBeHidden();
    await expect(page.getByTestId('view-title')).not.toHaveText('My renamed note.md');
  });
});

test.describe('editor', () => {
  test('edits persist across reloads', async ({ page }) => {
    await openApp(page);
    const content = page.locator('.cm-content');
    await content.click();
    await page.keyboard.press(`${mod}+End`);
    await page.keyboard.type('\nPersisted sentence from e2e.');
    await page.waitForTimeout(600);
    await page.reload();
    await page.getByTestId('app').waitFor();
    await expect(page.locator('.cm-content')).toContainText('Persisted sentence from e2e.');
    await expect(page.getByTestId('status-bar')).toContainText('words');
  });

  test('wikilink autocomplete inserts a link and the link navigates', async ({ page }) => {
    await openApp(page);
    const content = page.locator('.cm-content');
    await content.click();
    await page.keyboard.press(`${mod}+End`);
    await page.keyboard.type('\nSee [[Markdown');
    await expect(page.locator('.cm-tooltip-autocomplete')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(content).toContainText('[[Markdown syntax]]');
    await page.waitForTimeout(500);
    await page.getByTestId('toggle-view-mode').click();
    await page.getByTestId('reading-view').locator('a.internal-link', { hasText: 'Markdown syntax' }).first().click();
    await expect(page.getByTestId('view-title')).toHaveText('Markdown syntax.md');
  });

  test('bold hotkey wraps the selection', async ({ page }) => {
    await openApp(page);
    const content = page.locator('.cm-content');
    await content.click();
    await page.keyboard.press(`${mod}+End`);
    await page.keyboard.type('\nbold me');
    await page.keyboard.press('Shift+Home');
    await page.keyboard.press(`${mod}+b`);
    await expect(content).toContainText('**bold me**');
  });
});

test.describe('palettes', () => {
  test('quick switcher opens and creates notes', async ({ page }) => {
    await openApp(page);
    await openViaSwitcher(page, 'road');
    await expect(page.getByTestId('view-title')).toHaveText('Projects/Noto roadmap.md');
    await openViaSwitcher(page, 'Brand new note');
    await expect(page.getByTestId('view-title')).toHaveText('Brand new note.md');
    await expect(page.locator('[data-testid="explorer-item"][data-path="Brand new note.md"]')).toBeVisible();
  });

  test('command palette runs commands', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press(`${mod}+p`);
    const input = page.getByTestId('command-palette-input');
    await input.fill('toggle reading');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('reading-view')).toBeVisible();
    await page.keyboard.press(`${mod}+p`);
    await page.getByTestId('command-palette-input').fill('graph view');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('graph-view')).toBeVisible();
  });
});

test.describe('search, tags, backlinks, outline', () => {
  test('search finds text and opens the match', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const input = page.getByTestId('search-input');
    await input.fill('knowledge');
    await expect(page.getByTestId('search-result-file').first()).toBeVisible();
    await expect(page.getByTestId('search-summary')).toContainText('result');
    await page.getByTestId('search-result-match').first().click();
    await expect(page.getByTestId('view-title')).not.toHaveText('');
    await input.fill('tag:#reference');
    await expect(page.locator('[data-testid="search-result-file"][data-path="Markdown syntax.md"]')).toBeVisible();
  });

  test('tags pane pushes a tag search', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Tags', exact: true }).click();
    await expect(page.getByTestId('tags-pane')).toBeVisible();
    await page.locator('[data-testid="tag-item"][data-tag="getting-started"]').click();
    await expect(page.getByTestId('search-input')).toHaveValue('tag:#getting-started');
    await expect(page.locator('[data-testid="search-result-file"][data-path="Welcome.md"]')).toBeVisible();
  });

  test('backlinks list linked mentions and navigate', async ({ page }) => {
    await openApp(page);
    await page.getByRole('tab', { name: 'Backlinks' }).click();
    const pane = page.getByTestId('backlinks-pane');
    await expect(pane).toContainText('Linking notes');
    await expect(pane).toContainText('Markdown syntax');
    await expect(pane).toContainText('Noto roadmap');
    await pane.locator('[data-testid="backlink-item"][data-source="Linking notes.md"]').first().click();
    await expect(page.getByTestId('view-title')).toHaveText('Linking notes.md');
  });

  test('outline lists headings', async ({ page }) => {
    await openApp(page);
    await page.getByRole('tab', { name: 'Outline' }).click();
    const items = page.getByTestId('outline-item');
    await expect(items).toHaveCount(3);
    await expect(items.nth(1)).toContainText('Get started');
  });
});

test.describe('graph', () => {
  test('global graph renders the vault nodes', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Graph view' }).click();
    await expect(page.getByTestId('graph-view')).toBeVisible();
    await expect(page.getByTestId('graph-info')).toContainText('5 nodes');
    await page.getByRole('tab', { name: 'Local graph' }).click();
    await expect(page.getByTestId('right-sidebar').getByTestId('graph-view')).toBeVisible();
  });
});

test.describe('settings', () => {
  test('settings modal opens and changes font size', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByTestId('settings-modal')).toBeVisible();
    await page.getByTestId('settings-nav-appearance').click();
    const range = page.getByTestId('settings-modal').locator('input[type="range"]').first();
    await range.fill('20');
    const size = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--font-size').trim());
    expect(size).toBe('20px');
    await page.getByTestId('settings-nav-vault').click();
    await expect(page.getByTestId('settings-modal')).toContainText('Browser storage');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('settings-modal')).toBeHidden();
  });
});
