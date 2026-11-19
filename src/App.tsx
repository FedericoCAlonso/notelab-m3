import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CommandId, CommandRegistry, RegisteredCommand } from './commands/CommandRegistry';
import {
  DEFAULT_NOTEBOOK_PATH,
  createStarterNotebook,
} from './data/welcomeNotebook';
import {
  ConnectionTestResult,
  JupyterHttpWebSocketGateway,
  KernelSpecInfo,
} from './services/jupyter/JupyterGateway';
import {
  classifyConnectionError,
  parseConnectionDeepLink,
} from './services/jupyter/connectionDeepLink';
import {
  DEFAULT_CLOUD_SYNC_SETTINGS,
  DEFAULT_CONNECTION_SETTINGS,
  IndexedDBNotebookStorage,
  StoredFolderRecord,
  StoredNotebookRecord,
} from './services/storage/NotebookDB';
import {
  downloadNotebookFile,
  parseImportedNotebook,
  shareNotebookFile,
} from './services/storage/notebookExport';
import {
  collectKnownFolders,
  generateUniqueNotebookPath,
  makeDuplicateNotebookPath,
  normalizeNotebookPath,
} from './services/storage/unifiedFiles';
import {
  createFolderOp,
  deleteFolderOp,
  moveFolderOp,
  moveNotebookOp,
  renameFolderOp,
} from './services/storage/folderOperations';
import { processImageFileToAttachment } from './services/storage/imageAttachment';
import { ActiveStdinPrompt } from './components/CellCard';
import { DeleteNotebookScope } from './components/NavigationDrawer';
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
import { DiscardDraftDialog } from './components/DiscardDraftDialog';
import { PackagesDialog, PackageInstallRequest } from './components/PackagesDialog';
import { PackageExecutor } from './services/python/packageManager';
import { ShortcutsModal } from './components/ShortcutsModal';
import { CellFab } from './components/CellFab';
import { Snackbar, SnackbarMessage } from './components/Snackbar';
import {
  ReactiveDocWorkspace,
  ReactivePythonExecutor,
} from './components/reactive/ReactiveDocWorkspace';
import { useReactiveDocs } from './hooks/useReactiveDocs';

