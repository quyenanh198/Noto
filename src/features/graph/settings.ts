import { DEFAULT_SETTINGS, normalizeSettings, type GraphSettings } from './simulation';

const STORAGE_KEY = 'noto-graph-settings';

export function loadSettings(): GraphSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeSettings(JSON.parse(raw)) : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: GraphSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage may be full or unavailable; the in-memory settings still apply.
  }
}
