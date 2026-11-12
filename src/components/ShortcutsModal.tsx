import React, { useState } from 'react';
import { Check, Copy, Keyboard, Terminal, X } from 'lucide-react';
import { RegisteredCommand } from '../commands/CommandRegistry';

interface ShortcutsModalProps {
  open: boolean;
  commands: RegisteredCommand[];
  onClose: () => void;
}

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({
  open,
  commands,
  onClose,
}) => {
  const [tab, setTab] = useState<'shortcuts' | 'termux'>('shortcuts');
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'https://FedericoCAlonso.github.io';

  const termuxScriptCmd = `curl -fsSL https://raw.githubusercontent.com/FedericoCAlonso/notelab-m3/main/scripts/configure_jupyter_termux.sh | bash -s -- "${origin}"`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(termuxScriptCmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="fixed inset-0 bg-scrim" onClick={onClose} aria-hidden="true" />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-modal-title"
        className="relative z-10 w-full sm:max-w-lg max-h-[88vh] overflow-y-auto bg-surface-container-high text-on-surface rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 space-y-4"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center">
              {tab === 'shortcuts' ? (
                <Keyboard className="w-5 h-5" />
              ) : (
                <Terminal className="w-5 h-5" />
              )}
            </div>
            <div>
              <h2 id="shortcuts-modal-title" className="text-lg font-semibold">
                Guía Rápida NoteLab M3
              </h2>
              <p className="text-xs text-on-surface-variant">
                Optimizado para teclado físico en Android (sin depender de Esc)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-surface-container-highest"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* M3 Segmented Tabs */}
        <div className="grid grid-cols-2 p-1 rounded-full bg-surface-container border border-outline-variant/60">
          <button
            type="button"
            onClick={() => setTab('shortcuts')}
            className={`py-1.5 px-3 rounded-full text-xs font-medium transition-colors ${
              tab === 'shortcuts'
                ? 'bg-primary text-on-primary'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            Atajos de teclado
          </button>
          <button
            type="button"
            onClick={() => setTab('termux')}
            className={`py-1.5 px-3 rounded-full text-xs font-medium transition-colors ${
              tab === 'termux'
                ? 'bg-primary text-on-primary'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            Configurar Termux
          </button>
        </div>

        {tab === 'shortcuts' ? (
          <div className="space-y-2">
            {commands.map((cmd) => (
              <div
                key={cmd.id}
                className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-surface-container-low border border-outline-variant/40"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-on-surface">
                    {cmd.label}
                  </div>
                  <div className="text-xs text-on-surface-variant">
                    {cmd.description}
                  </div>
                </div>
                <kbd className="shrink-0 px-2.5 py-1 rounded-lg bg-surface-container-highest text-on-surface font-mono text-xs border border-outline-variant">
                  {cmd.shortcutDisplay}
                </kbd>
              </div>
            ))}
            <p className="text-xs text-on-surface-variant pt-1">
              Nota Android: Chrome usa <kbd className="font-mono">Esc</kbd> como botón Atrás; usa{' '}
              <kbd className="font-mono">Ctrl + Enter</kbd> o <kbd className="font-mono">Shift + Enter</kbd> para renderizar y salir de edición.
            </p>
          </div>
        ) : (
          <div className="space-y-3 text-sm text-on-surface-variant">
            <p>
              Para conectar NoteLab M3 con Jupyter Server corriendo dentro de{' '}
              <strong className="text-on-surface">Termux</strong> en tu teléfono Android, ejecuta el script{' '}
              <code className="font-mono text-xs bg-surface-container px-1.5 py-0.5 rounded">
                scripts/configure_jupyter_termux.sh
              </code>
              :
            </p>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-on-surface">
                  Comando automático en Termux
                </span>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-secondary-container text-on-secondary-container text-xs font-medium"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copiado' : 'Copiar'}</span>
                </button>
              </div>
              <pre className="font-mono text-xs whitespace-pre-wrap break-all rounded-xl bg-surface-container-lowest border border-outline-variant p-3 text-on-surface">
                {termuxScriptCmd}
              </pre>
            </div>

            <div className="rounded-xl bg-surface-container-low p-3 text-xs space-y-1.5 border border-outline-variant/50">
              <div className="font-semibold text-on-surface">Pasos en Termux:</div>
              <ol className="list-decimal pl-4 space-y-1">
                <li>Instala Jupyter: <code className="font-mono">pip install jupyterlab ipykernel</code></li>
                <li>Ejecuta el script de configuración CORS arriba indicado.</li>
                <li>Inicia el servidor: <code className="font-mono">jupyter server --no-browser</code> (o <code className="font-mono">jupyter lab --no-browser</code>).</li>
                <li>Copia el <code className="font-mono">token=...</code> en <strong>Conexión Termux</strong>.</li>
              </ol>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
