<script lang="ts">
  import { app } from './lib/app.svelte';
  import { isInstalled } from './lib/platform';
  import { pushState } from './lib/push';
  import Enroll from './screens/Enroll.svelte';
  import Home from './screens/Home.svelte';
  import Install from './screens/Install.svelte';
  import Notify from './screens/Notify.svelte';
  import Settings from './screens/Settings.svelte';

  let { skin }: { skin: 'ios' | 'windows' } = $props();

  const needsInstall = app.platform === 'ios' && !isInstalled();
  let askForNotifications = $state(pushState() === 'prompt');
  let screen = $state<'home' | 'settings'>('home');
</script>

{#if app.phase === 'enroll'}
  {#if needsInstall}<Install />{:else}<Enroll />{/if}
{:else if app.phase === 'ready'}
  {#if askForNotifications}
    <Notify onDone={() => (askForNotifications = false)} />
  {:else if screen === 'settings'}
    <Settings onBack={() => (screen = 'home')} />
  {:else}
    <Home {skin} onSettings={() => (screen = 'settings')} />
  {/if}
{/if}
