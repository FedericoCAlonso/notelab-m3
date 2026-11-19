import { registerSW } from 'virtual:pwa-register';

let activeRegistration: ServiceWorkerRegistration | null = null;
let reloadScheduled = false;

/**
 * Registers the PWA Service Worker with automatic foreground/online update checks
 * and a safe single reload whenever a newly activated SW takes control.
 */
export function initPwaUpdates(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  // Only auto-reload when replacing an already-controlling SW (never on first install)
  const hadController = Boolean(navigator.serviceWorker.controller);

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloadScheduled) return;
    reloadScheduled = true;
    window.location.reload();
  });

  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      activeRegistration = registration;

      const triggerUpdate = () => {
        if (navigator.onLine) {
          void registration.update().catch(() => {});
        }
      };

      // Check for updates whenever the PWA comes back to foreground or regains network
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          triggerUpdate();
        }
      });
      window.addEventListener('online', triggerUpdate);

      // Periodic background check every 10 minutes while open
      window.setInterval(triggerUpdate, 10 * 60 * 1000);
    },
  });
}

export async function checkForAppUpdate(): Promise<'updated' | 'up-to-date' | 'unsupported'> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return 'unsupported';
  }
  const reg = activeRegistration ?? (await navigator.serviceWorker.getRegistration()) ?? null;
  if (!reg) return 'unsupported';

  await reg.update();
  if (reg.waiting || reg.installing) {
    return 'updated';
  }
  return 'up-to-date';
}