function getDisplayTitleFromPath(path: string): string {
  const base = path.split('/').pop() || path;
  return base.replace(/\.(ipynb|md)$/i, '');
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
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('synced');
  const [cloudSyncStatus, setCloudSyncStatus] = useState<SyncStatus | null>(null);
  const [activeConflict, setActiveConflict] = useState<SyncConflict | null>(null);
  const [discardDialogOpen, setDiscardDialogOpen] = useState<boolean>(false);
  const [packagesOpen, setPackagesOpen] = useState<boolean>(false);
  const [packageRequest, setPackageRequest] = useState<PackageInstallRequest | null>(null);

  const bufferTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyBufferRef = useRef<{ path: string; notebook: NotebookDocument } | null>(null);

  const [activeCellId, setActiveCellId] = useState<string | null>(
    () => notebook.cells[0]?.id ?? null
  );
  const [editingCellId, setEditingCellId] = useState<string | null>(null);

  const [kernelState, setKernelState] = useState<KernelState>('DISCONNECTED');
  const [kernelSpecs, setKernelSpecs] = useState<KernelSpecInfo[]>([]);
  const [selectedKernelName, setSelectedKernelName] = useState<string>('python3');
  const kernelIdRef = useRef<string | null>(null);
  const selectedKernelNameRef = useRef<string>('python3');
  selectedKernelNameRef.current = selectedKernelName;
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
  const [localFolders, setLocalFolders] = useState<StoredFolderRecord[]>([]);
  const [discoveredFolders, setDiscoveredFolders] = useState<string[]>([]);
  const [activeDirPath, setActiveDirPath] = useState('');
  const [remoteItems, setRemoteItems] = useState<JupyterContentItem[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);

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

  const [activeDocKind, setActiveDocKind] = useState<'ipynb' | 'md'>('ipynb');

  const notifyFromReactive = useCallback(
    (text: string, tone?: 'info' | 'success' | 'error') => {
      showSnackbar(text, tone === 'info' ? 'neutral' : tone ?? 'neutral');
    },
    [showSnackbar]
  );

  const activateReactiveMode = useCallback(() => {
    setEditingCellId(null);
    setActiveDocKind('md');
  }, []);

  const reactive = useReactiveDocs({
    storage,
    cloudProvider,
    cloudEnabled: Boolean(settings.cloud?.enabled),
    onNotify: notifyFromReactive,
    onActivateReactiveMode: activateReactiveMode,
  });

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
    const [list, folders] = await Promise.all([
      storage.listAllNotebooks(),
      storage.listFolders ? storage.listFolders() : Promise.resolve([]),
    ]);
    setLocalNotebooks(list);
    setLocalFolders(folders);
  }, [storage]);

  const recordDiscoveredFolders = useCallback((paths: string[]) => {
    const clean = paths.map(normalizeNotebookPath).filter(Boolean);
    if (clean.length === 0) return;
    setDiscoveredFolders((prev) => {
      const merged = new Set(prev);
      let changed = false;
      for (const p of clean) {
        if (!merged.has(p)) {
          merged.add(p);
          changed = true;
        }
      }
      return changed ? Array.from(merged) : prev;
    });
  }, []);

  const browseDirectory = useCallback(
    async (dirPath = '') => {
      const cleanDir = normalizeNotebookPath(dirPath);
      setActiveDirPath(cleanDir);
      if (cleanDir) {
        recordDiscoveredFolders([cleanDir]);
      }

      setRemoteLoading(true);
      setRemoteError(null);
      const jupyterPromise = gateway
        .listDirectory(cleanDir)
        .then((items) => {
          setRemoteItems(items);
          recordDiscoveredFolders(
            items.filter((i) => i.type === 'directory').map((i) => i.path)
          );
        })
        .catch((error) => {
          setRemoteItems([]);
          setRemoteError(
            error instanceof Error ? error.message : 'Servidor no disponible'
          );
        })
        .finally(() => {
          setRemoteLoading(false);
        });

      let cloudPromise: Promise<void> = Promise.resolve();
      if (cloudProvider.isConfigured()) {
        setCloudLoading(true);
        setCloudError(null);
        cloudPromise = cloudProvider
          .list(cleanDir)
          .then((items) => {
            setCloudItems(items);
            recordDiscoveredFolders(
              items.filter((i) => i.type === 'dir').map((i) => i.path)
            );
          })
          .catch((error) => {
            setCloudItems([]);
            setCloudError(
              error instanceof Error ? error.message : 'No se pudo listar GitHub'
            );
          })
          .finally(() => {
            setCloudLoading(false);
          });
      } else {
        setCloudItems([]);
        setCloudError(null);
      }

      await Promise.all([jupyterPromise, cloudPromise]);
    },
    [gateway, cloudProvider, recordDiscoveredFolders]
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
    });

    return () => {
      unsubKernel();
      unsubSync();
      syncEngine.destroy();
      gateway.disconnectWebSocket();
    };
  }, [gateway, syncEngine, refreshLocalList]);

  // Kernel lifecycle actions
  const refreshKernelSpecs = useCallback(async (): Promise<string> => {
    if (!gateway.listKernelSpecs) {
      return notebookRef.current.metadata?.kernelspec?.name || selectedKernelNameRef.current;
    }
    try {
      const { defaultName, specs } = await gateway.listKernelSpecs();
      setKernelSpecs(specs);
      const nbSpec = notebookRef.current.metadata?.kernelspec?.name;
      const validNbSpec =
        nbSpec && specs.some((s) => s.name === nbSpec) ? nbSpec : undefined;
      const currentValid = specs.some((s) => s.name === selectedKernelNameRef.current)
        ? selectedKernelNameRef.current
        : undefined;
      const resolved = validNbSpec || currentValid || defaultName || 'python3';
      setSelectedKernelName(resolved);
      selectedKernelNameRef.current = resolved;
      return resolved;
    } catch {
      return notebookRef.current.metadata?.kernelspec?.name || selectedKernelNameRef.current;
    }
  }, [gateway]);

  const ensureKernelRunning = useCallback(
    async (overrideKernelName?: string): Promise<string> => {
      if (
        !overrideKernelName &&
        kernelIdRef.current &&
        (kernelStateRef.current === 'IDLE' || kernelStateRef.current === 'BUSY')
      ) {
        return kernelIdRef.current;
      }
      setKernelState((s) => transitionKernelState(s, { type: 'CONNECT' }));
      try {
        const targetName =
          overrideKernelName ||
          (await refreshKernelSpecs()) ||
          'python3';
        const info = await gateway.startKernel(targetName);
        kernelIdRef.current = info.id;
        setSelectedKernelName(targetName);
        setKernelState((s) => transitionKernelState(s, { type: 'CONNECTED' }));
        return info.id;
      } catch (error) {
        kernelIdRef.current = null;
        setKernelState('DISCONNECTED');
        throw error;
      }
    },
    [gateway, refreshKernelSpecs]
  );

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
        setHasUnsavedChanges(loaded.hasUnsavedChanges);
        setSyncStatus(loaded.status);
        if (cloudProvider.isConfigured()) {
          setCloudSyncStatus(loaded.cloudStatus ?? 'pending');
        }
        setActiveCellId(loaded.notebook.cells[0]?.id ?? null);
      } catch {
        const fallback = allLocal[0];
        if (fallback && mounted) {
          setCurrentPath(fallback.path);
          setNotebook(fallback.draftNotebook ?? fallback.notebook);
          setHasUnsavedChanges(Boolean(fallback.draftNotebook));
          setSyncStatus(fallback.pendingSync ? 'pending' : 'synced');
          if (cloudProvider.isConfigured()) {
            setCloudSyncStatus(fallback.pendingCloudSync ? 'pending' : 'synced');
          }
          setActiveCellId((fallback.draftNotebook ?? fallback.notebook).cells[0]?.id ?? null);
        }
      }

      await refreshLocalList();
      void syncEngine.flushOutbox();
      void browseDirectory('');

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
    browseDirectory,
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
        void browseDirectory('');
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
    browseDirectory,
    syncEngine,
    ensureKernelRunning,
    showSnackbar,
  ]);

  const flushPendingBuffer = useCallback(async () => {
    if (bufferTimerRef.current) {
      clearTimeout(bufferTimerRef.current);
      bufferTimerRef.current = null;
    }
    const pending = dirtyBufferRef.current;
    if (!pending) return;
    dirtyBufferRef.current = null;
    await syncEngine.saveDraftBuffer(pending.path, pending.notebook);
    await refreshLocalList();
  }, [syncEngine, refreshLocalList]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const onPageHide = () => {
      void flushPendingBuffer();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        void flushPendingBuffer();
      }
    };
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [flushPendingBuffer]);

  // Helper to commit notebook mutations strictly into the local working buffer
  const updateNotebook = useCallback(
    (updater: (prev: NotebookDocument) => NotebookDocument) => {
      const next = updater(notebookRef.current);
      notebookRef.current = next;
      setNotebook(next);
      setHasUnsavedChanges(true);

      const targetPath = currentPathRef.current;
      dirtyBufferRef.current = { path: targetPath, notebook: next };
      if (bufferTimerRef.current) {
        clearTimeout(bufferTimerRef.current);
      }
      bufferTimerRef.current = setTimeout(() => {
        bufferTimerRef.current = null;
        const pending = dirtyBufferRef.current;
        if (!pending) return;
        dirtyBufferRef.current = null;
        void syncEngine.saveDraftBuffer(pending.path, pending.notebook).then(() => {
          void refreshLocalList();
        });
      }, 200);
    },
    [syncEngine, refreshLocalList]
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

  const handleSelectKernelSpec = useCallback(
    async (specName: string) => {
      const spec = kernelSpecs.find((s) => s.name === specName);
      setSelectedKernelName(specName);
      selectedKernelNameRef.current = specName;

      updateNotebook((prev) => ({
        ...prev,
        metadata: {
          ...prev.metadata,
          kernelspec: {
            name: specName,
            display_name: spec?.displayName || specName,
            language: spec?.language || 'python',
          },
        },
      }));

      if (kernelIdRef.current) {
        const oldId = kernelIdRef.current;
        kernelIdRef.current = null;
        setExecutionState((prev) => clearExecutionQueue(prev));
        try {
          await gateway.shutdownKernel(oldId);
        } catch {
          // ignore if already gone
        }
      }

      try {
        await ensureKernelRunning(specName);
        showSnackbar(`Kernel cambiado a ${spec?.displayName || specName}`, 'success');
      } catch (error) {
        showSnackbar(
          error instanceof Error ? error.message : 'No se pudo iniciar el kernel seleccionado',
          'error'
        );
      }
    },
    [kernelSpecs, updateNotebook, gateway, ensureKernelRunning, showSnackbar]
  );

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

  // Package management (pip through the running kernel)
  const packageExecutor = useCallback<PackageExecutor>(
    async (code, options) => {
      const kernelId = await ensureKernelRunning();
      return gateway.executeCode(kernelId, code, {
        onOutput: (outputs) => options?.onOutput?.(outputs),
        timeoutMs: options?.timeoutMs,
        storeHistory: false,
      });
    },
    [ensureKernelRunning, gateway]
  );

  // Hybrid Python execution for Reactive Markdown (.md) blocks via the active Jupyter/Termux kernel
  const executeReactivePython = useCallback<ReactivePythonExecutor>(
    async (code, preamble, onOutput) => {
      const kernelId = await ensureKernelRunning();
      if (preamble.trim()) {
        await gateway.executeCode(kernelId, preamble, {
          storeHistory: false,
        });
      }
      const res = await gateway.executeCode(kernelId, code, {
        onOutput: (outputs) => onOutput(outputs),
        storeHistory: false,
      });
      return {
        outputs: res.outputs,
        hasError: res.hasError,
      };
    },
    [ensureKernelRunning, gateway]
  );

  const handleOpenPackages = useCallback(() => {
    setPackageRequest(null);
    setPackagesOpen(true);
  }, []);

  const handleInstallModule = useCallback((packageName: string, cellId: string) => {
    setPackageRequest({
      requestId: Date.now(),
      packages: [packageName],
      rerunCellId: cellId,
    });
    setPackagesOpen(true);
  }, []);

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
    if (bufferTimerRef.current) {
      clearTimeout(bufferTimerRef.current);
      bufferTimerRef.current = null;
    }
    dirtyBufferRef.current = null;

    const res = await syncEngine.commitAndSync(currentPathRef.current, notebookRef.current);
    setHasUnsavedChanges(false);
    await refreshLocalList();

    if (!res.ok && !res.offline && !res.conflict) {
      showSnackbar(`Error al guardar: ${res.error ?? 'desconocido'}`, 'error');
    }
  }, [syncEngine, refreshLocalList, showSnackbar]);

  const handleDiscardDraft = useCallback(
    async (targetPath = currentPathRef.current) => {
      if (bufferTimerRef.current && dirtyBufferRef.current?.path === targetPath) {
        clearTimeout(bufferTimerRef.current);
        bufferTimerRef.current = null;
        dirtyBufferRef.current = null;
      }

      const restored = await syncEngine.discardDraftBuffer(targetPath);
      if (targetPath === currentPathRef.current && restored) {
        notebookRef.current = restored;
        setNotebook(restored);
        setHasUnsavedChanges(false);
        setEditingCellId(null);
        setActiveCellId(restored.cells[0]?.id ?? null);
      }
      setDiscardDialogOpen(false);
      await refreshLocalList();
    },
    [syncEngine, refreshLocalList]
  );

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
    if (activeDocKind === 'md') {
      return;
    }
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
        isModalOpen:
          drawerOpen ||
          connectionOpen ||
          shortcutsOpen ||
          discardDialogOpen ||
          packagesOpen ||
          Boolean(activeConflict),
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
  }, [
    activeDocKind,
    commandRegistry,
    drawerOpen,
    connectionOpen,
    shortcutsOpen,
    discardDialogOpen,
    packagesOpen,
    activeConflict,
    isTitleEditing,
  ]);

  const handleEditorShortcut = useCallback(
    (commandId: CommandId) => {
      commandRegistry.executeById(commandId, {
        activeCellId: activeCellIdRef.current,
        activeCellState: 'EDITING',
        isModalOpen:
          drawerOpen ||
          connectionOpen ||
          shortcutsOpen ||
          discardDialogOpen ||
          packagesOpen ||
          Boolean(activeConflict),
        isTitleEditing,
        isTextInputFocused: false,
      });
    },
    [
      commandRegistry,
      drawerOpen,
      connectionOpen,
      shortcutsOpen,
      discardDialogOpen,
      packagesOpen,
      activeConflict,
      isTitleEditing,
    ]
  );

  // Notebook switching, creation, renaming
  const handleSelectNotebook = useCallback(
    async (path: string, preferredSource: 'auto' | 'cloud' = 'auto') => {
      setActiveDocKind('ipynb');
      setEditingCellId(null);
      try {
        await flushPendingBuffer();
        const loaded = await syncEngine.loadNotebook(path, preferredSource);
        setCurrentPath(path);
        setNotebook(loaded.notebook);
        setHasUnsavedChanges(loaded.hasUnsavedChanges);
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
    [
      flushPendingBuffer,
      syncEngine,
      cloudProvider,
      settings,
      storage,
      refreshLocalList,
      showSnackbar,
    ]
  );

  const collectKnownPaths = useCallback(async (): Promise<Set<string>> => {
    const known = new Set<string>();
    const local = await storage.listAllNotebooks();
    for (const rec of local) known.add(rec.path);
    for (const item of remoteItems) {
      if (item.type === 'notebook') known.add(item.path);
    }
    for (const item of cloudItems) {
      if (item.type === 'file') known.add(item.path);
    }
    return known;
  }, [storage, remoteItems, cloudItems]);

  const handleCreateNotebook = useCallback(
    async (name: string, dirPath: string) => {
      const cleanName = name.replace(/\.ipynb$/i, '').trim() || 'Nuevo_Apunte';
      const cleanDir = normalizeNotebookPath(dirPath);
      const desiredPath = cleanDir
        ? `${cleanDir}/${cleanName}.ipynb`
        : `${cleanName}.ipynb`;
      const known = await collectKnownPaths();
      const fullPath = generateUniqueNotebookPath(desiredPath, known);
      const titleForCell =
        fullPath.split('/').pop()?.replace(/\.ipynb$/i, '') || cleanName;
      const newDoc = createEmptyNotebook(titleForCell);

      await flushPendingBuffer();
      await storage.putNotebook({
        path: fullPath,
        notebook: newDoc,
        draftNotebook: null,
        draftUpdatedAt: null,
        updatedAt: Date.now(),
        syncedAt: null,
        pendingSync: true,
        isLocalOnly: true,
        serverLastModified: null,
        cloudSha: null,
        cloudSyncedAt: null,
        pendingCloudSync: cloudProvider.isConfigured(),
      });

      setCurrentPath(fullPath);
      setNotebook(newDoc);
      setHasUnsavedChanges(false);
      setActiveCellId(newDoc.cells[0]?.id ?? null);
      setEditingCellId(newDoc.cells[0]?.id ?? null);
      setSyncStatus('pending');

      const nextSettings = { ...settings, lastOpenedPath: fullPath };
      setSettings(nextSettings);
      await storage.saveSettings(nextSettings);
      await refreshLocalList();

      void syncEngine.forceSync(fullPath, newDoc).then(() => {
        void browseDirectory(activeDirPath);
      });
    },
    [
      collectKnownPaths,
      storage,
      cloudProvider,
      settings,
      refreshLocalList,
      syncEngine,
      browseDirectory,
      activeDirPath,
    ]
  );

  const renameNotebookAtPath = useCallback(
    async (oldPath: string, newName: string) => {
      const cleanTitle = newName.replace(/\.ipynb$/i, '').trim();
      if (!cleanTitle) return;

      const cleanOld = normalizeNotebookPath(oldPath);
      const dir = cleanOld.includes('/')
        ? cleanOld.slice(0, cleanOld.lastIndexOf('/'))
        : '';
      const newPath = dir ? `${dir}/${cleanTitle}.ipynb` : `${cleanTitle}.ipynb`;
      if (newPath === cleanOld) return;

      const known = await collectKnownPaths();
      if (known.has(newPath)) {
        showSnackbar(`Ya existe un apunte llamado ${newPath}`, 'error');
        return;
      }

      await flushPendingBuffer();
      const existing = await storage.getNotebook(cleanOld);
      const savedDoc =
        existing?.notebook ??
        (cleanOld === currentPathRef.current ? notebookRef.current : undefined);
      if (!savedDoc) return;

      await storage.deleteNotebook(cleanOld);
      await storage.deleteOutboxItem(cleanOld, 'jupyter');
      await storage.deleteOutboxItem(cleanOld, 'cloud');
      await storage.putNotebook({
        path: newPath,
        notebook: savedDoc,
        draftNotebook: existing?.draftNotebook ?? null,
        draftUpdatedAt: existing?.draftUpdatedAt ?? null,
        updatedAt: Date.now(),
        syncedAt: existing?.syncedAt ?? null,
        pendingSync: true,
        isLocalOnly: existing?.isLocalOnly ?? false,
        serverLastModified: existing?.serverLastModified ?? null,
        cloudSha: null,
        cloudSyncedAt: null,
        pendingCloudSync: cloudProvider.isConfigured(),
      });

      if (currentPathRef.current === cleanOld) {
        setCurrentPath(newPath);
        const nextSettings = { ...settings, lastOpenedPath: newPath };
        setSettings(nextSettings);
        await storage.saveSettings(nextSettings);
      }

      try {
        if (existing && !existing.isLocalOnly) {
          await gateway.renameNotebook(cleanOld, newPath);
        }
      } catch {
        // Outbox sync will handle saving at newPath
      }

      if (cloudProvider.isConfigured() && cloudProvider.deleteFile) {
        try {
          await cloudProvider.deleteFile(
            cleanOld,
            existing?.cloudSha ?? null,
            `NoteLab M3: renombrar ${cleanOld} -> ${newPath}`
          );
        } catch {
          // Non-fatal if old path wasn't in cloud or offline
        }
      }

      await refreshLocalList();
      await syncEngine.forceSync(newPath, savedDoc);
      void browseDirectory(activeDirPath);
      showSnackbar(`Renombrado a ${newPath}`, 'success');
    },
    [
      collectKnownPaths,
      flushPendingBuffer,
      storage,
      cloudProvider,
      settings,
      gateway,
      refreshLocalList,
      syncEngine,
      browseDirectory,
      activeDirPath,
      showSnackbar,
    ]
  );

  const handleRenameTitle = useCallback(
    async (newTitle: string) => {
      await renameNotebookAtPath(currentPathRef.current, newTitle);
    },
    [renameNotebookAtPath]
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
      void browseDirectory('');
      if (cloudReady) {
        void syncEngine.enqueueAllPendingCloud();
      } else {
        void syncEngine.flushOutbox();
      }
    },
    [gateway, cloudProvider, storage, showSnackbar, browseDirectory, syncEngine]
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
        void browseDirectory('');
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
    [storage, gateway, ensureKernelRunning, browseDirectory, syncEngine, showSnackbar]
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
        const desiredPath = activeDirPath ? `${activeDirPath}/${basePath}` : basePath;
        const known = await collectKnownPaths();
        const targetPath = generateUniqueNotebookPath(desiredPath, known);

        await flushPendingBuffer();
        await storage.putNotebook({
          path: targetPath,
          notebook: importedDoc,
          draftNotebook: null,
          draftUpdatedAt: null,
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
        setHasUnsavedChanges(false);
        setActiveCellId(importedDoc.cells[0]?.id ?? null);
        setEditingCellId(null);
        setSyncStatus('pending');

        const nextSettings = { ...settings, lastOpenedPath: targetPath };
        setSettings(nextSettings);
        await storage.saveSettings(nextSettings);
        await refreshLocalList();
        void syncEngine.forceSync(targetPath, importedDoc).then(() => {
          void browseDirectory(activeDirPath);
        });
        showSnackbar(`Importado: ${targetPath}`, 'success');
      } catch (error) {
        showSnackbar(
          error instanceof Error ? error.message : 'No se pudo importar el .ipynb',
          'error'
        );
      }
    },
    [
      activeDirPath,
      collectKnownPaths,
      storage,
      cloudProvider,
      settings,
      refreshLocalList,
      syncEngine,
      browseDirectory,
      showSnackbar,
    ]
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
      const known = await collectKnownPaths();
      const copyPath = makeDuplicateNotebookPath(sourcePath, known);
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
      void syncEngine.forceSync(copyPath, clonedDoc).then(() => {
        void browseDirectory(activeDirPath);
      });
      showSnackbar(`Duplicado como ${copyPath}`, 'success');
    },
    [
      storage,
      collectKnownPaths,
      cloudProvider,
      refreshLocalList,
      syncEngine,
      browseDirectory,
      activeDirPath,
      showSnackbar,
    ]
  );

  const handleRenameNotebookByPath = useCallback(
    async (oldPath: string, newName: string) => {
      await renameNotebookAtPath(oldPath, newName);
    },
    [renameNotebookAtPath]
  );

  const handleDeleteNotebook = useCallback(
    async (targetPath: string, scope: DeleteNotebookScope) => {
      const existing = await storage.getNotebook(targetPath);

      if (scope === 'local_only') {
        const all = await storage.listAllNotebooks();
        if (all.length <= 1 && targetPath === currentPathRef.current) {
          showSnackbar('Abre otro apunte antes de quitar la copia local actual', 'error');
          return;
        }
        await storage.deleteNotebook(targetPath);
        await storage.deleteOutboxItem(targetPath, 'jupyter');
        await storage.deleteOutboxItem(targetPath, 'cloud');

        const remaining = await storage.listAllNotebooks();
        if (currentPathRef.current === targetPath && remaining[0]) {
          dirtyBufferRef.current = null;
          setCurrentPath(remaining[0].path);
          setNotebook(remaining[0].draftNotebook ?? remaining[0].notebook);
          setHasUnsavedChanges(Boolean(remaining[0].draftNotebook));
          setActiveCellId((remaining[0].draftNotebook ?? remaining[0].notebook).cells[0]?.id ?? null);
          setEditingCellId(null);
          const nextSettings = { ...settings, lastOpenedPath: remaining[0].path };
          setSettings(nextSettings);
          await storage.saveSettings(nextSettings);
        }

        await refreshLocalList();
        showSnackbar(`Copia local quitada: ${targetPath}`);
        return;
      }

      // scope === 'everywhere'
      await storage.deleteNotebook(targetPath);
      await storage.deleteOutboxItem(targetPath, 'jupyter');
      await storage.deleteOutboxItem(targetPath, 'cloud');

      try {
        await gateway.deleteItem(targetPath);
      } catch {
        // Ignore if not on Jupyter server or offline
      }

      if (cloudProvider.isConfigured() && cloudProvider.deleteFile) {
        try {
          await cloudProvider.deleteFile(targetPath, existing?.cloudSha ?? null);
        } catch {
          // Ignore if not in GitHub or offline
        }
      }

      let remaining = await storage.listAllNotebooks();
      if (remaining.length === 0) {
        const starter = createStarterNotebook();
        await storage.putNotebook({
          path: DEFAULT_NOTEBOOK_PATH,
          notebook: starter,
          updatedAt: Date.now(),
          syncedAt: null,
          pendingSync: false,
          isLocalOnly: true,
          serverLastModified: null,
          cloudSha: null,
          cloudSyncedAt: null,
          pendingCloudSync: false,
        });
        remaining = await storage.listAllNotebooks();
      }

      if (currentPathRef.current === targetPath && remaining[0]) {
        dirtyBufferRef.current = null;
        setCurrentPath(remaining[0].path);
        setNotebook(remaining[0].draftNotebook ?? remaining[0].notebook);
        setHasUnsavedChanges(Boolean(remaining[0].draftNotebook));
        setActiveCellId((remaining[0].draftNotebook ?? remaining[0].notebook).cells[0]?.id ?? null);
        setEditingCellId(null);
        const nextSettings = { ...settings, lastOpenedPath: remaining[0].path };
        setSettings(nextSettings);
        await storage.saveSettings(nextSettings);
      }

      await refreshLocalList();
      void browseDirectory(activeDirPath);
      showSnackbar(`Eliminado: ${targetPath}`);
    },
    [
      storage,
      gateway,
      cloudProvider,
      settings,
      refreshLocalList,
      browseDirectory,
      activeDirPath,
      showSnackbar,
    ]
  );

  const folderOpsDeps = useMemo(
    () => ({
      storage,
      gateway,
      cloudProvider,
      syncEngine,
    }),
    [storage, gateway, cloudProvider, syncEngine]
  );

  const getKnownDirPaths = useCallback(
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

  const handleCreateFolder = useCallback(
    async (name: string, parentDir: string) => {
      const res = await createFolderOp(folderOpsDeps, {
        parentDir,
        name,
        existingDirPaths: getKnownDirPaths(),
      });
      if (!res.ok) {
        showSnackbar(res.error ?? 'No se pudo crear la carpeta', 'error');
        return;
      }
      if (res.path) {
        recordDiscoveredFolders([res.path]);
      }
      await refreshLocalList();
      void browseDirectory(activeDirPath);
      showSnackbar(`Carpeta creada: ${res.path}`, 'success');
    },
    [
      folderOpsDeps,
      getKnownDirPaths,
      recordDiscoveredFolders,
      refreshLocalList,
      browseDirectory,
      activeDirPath,
      showSnackbar,
    ]
  );

  const handleRenameFolder = useCallback(
    async (oldPath: string, newName: string) => {
      const res = await renameFolderOp(folderOpsDeps, {
        oldPath,
        newName,
        currentNotebookPath: currentPathRef.current,
        activeDirPath,
        existingDirPaths: getKnownDirPaths(),
      });
      if (!res.ok) {
        showSnackbar(res.error ?? 'No se pudo renombrar la carpeta', 'error');
        return;
      }
      if (!res.changed) return;

      if (res.currentNotebookPath !== currentPathRef.current) {
        setCurrentPath(res.currentNotebookPath);
        const nextSettings = { ...settings, lastOpenedPath: res.currentNotebookPath };
        setSettings(nextSettings);
        await storage.saveSettings(nextSettings);
      }
      if (res.newPath) {
        setDiscoveredFolders((prev) =>
          prev.filter((d) => d !== res.oldPath && !d.startsWith(`${res.oldPath}/`))
        );
        recordDiscoveredFolders([res.newPath]);
      }
      await refreshLocalList();
      void browseDirectory(res.activeDirPath);
      showSnackbar(`Carpeta renombrada a ${res.newPath}`, 'success');
    },
    [
      folderOpsDeps,
      activeDirPath,
      getKnownDirPaths,
      settings,
      storage,
      recordDiscoveredFolders,
      refreshLocalList,
      browseDirectory,
      showSnackbar,
    ]
  );

  const handleMoveFolder = useCallback(
    async (oldPath: string, targetParentDir: string) => {
      const res = await moveFolderOp(folderOpsDeps, {
        oldPath,
        targetParentDir,
        currentNotebookPath: currentPathRef.current,
        activeDirPath,
        existingDirPaths: getKnownDirPaths(),
      });
      if (!res.ok) {
        showSnackbar(res.error ?? 'No se pudo mover la carpeta', 'error');
        return;
      }
      if (!res.changed) return;

      if (res.currentNotebookPath !== currentPathRef.current) {
        setCurrentPath(res.currentNotebookPath);
        const nextSettings = { ...settings, lastOpenedPath: res.currentNotebookPath };
        setSettings(nextSettings);
        await storage.saveSettings(nextSettings);
      }
      if (res.newPath) {
        setDiscoveredFolders((prev) =>
          prev.filter((d) => d !== res.oldPath && !d.startsWith(`${res.oldPath}/`))
        );
        recordDiscoveredFolders([res.newPath]);
      }
      await refreshLocalList();
      void browseDirectory(res.activeDirPath);
      showSnackbar(`Carpeta movida a ${res.newPath}`, 'success');
    },
    [
      folderOpsDeps,
      activeDirPath,
      getKnownDirPaths,
      settings,
      storage,
      recordDiscoveredFolders,
      refreshLocalList,
      browseDirectory,
      showSnackbar,
    ]
  );

  const handleMoveNotebook = useCallback(
    async (oldPath: string, targetDir: string) => {
      const known = await collectKnownPaths();
      const res = await moveNotebookOp(folderOpsDeps, {
        oldPath,
        targetDir,
        currentNotebookPath: currentPathRef.current,
        existingPaths: known,
      });
      if (!res.ok) {
        showSnackbar(res.error ?? 'No se pudo mover el apunte', 'error');
        return;
      }
      if (!res.changed) return;

      if (res.currentNotebookPath !== currentPathRef.current) {
        setCurrentPath(res.currentNotebookPath);
        const nextSettings = { ...settings, lastOpenedPath: res.currentNotebookPath };
        setSettings(nextSettings);
        await storage.saveSettings(nextSettings);
      }
      await refreshLocalList();
      void browseDirectory(activeDirPath);
      showSnackbar(`Apunte movido a ${res.newPath}`, 'success');
    },
    [
      collectKnownPaths,
      folderOpsDeps,
      settings,
      storage,
      refreshLocalList,
      browseDirectory,
      activeDirPath,
      showSnackbar,
    ]
  );

  const handleDeleteFolder = useCallback(
    async (dirPath: string, scope: DeleteNotebookScope) => {
      const res = await deleteFolderOp(folderOpsDeps, {
        dirPath,
        scope,
        currentNotebookPath: currentPathRef.current,
        activeDirPath,
      });
      if (!res.ok) {
        showSnackbar(res.error ?? 'No se pudo eliminar la carpeta', 'error');
        return;
      }

      if (res.switchedNotebook) {
        dirtyBufferRef.current = null;
        setCurrentPath(res.switchedNotebook.path);
        setNotebook(res.switchedNotebook.draftNotebook ?? res.switchedNotebook.notebook);
        setHasUnsavedChanges(Boolean(res.switchedNotebook.draftNotebook));
        setActiveCellId(
          (res.switchedNotebook.draftNotebook ?? res.switchedNotebook.notebook).cells[0]?.id ?? null
        );
        setEditingCellId(null);
        const nextSettings = { ...settings, lastOpenedPath: res.switchedNotebook.path };
        setSettings(nextSettings);
        await storage.saveSettings(nextSettings);
      }

      setDiscoveredFolders((prev) =>
        prev.filter((d) => d !== res.dirPath && !d.startsWith(`${res.dirPath}/`))
      );
      await refreshLocalList();
      void browseDirectory(res.activeDirPath);
      showSnackbar(
        scope === 'local_only'
          ? `Copia local de carpeta quitada: ${res.dirPath}`
          : `Carpeta eliminada: ${res.dirPath}`
      );
    },
    [
      folderOpsDeps,
      activeDirPath,
      settings,
      storage,
      refreshLocalList,
      browseDirectory,
      showSnackbar,
    ]
  );

  return (
    <div className="min-h-screen w-full bg-surface text-on-surface selection:bg-primary-container selection:text-on-primary-container">
      <TopAppBar
        title={getDisplayTitleFromPath(
          activeDocKind === 'md' ? reactive.currentReactivePath : currentPath
        )}
        activeDocKind={activeDocKind}
        reactiveStatus={reactive.reactiveStatus}
        syncStatus={syncStatus}
        cloudSyncStatus={cloudSyncStatus}
        hasUnsavedChanges={activeDocKind === 'ipynb' && hasUnsavedChanges}
        kernelState={kernelState}
        kernelSpecs={kernelSpecs}
        activeKernelName={selectedKernelName}
        onOpenDrawer={() => {
          void flushPendingBuffer();
          setDrawerOpen(true);
          void browseDirectory(activeDirPath);
          void reactive.refreshCloudReactiveFiles();
        }}
        onRenameTitle={
          activeDocKind === 'md'
            ? (nextTitle) => void reactive.renameReactiveDoc(nextTitle)
            : handleRenameTitle
        }
        onTitleEditingChange={setIsTitleEditing}
        onStartKernel={handleStartKernel}
        onInterruptKernel={handleInterruptKernel}
        onRestartKernel={handleRestartKernel}
        onShutdownKernel={handleShutdownKernel}
        onSelectKernelSpec={(name) => void handleSelectKernelSpec(name)}
        onRefreshKernelSpecs={() => void refreshKernelSpecs()}
        onOpenPackages={handleOpenPackages}
        onForceSync={() =>
          activeDocKind === 'md'
            ? void reactive.forceSaveReactiveDoc()
            : void handleForceSync()
        }
        onDiscardChanges={() => setDiscardDialogOpen(true)}
      />

      {activeDocKind === 'md' ? (
        <ReactiveDocWorkspace
          docPath={reactive.currentReactivePath}
          content={reactive.reactiveContent}
          isDark={isDark}
          cachedPythonOutputs={reactive.currentPythonCache}
          cloudEnabled={Boolean(settings.cloud?.enabled)}
          pendingCloudSync={reactive.currentPendingCloud}
          cloudSyncBusy={reactive.cloudSyncBusy}
          onChangeContent={reactive.handleChangeReactiveContent}
          onCachePythonOutput={(key, entry) => void reactive.savePythonOutputCache(key, entry)}
          onSyncCloud={() => void reactive.syncCurrentReactiveToCloud()}
          onStatusChange={reactive.setReactiveStatus}
          onOpenShortcuts={() => setShortcutsOpen(true)}
          onForceSave={() => void reactive.forceSaveReactiveDoc()}
          onExecutePython={executeReactivePython}
          onInstallModule={(mod) => handleInstallModule(mod, '')}
        />
      ) : (
        <>
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
            onInstallModule={handleInstallModule}
          />

          <CellFab
            onAddMarkdown={() =>
              handleInsertCellBelow(editingCellId ?? activeCellId, 'markdown', true)
            }
            onAddCode={() =>
              handleInsertCellBelow(editingCellId ?? activeCellId, 'code', true)
            }
          />
        </>
      )}

      <NavigationDrawer
        open={drawerOpen}
        activeDocKind={activeDocKind}
        currentPath={currentPath}
        currentReactivePath={reactive.currentReactivePath}
        reactiveDocs={reactive.reactiveDocs}
        activeDirPath={activeDirPath}
        remoteItems={remoteItems}
        remoteLoading={remoteLoading}
        remoteError={remoteError}
        cloudEnabled={Boolean(settings.cloud?.enabled)}
        cloudItems={cloudItems}
        cloudLoading={cloudLoading}
        cloudError={cloudError}
        localNotebooks={localNotebooks}
        localFolders={localFolders}
        discoveredFolders={discoveredFolders}
        theme={settings.theme}
        onClose={() => setDrawerOpen(false)}
        onBrowseDirectory={(dir) => void browseDirectory(dir)}
        onSelectNotebook={(path, source) => void handleSelectNotebook(path, source)}
        onCreateNotebook={(name, dir) => void handleCreateNotebook(name, dir)}
        onCreateFolder={(name, parentDir) => void handleCreateFolder(name, parentDir)}
        onRenameFolder={(oldPath, newName) => void handleRenameFolder(oldPath, newName)}
        onMoveFolder={(oldPath, targetParentDir) =>
          void handleMoveFolder(oldPath, targetParentDir)
        }
        onDeleteFolder={(dirPath, scope) => void handleDeleteFolder(dirPath, scope)}
        onMoveNotebook={(oldPath, targetDir) => void handleMoveNotebook(oldPath, targetDir)}
        onImportNotebook={(file) => void handleImportNotebook(file)}
        onExportNotebook={handleExportNotebook}
        onShareNotebook={() => void handleShareNotebook()}
        onPrintPdf={handlePrintPdf}
        onDuplicateNotebook={(path) => void handleDuplicateNotebook(path)}
        onRenameNotebookByPath={(oldPath, newName) =>
          void handleRenameNotebookByPath(oldPath, newName)
        }
        onDeleteNotebook={(path, scope) => void handleDeleteNotebook(path, scope)}
        onDiscardNotebookDraft={(path) => void handleDiscardDraft(path)}
        onOpenSettings={(tab = 'jupyter') => {
          setConnectionTab(tab);
          setConnectionOpen(true);
        }}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        onCycleTheme={() => void handleCycleTheme()}
        onSelectReactiveDoc={(path) => void reactive.selectReactiveDoc(path)}
        onCreateReactiveDoc={(name) => void reactive.createReactiveDoc(name)}
        onDeleteReactiveDoc={(path) => void reactive.deleteReactiveDoc(path)}
        onImportReactiveDoc={(file) => void reactive.importReactiveDoc(file)}
        onExportReactiveDoc={reactive.exportReactiveDoc}
        onShareReactiveDoc={() => void reactive.shareReactiveDoc()}
        cloudReactiveFiles={reactive.cloudReactiveFiles}
        cloudReactiveBusy={reactive.cloudSyncBusy}
        onRefreshCloudReactiveFiles={() => void reactive.refreshCloudReactiveFiles()}
        onSyncReactiveToCloud={() => void reactive.syncCurrentReactiveToCloud()}
        onOpenCloudReactiveDoc={(path) => void reactive.openCloudReactiveDoc(path)}
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

      <DiscardDraftDialog
        open={discardDialogOpen}
        notebookName={currentPath}
        onKeepDraft={() => setDiscardDialogOpen(false)}
        onSaveAndClose={() => {
          setDiscardDialogOpen(false);
          void handleForceSync();
        }}
        onDiscard={() => void handleDiscardDraft(currentPath)}
      />

      <PackagesDialog
        open={packagesOpen}
        request={packageRequest}
        exec={packageExecutor}
        onClose={() => setPackagesOpen(false)}
        onRerunCell={runCellById}
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
