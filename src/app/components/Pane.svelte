<script lang="ts">
  import type { Reminder } from '../../shared/reminder';
  import { FEATURED, HELP, hint, keyLabels } from '../lib/shortcuts';
  import { ui } from '../lib/ui.svelte';
  import EditSheet from './EditSheet.svelte';

  let { editing }: { editing: Reminder | undefined } = $props();
</script>

<aside class="pane" aria-label="Details">
  {#if editing}
    {#key editing.id}<EditSheet reminder={editing} />{/key}
  {:else}
    <div class="idle">
      <p class="lead">Nothing selected</p>
      <p>Pick a reminder to see and change its details.</p>
      <dl>
        {#each FEATURED as binding (binding.label)}
          <div>
            <dt>{binding.label}</dt>
            <dd>
              {#each keyLabels(binding) as key (key)}<kbd>{key}</kbd>{/each}
            </dd>
          </div>
        {/each}
      </dl>
      <button class="link quiet" onclick={() => (ui.help = true)}>All shortcuts <kbd>{hint(HELP)}</kbd></button>
    </div>
  {/if}
</aside>

<style>
  .pane {
    position: fixed;
    top: env(titlebar-area-height, 0px);
    right: 0;
    bottom: 0;
    width: var(--pane-width);
    overflow-y: auto;
    overscroll-behavior: contain;
    border-left: 1px solid var(--line);
    background: var(--bg);
  }

  .idle {
    min-height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 32px 36px;
    color: var(--muted);
    font-size: 14px;
  }

  p {
    margin: 0;
  }

  .lead {
    margin-bottom: 4px;
    color: var(--ink-2);
    font-size: 15px;
    font-weight: 600;
  }

  dl {
    margin: 28px 0 20px;
    display: grid;
    gap: 10px;
  }

  dl div {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
  }

  dt {
    color: var(--ink-2);
  }

  dd {
    margin: 0;
    display: flex;
    gap: 4px;
  }

  button {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
  }
</style>
