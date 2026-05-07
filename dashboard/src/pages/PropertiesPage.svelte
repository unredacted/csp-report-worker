<script lang="ts">
  import { createMutation, createQuery, useQueryClient } from "@tanstack/svelte-query";
  import { toast } from "svelte-sonner";
  import Copy from "lucide-svelte/icons/copy";
  import KeyRound from "lucide-svelte/icons/key-round";
  import Loader2 from "lucide-svelte/icons/loader-2";
  import Trash2 from "lucide-svelte/icons/trash-2";
  import Badge from "@/components/ui/Badge.svelte";
  import Button from "@/components/ui/Button.svelte";
  import Card from "@/components/ui/Card.svelte";
  import CardContent from "@/components/ui/CardContent.svelte";
  import CardDescription from "@/components/ui/CardDescription.svelte";
  import CardHeader from "@/components/ui/CardHeader.svelte";
  import CardTitle from "@/components/ui/CardTitle.svelte";
  import Input from "@/components/ui/Input.svelte";
  import Label from "@/components/ui/Label.svelte";
  import Table from "@/components/ui/Table.svelte";
  import TableBody from "@/components/ui/TableBody.svelte";
  import TableCell from "@/components/ui/TableCell.svelte";
  import TableHead from "@/components/ui/TableHead.svelte";
  import TableHeader from "@/components/ui/TableHeader.svelte";
  import TableRow from "@/components/ui/TableRow.svelte";
  import {
    archiveProperty,
    createProperty,
    listProperties,
    rotateIngestToken,
  } from "@/lib/api";
  import type { Property } from "@/lib/types";

  const queryClient = useQueryClient();

  const query = createQuery(() => ({
    queryKey: ["properties"],
    queryFn: () => listProperties(),
  }));

  let slug = $state("");
  let name = $state("");
  let emails = $state("");
  let webhooks = $state("");
  let muteCategories = $state("");

  // When a token is freshly issued (create or rotate), surface it ONCE.
  let revealed = $state<{ property: Property; ingestUrlBase: string } | null>(null);

  const createMut = createMutation(() => ({
    mutationFn: () =>
      createProperty({
        slug: slug.trim(),
        name: name.trim(),
        emails: emails.trim() || undefined,
        webhooks: webhooks.trim() || undefined,
        muteCategories: muteCategories.trim() || undefined,
      }),
    onSuccess: ({ property }) => {
      revealed = { property, ingestUrlBase: window.location.origin };
      slug = "";
      name = "";
      emails = "";
      webhooks = "";
      muteCategories = "";
      toast.success(`Created property "${property.name}"`);
      queryClient.invalidateQueries({ queryKey: ["properties"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Create failed"),
  }));

  const rotateMut = createMutation(() => ({
    mutationFn: (id: string) => rotateIngestToken(id),
    onSuccess: ({ property }) => {
      revealed = { property, ingestUrlBase: window.location.origin };
      toast.success("Token rotated");
      queryClient.invalidateQueries({ queryKey: ["properties"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Rotate failed"),
  }));

  const archiveMut = createMutation(() => ({
    mutationFn: (id: string) => archiveProperty(id),
    onSuccess: ({ property }) => {
      toast.success(`Archived "${property.name}"`);
      queryClient.invalidateQueries({ queryKey: ["properties"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Archive failed"),
  }));

  function ingestUrlFor(p: Property): string {
    return `${window.location.origin}/r/${p.slug}?t=${p.ingestToken ?? ""}`;
  }

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`Copied ${what}`);
    } catch {
      toast.error("Clipboard unavailable");
    }
  }

  function archive(p: Property) {
    if (!confirm(`Archive "${p.name}"? Reports already received are kept; new reports under this slug will 404.`)) {
      return;
    }
    archiveMut.mutate(p.id);
  }
</script>

<div class="space-y-6">
  <div>
    <h1 class="text-xl font-semibold tracking-tight">Properties</h1>
    <p class="text-sm text-muted-foreground">
      Each property gets its own ingest URL and can override notification routing.
    </p>
  </div>

  {#if revealed}
    {@const r = revealed}
    <Card class="border-amber-500/40 bg-amber-500/5">
      <CardHeader>
        <CardTitle class="text-amber-700 dark:text-amber-400">
          Save this ingest URL — the token is shown only once
        </CardTitle>
        <CardDescription>
          Add it to your CSP header as <code>report-uri</code> or
          <code>Reporting-Endpoints</code>. You can rotate the token any time.
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-3">
        <div class="flex items-center gap-2">
          <Input class="font-mono text-xs" readonly value={ingestUrlFor(r.property)} />
          <Button size="sm" variant="outline" onclick={() => copy(ingestUrlFor(r.property), "ingest URL")}>
            <Copy class="size-4" /><span>Copy</span>
          </Button>
        </div>
        <div class="text-xs text-muted-foreground">
          Token (raw): <code class="font-mono">{r.property.ingestToken}</code>
        </div>
        <div>
          <Button size="sm" variant="ghost" onclick={() => (revealed = null)}>I've saved it</Button>
        </div>
      </CardContent>
    </Card>
  {/if}

  <Card>
    <CardHeader>
      <CardTitle>Create a new property</CardTitle>
      <CardDescription>
        Slugs must be lowercase alphanumeric with optional dashes. Notifications fall back to the
        global <code>NOTIFY_EMAILS</code> / <code>NOTIFY_WEBHOOKS</code> when left blank.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <form
        class="grid grid-cols-1 sm:grid-cols-2 gap-3"
        onsubmit={(e) => {
          e.preventDefault();
          if (!slug.trim() || !name.trim()) return;
          createMut.mutate();
        }}
      >
        <div class="space-y-1">
          <Label for="prop-slug">Slug</Label>
          <Input id="prop-slug" placeholder="marketing" bind:value={slug} required />
        </div>
        <div class="space-y-1">
          <Label for="prop-name">Name</Label>
          <Input id="prop-name" placeholder="Marketing site" bind:value={name} required />
        </div>
        <div class="space-y-1">
          <Label for="prop-emails">Email recipients (optional)</Label>
          <Input id="prop-emails" placeholder="ops@example.com,sec@example.com" bind:value={emails} />
        </div>
        <div class="space-y-1">
          <Label for="prop-webhooks">Webhook URLs (optional)</Label>
          <Input id="prop-webhooks" placeholder="https://hooks.slack.com/..." bind:value={webhooks} />
        </div>
        <div class="space-y-1 sm:col-span-2">
          <Label for="prop-mute">Muted categories (optional)</Label>
          <Input
            id="prop-mute"
            placeholder="extension,browser-internal — or 'none' to disable muting"
            bind:value={muteCategories}
          />
        </div>
        <div class="sm:col-span-2">
          <Button type="submit" disabled={createMut.isPending || !slug.trim() || !name.trim()}>
            {#if createMut.isPending}<Loader2 class="size-4 animate-spin" />{/if}
            <span>Create property</span>
          </Button>
        </div>
      </form>
    </CardContent>
  </Card>

  <div>
    <h2 class="text-sm font-semibold tracking-tight mb-2">Existing properties</h2>
    <div class="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead class="w-[200px]">Name</TableHead>
            <TableHead class="w-[140px]">Slug</TableHead>
            <TableHead>Notifications</TableHead>
            <TableHead class="w-[120px]">Token</TableHead>
            <TableHead class="w-[180px] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {#if query.isLoading}
            <TableRow>
              <TableCell class="text-center text-muted-foreground py-8">
                <Loader2 class="inline size-4 animate-spin mr-2" />
                Loading properties…
              </TableCell>
            </TableRow>
          {:else if (query.data?.properties ?? []).length === 0}
            <TableRow>
              <TableCell class="text-center text-muted-foreground py-8">No properties yet.</TableCell>
            </TableRow>
          {:else}
            {#each query.data!.properties as p (p.id)}
              <TableRow>
                <TableCell class="font-medium">
                  {p.name}
                  {#if p.archivedAt}
                    <Badge variant="secondary" class="ml-2">archived</Badge>
                  {/if}
                </TableCell>
                <TableCell class="font-mono text-xs">{p.slug}</TableCell>
                <TableCell class="text-xs text-muted-foreground">
                  {#if p.notifyEmails || p.notifyWebhooks || p.muteCategories}
                    {#if p.notifyEmails}<div>Emails: <span class="font-mono">{p.notifyEmails}</span></div>{/if}
                    {#if p.notifyWebhooks}<div>Webhooks: <span class="font-mono">{p.notifyWebhooks}</span></div>{/if}
                    {#if p.muteCategories}<div>Mute: <span class="font-mono">{p.muteCategories}</span></div>{/if}
                  {:else}
                    <span>(uses global env defaults)</span>
                  {/if}
                </TableCell>
                <TableCell class="font-mono text-xs">
                  {p.id === "default" ? "—" : (p.ingestTokenSuffix ?? "")}
                </TableCell>
                <TableCell class="text-right">
                  <div class="inline-flex items-center gap-2">
                    {#if p.id !== "default"}
                      <Button
                        size="sm"
                        variant="outline"
                        onclick={() => rotateMut.mutate(p.id)}
                        disabled={rotateMut.isPending || Boolean(p.archivedAt)}
                      >
                        <KeyRound class="size-4" /><span>Rotate</span>
                      </Button>
                      {#if !p.archivedAt}
                        <Button
                          size="sm"
                          variant="outline"
                          onclick={() => archive(p)}
                          disabled={archiveMut.isPending}
                        >
                          <Trash2 class="size-4" /><span>Archive</span>
                        </Button>
                      {/if}
                    {/if}
                  </div>
                </TableCell>
              </TableRow>
            {/each}
          {/if}
        </TableBody>
      </Table>
    </div>
  </div>
</div>
