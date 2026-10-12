import { app } from './app.svelte';
import { isInstalled } from './platform';

export type Guide = 'ios' | 'mac';

const PROMPTED = ['mac', 'android'] as const;
export type Prompted = (typeof PROMPTED)[number];

const SAFARI = /\bVersion\/\S+ Safari\//;

function guideFor(): Guide | null {
  if (isInstalled()) return null;
  if (app.platform === 'ios') return 'ios';
  return app.platform === 'mac' && SAFARI.test(navigator.userAgent) ? 'mac' : null;
}

class Installer {
  /** Safari's Home Screen and Dock apps keep their own storage, so their guide comes before the setup code. */
  readonly guide = guideFor();
  readonly target: Prompted | null = PROMPTED.find((platform) => platform === app.platform) ?? null;
  #offer = $state.raw<BeforeInstallPromptEvent | null>(null);

  constructor() {
    if (!this.target) return;
    addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      this.#offer = event;
    });
    addEventListener('appinstalled', () => (this.#offer = null));
  }

  get route(): 'prompt' | 'dock' | null {
    if (this.#offer) return 'prompt';
    return this.guide === 'mac' ? 'dock' : null;
  }

  /** Holding back Chrome's own install banner leaves a phone tab, easy to lose among others, as the only way in, so
   * Android is offered the app once, at the end of setting up. */
  get welcome(): boolean {
    return this.target === 'android' && this.#offer !== null;
  }

  async prompt(): Promise<void> {
    const offer = this.#offer;
    this.#offer = null;
    await offer?.prompt();
  }
}

export const installer = new Installer();
