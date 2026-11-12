import React from 'react';

export interface SnackbarMessage {
  id: number;
  text: string;
  tone?: 'neutral' | 'success' | 'error';
}

interface SnackbarProps {
  message: SnackbarMessage | null;
  onDismiss: () => void;
}

export const Snackbar: React.FC<SnackbarProps> = ({ message, onDismiss }) => {
  if (!message) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-3 right-20 sm:left-1/2 sm:-translate-x-1/2 sm:right-auto sm:min-w-[280px] sm:max-w-md z-40 pointer-events-auto"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-inverse-surface text-inverse-on-surface shadow-lg text-sm">
        <span className="truncate">{message.text}</span>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-xs font-semibold text-primary-container hover:underline"
        >
          OK
        </button>
      </div>
    </div>
  );
};
