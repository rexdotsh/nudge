/** Chromium's offer to install the app, raised once it is installable. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<unknown>;
}

interface WindowEventMap {
  beforeinstallprompt: BeforeInstallPromptEvent;
}
