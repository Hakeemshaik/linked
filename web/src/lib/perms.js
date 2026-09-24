import { isIOS, isStandalone } from './push.js';

/** 'granted' | 'denied' | 'prompt' | 'unknown' for the camera and microphone (and notifications). */
export async function permissionStates() {
  const one = async (name) => {
    try { return (await navigator.permissions.query({ name })).state; } catch { return 'unknown'; }
  };
  const [camera, microphone] = await Promise.all([one('camera'), one('microphone')]);
  const notifications = 'Notification' in window ? ({ default: 'prompt' }[Notification.permission] || Notification.permission) : 'unknown';
  return { camera, microphone, notifications };
}

/** Ask for the camera and/or microphone now (from a tap), then let them go straight away. */
export async function askMedia({ video = false, audio = false }) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser has no camera or microphone access. Open Linkup in Safari or Chrome.');
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video, audio });
    s.getTracks().forEach((t) => t.stop());
    return true;
  } catch (e) {
    if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') return false;
    if (e?.name === 'NotFoundError') throw new Error(video ? 'No camera found on this device' : 'No microphone found on this device');
    throw e;
  }
}

/** Where to switch a blocked permission back on, on this kind of phone. */
export function settingsSteps(what = 'Camera') {
  const ua = navigator.userAgent;
  if (isIOS()) {
    return isStandalone()
      ? [`Open the iPhone Settings app`, 'Tap Apps, then Safari', `Tap ${what} and choose Allow`, 'Come back to Linkup and tap Allow again']
      : ['In Safari, tap the aA button in the address bar', 'Tap Website Settings', `Set ${what} to Allow`, 'Reload the page'];
  }
  if (/Android/i.test(ua)) {
    return isStandalone()
      ? ['Press and hold the Linkup icon on your home screen', 'Tap App info, then Permissions', `Allow ${what}`, 'Come back and tap Allow again']
      : ['Tap the icon left of the address, then Permissions', `Turn on ${what}`, 'Reload the page'];
  }
  return ['Click the icon left of the address bar', `Set ${what} to Allow`, 'Reload the page'];
}
