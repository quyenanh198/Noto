import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryAdapter } from '../../core/vault/storage';
import { Vault } from '../../core/vault/Vault';
import { clearDraft, readDraft, replayDraft, vaultDraftId, writeDraft } from './draftJournal';

async function vaultWith(content: string, mtime: number): Promise<Vault> {
  const vault = new Vault(new MemoryAdapter({ folders: [], files: [{ path: 'A.md', content, mtime }] }));
  await vault.load();
  return vault;
}

describe('draft journal', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ now: 5000 });
  });
  afterEach(() => vi.useRealTimers());

  it('round-trips a draft and clears it only when the content matches', () => {
    writeDraft({ vault: 'memory:test', path: 'A.md', content: 'hello' });
    expect(readDraft()).toEqual({ vault: 'memory:test', path: 'A.md', content: 'hello', time: 5000 });
    clearDraft('other');
    expect(readDraft()).not.toBeNull();
    clearDraft('hello');
    expect(readDraft()).toBeNull();
  });

  it('replays a draft newer than the stored file into the vault it came from, then forgets it', async () => {
    const vault = await vaultWith('old', 1000);
    writeDraft({ vault: vaultDraftId(vault.adapter), path: 'A.md', content: 'old plus typed' });
    expect(await replayDraft(vault)).toBe(true);
    expect(vault.getFile('A.md')?.content).toBe('old plus typed');
    expect(readDraft()).toBeNull();
  });

  it('forgets a draft that is already stored or whose file is gone', async () => {
    const vault = await vaultWith('same', 1000);
    writeDraft({ vault: vaultDraftId(vault.adapter), path: 'A.md', content: 'same' });
    expect(await replayDraft(vault)).toBe(false);
    expect(readDraft()).toBeNull();
    writeDraft({ vault: vaultDraftId(vault.adapter), path: 'Missing.md', content: 'x' });
    expect(await replayDraft(vault)).toBe(false);
    expect(readDraft()).toBeNull();
  });

  it('does not overwrite a file modified after the draft, and keeps drafts of other vaults', async () => {
    const vault = await vaultWith('old', 1000);
    writeDraft({ vault: vaultDraftId(vault.adapter), path: 'A.md', content: 'stale draft' });
    vi.setSystemTime(6000);
    await vault.modify('A.md', 'newer');
    expect(await replayDraft(vault)).toBe(false);
    expect(vault.getFile('A.md')?.content).toBe('newer');
    expect(readDraft()).toBeNull();

    writeDraft({ vault: 'fsa:Elsewhere', path: 'A.md', content: 'theirs' });
    expect(await replayDraft(vault)).toBe(false);
    expect(vault.getFile('A.md')?.content).toBe('newer');
    expect(readDraft()?.vault).toBe('fsa:Elsewhere');
  });

  it('survives a broken or unavailable localStorage', () => {
    localStorage.setItem('noto:draft', '{not json');
    expect(readDraft()).toBeNull();
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => writeDraft({ vault: 'v', path: 'A.md', content: 'x' })).not.toThrow();
    setItem.mockRestore();
  });
});
