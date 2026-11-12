import React, { useState, useEffect } from 'react';
import { Check, Copy, Eye, EyeOff, Loader2, Server, X } from 'lucide-react';
import { ConnectionSettings } from '../types/nbformat';

interface ConnectionDialogProps {
  open: boolean;
  settings: ConnectionSettings;
  onClose: () => void;
  onSave: (settings: ConnectionSettings) => void;
  onTestConnection: (
    serverUrl: string,
    token: string
  ) => Promise<{ ok: boolean; version?: string; error?: string }>;
}

export const ConnectionDialog: React.FC<ConnectionDialogProps> = ({
  open,
  settings,
  onClose,
  onSave,
  onTestConnection,
}) => {
  const [serverUrl, setServerUrl] = useState(settings.serverUrl);
  const [token, setToken] = useState(settings.token);
  const [showToken, setShowToken] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [copiedSnippet, setCopiedSnippet] = useState(false);

  useEffect(() => {
    if (open) {
      setServerUrl(settings.serverUrl);
      setToken(settings.token);
      setTestResult(null);
    }
  }, [open, settings]);

  if (!open) return null;

  const currentOrigin =
    typeof window !== 'undefined' ? window.location.origin : 'https://FedericoCAlonso.github.io';

  const corsConfigSnippet = `cat << 'EOF' > ~/.jupyter/jupyter_server_config.py
c.ServerApp.allow_origin = '${currentOrigin}'
c.ServerApp.allow_credentials = True
c.ServerApp.disable_check_xsrf = True
c.ServerApp.ip = '127.0.0.1'
c.ServerApp.port = 8888
EOF
cp ~/.jupyter/jupyter_server_config.py ~/.jupyter/jupyter_notebook_config.py`;

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    const res = await onTestConnection(serverUrl, token);
    setTesting(false);
    if (res.ok) {
      setTestResult({
        ok: true,
        message: `Conexión exitosa (${res.version ?? 'Jupyter Server'})`,
      });
    } else {
      setTestResult({
        ok: false,
        message: res.error ?? 'No se pudo conectar con el servidor',
      });
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...settings,
      serverUrl: serverUrl.trim() || 'http://localhost:8888',
      token: token.trim(),
    });
    onClose();
  };

  const handleCopySnippet = async () => {
    try {
      await navigator.clipboard.writeText(corsConfigSnippet);
      setCopiedSnippet(true);
      setTimeout(() => setCopiedSnippet(false), 2000);
    } catch {
      // ignore clipboard permissions
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="fixed inset-0 bg-scrim" onClick={onClose} aria-hidden="true" />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="conn-dialog-title"
        className="relative z-10 w-full sm:max-w-lg max-h-[90vh] overflow-y-auto bg-surface-container-high text-on-surface rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 space-y-4"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h2 id="conn-dialog-title" className="text-lg font-semibold">
                Conexión Jupyter (Termux)
              </h2>
              <p className="text-xs text-on-surface-variant">
                Configura el servidor local de Python y sincronización
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar diálogo"
            className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-surface-container-highest"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-3.5">
          <div>
            <label className="block text-xs font-medium text-on-surface-variant mb-1">
              URL del servidor Jupyter
            </label>
            <input
              type="url"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="http://localhost:8888"
              className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-lowest border border-outline-variant focus:border-primary outline-none text-sm font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-on-surface-variant mb-1">
              Token de Jupyter
            </label>
            <div className="relative">
              <input
                type={showToken ? 'text' : 'password'}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Pega el token o déjalo vacío si usas --IdentityProvider.token=''"
                className="w-full pl-3.5 pr-10 py-2.5 rounded-xl bg-surface-container-lowest border border-outline-variant focus:border-primary outline-none text-sm font-mono"
              />
              <button
                type="button"
                onClick={() => setShowToken((v) => !v)}
                aria-label="Mostrar/ocultar token"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container"
              >
                {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {testResult && (
            <div
              className={`px-3.5 py-2.5 rounded-xl text-xs font-medium ${
                testResult.ok
                  ? 'bg-success-container text-on-success-container'
                  : 'bg-error-container text-on-error-container'
              }`}
            >
              {testResult.message}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={handleTest}
              disabled={testing}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-outline text-sm font-medium text-primary hover:bg-primary/10 transition-colors disabled:opacity-60"
            >
              {testing && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>Probar conexión</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-full text-sm font-medium text-on-surface-variant hover:bg-surface-container-highest"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-full bg-primary text-on-primary text-sm font-medium hover:opacity-95"
              >
                Guardar
              </button>
            </div>
          </div>
        </form>

        {/* Copyable Termux CORS Setup */}
        <div className="pt-3 border-t border-outline-variant/60 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-on-surface">
              Configuración rápida de CORS en Termux
            </span>
            <button
              type="button"
              onClick={handleCopySnippet}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-secondary-container text-on-secondary-container text-xs font-medium"
            >
              {copiedSnippet ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedSnippet ? 'Copiado' : 'Copiar'}</span>
            </button>
          </div>
          <p className="text-xs text-on-surface-variant">
            Ejecuta esto en Termux antes de iniciar <code className="font-mono">jupyter lab --no-browser</code> (o usa <code className="font-mono">scripts/configure_jupyter_termux.sh</code>):
          </p>
          <pre className="font-mono text-xs whitespace-pre overflow-x-auto rounded-xl bg-surface-container-lowest border border-outline-variant p-3 text-on-surface">
            {corsConfigSnippet}
          </pre>
        </div>
      </div>
    </div>
  );
};
