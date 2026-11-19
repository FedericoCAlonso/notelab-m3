import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Package, Play, RefreshCw, Trash2, X } from 'lucide-react';
import {
  InstalledPackage,
  PackageExecutor,
  installPackages,
  listInstalledPackages,
  parsePackageInput,
  uninstallPackages,
} from '../services/python/packageManager';

export interface PackageInstallRequest {
  /** Increments on every request so the same package can be requested twice. */
  requestId: number;
  packages: string[];
  /** Cell to offer re-running once the installation succeeded. */
  rerunCellId?: string;
}

interface PackagesDialogProps {
  open: boolean;
  request: PackageInstallRequest | null;
  exec: PackageExecutor;
  onClose: () => void;
  onRerunCell?: (cellId: string) => void;
}

type BusyState = 'idle' | 'listing' | 'installing' | 'uninstalling';

export const PackagesDialog: React.FC<PackagesDialogProps> = ({
  open,
  request,
  exec,
  onClose,
  onRerunCell,
}) => {
  const [input, setInput] = useState('');
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState<BusyState>('idle');
  const [log, setLog] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lastOk, setLastOk] = useState<boolean | null>(null);
  const [installed, setInstalled] = useState<InstalledPackage[]>([]);
  const [pythonPath, setPythonPath] = useState<string | null>(null);
  const [rerunCellId, setRerunCellId] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const logRef = useRef<HTMLPreElement | null>(null);
  const handledRequestRef = useRef<number | null>(null);

  const refreshInstalled = useCallback(async () => {
    setBusy('listing');
    setError(null);
    try {
      const res = await listInstalledPackages(exec);
      setInstalled(res.packages);
      setPythonPath(res.pythonPath);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo listar los paquetes');
    } finally {
      setBusy('idle');
    }
  }, [exec]);

  const runInstall = useCallback(
    async (specs: string[]) => {
      setBusy('installing');
      setError(null);
      setLastOk(null);
      setLog(`$ pip install ${specs.join(' ')}\n`);
      const res = await installPackages(exec, specs, (text) =>
        setLog(`$ pip install ${specs.join(' ')}\n${text}`)
      );
      if (res.log) setLog(`$ pip install ${specs.join(' ')}\n${res.log}`);
      setLastOk(res.ok);
      if (!res.ok) setError(res.error ?? 'La instalación falló');
      setBusy('idle');
      if (res.ok) {
        setInput('');
        await refreshInstalled();
      }
    },
    [exec, refreshInstalled]
  );

  const runUninstall = useCallback(
    async (name: string) => {
      setBusy('uninstalling');
      setError(null);
      setLastOk(null);
      setConfirmRemove(null);
      setLog(`$ pip uninstall -y ${name}\n`);
      const res = await uninstallPackages(exec, [name], (text) =>
        setLog(`$ pip uninstall -y ${name}\n${text}`)
      );
      if (res.log) setLog(`$ pip uninstall -y ${name}\n${res.log}`);
      setLastOk(res.ok);
      if (!res.ok) setError(res.error ?? 'No se pudo desinstalar');
      setBusy('idle');
      await refreshInstalled();
    },
    [exec, refreshInstalled]
  );

  // Load installed packages whenever the dialog opens (an install request refreshes the list itself)
  useEffect(() => {
    if (!open) return;
    if (request && handledRequestRef.current !== request.requestId) return;
    void refreshInstalled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, refreshInstalled]);

  // Handle one-tap install requests (e.g. from a ModuleNotFoundError output)
  useEffect(() => {
    if (!open || !request) return;
    if (handledRequestRef.current === request.requestId) return;
    handledRequestRef.current = request.requestId;
    setRerunCellId(request.rerunCellId ?? null);
    setInput(request.packages.join(' '));
    void runInstall(request.packages);
  }, [open, request, runInstall]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [log]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = q ? installed.filter((p) => p.name.toLowerCase().includes(q)) : installed;
    return list.slice(0, 200);
  }, [installed, filter]);

  if (!open) return null;

  const parsed = parsePackageInput(input);
  const isBusy = busy === 'installing' || busy === 'uninstalling';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy || parsed.valid.length === 0 || parsed.invalid.length > 0) return;
    setRerunCellId(null);
    void runInstall(parsed.valid);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="fixed inset-0 bg-scrim" onClick={isBusy ? undefined : onClose} aria-hidden="true" />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="packages-dialog-title"
        className="relative z-10 w-full sm:max-w-lg max-h-[90vh] overflow-y-auto bg-surface-container-high text-on-surface rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 space-y-3.5"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-10 h-10 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center shrink-0">
              <Package className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 id="packages-dialog-title" className="text-base font-semibold">
                Paquetes de Python
              </h2>
              <p
                className="text-[11px] text-on-surface-variant font-mono truncate"
                title={pythonPath ?? undefined}
              >
                {pythonPath ?? (busy === 'listing' ? 'Iniciando kernel…' : 'Kernel sin conectar')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isBusy}
            aria-label="Cerrar"
            className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-surface-container-highest disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-1.5">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={isBusy}
              placeholder="numpy pandas matplotlib==3.9.0"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant focus:border-primary outline-none text-sm font-mono text-on-surface disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={isBusy || parsed.valid.length === 0 || parsed.invalid.length > 0}
              className="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-primary text-on-primary text-sm font-medium disabled:opacity-50"
            >
              {busy === 'installing' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              <span>Instalar</span>
            </button>
          </div>
          {parsed.invalid.length > 0 && (
            <p className="text-[11px] text-error px-1">
              No válido: {parsed.invalid.join(', ')} (solo nombres de PyPI con versión opcional)
            </p>
          )}
        </form>

        {(log || error) && (
          <div className="space-y-1.5">
            {log && (
              <pre
                ref={logRef}
                className="font-mono text-[11.5px] leading-snug whitespace-pre-wrap break-all max-h-44 overflow-y-auto rounded-xl bg-surface-container-lowest border border-outline-variant p-2.5 m-0"
              >
                {log}
              </pre>
            )}
            {error && (
              <div className="px-3 py-2 rounded-xl bg-error-container text-on-error-container text-xs font-medium">
                {error}
              </div>
            )}
            {lastOk && !error && busy === 'idle' && (
              <div className="px-3 py-2 rounded-xl bg-success-container text-on-success-container text-xs font-medium flex items-center justify-between gap-2">
                <span>Listo. Ya podés importar el paquete.</span>
                {rerunCellId && onRerunCell && (
                  <button
                    type="button"
                    onClick={() => {
                      const id = rerunCellId;
                      onClose();
                      onRerunCell(id);
                    }}
                    className="shrink-0 px-3 py-1 rounded-full bg-primary text-on-primary font-semibold"
                  >
                    Reejecutar celda
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={`Instalados (${installed.length}) — filtrar…`}
              className="flex-1 min-w-0 px-3 py-1.5 rounded-xl bg-surface-container border border-outline-variant/60 focus:border-primary outline-none text-xs text-on-surface"
            />
            <button
              type="button"
              onClick={() => void refreshInstalled()}
              disabled={busy !== 'idle'}
              aria-label="Actualizar lista"
              className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface-container-highest disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${busy === 'listing' ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <ul className="max-h-52 overflow-y-auto space-y-0.5">
            {filtered.length === 0 && busy !== 'listing' && (
              <li className="px-2 py-3 text-center text-xs text-on-surface-variant/75">
                {installed.length === 0 ? 'Sin datos del kernel todavía.' : 'Sin coincidencias.'}
              </li>
            )}
            {filtered.map((pkg) => (
              <li
                key={pkg.name}
                className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl hover:bg-surface-container"
              >
                <span className="min-w-0 truncate text-sm">
                  {pkg.name}{' '}
                  <span className="text-xs text-on-surface-variant font-mono">{pkg.version}</span>
                </span>
                {confirmRemove === pkg.name ? (
                  <span className="shrink-0 flex items-center gap-1 text-xs">
                    <button
                      type="button"
                      onClick={() => void runUninstall(pkg.name)}
                      className="px-2.5 py-1 rounded-full bg-error text-on-error font-medium"
                    >
                      Quitar
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmRemove(null)}
                      className="px-2 py-1 rounded-full text-on-surface-variant"
                    >
                      ×
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmRemove(pkg.name)}
                    disabled={isBusy}
                    aria-label={`Desinstalar ${pkg.name}`}
                    className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-on-surface-variant hover:text-error hover:bg-error-container/50 disabled:opacity-40"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};
