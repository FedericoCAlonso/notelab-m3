import React, { useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  Cloud,
  Copy,
  Download,
  FileCode2,
  Folder,
  HardDrive,
  Keyboard,
  Moon,
  MoreVertical,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Server,
  Share2,
  Sun,
  SunMoon,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { JupyterContentItem, ThemePreference } from '../types/nbformat';
import { StoredNotebookRecord } from '../services/storage/NotebookDB';
import { CloudRemoteItem } from '../services/cloud/CloudSyncProvider';
import {
  FileListFilter,
  UnifiedNotebookEntry,
  buildUnifiedFileList,
} from '../services/storage/unifiedFiles';

export type DeleteNotebookScope = 'everywhere' | 'local_only';

interface NavigationDrawerProps {
  open: boolean;
  currentPath: string;
  activeDirPath: string;
  remoteItems: JupyterContentItem[];
  remoteLoading: boolean;
  remoteError: string | null;
  cloudEnabled?: boolean;
  cloudItems?: CloudRemoteItem[];
  cloudLoading?: boolean;
  cloudError?: string | null;
  localNotebooks: StoredNotebookRecord[];
  theme: ThemePreference;
  onClose: () => void;
  onBrowseDirectory: (dirPath: string) => void;
  onSelectNotebook: (path: string, preferredSource?: 'auto' | 'cloud') => void;
  onCreateNotebook: (name: string, dirPath: string) => void;
  onImportNotebook?: (file: File) => void;
  onExportNotebook?: () => void;
  onShareNotebook?: () => void;
  onPrintPdf?: () => void;
  onDuplicateNotebook?: (path: string) => void;
  onRenameNotebookByPath?: (oldPath: string, newName: string) => void;
  onDeleteNotebook?: (path: string, scope: DeleteNotebookScope) => void;
  onOpenSettings: (tab?: 'jupyter' | 'cloud') => void;
  onOpenShortcuts: () => void;
  onCycleTheme: () => void;
}

export const NavigationDrawer: React.FC<NavigationDrawerProps> = ({
  open,
  currentPath,
  activeDirPath,
  remoteItems,
  remoteLoading,
  remoteError,
  cloudEnabled = false,
  cloudItems = [],
  cloudLoading = false,
  cloudError = null,
  localNotebooks,
  theme,
  onClose,
  onBrowseDirectory,
  onSelectNotebook,
  onCreateNotebook,
  onImportNotebook,
  onExportNotebook,
  onShareNotebook,
  onPrintPdf,
  onDuplicateNotebook,
  onRenameNotebookByPath,
  onDeleteNotebook,
  onOpenSettings,
  onOpenShortcuts,
  onCycleTheme,
}) => {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [filter, setFilter] = useState<FileListFilter>('folder');
  const [menuOpenForPath, setMenuOpenForPath] = useState<string | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmDeletePath, setConfirmDeletePath] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const unified = useMemo(
    () =>
      buildUnifiedFileList({
        currentDir: activeDirPath,
        filter,
        localNotebooks,
        remoteItems,
        cloudItems,
        cloudEnabled,
      }),
    [activeDirPath, filter, localNotebooks, remoteItems, cloudItems, cloudEnabled]
  );

  if (!open) return null;

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = newName.trim();
    if (!cleaned) return;
    onCreateNotebook(cleaned, activeDirPath);
    setNewName('');
    setCreating(false);
    onClose();
  };

  const parentDir = activeDirPath.includes('/')
    ? activeDirPath.slice(0, activeDirPath.lastIndexOf('/'))
    : '';

  const themeLabel =
    theme === 'auto' ? 'Auto' : theme === 'dark' ? 'Oscuro' : 'Claro';
  const isRefreshing = remoteLoading || cloudLoading;

  const renderStatusIcons = (entry: UnifiedNotebookEntry) => {
    const hasPending = entry.pendingJupyter || entry.pendingCloud;
    return (
      <span className="shrink-0 flex items-center gap-1 text-[10px]">
        {hasPending && (
          <span
            title="Cambios pendientes de sincronizar"
            className="px-1.5 py-0.5 rounded-full bg-warning-container text-on-warning-container font-medium"
          >
            Pend.
          </span>
        )}
        {!entry.inLocal && !entry.inJupyter && entry.inCloud && (
          <span
            title="Solo en GitHub (toca para abrir)"
            className="px-1.5 py-0.5 rounded-full bg-primary-container text-on-primary-container font-medium"
          >
            Nube
          </span>
        )}
        {entry.inLocal && (
          <HardDrive
            className={`w-3 h-3 ${hasPending ? 'text-warning' : 'text-on-surface-variant/70'}`}
            aria-label="En dispositivo"
          />
        )}
        {entry.inJupyter && (
          <Server
            className={`w-3 h-3 ${entry.pendingJupyter ? 'text-warning' : 'text-success'}`}
            aria-label="En Termux/Jupyter"
          />
        )}
        {cloudEnabled && entry.inCloud && (
          <Cloud
            className={`w-3 h-3 ${entry.pendingCloud ? 'text-warning' : 'text-primary'}`}
            aria-label="En GitHub"
          />
        )}
      </span>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* M3 Scrim */}
      <div
        className="fixed inset-0 bg-scrim transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* M3 Modal Navigation Drawer Sheet */}
      <aside className="relative z-10 w-[88vw] max-w-[360px] h-full bg-surface-container-low text-on-surface rounded-r-3xl shadow-2xl flex flex-col overflow-hidden">
        {/* Drawer Header */}
        <div className="px-4 pt-4 pb-3 border-b border-outline-variant/60 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-on-surface">
              NoteLab M3
            </h2>
            <p className="text-xs text-on-surface-variant">
              Apuntes Local-First &amp; Nube
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onCycleTheme}
              title={`Tema: ${themeLabel}`}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-surface-container-high text-xs font-medium text-on-surface-variant hover:text-on-surface"
            >
              {theme === 'light' ? (
                <Sun className="w-3.5 h-3.5" />
              ) : theme === 'dark' ? (
                <Moon className="w-3.5 h-3.5" />
              ) : (
                <SunMoon className="w-3.5 h-3.5" />
              )}
              <span>{themeLabel}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar menú"
              className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-surface-container-high"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Create Notebook + Export/Import */}
        <div className="px-3 pt-3 pb-2 space-y-2 border-b border-outline-variant/40">
          {creating ? (
            <form onSubmit={handleCreateSubmit} className="flex flex-col gap-2 p-2.5 rounded-2xl bg-surface-container">
              <input
                type="text"
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nombre (ej: Algebra_Lineal)"
                className="w-full px-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant focus:border-primary outline-none text-sm text-on-surface"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setCreating(false);
                    setNewName('');
                  }}
                  className="px-3 py-1.5 rounded-full text-xs font-medium text-on-surface-variant hover:bg-surface-container-high"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-3.5 py-1.5 rounded-full bg-primary text-on-primary text-xs font-medium"
                >
                  Crear .ipynb
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-2xl bg-primary-container text-on-primary-container font-medium text-sm hover:opacity-95 transition-opacity"
            >
              <Plus className="w-4 h-4" />
              <span>Nuevo apunte (.ipynb)</span>
            </button>
          )}

          {/* Export / Import / Share / PDF actions */}
          <div className="grid grid-cols-4 gap-1.5">
            <input
              ref={importInputRef}
              type="file"
              accept=".ipynb,application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file && onImportNotebook) {
                  onImportNotebook(file);
                  onClose();
                }
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              title="Importar archivo .ipynb"
              className="flex flex-col items-center justify-center gap-1 py-2 px-1 rounded-xl bg-surface-container hover:bg-surface-container-high text-[11px] font-medium text-on-surface-variant hover:text-on-surface transition-colors"
            >
              <Upload className="w-3.5 h-3.5 text-primary" />
              <span>Importar</span>
            </button>
            <button
              type="button"
              onClick={() => onExportNotebook?.()}
              title="Descargar .ipynb actual"
              className="flex flex-col items-center justify-center gap-1 py-2 px-1 rounded-xl bg-surface-container hover:bg-surface-container-high text-[11px] font-medium text-on-surface-variant hover:text-on-surface transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-primary" />
              <span>.ipynb</span>
            </button>
            <button
              type="button"
              onClick={() => onShareNotebook?.()}
              title="Compartir apunte (.ipynb)"
              className="flex flex-col items-center justify-center gap-1 py-2 px-1 rounded-xl bg-surface-container hover:bg-surface-container-high text-[11px] font-medium text-on-surface-variant hover:text-on-surface transition-colors"
            >
              <Share2 className="w-3.5 h-3.5 text-primary" />
              <span>Compartir</span>
            </button>
            <button
              type="button"
              onClick={() => {
                onClose();
                setTimeout(() => onPrintPdf?.(), 150);
              }}
              title="Imprimir / Exportar a PDF"
              className="flex flex-col items-center justify-center gap-1 py-2 px-1 rounded-xl bg-surface-container hover:bg-surface-container-high text-[11px] font-medium text-on-surface-variant hover:text-on-surface transition-colors"
            >
              <Printer className="w-3.5 h-3.5 text-primary" />
              <span>PDF</span>
            </button>
          </div>
        </div>

        {/* Unified File Explorer */}
        <div className="flex-1 overflow-y-auto px-3 py-2.5 space-y-2.5">
          {/* Header + Filter Chips */}
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-1">
              {(
                [
                  { id: 'folder', label: 'Carpeta' },
                  { id: 'all', label: 'Todos' },
                  { id: 'pending', label: 'Pendientes' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilter(tab.id)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                    filter === tab.id
                      ? 'bg-secondary-container text-on-secondary-container'
                      : 'text-on-surface-variant hover:bg-surface-container-high'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => onBrowseDirectory(activeDirPath)}
              aria-label="Actualizar apuntes"
              title="Actualizar desde Termux y GitHub"
              className="p-1.5 rounded-full hover:bg-surface-container-high text-on-surface-variant"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Connection status hints (only when there is an error) */}
          {(remoteError || (cloudEnabled && cloudError)) && (
            <div className="flex flex-wrap gap-1.5 px-1 text-[11px]">
              {remoteError && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenSettings('jupyter');
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-container text-on-surface-variant hover:text-primary"
                >
                  <Server className="w-3 h-3" />
                  <span>Termux offline</span>
                </button>
              )}
              {cloudEnabled && cloudError && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenSettings('cloud');
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-error-container text-on-error-container"
                >
                  <Cloud className="w-3 h-3" />
                  <span>Error GitHub →</span>
                </button>
              )}
            </div>
          )}

          {/* Back to parent folder */}
          {filter === 'folder' && activeDirPath && (
            <button
              type="button"
              onClick={() => onBrowseDirectory(parentDir)}
              className="w-full flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-primary hover:bg-surface-container-high"
            >
              <ChevronLeft className="w-4 h-4" />
              <span className="truncate">/{activeDirPath} (Subir)</span>
            </button>
          )}

          {/* Unified Directories + Notebooks */}
          {unified.directories.length === 0 && unified.notebooks.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-on-surface-variant/75">
              {filter === 'pending'
                ? 'Todo está sincronizado.'
                : 'No hay apuntes en esta vista.'}
            </p>
          ) : (
            <ul className="space-y-1">
              {unified.directories.map((dirItem) => (
                <li key={`dir-${dirItem.path}`}>
                  <button
                    type="button"
                    onClick={() => onBrowseDirectory(dirItem.path)}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-full text-left text-sm hover:bg-surface-container-high text-on-surface transition-colors"
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <Folder className="w-4 h-4 shrink-0 text-tertiary" />
                      <span className="truncate">{dirItem.name}</span>
                    </span>
                    <span className="shrink-0 flex items-center gap-1">
                      {dirItem.inJupyter && (
                        <Server className="w-3 h-3 text-on-surface-variant/60" />
                      )}
                      {cloudEnabled && dirItem.inCloud && (
                        <Cloud className="w-3 h-3 text-primary/70" />
                      )}
                    </span>
                  </button>
                </li>
              ))}

              {unified.notebooks.map((entry) => {
                const active = entry.path === currentPath;
                const menuOpen = menuOpenForPath === entry.path;
                const isRenaming = renamingPath === entry.path;
                const isConfirmingDelete = confirmDeletePath === entry.path;
                const label = filter === 'folder' ? entry.name : entry.path;

                return (
                  <li key={`nb-${entry.path}`} className="space-y-1">
                    {isRenaming ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const cleaned = renameDraft.trim();
                          if (cleaned && onRenameNotebookByPath) {
                            onRenameNotebookByPath(entry.path, cleaned);
                          }
                          setRenamingPath(null);
                          setMenuOpenForPath(null);
                        }}
                        className="flex items-center gap-1.5 px-2 py-1.5 rounded-2xl bg-surface-container"
                      >
                        <input
                          type="text"
                          autoFocus
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          className="flex-1 min-w-0 px-2.5 py-1 rounded-lg bg-surface-container-lowest border border-primary outline-none text-xs text-on-surface"
                        />
                        <button
                          type="submit"
                          className="px-2.5 py-1 rounded-full bg-primary text-on-primary text-xs font-medium"
                        >
                          OK
                        </button>
                        <button
                          type="button"
                          onClick={() => setRenamingPath(null)}
                          className="px-2 py-1 rounded-full text-xs text-on-surface-variant"
                        >
                          ×
                        </button>
                      </form>
                    ) : (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            onSelectNotebook(entry.path, entry.preferredLoadSource);
                            onClose();
                          }}
                          className={`flex-1 min-w-0 flex items-center justify-between gap-2 px-3 py-2.5 rounded-full text-left text-sm transition-colors ${
                            active
                              ? 'bg-secondary-container text-on-secondary-container font-semibold'
                              : 'hover:bg-surface-container-high text-on-surface'
                          }`}
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <FileCode2 className="w-4 h-4 shrink-0 text-primary" />
                            <span className="truncate">{label}</span>
                          </span>
                          {renderStatusIcons(entry)}
                        </button>

                        {(entry.inLocal || entry.inJupyter || entry.inCloud) && (
                          <button
                            type="button"
                            aria-label={`Opciones para ${entry.name}`}
                            onClick={() => {
                              setConfirmDeletePath(null);
                              setMenuOpenForPath(menuOpen ? null : entry.path);
                            }}
                            className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    )}

                    {menuOpen && !isRenaming && (
                      <div className="ml-3 mr-1 px-2.5 py-2 rounded-2xl bg-surface-container flex flex-wrap items-center gap-1.5 text-xs">
                        {entry.inLocal && onDuplicateNotebook && (
                          <button
                            type="button"
                            onClick={() => {
                              onDuplicateNotebook(entry.path);
                              setMenuOpenForPath(null);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full hover:bg-surface-container-high text-on-surface"
                          >
                            <Copy className="w-3 h-3" />
                            <span>Duplicar</span>
                          </button>
                        )}
                        {entry.inLocal && onRenameNotebookByPath && (
                          <button
                            type="button"
                            onClick={() => {
                              setRenameDraft(entry.name.replace(/\.ipynb$/i, ''));
                              setRenamingPath(entry.path);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full hover:bg-surface-container-high text-on-surface"
                          >
                            <Pencil className="w-3 h-3" />
                            <span>Renombrar</span>
                          </button>
                        )}
                        {onDeleteNotebook && (
                          isConfirmingDelete ? (
                            <div className="flex flex-wrap items-center gap-1.5 w-full pt-1 border-t border-outline-variant/40">
                              <button
                                type="button"
                                onClick={() => {
                                  onDeleteNotebook(entry.path, 'everywhere');
                                  setConfirmDeletePath(null);
                                  setMenuOpenForPath(null);
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-error text-on-error font-medium"
                              >
                                <Trash2 className="w-3 h-3" />
                                <span>
                                  {entry.inJupyter || entry.inCloud
                                    ? 'Borrar de todos lados'
                                    : 'Confirmar borrar'}
                                </span>
                              </button>
                              {entry.inLocal && (entry.inJupyter || entry.inCloud) && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    onDeleteNotebook(entry.path, 'local_only');
                                    setConfirmDeletePath(null);
                                    setMenuOpenForPath(null);
                                  }}
                                  className="px-2.5 py-1 rounded-full bg-surface-container-highest text-on-surface"
                                >
                                  Solo copia offline
                                </button>
                              )}
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeletePath(entry.path)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full hover:bg-error-container hover:text-on-error-container text-error"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>Eliminar</span>
                            </button>
                          )
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Drawer Footer */}
        <div className="p-3 border-t border-outline-variant/60 space-y-1 bg-surface-container-low">
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenSettings('jupyter');
            }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-full text-sm font-medium text-on-surface hover:bg-surface-container-high transition-colors"
          >
            <Server className="w-4 h-4 text-primary" />
            <span>Conexión Termux / Nube</span>
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenShortcuts();
            }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-full text-sm font-medium text-on-surface hover:bg-surface-container-high transition-colors"
          >
            <Keyboard className="w-4 h-4 text-secondary" />
            <span>Atajos y Guía Termux (Ctrl+/)</span>
          </button>
        </div>
      </aside>
    </div>
  );
};
