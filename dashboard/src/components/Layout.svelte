<script lang="ts">
  import type { Snippet } from "svelte";
  import LogOut from "lucide-svelte/icons/log-out";
  import Shield from "lucide-svelte/icons/shield";
  import Link from "@/components/Link.svelte";
  import PropertySelector from "@/components/PropertySelector.svelte";
  import Button from "@/components/ui/Button.svelte";
  import { router } from "@/lib/router.svelte";
  import { clearToken } from "@/lib/auth";

  let { children }: { children: Snippet } = $props();

  function logout() {
    clearToken();
    router.navigate("/login", { replace: true });
  }

  function navClass(active: boolean): string {
    const base = "px-2 py-1 rounded-md text-sm transition-colors";
    return active
      ? `${base} bg-secondary text-secondary-foreground`
      : `${base} text-muted-foreground hover:text-foreground hover:bg-accent`;
  }

  let isIssues = $derived(router.path === "/issues" || router.path.startsWith("/issues/"));
  let isProps = $derived(router.path === "/properties" || router.path.startsWith("/properties/"));
  let isPolicy = $derived(router.path === "/policy");
  let isRaw = $derived(
    router.path === "/raw-events" ||
      router.path.startsWith("/raw-events/") ||
      router.path === "/list" ||
      router.path.startsWith("/detail/"),
  );
</script>

<div class="min-h-svh flex flex-col bg-background text-foreground">
  <header class="border-b">
    <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-14 flex items-center gap-6">
      <Link to="/issues" class="flex items-center gap-2 font-semibold">
        <Shield class="size-5" />
        <span>CSP Reports</span>
      </Link>
      <nav class="flex items-center gap-1">
        <Link to="/issues" class={navClass(isIssues)}>Issues</Link>
        <Link to="/policy" class={navClass(isPolicy)}>Policy</Link>
        <Link to="/properties" class={navClass(isProps)}>Properties</Link>
        <Link to="/raw-events" class={navClass(isRaw)}>Raw events</Link>
      </nav>
      <div class="ml-auto flex items-center gap-3">
        <PropertySelector />
        <Button variant="ghost" size="sm" onclick={logout}>
          <LogOut class="size-4" />
          <span>Sign out</span>
        </Button>
      </div>
    </div>
  </header>
  <main class="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-6">
    {@render children()}
  </main>
</div>
