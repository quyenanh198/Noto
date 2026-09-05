import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { highlightMatch } from '../../core/search/fuzzy';
import { useWorkspace } from '../../state/store';
import './palette.css';

export interface ModalProps<T> {
  /** Accessible name of the dialog. */
  label: string;
  testId: string;
  inputTestId: string;
  itemTestId: string;
  placeholder: string;
  query: string;
  onQueryChange: (query: string) => void;
  items: T[];
  itemKey: (item: T) => string;
  /** Extra attributes for an item row, e.g. `data-path`. */
  itemAttrs?: (item: T) => Record<string, string | undefined>;
  itemClassName?: (item: T) => string;
  /** Section label rendered above the item at `index`, if any. */
  dividerBefore?: (item: T, index: number) => string | null;
  renderItem: (item: T) => ReactNode;
  /** Enter or click. `secondary` is true for Shift+Enter, Ctrl/Cmd+Enter or a modified click. */
  onSelect: (item: T, secondary: boolean) => void;
  emptyText: string;
  hint: string;
}

export function closeModal(): void {
  useWorkspace.getState().setModal(null);
}

function isSecondary(e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): boolean {
  return e.shiftKey || e.ctrlKey || e.metaKey;
}

/**
 * Shared chrome for the quick switcher and command palette: backdrop, focused input,
 * keyboard navigation over a list (wrapping), hover selection and focus restoration on close.
 */
export function Modal<T>(props: ModalProps<T>) {
  const { items, query, onQueryChange, onSelect, testId } = props;
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(0);
  const count = items.length;
  const sel = count === 0 ? -1 : Math.min(selected, count - 1);

  useEffect(() => {
    const previous = document.activeElement;
    inputRef.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous !== document.body && previous.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('.modal-item.is-selected')?.scrollIntoView?.({ block: 'nearest' });
  }, [sel, items]);

  const move = (delta: number) => {
    if (count > 0) setSelected((((sel + delta) % count) + count) % count);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    switch (e.key) {
      case 'ArrowDown':
        move(1);
        break;
      case 'ArrowUp':
        move(-1);
        break;
      case 'Enter':
        if (sel >= 0) onSelect(items[sel], isSecondary(e));
        break;
      case 'Escape':
        closeModal();
        break;
      case 'Tab':
        // Keep focus in the input while the dialog is open.
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  const listId = `${testId}-list`;
  const optionId = (i: number) => `${testId}-option-${i}`;

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeModal();
      }}
    >
      <div className="modal palette" role="dialog" aria-modal="true" aria-label={props.label} data-testid={testId}>
        <input
          ref={inputRef}
          className="modal-input"
          type="text"
          role="combobox"
          aria-expanded={true}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={sel >= 0 ? optionId(sel) : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder={props.placeholder}
          value={query}
          onChange={(e) => {
            onQueryChange(e.target.value);
            setSelected(0);
          }}
          onKeyDown={onKeyDown}
          data-testid={props.inputTestId}
        />
        <div
          ref={listRef}
          id={listId}
          className="modal-results"
          role="listbox"
          // Clicking a row must not take focus away from the input.
          onMouseDown={(e) => e.preventDefault()}
        >
          {count === 0 && <div className="palette-empty">{props.emptyText}</div>}
          {items.map((item, i) => {
            const divider = props.dividerBefore?.(item, i) ?? null;
            const isSelected = i === sel;
            return (
              <Fragment key={props.itemKey(item)}>
                {divider && <div className="palette-divider">{divider}</div>}
                <div
                  id={optionId(i)}
                  role="option"
                  aria-selected={isSelected}
                  className={`modal-item ${isSelected ? 'is-selected' : ''} ${props.itemClassName?.(item) ?? ''}`}
                  data-testid={props.itemTestId}
                  {...props.itemAttrs?.(item)}
                  onMouseMove={() => {
                    if (!isSelected) setSelected(i);
                  }}
                  onClick={(e) => onSelect(item, isSecondary(e))}
                >
                  {props.renderItem(item)}
                </div>
              </Fragment>
            );
          })}
        </div>
        <div className="modal-hint">{props.hint}</div>
      </div>
    </div>
  );
}

/** Text with the matched characters wrapped in `<mark>`. */
export function Highlighted({ text, indices }: { text: string; indices: number[] }) {
  return (
    <>
      {highlightMatch(text, indices).map((seg, i) =>
        seg.matched ? <mark key={i}>{seg.text}</mark> : <Fragment key={i}>{seg.text}</Fragment>,
      )}
    </>
  );
}
