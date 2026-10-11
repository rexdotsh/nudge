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
    unsupported: 'Not supported in this browser',
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
    <button class="back" onclick={onBack}><Icon name="arrowLeft" size={22} />Back</button>
    <h1>Settings</h1>
  </header>

  <h2>Notifications</h2>
  <div class="group">
    <div class="row">
      <span class="label"><Icon name="bell" size={18} />This device</span>
      <span class="value" class:good={push === 'enabled'}>{PUSH_LABELS[push]}</span>
    </div>
    {#if push === 'prompt'}
      <button class="row action" onclick={turnOn}>Turn on notifications</button>
    {:else if push === 'enabled'}
      <button class="row action" onclick={test}>Send a test notification</button>
    {/if}
  </div>

  <h2>Devices</h2>
  <div class="group">
    {#each health?.devices ?? [] as device (device.id)}
      <div class="row">
        <span class="label">
          <Icon name="device" size={18} />
          <span class="stack">
            <span>{device.label}{device.id === me ? ' · this device' : ''}</span>
            <small>
              {device.push.enabled ? 'Notifications on' : 'Notifications off'}
              {#if device.push.receiptAt}· last delivered {whenLabel(device.push.receiptAt, app.now, app.zone)}{/if}
            </small>
          </span>
        </span>
        {#if device.id !== me}
          <button class="remove" onclick={() => revoke(device)} aria-label={`Remove ${device.label}`}
            ><Icon name="trash" size={16} /></button
          >
        {/if}
      </div>
    {/each}
    {#if pairing && pairing.expiresAt > app.now}
      <div class="row pairing">
        <span class="code">{pairing.code.slice(0, 3)} {pairing.code.slice(3)}</span>
        <small
          >Enter this on the new device. It works once, for {Math.max(
            1,
            Math.round((pairing.expiresAt - app.now) / MINUTE_MS),
          )} more minutes.</small
        >
      </div>
    {:else}
      <button class="row action" onclick={pair}>Add a device</button>
    {/if}
  </div>

  <h2>Data</h2>
  <div class="group">
    <button class="row action" onclick={exportData}>Export reminders</button>
  </div>
  <p class="footer">Nudge · {location.host}</p>
  <Toast />
</div>

<style>
  .settings {
    min-height: 100dvh;
    padding: calc(8px + env(safe-area-inset-top)) 16px calc(40px + env(safe-area-inset-bottom));
  }

  header {
    padding-top: 6px;
  }

  .back {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    margin-left: -6px;
    padding: 8px 6px;
    color: var(--brand-text);
    font-size: 17px;
  }

  h1 {
    margin: 4px 4px 8px;
    font: var(--title-weight) var(--title-size) / 1.1 var(--font-display);
    letter-spacing: -0.02em;
  }

  h2 {
    margin: 26px 16px 7px;
    font-size: 13px;
    font-weight: 400;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    color: var(--label-2);
  }

  .group {
    border-radius: var(--radius-group);
    background: var(--surface);
    overflow: hidden;
  }

  .row {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 48px;
    padding: 10px 16px;
    text-align: left;
    border-bottom: 0.5px solid var(--separator);
  }

  .row:last-child {
    border-bottom: 0;
  }

  .label {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .stack {
    display: flex;
    flex-direction: column;
  }

  small {
    color: var(--label-2);
    font-size: 13px;
  }

  .value {
    color: var(--label-2);
    font-size: 15px;
  }

  .value.good {
    color: var(--success);
  }

  .action {
    color: var(--brand-text);
  }

  .remove {
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    color: var(--danger);
  }

  .pairing {
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 18px 16px;
  }

  .code {
    font:
      700 36px/1 ui-monospace,
      'SF Mono',
      'Cascadia Mono',
      monospace;
    letter-spacing: 0.12em;
    color: var(--brand-text);
  }

  .footer {
    margin: 22px 16px 0;
    color: var(--label-2);
    font-size: 13px;
    text-align: center;
  }

  :global([data-platform='windows']) .settings {
    max-width: 760px;
    margin: 0 auto;
    padding: 12px 28px 40px;
  }

  :global([data-platform='windows']) .group {
    box-shadow: 0 0 0 1px var(--separator);
  }

  :global([data-platform='windows']) h2 {
    text-transform: none;
    font-size: 14px;
    font-weight: 600;
    color: var(--label);
    margin: 22px 2px 8px;
  }
</style>
