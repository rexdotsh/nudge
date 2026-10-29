<script lang="ts">
  import { request } from '../../browser/api';
  import { ulid } from '../../shared/ulid';
  import { toasts } from '../lib/toasts.svelte';

  let { attempt, onCreated }: { attempt: (action: () => Promise<void>) => Promise<boolean>; onCreated: () => void } =
    $props();

  type Step = { kind: 'idle' } | { kind: 'naming'; id: string } | { kind: 'created'; name: string; env: string };

  let step = $state<Step>({ kind: 'idle' });
  let name = $state('');
  let busy = $state(false);

  async function create(event: SubmitEvent) {
    event.preventDefault();
    if (step.kind !== 'naming' || name.trim() === '') return;
    const { id } = step;
    busy = true;
    await attempt(async () => {
      const { token } = await request('agent', { id, name: name.trim() });
      step = { kind: 'created', name: name.trim(), env: `NUDGE_URL=${location.origin}\nNUDGE_TOKEN=${token}` };
      onCreated();
    });
    busy = false;
  }

  async function copy(env: string) {
    await navigator.clipboard.writeText(env);
    toasts.show('Copied');
  }

  function done() {
    step = { kind: 'idle' };
    name = '';
  }
</script>

{#if step.kind === 'idle'}
  <button class="field action" onclick={() => (step = { kind: 'naming', id: ulid() })}>
    <span>Connect an agent<small>Let an assistant like Claude read and add your reminders</small></span>
  </button>
{:else if step.kind === 'naming'}
  <form class="field stacked" onsubmit={create}>
    <span>Name it after the agent that will use it</span>
    <div class="row">
      <input
        {@attach (node) => node.focus()}
        class="input"
        bind:value={name}
        maxlength="40"
        placeholder="Claude, opencode…"
        aria-label="Agent name"
      />
      <button class="btn primary" type="submit" disabled={busy || name.trim() === ''}>Create</button>
    </div>
    <button class="link quiet cancel" type="button" onclick={done}>Cancel</button>
  </form>
{:else}
  {@const { name: agent, env } = step}
  <div class="field stacked">
    <span>{agent} is connected<small>Set these where it runs. The token is shown only now.</small></span>
    <pre class="env">{env}</pre>
    <small
      >Add the skill with <span class="command">npx skills add rexdotsh/nudge</span>. Remove {agent} under Devices to revoke
      it.</small
    >
    <div class="row end">
      <button class="link quiet" onclick={done}>Done</button>
      <button class="btn primary" onclick={() => void copy(env)}>Copy</button>
    </div>
  </div>
{/if}

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .row .input {
    flex: 1;
  }

  .end {
    justify-content: flex-end;
    gap: 16px;
  }

  .cancel {
    align-self: flex-start;
    font-size: 14px;
  }

  .env {
    margin: 0;
    padding: 12px 14px;
    border-radius: 12px;
    background: var(--bg);
    box-shadow: inset 0 0 0 1px var(--edge);
    color: var(--ink);
    font: inherit;
    font-size: 13.5px;
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    user-select: all;
  }

  .command {
    color: var(--ink-2);
  }
</style>
