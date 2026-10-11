<script lang="ts">
  let { overdue = false, label, onToggle }: { overdue?: boolean; label: string; onToggle: () => void } = $props();

  let popping = $state(false);

  function toggle(event: MouseEvent) {
    event.stopPropagation();
    popping = true;
    onToggle();
    setTimeout(() => (popping = false), 700);
  }
</script>

<button class="check" class:overdue class:popping aria-label={label} onclick={toggle}>
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="10.2" />
    <path d="M7.4 12.6 10.6 15.6 16.6 9.2" />
  </svg>
</button>

<style>
  .check {
    flex: none;
    width: 28px;
    height: 28px;
    margin: -2px 0 0 -2px;
    display: grid;
    place-items: center;
    color: var(--label-3);
    border-radius: 50%;
  }

  .overdue {
    color: var(--danger);
  }

  svg {
    width: 24px;
    height: 24px;
    overflow: visible;
  }

  circle {
    fill: transparent;
    stroke: currentColor;
    stroke-width: 1.6;
    transition:
      fill 0.18s var(--ease),
      stroke 0.18s var(--ease);
  }

  path {
    fill: none;
    stroke: #fff;
    stroke-width: 2.4;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-dasharray: 15;
    stroke-dashoffset: 15;
    transition: stroke-dashoffset 0.28s 0.06s var(--ease);
  }

  .popping circle {
    fill: var(--brand);
    stroke: var(--brand);
  }

  .popping path {
    stroke-dashoffset: 0;
  }

  .popping svg {
    animation: pop 0.5s var(--spring);
  }

  @keyframes pop {
    0% {
      transform: scale(1);
    }
    30% {
      transform: scale(0.78);
    }
    100% {
      transform: scale(1);
    }
  }

  :global([data-platform='windows']) .check {
    width: 22px;
    height: 22px;
    margin: 0;
  }

  :global([data-platform='windows']) svg {
    width: 20px;
    height: 20px;
  }
</style>
