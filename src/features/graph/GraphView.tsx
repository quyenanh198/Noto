export interface GraphViewProps {
  /** When set, show only the neighborhood of this note (local graph). */
  localTo?: string;
}

export function GraphView({ localTo }: GraphViewProps) {
  return <div className="pane-placeholder">GraphView {localTo ? `(local: ${localTo})` : '(global)'} (not implemented yet)</div>;
}
