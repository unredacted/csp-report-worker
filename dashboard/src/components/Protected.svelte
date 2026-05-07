<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  import { router } from "@/lib/router.svelte";
  import { getToken } from "@/lib/auth";
  import Layout from "./Layout.svelte";

  let { children }: { children: Snippet } = $props();

  let authed = $state(false);

  onMount(() => {
    if (!getToken()) {
      router.navigate("/login", { replace: true });
    } else {
      authed = true;
    }
  });

  // Re-check on path change (token may be cleared by a 401 elsewhere).
  $effect(() => {
    void router.path;
    if (authed && !getToken()) {
      authed = false;
      router.navigate("/login", { replace: true });
    }
  });
</script>

{#if authed}
  <Layout>
    {@render children()}
  </Layout>
{/if}
