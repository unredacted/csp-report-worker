<script lang="ts">
  type Props = {
    label: string;
    value: string;
    sub?: string;
    mono?: boolean;
  };

  let { label, value, sub, mono }: Props = $props();
</script>

<div class="rounded-md border bg-card p-3">
  <div class="text-xs text-muted-foreground">{label}</div>
  <div class={mono ? "font-mono text-sm break-all" : "text-sm"}>{value}</div>
  {#if sub}
    <div class="text-xs text-muted-foreground mt-0.5">{sub}</div>
  {/if}
</div>
