<script lang="ts">
  import { ApiRejected, Unreachable } from '../../browser/api';
  import { app } from '../lib/app.svelte';

  let code = $state('');
  let busy = $state(false);
  let error = $state('');

  const isPairCode = $derived(/^\d{6}$/.test(code.replace(/\s/g, '')));

  const MESSAGES: Record<string, string> = {
    forbidden: "That code didn't work. Check it and try again.",
    locked: 'Too many tries. Wait 15 minutes and try again.',
    bad_request: "That doesn't look like a Nudge code.",
  };

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = '';
    const value = code.replace(/\s/g, '');
    try {
      await app.enroll(isPairCode ? 'join' : 'setup', value);
    } catch (failure) {
      if (failure instanceof ApiRejected) error = MESSAGES[failure.code] ?? 'Something went wrong.';
      else if (failure instanceof Unreachable) error = "Can't reach Nudge right now. Check your connection.";
      else throw failure;
    } finally {
      busy = false;
    }
  }
</script>

<form class="onboarding" onsubmit={submit}>
  <img class="icon" src="/icons/apple-touch-icon.png" alt="" width="72" height="72" />
  <h1>Welcome</h1>
  <p class="lede">
    Enter your setup code. To add this device to an existing Nudge, use the 6-digit code from <strong
      >Settings → Add a device</strong
    > on the other one.
  </p>

  <input
    class="code"
    bind:value={code}
    placeholder={isPairCode ? '000000' : 'XXXX-XXXX-XXXX-XXXX'}
    autocapitalize="characters"
    autocomplete="one-time-code"
    spellcheck="false"
    aria-label="Setup or pairing code"
    aria-invalid={error !== ''}
  />
  <p class="error" role="alert">{error}</p>

  <button class="primary" type="submit" disabled={busy || code.trim().length < 6}>
    {busy ? 'Connecting…' : isPairCode ? 'Add this device' : 'Set up Nudge'}
  </button>
</form>

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

  .icon {
    border-radius: 17px;
  }

  h1 {
    margin: 18px 0 6px;
    font: 700 34px var(--font-display);
    letter-spacing: -0.02em;
  }

  .lede {
    margin: 0 0 28px;
    max-width: 36ch;
    color: var(--label-2);
    font-size: 15px;
    line-height: 1.45;
  }

  .code {
    width: min(100%, 360px);
    padding: 16px;
    border: 0;
    border-radius: 16px;
    background: var(--surface);
    text-align: center;
    font:
      600 22px/1 ui-monospace,
      'SF Mono',
      'Cascadia Mono',
      monospace;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    box-shadow: inset 0 0 0 1px var(--separator);
    outline: none;
  }

  .code:focus {
    box-shadow: inset 0 0 0 2px var(--brand);
  }

  .error {
    min-height: 1.4em;
    margin: 10px 0 18px;
    color: var(--danger);
    font-size: 14px;
  }

  .primary {
    width: min(100%, 360px);
    padding: 15px;
    border-radius: 14px;
    background: var(--brand-fill);
    color: #fff;
    font-weight: 600;
    transition:
      opacity 0.2s,
      transform 0.2s var(--spring);
  }

  .primary:disabled {
    opacity: 0.4;
  }

  .primary:active:not(:disabled) {
    transform: scale(0.98);
  }
</style>
