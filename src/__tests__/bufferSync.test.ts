import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CONNECTION_SETTINGS,
  INotebookStorage,
  OutboxItem,
  StoredNotebookRecord,
  makeOutboxId,
} from '../services/storage/NotebookDB';
import { buildUnifiedFileList } from '../services/storage/unifiedFiles';
import { IJupyterGateway } from '../services/jupyter/JupyterGateway';
import { ICloudSyncProvider } from '../services/cloud/CloudSyncProvider';
import { SyncEngine } from '../services/sync/SyncEngine';
import { createMarkdownCell } from '../types/nbformat';

function createBufferTestStorage() {
  const notebooks = new Map<string, StoredNotebookRecord>();
  const outbox = new Map<string, OutboxItem>();
  let settings = DEFAULT_CONNECTION_SETTINGS;

  const storage: INotebookStorage = {
    getNotebook: async (path) => notebooks.get(path),
    putNotebook: async (rec) => {
      notebooks.set(rec.path, rec);
    },
    deleteNotebook: async (path) => {
      notebooks.delete(path);
    },
    listAllNotebooks: async () => Array.from(notebooks.values()),
    getOutboxItem: async (path, target = 'jupyter') =>
      outbox.get(makeOutboxId(target, path)),
    putOutboxItem: async (item) => {
      const target = item.target ?? 'jupyter';
      const id = item.id ?? makeOutboxId(target, item.path);
      outbox.set(id, { ...item, target, id });
    },
    deleteOutboxItem: async (path, target = 'jupyter') => {
      outbox.delete(makeOutboxId(target, path));
    },
    listOutboxItems: async () => Array.from(outbox.values()),
    getSettings: async () => settings,
    saveSettings: async (next) => {
      settings = next;
    },
  };

  return { storage, notebooks, outbox };
}

describe('Buffer-first editing, persistence on close, commit and discard', () => {
  it('keeps edits in draftNotebook buffer without overwriting original or pushing to remotes', async () => {
    const { storage, notebooks, outbox } = createBufferTestStorage();
    const originalDoc = {
      nbformat: 4 as const,
      nbformat_minor: 5,
      metadata: {},
      cells: [createMarkdownCell('# Original guardado')],
    };
    const draftDoc = {
      nbformat: 4 as const,
      nbformat_minor: 5,
      metadata: {},
      cells: [createMarkdownCell('# Edición en buffer')],
    };

    notebooks.set('nota.ipynb', {
      path: 'nota.ipynb',
      notebook: originalDoc,
      updatedAt: 1000,
      syncedAt: 1000,
      pendingSync: false,
      isLocalOnly: false,
      serverLastModified: '2026-11-18T10:00:00Z',
    });

    const mockGateway = {
      saveNotebook: vi.fn(),
      getNotebook: vi.fn(async () => ({
        notebook: originalDoc,
        lastModified: '2026-11-18T10:00:00Z',
      })),
    } as unknown as IJupyterGateway;

    const mockCloud: ICloudSyncProvider = {
      configure: vi.fn(),
      isConfigured: () => true,
      testConnection: vi.fn(async () => ({ ok: true })),
      getRemoteVersion: vi.fn(async () => null),
      pull: vi.fn(),
      push: vi.fn(async (p) => ({ sha: 'sha-1', path: p })),
      list: vi.fn(async () => []),
    };

    const engine = new SyncEngine(storage, mockGateway, mockCloud);

    // 1. Editing writes ONLY to draft buffer
    await engine.saveDraftBuffer('nota.ipynb', draftDoc);
    expect(mockGateway.saveNotebook).not.toHaveBeenCalled();
    expect(mockCloud.push).not.toHaveBeenCalled();
    expect(outbox.size).toBe(0);

    const recAfterDraft = await storage.getNotebook('nota.ipynb');
    expect(recAfterDraft?.notebook.cells[0]?.source).toBe('# Original guardado');
    expect(recAfterDraft?.draftNotebook?.cells[0]?.source).toBe('# Edición en buffer');

    // Unified file list exposes hasDraft flag
    const list = buildUnifiedFileList({
      currentDir: '',
      filter: 'folder',
      localNotebooks: [recAfterDraft!],
      remoteItems: [],
      cloudItems: [],
      cloudEnabled: true,
    });
    expect(list.notebooks[0]?.hasDraft).toBe(true);

    // 2. Reopening / reloading preserves the draft buffer automatically
    const reloaded = await engine.loadNotebook('nota.ipynb');
    expect(reloaded.hasUnsavedChanges).toBe(true);
    expect(reloaded.notebook.cells[0]?.source).toBe('# Edición en buffer');
    expect(mockGateway.getNotebook).not.toHaveBeenCalled();

    // 3. Explicit discard restores original without remote calls
    const restored = await engine.discardDraftBuffer('nota.ipynb');
    expect(restored?.cells[0]?.source).toBe('# Original guardado');
    const afterDiscard = await storage.getNotebook('nota.ipynb');
    expect(afterDiscard?.draftNotebook).toBeNull();
    expect(mockGateway.saveNotebook).not.toHaveBeenCalled();

    // 4. Re-edit and explicit commit overwrites original and syncs
    await engine.saveDraftBuffer('nota.ipynb', draftDoc);
    (mockGateway.saveNotebook as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      lastModified: '2026-11-18T11:00:00Z',
    });
    const commitRes = await engine.commitAndSync('nota.ipynb', draftDoc);
    expect(commitRes.ok).toBe(true);
    expect(mockGateway.saveNotebook).toHaveBeenCalledTimes(1);
    expect(mockCloud.push).toHaveBeenCalledTimes(1);

    const afterCommit = await storage.getNotebook('nota.ipynb');
    expect(afterCommit?.notebook.cells[0]?.source).toBe('# Edición en buffer');
    expect(afterCommit?.draftNotebook).toBeNull();

    engine.destroy();
  });
});
