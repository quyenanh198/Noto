import { describe, expect, it } from 'vitest';
import type { GraphData } from '../../core/types';
import {
  DEFAULT_SETTINGS,
  MAX_FIT_SCALE,
  MAX_RADIUS,
  MAX_SCALE,
  MIN_SCALE,
  applyFilters,
  buildAdjacency,
  fitTransform,
  mergeGraph,
  nodeAt,
  nodeRadius,
  normalizeSettings,
  zoomAt,
  type SimNode,
} from './simulation';

const data: GraphData = {
  nodes: [
    { id: 'A.md', label: 'A', kind: 'note', degree: 2 },
    { id: 'B.md', label: 'B', kind: 'note', degree: 2 },
    { id: 'C.md', label: 'C', kind: 'note', degree: 2 },
  ],
  edges: [
    { source: 'A.md', target: 'B.md' },
    { source: 'B.md', target: 'A.md' },
    { source: 'B.md', target: 'C.md' },
  ],
};

function sim(id: string, x: number, y: number, degree = 1): SimNode {
  return { id, label: id, kind: 'note', degree, x, y, vx: 0, vy: 0 };
}

describe('mergeGraph', () => {
  it('places new nodes deterministically and dedupes undirected links', () => {
    const a = mergeGraph([], data);
    const b = mergeGraph([], data);
    expect(a.nodes.map((n) => n.id)).toEqual(['A.md', 'B.md', 'C.md']);
    expect(a.nodes.map((n) => [n.x, n.y])).toEqual(b.nodes.map((n) => [n.x, n.y]));
    expect(a.links).toHaveLength(2);
    expect(a.links[0].source.id).toBe('A.md');
    expect(a.links[0].target.id).toBe('B.md');
    for (const n of a.nodes) expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
  });

  it('preserves positions and velocities of existing nodes', () => {
    const prev = [{ ...sim('A.md', 100, 50), vx: 3, vy: -2 }, sim('B.md', -40, 10)];
    const { nodes } = mergeGraph(prev, data);
    const a = nodes.find((n) => n.id === 'A.md')!;
    expect([a.x, a.y, a.vx, a.vy]).toEqual([100, 50, 3, -2]);
    expect(a.degree).toBe(2);
    const b = nodes.find((n) => n.id === 'B.md')!;
    expect([b.x, b.y]).toEqual([-40, 10]);
  });

  it('starts new nodes near the centroid of their placed neighbours', () => {
    const prev = [sim('A.md', 200, 200), sim('B.md', 400, 200)];
    const extra: GraphData = {
      nodes: [...data.nodes, { id: 'D.md', label: 'D', kind: 'note', degree: 2 }],
      edges: [...data.edges, { source: 'D.md', target: 'A.md' }, { source: 'D.md', target: 'B.md' }],
    };
    const { nodes } = mergeGraph(prev, extra);
    const d = nodes.find((n) => n.id === 'D.md')!;
    expect(Math.hypot(d.x - 300, d.y - 200)).toBeLessThan(45);
    expect(Math.hypot(d.x - 300, d.y - 200)).toBeGreaterThan(10);
    const c = nodes.find((n) => n.id === 'C.md')!;
    expect(Math.hypot(c.x - 400, c.y - 200)).toBeLessThan(45);
  });

  it('drops removed nodes and their links', () => {
    const prev = mergeGraph([], data).nodes;
    const smaller: GraphData = { nodes: data.nodes.slice(0, 2), edges: data.edges };
    const { nodes, links } = mergeGraph(prev, smaller);
    expect(nodes.map((n) => n.id)).toEqual(['A.md', 'B.md']);
    expect(links).toHaveLength(1);
    expect(links.every((l) => l.source.id !== 'C.md' && l.target.id !== 'C.md')).toBe(true);
  });

  it('keeps fixed positions of existing nodes', () => {
    const prev = [{ ...sim('A.md', 0, 0), fx: 0, fy: 0 }];
    const { nodes } = mergeGraph(prev, data);
    expect(nodes[0].fx).toBe(0);
    expect(nodes[1].fx).toBeUndefined();
  });
});

