<script lang="ts">
  import { app } from './lib/app.svelte';
  import { fallback } from './lib/fallback';
  import { ui } from './lib/ui.svelte';
  import { isInstalled } from './lib/platform';
  import { pushState } from './lib/push';
  import Enroll from './screens/Enroll.svelte';
  import Home from './screens/Home.svelte';
  import Install from './screens/Install.svelte';
  import Notify from './screens/Notify.svelte';
  import Settings from './screens/Settings.svelte';

  const needsInstall = app.platform === 'ios' && !isInstalled();
  let askForNotifications = $state(pushState() === 'prompt');
  const link = new URLSearchParams(location.search);
  let screen = $state<'home' | 'settings'>(link.has('settings') ? 'settings' : 'home');
  const opening = link.get('open');
  if (opening) ui.edit(opening);
  if (link.size > 0) history.replaceState(null, '', '/');

  $effect(() => {
    fallback.schedule(app.reminders, app.zone);
  });
</script>

{#if app.phase === 'enroll'}
  {#if needsInstall}<Install />{:else}<Enroll />{/if}
{:else if app.phase === 'ready'}
  {#if askForNotifications}
    <Notify onDone={() => (askForNotifications = false)} />
  {:else if screen === 'settings'}
    <Settings onBack={() => (screen = 'home')} />
  {:else}
    <Home onSettings={() => (screen = 'settings')} composing={link.has('new')} />
  {/if}
{/if}
