import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_REACTIVE_DOC_PATH,
  WELCOME_REACTIVE_DOC_CONTENT,
  createEmptyReactiveDocTemplate,
} from '../data/welcomeReactiveDoc';
import { CloudRemoteItem } from '../services/cloud/CloudSyncProvider';
import { GitHubContentsProvider } from '../services/cloud/GitHubContentsProvider';
import {
  downloadReactiveMarkdown,
  ensureMarkdownExtension,
  readImportedMarkdownFile,
  shareReactiveMarkdown,
} from '../services/reactive/reactiveDocExport';
import {
  CachedPythonBlockOutput,
  IndexedDBNotebookStorage,
  StoredReactiveDocRecord,
} from '../services/storage/NotebookDB';
import { ReactiveStatusSummary } from '../components/reactive/ReactiveDocWorkspace';

interface UseReactiveDocsOptions {
  storage: IndexedDBNotebookStorage;
  cloudProvider?: GitHubContentsProvider | null;
  cloudEnabled?: boolean;
  onNotify: (message: string, tone?: 'info' | 'success' | 'error') => void;
  onActivateReactiveMode: () => void;
}

export function useReactiveDocs({
  storage,
  cloudProvider = null,
  cloudEnabled = false,
  onNotify,
  onActivateReactiveMode,
}: UseReactiveDocsOptions) {
  const [reactiveDocs, setReactiveDocs] = useState<StoredReactiveDocRecord[]>([]);
  const [currentReactivePath, setCurrentReactivePath] = useState<string>(
    DEFAULT_REACTIVE_DOC_PATH
  );
  const [reactiveContent, setReactiveContent] = useState<string>(
    WELCOME_REACTIVE_DOC_CONTENT
  );
  const [currentPythonCache, setCurrentPythonCache] = useState<
    Record<string, CachedPythonBlockOutput>
  >({});
  const [currentPendingCloud, setCurrentPendingCloud] = useState<boolean>(false);
  const [reactiveStatus, setReactiveStatus] = useState<ReactiveStatusSummary | null>(null);

  const [cloudReactiveFiles, setCloudReactiveFiles] = useState<CloudRemoteItem[]>([]);
  const [cloudSyncBusy, setCloudSyncBusy] = useState(false);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentPathRef = useRef(currentReactivePath);
  currentPathRef.current = currentReactivePath;
  const contentRef = useRef(reactiveContent);
  contentRef.current = reactiveContent;
  const cloudEnabledRef = useRef(cloudEnabled);
  cloudEnabledRef.current = cloudEnabled;

  const refreshReactiveDocs = useCallback(async () => {
    const list = await storage.listAllReactiveDocs();
    setReactiveDocs(list);
    return list;
  }, [storage]);

  // Seed initial welcome reactive doc on first run if empty
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        let list = await storage.listAllReactiveDocs();
        if (list.length === 0) {
          const now = Date.now();
          const starter: StoredReactiveDocRecord = {
            path: DEFAULT_REACTIVE_DOC_PATH,
            content: WELCOME_REACTIVE_DOC_CONTENT,
            createdAt: now,
            updatedAt: now,
          };
          await storage.putReactiveDoc(starter);
          list = [starter];
        }
        if (!active) return;
        setReactiveDocs(list);
        const firstDoc = list[0];
        if (firstDoc) {
          setCurrentReactivePath(firstDoc.path);
          setReactiveContent(firstDoc.content);
          setCurrentPythonCache(firstDoc.pythonOutputCache ?? {});
          setCurrentPendingCloud(Boolean(firstDoc.pendingCloudSync));
        }
      } catch {
        // Fallback keeps in-memory welcome doc
      }
    })();

    return () => {
      active = false;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [storage]);

  const persistCurrentDoc = useCallback(
    async (pathToSave: string, contentToSave: string, markPendingCloud = true) => {
      const existing = await storage.getReactiveDoc(pathToSave);
      const now = Date.now();
      const pendingCloudSync = markPendingCloud
        ? Boolean(cloudEnabledRef.current)
        : Boolean(existing?.pendingCloudSync);
      await storage.putReactiveDoc({
        path: pathToSave,
        content: contentToSave,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        cloudSha: existing?.cloudSha ?? null,
        cloudSyncedAt: existing?.cloudSyncedAt ?? null,
        pendingCloudSync,
        pythonOutputCache: existing?.pythonOutputCache,
      });
      if (pathToSave === currentPathRef.current) {
        setCurrentPendingCloud(pendingCloudSync);
      }
      await refreshReactiveDocs();
    },
    [storage, refreshReactiveDocs]
  );

  const savePythonOutputCache = useCallback(
    async (blockKey: string, entry: CachedPythonBlockOutput) => {
      const targetPath = currentPathRef.current;
      const existing = await storage.getReactiveDoc(targetPath);
      const now = Date.now();
      const nextCache: Record<string, CachedPythonBlockOutput> = {
        ...(existing?.pythonOutputCache ?? {}),
        [blockKey]: entry,
      };
      setCurrentPythonCache(nextCache);
      await storage.putReactiveDoc({
        path: targetPath,
        content: existing?.content ?? contentRef.current,
        createdAt: existing?.createdAt ?? now,
        updatedAt: existing?.updatedAt ?? now,
        cloudSha: existing?.cloudSha ?? null,
        cloudSyncedAt: existing?.cloudSyncedAt ?? null,
        pendingCloudSync: existing?.pendingCloudSync,
        pythonOutputCache: nextCache,
      });
    },
    [storage]
  );

  const handleChangeReactiveContent = useCallback(
    (nextContent: string) => {
      setReactiveContent(nextContent);
      const pathAtEdit = currentPathRef.current;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        void persistCurrentDoc(pathAtEdit, nextContent, true);
      }, 300);
    },
    [persistCurrentDoc]
  );

  const refreshCloudReactiveFiles = useCallback(async () => {
    if (!cloudProvider || !cloudEnabled || !cloudProvider.isConfigured()) {
      setCloudReactiveFiles([]);
      return;
    }
    setCloudSyncBusy(true);
    try {
      const files = await cloudProvider.listMarkdownFiles();
      setCloudReactiveFiles(files);
    } catch {
      // Ignore offline errors quietly when listing
    } finally {
      setCloudSyncBusy(false);
    }
  }, [cloudProvider, cloudEnabled]);

  const syncCurrentReactiveToCloud = useCallback(async () => {
    const targetPath = currentPathRef.current;
    const currentText = contentRef.current;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    await persistCurrentDoc(targetPath, currentText, true);

    if (!cloudProvider || !cloudEnabled || !cloudProvider.isConfigured()) {
      onNotify(`Guardado localmente: ${targetPath}`, 'success');
      return;
    }

    setCloudSyncBusy(true);
    try {
      const existing = await storage.getReactiveDoc(targetPath);
      const pushed = await cloudProvider.pushTextFile(
        targetPath,
        currentText,
        existing?.cloudSha ?? null
      );
      const now = Date.now();
      await storage.putReactiveDoc({
        path: targetPath,
        content: currentText,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        cloudSha: pushed.sha,
        cloudSyncedAt: now,
        pendingCloudSync: false,
        pythonOutputCache: existing?.pythonOutputCache,
      });
      setCurrentPendingCloud(false);
      await refreshReactiveDocs();
      void refreshCloudReactiveFiles();
      onNotify(`Sincronizado en GitHub: ${targetPath}`, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error sincronizando con GitHub';
      onNotify(`Guardado local · GitHub: ${msg}`, 'error');
    } finally {
      setCloudSyncBusy(false);
    }
  }, [
    cloudProvider,
    cloudEnabled,
    storage,
    persistCurrentDoc,
    refreshReactiveDocs,
    refreshCloudReactiveFiles,
    onNotify,
  ]);

  const forceSaveReactiveDoc = useCallback(async () => {
    await syncCurrentReactiveToCloud();
  }, [syncCurrentReactiveToCloud]);

  const selectReactiveDoc = useCallback(
    async (path: string) => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        await persistCurrentDoc(currentPathRef.current, contentRef.current, true);
      }
      const record = await storage.getReactiveDoc(path);
      if (record) {
        setCurrentReactivePath(record.path);
        setReactiveContent(record.content);
        setCurrentPythonCache(record.pythonOutputCache ?? {});
        setCurrentPendingCloud(Boolean(record.pendingCloudSync));
        onActivateReactiveMode();
      }
    },
    [storage, persistCurrentDoc, onActivateReactiveMode]
  );

  const openCloudReactiveDoc = useCallback(
    async (remotePath: string) => {
      if (!cloudProvider || !cloudProvider.isConfigured()) return;
      setCloudSyncBusy(true);
      try {
        const pulled = await cloudProvider.pullTextFile(remotePath);
        const existing = await storage.getReactiveDoc(remotePath);
        const now = Date.now();
        await storage.putReactiveDoc({
          path: remotePath,
          content: pulled.content,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          cloudSha: pulled.sha,
          cloudSyncedAt: now,
          pendingCloudSync: false,
          pythonOutputCache: existing?.pythonOutputCache,
        });
        await refreshReactiveDocs();
        setCurrentReactivePath(remotePath);
        setReactiveContent(pulled.content);
        setCurrentPythonCache(existing?.pythonOutputCache ?? {});
        setCurrentPendingCloud(false);
        onActivateReactiveMode();
        onNotify(`Descargado de GitHub: ${remotePath}`, 'success');
      } catch (err) {
        onNotify(
          err instanceof Error ? err.message : 'No se pudo descargar desde GitHub',
          'error'
        );
      } finally {
        setCloudSyncBusy(false);
      }
    },
    [cloudProvider, storage, refreshReactiveDocs, onActivateReactiveMode, onNotify]
  );

  const createReactiveDoc = useCallback(
    async (rawName: string) => {
      let candidate = ensureMarkdownExtension(rawName);
      const existing = await storage.listAllReactiveDocs();
      const taken = new Set(existing.map((d) => d.path.toLowerCase()));
      if (taken.has(candidate.toLowerCase())) {
        const stem = candidate.replace(/\.md$/i, '');
        let suffix = 2;
        while (taken.has(`${stem}_${suffix}.md`.toLowerCase())) {
          suffix += 1;
        }
        candidate = `${stem}_${suffix}.md`;
      }

      const now = Date.now();
      const content = createEmptyReactiveDocTemplate(candidate);
      await storage.putReactiveDoc({
        path: candidate,
        content,
        createdAt: now,
        updatedAt: now,
        pendingCloudSync: Boolean(cloudEnabledRef.current),
      });
      await refreshReactiveDocs();
      setCurrentReactivePath(candidate);
      setReactiveContent(content);
      setCurrentPythonCache({});
      setCurrentPendingCloud(Boolean(cloudEnabledRef.current));
      onActivateReactiveMode();
      onNotify(`Nota reactiva creada: ${candidate}`, 'success');
    },
    [storage, refreshReactiveDocs, onActivateReactiveMode, onNotify]
  );

  const renameReactiveDoc = useCallback(
    async (newTitle: string) => {
      const oldPath = currentPathRef.current;
      const newPath = ensureMarkdownExtension(newTitle);
      if (newPath === oldPath) return;

      const existingTarget = await storage.getReactiveDoc(newPath);
      if (existingTarget) {
        onNotify(`Ya existe una nota llamada "${newPath}"`, 'error');
        return;
      }

      const existingOld = await storage.getReactiveDoc(oldPath);
      const now = Date.now();
      await storage.putReactiveDoc({
        path: newPath,
        content: contentRef.current,
        createdAt: existingOld?.createdAt ?? now,
        updatedAt: now,
        cloudSha: null,
        cloudSyncedAt: null,
        pendingCloudSync: Boolean(cloudEnabledRef.current),
        pythonOutputCache: existingOld?.pythonOutputCache,
      });
      await storage.deleteReactiveDoc(oldPath);
      setCurrentReactivePath(newPath);
      setCurrentPendingCloud(Boolean(cloudEnabledRef.current));
      await refreshReactiveDocs();
      onNotify(`Renombrado a ${newPath}`, 'success');
    },
    [storage, refreshReactiveDocs, onNotify]
  );

  const deleteReactiveDoc = useCallback(
    async (targetPath: string) => {
      await storage.deleteReactiveDoc(targetPath);
      let remaining = await storage.listAllReactiveDocs();
      if (remaining.length === 0) {
        const now = Date.now();
        const starter: StoredReactiveDocRecord = {
          path: DEFAULT_REACTIVE_DOC_PATH,
          content: WELCOME_REACTIVE_DOC_CONTENT,
          createdAt: now,
          updatedAt: now,
        };
        await storage.putReactiveDoc(starter);
        remaining = [starter];
      }
      setReactiveDocs(remaining);
      const fallbackDoc = remaining[0];
      if (currentPathRef.current === targetPath && fallbackDoc) {
        setCurrentReactivePath(fallbackDoc.path);
        setReactiveContent(fallbackDoc.content);
        setCurrentPythonCache(fallbackDoc.pythonOutputCache ?? {});
        setCurrentPendingCloud(Boolean(fallbackDoc.pendingCloudSync));
      }
      onNotify(`Nota eliminada: ${targetPath}`);
    },
    [storage, onNotify]
  );

  const importReactiveDoc = useCallback(
    async (file: File) => {
      try {
        const { path, content } = await readImportedMarkdownFile(file);
        const now = Date.now();
        await storage.putReactiveDoc({
          path,
          content,
          createdAt: now,
          updatedAt: now,
          pendingCloudSync: Boolean(cloudEnabledRef.current),
        });
        await refreshReactiveDocs();
        setCurrentReactivePath(path);
        setReactiveContent(content);
        setCurrentPythonCache({});
        setCurrentPendingCloud(Boolean(cloudEnabledRef.current));
        onActivateReactiveMode();
        onNotify(`Importado: ${path}`, 'success');
      } catch (err) {
        onNotify(
          err instanceof Error ? err.message : 'No se pudo importar el archivo .md',
          'error'
        );
      }
    },
    [storage, refreshReactiveDocs, onActivateReactiveMode, onNotify]
  );

  const exportReactiveDoc = useCallback(() => {
    downloadReactiveMarkdown(currentPathRef.current, contentRef.current);
    onNotify(`Descargado: ${currentPathRef.current}`, 'success');
  }, [onNotify]);

  const shareReactiveDoc = useCallback(async () => {
    try {
      const res = await shareReactiveMarkdown(currentPathRef.current, contentRef.current);
      if (res === 'downloaded') {
        onNotify(`Descargado: ${currentPathRef.current}`, 'success');
      }
    } catch {
      // User cancelled native share sheet
    }
  }, [onNotify]);

  return {
    reactiveDocs,
    currentReactivePath,
    reactiveContent,
    currentPythonCache,
    currentPendingCloud,
    reactiveStatus,
    cloudReactiveFiles,
    cloudSyncBusy,
    setReactiveStatus,
    handleChangeReactiveContent,
    savePythonOutputCache,
    forceSaveReactiveDoc,
    syncCurrentReactiveToCloud,
    refreshCloudReactiveFiles,
    openCloudReactiveDoc,
    selectReactiveDoc,
    createReactiveDoc,
    renameReactiveDoc,
    deleteReactiveDoc,
    importReactiveDoc,
    exportReactiveDoc,
    shareReactiveDoc,
  };
}
