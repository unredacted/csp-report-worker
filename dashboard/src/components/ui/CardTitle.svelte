<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import { cn } from "@/lib/utils";

  type Props = HTMLAttributes<HTMLDivElement> & { class?: string; children?: Snippet };

  let { class: className = "", children, ...rest }: Props = $props();
</script>

<div class={cn("font-semibold leading-none tracking-tight", className)} {...rest}>
  {@render children?.()}
</div>
