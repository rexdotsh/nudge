<script lang="ts" module>
  const PATHS = {
    settings:
      'M20 7h-8.5M14.5 17H4M7 4.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM17 14.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM4 7h.5M19.5 17h.5',
    check: 'M5 12.5 10 17.5 19 7',
    up: 'M12 19V5M5.5 11.5 12 5l6.5 6.5',
    clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13.5V12l3 2',
    share: 'M12 15V3.5M8 7l4-4 4 4M6.5 10.5H6a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6.5a2 2 0 0 0-2-2h-.5',
    arrowLeft: 'M14.5 5.5 8 12l6.5 6.5',
    arrowRight: 'M9.5 5.5 16 12l-6.5 6.5',
    close: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
    plus: 'M12 5.5v13M5.5 12h13',
    trash: 'M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5',
    skip: 'M5.5 6.5 11 12l-5.5 5.5M12.5 6.5 18 12l-5.5 5.5',
  } as const;

  type IconName = keyof typeof PATHS;
</script>

<script lang="ts">
  let { name, size = 20 }: { name: IconName; size?: number } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.8"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d={PATHS[name]} />
</svg>
