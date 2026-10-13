import { getTaskDirectoryUsers } from '../lib/task-directory';
async function main(): Promise<void> {
  const users = await getTaskDirectoryUsers();
  console.log(
    JSON.stringify({ check: 'task-directory', available: true, enabledMembers: users.length })
  );
}
void main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      check: 'task-directory',
      available: false,
      error: error instanceof Error ? error.name : 'UnknownError',
    })
  );
  process.exitCode = 1;
});
