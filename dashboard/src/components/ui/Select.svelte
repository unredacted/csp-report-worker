<script lang="ts">
  import { cn } from "@/lib/utils";

  type Item = { value: string; label: string };

  type Props = {
    value: string;
    items: readonly Item[];
    onValueChange?: (v: string) => void;
    class?: string;
    placeholder?: string;
    disabled?: boolean;
  };

  let {
    value = $bindable(),
    items,
    onValueChange,
    class: className = "",
    disabled,
  }: Props = $props();

  function handleChange(e: Event) {
    const next = (e.currentTarget as HTMLSelectElement).value;
    value = next;
    onValueChange?.(next);
  }
</script>

<select
  {value}
  {disabled}
  onchange={handleChange}
  class={cn(
    "flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
    className,
  )}
>
  {#each items as item (item.value)}
    <option value={item.value}>{item.label}</option>
  {/each}
</select>
