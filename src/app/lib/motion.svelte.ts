import { flushSync, untrack } from 'svelte';
import { cubicIn, cubicOut } from 'svelte/easing';

type Token = '--fast' | '--base' | '--ease';

/** A bulk change, like a catch-up sync or clearing completed, snaps into place instead. */
const MOST_CHANGES = 8;

function token(name: Token): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Reduced motion sets the duration tokens to zero. The build may rewrite them from milliseconds to seconds. */
function ms(name: '--fast' | '--base'): number {
  const value = token(name);
  return Number.parseFloat(value) * (value.endsWith('ms') ? 1 : 1000);
}

interface Offset {
  x?: number;
  y?: number;
}

/** Svelte transition parameters: things arrive at the base pace and leave at the fast one. */
export function arrive(offset: Offset = {}) {
  return { ...offset, duration: ms('--base'), easing: cubicOut };
}

export function depart(offset: Offset = {}) {
  return { ...offset, duration: ms('--fast'), easing: cubicIn };
}

/** Changes the whole screen in one step, crossfading it where the browser can; a step between screens slides on touch
 *  screens. */
export function swap(update: () => unknown, step?: 'forward' | 'back'): void {
  if (!('startViewTransition' in document)) {
    void update();
    return;
  }
  const root = document.documentElement;
  if (step) root.dataset.step = step;
  const transition = document.startViewTransition(async () => {
    await update();
    flushSync();
  });
  void transition.finished.finally(() => delete root.dataset.step);
}

interface Placed {
  node: HTMLElement;
  box: DOMRect;
}

interface Glide {
  animation: Animation;
  to: DOMRect;
}

const gliding = new WeakMap<HTMLElement, Glide>();

function measure(root: HTMLElement): Map<string, Placed> {
  const placed = new Map<string, Placed>();
  for (const node of root.querySelectorAll<HTMLElement>('[data-glide]')) {
    if (node.dataset.glide) placed.set(node.dataset.glide, { node, box: node.getBoundingClientRect() });
  }
  return placed;
}

const sameSpot = (a: DOMRect, b: DOMRect) => Math.abs(a.left - b.left) < 0.5 && Math.abs(a.top - b.top) < 0.5;

/** Leaves a lifeless copy where the node was and fades it out, behind the page, so what moves into its place covers it. */
function fade({ node, box }: Placed): void {
  const copy = node.cloneNode(true);
  if (!(copy instanceof HTMLElement)) return;
  // Without its data attributes nothing finds the copy as the element it copies.
  for (const element of [copy, ...copy.querySelectorAll<HTMLElement>('*')]) {
    for (const key of Object.keys(element.dataset)) delete element.dataset[key];
  }
  copy.inert = true;
  copy.ariaHidden = 'true';
  Object.assign(copy.style, {
    position: 'fixed',
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    zIndex: '-1',
    margin: '0',
    pointerEvents: 'none',
  });
  document.body.append(copy);
  const frames = [
    { opacity: 1, transform: 'none' },
    { opacity: 0, transform: 'scale(0.98)' },
  ];
  copy.animate(frames, { duration: ms('--fast'), easing: 'ease-in' }).onfinish = () => copy.remove();
}

function play(root: HTMLElement, before: Map<string, Placed>): void {
  // Moving ones are measured where they are headed; one still headed to the same spot carries on undisturbed.
  const interrupted = new Map<HTMLElement, { glide: Glide; time: CSSNumberish | null }>();
  for (const node of root.querySelectorAll<HTMLElement>('[data-glide]')) {
    const running = gliding.get(node);
    if (running?.animation.playState !== 'running') continue;
    interrupted.set(node, { glide: running, time: running.animation.currentTime });
    running.animation.cancel();
  }
  const after = measure(root);
  const arrived = [...after.keys()].filter((key) => !before.has(key));
  const left = [...before]
    .filter(([key, { node }]) => !after.has(key) && !node.isConnected)
    .map(([, placed]) => placed);
  const bulk = arrived.length + left.length > MOST_CHANGES;
  const timing = { duration: ms('--base'), easing: token('--ease') };
  for (const [key, { node, box }] of after) {
    const going = interrupted.get(node);
    if (going && sameSpot(going.glide.to, box)) {
      going.glide.animation.currentTime = going.time;
      going.glide.animation.play();
      continue;
    }
    const from = before.get(key)?.box;
    if (bulk || (from && sameSpot(from, box))) continue;
    const frames = from
      ? [{ transform: `translate(${from.left - box.left}px, ${from.top - box.top}px)` }, { transform: 'none' }]
      : [
          { opacity: 0, transform: 'translateY(6px)' },
          { opacity: 1, transform: 'none' },
        ];
    gliding.set(node, { animation: node.animate(frames, timing), to: box });
  }
  if (!bulk) left.forEach(fade);
}

/** Lets what is marked `data-glide` in a container slide to where a change moves it, rise in where it appears and fade
 *  where it leaves, so a change to a list reads as one motion. Only changes after the first paint move. */
export function glide(container: () => HTMLElement | undefined, changes: () => unknown): void {
  let before: Map<string, Placed> | null = null;
  $effect.pre(() => {
    changes();
    const root = untrack(container);
    before = root && !document.hidden && ms('--base') > 0 ? measure(root) : null;
  });
  $effect(() => {
    changes();
    const root = untrack(container);
    if (root && before) play(root, before);
    before = null;
  });
}
