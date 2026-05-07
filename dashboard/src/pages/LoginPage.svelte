<script lang="ts">
  import { toast } from "svelte-sonner";
  import Button from "@/components/ui/Button.svelte";
  import Card from "@/components/ui/Card.svelte";
  import CardContent from "@/components/ui/CardContent.svelte";
  import CardDescription from "@/components/ui/CardDescription.svelte";
  import CardHeader from "@/components/ui/CardHeader.svelte";
  import CardTitle from "@/components/ui/CardTitle.svelte";
  import Input from "@/components/ui/Input.svelte";
  import Label from "@/components/ui/Label.svelte";
  import { checkAuth } from "@/lib/api";
  import { setToken } from "@/lib/auth";
  import { router } from "@/lib/router.svelte";

  let token = $state("");
  let submitting = $state(false);

  async function onSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (!token.trim()) return;
    submitting = true;
    try {
      const ok = await checkAuth(token.trim());
      if (!ok) {
        toast.error("Invalid token");
        return;
      }
      setToken(token.trim());
      router.navigate("/list", { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Network error");
    } finally {
      submitting = false;
    }
  }
</script>

<div class="min-h-svh flex items-center justify-center bg-background px-4">
  <Card class="w-full max-w-sm">
    <CardHeader>
      <CardTitle>CSP Reports</CardTitle>
      <CardDescription>
        Sign in with your worker API token to view stored CSP violation reports.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <form onsubmit={onSubmit} class="space-y-4">
        <div class="space-y-2">
          <Label for="token">API token</Label>
          <Input
            id="token"
            type="password"
            autocomplete="off"
            placeholder="Bearer token"
            bind:value={token}
            required
          />
        </div>
        <Button type="submit" class="w-full" disabled={submitting || !token.trim()}>
          {submitting ? "Verifying…" : "Sign in"}
        </Button>
      </form>
      <p class="mt-4 text-xs text-muted-foreground">
        The token is stored in <code>sessionStorage</code> and cleared when the browser closes.
      </p>
    </CardContent>
  </Card>
</div>
