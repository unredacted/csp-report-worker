<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLAnchorAttributes } from "svelte/elements";
  import { router } from "@/lib/router.svelte";

  type Props = HTMLAnchorAttributes & {
    to: string;
    replace?: boolean;
    children?: Snippet;
  };

  let { to, replace, children, ...rest }: Props = $props();

  function handleClick(e: MouseEvent) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    router.navigate(to, { replace });
  }
</script>

<a href={to} onclick={handleClick} {...rest}>
  {@render children?.()}
</a>
