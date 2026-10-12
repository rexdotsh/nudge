/**
 * Lets Android's back gesture close a screen or layer instead of leaving the app. The same request comes from Escape,
 * so components that handle Escape themselves cancel that keydown. Returns the cleanup.
 */
export function closeOnBack(close: () => void): (() => void) | undefined {
  if (!('CloseWatcher' in window)) return undefined;
  const watcher = new CloseWatcher();
  watcher.addEventListener('close', close);
  return () => watcher.destroy();
}
