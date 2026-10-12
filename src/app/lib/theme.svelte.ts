import { get, update } from '../../browser/kv';
import type { ThemeState } from '../../browser/schema';
import { DEFAULT_THEME, type SyncResponse, type Theme, type ThemeChoice } from '../../shared/api';
import { ulid } from '../../shared/ulid';

export const THEME_LABELS: Record<Theme, string> = { classic: 'Classic', rex: 'Rex Dark', 'rex-light': 'Rex Light' };

/** Read by the inline script in index.html, which paints the last theme before the app loads. */
const PAINTED_KEY = 'theme';

const UNCHOSEN: ThemeState = { theme: DEFAULT_THEME, version: 0, pending: null };

function paint(theme: Theme): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  const color = getComputedStyle(root).getPropertyValue('--bg').trim();
  root.style.background = color;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
  // Storage can be full or switched off (private browsing); the next launch then only starts in Classic until this runs.
  try {
    localStorage.setItem(PAINTED_KEY, JSON.stringify({ theme, color }));
  } catch (error) {
    console.warn('the theme cannot be remembered for the next launch', error);
  }
}

class Appearance {
  theme = $state<Theme>(DEFAULT_THEME);
  private state = UNCHOSEN;
  private painted: Theme | null = null;

  get pending(): ThemeChoice | null {
    return this.state.pending;
  }

  async load(): Promise<void> {
    this.show((await get('theme')) ?? UNCHOSEN);
  }

  async choose(theme: Theme): Promise<void> {
    const choice: ThemeChoice = { id: ulid(), theme, at: Date.now() };
    this.show(await update('theme', (state = UNCHOSEN) => ({ ...state, pending: choice })));
  }

  async receive(response: SyncResponse, sent: ThemeChoice | null): Promise<void> {
    this.show(
      await update('theme', (state = UNCHOSEN) => ({
        ...(response.reset || response.version >= state.version
          ? { theme: response.theme, version: response.version }
          : state),
        pending: state.pending?.id === sent?.id ? null : state.pending,
      })),
    );
  }

  private show(state: ThemeState): void {
    this.state = state;
    this.theme = state.pending?.theme ?? state.theme;
    if (this.theme === this.painted) return;
    this.painted = this.theme;
    paint(this.theme);
  }
}

export const appearance = new Appearance();
