export interface MarkdownEditorProps {
  path: string;
}

export function MarkdownEditor({ path }: MarkdownEditorProps) {
  return <div className="pane-placeholder">MarkdownEditor for {path} (not implemented yet)</div>;
}
