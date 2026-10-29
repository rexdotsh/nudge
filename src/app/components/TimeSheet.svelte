<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Reminder } from '../../shared/reminder';
  import { ui } from '../lib/ui.svelte';
  import Sheet from './Sheet.svelte';

  let { title, reminder, children }: { title: string; reminder: Reminder; children: Snippet } = $props();
</script>

<Sheet label="{title} {reminder.title}" onClose={() => (ui.sheet = null)}>
  <h2 class="heading">{title}</h2>
  <p class="what">{reminder.title}</p>
  {@render children()}
</Sheet>

<style>
  h2 {
    margin-top: 2px;
  }

  .what {
    margin: 2px 0 16px;
    overflow: hidden;
    color: var(--muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
