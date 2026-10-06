import type { NotificationType } from '../types/event';
import { api } from './api';

// The signed-in student's in-app notifications, from the EventEase API.

export type { NotificationType };

export const fetchNotifications = () =>
  api<{ notifications: NotificationType[]; unreadCount: number }>('/me/notifications');

export const markAllNotificationsRead = () => api<{ ok: true }>('/me/notifications/read-all', { method: 'POST' });
