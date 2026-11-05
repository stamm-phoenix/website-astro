export interface SeedStep {
  name: string;
  run: () => Promise<void>;
}

/** Wait for every track before closing the shared SQL pool, including on failure. */
export async function runSeedTracks(tracks: SeedStep[][]): Promise<void> {
  const results = await Promise.allSettled(
    tracks.map(async (steps) => {
      for (const step of steps) {
        const started = performance.now();
        await step.run();
        console.log(
          JSON.stringify({
            scope: 'db_preview_seed',
            step: step.name,
            milliseconds: Math.round(performance.now() - started),
          })
        );
      }
    })
  );
  const failed = results.find((result) => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
}
