<script lang="ts">
  import Icon from '../components/Icon.svelte';
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

<div class="onboarding">
  <div class="bell"><Icon name="bell" size={42} /></div>
  <h1>Never miss one</h1>
  {#if status === 'denied'}
    <p class="lede">Notifications are turned off for Nudge. Turn them on in your device's settings, then come back.</p>
  {:else}
    <p class="lede">Nudge only notifies you about reminders you set, right when they're due.</p>
  {/if}
  <button class="primary" onclick={enable} disabled={busy || status === 'denied'}>
    {busy ? 'Waiting…' : 'Turn on notifications'}
  </button>
  <button class="secondary" onclick={onDone}>Not now</button>
</div>

<style>
  .onboarding {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: calc(40px + env(safe-area-inset-top)) 28px calc(40px + env(safe-area-inset-bottom));
    text-align: center;
    background: radial-gradient(80% 50% at 50% 0%, var(--brand-soft), transparent 70%), var(--bg);
  }

  .bell {
    width: 104px;
    height: 104px;
    border-radius: 30px;
    display: grid;
    place-items: center;
    color: #fff;
    background: linear-gradient(145deg, #ff9a4d, var(--brand) 60%, #ff3b47);
    box-shadow: 0 18px 40px -12px color-mix(in oklab, var(--brand) 60%, transparent);
    animation: ring 2.8s var(--ease) infinite;
    transform-origin: 50% 20%;
  }

  h1 {
    margin: 24px 0 6px;
    font: 700 30px var(--font-display);
    letter-spacing: -0.02em;
  }

  .lede {
    margin: 0 0 30px;
    max-width: 32ch;
    color: var(--label-2);
    font-size: 15px;
    line-height: 1.45;
  }

  .primary {
    width: min(100%, 360px);
    padding: 15px;
    border-radius: 14px;
    background: var(--brand-fill);
    color: #fff;
    font-weight: 600;
  }

  .primary:disabled {
    opacity: 0.4;
  }

  .secondary {
    margin-top: 14px;
    padding: 8px 16px;
    color: var(--label-2);
    font-size: 15px;
  }

  @keyframes ring {
    0%,
    60%,
    100% {
      rotate: 0deg;
    }
    66% {
      rotate: -12deg;
    }
    74% {
      rotate: 10deg;
    }
    82% {
      rotate: -6deg;
    }
    90% {
      rotate: 3deg;
    }
  }
</style>
