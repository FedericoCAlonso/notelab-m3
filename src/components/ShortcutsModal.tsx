import React, { useState } from 'react';
import { Calculator, Check, Copy, Keyboard, Terminal, X } from 'lucide-react';
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
  const [tab, setTab] = useState<'shortcuts' | 'dsl' | 'termux'>('shortcuts');
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
              ) : tab === 'dsl' ? (
                <Calculator className="w-5 h-5" />
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
        <div className="grid grid-cols-3 p-1 rounded-full bg-surface-container border border-outline-variant/60">
          <button
            type="button"
            onClick={() => setTab('shortcuts')}
            className={`py-1.5 px-2 rounded-full text-xs font-medium transition-colors ${
              tab === 'shortcuts'
                ? 'bg-primary text-on-primary'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            Atajos
          </button>
          <button
            type="button"
            onClick={() => setTab('dsl')}
            className={`py-1.5 px-2 rounded-full text-xs font-medium transition-colors ${
              tab === 'dsl'
                ? 'bg-primary text-on-primary'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            Guía DSL .md
          </button>
          <button
            type="button"
            onClick={() => setTab('termux')}
            className={`py-1.5 px-2 rounded-full text-xs font-medium transition-colors ${
              tab === 'termux'
                ? 'bg-primary text-on-primary'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            Termux
          </button>
        </div>

        {tab === 'dsl' ? (
          <div className="space-y-2.5 text-xs text-on-surface">
            <div className="rounded-xl bg-surface-container-low border border-outline-variant/40 p-3 space-y-1">
              <div className="font-semibold text-primary">Atajos en Notas Reactivas (.md)</div>
              <div className="grid grid-cols-2 gap-1 text-on-surface-variant">
                <span><kbd className="font-mono text-on-surface">Enter</kbd> editar bloque</span>
                <span><kbd className="font-mono text-on-surface">Ctrl+Enter</kbd> guardar bloque</span>
                <span><kbd className="font-mono text-on-surface">Alt+↑/↓</kbd> mover bloque</span>
                <span><kbd className="font-mono text-on-surface">Ctrl+O</kbd> índice jerárquico</span>
              </div>
            </div>

            <div className="rounded-xl bg-surface-container-low border border-outline-variant/40 p-3 space-y-1.5">
              <div className="font-semibold text-primary">Cálculos, Unidades y Modos SMath</div>
              <pre className="font-mono text-[11.5px] bg-surface-container p-2 rounded-lg overflow-x-auto m-0">{`\`\`\`calc
@unidad ARS = 1/1200 USD
@decimales 2
P = V * I -> W           # @completo (default)
P_kw = P -> kW @formula  # fórmula + resultado
tot = sum(t.Total) @resultado
\`\`\``}</pre>
              <p className="text-on-surface-variant m-0">
                Usá <code className="font-mono">```calc @oculto</code> para esconder bloques auxiliares en modo Entregable/PDF.
              </p>
            </div>

            <div className="rounded-xl bg-surface-container-low border border-outline-variant/40 p-3 space-y-1.5">
              <div className="font-semibold text-primary">Tablas con Fórmulas por Campo (@tabla / @col)</div>
              <pre className="font-mono text-[11.5px] bg-surface-container p-2 rounded-lg overflow-x-auto m-0">{`@tabla: materiales
@col Subtotal = Cantidad * Precio
@col Total = Subtotal * (1 + iva)`}</pre>
            </div>

            <div className="rounded-xl bg-surface-container-low border border-outline-variant/40 p-3 space-y-1.5">
              <div className="font-semibold text-primary">Interpolación y Controles Bidireccionales</div>
              <ul className="space-y-1 text-on-surface-variant list-disc pl-4 m-0">
                <li><code className="font-mono text-on-surface">{'{{P}}'}</code> o <code className="font-mono text-on-surface">{'{{P -> kW}}'}</code> en texto o dentro de <code className="font-mono">$$...$$</code></li>
                <li><code className="font-mono text-on-surface">[V: 220 V | input min=100 max=400]</code></li>
                <li><code className="font-mono text-on-surface">[I: 4.5 A | slider 0..20 step=0.5]</code></li>
                <li><code className="font-mono text-on-surface">[fp: 0.92 | select 0.8, 0.92, 1.0]</code></li>
              </ul>
            </div>

            <div className="rounded-xl bg-surface-container-low border border-outline-variant/40 p-3 space-y-1.5">
              <div className="font-semibold text-primary">Gráficos Offline (```plot) y Python Híbrido</div>
              <pre className="font-mono text-[11.5px] bg-surface-container p-2 rounded-lg overflow-x-auto m-0">{`\`\`\`plot
titulo: Onda ({{V}})
x: 0..40
y: V * sin(x * pi / 20)
\`\`\``}</pre>
              <p className="text-on-surface-variant m-0">
                En bloques <code className="font-mono">```python</code> (con Termux), tus variables y tablas <code className="font-mono">@tabla:</code> llegan listas como <code className="font-mono">float</code> y <code className="font-mono">pandas.DataFrame</code>.
              </p>
            </div>
          </div>
        ) : tab === 'shortcuts' ? (
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
