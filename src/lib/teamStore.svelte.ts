export interface TeamMember {
  id: string;
  name: string;
  teams: string[];
  hasImage: boolean;
}

interface TeamStoreState {
  data: TeamMember[] | null;
  loading: boolean;
  error: boolean;
}

export const teamStore = $state<TeamStoreState>({
  data: null,
  loading: true,
  error: false,
});

let fetchPromise: Promise<void> | null = null;

export function fetchTeams(): Promise<void> {
  if (fetchPromise) return fetchPromise;
  if (teamStore.data !== null) return Promise.resolve();

  fetchPromise = (async () => {
    try {
      const response = await fetch("/api/teams");
      if (!response.ok) throw new Error("Failed to fetch team data");

      teamStore.data = await response.json();
      teamStore.loading = false;
    } catch {
      teamStore.error = true;
      teamStore.loading = false;
    }
  })();

  return fetchPromise;
}

export function getLeadersForGroup(groupKey: string): string[] {
  if (!teamStore.data) return [];
  return teamStore.data
    .filter((member) => member.teams.includes(groupKey))
    .map((member) => member.name);
}
