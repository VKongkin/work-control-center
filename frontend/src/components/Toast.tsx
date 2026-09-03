import { createContext, useCallback, useContext, useMemo, useState, ReactNode } from 'react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';

type Kind = 'success' | 'error';
interface Toast {
  id: number;
  kind: Kind;
  message: string;
}

const ToastCtx = createContext<{
  success: (m: string) => void;
  error: (m: string) => void;
}>({ success: () => {}, error: () => {} });

export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((kind: Kind, message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, message }]);
    window.setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, kind === 'error' ? 6000 : 3500);
  }, []);

  const api = useMemo(
    () => ({
      success: (m: string) => push('success', m),
      error: (m: string) => push('error', m),
    }),
    [push]
  );

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-2.5 rounded-lg px-4 py-3 shadow-lg ring-1 ${
              t.kind === 'success'
                ? 'bg-white text-slate-800 ring-emerald-200'
                : 'bg-white text-slate-800 ring-red-200'
            }`}
          >
            {t.kind === 'success' ? (
              <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" size={17} />
            ) : (
              <AlertCircle className="mt-0.5 shrink-0 text-red-600" size={17} />
            )}
            <p className="flex-1 text-sm">{t.message}</p>
            <button
              onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}
              className="shrink-0 text-slate-400 hover:text-slate-600"
              aria-label="Dismiss"
            >
              <X size={15} />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
