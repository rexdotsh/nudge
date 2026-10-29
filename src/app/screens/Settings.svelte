<script lang="ts">
  import { Unreachable, request, windowsInstaller } from '../../browser/api';
  import type { DeviceInfo } from '../../shared/api';
  import { MINUTE_MS } from '../../shared/time';
  import { ulid } from '../../shared/ulid';
  import AgentConnect from '../components/AgentConnect.svelte';
  import Icon from '../components/Icon.svelte';
  import Toast from '../components/Toast.svelte';
  import ThemeOptions from '../components/ThemeOptions.svelte';
  import { app } from '../lib/app.svelte';
  import { whenLabel, zoneLabel } from '../lib/format';
  import { closeOnBack } from '../lib/close';
  import { installer, type Prompted } from '../lib/install.svelte';
  import type { PushPermission } from 'declarative-web-push/client';
  import { UNBLOCK_STEPS } from '../lib/push';
  import { composing } from '../lib/shortcuts';
  import { toasts } from '../lib/toasts.svelte';

  let { onBack }: { onBack: () => void } = $props();

  let pairing = $state<{ code: string; expiresAt: number } | null>(null);
  let devicesFailed = $state(false);

  const APPS: Record<Prompted, { title: string; install: string; detail: string }> = {
    mac: { title: 'Mac app', install: 'Install the Mac app', detail: 'Nudge opens in its own window, from the Dock.' },
    android: {
      title: 'Android app',
      install: 'Install the Android app',
      detail: 'Nudge opens from its own icon on your home screen.',
    },
  };

  const PUSH_LABELS: Record<PushPermission, string> = {
    granted: 'On',
    prompt: 'Off',
    denied: 'Blocked',
    unsupported: 'Not supported here',
  };

  async function attempt(action: () => Promise<void>) {
    try {
      await action();
      return true;
    } catch (error) {
      if (!(error instanceof Unreachable)) throw error;
      toasts.show("Can't reach Nudge. Check your connection.");
      return false;
    }
  }

  async function load() {
    devicesFailed = !(await attempt(() => app.refreshHealth()));
  }

  const turnOn = () =>
    attempt(async () => {
      await app.enableNotifications();
      await load();
    });

  const test = () =>
    attempt(async () => {
      await request('test', { id: ulid(), delay: 5 });
      toasts.show('Test coming in 5 seconds. Lock your screen to see it.');
    });

  const pair = () =>
    attempt(async () => {
      pairing = await request('pair', null);
    });

  function revoke(device: DeviceInfo) {
    const effect = device.kind === 'agent' ? 'Its token will stop working.' : 'It will stop getting reminders.';
    if (!confirm(`Remove ${device.label}? ${effect}`)) return;
    void attempt(async () => {
      await request('revoke', { id: device.id });
      await load();
    });
  }

  function status(device: DeviceInfo): string {
    if (device.kind === 'agent') {
      return device.usedAt
        ? `Agent · last used ${whenLabel(device.usedAt, app.now, app.zone)}`
        : 'Agent · not used yet';
    }
    const { push } = device;
    const state = push.enabled ? 'Notifications on' : 'Notifications off';
    return push.receiptAt ? `${state} · last delivered ${whenLabel(push.receiptAt, app.now, app.zone)}` : state;
  }

  function saveFile(blob: Blob, name: string) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(app.reminders, null, 2)], { type: 'application/json' });
    saveFile(blob, `nudge-${new Date().toISOString().slice(0, 10)}.json`);
  }

  let preparing = $state(false);

  async function downloadInstaller() {
    preparing = true;
    try {
      saveFile(await windowsInstaller(), 'Nudge for Windows.zip');
    } catch (error) {
      if (!(error instanceof Unreachable)) throw error;
      toasts.show("Couldn't prepare the Windows app. Try again in a minute.");
    } finally {
      preparing = false;
    }
  }

  $effect(() => {
    void load();
  });

  $effect(() => closeOnBack(onBack));

  function escape(event: KeyboardEvent) {
    if (event.key !== 'Escape' || composing(event)) return;
    event.preventDefault();
    onBack();
  }
</script>

<svelte:window onkeydown={escape} />

