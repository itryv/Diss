import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const FLAG_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '.livekit-started-by-e2e',
);

export default async function globalTeardown(): Promise<void> {
  if (!fs.existsSync(FLAG_FILE)) {
    // LiveKit was already running before the suite — leave it alone.
    return;
  }
  const containerName = fs.readFileSync(FLAG_FILE, 'utf8').trim();
  fs.rmSync(FLAG_FILE, { force: true });
  try {
    // --rm on the run means stop also removes it.
    execSync(`docker stop ${containerName}`, { stdio: 'inherit' });
    console.log('[e2e] Stopped LiveKit dev server container.');
  } catch {
    console.warn(`[e2e] Could not stop container ${containerName} (already gone?).`);
  }
}
