<script lang="ts">
  import Onboarding from '../components/Onboarding.svelte';
  import { enablePush, pushState, type PushState } from '../lib/push';

  let { onDone }: { onDone: () => void } = $props();

  let status = $state<PushState>(pushState());
  let busy = $state(false);

  async function enable() {
    busy = true;
    try {
      status = await enablePush();
      if (status === 'enabled') onDone();
    } finally {
      busy = false;
    }
  }
</script>

<Onboarding
  title="Turn on notifications"
  tagline={status === 'denied'
    ? "Notifications are off for Nudge. Turn them on in your device's settings, then come back."
    : 'Nudge only notifies you about reminders you set, right when they are due.'}
>
  <button class="btn primary block" onclick={enable} disabled={busy || status === 'denied'}>
    {busy ? '…' : 'Turn on notifications'}
  </button>
  <button class="later" onclick={onDone}>Not now</button>
</Onboarding>

<style>
  .later {
    margin-top: 14px;
    padding: 8px;
    color: var(--muted);
  }
</style>
