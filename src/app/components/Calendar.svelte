<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { addMonthsClamped, epochDay, fromEpochDay, weekday } from '../../shared/time';
  import { calendarLabel, locale } from '../lib/format';
  import { monthGrid, weekStart } from '../lib/pickers';
  import Icon from './Icon.svelte';

  let { selected, today, onPick }: { selected: number | null; today: number; onPick: (day: number) => void } = $props();

  const FIRST_WEEKDAY = weekStart(locale);
  const STEPS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

  const id = $props.id();
  let focused = $state(untrack(() => selected ?? today));
  const shown = $derived(fromEpochDay(focused));
  const days = $derived(monthGrid(shown, FIRST_WEEKDAY));
  const weeks = $derived([0, 7, 14, 21, 28, 35].map((start) => days.slice(start, start + 7)));
  let grid: HTMLElement | undefined = $state();

  const byMonths = (count: number) => epochDay(addMonthsClamped(fromEpochDay(focused), count));

  async function move(day: number) {
    focused = day;
    await tick();
    grid?.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
  }

  function keydown(event: KeyboardEvent) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const step = STEPS[event.key];
    const startOfWeek = focused - ((weekday(focused) - FIRST_WEEKDAY + 7) % 7);
    if (step !== undefined) void move(focused + step);
    else if (event.key === 'Home') void move(startOfWeek);
    else if (event.key === 'End') void move(startOfWeek + 6);
    else if (event.key === 'PageUp') void move(byMonths(event.shiftKey ? -12 : -1));
    else if (event.key === 'PageDown') void move(byMonths(event.shiftKey ? 12 : 1));
    else return;
    event.preventDefault();
  }
</script>

<header>
  <h2 id="{id}-month" aria-live="polite">{calendarLabel(epochDay({ ...shown, day: 1 }), 'month')}</h2>
  <button class="step" aria-label="Previous month" onclick={() => (focused = byMonths(-1))}
    ><Icon name="arrowLeft" size={16} /></button
  >
  <button class="step" aria-label="Next month" onclick={() => (focused = byMonths(1))}
    ><Icon name="arrowRight" size={16} /></button
  >
</header>
<table role="grid" aria-labelledby="{id}-month" onkeydown={keydown}>
  <thead>
    <tr>
      {#each days.slice(0, 7) as day (day)}
        <th scope="col" abbr={calendarLabel(day, 'weekday')}>{calendarLabel(day, 'shortWeekday')}</th>
      {/each}
    </tr>
  </thead>
  <tbody bind:this={grid}>
    {#each weeks as week (week[0])}
      <tr>
        {#each week as day (day)}
          <td role="gridcell" aria-selected={day === selected}>
            <button
              type="button"
              tabindex={day === focused ? 0 : -1}
              class:outside={fromEpochDay(day).month !== shown.month}
              aria-current={day === today ? 'date' : undefined}
              aria-label={calendarLabel(day, 'longDate')}
              data-autofocus={day === focused || undefined}
              onclick={() => onPick(day)}>{calendarLabel(day, 'day')}</button
            >
          </td>
        {/each}
      </tr>
    {/each}
  </tbody>
</table>
<footer>
  <button class="chip" onclick={() => onPick(today)}>Today</button>
  <button class="chip" onclick={() => onPick(today + 1)}>Tomorrow</button>
</footer>

<style>
  header {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px 4px 6px 10px;
  }

  h2 {
    flex: 1;
    margin: 0;
    font-size: 13.5px;
    font-weight: 600;
  }

  .step {
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    border-radius: 6px;
    color: var(--ink-2);
  }

  .step:hover,
  td button:hover {
    background: var(--edge);
  }

  table {
    border-spacing: 0;
    margin: 0 2px;
  }

  th {
    height: 24px;
    padding: 0;
    color: var(--muted);
    font-size: 11.5px;
    font-weight: 600;
    text-align: center;
  }

  td {
    padding: 1px;
  }

  td button {
    width: 34px;
    height: 32px;
    border-radius: 7px;
    font-size: 13.5px;
    font-variant-numeric: tabular-nums;
  }

  td button:focus-visible {
    outline-offset: -2px;
  }

  .outside {
    color: var(--muted);
  }

  [aria-current='date'] {
    color: var(--accent);
    font-weight: 600;
  }

  [aria-selected='true'] button {
    background: var(--on);
    color: var(--on-ink);
    font-weight: 600;
    outline-color: var(--surface);
  }

  footer {
    display: flex;
    gap: 6px;
    margin-top: 6px;
    padding: 8px 6px 4px;
    border-top: 1px solid var(--edge);
  }

  footer .chip:hover {
    color: var(--ink);
  }
</style>
