import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Calculator,
  Check,
  CheckCircle2,
  Cloud,
  CloudOff,
  Cpu,
  Loader2,
  Menu,
  AlertCircle,
  Package,
  RefreshCw,
  RotateCcw,
  Save,
  Square,
  Power,
  Play,
} from 'lucide-react';
import { SyncStatus } from '../types/nbformat';
import { KernelState } from '../state/machines';
import { KernelSpecInfo } from '../services/jupyter/JupyterGateway';
import { ReactiveStatusSummary } from './reactive/ReactiveDocWorkspace';

interface TopAppBarProps {
  title: string;
  activeDocKind?: 'ipynb' | 'md';
  reactiveStatus?: ReactiveStatusSummary | null;
  syncStatus: SyncStatus;
  cloudSyncStatus?: SyncStatus | null;
  hasUnsavedChanges?: boolean;
  kernelState: KernelState;
  kernelSpecs?: KernelSpecInfo[];
  activeKernelName?: string;
  onOpenDrawer: () => void;
  onRenameTitle: (newTitle: string) => void;
  onTitleEditingChange: (editing: boolean) => void;
  onStartKernel: () => void;
  onInterruptKernel: () => void;
  onRestartKernel: () => void;
  onShutdownKernel: () => void;
  onSelectKernelSpec?: (name: string) => void;
  onRefreshKernelSpecs?: () => void;
  onOpenPackages?: () => void;
  onForceSync: () => void;
  onDiscardChanges?: () => void;
}

