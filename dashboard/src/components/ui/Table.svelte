<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLTableAttributes } from "svelte/elements";
  import { cn } from "@/lib/utils";

  type Props = HTMLTableAttributes & { class?: string; children?: Snippet };

  let { class: className = "", children, ...rest }: Props = $props();
</script>

<div class="relative w-full overflow-auto">
  <table class={cn("w-full caption-bottom text-sm", className)} {...rest}>
    {@render children?.()}
  </table>
</div>
