import { useEffect, useRef, useState } from 'react';
import { app } from '../../app';
import { openLink } from '../../commands/coreCommands';
import { useIndexRevision } from '../../state/hooks';
import { useWorkspace } from '../../state/store';
import { GraphControls } from './GraphControls';
import { GraphEngine, readColors, type GraphStats } from './GraphEngine';
import { loadSettings, saveSettings } from './settings';
import { applyFilters, type GraphSettings, type SimNode } from './simulation';
import './graph.css';

export interface GraphViewProps {
  /** When set, show only the neighborhood of this note (local graph). */
  localTo?: string;
}

const REFRESH_DEBOUNCE_MS = 200;

function openGraphNode(node: SimNode): void {
  const ws = useWorkspace.getState();
  if (node.kind === 'note') ws.openFile(node.id);
  else if (node.kind === 'unresolved') void openLink(node.label, ws.activeFile);
  else {
    ws.setSearchQuery(`tag:${node.label}`);
    ws.setLeftTab('search');
  }
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export function GraphView({ localTo }: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GraphEngine | null>(null);
  const loadedRef = useRef(false);
  const [settings, setSettings] = useState<GraphSettings>(loadSettings);
  const [stats, setStats] = useState<GraphStats>({ nodes: 0, links: 0 });
  const revision = useIndexRevision();
  const activeFile = useWorkspace((s) => s.activeFile);
  const local = localTo !== undefined;

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const engine = new GraphEngine(canvas, openGraphNode);
    engineRef.current = engine;
    const measure = () => {
      const r = container.getBoundingClientRect();
      engine.resize(r.width, r.height, window.devicePixelRatio || 1);
    };
    measure();
    const sizes = new ResizeObserver(measure);
    sizes.observe(container);
    // Colours come from CSS variables on body.theme-*, so re-read them when the theme class flips.
    const theme = new MutationObserver(() => engine.setColors(readColors(canvas)));
    theme.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => {
      sizes.disconnect();
      theme.disconnect();
      engine.destroy();
      engineRef.current = null;
      loadedRef.current = false;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setForces(settings);
  }, [settings.linkDistance, settings.repelForce, settings.centerForce]);

  useEffect(() => {
    engineRef.current?.setHighlight(localTo ?? activeFile);
  }, [localTo, activeFile]);

  useEffect(() => saveSettings(settings), [settings]);

  useEffect(() => {
    const refresh = () => {
      const engine = engineRef.current;
      const canvas = canvasRef.current;
      if (!engine || !canvas) return;
      const raw = app.index.getGraph({ includeUnresolved: settings.showUnresolved, includeTags: settings.showTags, localTo, depth: settings.depth });
      // The local graph has no filter/orphan controls, so those never hide its neighbourhood.
      const effective = local ? { ...settings, filter: '', showOrphans: true } : settings;
      engine.setColors(readColors(canvas));
      setStats(engine.setData(applyFilters(raw, effective, localTo), localTo ?? null));
    };
    if (!loadedRef.current) {
      loadedRef.current = true;
      refresh();
      return;
    }
    const timer = window.setTimeout(refresh, REFRESH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [revision, localTo, local, settings]);

  const update = (patch: Partial<GraphSettings>) => setSettings((s) => ({ ...s, ...patch }));

  return (
    <div ref={containerRef} className={`graph-view${local ? ' is-local' : ''}`} data-testid="graph-view">
      <canvas ref={canvasRef} className="graph-canvas" data-testid="graph-canvas" role="img" aria-label={local ? 'Local graph' : 'Graph view'} />
      {stats.nodes === 0 && <div className="graph-empty">No notes to show</div>}
      <GraphControls settings={settings} local={local} onChange={update} onReset={() => engineRef.current?.fit()} />
      <div className="graph-info" data-testid="graph-info">
        {plural(stats.nodes, 'node')} · {plural(stats.links, 'link')}
      </div>
    </div>
  );
}
