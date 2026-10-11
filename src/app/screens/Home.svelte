<script lang="ts">
  import { toLocal } from '../../shared/time';
  import Composer from '../components/Composer.svelte';
  import Icon from '../components/Icon.svelte';
  import Section from '../components/Section.svelte';
  import Toast from '../components/Toast.svelte';
  import { app } from '../lib/app.svelte';
  import { headingDate, whenLabel } from '../lib/format';
  import { recentlyCompleted, upcoming } from '../lib/sections';

  let { skin, onSettings }: { skin: 'ios' | 'windows'; onSettings: () => void } = $props();

  let tab = $state<'upcoming' | 'done'>('upcoming');

  const sections = $derived(upcoming(app.reminders, app.now, app.zone));
  const completed = $derived(recentlyCompleted(app.reminders, app.now));
  const hour = $derived(toLocal(app.now, app.zone).hour);
  const sky = $derived(
    hour < 5 ? 'night' : hour < 11 ? 'morning' : hour < 17 ? 'day' : hour < 21 ? 'evening' : 'night',
  );
  const greeting = $derived(
    hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening',
  );
</script>

<div class="home" data-sky={sky}>
  <div class="sky" aria-hidden="true"></div>
  <header>
    <div class="toolbar">
      {#if !app.online}<span class="offline glass">Offline · changes will sync</span>{/if}
      <button class="round glass" onclick={onSettings} aria-label="Settings"><Icon name="settings" size={20} /></button>
    </div>
    <h1>{greeting}</h1>
    <p class="date">{headingDate(app.now, app.zone)}</p>
    <div class="segments" role="tablist">
      <button role="tab" aria-selected={tab === 'upcoming'} onclick={() => (tab = 'upcoming')}>Upcoming</button>
      <button role="tab" aria-selected={tab === 'done'} onclick={() => (tab = 'done')}>Completed</button>
    </div>
  </header>

  {#if skin === 'windows'}<div class="top-composer"><Composer /></div>{/if}

  <main>
    {#if tab === 'upcoming'}
      {#each sections as section (section.key)}
        <Section {section} now={app.now} zone={app.zone} />
      {:else}
        <div class="empty">
          <div class="halo"><Icon name="bell" size={34} /></div>
          <h3>All clear</h3>
          <p>
            Nothing coming up. Type a reminder the way you'd say it, like “call mom sunday 6pm” or “water plants every 3
            days after done”.
          </p>
        </div>
      {/each}
    {:else if completed.length > 0}
      <div class="group done">
        {#each completed as reminder (reminder.id)}
          <div class="done-row">
            <span class="tick"><Icon name="check" size={14} /></span>
            <span class="title">{reminder.title}</span>
            <span class="when"
              >{reminder.completedAt === null ? '' : whenLabel(reminder.completedAt, app.now, app.zone)}</span
            >
          </div>
        {/each}
      </div>
    {:else}
      <div class="empty"><p>Completed reminders show up here for 30 days.</p></div>
    {/if}
  </main>

  {#if skin === 'ios'}<Composer floating />{/if}
  <Toast />
</div>

<style>
  .home {
    position: relative;
    min-height: 100dvh;
    padding: env(safe-area-inset-top) 16px calc(190px + env(safe-area-inset-bottom));
  }

  .sky {
    position: absolute;
    inset: 0 0 auto;
    height: 300px;
    pointer-events: none;
    mask-image: linear-gradient(to bottom, #000 40%, transparent);
  }

  [data-sky='morning'] .sky {
    background: radial-gradient(120% 90% at 85% 0%, #ffc9a8 0%, transparent 60%), linear-gradient(#ffe6d4, transparent);
  }

  [data-sky='day'] .sky {
    background: radial-gradient(120% 90% at 80% 0%, #bfe0ff 0%, transparent 60%), linear-gradient(#e2f0ff, transparent);
  }

  [data-sky='evening'] .sky {
    background:
      radial-gradient(110% 90% at 90% 0%, #ff9f82 0%, transparent 55%),
      radial-gradient(90% 80% at 10% 0%, #ffc59a 0%, transparent 60%), linear-gradient(#ffd9c4, transparent);
  }

  [data-sky='night'] .sky {
    background: radial-gradient(110% 90% at 85% 0%, #c9c2ff 0%, transparent 60%), linear-gradient(#e4e0ff, transparent);
  }

  @media (prefers-color-scheme: dark) {
    [data-sky='morning'] .sky {
      background: radial-gradient(120% 90% at 85% 0%, #4a2a1b 0%, transparent 65%);
    }
    [data-sky='day'] .sky {
      background: radial-gradient(120% 90% at 80% 0%, #10304d 0%, transparent 65%);
    }
    [data-sky='evening'] .sky {
      background: radial-gradient(110% 90% at 90% 0%, #4d2016 0%, transparent 65%);
    }
    [data-sky='night'] .sky {
      background: radial-gradient(110% 90% at 85% 0%, #221c4d 0%, transparent 65%);
    }
  }

  header {
    position: relative;
    padding-top: 10px;
  }

  .toolbar {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 8px;
    min-height: 40px;
  }

  .round {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: var(--label);
  }

  .offline {
    padding: 7px 12px;
    border-radius: 999px;
    font-size: 13px;
    color: var(--label-2);
  }

  h1 {
    margin: 6px 4px 0;
    font: var(--title-weight) var(--title-size) / 1.1 var(--font-display);
    letter-spacing: -0.02em;
  }

  .date {
    margin: 4px 4px 0;
    color: var(--label-2);
    font-size: 15px;
  }

  .segments {
    display: flex;
    margin: 16px 0 0;
    padding: 2px;
    border-radius: 10px;
    background: var(--fill);
  }

  .segments button {
    flex: 1;
    padding: 6px 0;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    color: var(--label);
  }

  .segments button[aria-selected='true'] {
    background: var(--surface-raised);
    box-shadow:
      0 3px 8px rgb(0 0 0 / 0.12),
      0 0 0 0.5px rgb(0 0 0 / 0.04);
  }

  main {
    position: relative;
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 56px 24px;
    color: var(--label-2);
  }

  .halo {
    width: 76px;
    height: 76px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: var(--brand);
    background: radial-gradient(circle, var(--brand-soft), transparent 70%);
    animation: breathe 4s ease-in-out infinite;
  }

  .empty h3 {
    margin: 12px 0 4px;
    color: var(--label);
    font: 600 20px var(--font-display);
  }

  .empty p {
    margin: 0;
    max-width: 30ch;
    font-size: 15px;
    line-height: 1.45;
  }

  .group.done {
    margin-top: 22px;
    border-radius: var(--radius-group);
    background: var(--surface);
    overflow: hidden;
  }

  .done-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: var(--row-pad);
    border-bottom: 0.5px solid var(--separator);
  }

  .done-row:last-child {
    border-bottom: 0;
  }

  .tick {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--brand-fill);
    color: #fff;
  }

  .done-row .title {
    flex: 1;
    color: var(--label-2);
    text-decoration: line-through;
    text-decoration-color: var(--label-3);
  }

  .done-row .when {
    font-size: 13px;
    color: var(--label-2);
  }

  :global([data-platform='windows']) .home {
    max-width: 760px;
    margin: 0 auto;
    padding: 12px 28px 40px;
  }

  :global([data-platform='windows']) .sky {
    position: fixed;
    height: 260px;
    opacity: 0.75;
  }

  :global([data-platform='windows']) .round {
    border-radius: 6px;
    width: 34px;
    height: 34px;
  }

  :global([data-platform='windows']) .segments {
    background: none;
    gap: 4px;
    padding: 0;
    border-bottom: 1px solid var(--separator);
    border-radius: 0;
  }

  :global([data-platform='windows']) .segments button {
    flex: none;
    padding: 8px 12px;
    border-radius: 4px 4px 0 0;
  }

  :global([data-platform='windows']) .segments button[aria-selected='true'] {
    background: none;
    box-shadow: inset 0 -3px 0 var(--brand);
    font-weight: 600;
  }

  .top-composer {
    margin-top: 18px;
  }

  @keyframes breathe {
    50% {
      transform: scale(1.06);
    }
  }
</style>
