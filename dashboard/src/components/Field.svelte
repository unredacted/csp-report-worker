<script lang="ts">
  import { cn } from "@/lib/utils";

  type Props = {
    label: string;
    value: string;
    mono?: boolean;
    danger?: boolean;
  };

  let { label, value, mono, danger }: Props = $props();
</script>

<div class="grid grid-cols-[180px_1fr] gap-3 text-sm">
  <div class="text-muted-foreground">{label}</div>
  <div
    class={cn(
      "break-all",
      mono ? "font-mono text-xs" : "",
      danger ? "text-destructive font-medium" : "",
    )}
  >
    {value}
  </div>
</div>
