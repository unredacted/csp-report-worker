<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import Select from "@/components/ui/Select.svelte";
  import { listProperties } from "@/lib/api";
  import { propertyStore } from "@/lib/property-store.svelte";

  const query = createQuery(() => ({
    queryKey: ["properties"],
    queryFn: () => listProperties(),
    staleTime: 60_000,
  }));

  let items = $derived(
    (query.data?.properties ?? []).map((p) => ({
      value: p.id,
      label: p.archivedAt ? `${p.name} (archived)` : p.name,
    })),
  );
</script>

{#if items.length > 1}
  <Select
    class="w-[180px]"
    value={propertyStore.selectedId}
    items={items}
    onValueChange={(v) => propertyStore.select(v)}
  />
{/if}