describe('nodeRadius', () => {
  it('grows with degree and is bounded', () => {
    expect(nodeRadius(0)).toBe(4);
    expect(nodeRadius(-5)).toBe(4);
    expect(nodeRadius(4)).toBe(7);
    expect(nodeRadius(1)).toBeGreaterThan(nodeRadius(0));
    expect(nodeRadius(10_000)).toBe(MAX_RADIUS);
  });
});

describe('fitTransform', () => {
  it('maps every node into the viewport with padding', () => {
    const nodes = [sim('a', -100, -50, 0), sim('b', 300, 10, 0), sim('c', 40, 250, 0)];
    const t = fitTransform(nodes, 500, 400, 40);
    for (const n of nodes) {
      const sx = n.x * t.k + t.x;
      const sy = n.y * t.k + t.y;
      expect(sx).toBeGreaterThanOrEqual(40);
      expect(sx).toBeLessThanOrEqual(460);
      expect(sy).toBeGreaterThanOrEqual(40);
      expect(sy).toBeLessThanOrEqual(360);
    }
    // The wide dimension is the limiting one: bbox is 408 wide (400 + two radii of 4), 308 tall.
    expect(t.k).toBeCloseTo(420 / 408, 5);
    // Centre of the bounding box (100, 100) lands on the centre of the viewport.
    expect(100 * t.k + t.x).toBeCloseTo(250, 5);
    expect(100 * t.k + t.y).toBeCloseTo(200, 5);
  });

  it('clamps the scale and handles degenerate input', () => {
    expect(fitTransform([sim('a', 5, 5)], 800, 600, 40).k).toBe(MAX_FIT_SCALE);
    expect(fitTransform([sim('a', 0, 0), sim('b', 100_000, 0)], 800, 600, 40).k).toBe(MIN_SCALE);
    expect(fitTransform([], 800, 600, 40)).toEqual({ x: 400, y: 300, k: 1 });
  });
});

describe('zoomAt', () => {
  it('keeps the point under the cursor fixed and clamps the scale', () => {
    const t = { x: 100, y: 50, k: 1 };
    const z = zoomAt(t, 300, 200, 2);
    // World point under (300, 200) before: (200, 150). After zoom it must still be at (300, 200).
    expect(200 * z.k + z.x).toBeCloseTo(300);
    expect(150 * z.k + z.y).toBeCloseTo(200);
    expect(zoomAt(t, 0, 0, 100).k).toBe(MAX_SCALE);
    expect(zoomAt(t, 0, 0, 0.0001).k).toBe(MIN_SCALE);
  });
});

describe('nodeAt', () => {
  const nodes = [sim('a', 0, 0, 0), sim('b', 100, 0, 16)];
  it('hit-tests in screen space through the transform', () => {
    const t = { x: 50, y: 50, k: 2 };
    expect(nodeAt(nodes, 50, 50, t)?.id).toBe('a');
    expect(nodeAt(nodes, 250, 50, t)?.id).toBe('b');
    // b has radius 10 and is drawn at (250, 50) with scale 2: 20px radius plus a 3px slack.
    expect(nodeAt(nodes, 272, 50, t)?.id).toBe('b');
    expect(nodeAt(nodes, 275, 50, t)).toBeNull();
    expect(nodeAt(nodes, 150, 50, t)).toBeNull();
  });
  it('keeps a minimum hit radius when zoomed far out', () => {
    const t = { x: 0, y: 0, k: 0.2 };
    expect(nodeAt(nodes, 5, 0, t)?.id).toBe('a');
    expect(nodeAt(nodes, 8, 0, t)).toBeNull();
  });
  it('prefers the closest node when hit areas overlap', () => {
    const close = [sim('a', 0, 0, 16), sim('b', 6, 0, 16)];
    expect(nodeAt(close, 4, 0, { x: 0, y: 0, k: 1 })?.id).toBe('b');
  });
});

