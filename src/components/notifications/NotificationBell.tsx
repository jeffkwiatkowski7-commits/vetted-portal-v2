import React, { useState, useEffect } from 'react';
import { useStore } from '../../store';
import * as api from '../../api';
import { Bell, X, CheckCheck } from 'lucide-react';
import type { Notification } from '../../types';

export default function NotificationBell() {
  const { notifications, setNotifications, unreadCount } = useStore();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadNotifications();
  }, []);

  const loadNotifications = async () => {
    try {
      const data = await api.notifications.list();
      setNotifications(data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleMarkRead = async (notifId: string) => {
    try {
      await api.notifications.markRead(notifId);
      setNotifications(
        notifications.map((n) =>
          n.id === notifId ? { ...n, is_read: 1 } : n
        )
      );
    } catch (err) {
      console.error(err);
    }
  };

  const handleMarkAllRead = async () => {
    setLoading(true);
    try {
      await api.notifications.markAllRead();
      setNotifications(notifications.map((n) => ({ ...n, is_read: 1 })));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'shared_chat':
        return '💬';
      case 'project':
        return '📁';
      case 'system':
        return '⚙️';
      default:
        return '📬';
    }
  };

  return (
    <div className="relative">
      {/* Bell Button */}
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 hover:bg-vetted-surface rounded-lg transition-colors"
        title="Notifications"
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute top-0 right-0 w-5 h-5 bg-vetted-accent text-vetted-primary text-xs rounded-full flex items-center justify-center font-medium">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Panel */}
      {open && (
        <div className="absolute top-full right-0 mt-2 w-80 bg-white border border-vetted-border rounded-lg shadow-lg z-50">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-vetted-border">
            <h3 className="font-medium text-vetted-primary">Notifications</h3>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                disabled={loading}
                className="text-xs text-vetted-accent hover:text-vetted-accent-dark"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* Notifications List */}
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="p-8 text-center text-vetted-text-secondary">
                <p>No notifications</p>
              </div>
            ) : (
              <div className="divide-y divide-vetted-border">
                {notifications.map((notif) => (
                  <button
                    key={notif.id}
                    onClick={() => handleMarkRead(notif.id)}
                    className={`w-full text-left p-4 hover:bg-vetted-surface transition-colors border-l-2 ${
                      !notif.is_read
                        ? 'border-l-vetted-accent bg-blue-50'
                        : 'border-l-transparent'
                    }`}
                  >
                    <div className="flex gap-3">
                      <span className="text-lg flex-shrink-0">
                        {getTypeIcon(notif.type)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-vetted-primary text-sm">
                          {notif.title}
                        </p>
                        <p className="text-xs text-vetted-text-secondary mt-1 line-clamp-2">
                          {notif.description}
                        </p>
                        <p className="text-xs text-vetted-text-muted mt-2">
                          {new Date(notif.created_at).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="p-3 border-t border-vetted-border text-center">
              <button className="text-sm text-vetted-accent hover:text-vetted-accent-dark">
                View all notifications
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
