<script lang="ts">
  import { request } from '../../browser/api';
  import { get } from '../../browser/kv';
  import type { DeviceInfo, Health } from '../../shared/api';
  import { MINUTE_MS } from '../../shared/time';
  import { ulid } from '../../shared/ulid';
  import Icon from '../components/Icon.svelte';
  import Toast from '../components/Toast.svelte';
  import { app } from '../lib/app.svelte';
  import { whenLabel } from '../lib/format';
  import { enablePush, pushState, type PushState } from '../lib/push';
  import { toasts } from '../lib/toasts.svelte';

  let { onBack }: { onBack: () => void } = $props();

  let health = $state<Health | null>(null);
  let me = $state<string | null>(null);
  let push = $state<PushState>(pushState());
  let pairing = $state<{ code: string; expiresAt: number } | null>(null);

  const PUSH_LABELS: Record<PushState, string> = {
    enabled: 'On',
    prompt: 'Off',
    denied: 'Blocked in system settings',
    unsupported: 'Not supported here',
  };

  async function load() {
    const [session, current] = await Promise.all([get('session'), request('health', null)]);
    me = session?.deviceId ?? null;
    health = current;
  }

  async function turnOn() {
    push = await enablePush();
    await load();
  }

  async function test() {
    await request('test', { id: ulid(), delay: 5 });
    toasts.show('Test coming in 5 seconds. Lock your screen to see it.');
  }

  async function pair() {
    pairing = await request('pair', null);
  }

  async function revoke(device: DeviceInfo) {
    if (!confirm(`Remove ${device.label}? It will stop getting reminders.`)) return;
    await request('revoke', { id: device.id });
    await load();
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(app.reminders, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `nudge-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  $effect(() => {
    void load();
  });
</script>

<div class="settings">
  <header>
    <button class="back" onclick={onBack}><Icon name="arrowLeft" size={18} />Back</button>
    <h1>Settings</h1>
  </header>

  <h2 class="label">Notifications</h2>
  <div class="group">
    <div class="field">
      <span>This device</span>
      <span class="value">{PUSH_LABELS[push]}</span>
    </div>
    {#if push === 'prompt'}
      <button class="field action" onclick={turnOn}>Turn on notifications</button>
    {:else if push === 'enabled'}
      <button class="field action" onclick={test}>Send a test notification</button>
    {/if}
  </div>

  <h2 class="label">Devices</h2>
  <div class="group">
    {#each health?.devices ?? [] as device (device.id)}
      <div class="field">
        <span>
          {device.label}{#if device.id === me}<span class="me"> · this device</span>{/if}
          <small>
            {device.push.enabled ? 'Notifications on' : 'Notifications off'}{#if device.push.receiptAt}
              · last delivered {whenLabel(device.push.receiptAt, app.now, app.zone)}{/if}
          </small>
        </span>
        {#if device.id !== me}
          <button class="remove" onclick={() => revoke(device)} aria-label={`Remove ${device.label}`}>Remove</button>
        {/if}
      </div>
    {/each}
    {#if pairing && pairing.expiresAt > app.now}
      <div class="field pairing">
        <span class="code">{pairing.code.slice(0, 3)} {pairing.code.slice(3)}</span>
        <small>
          Enter this on the new device. It works once, for {Math.max(
            1,
            Math.round((pairing.expiresAt - app.now) / MINUTE_MS),
          )} more minutes.
        </small>
      </div>
    {:else}
      <button class="field action" onclick={pair}>Add a device</button>
    {/if}
  </div>

  <h2 class="label">Data</h2>
  <div class="group">
    <button class="field action" onclick={exportData}>Export reminders</button>
  </div>
  <p class="footer">Nudge · {location.host}</p>
  <Toast />
</div>

<style>
  .settings {
    max-width: 560px;
    min-height: 100dvh;
    margin: 0 auto;
    padding: calc(env(safe-area-inset-top) + 16px) 18px calc(env(safe-area-inset-bottom) + 40px);
    animation: rise 0.4s var(--ease) both;
  }

  .back {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 40px;
    margin-left: -4px;
    color: var(--ink-2);
  }

  h1 {
    margin: 8px 0 0;
    font-size: 26px;
    font-weight: 600;
    letter-spacing: -0.02em;
  }

  h2 {
    margin: 26px 2px 8px;
  }

  .me {
    color: var(--muted);
  }

  .remove {
    color: var(--accent);
    font-size: 14px;
  }

  .pairing {
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    padding: 16px 14px;
  }

  .code {
    font-size: 34px;
    font-weight: 600;
    letter-spacing: 0.08em;
    font-variant-numeric: tabular-nums;
  }

  .footer {
    margin: 26px 0 0;
    color: var(--muted);
    font-size: 13px;
    text-align: center;
  }
</style>
