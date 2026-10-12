<script lang="ts">
  import { app } from './lib/app.svelte';
  import { showUnlessOnScreen } from '../browser/notify';
  import { claim, settle } from '../browser/seen';
  import { lateCount } from '../shared/reminder';
  import Onboarding from './components/Onboarding.svelte';
  import TitleBar from './components/TitleBar.svelte';
  import { Fallback } from './lib/fallback';
  import { installer } from './lib/install.svelte';
  import { ui } from './lib/ui.svelte';
  import Enroll from './screens/Enroll.svelte';
  import Home from './screens/Home.svelte';
  import Install from './screens/Install.svelte';
  import Notify from './screens/Notify.svelte';
  import Settings from './screens/Settings.svelte';

  let guide = $state(installer.guide);
  let askForNotifications = $state(app.notifications === 'prompt');
  const link = new URLSearchParams(location.search);
  let screen = $state<'home' | 'settings'>(link.has('settings') ? 'settings' : 'home');
  const opening = link.get('open');
  if (opening) ui.edit(opening);
  if (link.size > 0) history.replaceState(null, '', '/');

  const fallback = new Fallback({
    ready: () =>
      navigator.serviceWorker.ready.then((registration) => (content) => showUnlessOnScreen(registration, content)),
    claim: (fire) => claim(fire, Date.now()),
    settle,
    wait: (run, ms) => {
      const timer = setTimeout(() => void run(), ms);
      return () => clearTimeout(timer);
    },
    now: () => Date.now(),
    origin: location.origin,
    locale: navigator.language,
  });

  const late = $derived(lateCount(app.reminders, app.now, app.zone));

  // Pushes badge the icon as they arrive; only a replica synced in this foreground knows better than the latest push.
  $effect(() => {
    if (app.freshness === 'synced' && 'setAppBadge' in navigator) void navigator.setAppBadge(late);
  });

  $effect(() => {
    fallback.schedule(app.reminders, app.zone, app.notifications === 'enabled' && app.freshness !== 'catching-up');
  });
</script>

<TitleBar />

{#if app.phase === 'failed'}
  <Onboarding
    title="Nudge can't open its storage"
    tagline="Your browser blocked or lost Nudge's local data. Close other Nudge windows and try again."
  >
    <button class="btn primary block" onclick={() => location.reload()}>Try again</button>
  </Onboarding>
{:else if app.phase === 'enroll'}
  {#if guide}<Install {guide} onContinue={() => (guide = null)} />{:else}<Enroll />{/if}
{:else if app.phase === 'ready'}
  {#if askForNotifications}
    <Notify onDone={() => (askForNotifications = false)} />
  {:else if screen === 'settings'}
    <Settings onBack={() => (screen = 'home')} />
  {:else}
    <Home onSettings={() => (screen = 'settings')} composing={link.has('new')} />
  {/if}
{/if}
