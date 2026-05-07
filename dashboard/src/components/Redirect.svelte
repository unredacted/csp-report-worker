<script lang="ts">
  import { onMount } from "svelte";
  import { router } from "@/lib/router.svelte";

  let { to }: { to: string } = $props();

  onMount(() => {
    router.navigate(to, { replace: true });
  });
</script>
