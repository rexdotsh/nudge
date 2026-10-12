import { app } from './app.svelte';
import { isInstalled } from './platform';

export type Guide = 'ios' | 'mac';

const SAFARI = /\bVersion\/\S+ Safari\//;

function guideFor(): Guide | null {
  if (isInstalled()) return null;
  if (app.platform === 'ios') return 'ios';
  return app.platform === 'mac' && SAFARI.test(navigator.userAgent) ? 'mac' : null;
}

class Installer {
  /** Safari's Home Screen and Dock apps keep their own storage, so their guide comes before the setup code. */
  readonly guide = guideFor();
  #offer = $state.raw<BeforeInstallPromptEvent | null>(null);

  constructor() {
    if (app.platform !== 'mac') return;
    addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      this.#offer = event;
    });
    addEventListener('appinstalled', () => (this.#offer = null));
  }

  /** How to make this Mac browser's Nudge an app: Chrome and Edge prompt, Safari adds it to the Dock from its Share menu. */
  get mac(): 'prompt' | 'dock' | null {
    if (this.#offer) return 'prompt';
    return this.guide === 'mac' ? 'dock' : null;
  }

  async prompt(): Promise<void> {
    const offer = this.#offer;
    this.#offer = null;
    await offer?.prompt();
  }
}

export const installer = new Installer();
