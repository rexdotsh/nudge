<script lang="ts">
  import Onboarding from '../components/Onboarding.svelte';
  import { app } from '../lib/app.svelte';
  import { UNBLOCK_STEPS } from '../lib/push';

  let { onDone }: { onDone: () => void } = $props();

  let busy = $state(false);

  async function enable() {
    busy = true;
    try {
      if ((await app.enableNotifications()) === 'granted') onDone();
    } finally {
      busy = false;
    }
  }
</script>

<Onboarding
  title="Turn on notifications"
  tagline={app.notifications === 'denied'
    ? `Notifications are blocked for Nudge. ${UNBLOCK_STEPS[app.platform]}`
    : 'Nudge only notifies you about reminders you set, right when they are due.'}
>
  <button class="btn primary block" onclick={enable} disabled={busy || app.notifications === 'denied'}>
    {busy ? '…' : 'Turn on notifications'}
  </button>
  <button class="link quiet" onclick={onDone}>Not now</button>
</Onboarding>
