<script lang="ts">
  import { onDestroy } from 'svelte';
  import Icon from './Icon.svelte';

  let {
    when,
    cadence,
    important,
    summary,
  }: { when: string; cadence: string | null; important: boolean; summary: string } = $props();

  const detail = $derived(cadence ?? (important ? 'Important' : null));
  let holding: ReturnType<typeof setTimeout> | undefined;
  let revealed = $state(false);

  // Touch has no tooltips; a long press reveals the summary without adding the reminder.
  function hold(event: PointerEvent) {
    if (event.pointerType !== 'mouse') holding = setTimeout(() => (revealed = true), 450);
  }

  function release() {
    clearTimeout(holding);
  }

  onDestroy(release);
</script>

<button
  class="summary press"
  type="submit"
  title={[when, detail].filter(Boolean).join('\n')}
  aria-label={`Add, ${summary}`}
  onpointerdown={hold}
  onpointerup={release}
  onpointercancel={() => {
    release();
    revealed = false;
  }}
  onpointerleave={release}
  oncontextmenu={(event) => event.preventDefault()}
  onclick={(event) => {
    if (revealed) {
      event.preventDefault();
      revealed = false;
    }
  }}
>
  <span class="what">
    <span class="at">{when}</span>
    {#if detail}
      <span class="rule"
        >{#if important}<b aria-hidden="true">!</b>{/if}{cadence ?? 'Important'}</span
      >
    {/if}
  </span>
  <span class="go"><Icon name="up" size={15} /></span>
</button>
{#if revealed}
  <p class="full" role="status">
    <b>{when}</b>{#if detail}<br />{important && cadence ? '! ' : ''}{detail}{/if}
  </p>
{/if}

<style>
  .summary {
    flex: none;
    max-width: 64%;
    height: 40px;
    display: inline-flex;
    align-items: center;
    gap: 12px;
    padding: 0 4px 0 14px;
    border-radius: 999px;
    background: var(--raised);
    box-shadow: inset 0 0 0 1px var(--edge);
    color: var(--ink);
    white-space: nowrap;
    text-align: left;
    -webkit-touch-callout: none;
    user-select: none;
    animation: pop var(--base) var(--spring);
  }

  .what {
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    line-height: 1.15;
  }

  .at,
  .rule {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .at {
    font-size: 13.5px;
    font-weight: 600;
  }

  .rule {
    color: var(--muted);
    font-size: 11.5px;
  }

  .rule b {
    margin-right: 4px;
    color: var(--accent);
    font-weight: 700;
  }

  .go {
    flex: none;
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--on);
    color: var(--on-ink);
  }

  .full {
    position: absolute;
    right: 8px;
    bottom: calc(100% + 8px);
    max-width: calc(100% - 16px);
    margin: 0;
    padding: 9px 12px;
    border-radius: 12px;
    background: var(--raised);
    box-shadow: inset 0 0 0 1px var(--edge);
    color: var(--ink-2);
    font-size: 13px;
    animation: pop var(--fast) var(--ease);
  }

  .full b {
    color: var(--ink);
    font-weight: 600;
  }

  @keyframes pop {
    from {
      opacity: 0;
      transform: scale(0.6);
    }
  }
</style>
