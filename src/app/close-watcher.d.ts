/** Chromium's and Firefox's hook for close requests: Android's back gesture, and Escape where a keydown doesn't cancel it. */
declare class CloseWatcher extends EventTarget {
  destroy(): void;
}
