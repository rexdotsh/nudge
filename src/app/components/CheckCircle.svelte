<script lang="ts">
  let {
    late = false,
    small = false,
    checked = false,
    label,
    onToggle,
  }: {
    late?: boolean;
    small?: boolean;
    checked?: boolean;
    label: string;
    onToggle: (event: MouseEvent) => void;
  } = $props();

  let popping = $state(false);

  function toggle(event: MouseEvent) {
    event.stopPropagation();
    popping = true;
    onToggle(event);
    setTimeout(() => (popping = false), 700);
  }
</script>

<button class="check" class:late class:small class:checked class:popping aria-label={label} onclick={toggle}>
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle class="ring" cx="12" cy="12" r="10.2" />
    <circle class="disc" cx="12" cy="12" r="11" />
    <path class="tick" d="M7.4 12.6 10.6 15.6 16.6 9.2" />
  </svg>
</button>

<style>
  .check {
    flex: none;
    width: 24px;
    height: 24px;
    display: grid;
    place-items: center;
    color: var(--faint);
    border-radius: 50%;
  }

  .late {
    color: var(--accent);
  }

  svg {
    width: 21px;
    height: 21px;
    overflow: visible;
  }

  .small svg {
    width: 17px;
    height: 17px;
  }

  .ring {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
  }

  .disc,
  .tick {
    transform-box: fill-box;
    transform-origin: center;
    opacity: 0;
    transition:
      transform 0.32s var(--spring),
      opacity 0.18s var(--ease);
  }

  .disc {
    fill: var(--on);
    transform: scale(0.4);
  }

  .tick {
    fill: none;
    stroke: var(--on-ink);
    stroke-width: 2.4;
    stroke-linecap: round;
    stroke-linejoin: round;
    transform: scale(0.5);
    transition-delay: 0.06s;
  }

  .checked .disc {
    fill: var(--faint);
  }

  .checked .disc,
  .checked .tick,
  .popping .disc,
  .popping .tick {
    opacity: 1;
    transform: scale(1);
  }

  .popping svg {
    animation: pop 0.5s var(--spring);
  }

  @keyframes pop {
    30% {
      transform: scale(0.8);
    }
  }
</style>
