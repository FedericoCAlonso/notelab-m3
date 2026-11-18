import React from 'react';
import { RotateCcw, Save, X } from 'lucide-react';

interface DiscardDraftDialogProps {
  open: boolean;
  notebookName: string;
  onKeepDraft: () => void;
  onSaveAndClose?: () => void;
  onDiscard: () => void;
}

export const DiscardDraftDialog: React.FC<DiscardDraftDialogProps> = ({
  open,
  notebookName,
  onKeepDraft,
  onSaveAndClose,
  onDiscard,
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="fixed inset-0 bg-scrim" onClick={onKeepDraft} aria-hidden="true" />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="discard-draft-title"
        className="relative z-10 w-full sm:max-w-md bg-surface-container-high text-on-surface rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 space-y-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-full bg-warning-container text-on-warning-container flex items-center justify-center shrink-0">
              <RotateCcw className="w-5 h-5" />
            </div>
            <div>
              <h2 id="discard-draft-title" className="text-base font-semibold">
                Cambios sin guardar en el borrador
              </h2>
              <p className="text-xs text-on-surface-variant font-mono truncate max-w-[240px]">
                {notebookName}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onKeepDraft}
            aria-label="Cerrar diálogo"
            className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-surface-container-highest"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-on-surface-variant">
          Tus ediciones están en el buffer local sin pisar el archivo original. ¿Quieres
          descartarlas y restaurar la última versión guardada?
        </p>

        <div className="space-y-2 pt-1">
          {onSaveAndClose && (
            <button
              type="button"
              onClick={onSaveAndClose}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-primary-container text-on-primary-container text-left hover:opacity-95 transition-opacity"
            >
              <Save className="w-4 h-4 shrink-0" />
              <div className="min-w-0">
                <div className="text-sm font-semibold">Guardar en el archivo</div>
                <div className="text-xs opacity-85">
                  Aplica el borrador sobre el archivo original y sincroniza
                </div>
              </div>
            </button>
          )}

          <button
            type="button"
            onClick={onKeepDraft}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-surface-container border border-outline-variant text-left hover:bg-surface-container-highest transition-colors"
          >
            <div className="min-w-0">
              <div className="text-sm font-medium">Conservar borrador</div>
              <div className="text-xs text-on-surface-variant">
                Mantiene los cambios en el buffer (se conservan incluso si cierras la app)
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={onDiscard}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-error-container/60 text-on-error-container text-left hover:bg-error-container transition-colors"
          >
            <RotateCcw className="w-4 h-4 shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-semibold">Descartar cambios</div>
              <div className="text-xs opacity-90">
                No conserva los cambios del buffer y vuelve a la última versión guardada
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};
