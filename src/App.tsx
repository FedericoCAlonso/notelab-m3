import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CommandId, CommandRegistry, RegisteredCommand } from './commands/CommandRegistry';
import {
  DEFAULT_NOTEBOOK_PATH,
  createStarterNotebook,
} from './data/welcomeNotebook';
import {
  ConnectionTestResult,
  JupyterHttpWebSocketGateway,
} from './services/jupyter/JupyterGateway';
import {
  classifyConnectionError,
  parseConnectionDeepLink,
} from './services/jupyter/connectionDeepLink';
import {
  DEFAULT_CLOUD_SYNC_SETTINGS,
  DEFAULT_CONNECTION_SETTINGS,
  IndexedDBNotebookStorage,
  StoredNotebookRecord,
} from './services/storage/NotebookDB';
import {
  downloadNotebookFile,
  parseImportedNotebook,
  shareNotebookFile,
} from './services/storage/notebookExport';
import { processImageFileToAttachment } from './services/storage/imageAttachment';
import { ActiveStdinPrompt } from './components/CellCard';
import { CloudRemoteItem } from './services/cloud/CloudSyncProvider';
import { GitHubContentsProvider } from './services/cloud/GitHubContentsProvider';
import { SyncConflict, SyncEngine } from './services/sync/SyncEngine';
import {
  ExecutionQueueState,
  KernelState,
  clearExecutionQueue,
  createInitialExecutionQueueState,
  dequeueNextCellForExecution,
  enqueueCellForExecution,
  finishCellExecution,
  transitionKernelState,
} from './state/machines';
import {
  CloudSyncSettings,
  ConnectionSettings,
  JupyterContentItem,
  NotebookCell,
  NotebookDocument,
  SyncStatus,
  ThemePreference,
  createCodeCell,
  createEmptyNotebook,
  createMarkdownCell,
} from './types/nbformat';
import { TopAppBar } from './components/TopAppBar';
import { NotebookView } from './components/NotebookView';
import { NavigationDrawer } from './components/NavigationDrawer';
import { ConnectionDialog } from './components/ConnectionDialog';
import { ConflictDialog } from './components/ConflictDialog';
import { ShortcutsModal } from './components/ShortcutsModal';
import { CellFab } from './components/CellFab';
import { Snackbar, SnackbarMessage } from './components/Snackbar';

function getDisplayTitleFromPath(path: string): string {
  const base = path.split('/').pop() || path;
  return base.replace(/\.ipynb$/i, '');
}

