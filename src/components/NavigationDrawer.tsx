import React, { useRef, useState } from 'react';
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

interface NavigationDrawerProps {
  open: boolean;
  currentPath: string;
  remoteDirPath: string;
  remoteItems: JupyterContentItem[];
  remoteLoading: boolean;
  remoteError: string | null;
  cloudEnabled?: boolean;
  cloudDirPath?: string;
  cloudItems?: CloudRemoteItem[];
  cloudLoading?: boolean;
  cloudError?: string | null;
  localNotebooks: StoredNotebookRecord[];
  theme: ThemePreference;
  onClose: () => void;
  onBrowseDirectory: (dirPath: string) => void;
  onBrowseCloudDirectory?: (dirPath: string) => void;
  onSelectNotebook: (path: string, preferredSource?: 'auto' | 'cloud') => void;
  onCreateNotebook: (name: string, dirPath: string) => void;
  onImportNotebook?: (file: File) => void;
  onExportNotebook?: () => void;
  onShareNotebook?: () => void;
  onPrintPdf?: () => void;
  onDuplicateNotebook?: (path: string) => void;
  onRenameNotebookByPath?: (oldPath: string, newName: string) => void;
  onDeleteNotebook?: (path: string) => void;
  onOpenSettings: (tab?: 'jupyter' | 'cloud') => void;
  onOpenShortcuts: () => void;
  onCycleTheme: () => void;
}

