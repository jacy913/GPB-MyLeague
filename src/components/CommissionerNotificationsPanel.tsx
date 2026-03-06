import React from 'react';

type NoticeLevel = 'info' | 'success' | 'warning' | 'error';

interface CommissionerNotice {
  id: string;
  message: string;
  level: NoticeLevel;
  createdAt: string;
}

const NOTICE_LEVEL_CLASS: Record<NoticeLevel, string> = {
  info: 'text-zinc-300',
  success: 'text-white',
  warning: 'text-zinc-200',
  error: 'text-zinc-400',
};

interface CommissionerNotificationsPanelProps {
  notices: CommissionerNotice[];
  onClear: () => void;
}

export const CommissionerNotificationsPanel = ({
  notices,
  onClear,
}: CommissionerNotificationsPanelProps) => (
  <section className="max-w-4xl space-y-4">
    <div className="bg-[#1f1f1f] rounded-2xl border border-white/10 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-3xl uppercase tracking-widest text-white">Commissioner Notifications</h2>
        <button
          onClick={onClear}
          disabled={notices.length === 0}
          className="text-xs font-mono text-zinc-500 hover:text-white disabled:text-zinc-700 transition-colors"
        >
          Clear Feed
        </button>
      </div>
      {notices.length === 0 ? (
        <p className="text-sm font-mono text-zinc-500">No notifications yet.</p>
      ) : (
        <ul className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          {notices.map((notice) => (
            <li key={notice.id} className="bg-[#2b2b2b] border border-white/10 rounded-xl px-4 py-3 flex items-start justify-between gap-3">
              <span className={`text-sm font-mono ${NOTICE_LEVEL_CLASS[notice.level]}`}>{notice.message}</span>
              <span className="text-[11px] font-mono text-zinc-500 shrink-0">{notice.createdAt}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  </section>
);
