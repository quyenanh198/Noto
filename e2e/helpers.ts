import { expect, type Page } from '@playwright/test';

export async function openApp(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await page.getByTestId('app').waitFor();
  await expect(page.getByTestId('view-title')).toHaveText('Welcome.md');
  return errors;
}

export async function openViaSwitcher(page: Page, query: string) {
  await page.keyboard.press('Control+o');
  const input = page.getByTestId('quick-switcher-input');
  await input.waitFor();
  await input.fill(query);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('quick-switcher')).toBeHidden();
}

export const isMac = process.platform === 'darwin';
export const mod = isMac ? 'Meta' : 'Control';
