// Serves the bukmark command and its installer from the site root, so that
//   curl -fsSL https://bukmark.it/install.sh | sh
// works and https://bukmark.it/bukmark is what it downloads. Both live in
// packaging/ at the repo root, the one copy Homebrew and the tests use too.
// The build copies them into dist/ byte for byte; public/_headers serves them
// as plain text.
import { copyFile } from 'node:fs/promises';

const repoRoot = new URL('../../../', import.meta.url);

/** Published path under the site root -> source path in the repo. */
export const PACKAGING_FILES = {
  'install.sh': 'packaging/install.sh',
  bukmark: 'packaging/bin/bukmark',
};

export async function copyPackagingFiles(outDir) {
  for (const [published, source] of Object.entries(PACKAGING_FILES)) {
    await copyFile(new URL(source, repoRoot), new URL(published, outDir));
  }
}

/** Astro integration: runs on every `astro build`, however it is started. */
export function packagingFiles() {
  return {
    name: 'bukmark:packaging-files',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        await copyPackagingFiles(dir);
        logger.info(`copied ${Object.values(PACKAGING_FILES).join(', ')}`);
      },
    },
  };
}
