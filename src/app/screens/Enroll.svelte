<script lang="ts">
  import { ApiRejected, Unreachable } from '../../browser/api';
  import Onboarding from '../components/Onboarding.svelte';
  import { app } from '../lib/app.svelte';

  let code = $state('');
  let busy = $state(false);
  let error = $state('');

  const value = $derived(code.replace(/\s/g, ''));
  const isPairCode = $derived(/^\d{6}$/.test(value));

  const MESSAGES: Record<string, string> = {
    forbidden: "That code didn't work.",
    locked: 'Too many tries. Wait 15 minutes.',
    bad_request: "That isn't a Nudge code.",
  };

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = '';
    try {
      await app.enroll(isPairCode ? 'join' : 'setup', value);
    } catch (failure) {
      if (failure instanceof ApiRejected) error = MESSAGES[failure.code] ?? 'Something went wrong.';
      else if (failure instanceof Unreachable) error = "Can't reach Nudge. Check your connection.";
      else throw failure;
    } finally {
      busy = false;
    }
  }
</script>

<Onboarding
  title="Welcome to Nudge"
  tagline="Enter your setup code. Adding another device? Use the 6 digits from Settings on the first one."
>
  <form onsubmit={submit}>
    <input
      class="input"
      bind:value={code}
      placeholder="Code"
      autocapitalize="characters"
      autocomplete="one-time-code"
      spellcheck="false"
      aria-label="Setup or pairing code"
      aria-invalid={error !== ''}
      aria-describedby="enroll-error"
    />
    <button class="btn primary" type="submit" disabled={busy || value.length < 6}>Continue</button>
  </form>
  <p id="enroll-error" class="error" role="alert">{error}</p>
</Onboarding>

<style>
  form {
    display: flex;
    gap: 8px;
  }

  .input {
    flex: 1;
    letter-spacing: 0.04em;
  }

  .btn {
    height: 46px;
  }

  .error {
    min-height: 1.45em;
    margin: 10px 2px 0;
    color: var(--accent);
    font-size: 14px;
  }
</style>
