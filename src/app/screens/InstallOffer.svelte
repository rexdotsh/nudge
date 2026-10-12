<script lang="ts">
  import Onboarding from '../components/Onboarding.svelte';
  import { installer } from '../lib/install.svelte';

  let { onDone }: { onDone: () => void } = $props();

  async function install() {
    await installer.prompt();
    onDone();
  }
</script>

<Onboarding
  title="Add Nudge to your home screen"
  tagline="It opens like any other app, from its own icon, with everything you set up here."
>
  <button class="btn primary block" onclick={install}>Install</button>
  <button class="link quiet" onclick={onDone}>Not now</button>
</Onboarding>
