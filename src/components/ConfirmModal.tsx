import { AlertTriangle, X } from 'lucide-react';
import type { ConfirmDialogState } from '../types';

interface ConfirmModalProps {
  dialog: ConfirmDialogState | null;
  isLoading: boolean;
  onClose: () => void;
}

export function ConfirmModal({ dialog, isLoading, onClose }: ConfirmModalProps) {
  if (!dialog || !dialog.isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
    >
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700 border border-amber-200">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h3 id="confirm-modal-title" className="text-base font-semibold text-slate-900">
                {dialog.title}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5 truncate max-w-[270px]">{dialog.targetLabel}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
            aria-label="Закрити"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-slate-700">{dialog.description}</p>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
          >
            Скасувати
          </button>
          <button
            type="button"
            onClick={() => void dialog.onConfirm()}
            disabled={isLoading}
            className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60 transition-colors whitespace-nowrap"
          >
            {isLoading ? 'Виконується...' : dialog.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
