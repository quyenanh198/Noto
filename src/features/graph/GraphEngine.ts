import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation } from 'd3-force';
import type { GraphData } from '../../core/types';
import { buildAdjacency, clamp, fitTransform, mergeGraph, nodeAt, nodeRadius, zoomAt, type GraphSettings, type SimLink, type SimNode, type Transform } from './simulation';

export interface GraphColors {
  node: string;
  unresolved: string;
  tag: string;
  line: string;
  text: string;
  accent: string;
  font: string;
}

export interface GraphStats {
  nodes: number;
  links: number;
}

/** Read the graph palette from the CSS variables in effect on `el`. */
export function readColors(el: Element): GraphColors {
  const style = getComputedStyle(el);
  const get = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    node: get('--graph-node', '#b3b3b3'),
    unresolved: get('--graph-node-unresolved', '#5e5e5e'),
    tag: get('--graph-node-tag', '#7f6df2'),
    line: get('--graph-line', '#4a4a4a'),
    text: get('--graph-text', '#dcddde'),
    accent: get('--interactive-accent', '#7f6df2'),
    font: get('--font-interface', 'sans-serif'),
  };
}

const FIT_PADDING = 40;
const DRAG_THRESHOLD = 3;
const LABEL_FONT_SIZE = 11;
const DIM_ALPHA = 0.25;
const HOVER_SCALE = 1.3;

interface DragState {
  node: SimNode | null;
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
}

interface ScreenNode {
  id: string;
  label: string;
  x: number;
  y: number;
}
type DebugWindow = Window & { __notoGraph?: { nodes: () => ScreenNode[] } };

/** Live engines in creation order; the tiny `window.__notoGraph` test hook reports the newest one. */
const liveEngines = new Set<GraphEngine>();
function installDebugHook(): void {
  (window as DebugWindow).__notoGraph ??= { nodes: () => [...liveEngines].at(-1)?.screenNodes() ?? [] };
}

/** Structure-only fingerprint so unchanged data does not reheat the layout. */
function graphSignature(data: GraphData): string {
  const ids = data.nodes.map((n) => n.id).sort();
  const edges = data.edges.map((e) => (e.source < e.target ? `${e.source}>${e.target}` : `${e.target}>${e.source}`)).sort();
  return `${ids.join('')}${edges.join('')}`;
}

/**
 * Owns the canvas, the d3-force simulation and all pointer interaction for one graph view.
 * React only feeds it data, settings and size; nothing here touches React state.
 */