<div class="page settings">
  <header>
    <button class="back press" onclick={onBack}><Icon name="arrowLeft" size={18} />Back</button>
    <h1 class="heading large">Settings</h1>
  </header>

  <h2 class="label">Notifications</h2>
  <div class="group">
    <div class="field">
      <span>This device</span>
      <span class="value">{PUSH_LABELS[app.notifications]}</span>
    </div>
    {#if app.notifications === 'prompt'}
      <button class="field action" onclick={turnOn}>Turn on notifications</button>
    {:else if app.notifications === 'denied'}
      <div class="field"><small>{UNBLOCK_STEPS[app.platform]}</small></div>
    {:else if app.notifications === 'granted'}
      <button class="field action" onclick={test}>Send a test notification</button>
    {/if}
  </div>

  <h2 class="label">Time zone</h2>
  <div class="group">
    <div class="field">
      <span>Reminders follow you<small>Times move with you when you travel</small></span>
      <span class="value">{zoneLabel(app.zone, app.now)}</span>
    </div>
    <label class="field">
      <span>Time zone per reminder<small>Let a reminder keep one time zone wherever you are</small></span>
      <input
        class="toggle"
        type="checkbox"
        checked={app.zoneControls}
        onchange={(event) => void app.showZoneControls(event.currentTarget.checked)}
      />
    </label>
  </div>

  <h2 class="label">Devices</h2>
  <div class="group">
    {#if devicesFailed && app.health === null}
      <div class="field">
        <span>Can't reach Nudge right now</span>
        <button class="link" onclick={load}>Try again</button>
      </div>
    {/if}
    {#each app.health?.devices ?? [] as device (device.id)}
      <div class="field">
        <span>
          {device.label}{#if device.id === app.deviceId}<span class="me">{' · this device'}</span>{/if}
          <small>{status(device)}</small>
        </span>
        {#if device.id !== app.deviceId}
          <button class="link remove" onclick={() => revoke(device)} aria-label={`Remove ${device.label}`}
            >Remove</button
          >
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

  {#if app.platform === 'windows'}
    <h2 class="label">Windows app</h2>
    <div class="group">
      <button class="field action" onclick={downloadInstaller} disabled={preparing}>
        <span>
          {preparing ? 'Preparing the Windows app…' : 'Download the Windows app'}
          <small>Extract it and run “Install Nudge.cmd”. Needs Windows 11.</small>
        </span>
      </button>
    </div>
  {/if}

  {#if installer.target && installer.route}
    {@const { title, install, detail } = APPS[installer.target]}
    <h2 class="label">{title}</h2>
    <div class="group">
      {#if installer.route === 'prompt'}
        <button class="field action" onclick={() => void installer.prompt()}>
          <span>{install}<small>{detail}</small></span>
        </button>
      {:else}
        <div class="field">
          <span>
            Add Nudge to your Dock
            <small
              >In Safari, click Share, then Add to Dock. Open it, enter a code from Add a device, then remove the old
              Mac from Devices.</small
            >
          </span>
        </div>
      {/if}
    </div>
  {/if}

  <h2 class="label" id="theme-heading">Theme</h2>
  <div class="group" role="radiogroup" aria-labelledby="theme-heading">
    <ThemeOptions />
  </div>

  <h2 class="label">Agents</h2>
  <div class="group">
    <AgentConnect {attempt} onCreated={() => void load()} />
  </div>

  <h2 class="label">Data</h2>
  <div class="group">
    <button class="field action" onclick={exportData}>Export reminders</button>
  </div>
  <p class="footer">
    Nudge · {location.host} ·
    <a class="commit" href="https://github.com/rexdotsh/nudge/commit/{NUDGE_COMMIT}" target="_blank" rel="noreferrer"
      >{NUDGE_COMMIT.slice(0, 7)}</a
    >
  </p>
</div>
<Toast />

<style>
  .back {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 40px;
    margin-left: -4px;
    color: var(--ink-2);
  }

  h1 {
    margin-top: 8px;
  }

  h2 {
    margin: 26px 2px 8px;
  }

  .me {
    color: var(--muted);
  }

  .remove {
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

  .commit {
    color: inherit;
    font-variant-numeric: tabular-nums;
    text-decoration: none;
  }

  .commit:hover {
    text-decoration: underline;
  }
</style>
