import type { GraphData, GraphNode } from '../../core/types';

/** A graph node with the mutable layout state d3-force works on. */
export interface SimNode extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx?: number | null;
  fy?: number | null;
  index?: number;
}

export interface SimLink {
  source: SimNode;
  target: SimNode;
}

/** Screen = world * k + (x, y), in CSS pixels. */
export interface Transform {
  x: number;
  y: number;
  k: number;
}

export interface GraphSettings {
  /** Case-insensitive substring filter on node labels. */
  filter: string;
  showOrphans: boolean;
  showTags: boolean;
  showUnresolved: boolean;
  linkDistance: number;
  /** Applied as a negative many-body strength. */
  repelForce: number;
  centerForce: number;
  /** Neighbourhood depth for the local graph. */
  depth: number;
}

export const DEFAULT_SETTINGS: GraphSettings = {
  filter: '',
  showOrphans: true,
  showTags: false,
  showUnresolved: true,
  linkDistance: 80,
  repelForce: 150,
  centerForce: 0.1,
  depth: 1,
};

export const SETTINGS_RANGES = {
  linkDistance: { min: 30, max: 200 },
  repelForce: { min: 10, max: 500 },
  centerForce: { min: 0, max: 1 },
  depth: { min: 1, max: 3 },
} as const;

export const MIN_SCALE = 0.2;
export const MAX_SCALE = 4;
/** Fitting never zooms in past this, so a tiny vault does not become a handful of giant blobs. */
export const MAX_FIT_SCALE = 1.5;
export const MAX_RADIUS = 16;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Coerce anything (e.g. parsed localStorage JSON) into valid settings. */
export function normalizeSettings(input: unknown): GraphSettings {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const bool = (key: 'showOrphans' | 'showTags' | 'showUnresolved') => (typeof raw[key] === 'boolean' ? (raw[key] as boolean) : DEFAULT_SETTINGS[key]);
  const num = (key: keyof typeof SETTINGS_RANGES) => {
    const v = raw[key];
    const { min, max } = SETTINGS_RANGES[key];
    return typeof v === 'number' && Number.isFinite(v) ? clamp(v, min, max) : DEFAULT_SETTINGS[key];
  };
  return {
    filter: typeof raw.filter === 'string' ? raw.filter : DEFAULT_SETTINGS.filter,
    showOrphans: bool('showOrphans'),
    showTags: bool('showTags'),
    showUnresolved: bool('showUnresolved'),
    linkDistance: num('linkDistance'),
    repelForce: num('repelForce'),
    centerForce: num('centerForce'),
    depth: Math.round(num('depth')),
  };
}

export function nodeRadius(degree: number): number {
  return Math.min(4 + 1.5 * Math.sqrt(Math.max(0, degree)), MAX_RADIUS);
}

/**
 * Apply the control-panel settings to raw graph data: drop tag/unresolved nodes when hidden,
 * apply the label filter, recompute degrees over the remaining edges, then drop orphans if hidden.
 * `keep` (the local graph's centre) is never removed.
 */
export function applyFilters(data: GraphData, settings: GraphSettings, keep?: string): GraphData {
  const needle = settings.filter.trim().toLowerCase();
  const visible = (n: GraphNode): boolean => {
    if (n.id === keep) return true;
    if (n.kind === 'tag' && !settings.showTags) return false;
    if (n.kind === 'unresolved' && !settings.showUnresolved) return false;
    return needle === '' || n.label.toLowerCase().includes(needle);
  };
  const kept = new Set(data.nodes.filter(visible).map((n) => n.id));
  const edges = data.edges.filter((e) => kept.has(e.source) && kept.has(e.target));
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  const nodes = data.nodes
    .filter((n) => kept.has(n.id))
    .map((n) => ({ ...n, degree: degree.get(n.id) ?? 0 }))
    .filter((n) => settings.showOrphans || n.degree > 0 || n.id === keep);
  return { nodes, edges };
}

/** Small deterministic hash so new nodes get a stable, spread-out starting offset. */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Merge fresh graph data into the previous layout. Nodes that already exist keep their position and
 * velocity; new nodes start near the centroid of their already-placed neighbours (or near the origin)
 * with a small deterministic offset. Links are undirected and deduplicated; links to removed nodes vanish.
 */
