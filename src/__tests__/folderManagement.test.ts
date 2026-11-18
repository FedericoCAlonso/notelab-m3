import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CONNECTION_SETTINGS,
  INotebookStorage,
  OutboxItem,
  StoredFolderRecord,
  StoredNotebookRecord,
  makeOutboxId,
} from '../services/storage/NotebookDB';
import {
  createFolderOp,
  deleteFolderOp,
  moveFolderOp,
  moveNotebookOp,
  renameFolderOp,
} from '../services/storage/folderOperations';
import { ICloudSyncProvider } from '../services/cloud/CloudSyncProvider';
import { GitHubContentsProvider, utf8ToBase64 } from '../services/cloud/GitHubContentsProvider';
import {
  IJupyterGateway,
  JupyterHttpWebSocketGateway,
} from '../services/jupyter/JupyterGateway';
import { SyncEngine } from '../services/sync/SyncEngine';
import { createMarkdownCell } from '../types/nbformat';

function createFolderAwareMemoryStorage() {
  const notebooks = new Map<string, StoredNotebookRecord>();
  const folders = new Map<string, StoredFolderRecord>();
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
    listFolders: async () => Array.from(folders.values()),
    putFolder: async (rec) => {
      folders.set(rec.path, rec);
    },
    deleteFolder: async (path) => {
      folders.delete(path);
    },
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

  return { storage, notebooks, folders, outbox };
}

function makeNotebookRecord(
  path: string,
  overrides: Partial<StoredNotebookRecord> = {}
): StoredNotebookRecord {
  return {
    path,
    notebook: {
      nbformat: 4,
      nbformat_minor: 5,
      metadata: {},
      cells: [createMarkdownCell(`# ${path}`)],
    },
    updatedAt: 1000,
    syncedAt: 900,
    pendingSync: false,
    isLocalOnly: false,
    serverLastModified: '2026-11-18T10:00:00Z',
    ...overrides,
  };
}