export const NavigationDrawer: React.FC<NavigationDrawerProps> = ({
  open,
  currentPath,
  remoteDirPath,
  remoteItems,
  remoteLoading,
  remoteError,
  cloudEnabled = false,
  cloudDirPath = '',
  cloudItems = [],
  cloudLoading = false,
  cloudError = null,
  localNotebooks,
  theme,
  onClose,
  onBrowseDirectory,
  onBrowseCloudDirectory,
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
  const [menuOpenForPath, setMenuOpenForPath] = useState<string | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmDeletePath, setConfirmDeletePath] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  if (!open) return null;

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = newName.trim();
    if (!cleaned) return;
    onCreateNotebook(cleaned, remoteDirPath);
    setNewName('');
    setCreating(false);
    onClose();
  };

  const parentDir = remoteDirPath.includes('/')
    ? remoteDirPath.slice(0, remoteDirPath.lastIndexOf('/'))
    : '';
  const cloudParentDir = cloudDirPath.includes('/')
    ? cloudDirPath.slice(0, cloudDirPath.lastIndexOf('/'))
    : '';

  const themeLabel =
    theme === 'auto' ? 'Auto' : theme === 'dark' ? 'Oscuro' : 'Claro';

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* M3 Scrim */}
      <div
        className="fixed inset-0 bg-scrim transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* M3 Modal Navigation Drawer Sheet */}
      <aside className="relative z-10 w-[86vw] max-w-[340px] h-full bg-surface-container-low text-on-surface rounded-r-3xl shadow-2xl flex flex-col overflow-hidden">
        {/* Drawer Header */}
        <div className="px-4 pt-4 pb-3 border-b border-outline-variant/60 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-on-surface">
              NoteLab M3
            </h2>
            <p className="text-xs text-on-surface-variant">
              Apuntes Local-First &amp; Jupyter
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

        {/* Create Notebook Action */}
        <div className="px-3 pt-3 pb-2">
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
          <div className="grid grid-cols-4 gap-1.5 pt-2">
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
              onClick={() => {
                onExportNotebook?.();
              }}
              title="Descargar .ipynb actual"
              className="flex flex-col items-center justify-center gap-1 py-2 px-1 rounded-xl bg-surface-container hover:bg-surface-container-high text-[11px] font-medium text-on-surface-variant hover:text-on-surface transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-primary" />
              <span>.ipynb</span>
            </button>
            <button
              type="button"
              onClick={() => {
                onShareNotebook?.();
              }}
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

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-5">
          {/* Local IndexedDB Notebooks */}
          <section>
            <div className="flex items-center justify-between px-2 mb-1.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant flex items-center gap-1.5">
                <HardDrive className="w-3.5 h-3.5" />
                En dispositivo (Offline)
              </span>
            </div>
            {localNotebooks.length === 0 ? (
              <p className="px-2 py-1 text-xs text-on-surface-variant/75">
                Sin apuntes guardados aún.
              </p>
            ) : (
              <ul className="space-y-1">
                {localNotebooks.map((rec) => {
                  const active = rec.path === currentPath;
                  const displayName = rec.path.split('/').pop() || rec.path;
                  const menuOpen = menuOpenForPath === rec.path;
                  const isRenaming = renamingPath === rec.path;
                  const isConfirmingDelete = confirmDeletePath === rec.path;

                  return (
                    <li key={rec.path} className="space-y-1">
                      {isRenaming ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            const cleaned = renameDraft.trim();
                            if (cleaned && onRenameNotebookByPath) {
                              onRenameNotebookByPath(rec.path, cleaned);
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
                              onSelectNotebook(rec.path);
                              onClose();
                            }}
                            className={`flex-1 min-w-0 flex items-center justify-between gap-2 px-3 py-2.5 rounded-full text-left text-sm transition-colors ${
                              active
                                ? 'bg-secondary-container text-on-secondary-container font-semibold'
                                : 'hover:bg-surface-container-high text-on-surface'
                            }`}
                          >
                            <span className="flex items-center gap-2.5 min-w-0">
                              <FileCode2 className="w-4 h-4 shrink-0 text-primary" />
                              <span className="truncate">{displayName}</span>
                            </span>
                            {(rec.pendingSync || (cloudEnabled && rec.pendingCloudSync)) && (
                              <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-full bg-warning-container text-on-warning-container font-medium">
                                Local
                              </span>
                            )}
                          </button>
                          <button
                            type="button"
                            aria-label={`Opciones para ${displayName}`}
                            onClick={() => {
                              setConfirmDeletePath(null);
                              setMenuOpenForPath(menuOpen ? null : rec.path);
                            }}
                            className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </button>
                        </div>
                      )}

                      {menuOpen && !isRenaming && (
                        <div className="ml-3 mr-1 px-2 py-1.5 rounded-2xl bg-surface-container flex flex-wrap items-center gap-1.5 text-xs">
                          {onDuplicateNotebook && (
                            <button
                              type="button"
                              onClick={() => {
                                onDuplicateNotebook(rec.path);
                                setMenuOpenForPath(null);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full hover:bg-surface-container-high text-on-surface"
                            >
                              <Copy className="w-3 h-3" />
                              <span>Duplicar</span>
                            </button>
                          )}
                          {onRenameNotebookByPath && (
                            <button
                              type="button"
                              onClick={() => {
                                setRenameDraft(displayName.replace(/\.ipynb$/i, ''));
                                setRenamingPath(rec.path);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full hover:bg-surface-container-high text-on-surface"
                            >
                              <Pencil className="w-3 h-3" />
                              <span>Renombrar</span>
                            </button>
                          )}
                          {onDeleteNotebook && localNotebooks.length > 1 && (
                            isConfirmingDelete ? (
                              <button
                                type="button"
                                onClick={() => {
                                  onDeleteNotebook(rec.path);
                                  setConfirmDeletePath(null);
                                  setMenuOpenForPath(null);
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-error text-on-error font-medium"
                              >
                                <Trash2 className="w-3 h-3" />
                                <span>Confirmar borrar</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeletePath(rec.path)}
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
          </section>

          {/* Cloud GitHub Explorer */}
          {cloudEnabled && (
            <section>
              <div className="flex items-center justify-between px-2 mb-1.5">
                <span className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant flex items-center gap-1.5">
                  <Cloud className="w-3.5 h-3.5" />
                  Nube (GitHub)
                </span>
                {onBrowseCloudDirectory && (
                  <button
                    type="button"
                    onClick={() => onBrowseCloudDirectory(cloudDirPath)}
                    aria-label="Actualizar archivos de GitHub"
                    className="p-1.5 rounded-full hover:bg-surface-container-high text-on-surface-variant"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${cloudLoading ? 'animate-spin' : ''}`} />
                  </button>
                )}
              </div>

              {cloudDirPath && onBrowseCloudDirectory && (
                <button
                  type="button"
                  onClick={() => onBrowseCloudDirectory(cloudParentDir)}
                  className="w-full flex items-center gap-1.5 px-3 py-2 mb-1 rounded-xl text-xs font-medium text-primary hover:bg-surface-container-high"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span className="truncate">/{cloudDirPath} (Subir)</span>
                </button>
              )}

              {cloudError ? (
                <div className="mx-1 p-3 rounded-2xl bg-surface-container text-xs text-on-surface-variant space-y-2">
                  <p>{cloudError}</p>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenSettings('cloud');
                    }}
                    className="text-primary font-medium hover:underline"
                  >
                    Configurar GitHub →
                  </button>
                </div>
              ) : cloudItems.length === 0 && !cloudLoading ? (
                <p className="px-2 py-1 text-xs text-on-surface-variant/75">
                  Sin archivos .ipynb en esta carpeta.
                </p>
              ) : (
                <ul className="space-y-1">
                  {cloudItems.map((item) => {
                    const active = item.path === currentPath;
                    return (
                      <li key={`cloud-${item.path}`}>
                        <button
                          type="button"
                          onClick={() => {
                            if (item.type === 'dir') {
                              onBrowseCloudDirectory?.(item.path);
                            } else {
                              onSelectNotebook(item.path, 'cloud');
                              onClose();
                            }
                          }}
                          className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-full text-left text-sm transition-colors ${
                            active
                              ? 'bg-secondary-container text-on-secondary-container font-semibold'
                              : 'hover:bg-surface-container-high text-on-surface'
                          }`}
                        >
                          {item.type === 'dir' ? (
                            <Folder className="w-4 h-4 shrink-0 text-tertiary" />
                          ) : (
                            <FileCode2 className="w-4 h-4 shrink-0 text-primary" />
                          )}
                          <span className="truncate">{item.name}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}

          {/* Termux Remote Explorer */}
          <section>
            <div className="flex items-center justify-between px-2 mb-1.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant flex items-center gap-1.5">
                <Server className="w-3.5 h-3.5" />
                Jupyter Server (Termux)
              </span>
              <button
                type="button"
                onClick={() => onBrowseDirectory(remoteDirPath)}
                aria-label="Actualizar archivos"
                className="p-1.5 rounded-full hover:bg-surface-container-high text-on-surface-variant"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${remoteLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {remoteDirPath && (
              <button
                type="button"
                onClick={() => onBrowseDirectory(parentDir)}
                className="w-full flex items-center gap-1.5 px-3 py-2 mb-1 rounded-xl text-xs font-medium text-primary hover:bg-surface-container-high"
              >
                <ChevronLeft className="w-4 h-4" />
                <span className="truncate">/{remoteDirPath} (Subir)</span>
              </button>
            )}

            {remoteError ? (
              <div className="mx-1 p-3 rounded-2xl bg-surface-container text-xs text-on-surface-variant space-y-2">
                <p>No conectado a Termux ({remoteError}).</p>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenSettings('jupyter');
                  }}
                  className="text-primary font-medium hover:underline"
                >
                  Configurar conexión →
                </button>
              </div>
            ) : remoteItems.length === 0 && !remoteLoading ? (
              <p className="px-2 py-1 text-xs text-on-surface-variant/75">
                Carpeta vacía.
              </p>
            ) : (
              <ul className="space-y-1">
                {remoteItems
                  .filter((item) => item.type === 'directory' || item.type === 'notebook')
                  .map((item) => {
                    const active = item.path === currentPath;
                    return (
                      <li key={item.path}>
                        <button
                          type="button"
                          onClick={() => {
                            if (item.type === 'directory') {
                              onBrowseDirectory(item.path);
                            } else {
                              onSelectNotebook(item.path);
                              onClose();
                            }
                          }}
                          className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-full text-left text-sm transition-colors ${
                            active
                              ? 'bg-secondary-container text-on-secondary-container font-semibold'
                              : 'hover:bg-surface-container-high text-on-surface'
                          }`}
                        >
                          {item.type === 'directory' ? (
                            <Folder className="w-4 h-4 shrink-0 text-tertiary" />
                          ) : (
                            <FileCode2 className="w-4 h-4 shrink-0 text-primary" />
                          )}
                          <span className="truncate">{item.name}</span>
                        </button>
                      </li>
                    );
                  })}
              </ul>
            )}
          </section>
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
