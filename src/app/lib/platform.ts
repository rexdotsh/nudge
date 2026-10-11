import type { Platform } from '../../shared/api';

export function detectPlatform(): Platform {
  const agent = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Windows/.test(agent)) return 'windows';
  if (/Android/.test(agent)) return 'android';
  if (/Macintosh/.test(agent)) return 'mac';
  return 'other';
}

export function isInstalled(): boolean {
  return (
    matchMedia('(display-mode: standalone)').matches || ('standalone' in navigator && navigator.standalone === true)
  );
}

export const DEVICE_LABELS: Record<Platform, string> = {
  ios: 'iPhone',
  windows: 'Windows PC',
  mac: 'Mac',
  android: 'Android phone',
  other: 'Browser',
};
