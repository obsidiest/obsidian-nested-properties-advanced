import { evalInObsidian } from 'obsidian-integration-testing';

// Seed the running vault through its API; filesystem writes do not await the Windows watcher.
export async function writeDesktopFixtures(vaultPath: string, fixtures: Record<string, string>): Promise<void> {
  await evalInObsidian({
    callback: async ({ app, notes }) => {
      for (const [path, content] of Object.entries(notes)) {
        const file = app.vault.getFileByPath(path);
        if (file === null) {
          await app.vault.create(path, content);
        } else {
          await app.vault.modify(file, content);
        }
      }
    },
    input: { notes: fixtures },
    vaultPath
  });
}
