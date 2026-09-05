import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { app } from '../../app';
import { Icons } from '../../components/icons';
import { buildSnippet, formatSummary, runSearch, type SearchMatch, type SearchOutput, type SearchResult } from '../../core/search/search';
import { dirname } from '../../core/vault/path';
import { useIndexRevision, useVaultRevision } from '../../state/hooks';
import { useWorkspace } from '../../state/store';
import './search.css';

const DEBOUNCE_MS = 150;

interface Output extends SearchOutput {
  /** The query these results were computed for ('' before any search has run). */
  forQuery: string;
}

const EMPTY: Output = { results: [], totalFiles: 0, totalResults: 0, forQuery: '' };

/** One keyboard-selectable row: a match line, or the file itself when it has no visible match rows. */
interface Entry {
  path: string;
  line?: number;
}

function isModClick(e: MouseEvent | KeyboardEvent): boolean {
  return e.ctrlKey || e.metaKey;
}

function open(entry: Entry, newTab: boolean): void {
  useWorkspace.getState().openFile(entry.path, { line: entry.line, newTab });
}

export function SearchPane() {
  const query = useWorkspace((s) => s.searchQuery);
  const setSearchQuery = useWorkspace((s) => s.setSearchQuery);
  const vaultRev = useVaultRevision();
  const indexRev = useIndexRevision();
  const [matchCase, setMatchCase] = useState(false);
  const [collapseAll, setCollapseAll] = useState(false);
  const [explain, setExplain] = useState(false);
  /** Per-file collapse overrides on top of `collapseAll`. */
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [output, setOutput] = useState<Output>(EMPTY);
  const [selected, setSelected] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Other panes push queries into the store (e.g. "search for tag"); land the user in the box.
  useEffect(() => {
    if (query) inputRef.current?.focus();
  }, [query]);

  useEffect(() => {
    if (!query.trim()) {
      setOutput(EMPTY);
      return;
    }
    const timer = setTimeout(() => {
      setOutput({ ...runSearch(app.vault.getMarkdownFiles(), app.index, query, { matchCase }), forQuery: query });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, matchCase, vaultRev, indexRev]);

  useEffect(() => {
    setSelected(-1);
  }, [output]);

  useEffect(() => {
    if (selected >= 0) listRef.current?.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const isCollapsed = (path: string) => overrides[path] ?? collapseAll;

  const entries = useMemo(() => {
    const out: Entry[] = [];
    for (const r of output.results) {
      if (r.matches.length === 0 || (overrides[r.path] ?? collapseAll)) out.push({ path: r.path });
      else for (const m of r.matches) out.push({ path: r.path, line: m.line });
    }
    return out;
  }, [output, overrides, collapseAll]);

  const clear = () => {
    setSearchQuery('');
    inputRef.current?.focus();
  };

  const toggleGroup = (path: string) => setOverrides((o) => ({ ...o, [path]: !(o[path] ?? collapseAll) }));

  const toggleCollapseAll = () => {
    setCollapseAll((c) => !c);
    setOverrides({});
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      clear();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (entries.length === 0) return;
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      setSelected((i) => Math.max(0, Math.min(entries.length - 1, i + delta)));
    } else if (e.key === 'Enter') {
      const entry = entries[selected] ?? entries[0];
      if (!entry) return;
      e.preventDefault();
      open(entry, isModClick(e));
    }
  };

  // Flat index of the next selectable row; must walk the results in the same order as `entries`.
  let index = 0;

  return (
    <div className="search-pane" data-testid="search-pane">
      <div className="search-input-row">
        <input
          ref={inputRef}
          className="text-input search-input"
          data-testid="search-input"
          type="text"
          placeholder="Search..."
          value={query}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {query && (
          <button type="button" className="search-clear" aria-label="Clear search" title="Clear search" onClick={clear}>
            ×
          </button>
        )}
      </div>
      <div className="search-toolbar">
        <button type="button" className="search-toggle" aria-pressed={matchCase} title="Match case" onClick={() => setMatchCase((v) => !v)}>
          Match case
        </button>
        <button type="button" className="search-toggle" aria-pressed={collapseAll} title="Collapse results" onClick={toggleCollapseAll}>
          Collapse results
        </button>
        <button type="button" className="search-toggle" aria-pressed={explain} title="Explain search" onClick={() => setExplain((v) => !v)}>
          Explain search
        </button>
      </div>
      {explain && (
        <div className="search-hint">
          Terms are ANDed. <code>tag:#todo</code> <code>path:folder</code> <code>file:name</code> <code>-term</code> <code>"phrase"</code>{' '}
          <code>/regex/</code>
        </div>
      )}
      {query.trim() !== '' && output.forQuery !== '' && (
        <div className="search-summary" data-testid="search-summary">
          {formatSummary(output.totalResults, output.totalFiles)}
        </div>
      )}
      <div className="search-results" ref={listRef}>
        {output.results.map((r) => {
          const collapsed = isCollapsed(r.path);
          const headerIndex = collapsed || r.matches.length === 0 ? index++ : -1;
          const rows = collapsed ? [] : r.matches.map((m) => ({ match: m, index: index++ }));
          return (
            <ResultGroup
              key={r.path}
              result={r}
              collapsed={collapsed}
              headerSelected={headerIndex === selected}
              rows={rows}
              selected={selected}
              onToggle={() => toggleGroup(r.path)}
            />
          );
        })}
      </div>
    </div>
  );
}

interface ResultGroupProps {
  result: SearchResult;
  collapsed: boolean;
  headerSelected: boolean;
  rows: Array<{ match: SearchMatch; index: number }>;
  selected: number;
  onToggle: () => void;
}

function ResultGroup({ result, collapsed, headerSelected, rows, selected, onToggle }: ResultGroupProps) {
  const folder = dirname(result.path);
  const hasMatches = result.matches.length > 0;
  return (
    <div className={`search-result-file ${collapsed ? 'is-collapsed' : ''}`} data-testid="search-result-file" data-path={result.path}>
      <div
        className={`search-result-header ${headerSelected ? 'is-selected' : ''}`}
        title={result.path}
        onClick={(e) => open({ path: result.path }, isModClick(e))}
      >
        {hasMatches ? (
          <button
            type="button"
            className="search-result-chevron"
            aria-label={`${collapsed ? 'Expand' : 'Collapse'} matches in ${result.title}`}
            aria-expanded={!collapsed}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
          >
            {collapsed ? <Icons.chevronRight /> : <Icons.chevronDown />}
          </button>
        ) : (
          <span className="search-result-chevron" />
        )}
        <span className="search-result-title">{result.title}</span>
        {folder && <span className="search-result-path">{folder}</span>}
        {hasMatches && <span className="search-result-count">{result.matches.length}</span>}
      </div>
      {rows.map(({ match, index }, i) => (
        <MatchRow key={i} path={result.path} match={match} lineRanges={result.matches.filter((m) => m.line === match.line)} selected={index === selected} />
      ))}
    </div>
  );
}

interface MatchRowProps {
  path: string;
  match: SearchMatch;
  lineRanges: SearchMatch[];
  selected: boolean;
}

function MatchRow({ path, match, lineRanges, selected }: MatchRowProps) {
  const segments = buildSnippet(match.text, lineRanges, match);
  return (
    <div
      className={`search-result-match ${selected ? 'is-selected' : ''}`}
      data-testid="search-result-match"
      data-line={match.line}
      onClick={(e) => open({ path, line: match.line }, isModClick(e))}
    >
      {segments.map((s, i) =>
        s.mark ? (
          <mark key={i} className="search-highlight">
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </div>
  );
}
