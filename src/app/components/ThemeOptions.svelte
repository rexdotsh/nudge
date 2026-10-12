<script lang="ts">
  import { THEMES } from '../../shared/api';
  import { app } from '../lib/app.svelte';
  import { swap } from '../lib/motion.svelte';
  import { THEME_LABELS, appearance } from '../lib/theme.svelte';
  import Icon from './Icon.svelte';
</script>

{#each THEMES as theme (theme)}
  <label class="field option">
    <span class="name">
      <span class="swatch" data-theme={theme}><span></span></span>
      {THEME_LABELS[theme]}
    </span>
    <input
      class="sr-only"
      type="radio"
      name="theme"
      checked={appearance.theme === theme}
      onchange={() => swap(() => app.chooseTheme(theme))}
    />
    {#if appearance.theme === theme}<Icon name="check" size={18} />{/if}
  </label>
{/each}

<style>
  .option {
    cursor: pointer;
  }

  .option > :global(svg) {
    color: var(--on);
  }

  .option:has(:focus-visible) .swatch {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }

  .name {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .swatch {
    width: 34px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding: 0 6px;
    border-radius: 7px;
    background: var(--bg);
    box-shadow: inset 0 0 0 1px var(--edge);
  }

  .swatch span {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
  }
</style>
