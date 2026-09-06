import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useWorkspace } from '../../state/store';
import { Modal } from './Modal';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function TestModal() {
  return (
    <Modal<string>
      label="Test"
      testId="test-modal"
      inputTestId="test-modal-input"
      itemTestId="test-modal-item"
      placeholder=""
      query="welcome note"
      onQueryChange={() => {}}
      items={['a', 'b']}
      itemKey={(s) => s}
      renderItem={(s) => <span>{s}</span>}
      onSelect={() => {}}
      emptyText="none"
      hint=""
    />
  );
}

describe('Modal backdrop dismissal', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    useWorkspace.getState().setModal('switcher');
    act(() => root.render(<TestModal />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    useWorkspace.getState().setModal(null);
  });

  const backdrop = () => container.querySelector('.modal-backdrop') as HTMLElement;
  const input = () => container.querySelector('.modal-input') as HTMLInputElement;
  const mouse = (el: HTMLElement, type: string) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));

  it('closes on a click that starts and ends on the backdrop', () => {
    act(() => {
      mouse(backdrop(), 'mousedown');
      mouse(backdrop(), 'mouseup');
      mouse(backdrop(), 'click');
    });
    expect(useWorkspace.getState().modal).toBeNull();
  });

  it('stays open when a drag-selection that started in the input ends over the backdrop', () => {
    // Browsers dispatch the click on the common ancestor of the mousedown and mouseup targets: the backdrop itself.
    act(() => {
      mouse(input(), 'mousedown');
      mouse(backdrop(), 'mouseup');
      mouse(backdrop(), 'click');
    });
    expect(useWorkspace.getState().modal).toBe('switcher');
    expect(input().value).toBe('welcome note');
  });
});
