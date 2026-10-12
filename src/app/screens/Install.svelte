<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import Onboarding from '../components/Onboarding.svelte';
  import type { Guide } from '../lib/install.svelte';

  let { guide, onContinue }: { guide: Guide; onContinue: () => void } = $props();

  const GUIDES = {
    ios: {
      title: 'Add Nudge to your Home Screen',
      tagline: 'iPhone only delivers notifications to apps on the Home Screen.',
      press: 'Tap',
      where: 'in Safari',
      add: 'Add to Home Screen',
      home: 'your Home Screen',
      skip: null,
    },
    mac: {
      title: 'Add Nudge to your Dock',
      tagline:
        'Nudge works best as its own app. Add it before you enter your code, since it won’t share Safari’s data.',
      press: 'Click',
      where: 'in Safari’s toolbar',
      add: 'Add to Dock',
      home: 'the Dock',
      skip: 'Continue in Safari',
    },
  } as const;

  const { title, tagline, press, where, add, home, skip } = $derived(GUIDES[guide]);
</script>

<Onboarding {title} {tagline}>
  <ol class="group">
    <li class="field">
      <span>{press} <Icon name="share" size={17} /><span class="sr-only">Share</span> {where}</span><span class="value"
        >1</span
      >
    </li>
    <li class="field"><span>Choose <b>{add}</b></span><span class="value">2</span></li>
    <li class="field"><span>Open Nudge from {home}</span><span class="value">3</span></li>
  </ol>
  {#if skip}<button class="link quiet" onclick={onContinue}>{skip}</button>{/if}
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