export function mergeGraph(prev: SimNode[], data: GraphData): { nodes: SimNode[]; links: SimLink[] } {
  const old = new Map(prev.map((n) => [n.id, n]));
  const placed = new Map<string, SimNode>();
  const adjacency = new Map<string, string[]>();
  for (const e of data.edges) {
    adjacency.set(e.source, [...(adjacency.get(e.source) ?? []), e.target]);
    adjacency.set(e.target, [...(adjacency.get(e.target) ?? []), e.source]);
  }
  for (const n of data.nodes) {
    const o = old.get(n.id);
    if (o) placed.set(n.id, { ...n, x: o.x, y: o.y, vx: o.vx, vy: o.vy, fx: o.fx, fy: o.fy });
  }
  for (const n of data.nodes) {
    if (placed.has(n.id)) continue;
    const anchors = (adjacency.get(n.id) ?? []).map((id) => placed.get(id)).filter((a): a is SimNode => a !== undefined);
    let cx = 0;
    let cy = 0;
    for (const a of anchors) {
      cx += a.x / anchors.length;
      cy += a.y / anchors.length;
    }
    const h = hashString(n.id);
    const angle = ((h % 360) * Math.PI) / 180;
    const r = 20 + ((h >>> 9) % 20);
    placed.set(n.id, { ...n, x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r, vx: 0, vy: 0 });
  }
  const nodes = data.nodes.map((n) => placed.get(n.id) as SimNode);
  const links: SimLink[] = [];
  const seen = new Set<string>();
  for (const e of data.edges) {
    const source = placed.get(e.source);
    const target = placed.get(e.target);
    if (!source || !target || source === target) continue;
    const key = e.source < e.target ? `${e.source}\n${e.target}` : `${e.target}\n${e.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ source, target });
  }
  return { nodes, links };
}

/** Undirected neighbour sets, used for hover highlighting. */
export function buildAdjacency(links: SimLink[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    let set = out.get(a);
    if (!set) out.set(a, (set = new Set()));
    set.add(b);
  };
  for (const l of links) {
    add(l.source.id, l.target.id);
    add(l.target.id, l.source.id);
  }
  return out;
}

/** Transform that fits every node (including its radius) into `width` x `height` with `padding` on all sides. */
export function fitTransform(nodes: SimNode[], width: number, height: number, padding: number): Transform {
  if (nodes.length === 0 || width <= 0 || height <= 0) return { x: width / 2, y: height / 2, k: 1 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    const r = nodeRadius(n.degree);
    minX = Math.min(minX, n.x - r);
    maxX = Math.max(maxX, n.x + r);
    minY = Math.min(minY, n.y - r);
    maxY = Math.max(maxY, n.y + r);
  }
  const w = Math.max(maxX - minX, 1);
  const h = Math.max(maxY - minY, 1);
  const k = clamp(Math.min((width - 2 * padding) / w, (height - 2 * padding) / h), MIN_SCALE, MAX_FIT_SCALE);
  return { k, x: width / 2 - (k * (minX + maxX)) / 2, y: height / 2 - (k * (minY + maxY)) / 2 };
}

/** Zoom by `factor` keeping the world point under screen position (sx, sy) fixed. */
export function zoomAt(t: Transform, sx: number, sy: number, factor: number): Transform {
  const k = clamp(t.k * factor, MIN_SCALE, MAX_SCALE);
  const ratio = k / t.k;
  return { k, x: sx - (sx - t.x) * ratio, y: sy - (sy - t.y) * ratio };
}

/** The node under screen position (x, y), preferring the closest centre when several overlap. */
export function nodeAt(nodes: SimNode[], x: number, y: number, t: Transform): SimNode | null {
  let best: SimNode | null = null;
  let bestDist = Infinity;
  for (const n of nodes) {
    const sx = n.x * t.k + t.x;
    const sy = n.y * t.k + t.y;
    const hit = Math.max(nodeRadius(n.degree) * t.k + 3, 6);
    const d = (sx - x) ** 2 + (sy - y) ** 2;
    if (d <= hit * hit && d < bestDist) {
      best = n;
      bestDist = d;
    }
  }
  return best;
}
