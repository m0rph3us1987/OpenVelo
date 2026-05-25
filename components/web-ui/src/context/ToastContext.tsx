import * as React from 'react';

export type ToastType = 'success' | 'error';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
  toasts: Toast[];
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

interface ToastProviderProps {
  children: React.ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const counterRef = React.useRef(0);

  const showToast = React.useCallback((message: string, type: ToastType = 'success') => {
    const id = ++counterRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  }, []);

  React.useEffect(() => {
    const handler = () => {
      showToast("You don't have permission to access this resource.", 'error');
      window.location.href = '/';
    };
    window.addEventListener('openvelo:forbidden', handler);
    return () => window.removeEventListener('openvelo:forbidden', handler);
  }, [showToast]);

  const value = React.useMemo(() => ({ showToast, toasts }), [showToast, toasts]);

  return (
    <ToastContext.Provider value={value}>
      {children}
    </ToastContext.Provider>
  );
}