export const TopAppBar: React.FC<TopAppBarProps> = ({
  title,
  activeDocKind = 'ipynb',
  reactiveStatus = null,
  syncStatus,
  cloudSyncStatus = null,
  hasUnsavedChanges = false,
  kernelState,
  kernelSpecs = [],
  activeKernelName = 'python3',
  onOpenDrawer,
  onRenameTitle,
  onTitleEditingChange,
  onStartKernel,
  onInterruptKernel,
  onRestartKernel,
  onShutdownKernel,
  onSelectKernelSpec,
  onRefreshKernelSpecs,
  onOpenPackages,
  onForceSync,
  onDiscardChanges,
}) => {
  const [hidden, setHidden] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const [kernelMenuOpen, setKernelMenuOpen] = useState(false);

  const lastScrollY = useRef(0);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const kernelMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setDraftTitle(title);
  }, [title]);

  useEffect(() => {
    const handleScroll = () => {
      const currentY = window.scrollY;
      if (currentY <= 24) {
        setHidden(false);
      } else if (currentY - lastScrollY.current > 10) {
        setHidden(true);
        setKernelMenuOpen(false);
      } else if (lastScrollY.current - currentY > 8) {
        setHidden(false);
      }
      lastScrollY.current = currentY;
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (!kernelMenuOpen) return;
    const close = (e: MouseEvent) => {
      if (kernelMenuRef.current && !kernelMenuRef.current.contains(e.target as Node)) {
        setKernelMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [kernelMenuOpen]);

  const startTitleEdit = () => {
    setDraftTitle(title);
    setEditingTitle(true);
    onTitleEditingChange(true);
    setTimeout(() => titleInputRef.current?.select(), 10);
  };

  const commitTitleEdit = () => {
    setEditingTitle(false);
    onTitleEditingChange(false);
    const cleaned = draftTitle.trim();
    if (cleaned && cleaned !== title) {
      onRenameTitle(cleaned);
    } else {
      setDraftTitle(title);
    }
  };

  const syncBadge = (() => {
    switch (syncStatus) {
      case 'synced':
        return {
          label: 'Sincronizado',
          cls: 'bg-success-container text-on-success-container',
          icon: <CheckCircle2 className="w-3.5 h-3.5" />,
        };
      case 'saving':
        return {
          label: 'Guardando...',
          cls: 'bg-primary-container text-on-primary-container',
          icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />,
        };
      case 'pending':
        return {
          label: 'Pendiente',
          cls: 'bg-warning-container text-on-warning-container',
          icon: <RefreshCw className="w-3.5 h-3.5" />,
        };
      case 'offline':
        return {
          label: 'Local',
          cls: 'bg-surface-container-highest text-on-surface-variant',
          icon: <CloudOff className="w-3.5 h-3.5" />,
        };
      case 'error':
        return {
          label: 'Error sync',
          cls: 'bg-error-container text-on-error-container',
          icon: <AlertCircle className="w-3.5 h-3.5" />,
        };
      case 'conflict':
        return {
          label: 'Conflicto',
          cls: 'bg-warning-container text-on-warning-container',
          icon: <AlertTriangle className="w-3.5 h-3.5" />,
        };
    }
  })();

  const cloudBadge = (() => {
    if (!cloudSyncStatus) return null;
    switch (cloudSyncStatus) {
      case 'synced':
        return {
          title: 'GitHub Nube: Sincronizado',
          cls: 'bg-success-container text-on-success-container',
          icon: <Cloud className="w-3.5 h-3.5" />,
        };
      case 'saving':
        return {
          title: 'GitHub Nube: Guardando...',
          cls: 'bg-primary-container text-on-primary-container',
          icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />,
        };
      case 'pending':
        return {
          title: 'GitHub Nube: Pendiente',
          cls: 'bg-warning-container text-on-warning-container',
          icon: <Cloud className="w-3.5 h-3.5" />,
        };
      case 'offline':
        return {
          title: 'GitHub Nube: Sin conexión',
          cls: 'bg-surface-container-highest text-on-surface-variant',
          icon: <CloudOff className="w-3.5 h-3.5" />,
        };
      case 'conflict':
        return {
          title: 'GitHub Nube: Conflicto pendiente',
          cls: 'bg-warning-container text-on-warning-container',
          icon: <AlertTriangle className="w-3.5 h-3.5" />,
        };
      case 'error':
        return {
          title: 'GitHub Nube: Error al sincronizar',
          cls: 'bg-error-container text-on-error-container',
          icon: <AlertCircle className="w-3.5 h-3.5" />,
        };
    }
  })();

  const kernelChip = (() => {
    switch (kernelState) {
      case 'DISCONNECTED':
        return {
          label: 'Py Off',
          dotCls: 'bg-outline',
          chipCls: 'border-outline-variant text-on-surface-variant bg-surface-container-low',
        };
      case 'CONNECTING':
        return {
          label: 'Conectando',
          dotCls: 'bg-warning animate-pulse',
          chipCls: 'border-warning/50 text-on-warning-container bg-warning-container/60',
        };
      case 'IDLE':
        return {
          label: 'Py Listo',
          dotCls: 'bg-success',
          chipCls: 'border-success/50 text-on-success-container bg-success-container/50',
        };
      case 'BUSY':
        return {
          label: 'Ejecutando',
          dotCls: 'bg-primary animate-ping',
          chipCls: 'border-primary text-on-primary-container bg-primary-container',
        };
      case 'DEAD':
        return {
          label: 'Py Muerto',
          dotCls: 'bg-error',
          chipCls: 'border-error text-on-error-container bg-error-container',
        };
    }
  })();

  return (
    <header
      className={`notelab-no-print fixed top-0 left-0 right-0 z-30 h-14 bg-surface/95 backdrop-blur-md border-b border-outline-variant/60 transition-transform duration-200 ease-out ${
        hidden && !editingTitle ? '-translate-y-full' : 'translate-y-0'
      }`}
    >
      <div className="h-full w-full px-2 sm:px-3 flex items-center justify-between gap-1.5">
        {/* Left: Menu + Editable Title */}
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <button
            type="button"
            onClick={onOpenDrawer}
            aria-label="Abrir menú de navegación"
            className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-on-surface hover:bg-surface-container-high active:bg-surface-container-highest transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>

          {editingTitle ? (
            <input
              ref={titleInputRef}
              type="text"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              onBlur={commitTitleEdit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitTitleEdit();
                } else if (e.key === 'Escape') {
                  setDraftTitle(title);
                  setEditingTitle(false);
                  onTitleEditingChange(false);
                }
              }}
              aria-label="Título del apunte"
              className="min-w-0 flex-1 bg-surface-container-high text-on-surface text-base font-medium px-2.5 py-1 rounded-lg border border-primary outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={startTitleEdit}
              title="Tocar para renombrar apunte"
              className="min-w-0 flex-1 text-left px-1.5 py-1 rounded-lg hover:bg-surface-container-low transition-colors truncate text-base font-medium text-on-surface inline-flex items-center gap-1"
            >
              <span className="truncate">{title}</span>
              {hasUnsavedChanges && (
                <span
                  title="Borrador sin guardar"
                  aria-label="Cambios sin guardar"
                  className="shrink-0 w-2 h-2 rounded-full bg-warning"
                />
              )}
            </button>
          )}
        </div>

        {/* Right: Reactive Chip (.md) OR Jupyter Sync/Kernel Controls (.ipynb) */}
        {activeDocKind === 'md' ? (
          <div className="flex items-center gap-1.5 shrink-0">
            <span
              className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border text-xs font-medium ${
                reactiveStatus && reactiveStatus.errorCount > 0
                  ? 'border-error/60 bg-error-container/70 text-on-error-container'
                  : 'border-primary/40 bg-primary-container/60 text-on-primary-container'
              }`}
              title="Motor de cálculo reactivo local (sin backend)"
            >
              <Calculator className="w-3.5 h-3.5 shrink-0" />
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  reactiveStatus && reactiveStatus.errorCount > 0
                    ? 'bg-error'
                    : 'bg-success'
                }`}
              />
              <span>
                {reactiveStatus && reactiveStatus.errorCount > 0
                  ? `${reactiveStatus.errorCount} err`
                  : 'Reactivo .md'}
              </span>
            </span>
          </div>
        ) : (
        <div className="flex items-center gap-1.5 shrink-0">
          {hasUnsavedChanges && (
            <>
              <button
                type="button"
                onClick={onForceSync}
                title="Guardar cambios sobre el archivo (Ctrl+S)"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary text-on-primary text-[11px] font-semibold shadow-sm hover:opacity-95 transition-opacity"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Guardar</span>
              </button>
              {onDiscardChanges && (
                <button
                  type="button"
                  onClick={onDiscardChanges}
                  title="Descartar cambios del borrador sin guardar"
                  aria-label="Descartar cambios sin guardar"
                  className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-surface-container-highest text-on-surface-variant hover:text-error hover:bg-error-container/60 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              )}
            </>
          )}
          {cloudBadge && (
            <button
              type="button"
              onClick={onForceSync}
              title={`${cloudBadge.title} (tocar o Ctrl+S para sincronizar)`}
              aria-label={cloudBadge.title}
              className={`inline-flex items-center justify-center w-7 h-7 rounded-full transition-colors ${cloudBadge.cls}`}
            >
              {cloudBadge.icon}
            </button>
          )}
          <button
            type="button"
            onClick={onForceSync}
            title={`Termux: ${syncBadge.label} (tocar o Ctrl+S para sincronizar)`}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium transition-colors ${syncBadge.cls}`}
          >
            {syncBadge.icon}
            {!hasUnsavedChanges && (
              <span className="hidden xs:inline sm:inline">{syncBadge.label}</span>
            )}
          </button>

          <div className="relative" ref={kernelMenuRef}>
            <button
              type="button"
              onClick={() => {
                const next = !kernelMenuOpen;
                setKernelMenuOpen(next);
                if (next) {
                  onRefreshKernelSpecs?.();
                }
              }}
              title="Estado del Kernel Python"
              className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border text-xs font-medium transition-colors ${kernelChip.chipCls}`}
            >
              <Cpu className="w-3.5 h-3.5 shrink-0" />
              <span className={`w-2 h-2 rounded-full shrink-0 ${kernelChip.dotCls}`} />
              <span>{kernelChip.label}</span>
            </button>

            {kernelMenuOpen && (
              <div className="absolute right-0 mt-1.5 w-56 rounded-2xl bg-surface-container-high border border-outline-variant shadow-lg py-1.5 z-50">
                {(kernelState === 'DISCONNECTED' || kernelState === 'DEAD') && (
                  <button
                    type="button"
                    onClick={() => {
                      setKernelMenuOpen(false);
                      onStartKernel();
                    }}
                    className="w-full px-3.5 py-2 text-left text-sm text-on-surface hover:bg-surface-container-highest flex items-center gap-2.5"
                  >
                    <Play className="w-4 h-4 text-primary" />
                    <span>Iniciar Kernel</span>
                  </button>
                )}

                {kernelState === 'BUSY' && (
                  <button
                    type="button"
                    onClick={() => {
                      setKernelMenuOpen(false);
                      onInterruptKernel();
                    }}
                    className="w-full px-3.5 py-2 text-left text-sm text-on-surface hover:bg-surface-container-highest flex items-center gap-2.5"
                  >
                    <Square className="w-4 h-4 text-warning" />
                    <span>Interrumpir</span>
                  </button>
                )}

                {(kernelState === 'IDLE' || kernelState === 'BUSY' || kernelState === 'DEAD') && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setKernelMenuOpen(false);
                        onRestartKernel();
                      }}
                      className="w-full px-3.5 py-2 text-left text-sm text-on-surface hover:bg-surface-container-highest flex items-center gap-2.5"
                    >
                      <RefreshCw className="w-4 h-4 text-primary" />
                      <span>Reiniciar Kernel</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setKernelMenuOpen(false);
                        onShutdownKernel();
                      }}
                      className="w-full px-3.5 py-2 text-left text-sm text-error hover:bg-error-container/40 flex items-center gap-2.5"
                    >
                      <Power className="w-4 h-4" />
                      <span>Apagar Kernel</span>
                    </button>
                  </>
                )}

                {onOpenPackages && (
                  <button
                    type="button"
                    onClick={() => {
                      setKernelMenuOpen(false);
                      onOpenPackages();
                    }}
                    className="w-full px-3.5 py-2 text-left text-sm text-on-surface hover:bg-surface-container-highest flex items-center gap-2.5"
                  >
                    <Package className="w-4 h-4 text-primary" />
                    <span>Paquetes (pip)</span>
                  </button>
                )}

                {kernelSpecs.length > 0 && onSelectKernelSpec && (
                  <div className="mt-1 pt-1 border-t border-outline-variant/60">
                    <div className="px-3.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant">
                      Entorno (Kernelspec)
                    </div>
                    <div className="max-h-40 overflow-y-auto">
                      {kernelSpecs.map((spec) => {
                        const selected = spec.name === activeKernelName;
                        return (
                          <button
                            key={spec.name}
                            type="button"
                            onClick={() => {
                              setKernelMenuOpen(false);
                              onSelectKernelSpec(spec.name);
                            }}
                            className={`w-full px-3.5 py-1.5 text-left text-xs flex items-center justify-between gap-2 hover:bg-surface-container-highest ${
                              selected ? 'text-primary font-semibold' : 'text-on-surface'
                            }`}
                          >
                            <span className="truncate">{spec.displayName}</span>
                            {selected && <Check className="w-3.5 h-3.5 shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        )}
      </div>
    </header>
  );
};
