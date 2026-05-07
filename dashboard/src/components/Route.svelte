<script lang="ts">
  import type { Snippet } from "svelte";
  import { router, match } from "@/lib/router.svelte";

  type Props = {
    path: string;
    children?: Snippet<[Record<string, string>]>;
  };

  let { path, children }: Props = $props();

  let params = $derived(match(path, router.path));
</script>

{#if params !== null}
  {@render children?.(params)}
{/if}
