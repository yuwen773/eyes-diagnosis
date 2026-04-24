import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export interface Notification {
  id: string;
  type: 'report' | 'reexamine' | 'system';
  title: string;
  content: string;
  isRead: boolean;
  createTime: string;
  relatedId?: string;
}

export const useNotificationStore = defineStore('notification', () => {
  const notifications = ref<Notification[]>([]);

  const unreadCount = computed(() => {
    return notifications.value.filter((n) => !n.isRead).length;
  });

  async function fetchNotifications() {
    // TODO: Replace with actual API call when backend endpoint exists
    // Mock data for development
    notifications.value = [
      {
        id: '1',
        type: 'report',
        title: '诊断报告已生成',
        content: '您的眼底图像诊断报告已生成，请查看详情。',
        isRead: false,
        createTime: new Date().toISOString(),
        relatedId: 'diag-001',
      },
      {
        id: '2',
        type: 'reexamine',
        title: '复诊提醒',
        content: '您有一个待完成的复诊任务。',
        isRead: false,
        createTime: new Date(Date.now() - 86400000).toISOString(),
        relatedId: 'diag-002',
      },
      {
        id: '3',
        type: 'system',
        title: '系统通知',
        content: '系统将于今晚22:00进行维护。',
        isRead: true,
        createTime: new Date(Date.now() - 172800000).toISOString(),
      },
    ];
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

  return {
    notifications,
    unreadCount,
    fetchNotifications,
    markAsRead,
    markAllAsRead,
    addNotification,
  };
});
