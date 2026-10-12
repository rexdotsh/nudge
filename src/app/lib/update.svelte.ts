import { ui } from './ui.svelte';

const CHECK_EVERY_MS = 60_000;

/**
 * A deploy reaches an open app the next time it is looked at: the browser fetches the new service worker, which takes
 * over at once, and the page reloads into it as soon as nothing unsaved is on screen.
 */
export function stayCurrent(container: ServiceWorkerContainer): void {
  const upgrading = container.controller !== null;
  let replaced = $state(false);
  let checked = 0;

  function check(): void {
    if (document.visibilityState !== 'visible' || Date.now() - checked < CHECK_EVERY_MS) return;
    checked = Date.now();
    container
      .getRegistration()
      .then((registration) => registration?.update())
      .catch((error: unknown) => console.warn('could not check for a new version', error));
  }

  container.addEventListener('controllerchange', () => {
    replaced = upgrading;
  });
  document.addEventListener('visibilitychange', check);
  window.addEventListener('focus', check);
  $effect.root(() => {
    $effect(() => {
      if (replaced && ui.idle) location.reload();
    });
  });
}
