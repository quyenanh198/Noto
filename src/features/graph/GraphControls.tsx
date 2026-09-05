import { useState } from 'react';
import { Icons } from '../../components/icons';
import { SETTINGS_RANGES, type GraphSettings } from './simulation';

export interface GraphControlsProps {
  settings: GraphSettings;
  /** Local graphs only expose depth and the tag/unresolved toggles. */
  local: boolean;
  onChange: (patch: Partial<GraphSettings>) => void;
  onReset: () => void;
}

export function GraphControls({ settings, local, onChange, onReset }: GraphControlsProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`graph-controls${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className={`clickable-icon graph-controls-toggle${open ? ' is-active' : ''}`}
        aria-label="Graph settings"
        title="Graph settings"
        aria-expanded={open}
        data-testid="graph-controls-toggle"
        onClick={() => setOpen((o) => !o)}
      >
        <Icons.settings />
      </button>
      {open && (
        <div className="graph-controls-panel">
          {!local && (
            <input
              className="text-input graph-filter"
              type="text"
              placeholder="Filter nodes"
              aria-label="Filter nodes"
              data-testid="graph-filter"
              value={settings.filter}
              onChange={(e) => onChange({ filter: e.target.value })}
            />
          )}
          {!local && <Toggle label="Show orphans" checked={settings.showOrphans} onChange={(v) => onChange({ showOrphans: v })} />}
          <Toggle label="Show tags" checked={settings.showTags} onChange={(v) => onChange({ showTags: v })} />
          <Toggle label="Show unresolved links" checked={settings.showUnresolved} onChange={(v) => onChange({ showUnresolved: v })} />
          {local && (
            <label className="graph-controls-row">
              <span>Depth</span>
              <select value={settings.depth} onChange={(e) => onChange({ depth: Number(e.target.value) })}>
                {[1, 2, 3].map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!local && (
            <>
              <Slider label="Link distance" value={settings.linkDistance} {...SETTINGS_RANGES.linkDistance} step={1} onChange={(v) => onChange({ linkDistance: v })} />
              <Slider label="Repel force" value={settings.repelForce} {...SETTINGS_RANGES.repelForce} step={1} onChange={(v) => onChange({ repelForce: v })} />
              <Slider label="Center force" value={settings.centerForce} {...SETTINGS_RANGES.centerForce} step={0.05} onChange={(v) => onChange({ centerForce: v })} />
            </>
          )}
          <button type="button" className="graph-controls-reset" onClick={onReset}>
            Reset view
          </button>
        </div>
      )}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="graph-controls-row">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function Slider({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) {
  return (
    <label className="graph-controls-slider">
      <span className="graph-controls-slider-head">
        <span>{label}</span>
        <span className="graph-controls-value">{value}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}