describe('applyFilters', () => {
  const full: GraphData = {
    nodes: [
      { id: 'A.md', label: 'Alpha', kind: 'note', degree: 3 },
      { id: 'B.md', label: 'Beta', kind: 'note', degree: 1 },
      { id: 'Lonely.md', label: 'Lonely', kind: 'note', degree: 0 },
      { id: 'unresolved:ghost', label: 'Ghost', kind: 'unresolved', degree: 1 },
      { id: 'tag:x', label: '#x', kind: 'tag', degree: 1 },
    ],
    edges: [
      { source: 'A.md', target: 'B.md' },
      { source: 'A.md', target: 'unresolved:ghost' },
      { source: 'A.md', target: 'tag:x' },
    ],
  };

  it('hides tags by default and unresolved links when asked', () => {
    const d = applyFilters(full, DEFAULT_SETTINGS);
    expect(d.nodes.map((n) => n.id)).toEqual(['A.md', 'B.md', 'Lonely.md', 'unresolved:ghost']);
    expect(d.edges).toHaveLength(2);
    const noGhost = applyFilters(full, { ...DEFAULT_SETTINGS, showUnresolved: false });
    expect(noGhost.nodes.some((n) => n.kind === 'unresolved')).toBe(false);
    expect(noGhost.edges).toHaveLength(1);
    const withTags = applyFilters(full, { ...DEFAULT_SETTINGS, showTags: true });
    expect(withTags.nodes.some((n) => n.kind === 'tag')).toBe(true);
    expect(withTags.edges).toHaveLength(3);
  });

  it('recomputes degrees and drops orphans, including nodes orphaned by other filters', () => {
    const d = applyFilters(full, { ...DEFAULT_SETTINGS, showOrphans: false });
    expect(d.nodes.map((n) => n.id)).toEqual(['A.md', 'B.md', 'unresolved:ghost']);
    expect(d.nodes.find((n) => n.id === 'A.md')?.degree).toBe(2);
    const d2 = applyFilters(full, { ...DEFAULT_SETTINGS, showOrphans: false, filter: 'ghost' });
    expect(d2.nodes).toEqual([]);
  });

  it('filters labels case-insensitively and hides edges of hidden nodes', () => {
    const d = applyFilters(full, { ...DEFAULT_SETTINGS, filter: 'ALPH' });
    expect(d.nodes.map((n) => n.id)).toEqual(['A.md']);
    expect(d.edges).toEqual([]);
    const d2 = applyFilters(full, { ...DEFAULT_SETTINGS, filter: 'a' });
    expect(d2.nodes.map((n) => n.id)).toEqual(['A.md', 'B.md']);
    expect(d2.edges).toHaveLength(1);
  });

  it('never removes the kept centre node', () => {
    const d = applyFilters(full, { ...DEFAULT_SETTINGS, showOrphans: false, filter: 'zzz' }, 'Lonely.md');
    expect(d.nodes.map((n) => n.id)).toEqual(['Lonely.md']);
  });
});

describe('buildAdjacency', () => {
  it('is undirected', () => {
    const { links } = mergeGraph([], data);
    const adj = buildAdjacency(links);
    expect([...adj.get('B.md')!].sort()).toEqual(['A.md', 'C.md']);
    expect(adj.get('C.md')?.has('B.md')).toBe(true);
    expect(adj.get('A.md')?.has('C.md')).toBe(false);
  });
});

describe('normalizeSettings', () => {
  it('fills defaults, clamps ranges and ignores bad types', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('nope')).toEqual(DEFAULT_SETTINGS);
    const s = normalizeSettings({ linkDistance: 9999, repelForce: -5, centerForce: 'x', depth: 2.6, showTags: 'yes', filter: 'q' });
    expect(s.linkDistance).toBe(200);
    expect(s.repelForce).toBe(10);
    expect(s.centerForce).toBe(DEFAULT_SETTINGS.centerForce);
    expect(s.depth).toBe(3);
    expect(s.showTags).toBe(false);
    expect(s.filter).toBe('q');
  });
});
