import { deletePushSubscription, fetchPushKey, savePushSubscription } from '../services/studentService';

/**
 * Web Push (blueprint §9.6, V5). The service worker (public/sw.js) shows the
 * notifications; the server queues them per device in its outbox.
 */

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const keyBytes = (base64url: string) => {
  const padded = base64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (base64url.length % 4)) % 4);
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
};

const registration = async () => (await navigator.serviceWorker.getRegistration()) ?? navigator.serviceWorker.register('/sw.js');

export const currentPushSubscription = async () => {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
};

export const enablePush = async () => {
  if (!pushSupported()) throw new Error('This browser doesn’t support push notifications.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications are blocked. Allow them in your browser settings to turn this on.');
  const { publicKey } = await fetchPushKey();
  const reg = await registration();
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  await savePushSubscription(sub.toJSON());
};

export const disablePush = async () => {
  const sub = await currentPushSubscription();
  if (!sub) return;
  await deletePushSubscription(sub.endpoint);
  await sub.unsubscribe();
};
