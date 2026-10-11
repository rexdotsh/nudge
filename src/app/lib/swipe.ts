export interface SwipeOptions {
  onLeading: () => void;
  onTrailing: () => void;
  onOffset: (offset: number) => void;
}

const COMMIT_RATIO = 0.42;
const SLOP_PX = 8;

export function swipe(node: HTMLElement, options: SwipeOptions) {
  let startX = 0;
  let startY = 0;
  let offset = 0;
  let tracking: 'pending' | 'horizontal' | 'vertical' | 'idle' = 'idle';

  function down(event: PointerEvent): void {
    if (event.pointerType === 'mouse') return;
    startX = event.clientX;
    startY = event.clientY;
    tracking = 'pending';
  }

  function move(event: PointerEvent): void {
    if (tracking === 'idle' || tracking === 'vertical') return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (tracking === 'pending') {
      if (Math.abs(dx) < SLOP_PX && Math.abs(dy) < SLOP_PX) return;
      tracking = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
      if (tracking === 'horizontal') node.setPointerCapture(event.pointerId);
      else return;
    }
    offset = dx;
    options.onOffset(offset);
  }

  function reset(): void {
    tracking = 'idle';
    offset = 0;
    options.onOffset(0);
  }

  function up(): void {
    if (tracking === 'horizontal') {
      const ratio = offset / node.offsetWidth;
      if (ratio > COMMIT_RATIO) options.onLeading();
      else if (ratio < -COMMIT_RATIO) options.onTrailing();
    }
    reset();
  }

  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', up);
  node.addEventListener('pointercancel', reset);
  return {
    update(next: SwipeOptions) {
      options = next;
    },
    destroy() {
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', reset);
    },
  };
}
