<script lang="ts">
  import { app } from './lib/app.svelte';
  import { OPENED, isWorkerMessage } from '../browser/messages';
  import { clearNotifications } from 'declarative-web-push/client';
  import { showNudge } from '../browser/notify';
  import { claim, settle } from '../browser/seen';
  import { isSettledTag } from '../shared/notification';
  import { lateCount } from '../shared/reminder';
  import Onboarding from './components/Onboarding.svelte';
  import TitleBar from './components/TitleBar.svelte';
  import { Fallback } from './lib/fallback';
  import { installer } from './lib/install.svelte';
  import { swap } from './lib/motion.svelte';
  import { ui } from './lib/ui.svelte';
  import Enroll from './screens/Enroll.svelte';
  import Home from './screens/Home.svelte';
  import Install from './screens/Install.svelte';
  import InstallOffer from './screens/InstallOffer.svelte';
  import Notify from './screens/Notify.svelte';
  import Settings from './screens/Settings.svelte';

  let guide = $state(installer.guide);
  let askForNotifications = $state(app.notifications === 'prompt');
  /** Set up on this device just now: once that is done, Android is offered the app. */
  let settingUp = false;
  let offerApp = $state(false);
  let screen = $state<'home' | 'settings'>('home');

  function follow(link: URLSearchParams) {
    screen = link.has('settings') ? 'settings' : 'home';
    const opening = link.get('open');
    if (opening) ui.edit(opening);
  }

  const link = new URLSearchParams(location.search);
  follow(link);
  if (link.size > 0) history.replaceState(null, '', '/');

  navigator.serviceWorker?.addEventListener('message', ({ data, ports }) => {
    if (!isWorkerMessage(data) || data.kind !== 'open') return;
    follow(new URL(data.url).searchParams);
    ports[0]?.postMessage(OPENED);
  });

  function setUpDone() {
    offerApp = settingUp && installer.welcome;
    settingUp = false;
  }

  const fallback = new Fallback({
    ready: () => navigator.serviceWorker.ready.then((registration) => (content) => showNudge(registration, content)),
    claim: (keys) => claim(keys, Date.now()),
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
    if (app.freshness !== 'synced') return;
    if ('setAppBadge' in navigator) void navigator.setAppBadge(late);
    const { reminders } = app;
    return clearNotifications(
      navigator.serviceWorker.ready,
      (tag) => app.reminders === reminders && app.freshness === 'synced' && isSettledTag(tag, reminders, Date.now()),
    );
  });

  $effect(() => {
    fallback.schedule(app.reminders, app.zone, app.notifications === 'granted' && app.freshness !== 'catching-up');
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
  {#if guide}
    <Install {guide} onContinue={() => (guide = null)} />
  {:else}
    <Enroll
      onEnrolled={() => {
        settingUp = true;
        if (!askForNotifications) setUpDone();
      }}
    />
  {/if}
{:else if app.phase === 'ready'}
  {#if askForNotifications}
    <Notify
      onDone={() => {
        askForNotifications = false;
        setUpDone();
      }}
    />
  {:else if offerApp}
    <InstallOffer onDone={() => (offerApp = false)} />
  {:else if screen === 'settings'}
    <Settings onBack={() => swap(() => (screen = 'home'), 'back')} />
  {:else}
    <Home onSettings={() => swap(() => (screen = 'settings'), 'forward')} composing={link.has('new')} />
  {/if}
{/if}