describe('Folder management operations', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates folders locally, in Jupyter and in Cloud, and blocks duplicates/invalid names', async () => {
    const { storage, folders } = createFolderAwareMemoryStorage();
    const gateway = {
      listDirectory: vi.fn(async () => []),
      createDirectory: vi.fn(async (path: string) => ({
        path,
        lastModified: '2026-11-18T12:00:00Z',
      })),
    } as unknown as IJupyterGateway;
    const cloud: ICloudSyncProvider = {
      configure: vi.fn(),
      isConfigured: () => true,
      testConnection: vi.fn(async () => ({ ok: true })),
      getRemoteVersion: vi.fn(async () => null),
      pull: vi.fn(),
      push: vi.fn(),
      list: vi.fn(async () => []),
      ensureDirectory: vi.fn(async () => undefined),
    };
    const syncEngine = new SyncEngine(storage, gateway, cloud);

    const bad = await createFolderOp(
      { storage, gateway, cloudProvider: cloud, syncEngine },
      { parentDir: '', name: 'A/B', existingDirPaths: [] }
    );
    expect(bad.ok).toBe(false);

    const created = await createFolderOp(
      { storage, gateway, cloudProvider: cloud, syncEngine },
      { parentDir: 'Ciencias', name: 'Fisica', existingDirPaths: ['Ciencias'] }
    );
    expect(created).toEqual({ ok: true, path: 'Ciencias/Fisica' });
    expect(folders.has('Ciencias')).toBe(true);
    expect(folders.has('Ciencias/Fisica')).toBe(true);
    expect(gateway.createDirectory).toHaveBeenCalledWith('Ciencias/Fisica');
    expect(cloud.ensureDirectory).toHaveBeenCalledWith('Ciencias/Fisica');

    const dup = await createFolderOp(
      { storage, gateway, cloudProvider: cloud, syncEngine },
      {
        parentDir: 'Ciencias',
        name: 'fisica',
        existingDirPaths: ['Ciencias', 'Ciencias/Fisica'],
      }
    );
    expect(dup.ok).toBe(false);

    syncEngine.destroy();
  });

  it('renames and moves folders while remapping nested notebooks, outbox and active paths', async () => {
    const { storage, notebooks, folders, outbox } = createFolderAwareMemoryStorage();
    folders.set('Fisica', { path: 'Fisica', createdAt: 1 });
    folders.set('Fisica/Optica', { path: 'Fisica/Optica', createdAt: 2 });
    notebooks.set(
      'Fisica/Optica/Luz.ipynb',
      makeNotebookRecord('Fisica/Optica/Luz.ipynb', { cloudSha: 'sha-luz' })
    );
    await storage.putOutboxItem({
      target: 'jupyter',
      path: 'Fisica/Optica/Luz.ipynb',
      action: 'save',
      createdAt: 1,
      retryCount: 0,
      nextRetryAt: 0,
    });

    const gateway = {
      listDirectory: vi.fn(async () => []),
      createDirectory: vi.fn(async (p: string) => ({ path: p, lastModified: '' })),
      renameItem: vi.fn(async (_o: string, n: string) => ({ path: n, lastModified: '' })),
      saveNotebook: vi.fn(async () => ({ lastModified: '' })),
    } as unknown as IJupyterGateway;
    const cloud: ICloudSyncProvider = {
      configure: vi.fn(),
      isConfigured: () => true,
      testConnection: vi.fn(async () => ({ ok: true })),
      getRemoteVersion: vi.fn(async () => null),
      pull: vi.fn(),
      push: vi.fn(),
      list: vi.fn(async () => []),
      renameDirectory: vi.fn(async () => [
        {
          oldPath: 'Fisica/Optica/Luz.ipynb',
          newPath: 'Fisica_1/Optica/Luz.ipynb',
          newSha: 'sha-luz-2',
        },
      ]),
    };
    const syncEngine = new SyncEngine(storage, gateway, cloud);

    const renamed = await renameFolderOp(
      { storage, gateway, cloudProvider: cloud, syncEngine },
      {
        oldPath: 'Fisica',
        newName: 'Fisica_1',
        currentNotebookPath: 'Fisica/Optica/Luz.ipynb',
        activeDirPath: 'Fisica/Optica',
        existingDirPaths: ['Fisica', 'Fisica/Optica', 'Ciencias'],
      }
    );

    expect(renamed.ok).toBe(true);
    expect(renamed.newPath).toBe('Fisica_1');
    expect(renamed.currentNotebookPath).toBe('Fisica_1/Optica/Luz.ipynb');
    expect(renamed.activeDirPath).toBe('Fisica_1/Optica');
    expect(folders.has('Fisica')).toBe(false);
    expect(folders.has('Fisica_1/Optica')).toBe(true);
    expect(notebooks.has('Fisica/Optica/Luz.ipynb')).toBe(false);
    expect(notebooks.get('Fisica_1/Optica/Luz.ipynb')?.cloudSha).toBe('sha-luz-2');
    expect(outbox.has(makeOutboxId('jupyter', 'Fisica/Optica/Luz.ipynb'))).toBe(false);

    // Block moving a folder inside itself or a descendant
    const invalidMove = await moveFolderOp(
      { storage, gateway, cloudProvider: cloud, syncEngine },
      {
        oldPath: 'Fisica_1',
        targetParentDir: 'Fisica_1/Optica',
        currentNotebookPath: 'Fisica_1/Optica/Luz.ipynb',
        activeDirPath: 'Fisica_1',
        existingDirPaths: ['Fisica_1', 'Fisica_1/Optica', 'Ciencias'],
      }
    );
    expect(invalidMove.ok).toBe(false);

    // Move Fisica_1 into Ciencias
    const moved = await moveFolderOp(
      { storage, gateway, cloudProvider: cloud, syncEngine },
      {
        oldPath: 'Fisica_1',
        targetParentDir: 'Ciencias',
        currentNotebookPath: 'Fisica_1/Optica/Luz.ipynb',
        activeDirPath: 'Fisica_1',
        existingDirPaths: ['Fisica_1', 'Fisica_1/Optica', 'Ciencias'],
      }
    );
    expect(moved.ok).toBe(true);
    expect(moved.newPath).toBe('Ciencias/Fisica_1');
    expect(moved.currentNotebookPath).toBe('Ciencias/Fisica_1/Optica/Luz.ipynb');
    expect(moved.activeDirPath).toBe('Ciencias/Fisica_1');

    syncEngine.destroy();
  });

  it('moves notebooks between folders and prevents path collisions', async () => {
    const { storage, notebooks, folders } = createFolderAwareMemoryStorage();
    notebooks.set('Clase1.ipynb', makeNotebookRecord('Clase1.ipynb', { cloudSha: 'sha-1' }));
    notebooks.set('Algebra/Clase1.ipynb', makeNotebookRecord('Algebra/Clase1.ipynb'));

    const gateway = {
      listDirectory: vi.fn(async () => []),
      createDirectory: vi.fn(async (p: string) => ({ path: p, lastModified: '' })),
      renameNotebook: vi.fn(async (_o: string, n: string) => ({ path: n, lastModified: '' })),
      saveNotebook: vi.fn(async () => ({ lastModified: '2026-11-18T12:00:00Z' })),
    } as unknown as IJupyterGateway;
    const cloud: ICloudSyncProvider = {
      configure: vi.fn(),
      isConfigured: () => true,
      testConnection: vi.fn(async () => ({ ok: true })),
      getRemoteVersion: vi.fn(async () => null),
      pull: vi.fn(),
      push: vi.fn(async (p) => ({ sha: 'sha-new', path: p })),
      deleteFile: vi.fn(async () => undefined),
      list: vi.fn(async () => []),
    };
    const syncEngine = new SyncEngine(storage, gateway, cloud);

    const collision = await moveNotebookOp(
      { storage, gateway, cloudProvider: cloud, syncEngine },
      {
        oldPath: 'Clase1.ipynb',
        targetDir: 'Algebra',
        currentNotebookPath: 'Clase1.ipynb',
        existingPaths: ['Clase1.ipynb', 'Algebra/Clase1.ipynb'],
      }
    );
    expect(collision.ok).toBe(false);

    const moved = await moveNotebookOp(
      { storage, gateway, cloudProvider: cloud, syncEngine },
      {
        oldPath: 'Clase1.ipynb',
        targetDir: 'Geometria',
        currentNotebookPath: 'Clase1.ipynb',
        existingPaths: ['Clase1.ipynb', 'Algebra/Clase1.ipynb'],
      }
    );
    expect(moved.ok).toBe(true);
    expect(moved.newPath).toBe('Geometria/Clase1.ipynb');
    expect(moved.currentNotebookPath).toBe('Geometria/Clase1.ipynb');
    expect(folders.has('Geometria')).toBe(true);
    expect(notebooks.has('Clase1.ipynb')).toBe(false);
    expect(notebooks.has('Geometria/Clase1.ipynb')).toBe(true);
    expect(cloud.deleteFile).toHaveBeenCalledWith(
      'Clase1.ipynb',
      'sha-1',
      expect.any(String)
    );

    syncEngine.destroy();
  });

  it('deletes folders cleanly for both local_only and everywhere scopes', async () => {
    const { storage, notebooks, folders } = createFolderAwareMemoryStorage();
    folders.set('Borrar', { path: 'Borrar', createdAt: 1 });
    notebooks.set('Borrar/N1.ipynb', makeNotebookRecord('Borrar/N1.ipynb'));
    notebooks.set('Conservar.ipynb', makeNotebookRecord('Conservar.ipynb'));

    const gateway = {
      deleteDirectory: vi.fn(async () => undefined),
    } as unknown as IJupyterGateway;
    const cloud: ICloudSyncProvider = {
      configure: vi.fn(),
      isConfigured: () => true,
      testConnection: vi.fn(async () => ({ ok: true })),
      getRemoteVersion: vi.fn(async () => null),
      pull: vi.fn(),
      push: vi.fn(),
      list: vi.fn(async () => []),
      deleteDirectory: vi.fn(async () => undefined),
    };
    const syncEngine = new SyncEngine(storage, gateway, cloud);

    const localOnlyRes = await deleteFolderOp(
      { storage, gateway, cloudProvider: cloud, syncEngine },
      {
        dirPath: 'Borrar',
        scope: 'local_only',
        currentNotebookPath: 'Borrar/N1.ipynb',
        activeDirPath: 'Borrar',
      }
    );
    expect(localOnlyRes.ok).toBe(true);
    expect(localOnlyRes.currentNotebookPath).toBe('Conservar.ipynb');
    expect(localOnlyRes.activeDirPath).toBe('');
    expect(folders.has('Borrar')).toBe(false);
    expect(notebooks.has('Borrar/N1.ipynb')).toBe(false);
    expect(gateway.deleteDirectory).not.toHaveBeenCalled();

    // Everywhere delete
    folders.set('Remoto', { path: 'Remoto', createdAt: 2 });
    notebooks.set('Remoto/N2.ipynb', makeNotebookRecord('Remoto/N2.ipynb'));
    const everywhereRes = await deleteFolderOp(
      { storage, gateway, cloudProvider: cloud, syncEngine },
      {
        dirPath: 'Remoto',
        scope: 'everywhere',
        currentNotebookPath: 'Conservar.ipynb',
        activeDirPath: 'Remoto',
      }
    );
    expect(everywhereRes.ok).toBe(true);
    expect(everywhereRes.activeDirPath).toBe('');
    expect(gateway.deleteDirectory).toHaveBeenCalledWith('Remoto');
    expect(cloud.deleteDirectory).toHaveBeenCalledWith('Remoto');

    syncEngine.destroy();
  });
});

