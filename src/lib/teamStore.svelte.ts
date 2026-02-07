import type { TeamMember as ApiTeamMember } from "../../api/lib/teammembers";

export type TeamMember = Omit<ApiTeamMember, "imageFileName">;

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

  teamStore.loading = true;
  teamStore.error = false;

  fetchPromise = (async () => {
    try {
      const response = await fetch("/api/teams");
      if (!response.ok) throw new Error("Failed to fetch team data");

      teamStore.data = await response.json();
      teamStore.loading = false;
    } catch {
      fetchPromise = null;
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
