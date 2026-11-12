import React, { useState } from 'react';
import {
  ChevronLeft,
  FileCode2,
  Folder,
  HardDrive,
  Keyboard,
  Moon,
  Plus,
  RefreshCw,
  Server,
  Sun,
  SunMoon,
  X,
} from 'lucide-react';
import { JupyterContentItem, ThemePreference } from '../types/nbformat';
import { StoredNotebookRecord } from '../services/storage/NotebookDB';

interface NavigationDrawerProps {
  open: boolean;
  currentPath: string;
  remoteDirPath: string;
  remoteItems: JupyterContentItem[];
  remoteLoading: boolean;
  remoteError: string | null;
  localNotebooks: StoredNotebookRecord[];
  theme: ThemePreference;
  onClose: () => void;
  onBrowseDirectory: (dirPath: string) => void;
  onSelectNotebook: (path: string) => void;
  onCreateNotebook: (name: string, dirPath: string) => void;
  onOpenSettings: () => void;
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
  localNotebooks,
  theme,
  onClose,
  onBrowseDirectory,
  onSelectNotebook,
  onCreateNotebook,
  onOpenSettings,
  onOpenShortcuts,
  onCycleTheme,
}) => {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

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
                  return (
                    <li key={rec.path}>
                      <button
                        type="button"
                        onClick={() => {
                          onSelectNotebook(rec.path);
                          onClose();
                        }}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-full text-left text-sm transition-colors ${
                          active
                            ? 'bg-secondary-container text-on-secondary-container font-semibold'
                            : 'hover:bg-surface-container-high text-on-surface'
                        }`}
                      >
                        <span className="flex items-center gap-2.5 min-w-0">
                          <FileCode2 className="w-4 h-4 shrink-0 text-primary" />
                          <span className="truncate">{displayName}</span>
                        </span>
                        {rec.pendingSync && (
                          <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-full bg-warning-container text-on-warning-container font-medium">
                            Local
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

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
                    onOpenSettings();
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
              onOpenSettings();
            }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-full text-sm font-medium text-on-surface hover:bg-surface-container-high transition-colors"
          >
            <Server className="w-4 h-4 text-primary" />
            <span>Conexión Termux / Token</span>
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
