import React, { useMemo, useRef, useState } from 'react';
import {
  Calculator,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Copy,
  Download,
  FileCode2,
  FileText,
  Folder,
  FolderInput,
  FolderPlus,
  HardDrive,
  Keyboard,
  Moon,
  MoreVertical,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Server,
  Share2,
  Sun,
  SunMoon,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { JupyterContentItem, ThemePreference } from '../types/nbformat';
import {
  StoredFolderRecord,
  StoredNotebookRecord,
  StoredReactiveDocRecord,
} from '../services/storage/NotebookDB';
import { CloudRemoteItem } from '../services/cloud/CloudSyncProvider';
import {
  FileListFilter,
  UnifiedNotebookEntry,
  buildUnifiedFileList,
  collectKnownFolders,
  getParentDir,
  isDescendantOrSelf,
  validateFolderName,
} from '../services/storage/unifiedFiles';

export type DeleteNotebookScope = 'everywhere' | 'local_only';

interface NavigationDrawerProps {
  open: boolean;
  activeDocKind?: 'ipynb' | 'md';
  currentPath: string;
  currentReactivePath?: string | null;
  reactiveDocs?: StoredReactiveDocRecord[];
  activeDirPath: string;
  remoteItems: JupyterContentItem[];
  remoteLoading: boolean;
  remoteError: string | null;
  cloudEnabled?: boolean;
  cloudItems?: CloudRemoteItem[];
  cloudLoading?: boolean;
  cloudError?: string | null;
  localNotebooks: StoredNotebookRecord[];
  localFolders?: StoredFolderRecord[];
  discoveredFolders?: string[];
  theme: ThemePreference;
  onClose: () => void;
  onBrowseDirectory: (dirPath: string) => void;
  onSelectNotebook: (path: string, preferredSource?: 'auto' | 'cloud') => void;
  onCreateNotebook: (name: string, dirPath: string) => void;
  onCreateFolder?: (name: string, parentDir: string) => void;
  onRenameFolder?: (oldPath: string, newName: string) => void;
  onMoveFolder?: (oldPath: string, targetParentDir: string) => void;
  onDeleteFolder?: (dirPath: string, scope: DeleteNotebookScope) => void;
  onMoveNotebook?: (oldPath: string, targetDir: string) => void;
  onImportNotebook?: (file: File) => void;
  onExportNotebook?: () => void;
  onShareNotebook?: () => void;
  onPrintPdf?: () => void;
  onDuplicateNotebook?: (path: string) => void;
  onRenameNotebookByPath?: (oldPath: string, newName: string) => void;
  onDeleteNotebook?: (path: string, scope: DeleteNotebookScope) => void;
  onDiscardNotebookDraft?: (path: string) => void;
  onOpenSettings: (tab?: 'jupyter' | 'cloud') => void;
  onOpenShortcuts: () => void;
  onCycleTheme: () => void;
  onSelectReactiveDoc?: (path: string) => void;
  onCreateReactiveDoc?: (name: string) => void;
  onDeleteReactiveDoc?: (path: string) => void;
  onImportReactiveDoc?: (file: File) => void;
  onExportReactiveDoc?: () => void;
  onShareReactiveDoc?: () => void;
}

export const NavigationDrawer: React.FC<NavigationDrawerProps> = ({
  open,
  activeDocKind = 'ipynb',
  currentPath,
  currentReactivePath = null,
  reactiveDocs = [],
  activeDirPath,
  remoteItems,
  remoteLoading,
  remoteError,
  cloudEnabled = false,
  cloudItems = [],
  cloudLoading = false,
  cloudError = null,
  localNotebooks,
  localFolders = [],
  discoveredFolders = [],
  theme,
  onClose,
  onBrowseDirectory,
  onSelectNotebook,
  onCreateNotebook,
  onCreateFolder,
  onRenameFolder,
  onMoveFolder,
  onDeleteFolder,
  onMoveNotebook,
  onImportNotebook,
  onExportNotebook,
  onShareNotebook,
  onPrintPdf,
  onDuplicateNotebook,
  onRenameNotebookByPath,
  onDeleteNotebook,
  onDiscardNotebookDraft,
  onOpenSettings,
  onOpenShortcuts,
  onCycleTheme,
  onSelectReactiveDoc,
  onCreateReactiveDoc,
  onDeleteReactiveDoc,
  onImportReactiveDoc,
  onExportReactiveDoc,
  onShareReactiveDoc,
}) => {
  const [drawerTab, setDrawerTab] = useState<'ipynb' | 'md'>(activeDocKind);
  const [creatingReactive, setCreatingReactive] = useState(false);
  const [newReactiveName, setNewReactiveName] = useState('');
  const [confirmDeleteReactivePath, setConfirmDeleteReactivePath] = useState<string | null>(null);
  const reactiveImportInputRef = useRef<HTMLInputElement | null>(null);

  const [creating, setCreating] = useState<'notebook' | 'folder' | null>(null);
  const [newName, setNewName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FileListFilter>('folder');
  const [menuOpenForPath, setMenuOpenForPath] = useState<string | null>(null);
  const [menuOpenForDir, setMenuOpenForDir] = useState<string | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renamingDirPath, setRenamingDirPath] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameDirError, setRenameDirError] = useState<string | null>(null);
  const [confirmDeletePath, setConfirmDeletePath] = useState<string | null>(null);
  const [confirmDeleteDirPath, setConfirmDeleteDirPath] = useState<string | null>(null);
  const [movingTarget, setMovingTarget] = useState<{
    kind: 'notebook' | 'dir';
    path: string;
    name: string;
  } | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const unified = useMemo(
    () =>
      buildUnifiedFileList({
        currentDir: activeDirPath,
        filter,
        localNotebooks,
        localFolders,
        remoteItems,
        cloudItems,
        cloudEnabled,
      }),
    [activeDirPath, filter, localNotebooks, localFolders, remoteItems, cloudItems, cloudEnabled]
  );

  const allKnownFolders = useMemo(
    () =>
      collectKnownFolders({
        localFolders,
        localNotebooks,
        remoteItems,
        cloudItems,
        extraFolderPaths: discoveredFolders,
      }),
    [localFolders, localNotebooks, remoteItems, cloudItems, discoveredFolders]
  );

  if (!open) return null;

  const resetMenus = () => {
    setMenuOpenForPath(null);
    setMenuOpenForDir(null);
    setConfirmDeletePath(null);
    setConfirmDeleteDirPath(null);
    setRenamingPath(null);
    setRenamingDirPath(null);
    setRenameDirError(null);
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (creating === 'folder') {
      const validation = validateFolderName(newName);
      if (!validation.ok) {
        setCreateError(validation.error);
        return;
      }
      onCreateFolder?.(validation.name, activeDirPath);
      setNewName('');
      setCreateError(null);
      setCreating(null);
      return;
    }

    const cleaned = newName.trim();
    if (!cleaned) return;
    onCreateNotebook(cleaned, activeDirPath);
    setNewName('');
    setCreateError(null);
    setCreating(null);
    onClose();
  };

  const parentDir = getParentDir(activeDirPath);
  const breadcrumbSegments = activeDirPath ? activeDirPath.split('/').filter(Boolean) : [];

  const themeLabel =
    theme === 'auto' ? 'Auto' : theme === 'dark' ? 'Oscuro' : 'Claro';
  const isRefreshing = remoteLoading || cloudLoading;

  const renderStatusIcons = (entry: UnifiedNotebookEntry) => {
    const hasPending = entry.pendingJupyter || entry.pendingCloud;
    return (
      <span className="shrink-0 flex items-center gap-1 text-[10px]">
        {entry.hasDraft && (
          <span
            title="Borrador sin guardar en el archivo"
            className="px-1.5 py-0.5 rounded-full bg-tertiary-container text-on-tertiary-container font-medium"
          >
            Borrador
          </span>
        )}
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

        {/* Workspace Mode Switcher: Cuadernos Jupyter (.ipynb) vs Notas Reactivas (.md) */}
        {onSelectReactiveDoc && (
          <div className="px-3 pt-2.5 pb-1">
            <div className="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-surface-container border border-outline-variant/40">
              <button
                type="button"
                onClick={() => setDrawerTab('ipynb')}
                className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-xl text-xs font-medium transition-colors ${
                  drawerTab === 'ipynb'
                    ? 'bg-secondary-container text-on-secondary-container shadow-xs'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                <FileCode2 className="w-3.5 h-3.5" />
                <span>Jupyter .ipynb</span>
              </button>
              <button
                type="button"
                onClick={() => setDrawerTab('md')}
                className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-xl text-xs font-medium transition-colors ${
                  drawerTab === 'md'
                    ? 'bg-primary-container text-on-primary-container shadow-xs'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                <Calculator className="w-3.5 h-3.5" />
                <span>Reactivo .md</span>
              </button>
            </div>
          </div>
        )}

        {drawerTab === 'md' && onSelectReactiveDoc ? (
          <>
            {/* Reactive Markdown Actions */}
            <div className="px-3 pt-2 pb-2 space-y-2 border-b border-outline-variant/40">
              {creatingReactive ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const cleaned = newReactiveName.trim();
                    if (!cleaned) return;
                    onCreateReactiveDoc?.(cleaned);
                    setCreatingReactive(false);
                    setNewReactiveName('');
                    onClose();
                  }}
                  className="flex flex-col gap-2 p-2.5 rounded-2xl bg-surface-container"
                >
                  <div className="text-[11px] font-medium text-on-surface-variant px-0.5">
                    Nueva nota técnica reactiva (.md)
                  </div>
                  <input
                    type="text"
                    autoFocus
                    value={newReactiveName}
                    onChange={(e) => setNewReactiveName(e.target.value)}
                    placeholder="Nombre (ej: Presupuesto_Obra)"
                    className="w-full px-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant focus:border-primary outline-none text-sm text-on-surface"
                  />
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setCreatingReactive(false);
                        setNewReactiveName('');
                      }}
                      className="px-3 py-1.5 rounded-full text-xs font-medium text-on-surface-variant hover:bg-surface-container-high"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="px-3.5 py-1.5 rounded-full bg-primary text-on-primary text-xs font-medium"
                    >
                      Crear .md
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setCreatingReactive(true)}
                  className="w-full flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-2xl bg-primary-container text-on-primary-container font-medium text-sm hover:opacity-95 transition-opacity"
                >
                  <Plus className="w-4 h-4 shrink-0" />
                  <span>Nueva nota reactiva (.md)</span>
                </button>
              )}

              <div className="grid grid-cols-4 gap-1.5">
                <input
                  ref={reactiveImportInputRef}
                  type="file"
                  accept=".md,text/markdown,text/plain"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file && onImportReactiveDoc) {
                      onImportReactiveDoc(file);
                      onClose();
                    }
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => reactiveImportInputRef.current?.click()}
                  title="Importar archivo .md"
                  className="flex flex-col items-center justify-center gap-1 py-2 px-1 rounded-xl bg-surface-container hover:bg-surface-container-high text-[11px] font-medium text-on-surface-variant hover:text-on-surface transition-colors"
                >
                  <Upload className="w-3.5 h-3.5 text-primary" />
                  <span>Importar</span>
                </button>
                <button
                  type="button"
                  onClick={() => onExportReactiveDoc?.()}
                  title="Descargar .md en texto plano"
                  className="flex flex-col items-center justify-center gap-1 py-2 px-1 rounded-xl bg-surface-container hover:bg-surface-container-high text-[11px] font-medium text-on-surface-variant hover:text-on-surface transition-colors"
                >
                  <Download className="w-3.5 h-3.5 text-primary" />
                  <span>.md</span>
                </button>
                <button
                  type="button"
                  onClick={() => onShareReactiveDoc?.()}
                  title="Compartir archivo .md"
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

            {/* Reactive Docs List */}
            <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
              {reactiveDocs.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-on-surface-variant">
                  Todavía no hay notas técnicas reactivas. Creá una con el botón superior.
                </div>
              ) : (
                <ul className="space-y-1">
                  {reactiveDocs.map((doc) => {
                    const isSelected =
                      activeDocKind === 'md' && currentReactivePath === doc.path;
                    const confirming = confirmDeleteReactivePath === doc.path;
                    return (
                      <li key={doc.path} className="space-y-1">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              onSelectReactiveDoc(doc.path);
                              onClose();
                            }}
                            className={`flex-1 min-w-0 flex items-center gap-2.5 px-3 py-2.5 rounded-full text-left text-sm transition-colors ${
                              isSelected
                                ? 'bg-secondary-container text-on-secondary-container font-medium'
                                : 'text-on-surface hover:bg-surface-container-high'
                            }`}
                          >
                            <FileText className="w-4 h-4 shrink-0 text-primary" />
                            <span className="truncate">{doc.path.replace(/\.md$/i, '')}</span>
                            <span className="ml-auto text-[10px] font-mono opacity-60 shrink-0">
                              .md
                            </span>
                          </button>
                          {onDeleteReactiveDoc && (
                            <button
                              type="button"
                              aria-label={`Eliminar ${doc.path}`}
                              onClick={() =>
                                setConfirmDeleteReactivePath(confirming ? null : doc.path)
                              }
                              className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-on-surface-variant hover:text-error hover:bg-error-container/50"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                        {confirming && onDeleteReactiveDoc && (
                          <div className="ml-3 mr-1 px-2.5 py-2 rounded-2xl bg-surface-container flex items-center justify-between gap-2 text-xs">
                            <span className="text-on-surface-variant">¿Borrar nota?</span>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteReactivePath(null)}
                                className="px-2.5 py-1 rounded-full text-on-surface-variant hover:bg-surface-container-high"
                              >
                                No
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  onDeleteReactiveDoc(doc.path);
                                  setConfirmDeleteReactivePath(null);
                                }}
                                className="px-2.5 py-1 rounded-full bg-error text-on-error font-medium"
                              >
                                Borrar
                              </button>
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        ) : (
        <>
        {/* Create Notebook / Folder + Export/Import */}
        <div className="px-3 pt-3 pb-2 space-y-2 border-b border-outline-variant/40">
          {creating ? (
            <form onSubmit={handleCreateSubmit} className="flex flex-col gap-2 p-2.5 rounded-2xl bg-surface-container">
              <div className="flex items-center justify-between text-[11px] font-medium text-on-surface-variant px-0.5">
                <span>
                  {creating === 'folder'
                    ? `Nueva carpeta${activeDirPath ? ` en /${activeDirPath}` : ' en raíz'}`
                    : `Nuevo apunte${activeDirPath ? ` en /${activeDirPath}` : ''}`}
                </span>
              </div>
              <input
                type="text"
                autoFocus
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                  if (createError) setCreateError(null);
                }}
                placeholder={
                  creating === 'folder'
                    ? 'Nombre (ej: Algebra_Lineal)'
                    : 'Nombre (ej: Clase_1)'
                }
                className="w-full px-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant focus:border-primary outline-none text-sm text-on-surface"
              />
              {createError && (
                <p className="text-[11px] text-error px-0.5">{createError}</p>
              )}
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setCreating(null);
                    setNewName('');
                    setCreateError(null);
                  }}
                  className="px-3 py-1.5 rounded-full text-xs font-medium text-on-surface-variant hover:bg-surface-container-high"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-3.5 py-1.5 rounded-full bg-primary text-on-primary text-xs font-medium"
                >
                  {creating === 'folder' ? 'Crear carpeta' : 'Crear .ipynb'}
                </button>
              </div>
            </form>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setCreateError(null);
                  setCreating('notebook');
                }}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-2xl bg-primary-container text-on-primary-container font-medium text-sm hover:opacity-95 transition-opacity"
              >
                <Plus className="w-4 h-4 shrink-0" />
                <span className="truncate">Nuevo apunte</span>
              </button>
              {onCreateFolder && (
                <button
                  type="button"
                  onClick={() => {
                    setCreateError(null);
                    setCreating('folder');
                  }}
                  title="Crear nueva carpeta"
                  aria-label="Nueva carpeta"
                  className="shrink-0 flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-2xl bg-secondary-container text-on-secondary-container font-medium text-sm hover:opacity-95 transition-opacity"
                >
                  <FolderPlus className="w-4 h-4 shrink-0" />
                  <span>Carpeta</span>
                </button>
              )}
            </div>
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

          {/* Breadcrumbs & Back to parent folder */}
          {filter === 'folder' && activeDirPath && (
            <div className="flex items-center gap-1 px-1 py-1 rounded-xl bg-surface-container/70 text-xs">
              <button
                type="button"
                onClick={() => {
                  resetMenus();
                  onBrowseDirectory(parentDir);
                }}
                aria-label="Subir a la carpeta anterior"
                title="Subir un nivel"
                className="shrink-0 p-1 rounded-lg text-primary hover:bg-surface-container-high"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <nav
                aria-label="Ruta de carpetas"
                className="flex items-center gap-0.5 flex-wrap min-w-0"
              >
                <button
                  type="button"
                  onClick={() => {
                    resetMenus();
                    onBrowseDirectory('');
                  }}
                  className="px-1.5 py-0.5 rounded-md font-medium text-primary hover:bg-surface-container-high"
                >
                  Inicio
                </button>
                {breadcrumbSegments.map((seg, idx) => {
                  const segPath = breadcrumbSegments.slice(0, idx + 1).join('/');
                  const isLast = idx === breadcrumbSegments.length - 1;
                  return (
                    <React.Fragment key={segPath}>
                      <ChevronRight className="w-3 h-3 shrink-0 text-on-surface-variant/60" />
                      {isLast ? (
                        <span className="px-1.5 py-0.5 font-semibold text-on-surface truncate max-w-[140px]">
                          {seg}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            resetMenus();
                            onBrowseDirectory(segPath);
                          }}
                          className="px-1.5 py-0.5 rounded-md font-medium text-primary hover:bg-surface-container-high truncate max-w-[110px]"
                        >
                          {seg}
                        </button>
                      )}
                    </React.Fragment>
                  );
                })}
              </nav>
            </div>
          )}

          {/* Move Destination Picker */}
          {movingTarget && (
            <div className="p-2.5 rounded-2xl bg-surface-container border border-outline-variant/60 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-on-surface truncate">
                    Mover {movingTarget.kind === 'dir' ? 'carpeta' : 'apunte'}: {movingTarget.name}
                  </p>
                  <p className="text-[11px] text-on-surface-variant">
                    Elige la carpeta destino
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setMovingTarget(null)}
                  aria-label="Cancelar mover"
                  className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center hover:bg-surface-container-high text-on-surface-variant"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <ul className="max-h-44 overflow-y-auto space-y-1 pr-0.5">
                {(() => {
                  const currentParent = getParentDir(movingTarget.path);
                  const rootDisabled = currentParent === '';
                  const destinations = allKnownFolders.filter((folderPath) => {
                    if (movingTarget.kind === 'dir' && isDescendantOrSelf(folderPath, movingTarget.path)) {
                      return false;
                    }
                    return true;
                  });

                  return (
                    <>
                      <li>
                        <button
                          type="button"
                          disabled={rootDisabled}
                          onClick={() => {
                            if (movingTarget.kind === 'dir') {
                              onMoveFolder?.(movingTarget.path, '');
                            } else {
                              onMoveNotebook?.(movingTarget.path, '');
                            }
                            setMovingTarget(null);
                            resetMenus();
                          }}
                          className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl text-left text-xs transition-colors ${
                            rootDisabled
                              ? 'opacity-50 cursor-not-allowed text-on-surface-variant'
                              : 'hover:bg-surface-container-high text-on-surface'
                          }`}
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <Folder className="w-3.5 h-3.5 shrink-0 text-tertiary" />
                            <span className="font-medium truncate">Inicio (Raíz)</span>
                          </span>
                          {rootDisabled && (
                            <span className="text-[10px] text-on-surface-variant">actual</span>
                          )}
                        </button>
                      </li>
                      {destinations.map((destPath) => {
                        const isCurrentParent = destPath === currentParent;
                        return (
                          <li key={`dest-${destPath}`}>
                            <button
                              type="button"
                              disabled={isCurrentParent}
                              onClick={() => {
                                if (movingTarget.kind === 'dir') {
                                  onMoveFolder?.(movingTarget.path, destPath);
                                } else {
                                  onMoveNotebook?.(movingTarget.path, destPath);
                                }
                                setMovingTarget(null);
                                resetMenus();
                              }}
                              className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl text-left text-xs transition-colors ${
                                isCurrentParent
                                  ? 'opacity-50 cursor-not-allowed text-on-surface-variant'
                                  : 'hover:bg-surface-container-high text-on-surface'
                              }`}
                            >
                              <span className="flex items-center gap-2 min-w-0">
                                <Folder className="w-3.5 h-3.5 shrink-0 text-tertiary" />
                                <span className="truncate">/{destPath}</span>
                              </span>
                              {isCurrentParent && (
                                <span className="text-[10px] text-on-surface-variant">actual</span>
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </>
                  );
                })()}
              </ul>
            </div>
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
              {unified.directories.map((dirItem) => {
                const dirMenuOpen = menuOpenForDir === dirItem.path;
                const isRenamingDir = renamingDirPath === dirItem.path;
                const isConfirmingDirDelete = confirmDeleteDirPath === dirItem.path;
                const hasFolderActions = Boolean(
                  onRenameFolder || onMoveFolder || onDeleteFolder
                );

                return (
                  <li key={`dir-${dirItem.path}`} className="space-y-1">
                    {isRenamingDir ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const validation = validateFolderName(renameDraft);
                          if (!validation.ok) {
                            setRenameDirError(validation.error);
                            return;
                          }
                          onRenameFolder?.(dirItem.path, validation.name);
                          setRenamingDirPath(null);
                          setMenuOpenForDir(null);
                          setRenameDirError(null);
                        }}
                        className="space-y-1 px-2 py-1.5 rounded-2xl bg-surface-container"
                      >
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            autoFocus
                            value={renameDraft}
                            onChange={(e) => {
                              setRenameDraft(e.target.value);
                              if (renameDirError) setRenameDirError(null);
                            }}
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
                            onClick={() => {
                              setRenamingDirPath(null);
                              setRenameDirError(null);
                            }}
                            className="px-2 py-1 rounded-full text-xs text-on-surface-variant"
                          >
                            ×
                          </button>
                        </div>
                        {renameDirError && (
                          <p className="text-[11px] text-error px-1">{renameDirError}</p>
                        )}
                      </form>
                    ) : (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            resetMenus();
                            onBrowseDirectory(dirItem.path);
                          }}
                          className="flex-1 min-w-0 flex items-center justify-between gap-2 px-3 py-2.5 rounded-full text-left text-sm hover:bg-surface-container-high text-on-surface transition-colors"
                        >
                          <span className="flex items-center gap-2.5 min-w-0">
                            <Folder className="w-4 h-4 shrink-0 text-tertiary" />
                            <span className="truncate">{dirItem.name}</span>
                          </span>
                          <span className="shrink-0 flex items-center gap-1">
                            {dirItem.inLocal && (
                              <HardDrive
                                className="w-3 h-3 text-on-surface-variant/70"
                                aria-label="En dispositivo"
                              />
                            )}
                            {dirItem.inJupyter && (
                              <Server
                                className="w-3 h-3 text-success"
                                aria-label="En Termux/Jupyter"
                              />
                            )}
                            {cloudEnabled && dirItem.inCloud && (
                              <Cloud
                                className="w-3 h-3 text-primary"
                                aria-label="En GitHub"
                              />
                            )}
                          </span>
                        </button>

                        {hasFolderActions && (
                          <button
                            type="button"
                            aria-label={`Opciones para carpeta ${dirItem.name}`}
                            onClick={() => {
                              setMenuOpenForPath(null);
                              setConfirmDeletePath(null);
                              setConfirmDeleteDirPath(null);
                              setMenuOpenForDir(dirMenuOpen ? null : dirItem.path);
                            }}
                            className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    )}

                    {dirMenuOpen && !isRenamingDir && (
                      <div className="ml-3 mr-1 px-2.5 py-2 rounded-2xl bg-surface-container flex flex-wrap items-center gap-1.5 text-xs">
                        {onRenameFolder && (
                          <button
                            type="button"
                            onClick={() => {
                              setRenameDraft(dirItem.name);
                              setRenameDirError(null);
                              setRenamingDirPath(dirItem.path);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full hover:bg-surface-container-high text-on-surface"
                          >
                            <Pencil className="w-3 h-3" />
                            <span>Renombrar</span>
                          </button>
                        )}
                        {onMoveFolder && (
                          <button
                            type="button"
                            onClick={() => {
                              setMovingTarget({
                                kind: 'dir',
                                path: dirItem.path,
                                name: dirItem.name,
                              });
                              setMenuOpenForDir(null);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full hover:bg-surface-container-high text-on-surface"
                          >
                            <FolderInput className="w-3 h-3" />
                            <span>Mover</span>
                          </button>
                        )}
                        {onDeleteFolder && (
                          isConfirmingDirDelete ? (
                            <div className="flex flex-wrap items-center gap-1.5 w-full pt-1 border-t border-outline-variant/40">
                              <span className="w-full text-[11px] text-on-surface-variant">
                                Se eliminará la carpeta y su contenido.
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  onDeleteFolder(dirItem.path, 'everywhere');
                                  setConfirmDeleteDirPath(null);
                                  setMenuOpenForDir(null);
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-error text-on-error font-medium"
                              >
                                <Trash2 className="w-3 h-3" />
                                <span>
                                  {dirItem.inJupyter || dirItem.inCloud
                                    ? 'Borrar de todos lados'
                                    : 'Confirmar borrar'}
                                </span>
                              </button>
                              {dirItem.inLocal && (dirItem.inJupyter || dirItem.inCloud) && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    onDeleteFolder(dirItem.path, 'local_only');
                                    setConfirmDeleteDirPath(null);
                                    setMenuOpenForDir(null);
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
                              onClick={() => setConfirmDeleteDirPath(dirItem.path)}
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
                              setMenuOpenForDir(null);
                              setConfirmDeleteDirPath(null);
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
                        {onMoveNotebook && (
                          <button
                            type="button"
                            onClick={() => {
                              setMovingTarget({
                                kind: 'notebook',
                                path: entry.path,
                                name: entry.name,
                              });
                              setMenuOpenForPath(null);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full hover:bg-surface-container-high text-on-surface"
                          >
                            <FolderInput className="w-3 h-3" />
                            <span>Mover</span>
                          </button>
                        )}
                        {entry.hasDraft && onDiscardNotebookDraft && (
                          <button
                            type="button"
                            onClick={() => {
                              onDiscardNotebookDraft(entry.path);
                              setMenuOpenForPath(null);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full hover:bg-warning-container hover:text-on-warning-container text-on-surface"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>Descartar borrador</span>
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
        </>
        )}

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
