import type { StorageAdapter, VaultSnapshot } from '../types';

/*
 * Kho ghi chú nằm trên máy chủ (Mac mini): file markdown thật trong một thư mục
 * do server giữ, truy cập qua /api/vault. Khác với IndexedDB (kẹt trong một
 * trình duyệt) và File System Access (chỉ có trên Chrome/Edge máy tính), kho này
 * mở được từ mọi thiết bị và được sao lưu cùng dữ liệu của các app khác.
 */

const API = '/api/vault';

async function call(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(path, { credentials: 'same-origin', ...init });
  if (res.ok) return res;
  let code = `HTTP ${res.status}`;
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body?.error === 'string') code = body.error;
  } catch {
    /* phản hồi không phải JSON: giữ mã trạng thái */
  }
  if (code === 'exists') throw new Error('File already exists');
  throw new Error(`Server vault request failed (${code})`);
}

const post = async (path: string, body: unknown): Promise<void> => {
  await call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
};

const remove = async (path: string, target: string): Promise<void> => {
  await call(`${path}?path=${encodeURIComponent(target)}`, { method: 'DELETE' });
};

export class ServerAdapter implements StorageAdapter {
  readonly kind = 'server' as const;

  async load(): Promise<VaultSnapshot> {
    const res = await call(API);
    const data = (await res.json()) as VaultSnapshot;
    return { files: data.files ?? [], folders: data.folders ?? [] };
  }
  async createFile(path: string, content: string): Promise<void> {
    await post(`${API}/file`, { path, content, create: true });
  }
  async writeFile(path: string, content: string): Promise<void> {
    await post(`${API}/file`, { path, content });
  }
  async deleteFile(path: string): Promise<void> {
    await remove(`${API}/file`, path);
  }
  async renameFile(oldPath: string, newPath: string): Promise<void> {
    await post(`${API}/file/rename`, { oldPath, newPath });
  }
  async createFolder(path: string): Promise<void> {
    await post(`${API}/folder`, { path });
  }
  async deleteFolder(path: string): Promise<void> {
    await remove(`${API}/folder`, path);
  }
  async renameFolder(oldPath: string, newPath: string): Promise<void> {
    await post(`${API}/folder/rename`, { oldPath, newPath });
  }
}

/** Có server kho ghi chú phía sau trang này không (bản GitHub Pages thì không). */
export async function isServerVaultAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${API}/ping`, { credentials: 'same-origin' });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: unknown };
    return body?.ok === true;
  } catch {
    return false;
  }
}
