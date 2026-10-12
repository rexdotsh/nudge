<script lang="ts">
  import { GROUPS, keyLabels } from '../lib/shortcuts';
  import { ui } from '../lib/ui.svelte';
  import Sheet from './Sheet.svelte';
</script>

<Sheet label="Keyboard shortcuts" onClose={() => (ui.help = false)}>
  <h2 class="heading">Keyboard shortcuts</h2>
  {#each GROUPS as group (group.title)}
    <h3 class="label">{group.title}</h3>
    <dl class="group">
      {#each group.items as item (item.label)}
        <div>
          <dt>{item.label}</dt>
          <dd>
            {#each keyLabels(item) as key (key)}<kbd>{key}</kbd>{/each}
          </dd>
        </div>
      {/each}
    </dl>
  {/each}
</Sheet>

<style>
  h2 {
    margin: 2px 0 4px;
  }

  h3 {
    margin: 18px 2px 8px;
  }

  dl {
    margin: 0;
  }

  dl div {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-height: 40px;
    padding: 6px 14px;
  }

  dd {
    margin: 0;
    display: flex;
    gap: 4px;
  }
</style>
