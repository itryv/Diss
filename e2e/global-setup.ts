import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const CONTAINER_NAME = 'diss-e2e-livekit';
const FLAG_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '.livekit-started-by-e2e',
);

function portListening(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const done = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(1000, () => done(false));
  });
}

async function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portListening(port)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for port ${port} to accept connections`);
}

export default async function globalSetup(): Promise<void> {
  // Clean up any stale flag from a previous crashed run.
  fs.rmSync(FLAG_FILE, { force: true });

  if (await portListening(7880)) {
    console.log('[e2e] LiveKit already listening on 7880 — reusing it.');
    return;
  }

  console.log('[e2e] Starting LiveKit dev server container…');
  execSync(
    [
      'docker run -d --rm',
      `--name ${CONTAINER_NAME}`,
      '-p 7880:7880',
      '-p 7881:7881',
      '-p 7882:7882/udp',
      'livekit/livekit-server',
      '--dev --bind 0.0.0.0 --node-ip 127.0.0.1',
    ].join(' '),
    { stdio: 'inherit' },
  );

  await waitForPort(7880, 60_000);
  // Remember that WE started the container so teardown knows to stop it.
  fs.writeFileSync(FLAG_FILE, CONTAINER_NAME);
  console.log('[e2e] LiveKit dev server is up.');
}
