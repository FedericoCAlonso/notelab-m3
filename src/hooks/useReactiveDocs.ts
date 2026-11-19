import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_REACTIVE_DOC_PATH,
  WELCOME_REACTIVE_DOC_CONTENT,
  createEmptyReactiveDocTemplate,
} from '../data/welcomeReactiveDoc';
import {
  downloadReactiveMarkdown,
  ensureMarkdownExtension,
  readImportedMarkdownFile,
  shareReactiveMarkdown,
} from '../services/reactive/reactiveDocExport';
import {
  IndexedDBNotebookStorage,
  StoredReactiveDocRecord,
} from '../services/storage/NotebookDB';
import { ReactiveStatusSummary } from '../components/reactive/ReactiveDocWorkspace';

interface UseReactiveDocsOptions {
  storage: IndexedDBNotebookStorage;
  onNotify: (message: string, tone?: 'info' | 'success' | 'error') => void;
  onActivateReactiveMode: () => void;
}

export function useReactiveDocs({
  storage,
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
  const [reactiveStatus, setReactiveStatus] = useState<ReactiveStatusSummary | null>(null);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentPathRef = useRef(currentReactivePath);
  currentPathRef.current = currentReactivePath;
  const contentRef = useRef(reactiveContent);
  contentRef.current = reactiveContent;

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
    async (pathToSave: string, contentToSave: string) => {
      const existing = await storage.getReactiveDoc(pathToSave);
      const now = Date.now();
      await storage.putReactiveDoc({
        path: pathToSave,
        content: contentToSave,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      await refreshReactiveDocs();
    },
    [storage, refreshReactiveDocs]
  );

  const handleChangeReactiveContent = useCallback(
    (nextContent: string) => {
      setReactiveContent(nextContent);
      const pathAtEdit = currentPathRef.current;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        void persistCurrentDoc(pathAtEdit, nextContent);
      }, 300);
    },
    [persistCurrentDoc]
  );

  const forceSaveReactiveDoc = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    await persistCurrentDoc(currentPathRef.current, contentRef.current);
    onNotify(`Guardado localmente: ${currentPathRef.current}`, 'success');
  }, [persistCurrentDoc, onNotify]);

  const selectReactiveDoc = useCallback(
    async (path: string) => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        await persistCurrentDoc(currentPathRef.current, contentRef.current);
      }
      const record = await storage.getReactiveDoc(path);
      if (record) {
        setCurrentReactivePath(record.path);
        setReactiveContent(record.content);
        onActivateReactiveMode();
      }
    },
    [storage, persistCurrentDoc, onActivateReactiveMode]
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
      });
      await refreshReactiveDocs();
      setCurrentReactivePath(candidate);
      setReactiveContent(content);
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
      });
      await storage.deleteReactiveDoc(oldPath);
      setCurrentReactivePath(newPath);
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
        });
        await refreshReactiveDocs();
        setCurrentReactivePath(path);
        setReactiveContent(content);
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
    reactiveStatus,
    setReactiveStatus,
    handleChangeReactiveContent,
    forceSaveReactiveDoc,
    selectReactiveDoc,
    createReactiveDoc,
    renameReactiveDoc,
    deleteReactiveDoc,
    importReactiveDoc,
    exportReactiveDoc,
    shareReactiveDoc,
  };
}
