<script lang="ts">
  import { LIMITS } from '../../shared/input';
  import { parseQuickAdd, suggestedStart } from '../../shared/quick-add';
  import { local } from '../../shared/reminder';
  import { toInstant } from '../../shared/time';
  import { add } from '../lib/actions';
  import { NEW_REMINDER, hint } from '../lib/shortcuts';
  import { app } from '../lib/app.svelte';
  import { repeatLabel, summaryWhen } from '../lib/format';
  import { ui } from '../lib/ui.svelte';
  import HighlightedInput from './HighlightedInput.svelte';
  import ComposerSummary from './ComposerSummary.svelte';

  let { autofocus = false }: { autofocus?: boolean } = $props();

  const LIFTED_TOP = 72;
  const SETTLE_MS = 900;

  let input: HTMLInputElement | undefined = $state();
  let visibleBottom = $state(window.innerHeight);
  let lift = $state(0);

  const parsed = $derived(ui.composing.trim() === '' ? null : parseQuickAdd(ui.composing, app.now, app.zone));
  const start = $derived(parsed ? (parsed.start ?? suggestedStart(app.now, app.zone)) : null);
  const when = $derived(start ? summaryWhen(toInstant(local(start), app.zone), app.now, app.zone) : '');
  const cadence = $derived(parsed?.repeat && start ? repeatLabel(parsed.repeat, start, app.zone) : null);
  const important = $derived(parsed?.important ?? false);
  const summary = $derived([when, cadence, important ? 'important' : null].filter(Boolean).join(', '));

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (await add(ui.composing)) ui.composing = '';
    input?.focus();
  }

  // iOS pans instead of shrinking the layout for its keyboard; anchor to the visible bottom and undo the pan.
  $effect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      if (document.activeElement === input && viewport.offsetTop > 0) window.scrollTo(0, 0);
      visibleBottom = viewport.offsetTop + viewport.height;
    };
    const resized = () => {
      settle();
      update();
    };
    update();
    viewport.addEventListener('resize', resized);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', resized);
      viewport.removeEventListener('scroll', update);
    };
  });

  // Lift the iOS input before focus so Safari has no reason to pan; the mirror stays in place until the keyboard opens.
  function liftForKeyboard(event: PointerEvent) {
    if (app.platform !== 'ios' || event.pointerType !== 'touch' || !input || document.activeElement === input) return;
    lift = input.getBoundingClientRect().top - LIFTED_TOP;
  }

  function focusLifted() {
    if (lift !== 0) input?.focus({ preventScroll: true });
  }

  function settle() {
    lift = 0;
  }

  $effect(() => {
    if (lift === 0) return;
    const timer = setTimeout(settle, SETTLE_MS);
    return () => clearTimeout(timer);
  });

  $effect(() => {
    if (autofocus) input?.focus();
  });
</script>

<form class="surface composer" style:--visible-bottom="{visibleBottom}px" onsubmit={submit}>
  <div class="bar">
    <div
      class="entry"
      role="presentation"
      onpointerdown={liftForKeyboard}
      onpointercancel={settle}
      onclick={focusLifted}
    >
      <HighlightedInput
        id="composer"
        bind:input
        bind:value={ui.composing}
        spans={parsed?.spans ?? []}
        {lift}
        onblur={settle}
        placeholder="Remind me to…"
        maxlength={LIMITS.title}
        aria-label="New reminder"
        enterkeyhint="done"
        spellcheck="true"
      />
    </div>
    {#if parsed?.title}
      <ComposerSummary {when} {cadence} {important} {summary} />
    {:else}
      <kbd>{hint(NEW_REMINDER)}</kbd>
    {/if}
  </div>
  <p class="sr-only" aria-live="polite">{parsed?.title ? summary : ''}</p>
</form>

<style>
  .composer {
    position: fixed;
    top: 0;
    left: 12px;
    right: 12px;
    z-index: 20;
    max-width: 536px;
    margin: 0 auto;
    border-radius: 18px;
    --gap: max(12px, env(safe-area-inset-bottom));
    --surface-lift: 0 -16px 32px 12px var(--bg);
    translate: 0 calc(var(--visible-bottom) - 100% - var(--gap));
    transition: translate var(--base) var(--ease);
  }

  /* Above the keyboard the home indicator's inset no longer applies, so the composer rides 8px over the keys. */
  .composer:focus-within {
    --surface-edge: var(--faint);
    --gap: 8px;
  }

  .bar {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 52px;
    padding: 0 8px 0 16px;
  }

  .entry {
    position: relative;
    flex: 1;
    min-width: 0;
  }

  kbd {
    display: none;
    color: var(--muted);
  }

  @media (min-width: 720px) {
    .composer,
    .composer:focus-within {
      position: static;
      max-width: none;
      margin: 0 0 18px;
      --surface-lift: 0 0 transparent;
      translate: none;
    }

    kbd {
      display: block;
    }
  }
</style>