export function App() {
  // Core decoupled services
  const storage = useMemo(() => new IndexedDBNotebookStorage(), []);
  const gateway = useMemo(() => new JupyterHttpWebSocketGateway(), []);
  const cloudProvider = useMemo(() => new GitHubContentsProvider(), []);
  const syncEngine = useMemo(
    () => new SyncEngine(storage, gateway, cloudProvider),
    [storage, gateway, cloudProvider]
  );
  const commandRegistry = useMemo(() => new CommandRegistry(), []);

  // Application state
  const [settings, setSettings] = useState<ConnectionSettings>(DEFAULT_CONNECTION_SETTINGS);
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false
  );

  const [currentPath, setCurrentPath] = useState<string>(DEFAULT_NOTEBOOK_PATH);
  const [notebook, setNotebook] = useState<NotebookDocument>(() => createStarterNotebook());
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('synced');
  const [cloudSyncStatus, setCloudSyncStatus] = useState<SyncStatus | null>(null);
  const [activeConflict, setActiveConflict] = useState<SyncConflict | null>(null);

  const [activeCellId, setActiveCellId] = useState<string | null>(
    () => notebook.cells[0]?.id ?? null
  );
  const [editingCellId, setEditingCellId] = useState<string | null>(null);

  const [kernelState, setKernelState] = useState<KernelState>('DISCONNECTED');
  const kernelIdRef = useRef<string | null>(null);
  const [executionState, setExecutionState] = useState<ExecutionQueueState>(
    createInitialExecutionQueueState
  );
  const [pendingStdin, setPendingStdin] = useState<ActiveStdinPrompt | null>(null);
  const isProcessingQueueRef = useRef(false);
  const deletedCellRef = useRef<{ path: string; cell: NotebookCell; index: number } | null>(null);

  // Navigation & Modals
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [connectionTab, setConnectionTab] = useState<'jupyter' | 'cloud'>('jupyter');
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [isTitleEditing, setIsTitleEditing] = useState(false);

  const [localNotebooks, setLocalNotebooks] = useState<StoredNotebookRecord[]>([]);
  const [remoteDirPath, setRemoteDirPath] = useState('');
  const [remoteItems, setRemoteItems] = useState<JupyterContentItem[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);

  const [cloudDirPath, setCloudDirPath] = useState('');
  const [cloudItems, setCloudItems] = useState<CloudRemoteItem[]>([]);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudError, setCloudError] = useState<string | null>(null);

  const [snackbar, setSnackbar] = useState<SnackbarMessage | null>(null);
  const snackbarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refs for latest state access in async queue & keyboard callbacks
  const notebookRef = useRef(notebook);
  notebookRef.current = notebook;
  const currentPathRef = useRef(currentPath);
  currentPathRef.current = currentPath;
  const activeCellIdRef = useRef(activeCellId);
  activeCellIdRef.current = activeCellId;
  const editingCellIdRef = useRef(editingCellId);
  editingCellIdRef.current = editingCellId;
  const executionStateRef = useRef(executionState);
  executionStateRef.current = executionState;
  const kernelStateRef = useRef(kernelState);
  kernelStateRef.current = kernelState;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const showSnackbar = useCallback(
    (
      text: string,
      tone: SnackbarMessage['tone'] = 'neutral',
      options?: { actionLabel?: string; onAction?: () => void; durationMs?: number }
    ) => {
      if (snackbarTimerRef.current) {
        clearTimeout(snackbarTimerRef.current);
      }
      setSnackbar({
        id: Date.now(),
        text,
        tone,
        actionLabel: options?.actionLabel,
        onAction: options?.onAction,
      });
      snackbarTimerRef.current = setTimeout(() => {
        setSnackbar(null);
      }, options?.durationMs ?? 3200);
    },
    []
  );

  // Theme management
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'auto') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', settings.theme);
    }
  }, [settings.theme]);

  const isDark =
    settings.theme === 'dark' || (settings.theme === 'auto' && systemPrefersDark);

  const refreshLocalList = useCallback(async () => {
    const list = await storage.listAllNotebooks();
    setLocalNotebooks(list);
  }, [storage]);

  const browseRemoteDirectory = useCallback(
    async (dirPath = '') => {
      setRemoteLoading(true);
      setRemoteError(null);
      setRemoteDirPath(dirPath);
      try {
        const items = await gateway.listDirectory(dirPath);
        setRemoteItems(items);
      } catch (error) {
        setRemoteItems([]);
        setRemoteError(
          error instanceof Error ? error.message : 'Servidor no disponible'
        );
      } finally {
        setRemoteLoading(false);
      }
    },
    [gateway]
  );

  const browseCloudDirectory = useCallback(
    async (dirPath = '') => {
      if (!cloudProvider.isConfigured()) {
        setCloudItems([]);
        setCloudError(null);
        return;
      }
      setCloudLoading(true);
      setCloudError(null);
      setCloudDirPath(dirPath);
      try {
        const items = await cloudProvider.list(dirPath);
        setCloudItems(items);
      } catch (error) {
        setCloudItems([]);
        setCloudError(
          error instanceof Error ? error.message : 'No se pudo listar GitHub'
        );
      } finally {
        setCloudLoading(false);
      }
    },
    [cloudProvider]
  );

  // Subscribe to Gateway Kernel state + SyncEngine updates
  useEffect(() => {
    const unsubKernel = gateway.onKernelStateChange((nextState) => {
      setKernelState(nextState);
    });

    const unsubSync = syncEngine.subscribe((event) => {
      if (event.path === currentPathRef.current) {
        if (event.target === 'cloud') {
          setCloudSyncStatus(event.status);
        } else {
          setSyncStatus(event.status);
        }
      }
      if (event.conflict) {
        setActiveConflict(event.conflict);
      }
      void refreshLocalList();
      if (event.status === 'offline' && event.target === 'jupyter' && event.message) {
        showSnackbar(event.message);
      }
    });

    return () => {
      unsubKernel();
      unsubSync();
      syncEngine.destroy();
      gateway.disconnectWebSocket();
    };
  }, [gateway, syncEngine, refreshLocalList, showSnackbar]);

  // Kernel lifecycle actions
  const ensureKernelRunning = useCallback(async (): Promise<string> => {
    if (
      kernelIdRef.current &&
      (kernelStateRef.current === 'IDLE' || kernelStateRef.current === 'BUSY')
    ) {
      return kernelIdRef.current;
    }
    setKernelState((s) => transitionKernelState(s, { type: 'CONNECT' }));
    try {
      const info = await gateway.startKernel('python3');
      kernelIdRef.current = info.id;
      setKernelState((s) => transitionKernelState(s, { type: 'CONNECTED' }));
      return info.id;
    } catch (error) {
      kernelIdRef.current = null;
      setKernelState('DISCONNECTED');
      throw error;
    }
  }, [gateway]);

  const applyDeepLinkIfPresent = useCallback(
    async (baseSettings: ConnectionSettings): Promise<{ settings: ConnectionSettings; applied: boolean }> => {
      if (typeof window === 'undefined') {
        return { settings: baseSettings, applied: false };
      }
      const parsed = parseConnectionDeepLink(window.location.hash);
      if (!parsed.hasConnectionParams) {
        return { settings: baseSettings, applied: false };
      }

      const nextSettings: ConnectionSettings = {
        ...baseSettings,
        ...(parsed.serverUrl ? { serverUrl: parsed.serverUrl } : {}),
        ...(parsed.token !== undefined ? { token: parsed.token } : {}),
      };

      await storage.saveSettings(nextSettings);
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${window.location.search}${parsed.cleanedHash}`
      );
      return { settings: nextSettings, applied: true };
    },
    [storage]
  );

  // Initial load from IndexedDB + optional deep-link auto-connect + remote sync
  useEffect(() => {
    let mounted = true;
    const init = async () => {
      const savedSettings = await storage.getSettings();
      const { settings: effectiveSettings, applied: deepLinkApplied } =
        await applyDeepLinkIfPresent(savedSettings);
      if (!mounted) return;

      setSettings(effectiveSettings);
      gateway.configure(effectiveSettings.serverUrl, effectiveSettings.token);
      cloudProvider.configure(
        effectiveSettings.cloud ?? DEFAULT_CLOUD_SYNC_SETTINGS
      );
      setCloudSyncStatus(cloudProvider.isConfigured() ? 'synced' : null);

      const allLocal = await storage.listAllNotebooks();
      if (!mounted) return;

      let targetPath = effectiveSettings.lastOpenedPath || DEFAULT_NOTEBOOK_PATH;
      if (allLocal.length === 0) {
        const starter = createStarterNotebook();
        await storage.putNotebook({
          path: DEFAULT_NOTEBOOK_PATH,
          notebook: starter,
          updatedAt: Date.now(),
          syncedAt: null,
          pendingSync: false,
          isLocalOnly: true,
          serverLastModified: null,
        });
        targetPath = DEFAULT_NOTEBOOK_PATH;
      }

      try {
        const loaded = await syncEngine.loadNotebook(targetPath);
        if (!mounted) return;
        setCurrentPath(targetPath);
        setNotebook(loaded.notebook);
        setSyncStatus(loaded.status);
        if (cloudProvider.isConfigured()) {
          setCloudSyncStatus(loaded.cloudStatus ?? 'pending');
        }
        setActiveCellId(loaded.notebook.cells[0]?.id ?? null);
      } catch {
        const fallback = allLocal[0];
        if (fallback && mounted) {
          setCurrentPath(fallback.path);
          setNotebook(fallback.notebook);
          setSyncStatus(fallback.pendingSync ? 'pending' : 'synced');
          if (cloudProvider.isConfigured()) {
            setCloudSyncStatus(fallback.pendingCloudSync ? 'pending' : 'synced');
          }
          setActiveCellId(fallback.notebook.cells[0]?.id ?? null);
        }
      }

      await refreshLocalList();
      void syncEngine.flushOutbox();
      void browseRemoteDirectory('');
      void browseCloudDirectory('');

      if (deepLinkApplied && mounted) {
        try {
          await ensureKernelRunning();
          if (mounted) {
            showSnackbar('Conectado automáticamente a Jupyter', 'success');
          }
        } catch (error) {
          if (mounted) {
            const classified = classifyConnectionError(error);
            showSnackbar(classified.message, 'error');
          }
        }
      }
    };

    void init();
    return () => {
      mounted = false;
    };
  }, [
    storage,
    gateway,
    cloudProvider,
    syncEngine,
    refreshLocalList,
    browseRemoteDirectory,
    browseCloudDirectory,
    applyDeepLinkIfPresent,
    ensureKernelRunning,
    showSnackbar,
  ]);

  // Listen for hash deep links when PWA tab is already open
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onHashChange = () => {
      void (async () => {
        const { settings: nextSettings, applied } = await applyDeepLinkIfPresent(
          settingsRef.current
        );
        if (!applied) return;
        setSettings(nextSettings);
        kernelIdRef.current = null;
        gateway.disconnectWebSocket();
        gateway.configure(nextSettings.serverUrl, nextSettings.token);
        void browseRemoteDirectory('');
        void syncEngine.flushOutbox();
        try {
          await ensureKernelRunning();
          showSnackbar('Conectado automáticamente a Jupyter', 'success');
        } catch (error) {
          const classified = classifyConnectionError(error);
          showSnackbar(classified.message, 'error');
        }
      })();
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [
    applyDeepLinkIfPresent,
    gateway,
    browseRemoteDirectory,
    syncEngine,
    ensureKernelRunning,
    showSnackbar,
  ]);

  // Helper to commit notebook mutations Local-First
  const updateNotebook = useCallback(
    (updater: (prev: NotebookDocument) => NotebookDocument) => {
      const next = updater(notebookRef.current);
      notebookRef.current = next;
      setNotebook(next);
      void syncEngine.scheduleSave(currentPathRef.current, next);
    },
    [syncEngine]
  );

  const handleStartKernel = useCallback(async () => {
    try {
      await ensureKernelRunning();
      showSnackbar('Kernel Python iniciado en Termux', 'success');
    } catch (error) {
      showSnackbar(
        error instanceof Error ? error.message : 'No se pudo iniciar el kernel',
        'error'
      );
    }
  }, [ensureKernelRunning, showSnackbar]);

  const handleInterruptKernel = useCallback(async () => {
    if (!kernelIdRef.current) return;
    setPendingStdin(null);
    try {
      await gateway.interruptKernel(kernelIdRef.current);
      showSnackbar('Ejecución interrumpida');
    } catch {
      showSnackbar('Error al interrumpir kernel', 'error');
    }
  }, [gateway, showSnackbar]);

  const handleRestartKernel = useCallback(async () => {
    setPendingStdin(null);
    if (!kernelIdRef.current) {
      await handleStartKernel();
      return;
    }
    try {
      setExecutionState((prev) => clearExecutionQueue(prev));
      const info = await gateway.restartKernel(kernelIdRef.current);
      kernelIdRef.current = info.id;
      showSnackbar('Kernel reiniciado');
    } catch {
      showSnackbar('Error al reiniciar kernel', 'error');
    }
  }, [gateway, handleStartKernel, showSnackbar]);

  const handleShutdownKernel = useCallback(async () => {
    if (!kernelIdRef.current) return;
    setPendingStdin(null);
    const id = kernelIdRef.current;
    kernelIdRef.current = null;
    setExecutionState((prev) => clearExecutionQueue(prev));
    try {
      await gateway.shutdownKernel(id);
      showSnackbar('Kernel apagado');
    } catch {
      setKernelState('DISCONNECTED');
    }
  }, [gateway, showSnackbar]);

  // Ordered Execution Queue processor
  const processExecutionQueue = useCallback(async () => {
    if (isProcessingQueueRef.current) return;
    isProcessingQueueRef.current = true;

    try {
      while (true) {
        const { nextState, cellId } = dequeueNextCellForExecution(
          executionStateRef.current
        );
        if (!cellId) break;

        executionStateRef.current = nextState;
        setExecutionState(nextState);

        const targetCell = notebookRef.current.cells.find((c) => c.id === cellId);
        if (!targetCell || targetCell.cell_type !== 'code') {
          const doneState = finishCellExecution(
            executionStateRef.current,
            cellId,
            false
          );
          executionStateRef.current = doneState;
          setExecutionState(doneState);
          continue;
        }

        // Clear prior outputs immediately before execution
        updateNotebook((prev) => ({
          ...prev,
          cells: prev.cells.map((c) =>
            c.id === cellId && c.cell_type === 'code'
              ? { ...c, outputs: [], execution_count: null }
              : c
          ),
        }));

        let hasError = false;
        try {
          const kernelId = await ensureKernelRunning();
          const result = await gateway.executeCode(kernelId, targetCell.source, {
            onOutput: (partialOutputs, execCount) => {
              updateNotebook((prev) => ({
                ...prev,
                cells: prev.cells.map((c) =>
                  c.id === cellId && c.cell_type === 'code'
                    ? {
                        ...c,
                        outputs: partialOutputs,
                        execution_count: execCount ?? c.execution_count,
                      }
                    : c
                ),
              }));
            },
            onInputRequest: (req) => {
              setPendingStdin({
                cellId,
                prompt: req.prompt,
                password: req.password,
                submit: (value) => {
                  setPendingStdin(null);
                  req.submit(value);
                },
                cancel: () => {
                  setPendingStdin(null);
                  req.cancel();
                },
              });
            },
          });

          setPendingStdin((prev) => (prev?.cellId === cellId ? null : prev));
          hasError = result.hasError;
          updateNotebook((prev) => ({
            ...prev,
            cells: prev.cells.map((c) =>
              c.id === cellId && c.cell_type === 'code'
                ? {
                    ...c,
                    outputs: result.outputs,
                    execution_count: result.executionCount,
                  }
                : c
            ),
          }));
        } catch (error) {
          setPendingStdin((prev) => (prev?.cellId === cellId ? null : prev));
          hasError = true;
          const errMsg =
            error instanceof Error ? error.message : 'Error de ejecución en kernel';
          updateNotebook((prev) => ({
            ...prev,
            cells: prev.cells.map((c) =>
              c.id === cellId && c.cell_type === 'code'
                ? {
                    ...c,
                    outputs: [
                      {
                        output_type: 'error',
                        ename: 'KernelConnectionError',
                        evalue: errMsg,
                        traceback: [errMsg],
                      },
                    ],
                  }
                : c
            ),
          }));
          showSnackbar(errMsg, 'error');
        }

        const finished = finishCellExecution(
          executionStateRef.current,
          cellId,
          hasError
        );
        executionStateRef.current = finished;
        setExecutionState(finished);
      }
    } finally {
      isProcessingQueueRef.current = false;
    }
  }, [ensureKernelRunning, gateway, showSnackbar, updateNotebook]);

  const runCellById = useCallback(
    (cellId: string) => {
      const cell = notebookRef.current.cells.find((c) => c.id === cellId);
      if (!cell) return;

      if (editingCellIdRef.current === cellId) {
        setEditingCellId(null);
        editingCellIdRef.current = null;
      }

      if (cell.cell_type === 'code') {
        const queued = enqueueCellForExecution(executionStateRef.current, cellId);
        executionStateRef.current = queued;
        setExecutionState(queued);
        void processExecutionQueue();
      }
    },
    [processExecutionQueue]
  );

  // Cell mutation handlers
  const handleChangeSource = useCallback(
    (cellId: string, source: string) => {
      updateNotebook((prev) => ({
        ...prev,
        cells: prev.cells.map((c) => (c.id === cellId ? { ...c, source } : c)),
      }));
    },
    [updateNotebook]
  );

  const handleToggleCellType = useCallback(
    (cellId: string) => {
      updateNotebook((prev) => ({
        ...prev,
        cells: prev.cells.map((c): NotebookCell => {
          if (c.id !== cellId) return c;
          if (c.cell_type === 'markdown') {
            return {
              id: c.id,
              cell_type: 'code',
              metadata: { ...c.metadata },
              source: c.source,
              execution_count: null,
              outputs: [],
            };
          }
          const nextMeta = { ...c.metadata };
          delete nextMeta.notelab_hide_source;
          return {
            id: c.id,
            cell_type: 'markdown',
            metadata: nextMeta,
            source: c.source,
          };
        }),
      }));
    },
    [updateNotebook]
  );

  const handleToggleHideSource = useCallback(
    (cellId: string) => {
      updateNotebook((prev) => ({
        ...prev,
        cells: prev.cells.map((c) => {
          if (c.id !== cellId || c.cell_type !== 'code') return c;
          return {
            ...c,
            metadata: {
              ...c.metadata,
              notelab_hide_source: !c.metadata.notelab_hide_source,
            },
          };
        }),
      }));
      if (editingCellIdRef.current === cellId) {
        setEditingCellId(null);
      }
    },
    [updateNotebook]
  );

  const handleInsertCellBelow = useCallback(
    (afterCellId: string | null, type?: 'markdown' | 'code', enterEdit = true) => {
      const cells = notebookRef.current.cells;
      const idx = afterCellId ? cells.findIndex((c) => c.id === afterCellId) : cells.length - 1;
      const refCell = idx >= 0 ? cells[idx] : undefined;
      const targetType =
        type ?? (refCell?.cell_type === 'code' ? 'code' : 'markdown');
      const newCell =
        targetType === 'code' ? createCodeCell('') : createMarkdownCell('');

      const insertAt = idx >= 0 ? idx + 1 : cells.length;
      updateNotebook((prev) => {
        const nextCells = [...prev.cells];
        nextCells.splice(insertAt, 0, newCell);
        return { ...prev, cells: nextCells };
      });

      setActiveCellId(newCell.id);
      if (enterEdit) {
        setEditingCellId(newCell.id);
      } else {
        setEditingCellId(null);
      }
    },
    [updateNotebook]
  );

  const handleAttachImage = useCallback(
    async (cellId: string, file: File) => {
      try {
        const attachment = await processImageFileToAttachment(file);
        updateNotebook((prev) => ({
          ...prev,
          cells: prev.cells.map((c) => {
            if (c.id !== cellId || c.cell_type !== 'markdown') return c;
            const prevAttachments = c.attachments ?? {};
            const markdownImg = `![${attachment.name}](attachment:${attachment.name})`;
            const nextSource = c.source.trim()
              ? `${c.source.replace(/\s+$/, '')}\n\n${markdownImg}`
              : markdownImg;
            return {
              ...c,
              source: nextSource,
              attachments: {
                ...prevAttachments,
                [attachment.name]: {
                  [attachment.mimeType]: attachment.base64,
                },
              },
            };
          }),
        }));
        showSnackbar('Imagen adjuntada a la celda', 'success');
      } catch (error) {
        showSnackbar(
          error instanceof Error ? error.message : 'No se pudo adjuntar la imagen',
          'error'
        );
      }
    },
    [updateNotebook, showSnackbar]
  );

  const handleDeleteCell = useCallback(
    (cellId: string) => {
      const cells = notebookRef.current.cells;
      if (cells.length <= 1) return;
      const idx = cells.findIndex((c) => c.id === cellId);
      const removed = idx >= 0 ? cells[idx] : undefined;
      const nextCells = cells.filter((c) => c.id !== cellId);

      updateNotebook((prev) => ({ ...prev, cells: nextCells }));

      if (editingCellIdRef.current === cellId) {
        setEditingCellId(null);
      }
      if (activeCellIdRef.current === cellId) {
        const fallback = nextCells[Math.min(idx, nextCells.length - 1)];
        setActiveCellId(fallback?.id ?? null);
      }

      if (removed) {
        const targetPath = currentPathRef.current;
        deletedCellRef.current = { path: targetPath, cell: removed, index: idx };
        showSnackbar('Celda eliminada', 'neutral', {
          actionLabel: 'Deshacer',
          durationMs: 5000,
          onAction: () => {
            const snap = deletedCellRef.current;
            if (!snap || snap.path !== currentPathRef.current) return;
            deletedCellRef.current = null;
            updateNotebook((prev) => {
              const restored = [...prev.cells];
              const insertAt = Math.min(Math.max(0, snap.index), restored.length);
              restored.splice(insertAt, 0, snap.cell);
              return { ...prev, cells: restored };
            });
            setActiveCellId(snap.cell.id);
          },
        });
      }
    },
    [updateNotebook, showSnackbar]
  );

  const handleForceSync = useCallback(async () => {
    const res = await syncEngine.forceSync(currentPathRef.current, notebookRef.current);
    if (res.ok) {
      showSnackbar('Guardado en Termux', 'success');
    } else if (res.offline) {
      showSnackbar('Sin conexión: guardado localmente');
    } else {
      showSnackbar(`Error al guardar: ${res.error ?? 'desconocido'}`, 'error');
    }
  }, [syncEngine, showSnackbar]);

  // Register Command Pattern shortcuts
  const commandsList = useMemo<RegisteredCommand[]>(() => {
    return [
      {
        id: 'cell.enterEdit',
        label: 'Editar celda',
        description: 'Entrar en modo edición en la celda activa',
        shortcutDisplay: 'Enter',
        bindings: [{ key: 'Enter', whenMode: 'VIEWING' }],
        execute: () => {
          const targetId =
            activeCellIdRef.current ?? notebookRef.current.cells[0]?.id ?? null;
          if (targetId) {
            setActiveCellId(targetId);
            setEditingCellId(targetId);
          }
        },
      },
      {
        id: 'cell.runAndStay',
        label: 'Renderizar / Ejecutar celda',
        description: 'Renderiza Markdown o ejecuta Python y vuelve a lectura',
        shortcutDisplay: 'Ctrl + Enter',
        bindings: [{ key: 'Enter', ctrl: true, whenMode: 'ANY' }],
        execute: () => {
          const targetId = editingCellIdRef.current ?? activeCellIdRef.current;
          if (targetId) {
            runCellById(targetId);
          }
        },
      },
      {
        id: 'cell.runAndAdvance',
        label: 'Ejecutar y avanzar',
        description: 'Renderiza/ejecuta la celda y pasa (o crea) la siguiente',
        shortcutDisplay: 'Shift + Enter',
        bindings: [{ key: 'Enter', shift: true, whenMode: 'ANY' }],
        execute: () => {
          const targetId = editingCellIdRef.current ?? activeCellIdRef.current;
          if (!targetId) return;
          runCellById(targetId);
          const cells = notebookRef.current.cells;
          const idx = cells.findIndex((c) => c.id === targetId);
          const nextCell = idx >= 0 ? cells[idx + 1] : undefined;
          if (nextCell) {
            setActiveCellId(nextCell.id);
            setEditingCellId(null);
          } else {
            handleInsertCellBelow(targetId, undefined, true);
          }
        },
      },
      {
        id: 'cell.moveUp',
        label: 'Celda anterior',
        description: 'Navegar a la celda superior',
        shortcutDisplay: 'Alt + ↑ / ↑',
        bindings: [
          { key: 'ArrowUp', alt: true, whenMode: 'ANY' },
          { key: 'ArrowUp', whenMode: 'VIEWING' },
        ],
        execute: () => {
          const cells = notebookRef.current.cells;
          if (cells.length === 0) return;
          const idx = cells.findIndex((c) => c.id === activeCellIdRef.current);
          const prevIdx = idx > 0 ? idx - 1 : 0;
          const prevCell = cells[prevIdx];
          if (prevCell) {
            setEditingCellId(null);
            setActiveCellId(prevCell.id);
          }
        },
      },
      {
        id: 'cell.moveDown',
        label: 'Celda siguiente',
        description: 'Navegar a la celda inferior',
        shortcutDisplay: 'Alt + ↓ / ↓',
        bindings: [
          { key: 'ArrowDown', alt: true, whenMode: 'ANY' },
          { key: 'ArrowDown', whenMode: 'VIEWING' },
        ],
        execute: () => {
          const cells = notebookRef.current.cells;
          if (cells.length === 0) return;
          const idx = cells.findIndex((c) => c.id === activeCellIdRef.current);
          const nextIdx =
            idx >= 0 ? Math.min(cells.length - 1, idx + 1) : 0;
          const nextCell = cells[nextIdx];
          if (nextCell) {
            setEditingCellId(null);
            setActiveCellId(nextCell.id);
          }
        },
      },
      {
        id: 'cell.insertBelow',
        label: 'Nueva celda debajo',
        description: 'Inserta una nueva celda debajo de la activa',
        shortcutDisplay: 'Ctrl + B',
        bindings: [{ key: 'b', ctrl: true, whenMode: 'ANY' }],
        execute: () => {
          handleInsertCellBelow(
            editingCellIdRef.current ?? activeCellIdRef.current,
            undefined,
            true
          );
        },
      },
      {
        id: 'cell.toggleType',
        label: 'Alternar Markdown / Python',
        description: 'Cambia el tipo de la celda activa',
        shortcutDisplay: 'Ctrl + M',
        bindings: [{ key: 'm', ctrl: true, whenMode: 'ANY' }],
        execute: () => {
          const targetId = editingCellIdRef.current ?? activeCellIdRef.current;
          if (targetId) {
            handleToggleCellType(targetId);
          }
        },
      },
      {
        id: 'cell.toggleHideSource',
        label: 'Ocultar / mostrar código',
        description: 'Deja visible solo el resultado de la celda Python',
        shortcutDisplay: 'Ctrl + H',
        bindings: [{ key: 'h', ctrl: true, whenMode: 'ANY' }],
        execute: () => {
          const targetId = editingCellIdRef.current ?? activeCellIdRef.current;
          if (targetId) {
            handleToggleHideSource(targetId);
          }
        },
      },
      {
        id: 'notebook.forceSync',
        label: 'Sincronizar ahora',
        description: 'Fuerza guardado inmediato en Jupyter Server',
        shortcutDisplay: 'Ctrl + S',
        bindings: [{ key: 's', ctrl: true, whenMode: 'ANY' }],
        execute: () => {
          void handleForceSync();
        },
      },
      {
        id: 'app.openShortcuts',
        label: 'Guía rápida y Termux',
        description: 'Abre o cierra el modal de atajos y ayuda',
        shortcutDisplay: 'Ctrl + /',
        bindings: [{ key: '/', ctrl: true, whenMode: 'ANY' }],
        execute: () => {
          setShortcutsOpen((prev) => !prev);
        },
      },
    ];
  }, [
    handleForceSync,
    handleInsertCellBelow,
    handleToggleCellType,
    handleToggleHideSource,
    runCellById,
  ]);

  useEffect(() => {
    commandRegistry.clear();
    commandRegistry.registerMany(commandsList);
  }, [commandRegistry, commandsList]);

  // Global keyboard handler (when focus is outside CodeMirror)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.cm-editor')) {
        // CodeMirror's Prec.highest keymap handles shortcuts inside the editor
        return;
      }

      const tag = target?.tagName?.toLowerCase();
      const isTextInput =
        tag === 'input' || tag === 'textarea' || Boolean(target?.isContentEditable);

      const matched = commandRegistry.handleKeyEvent(e, {
        activeCellId: activeCellIdRef.current,
        activeCellState: editingCellIdRef.current ? 'EDITING' : 'VIEWING',
        isModalOpen: drawerOpen || connectionOpen || shortcutsOpen || Boolean(activeConflict),
        isTitleEditing,
        isTextInputFocused: isTextInput,
      });

      if (matched) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [commandRegistry, drawerOpen, connectionOpen, shortcutsOpen, activeConflict, isTitleEditing]);

  const handleEditorShortcut = useCallback(
    (commandId: CommandId) => {
      commandRegistry.executeById(commandId, {
        activeCellId: activeCellIdRef.current,
        activeCellState: 'EDITING',
        isModalOpen: drawerOpen || connectionOpen || shortcutsOpen || Boolean(activeConflict),
        isTitleEditing,
        isTextInputFocused: false,
      });
    },
    [commandRegistry, drawerOpen, connectionOpen, shortcutsOpen, activeConflict, isTitleEditing]
  );

  // Notebook switching, creation, renaming
  const handleSelectNotebook = useCallback(
    async (path: string, preferredSource: 'auto' | 'cloud' = 'auto') => {
      setEditingCellId(null);
      try {
        const loaded = await syncEngine.loadNotebook(path, preferredSource);
        setCurrentPath(path);
        setNotebook(loaded.notebook);
        setSyncStatus(loaded.status);
        if (cloudProvider.isConfigured()) {
          setCloudSyncStatus(loaded.cloudStatus ?? 'pending');
        }
        setActiveCellId(loaded.notebook.cells[0]?.id ?? null);

        const nextSettings = { ...settings, lastOpenedPath: path };
        setSettings(nextSettings);
        await storage.saveSettings(nextSettings);
        await refreshLocalList();
      } catch (error) {
        showSnackbar(
          error instanceof Error ? error.message : 'No se pudo abrir el apunte',
          'error'
        );
      }
    },
    [syncEngine, cloudProvider, settings, storage, refreshLocalList, showSnackbar]
  );

  const handleCreateNotebook = useCallback(
    async (name: string, dirPath: string) => {
      const cleanName = name.replace(/\.ipynb$/i, '').trim() || 'Nuevo_Apunte';
      const fullPath = dirPath
        ? `${dirPath}/${cleanName}.ipynb`
        : `${cleanName}.ipynb`;
      const newDoc = createEmptyNotebook(cleanName);

      await storage.putNotebook({
        path: fullPath,
        notebook: newDoc,
        updatedAt: Date.now(),
        syncedAt: null,
        pendingSync: true,
        isLocalOnly: true,
        serverLastModified: null,
      });

      setCurrentPath(fullPath);
      setNotebook(newDoc);
      setActiveCellId(newDoc.cells[0]?.id ?? null);
      setEditingCellId(newDoc.cells[0]?.id ?? null);
      setSyncStatus('pending');

      const nextSettings = { ...settings, lastOpenedPath: fullPath };
      setSettings(nextSettings);
      await storage.saveSettings(nextSettings);
      await refreshLocalList();

      void syncEngine.forceSync(fullPath, newDoc);
    },
    [storage, settings, refreshLocalList, syncEngine]
  );

  const handleRenameTitle = useCallback(
    async (newTitle: string) => {
      const cleanTitle = newTitle.replace(/\.ipynb$/i, '').trim();
      if (!cleanTitle) return;

      const oldPath = currentPathRef.current;
      const dir = oldPath.includes('/')
        ? oldPath.slice(0, oldPath.lastIndexOf('/'))
        : '';
      const newPath = dir ? `${dir}/${cleanTitle}.ipynb` : `${cleanTitle}.ipynb`;
      if (newPath === oldPath) return;

      const existing = await storage.getNotebook(oldPath);
      await storage.deleteNotebook(oldPath);
      await storage.deleteOutboxItem(oldPath);
      await storage.putNotebook({
        path: newPath,
        notebook: notebookRef.current,
        updatedAt: Date.now(),
        syncedAt: existing?.syncedAt ?? null,
        pendingSync: true,
        isLocalOnly: existing?.isLocalOnly ?? false,
        serverLastModified: existing?.serverLastModified ?? null,
      });

      setCurrentPath(newPath);
      const nextSettings = { ...settings, lastOpenedPath: newPath };
      setSettings(nextSettings);
      await storage.saveSettings(nextSettings);

      try {
        if (!existing?.isLocalOnly) {
          await gateway.renameNotebook(oldPath, newPath);
          setSyncStatus('synced');
          showSnackbar('Apunte renombrado en Termux');
        } else {
          await syncEngine.forceSync(newPath, notebookRef.current);
        }
      } catch {
        await syncEngine.scheduleSave(newPath, notebookRef.current);
        showSnackbar('Renombrado localmente (pendiente de sincronizar)');
      }

      await refreshLocalList();
    },
    [storage, settings, gateway, syncEngine, refreshLocalList, showSnackbar]
  );

  const handleSaveSettings = useCallback(
    async (nextSettings: ConnectionSettings) => {
      setSettings(nextSettings);
      gateway.configure(nextSettings.serverUrl, nextSettings.token);
      cloudProvider.configure(nextSettings.cloud ?? DEFAULT_CLOUD_SYNC_SETTINGS);
      const cloudReady = cloudProvider.isConfigured();
      setCloudSyncStatus(cloudReady ? 'pending' : null);

      await storage.saveSettings(nextSettings);
      showSnackbar('Configuración guardada');
      void browseRemoteDirectory('');
      void browseCloudDirectory('');
      if (cloudReady) {
        void syncEngine.enqueueAllPendingCloud();
      } else {
        void syncEngine.flushOutbox();
      }
    },
    [gateway, cloudProvider, storage, showSnackbar, browseRemoteDirectory, browseCloudDirectory, syncEngine]
  );

  const handleTestConnection = useCallback(
    async (serverUrl: string, token: string): Promise<ConnectionTestResult> => {
      const probe = new JupyterHttpWebSocketGateway(serverUrl, token);
      return probe.testConnection();
    },
    []
  );

  const handleTestCloudConnection = useCallback(
    async (cloud: CloudSyncSettings) => {
      const probe = new GitHubContentsProvider(cloud);
      return probe.testConnection();
    },
    []
  );

  const handleKeepLocalConflict = useCallback(
    async (conflict: SyncConflict) => {
      await syncEngine.resolveConflictKeepLocal(conflict.path, conflict.target);
      setActiveConflict(null);
      await refreshLocalList();
      showSnackbar('Conflicto resuelto: versión local conservada', 'success');
    },
    [syncEngine, refreshLocalList, showSnackbar]
  );

  const handleUseRemoteConflict = useCallback(
    async (conflict: SyncConflict) => {
      const remoteDoc = await syncEngine.resolveConflictUseRemote(
        conflict.path,
        conflict.target
      );
      if (conflict.path === currentPathRef.current) {
        setNotebook(remoteDoc);
        setActiveCellId(remoteDoc.cells[0]?.id ?? null);
        setEditingCellId(null);
      }
      setActiveConflict(null);
      await refreshLocalList();
      showSnackbar('Conflicto resuelto: versión remota aplicada', 'success');
    },
    [syncEngine, refreshLocalList, showSnackbar]
  );

  const handleSaveCopyConflict = useCallback(
    async (conflict: SyncConflict) => {
      const { copyPath, remoteNotebook } = await syncEngine.resolveConflictSaveCopy(
        conflict.path,
        conflict.target
      );
      if (conflict.path === currentPathRef.current) {
        setNotebook(remoteNotebook);
        setActiveCellId(remoteNotebook.cells[0]?.id ?? null);
        setEditingCellId(null);
      }
      setActiveConflict(null);
      await refreshLocalList();
      showSnackbar(`Copia guardada en ${copyPath}`, 'success');
    },
    [syncEngine, refreshLocalList, showSnackbar]
  );

  const handleReconnect = useCallback(
    async (nextSettings: ConnectionSettings): Promise<ConnectionTestResult> => {
      setSettings(nextSettings);
      await storage.saveSettings(nextSettings);
      kernelIdRef.current = null;
      gateway.disconnectWebSocket();
      gateway.configure(nextSettings.serverUrl, nextSettings.token);

      const testRes = await gateway.testConnection();
      if (!testRes.ok) {
        setKernelState('DISCONNECTED');
        return testRes;
      }

      try {
        await ensureKernelRunning();
        void browseRemoteDirectory('');
        void syncEngine.flushOutbox();
        showSnackbar('Kernel reconectado a Jupyter', 'success');
        return testRes;
      } catch (error) {
        const classified = classifyConnectionError(error);
        return {
          ok: false,
          error: classified.message,
          errorKind: classified.kind,
        };
      }
    },
    [storage, gateway, ensureKernelRunning, browseRemoteDirectory, syncEngine, showSnackbar]
  );

  const handleCycleTheme = useCallback(async () => {
    const order: ThemePreference[] = ['auto', 'light', 'dark'];
    const nextTheme = order[(order.indexOf(settings.theme) + 1) % order.length] ?? 'auto';
    const nextSettings = { ...settings, theme: nextTheme };
    setSettings(nextSettings);
    await storage.saveSettings(nextSettings);
  }, [settings, storage]);

  const handleImportNotebook = useCallback(
    async (file: File) => {
      try {
        const rawText = await file.text();
        const { path: basePath, notebook: importedDoc } = parseImportedNotebook(
          file.name,
          rawText
        );
        const targetPath = remoteDirPath ? `${remoteDirPath}/${basePath}` : basePath;

        await storage.putNotebook({
          path: targetPath,
          notebook: importedDoc,
          updatedAt: Date.now(),
          syncedAt: null,
          pendingSync: true,
          isLocalOnly: true,
          serverLastModified: null,
          cloudSha: null,
          cloudSyncedAt: null,
          pendingCloudSync: cloudProvider.isConfigured(),
        });

        setCurrentPath(targetPath);
        setNotebook(importedDoc);
        setActiveCellId(importedDoc.cells[0]?.id ?? null);
        setEditingCellId(null);
        setSyncStatus('pending');

        const nextSettings = { ...settings, lastOpenedPath: targetPath };
        setSettings(nextSettings);
        await storage.saveSettings(nextSettings);
        await refreshLocalList();
        void syncEngine.forceSync(targetPath, importedDoc);
        showSnackbar(`Importado: ${targetPath}`, 'success');
      } catch (error) {
        showSnackbar(
          error instanceof Error ? error.message : 'No se pudo importar el .ipynb',
          'error'
        );
      }
    },
    [remoteDirPath, storage, cloudProvider, settings, refreshLocalList, syncEngine, showSnackbar]
  );

  const handleExportNotebook = useCallback(() => {
    downloadNotebookFile(currentPathRef.current, notebookRef.current);
    showSnackbar('Descargando archivo .ipynb');
  }, [showSnackbar]);

  const handleShareNotebook = useCallback(async () => {
    try {
      const outcome = await shareNotebookFile(currentPathRef.current, notebookRef.current);
      showSnackbar(
        outcome === 'shared' ? 'Apunte compartido' : 'Descargado como .ipynb',
        'success'
      );
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      downloadNotebookFile(currentPathRef.current, notebookRef.current);
      showSnackbar('Descargado como .ipynb');
    }
  }, [showSnackbar]);

  const handlePrintPdf = useCallback(() => {
    setEditingCellId(null);
    window.print();
  }, []);

  const handleDuplicateNotebook = useCallback(
    async (sourcePath: string) => {
      const existing = await storage.getNotebook(sourcePath);
      if (!existing) return;
      const base = sourcePath.replace(/\.ipynb$/i, '');
      const copyPath = `${base}_copia.ipynb`;
      const clonedDoc = JSON.parse(JSON.stringify(existing.notebook)) as NotebookDocument;

      await storage.putNotebook({
        path: copyPath,
        notebook: clonedDoc,
        updatedAt: Date.now(),
        syncedAt: null,
        pendingSync: true,
        isLocalOnly: true,
        serverLastModified: null,
        cloudSha: null,
        cloudSyncedAt: null,
        pendingCloudSync: cloudProvider.isConfigured(),
      });

      await refreshLocalList();
      void syncEngine.forceSync(copyPath, clonedDoc);
      showSnackbar(`Duplicado como ${copyPath}`, 'success');
    },
    [storage, cloudProvider, refreshLocalList, syncEngine, showSnackbar]
  );

  const handleRenameNotebookByPath = useCallback(
    async (oldPath: string, newName: string) => {
      const cleanName = newName.replace(/\.ipynb$/i, '').trim();
      if (!cleanName) return;
      const dir = oldPath.includes('/') ? oldPath.slice(0, oldPath.lastIndexOf('/')) : '';
      const newPath = dir ? `${dir}/${cleanName}.ipynb` : `${cleanName}.ipynb`;
      if (newPath === oldPath) return;

      const existing = await storage.getNotebook(oldPath);
      if (!existing) return;

      await storage.deleteNotebook(oldPath);
      await storage.deleteOutboxItem(oldPath, 'jupyter');
      await storage.deleteOutboxItem(oldPath, 'cloud');
      await storage.putNotebook({
        ...existing,
        path: newPath,
        updatedAt: Date.now(),
        pendingSync: true,
        pendingCloudSync: cloudProvider.isConfigured(),
      });

      if (currentPathRef.current === oldPath) {
        setCurrentPath(newPath);
        const nextSettings = { ...settings, lastOpenedPath: newPath };
        setSettings(nextSettings);
        await storage.saveSettings(nextSettings);
      }

      try {
        if (!existing.isLocalOnly) {
          await gateway.renameNotebook(oldPath, newPath);
        }
      } catch {
        // Outbox sync will handle saving at newPath
      }

      await refreshLocalList();
      void syncEngine.forceSync(newPath, existing.notebook);
      showSnackbar(`Renombrado a ${newPath}`);
    },
    [storage, cloudProvider, settings, gateway, refreshLocalList, syncEngine, showSnackbar]
  );

  const handleDeleteNotebook = useCallback(
    async (targetPath: string) => {
      const all = await storage.listAllNotebooks();
      if (all.length <= 1) {
        showSnackbar('Debe quedar al menos un apunte en el dispositivo', 'error');
        return;
      }

      const existing = await storage.getNotebook(targetPath);
      await storage.deleteNotebook(targetPath);
      await storage.deleteOutboxItem(targetPath, 'jupyter');
      await storage.deleteOutboxItem(targetPath, 'cloud');

      if (existing && !existing.isLocalOnly) {
        void gateway.deleteItem(targetPath).catch(() => {});
      }

      const remaining = await storage.listAllNotebooks();
      if (currentPathRef.current === targetPath && remaining[0]) {
        setCurrentPath(remaining[0].path);
        setNotebook(remaining[0].notebook);
        setActiveCellId(remaining[0].notebook.cells[0]?.id ?? null);
        setEditingCellId(null);
        const nextSettings = { ...settings, lastOpenedPath: remaining[0].path };
        setSettings(nextSettings);
        await storage.saveSettings(nextSettings);
      }

      await refreshLocalList();
      void browseRemoteDirectory(remoteDirPath);
      showSnackbar(`Eliminado: ${targetPath}`);
    },
    [storage, gateway, settings, refreshLocalList, browseRemoteDirectory, remoteDirPath, showSnackbar]
  );

  return (
    <div className="min-h-screen w-full bg-surface text-on-surface selection:bg-primary-container selection:text-on-primary-container">
      <TopAppBar
        title={getDisplayTitleFromPath(currentPath)}
        syncStatus={syncStatus}
        cloudSyncStatus={cloudSyncStatus}
        kernelState={kernelState}
        onOpenDrawer={() => {
          setDrawerOpen(true);
          void browseRemoteDirectory(remoteDirPath);
          void browseCloudDirectory(cloudDirPath);
        }}
        onRenameTitle={handleRenameTitle}
        onTitleEditingChange={setIsTitleEditing}
        onStartKernel={handleStartKernel}
        onInterruptKernel={handleInterruptKernel}
        onRestartKernel={handleRestartKernel}
        onShutdownKernel={handleShutdownKernel}
        onForceSync={() => void handleForceSync()}
      />

      <NotebookView
        notebook={notebook}
        activeCellId={activeCellId}
        editingCellId={editingCellId}
        executionState={executionState}
        isDark={isDark}
        pendingStdin={pendingStdin}
        onSelectCell={(id) => {
          if (editingCellId && editingCellId !== id) {
            setEditingCellId(null);
          }
          setActiveCellId(id);
        }}
        onEnterEdit={(id) => {
          setActiveCellId(id);
          setEditingCellId(id);
        }}
        onRunCell={runCellById}
        onChangeSource={handleChangeSource}
        onAttachImage={(cellId, file) => void handleAttachImage(cellId, file)}
        onToggleType={handleToggleCellType}
        onToggleHideSource={handleToggleHideSource}
        onDeleteCell={handleDeleteCell}
        onShortcut={handleEditorShortcut}
      />

      <CellFab
        onAddMarkdown={() =>
          handleInsertCellBelow(editingCellId ?? activeCellId, 'markdown', true)
        }
        onAddCode={() =>
          handleInsertCellBelow(editingCellId ?? activeCellId, 'code', true)
        }
      />

      <NavigationDrawer
        open={drawerOpen}
        currentPath={currentPath}
        remoteDirPath={remoteDirPath}
        remoteItems={remoteItems}
        remoteLoading={remoteLoading}
        remoteError={remoteError}
        cloudEnabled={Boolean(settings.cloud?.enabled)}
        cloudDirPath={cloudDirPath}
        cloudItems={cloudItems}
        cloudLoading={cloudLoading}
        cloudError={cloudError}
        localNotebooks={localNotebooks}
        theme={settings.theme}
        onClose={() => setDrawerOpen(false)}
        onBrowseDirectory={(dir) => void browseRemoteDirectory(dir)}
        onBrowseCloudDirectory={(dir) => void browseCloudDirectory(dir)}
        onSelectNotebook={(path, source) => void handleSelectNotebook(path, source)}
        onCreateNotebook={(name, dir) => void handleCreateNotebook(name, dir)}
        onImportNotebook={(file) => void handleImportNotebook(file)}
        onExportNotebook={handleExportNotebook}
        onShareNotebook={() => void handleShareNotebook()}
        onPrintPdf={handlePrintPdf}
        onDuplicateNotebook={(path) => void handleDuplicateNotebook(path)}
        onRenameNotebookByPath={(oldPath, newName) =>
          void handleRenameNotebookByPath(oldPath, newName)
        }
        onDeleteNotebook={(path) => void handleDeleteNotebook(path)}
        onOpenSettings={(tab = 'jupyter') => {
          setConnectionTab(tab);
          setConnectionOpen(true);
        }}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        onCycleTheme={() => void handleCycleTheme()}
      />

      <ConnectionDialog
        open={connectionOpen}
        initialTab={connectionTab}
        settings={settings}
        onClose={() => setConnectionOpen(false)}
        onSave={(next) => void handleSaveSettings(next)}
        onTestConnection={handleTestConnection}
        onReconnect={handleReconnect}
        onTestCloudConnection={handleTestCloudConnection}
      />

      <ConflictDialog
        conflict={activeConflict}
        onKeepLocal={handleKeepLocalConflict}
        onUseRemote={handleUseRemoteConflict}
        onSaveCopy={handleSaveCopyConflict}
        onDismiss={() => setActiveConflict(null)}
      />

      <ShortcutsModal
        open={shortcutsOpen}
        commands={commandsList}
        onClose={() => setShortcutsOpen(false)}
      />

      <Snackbar message={snackbar} onDismiss={() => setSnackbar(null)} />
    </div>
  );
}

export default App;
