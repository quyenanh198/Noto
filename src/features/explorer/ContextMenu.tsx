import { Fragment, useEffect, useLayoutEffect, useRef } from 'react';

export interface MenuItem {
  label: string;
  /** Hotkey hint shown on the right, e.g. `F2`. */
  hint?: string;
  separatorBefore?: boolean;
  onSelect: () => void;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

/** Small context menu anchored at a screen position. Closes on outside click, Escape, scroll or resize. */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Keep the menu inside the viewport.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.left = `${Math.max(4, Math.min(x, window.innerWidth - rect.width - 4))}px`;
    el.style.top = `${Math.max(4, Math.min(y, window.innerHeight - rect.height - 4))}px`;
  }, [x, y]);

  useEffect(() => {
    const moveFocus = (dir: 1 | -1) => {
      const el = ref.current;
      if (!el) return;
      const buttons = [...el.querySelectorAll<HTMLElement>('[role="menuitem"]')];
      if (buttons.length === 0) return;
      const i = buttons.indexOf(document.activeElement as HTMLElement);
      const next = i === -1 ? (dir === 1 ? 0 : buttons.length - 1) : (i + dir + buttons.length) % buttons.length;
      buttons[next].focus();
    };
    const onMouseDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        moveFocus(e.key === 'ArrowDown' ? 1 : -1);
      }
    };
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', onMouseDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="menu" role="menu" style={{ left: x, top: y }} onContextMenu={(e) => e.preventDefault()}>
      {items.map((item, i) => (
        <Fragment key={i}>
          {item.separatorBefore && <div className="menu-separator" role="separator" />}
          <button
            type="button"
            className="menu-item"
            role="menuitem"
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            <span>{item.label}</span>
            {item.hint && <span className="menu-hint">{item.hint}</span>}
          </button>
        </Fragment>
      ))}
    </div>
  );
}
