import { bridge } from './bridge';
import type { PermissionKind, PermissionState, PermissionStatuses } from './bridge';

/**
 * macOS gates camera, microphone and screen recording behind TCC, and a denied
 * grant cannot be re-prompted from inside the app — the only way out is System
 * Settings. These helpers front that reality; in a browser they no-op so the
 * normal getUserMedia flow is unchanged.
 */

/**
 * Ask the OS before touching getUserMedia.
 *
 * Doing it in this order matters: when TCC has already denied access,
 * getUserMedia rejects with the same NotAllowedError the browser uses for "the
 * user dismissed the prompt", and the app would tell people to check a browser
 * setting that doesn't exist on the desktop.
 */
export async function preflightMedia(want: { audio?: boolean; video?: boolean }): Promise<{
  ok: boolean;
  denied: PermissionKind[];
}> {
  const api = bridge();
  if (!api || api.platform !== 'darwin') return { ok: true, denied: [] };

  const denied: PermissionKind[] = [];
  if (want.audio) {
    const mic = await api.permissions.request('microphone');
    if (mic !== 'granted') denied.push('microphone');
  }
  if (want.video) {
    const cam = await api.permissions.request('camera');
    if (cam !== 'granted') denied.push('camera');
  }
  return { ok: denied.length === 0, denied };
}

export async function readPermissions(): Promise<PermissionStatuses | null> {
  return bridge()?.permissions.status() ?? null;
}

export function openPermissionSettings(kind: PermissionKind): void {
  bridge()?.permissions.openSettings(kind);
}

/** macOS only surfaces the Screen Recording prompt once capture is attempted. */
export async function requestScreenAccess(): Promise<{ status: PermissionState; needsRestart: boolean }> {
  const api = bridge();
  if (!api) return { status: 'granted', needsRestart: false };
  return api.permissions.requestScreen();
}

export const PERMISSION_LABEL: Record<PermissionKind, string> = {
  camera: 'Camera',
  microphone: 'Microphone',
  screen: 'Screen Recording',
};

export const PERMISSION_WHY: Record<PermissionKind, string> = {
  camera: 'So people can see you.',
  microphone: 'So people can hear you.',
  screen: 'Needed to share your screen. macOS asks for this separately.',
};

/** Copy for a status, written to always name the next action. */
export function permissionHint(kind: PermissionKind, state: PermissionState): string {
  switch (state) {
    case 'granted': return 'Allowed';
    case 'denied': return `Blocked by macOS — turn ${PERMISSION_LABEL[kind]} on for Diss in System Settings.`;
    case 'restricted': return 'Blocked by a device policy — an administrator controls this.';
    case 'not-determined': return kind === 'screen'
      ? "Not asked yet — macOS asks the first time you share, and needs Diss to restart afterwards."
      : 'Not asked yet — we ask when you first join a meeting.';
    default: return 'Unknown';
  }
}
