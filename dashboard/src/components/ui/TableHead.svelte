<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLThAttributes } from "svelte/elements";
  import { cn } from "@/lib/utils";

  type Props = HTMLThAttributes & { class?: string; children?: Snippet };

  let { class: className = "", children, ...rest }: Props = $props();
</script>

<th
  class={cn(
    "h-10 px-3 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0",
    className,
  )}
  {...rest}
>
  {@render children?.()}
</th>