describe('JupyterHttpWebSocketGateway folder support', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates missing parent directories when saving a notebook returns 404', async () => {
    const fetchMock = vi
      .fn()
      // 1st PUT fails with 404 (missing parent directory)
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ message: 'No such directory' }),
      })
      // createDirectory checks GET /api/contents/Nueva?content=0 -> 404
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ message: 'Not found' }),
      })
      // createDirectory PUT /api/contents/Nueva { type: 'directory' }
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ path: 'Nueva', last_modified: '2026-11-18T12:00:00Z' }),
      })
      // retry PUT notebook
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ path: 'Nueva/Apunte.ipynb', last_modified: '2026-11-18T12:00:01Z' }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const gw = new JupyterHttpWebSocketGateway('http://localhost:8888', 'tok');
    const res = await gw.saveNotebook('Nueva/Apunte.ipynb', {
      nbformat: 4,
      nbformat_minor: 5,
      metadata: {},
      cells: [createMarkdownCell('# Hola')],
    });

    expect(res.lastModified).toBe('2026-11-18T12:00:01Z');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('falls back to recursive delete when directory DELETE returns 400', async () => {
    const fetchMock = vi
      .fn()
      // Direct DELETE fails with 400 non-empty
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ message: 'Directory not empty' }),
      })
      // listDirectory returns one notebook
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          type: 'directory',
          content: [{ name: 'A.ipynb', path: 'Carpeta/A.ipynb', type: 'notebook' }],
        }),
      })
      // DELETE child notebook
      .mockResolvedValueOnce({ ok: true, status: 204, json: async () => ({}) })
      // DELETE empty directory
      .mockResolvedValueOnce({ ok: true, status: 204, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    const gw = new JupyterHttpWebSocketGateway('http://localhost:8888', 'tok');
    await gw.deleteDirectory('Carpeta');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

describe('GitHubContentsProvider folder support', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates .gitkeep on ensureDirectory and recursively deletes on deleteDirectory', async () => {
    const fetchMock = vi
      .fn()
      // ensureDirectory -> listRaw('Mat') -> 404
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ message: 'Not Found' }),
      })
      // PUT Mat/.gitkeep
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ content: { path: 'Mat/.gitkeep', sha: 'sha-keep' } }),
      })
      // deleteDirectory('Mat') -> listRaw('Mat')
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          { name: '.gitkeep', path: 'Mat/.gitkeep', sha: 'sha-keep', type: 'file' },
          { name: 'Tema.ipynb', path: 'Mat/Tema.ipynb', sha: 'sha-tema', type: 'file' },
        ],
      })
      // DELETE .gitkeep
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
      // DELETE Tema.ipynb
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new GitHubContentsProvider({
      enabled: true,
      provider: 'github',
      owner: 'user',
      repo: 'notes',
      branch: 'main',
      basePath: '',
      token: 'pat_123',
    });

    await provider.ensureDirectory('Mat');
    expect(fetchMock.mock.calls[1]?.[0]).toContain('/contents/Mat/.gitkeep');
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('PUT');

    await provider.deleteDirectory('Mat');
    expect(fetchMock.mock.calls[3]?.[1]?.method).toBe('DELETE');
    expect(fetchMock.mock.calls[4]?.[1]?.method).toBe('DELETE');
  });

  it('renames a folder recursively in GitHub Contents API', async () => {
    const encodedContent = utf8ToBase64('{"nbformat":4}');
    const fetchMock = vi
      .fn()
      // listRaw('Vieja')
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          { name: 'Nota.ipynb', path: 'Vieja/Nota.ipynb', sha: 'sha-old', type: 'file' },
        ],
      })
      // GET Vieja/Nota.ipynb
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          name: 'Nota.ipynb',
          path: 'Vieja/Nota.ipynb',
          sha: 'sha-old',
          type: 'file',
          content: encodedContent,
        }),
      })
      // getRemoteVersion('Nueva/Nota.ipynb') -> 404
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ message: 'Not Found' }),
      })
      // PUT Nueva/Nota.ipynb
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ content: { path: 'Nueva/Nota.ipynb', sha: 'sha-new' } }),
      })
      // DELETE Vieja/Nota.ipynb
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new GitHubContentsProvider({
      enabled: true,
      provider: 'github',
      owner: 'user',
      repo: 'notes',
      branch: 'main',
      basePath: '',
      token: 'pat_123',
    });

    const moved = await provider.renameDirectory('Vieja', 'Nueva');
    expect(moved).toEqual([
      { oldPath: 'Vieja/Nota.ipynb', newPath: 'Nueva/Nota.ipynb', newSha: 'sha-new' },
    ]);
  });
});
