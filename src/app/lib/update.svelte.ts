import { ui } from './ui.svelte';

const CHECK_AFTER_MS = 10_000;

let checked = 0;

/** Asks the browser for a newer service worker; it takes over at once when there is one. */
export function checkForUpdate(): void {
  if (!('serviceWorker' in navigator) || Date.now() - checked < CHECK_AFTER_MS) return;
  checked = Date.now();
  navigator.serviceWorker
    .getRegistration()
    .then((registration) => registration?.update())
    .catch((error: unknown) => console.warn('could not check for a new version', error));
}

/**
 * A deploy restarts the server, which drops every open socket, so a reconnect is the moment to look for a new build,
 * as is the app being looked at again. The page reloads into it as soon as nothing unsaved is on screen.
 */
export function stayCurrent(container: ServiceWorkerContainer): void {
  const upgrading = container.controller !== null;
  let replaced = $state(false);

  container.addEventListener('controllerchange', () => {
    replaced = upgrading;
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate();
  });
  window.addEventListener('focus', checkForUpdate);
  $effect.root(() => {
    $effect(() => {
      if (replaced && ui.idle) location.reload();
    });
  });
}
