import * as React from 'react';
import { useToast } from '@/context/ToastContext';

export function Toaster() {
  const { toasts } = useToast();
  if (toasts.length === 0) return null;
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={toast.type === 'error' ? 'bg-destructive text-white' : 'bg-primary text-white'}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}