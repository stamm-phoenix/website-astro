<script lang="ts">
  import { onMount } from "svelte";

  interface Props {
    groupKey: string;
  }

  let { groupKey }: Props = $props();

  interface GroupLeader {
    id: string;
    name: string;
    teams: string[];
    hasImage: boolean;
  }

  let leaders = $state<string>("Wird geladen...");
  let error = $state<boolean>(false);

  onMount(async () => {
    try {
      const response = await fetch("/api/teams");
      if (!response.ok) {
        throw new Error("Failed to fetch team data");
      }
      const groupLeaders: GroupLeader[] = await response.json();

      const filteredLeaders = groupLeaders
        .filter((gl) => gl.teams.includes(groupKey))
        .map((gl) => gl.name)
        .join(", ");

      leaders = filteredLeaders || "Keine Leitenden gefunden";
    } catch (e) {
      error = true;
      leaders = "Leitende konnten nicht geladen werden";
    }
  });
</script>

<span class="group-leaders" class:error>{leaders}</span>

<style>
  .error {
    color: var(--color-neutral-500);
    font-style: italic;
  }
</style>
