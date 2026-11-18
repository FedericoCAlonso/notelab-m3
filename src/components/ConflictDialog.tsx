import React, { useState } from 'react';
import { AlertTriangle, CloudDownload, CopyPlus, Loader2, Upload, X } from 'lucide-react';
import { SyncConflict } from '../services/sync/SyncEngine';

interface ConflictDialogProps {
  conflict: SyncConflict | null;
  onKeepLocal: (conflict: SyncConflict) => Promise<void>;
  onUseRemote: (conflict: SyncConflict) => Promise<void>;
  onSaveCopy: (conflict: SyncConflict) => Promise<void>;
  onDismiss: () => void;
}

export const ConflictDialog: React.FC<ConflictDialogProps> = ({
  conflict,
  onKeepLocal,
  onUseRemote,
  onSaveCopy,
  onDismiss,
}) => {
  const [busyAction, setBusyAction] = useState<'local' | 'remote' | 'copy' | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!conflict) return null;

  const targetLabel = conflict.target === 'cloud' ? 'GitHub (Nube)' : 'Jupyter (Termux)';

  const runAction = async (
    action: 'local' | 'remote' | 'copy',
    fn: (c: SyncConflict) => Promise<void>
  ) => {
    setBusyAction(action);
    setErrorMsg(null);
    try {
      await fn(conflict);
    } catch (error) {
      setErrorMsg(
        error instanceof Error ? error.message : 'No se pudo resolver el conflicto'
      );
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="fixed inset-0 bg-scrim" onClick={onDismiss} aria-hidden="true" />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="conflict-dialog-title"
        className="relative z-10 w-full sm:max-w-md bg-surface-container-high text-on-surface rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 space-y-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-full bg-warning-container text-on-warning-container flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h2 id="conflict-dialog-title" className="text-base font-semibold">
                Conflicto de sincronización
              </h2>
              <p className="text-xs text-on-surface-variant">
                {targetLabel} · <span className="font-mono">{conflict.path}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            disabled={busyAction !== null}
            aria-label="Cerrar diálogo"
            className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-surface-container-highest disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-on-surface-variant">
          {conflict.message} Elige cómo quieres resolverlo sin perder tu trabajo:
        </p>

        {errorMsg && (
          <div className="px-3.5 py-2.5 rounded-xl bg-error-container text-on-error-container text-xs font-medium">
            {errorMsg}
          </div>
        )}

        <div className="space-y-2 pt-1">
          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => void runAction('copy', onSaveCopy)}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-primary-container text-on-primary-container text-left hover:opacity-95 transition-opacity disabled:opacity-60"
          >
            {busyAction === 'copy' ? (
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            ) : (
              <CopyPlus className="w-4 h-4 shrink-0" />
            )}
            <div className="min-w-0">
              <div className="text-sm font-semibold">Guardar copia local (Recomendado)</div>
              <div className="text-xs opacity-85">
                Respalda tus cambios locales en otro .ipynb y descarga la versión remota
              </div>
            </div>
          </button>

          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => void runAction('local', onKeepLocal)}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-surface-container border border-outline-variant text-left hover:bg-surface-container-highest transition-colors disabled:opacity-60"
          >
            {busyAction === 'local' ? (
              <Loader2 className="w-4 h-4 animate-spin shrink-0 text-primary" />
            ) : (
              <Upload className="w-4 h-4 shrink-0 text-primary" />
            )}
            <div className="min-w-0">
              <div className="text-sm font-medium">Conservar local</div>
              <div className="text-xs text-on-surface-variant">
                Sobrescribe el archivo remoto con tu versión de este dispositivo
              </div>
            </div>
          </button>

          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => void runAction('remote', onUseRemote)}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-surface-container border border-outline-variant text-left hover:bg-surface-container-highest transition-colors disabled:opacity-60"
          >
            {busyAction === 'remote' ? (
              <Loader2 className="w-4 h-4 animate-spin shrink-0 text-error" />
            ) : (
              <CloudDownload className="w-4 h-4 shrink-0 text-error" />
            )}
            <div className="min-w-0">
              <div className="text-sm font-medium">Usar versión remota</div>
              <div className="text-xs text-on-surface-variant">
                Descarta los cambios locales no sincronizados y carga la versión de {targetLabel}
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};
