<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import Onboarding from '../components/Onboarding.svelte';
</script>

<Onboarding
  title="Add Nudge to your Home Screen"
  tagline="iPhone only delivers notifications to apps on the Home Screen."
>
  <ol class="group">
    <li class="field"><span>Tap <Icon name="share" size={17} /> in Safari</span><span class="value">1</span></li>
    <li class="field"><span>Choose <b>Add to Home Screen</b></span><span class="value">2</span></li>
    <li class="field"><span>Open Nudge from your Home Screen</span><span class="value">3</span></li>
  </ol>
</Onboarding>

<style>
  ol {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li span:first-child {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  b {
    font-weight: 600;
  }
</style>
