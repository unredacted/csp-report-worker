<script lang="ts">
  import type { Snippet } from "svelte";
  import { Tabs as TabsPrimitive } from "bits-ui";
  import { cn } from "@/lib/utils";

  type Props = { value: string; class?: string; children?: Snippet };

  let { value, class: className = "", children }: Props = $props();
</script>

<TabsPrimitive.Trigger
  {value}
  class={cn(
    "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow",
    className,
  )}
>
  {@render children?.()}
</TabsPrimitive.Trigger>
