import { ui } from './ui.svelte';

const CHECK_AFTER_MS = 10_000;

let checked = 0;

export function checkForUpdate(): void {
  if (!('serviceWorker' in navigator) || Date.now() - checked < CHECK_AFTER_MS) return;
  checked = Date.now();
  navigator.serviceWorker
    .getRegistration()
    .then((registration) => registration?.update())
    .catch((error: unknown) => console.warn('could not check for a new version', error));
}

export function stayCurrent(container: ServiceWorkerContainer): void {
  let upgrading = container.controller !== null;
  let replaced = $state(false);

  container.addEventListener('controllerchange', () => {
    replaced = upgrading;
    upgrading = true;
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
