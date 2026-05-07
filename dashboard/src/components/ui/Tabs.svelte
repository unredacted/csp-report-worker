<script lang="ts">
  import type { Snippet } from "svelte";
  import { Tabs as TabsPrimitive } from "bits-ui";

  type Props = {
    value: string;
    onValueChange?: (v: string) => void;
    class?: string;
    children?: Snippet;
  };

  let { value = $bindable(), onValueChange, class: className, children }: Props = $props();
</script>

<TabsPrimitive.Root bind:value {onValueChange} class={className}>
  {@render children?.()}
</TabsPrimitive.Root>
