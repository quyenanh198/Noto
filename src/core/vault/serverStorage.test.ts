import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServerAdapter, isServerVaultAvailable } from './serverStorage';

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const spy = vi.fn((input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(handler(String(input), init)));
  vi.stubGlobal('fetch', spy);
  return spy;
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ServerAdapter', () => {
  it('loads the snapshot the server returns', async () => {
    mockFetch(() => ok({ files: [{ path: 'a.md', content: '# a', mtime: 5 }], folders: ['sub'] }));
    const snapshot = await new ServerAdapter().load();
    expect(snapshot.files).toEqual([{ path: 'a.md', content: '# a', mtime: 5 }]);
    expect(snapshot.folders).toEqual(['sub']);
  });

  it('tolerates a snapshot without folders', async () => {
    mockFetch(() => ok({ files: [] }));
    await expect(new ServerAdapter().load()).resolves.toEqual({ files: [], folders: [] });
  });

  it('creates files with create:true and writes without it', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    mockFetch((url, init) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      return ok({ ok: true });
    });
    const adapter = new ServerAdapter();
    await adapter.createFile('note.md', 'hi');
    await adapter.writeFile('note.md', 'bye');
    expect(calls[0]).toEqual({ url: '/api/vault/file', body: { path: 'note.md', content: 'hi', create: true } });
    expect(calls[1]).toEqual({ url: '/api/vault/file', body: { path: 'note.md', content: 'bye' } });
  });

  it('reports an existing file the way the other adapters do', async () => {
    mockFetch(() => new Response(JSON.stringify({ error: 'exists' }), { status: 409, headers: { 'content-type': 'application/json' } }));
    await expect(new ServerAdapter().createFile('note.md', 'hi')).rejects.toThrow(/already exists/i);
  });

  it('surfaces other server errors', async () => {
    mockFetch(() => new Response('boom', { status: 500 }));
    await expect(new ServerAdapter().writeFile('note.md', 'hi')).rejects.toThrow(/HTTP 500/);
  });

  it('encodes paths when deleting', async () => {
    const urls: string[] = [];
    mockFetch((url) => {
      urls.push(url);
      return ok({ ok: true });
    });
    const adapter = new ServerAdapter();
    await adapter.deleteFile('folder/ghi chú.md');
    await adapter.deleteFolder('folder/ghi chú');
    expect(urls[0]).toBe('/api/vault/file?path=folder%2Fghi%20ch%C3%BA.md');
    expect(urls[1]).toBe('/api/vault/folder?path=folder%2Fghi%20ch%C3%BA');
  });

  it('renames files and folders through their own routes', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    mockFetch((url, init) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      return ok({ ok: true });
    });
    const adapter = new ServerAdapter();
    await adapter.renameFile('a.md', 'b.md');
    await adapter.renameFolder('x', 'y');
    expect(calls).toEqual([
      { url: '/api/vault/file/rename', body: { oldPath: 'a.md', newPath: 'b.md' } },
      { url: '/api/vault/folder/rename', body: { oldPath: 'x', newPath: 'y' } },
    ]);
  });
});

describe('isServerVaultAvailable', () => {
  it('is true when the ping answers', async () => {
    mockFetch(() => ok({ ok: true }));
    await expect(isServerVaultAvailable()).resolves.toBe(true);
  });

  it('is false without a server behind the page', async () => {
    mockFetch(() => new Response('not found', { status: 404 }));
    await expect(isServerVaultAvailable()).resolves.toBe(false);
  });

  it('is false when the request itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    await expect(isServerVaultAvailable()).resolves.toBe(false);
  });
});
