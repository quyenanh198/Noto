export interface ReadingViewProps {
  path: string;
}

export function ReadingView({ path }: ReadingViewProps) {
  return <div className="pane-placeholder">ReadingView for {path} (not implemented yet)</div>;
}
