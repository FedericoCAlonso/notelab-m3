import React, { useState, useEffect } from 'react';
import { Check, Cloud, Copy, Eye, EyeOff, Loader2, RefreshCw, Server, ShieldAlert, X } from 'lucide-react';
import { CloudSyncSettings, ConnectionSettings } from '../types/nbformat';
import { ConnectionTestResult } from '../services/jupyter/JupyterGateway';
import { CloudTestResult } from '../services/cloud/CloudSyncProvider';
import { DEFAULT_CLOUD_SYNC_SETTINGS } from '../services/storage/NotebookDB';

interface ConnectionDialogProps {
  open: boolean;
  initialTab?: 'jupyter' | 'cloud';
  settings: ConnectionSettings;
  onClose: () => void;
  onSave: (settings: ConnectionSettings) => void;
  onTestConnection: (
    serverUrl: string,
    token: string
  ) => Promise<ConnectionTestResult>;
  onReconnect?: (settings: ConnectionSettings) => Promise<ConnectionTestResult>;
  onTestCloudConnection?: (cloud: CloudSyncSettings) => Promise<CloudTestResult>;
}

export const ConnectionDialog: React.FC<ConnectionDialogProps> = ({
  open,
  initialTab = 'jupyter',
  settings,
  onClose,
  onSave,
  onTestConnection,
  onReconnect,
  onTestCloudConnection,
}) => {
  const [activeTab, setActiveTab] = useState<'jupyter' | 'cloud'>(initialTab);

  // Jupyter fields
  const [serverUrl, setServerUrl] = useState(settings.serverUrl);
  const [token, setToken] = useState(settings.token);
  const [showToken, setShowToken] = useState(false);
  const [testing, setTesting] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
    hint?: string;
  } | null>(null);
  const [copiedSnippet, setCopiedSnippet] = useState(false);

  // Cloud (GitHub) fields
  const [cloud, setCloud] = useState<CloudSyncSettings>(
    settings.cloud ?? DEFAULT_CLOUD_SYNC_SETTINGS
  );
  const [showCloudToken, setShowCloudToken] = useState(false);
  const [testingCloud, setTestingCloud] = useState(false);
  const [cloudTestResult, setCloudTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    if (open) {
      setActiveTab(initialTab);
      setServerUrl(settings.serverUrl);
      setToken(settings.token);
      setTestResult(null);
      setCloud({
        ...DEFAULT_CLOUD_SYNC_SETTINGS,
        ...(settings.cloud ?? {}),
      });
      setCloudTestResult(null);
    }
  }, [open, settings, initialTab]);

  if (!open) return null;

  const currentOrigin =
    typeof window !== 'undefined' ? window.location.origin : 'https://FedericoCAlonso.github.io';
  const currentPwaUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}`
      : 'https://FedericoCAlonso.github.io/notelab-m3/';

  const installerSnippet = `curl -fsSL https://raw.githubusercontent.com/FedericoCAlonso/notelab-m3/main/scripts/install_notelab.sh | bash -s -- "${currentOrigin}" "${currentPwaUrl}"`;

  const corsConfigSnippet = `cat << 'EOF' > ~/.jupyter/jupyter_server_config.py
c.ServerApp.allow_origin = '${currentOrigin}'
c.ServerApp.allow_credentials = True
c.ServerApp.disable_check_xsrf = True
c.ServerApp.ip = '127.0.0.1'
c.ServerApp.port = 8888
EOF
cp ~/.jupyter/jupyter_server_config.py ~/.jupyter/jupyter_notebook_config.py`;

  const buildErrorHint = (res: ConnectionTestResult): string | undefined => {
    switch (res.errorKind) {
      case 'auth':
        return 'Copia el token de ~/.config/notelab/token o ejecuta "notelab" para abrir con auto-login.';
      case 'network_or_cors':
        return `Asegúrate de que Jupyter esté corriendo en ${serverUrl.trim() || 'http://localhost:8888'} y con allow_origin = '${currentOrigin}'.`;
      case 'timeout':
        return 'Si Termux fue suspendido por Android, ábrelo o toca el widget NoteLab.';
      default:
        return undefined;
    }
  };

  const buildNextSettings = (): ConnectionSettings => ({
    ...settings,
    serverUrl: serverUrl.trim() || 'http://localhost:8888',
    token: token.trim(),
    cloud: {
      ...cloud,
      owner: cloud.owner.trim(),
      repo: cloud.repo.trim(),
      branch: cloud.branch.trim() || 'main',
      basePath: cloud.basePath.replace(/^\/+|\/+$/g, '').trim(),
      token: cloud.token.trim(),
    },
  });

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
        hint: buildErrorHint(res),
      });
    }
  };

  const handleReconnectClick = async () => {
    if (!onReconnect) return;
    setReconnecting(true);
    setTestResult(null);
    const next = buildNextSettings();
    const res = await onReconnect(next);
    setReconnecting(false);
    if (res.ok) {
      setTestResult({
        ok: true,
        message: `Kernel reconectado (${res.version ?? 'Jupyter Server'})`,
      });
    } else {
      setTestResult({
        ok: false,
        message: res.error ?? 'No se pudo reconectar el kernel',
        hint: buildErrorHint(res),
      });
    }
  };

  const handleTestCloud = async () => {
    if (!onTestCloudConnection) return;
    setTestingCloud(true);
    setCloudTestResult(null);
    const res = await onTestCloudConnection(buildNextSettings().cloud!);
    setTestingCloud(false);
    if (res.ok) {
      setCloudTestResult({
        ok: true,
        message: `Conectado a ${res.detail ?? 'GitHub'}`,
      });
    } else {
      setCloudTestResult({
        ok: false,
        message: res.error ?? 'No se pudo conectar con GitHub',
      });
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(buildNextSettings());
    onClose();
  };

  const handleCopySnippet = async () => {
    try {
      await navigator.clipboard.writeText(installerSnippet);
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
              {activeTab === 'jupyter' ? (
                <Server className="w-5 h-5" />
              ) : (
                <Cloud className="w-5 h-5" />
              )}
            </div>
            <div>
              <h2 id="conn-dialog-title" className="text-lg font-semibold">
                Conexión y Sincronización
              </h2>
              <p className="text-xs text-on-surface-variant">
                Servidor local Python (Termux) y respaldo en GitHub
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

        {/* M3 Segmented Tabs */}
        <div className="grid grid-cols-2 gap-1 p-1 rounded-full bg-surface-container border border-outline-variant/60">
          <button
            type="button"
            onClick={() => setActiveTab('jupyter')}
            className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-full text-xs font-medium transition-colors ${
              activeTab === 'jupyter'
                ? 'bg-primary text-on-primary shadow-xs'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <Server className="w-3.5 h-3.5" />
            <span>Jupyter (Termux)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('cloud')}
            className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-full text-xs font-medium transition-colors ${
              activeTab === 'cloud'
                ? 'bg-primary text-on-primary shadow-xs'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <Cloud className="w-3.5 h-3.5" />
            <span>Nube (GitHub)</span>
            {cloud.enabled && (
              <span className="w-1.5 h-1.5 rounded-full bg-success" aria-hidden="true" />
            )}
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-3.5">
          {activeTab === 'jupyter' ? (
            <>
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
                    placeholder="Pega el token o usa el lanzador notelab"
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
                  className={`px-3.5 py-2.5 rounded-xl text-xs space-y-1 ${
                    testResult.ok
                      ? 'bg-success-container text-on-success-container'
                      : 'bg-error-container text-on-error-container'
                  }`}
                >
                  <div className="font-medium">{testResult.message}</div>
                  {testResult.hint && <div className="opacity-90">{testResult.hint}</div>}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleTest}
                    disabled={testing || reconnecting}
                    className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full border border-outline text-sm font-medium text-primary hover:bg-primary/10 transition-colors disabled:opacity-60"
                  >
                    {testing && <Loader2 className="w-4 h-4 animate-spin" />}
                    <span>Probar</span>
                  </button>
                  {onReconnect && (
                    <button
                      type="button"
                      onClick={() => void handleReconnectClick()}
                      disabled={testing || reconnecting}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-secondary-container text-on-secondary-container text-sm font-medium hover:opacity-95 transition-opacity disabled:opacity-60"
                    >
                      {reconnecting ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <RefreshCw className="w-4 h-4" />
                      )}
                      <span>Reconectar</span>
                    </button>
                  )}
                </div>

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
            </>
          ) : (
            <>
              <label className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-surface-container border border-outline-variant/60 cursor-pointer">
                <div>
                  <div className="text-sm font-medium">Activar guardado en GitHub</div>
                  <div className="text-xs text-on-surface-variant">
                    Sincroniza tus .ipynb con un repositorio privado automáticamente
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={cloud.enabled}
                  onChange={(e) => setCloud((c) => ({ ...c, enabled: e.target.checked }))}
                  className="w-4 h-4 accent-primary"
                />
              </label>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-medium text-on-surface-variant mb-1">
                    Usuario / Org
                  </label>
                  <input
                    type="text"
                    value={cloud.owner}
                    onChange={(e) => setCloud((c) => ({ ...c, owner: e.target.value }))}
                    placeholder="FedericoCAlonso"
                    className="w-full px-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant focus:border-primary outline-none text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-on-surface-variant mb-1">
                    Repositorio privado
                  </label>
                  <input
                    type="text"
                    value={cloud.repo}
                    onChange={(e) => setCloud((c) => ({ ...c, repo: e.target.value }))}
                    placeholder="mis-apuntes"
                    className="w-full px-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant focus:border-primary outline-none text-sm font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-medium text-on-surface-variant mb-1">
                    Rama
                  </label>
                  <input
                    type="text"
                    value={cloud.branch}
                    onChange={(e) => setCloud((c) => ({ ...c, branch: e.target.value }))}
                    placeholder="main"
                    className="w-full px-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant focus:border-primary outline-none text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-on-surface-variant mb-1">
                    Carpeta (opcional)
                  </label>
                  <input
                    type="text"
                    value={cloud.basePath}
                    onChange={(e) => setCloud((c) => ({ ...c, basePath: e.target.value }))}
                    placeholder="apuntes"
                    className="w-full px-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant focus:border-primary outline-none text-sm font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-on-surface-variant mb-1">
                  Token de GitHub (Fine-grained PAT)
                </label>
                <div className="relative">
                  <input
                    type={showCloudToken ? 'text' : 'password'}
                    value={cloud.token}
                    onChange={(e) => setCloud((c) => ({ ...c, token: e.target.value }))}
                    placeholder="github_pat_..."
                    className="w-full pl-3.5 pr-10 py-2.5 rounded-xl bg-surface-container-lowest border border-outline-variant focus:border-primary outline-none text-sm font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCloudToken((v) => !v)}
                    aria-label="Mostrar/ocultar PAT de GitHub"
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container"
                  >
                    {showCloudToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-surface-container text-[11px] text-on-surface-variant">
                <ShieldAlert className="w-4 h-4 shrink-0 text-warning mt-0.5" />
                <span>
                  El token se guarda solo en IndexedDB en este dispositivo. Usa un{' '}
                  <strong>Fine-grained PAT</strong> limitado únicamente a este repo con permiso{' '}
                  <code className="font-mono">Contents: Read and write</code>.
                </span>
              </div>

              {cloudTestResult && (
                <div
                  className={`px-3.5 py-2.5 rounded-xl text-xs font-medium ${
                    cloudTestResult.ok
                      ? 'bg-success-container text-on-success-container'
                      : 'bg-error-container text-on-error-container'
                  }`}
                >
                  {cloudTestResult.message}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                {onTestCloudConnection ? (
                  <button
                    type="button"
                    onClick={() => void handleTestCloud()}
                    disabled={testingCloud}
                    className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full border border-outline text-sm font-medium text-primary hover:bg-primary/10 transition-colors disabled:opacity-60"
                  >
                    {testingCloud && <Loader2 className="w-4 h-4 animate-spin" />}
                    <span>Probar GitHub</span>
                  </button>
                ) : (
                  <span />
                )}

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
            </>
          )}
        </form>

        {/* Copyable One-Command Installer + Manual CORS fallback (only in Jupyter tab) */}
        {activeTab === 'jupyter' && (
          <div className="pt-3 border-t border-outline-variant/60 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-on-surface">
                Instalación automática (venv + token + lanzador <code className="font-mono">notelab</code>)
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
              Ejecuta esto una vez en Termux o Linux. Crea un entorno aislado, fija un token persistente y configura el acceso directo <code className="font-mono">notelab</code> sin copiar hashes:
            </p>
            <pre className="font-mono text-xs whitespace-pre overflow-x-auto rounded-xl bg-surface-container-lowest border border-outline-variant p-3 text-on-surface">
              {installerSnippet}
            </pre>
            <details className="text-xs text-on-surface-variant">
              <summary className="cursor-pointer select-none font-medium hover:text-on-surface">
                Configuración manual de CORS
              </summary>
              <pre className="mt-2 font-mono text-xs whitespace-pre overflow-x-auto rounded-xl bg-surface-container-lowest border border-outline-variant p-3 text-on-surface">
                {corsConfigSnippet}
              </pre>
            </details>
          </div>
        )}
      </div>
    </div>
  );
};