export class GraphEngine {
  private readonly sim: Simulation<SimNode, SimLink>;
  private readonly linkForce = forceLink<SimNode, SimLink>();
  private readonly charge = forceManyBody<SimNode>();
  private readonly center = forceCenter<SimNode>(0, 0);
  private readonly gravityX = forceX<SimNode>(0);
  private readonly gravityY = forceY<SimNode>(0);
  private nodes: SimNode[] = [];
  private links: SimLink[] = [];
  private adjacency = new Map<string, Set<string>>();
  private transform: Transform = { x: 0, y: 0, k: 1 };
  private width = 0;
  private height = 0;
  private dpr = 1;
  private colors: GraphColors;
  private hovered: SimNode | null = null;
  private pointer: { x: number; y: number } | null = null;
  private drag: DragState | null = null;
  private raf = 0;
  /** Keep re-fitting on every tick until the user pans, zooms or drags. */
  private autoFit = true;
  private highlightId: string | null = null;
  private fixedId: string | null = null;
  private signature = '';
  private hasData = false;
  private destroyed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onOpen: (node: SimNode) => void,
  ) {
    this.colors = readColors(canvas);
    this.sim = forceSimulation<SimNode, SimLink>()
      .alphaDecay(0.03)
      .force('link', this.linkForce)
      .force('charge', this.charge)
      .force('center', this.center)
      .force('x', this.gravityX)
      .force('y', this.gravityY)
      .force('collide', forceCollide<SimNode>((n) => nodeRadius(n.degree) + 2))
      .on('tick', this.onTick)
      .stop();
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('dblclick', this.onDoubleClick);
    liveEngines.add(this);
    installDebugHook();
  }

  /** Current node positions in canvas CSS pixels (used by end-to-end tests). */
  screenNodes(): ScreenNode[] {
    const { k, x, y } = this.transform;
    return this.nodes.map((n) => ({ id: n.id, label: n.label, x: n.x * k + x, y: n.y * k + y }));
  }

  // ----- inputs from React -----

  setForces(s: GraphSettings): void {
    this.linkForce.distance(s.linkDistance);
    this.charge.strength(-s.repelForce);
    this.center.strength(s.centerForce);
    // A gentle pull towards the origin keeps disconnected pieces from drifting apart.
    this.gravityX.strength(s.centerForce * 0.5);
    this.gravityY.strength(s.centerForce * 0.5);
    if (this.hasData) this.sim.alpha(Math.max(this.sim.alpha(), 0.3)).restart();
  }

  setColors(colors: GraphColors): void {
    this.colors = colors;
    this.schedule();
  }

  setHighlight(id: string | null): void {
    if (id === this.highlightId) return;
    this.highlightId = id;
    this.schedule();
  }

  /** Replace the graph data. `fixedId` (the local graph's centre) is pinned at the origin. */
  setData(data: GraphData, fixedId: string | null): GraphStats {
    const signature = graphSignature(data);
    const fixedChanged = fixedId !== this.fixedId;
    this.fixedId = fixedId;
    if (signature === this.signature && !fixedChanged) {
      const byId = new Map(data.nodes.map((n) => [n.id, n]));
      for (const n of this.nodes) {
        const fresh = byId.get(n.id);
        if (fresh) Object.assign(n, { label: fresh.label, kind: fresh.kind, degree: fresh.degree });
      }
      this.schedule();
      return { nodes: this.nodes.length, links: this.links.length };
    }
    this.signature = signature;
    const hadNodes = this.nodes.length > 0;
    const { nodes, links } = mergeGraph(this.nodes, data);
    if (this.drag?.node) {
      const same = nodes.find((n) => n.id === this.drag?.node?.id);
      if (same) this.drag.node = same;
      else this.drag = null;
    }
    this.pinCentre(nodes, fixedChanged);
    this.nodes = nodes;
    this.links = links;
    this.adjacency = buildAdjacency(links);
    this.hovered = null;
    this.sim.nodes(nodes);
    this.linkForce.links(links);
    if (fixedChanged || !this.hasData) this.autoFit = true;
    this.hasData = true;
    this.sim.alpha(hadNodes ? 0.5 : 1).restart();
    this.canvas.dataset.nodeCount = String(nodes.length);
    if (this.autoFit) this.fitNow();
    this.schedule();
    return { nodes: nodes.length, links: links.length };
  }

  resize(width: number, height: number, dpr: number): void {
    if (width === this.width && height === this.height && dpr === this.dpr) return;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
    if (this.autoFit) this.fitNow();
    this.schedule();
  }

  /** Fit all nodes into view and keep following the layout until the user interacts again. */
  fit(): void {
    this.autoFit = true;
    this.fitNow();
    this.schedule();
  }

  destroy(): void {
    this.destroyed = true;
    this.sim.stop();
    this.sim.on('tick', null);
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    const canvas = this.canvas;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerUp);
    canvas.removeEventListener('pointerleave', this.onPointerLeave);
    canvas.removeEventListener('wheel', this.onWheel);
    canvas.removeEventListener('dblclick', this.onDoubleClick);
    liveEngines.delete(this);
  }

  // ----- layout -----

  /** Unpin everything except the centre node (and whatever is being dragged); move the centre to the origin. */
  private pinCentre(nodes: SimNode[], recentre: boolean): void {
    const dragId = this.drag?.node?.id;
    for (const n of nodes) {
      if (n.id !== this.fixedId && n.id !== dragId) {
        n.fx = null;
        n.fy = null;
      }
    }
    if (!this.fixedId) return;
    const centre = nodes.find((n) => n.id === this.fixedId);
    if (!centre) return;
    if (recentre || centre.fx == null) {
      const dx = -centre.x;
      const dy = -centre.y;
      for (const n of nodes) {
        n.x += dx;
        n.y += dy;
      }
      centre.fx = 0;
      centre.fy = 0;
    }
  }

  private fitNow(): void {
    this.transform = fitTransform(this.nodes, this.width, this.height, FIT_PADDING);
  }

  private onTick = (): void => {
    if (this.autoFit) this.fitNow();
    this.schedule();
  };

  private schedule(): void {
    if (this.raf || this.destroyed) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.draw();
    });
  }

  // ----- pointer interaction -----

  private localPoint(e: MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private toWorld(p: { x: number; y: number }): { x: number; y: number } {
    const { x, y, k } = this.transform;
    return { x: (p.x - x) / k, y: (p.y - y) / k };
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const p = this.localPoint(e);
    const node = nodeAt(this.nodes, p.x, p.y, this.transform);
    this.drag = { node, pointerId: e.pointerId, startX: p.x, startY: p.y, lastX: p.x, lastY: p.y, moved: false };
    this.canvas.setPointerCapture(e.pointerId);
    if (node) {
      node.fx = node.x;
      node.fy = node.y;
      this.sim.alphaTarget(0.3).restart();
    }
    e.preventDefault();
  };

  private onPointerMove = (e: PointerEvent): void => {
    const p = this.localPoint(e);
    this.pointer = p;
    const d = this.drag;
    if (d && d.pointerId === e.pointerId) {
      const dx = p.x - d.lastX;
      const dy = p.y - d.lastY;
      d.lastX = p.x;
      d.lastY = p.y;
      if (!d.moved && Math.hypot(p.x - d.startX, p.y - d.startY) > DRAG_THRESHOLD) d.moved = true;
      if (d.moved) {
        this.autoFit = false;
        if (d.node) {
          const w = this.toWorld(p);
          d.node.fx = w.x;
          d.node.fy = w.y;
        } else {
          this.transform = { ...this.transform, x: this.transform.x + dx, y: this.transform.y + dy };
        }
      }
    }
    this.schedule();
  };

  private onPointerUp = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d || d.pointerId !== e.pointerId) return;
    this.drag = null;
    if (d.node) {
      this.sim.alphaTarget(0);
      if (d.node.id !== this.fixedId) {
        d.node.fx = null;
        d.node.fy = null;
      }
      if (!d.moved && e.type === 'pointerup') this.onOpen(d.node);
    }
    this.schedule();
  };

  private onPointerLeave = (): void => {
    this.pointer = null;
    if (!this.drag) {
      this.hovered = null;
      this.schedule();
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const p = this.localPoint(e);
    const lines = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * this.height : e.deltaY;
    const factor = Math.exp(-clamp(lines, -200, 200) * 0.0015);
    this.transform = zoomAt(this.transform, p.x, p.y, factor);
    this.autoFit = false;
    this.schedule();
  };

  private onDoubleClick = (e: MouseEvent): void => {
    e.preventDefault();
    const p = this.localPoint(e);
    if (nodeAt(this.nodes, p.x, p.y, this.transform)) return;
    this.fit();
  };

  // ----- drawing -----

  private draw(): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx || this.width === 0 || this.height === 0) return;
    if (this.pointer && !this.drag) this.hovered = nodeAt(this.nodes, this.pointer.x, this.pointer.y, this.transform);
    this.canvas.style.cursor = this.drag ? (this.drag.moved || this.drag.node ? 'grabbing' : '') : this.hovered ? 'pointer' : '';

    const { k, x: tx, y: ty } = this.transform;
    const c = this.colors;
    const hovered = this.hovered;
    const neighbours = hovered ? this.adjacency.get(hovered.id) : undefined;
    const related = (n: SimNode) => hovered !== null && (n === hovered || (neighbours?.has(n.id) ?? false));

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    ctx.lineWidth = clamp(k, 0.6, 1.5);
    for (const l of this.links) {
      const lit = !hovered || l.source === hovered || l.target === hovered;
      ctx.globalAlpha = lit ? 1 : DIM_ALPHA;
      ctx.strokeStyle = lit && hovered ? c.accent : c.line;
      ctx.beginPath();
      ctx.moveTo(l.source.x * k + tx, l.source.y * k + ty);
      ctx.lineTo(l.target.x * k + tx, l.target.y * k + ty);
      ctx.stroke();
    }

    for (const n of this.nodes) {
      const lit = related(n);
      const r = nodeRadius(n.degree) * k * (lit ? HOVER_SCALE : 1);
      ctx.globalAlpha = hovered && !lit ? DIM_ALPHA : 1;
      ctx.fillStyle = lit || n.id === this.highlightId ? c.accent : n.kind === 'tag' ? c.tag : n.kind === 'unresolved' ? c.unresolved : c.node;
      ctx.beginPath();
      ctx.arc(n.x * k + tx, n.y * k + ty, r, 0, Math.PI * 2);
      ctx.fill();
    }

    const scaleAlpha = clamp((k - 0.8) / 0.3, 0, 1);
    ctx.font = `${LABEL_FONT_SIZE}px ${c.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = c.text;
    for (const n of this.nodes) {
      const lit = related(n);
      const alpha = lit ? 1 : scaleAlpha * (hovered ? DIM_ALPHA : 1);
      if (alpha < 0.02) continue;
      ctx.globalAlpha = alpha;
      const r = nodeRadius(n.degree) * k * (lit ? HOVER_SCALE : 1);
      ctx.fillText(n.label, n.x * k + tx, n.y * k + ty + r + 3);
    }
    ctx.globalAlpha = 1;
  }
}
