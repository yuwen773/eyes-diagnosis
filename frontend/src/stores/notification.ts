import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export interface Notification {
  id: string;
  type: 'report' | 'reexamine' | 'system' | 'diagnosis' | 'reminder' | 'message';
  title: string;
  content?: string;
  message: string;
  isRead: boolean;
  createTime: string | number;
  relatedId?: string;
}

export const useNotificationStore = defineStore('notification', () => {
  const notifications = ref<Notification[]>([]);

  const unreadCount = computed(() => {
    return notifications.value.filter((n) => !n.isRead).length;
  });

  const readCount = computed(() => {
    return notifications.value.filter((n) => n.isRead).length;
  });

  async function fetchNotifications() {
    // TODO: Replace with actual API call when backend endpoint exists
    // Currently returns empty array until backend notification API is available
    notifications.value = [];
  }

  function markAsRead(id: string) {
    const notification = notifications.value.find((n) => n.id === id);
    if (notification) {
      notification.isRead = true;
    }
  }

  function markAllAsRead() {
    notifications.value.forEach((n) => {
      n.isRead = true;
    });
  }

  function addNotification(notification: Notification) {
    notifications.value.unshift(notification);
  }

  function deleteNotification(id: string) {
    const index = notifications.value.findIndex((n) => n.id === id);
    if (index > -1) {
      notifications.value.splice(index, 1);
    }
  }

  return {
    notifications,
    unreadCount,
    readCount,
    fetchNotifications,
    markAsRead,
    markAllAsRead,
    addNotification,
    deleteNotification,
  };
});
