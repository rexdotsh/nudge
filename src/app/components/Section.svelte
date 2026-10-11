<script lang="ts">
  import { flip } from 'svelte/animate';
  import { fade, slide } from 'svelte/transition';
  import type { Section } from '../lib/sections';
  import ReminderRow from './ReminderRow.svelte';

  let { section, now, zone }: { section: Section; now: number; zone: string } = $props();
</script>

<section class:overdue={section.key === 'overdue'} transition:fade={{ duration: 160 }}>
  <h2>{section.title}<span class="count">{section.entries.length}</span></h2>
  <div class="group">
    {#each section.entries as entry (entry.reminder.id)}
      <div animate:flip={{ duration: 320 }} transition:slide={{ duration: 260 }}>
        <ReminderRow {entry} {now} {zone} />
      </div>
    {/each}
  </div>
</section>

<style>
  section {
    margin-top: 22px;
  }

  h2 {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin: 0 4px 8px;
    font: 600 20px/1.2 var(--font-display);
    letter-spacing: -0.01em;
  }

  .overdue h2 {
    color: var(--danger);
  }

  .count {
    font: 500 14px var(--font);
    color: var(--label-3);
  }

  .group {
    border-radius: var(--radius-group);
    overflow: hidden;
  }

  :global([data-platform='windows']) section {
    margin-top: 18px;
  }

  :global([data-platform='windows']) h2 {
    font-size: 14px;
    font-weight: 600;
    margin: 0 2px 6px;
  }

  :global([data-platform='windows']) .group {
    border-radius: 0;
    overflow: visible;
  }
</style>
