<script lang="ts">
  import Icon from '../components/Icon.svelte';
</script>

<div class="onboarding">
  <img class="icon" src="/icons/apple-touch-icon.png" alt="" width="96" height="96" />
  <h1>Nudge</h1>
  <p class="lede">Reminders that actually reach you.</p>

  <ol class="steps">
    <li>
      <span class="badge">1</span>
      <span>Tap <span class="inline"><Icon name="share" size={18} /></span> in Safari's toolbar.</span>
    </li>
    <li>
      <span class="badge">2</span>
      <span
        >Choose <strong>Add to Home Screen</strong> <span class="inline"><Icon name="addBox" size={18} /></span></span
      >
    </li>
    <li>
      <span class="badge">3</span>
      <span>Open <strong>Nudge</strong> from your Home Screen.</span>
    </li>
  </ol>
  <p class="note">
    iPhone only delivers notifications to apps on the Home Screen, so this step is what makes reminders reach you.
  </p>
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

  .icon {
    border-radius: 22px;
    box-shadow: 0 18px 40px -12px color-mix(in oklab, var(--brand) 55%, transparent);
    animation: float 5s ease-in-out infinite;
  }

  h1 {
    margin: 22px 0 4px;
    font: 700 34px var(--font-display);
    letter-spacing: -0.02em;
  }

  .lede {
    margin: 0 0 32px;
    color: var(--label-2);
  }

  .steps {
    list-style: none;
    margin: 0;
    padding: 6px 0;
    width: min(100%, 360px);
    text-align: left;
    background: var(--surface);
    border-radius: 22px;
  }

  .steps li {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 18px;
    border-bottom: 0.5px solid var(--separator);
  }

  .steps li:last-child {
    border-bottom: 0;
  }

  .badge {
    flex: none;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-weight: 600;
    font-size: 15px;
    color: #fff;
    background: var(--brand-fill);
  }

  .inline {
    display: inline-flex;
    vertical-align: -3px;
    color: #0a84ff;
  }

  .note {
    margin: 22px 0 0;
    max-width: 34ch;
    font-size: 14px;
    color: var(--label-2);
  }

  @keyframes float {
    50% {
      transform: translateY(-6px);
    }
  }
</style>
