import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  CloudSyncError,
  ICloudSyncProvider,
} from '../services/cloud/CloudSyncProvider';
import {
  GitHubContentsProvider,
  base64ToUtf8,
  parseGitHubRepoInput,
  utf8ToBase64,
} from '../services/cloud/GitHubContentsProvider';
import {
  IJupyterGateway,
  JupyterGatewayError,
} from '../services/jupyter/JupyterGateway';
import {
  DEFAULT_CONNECTION_SETTINGS,
  INotebookStorage,
  OutboxItem,
  StoredNotebookRecord,
  makeOutboxId,
} from '../services/storage/NotebookDB';
import { SyncEngine, SyncStatusEvent } from '../services/sync/SyncEngine';
import { createCodeCell, createMarkdownCell } from '../types/nbformat';

function createTargetedMemoryStorage(): INotebookStorage {
  const notebooks = new Map<string, StoredNotebookRecord>();
  const outbox = new Map<string, OutboxItem>();
  let settings = DEFAULT_CONNECTION_SETTINGS;

  return {
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
}

describe('GitHubContentsProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses full GitHub URLs and owner/repo shorthand cleanly', () => {
    expect(
      parseGitHubRepoInput('', 'https://github.com/FedericoCAlonso/mis-apuntes.git')
    ).toEqual({ owner: 'FedericoCAlonso', repo: 'mis-apuntes' });

    expect(
      parseGitHubRepoInput('', 'FedericoCAlonso/apuntes-fisica/')
    ).toEqual({ owner: 'FedericoCAlonso', repo: 'apuntes-fisica' });

    expect(
      parseGitHubRepoInput('@FedericoCAlonso', 'notas')
    ).toEqual({ owner: 'FedericoCAlonso', repo: 'notas' });
  });

  it('encodes and decodes UTF-8 strings with accents and math symbols losslessly', () => {
    const sample = '# Álgebra Lineal: $\\sum_{i=1}^n x_i \\to \\mathbb{R}$ — ñandú 🚀';
    const encoded = utf8ToBase64(sample);
    expect(base64ToUtf8(encoded)).toBe(sample);
  });

  it('detects conflict before overwriting an existing file when expectedSha is missing', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        name: 'clase1.ipynb',
        path: 'apuntes/clase1.ipynb',
        sha: 'remote-sha-1',
        type: 'file',
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new GitHubContentsProvider({
      enabled: true,
      provider: 'github',
      owner: 'user',
      repo: 'notes',
      branch: 'main',
      basePath: 'apuntes',
      token: 'pat_123',
    });

    const doc = {
      nbformat: 4 as const,
      nbformat_minor: 5,
      metadata: {},
      cells: [createMarkdownCell('# Hola')],
    };

    await expect(provider.push('clase1.ipynb', doc, null)).rejects.toMatchObject({
      name: 'CloudSyncError',
      isConflict: true,
    });
  });

  it('lists directories and .ipynb files relative to basePath', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [
        { name: 'README.md', path: 'apuntes/README.md', sha: '1', type: 'file' },
        { name: 'clase1.ipynb', path: 'apuntes/clase1.ipynb', sha: '2', type: 'file' },
        { name: 'fisica', path: 'apuntes/fisica', sha: '3', type: 'dir' },
      ],
    }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new GitHubContentsProvider({
      enabled: true,
      provider: 'github',
      owner: 'user',
      repo: 'notes',
      branch: 'main',
      basePath: 'apuntes',
      token: 'pat_123',
    });

    const items = await provider.list('');
    expect(items.map((i) => ({ name: i.name, path: i.path, type: i.type }))).toEqual([
      { name: 'fisica', path: 'fisica', type: 'dir' },
      { name: 'clase1.ipynb', path: 'clase1.ipynb', type: 'file' },
    ]);
  });
});

describe('SyncEngine (Cloud + Conflict Resolution)', () => {
  it('queues and retries cloud sync independently from jupyter outbox', async () => {
    const storage = createTargetedMemoryStorage();
    let cloudFails = true;

    const mockGateway = {
      saveNotebook: vi.fn(async () => {
        throw new JupyterGatewayError('Termux offline', undefined, true);
      }),
    } as unknown as IJupyterGateway;

    const mockCloud: ICloudSyncProvider = {
      configure: vi.fn(),
      isConfigured: () => true,
      testConnection: vi.fn(async () => ({ ok: true })),
      getRemoteVersion: vi.fn(async () => null),
      pull: vi.fn(),
      push: vi.fn(async () => {
        if (cloudFails) {
          throw new CloudSyncError('Network down', { isNetworkError: true });
        }
        return { sha: 'sha-v1', path: 'clase1.ipynb' };
      }),
      list: vi.fn(async () => []),
    };

    const engine = new SyncEngine(storage, mockGateway, mockCloud);
    const doc = {
      nbformat: 4 as const,
      nbformat_minor: 5,
      metadata: {},
      cells: [createMarkdownCell('# Nota')],
    };

    await engine.forceSync('clase1.ipynb', doc);

    const cloudOutbox = await storage.getOutboxItem('clase1.ipynb', 'cloud');
    expect(cloudOutbox?.retryCount).toBe(1);

    cloudFails = false;
    await storage.putOutboxItem({ ...cloudOutbox!, nextRetryAt: Date.now() - 10 });
    await engine.flushOutbox();

    const rec = await storage.getNotebook('clase1.ipynb');
    expect(rec?.cloudSha).toBe('sha-v1');
    expect(rec?.pendingCloudSync).toBe(false);
    // Jupyter item remains queued because Termux is still offline
    expect(await storage.getOutboxItem('clase1.ipynb', 'cloud')).toBeUndefined();
    expect(await storage.getOutboxItem('clase1.ipynb', 'jupyter')).toBeDefined();

    engine.destroy();
  });

  it('emits conflict and supports Keep Local, Use Remote and Save Copy resolutions', async () => {
    const storage = createTargetedMemoryStorage();
    const events: SyncStatusEvent[] = [];

    const remoteDoc = {
      nbformat: 4 as const,
      nbformat_minor: 5,
      metadata: {},
      cells: [createMarkdownCell('# Remoto')],
    };

    const mockGateway = {
      saveNotebook: vi.fn(async () => ({ lastModified: '2026-11-18T12:00:00Z' })),
      getNotebook: vi.fn(async () => ({
        notebook: remoteDoc,
        lastModified: '2026-11-18T12:00:00Z',
      })),
    } as unknown as IJupyterGateway;

    let failConflict = true;
    const mockCloud: ICloudSyncProvider = {
      configure: vi.fn(),
      isConfigured: () => true,
      testConnection: vi.fn(async () => ({ ok: true })),
      getRemoteVersion: vi.fn(async () => ({ sha: 'remote-sha-2' })),
      pull: vi.fn(async () => ({
        notebook: remoteDoc,
        sha: 'remote-sha-2',
        path: 'clase2.ipynb',
      })),
      push: vi.fn(async (path, _nb, expectedSha) => {
        if (failConflict && expectedSha !== 'remote-sha-2') {
          throw new CloudSyncError('SHA mismatch', { status: 409, isConflict: true });
        }
        return { sha: 'remote-sha-3', path };
      }),
      list: vi.fn(async () => []),
    };

    const engine = new SyncEngine(storage, mockGateway, mockCloud);
    engine.subscribe((e) => events.push(e));

    const localDoc = {
      nbformat: 4 as const,
      nbformat_minor: 5,
      metadata: {},
      cells: [createMarkdownCell('# Local'), createCodeCell('x = 2')],
    };

    const res = await engine.forceSync('clase2.ipynb', localDoc);
    expect(res.conflict?.target).toBe('cloud');
    expect(events.some((e) => e.status === 'conflict' && e.target === 'cloud')).toBe(true);
    // Must not keep retrying automatically in outbox on conflict
    expect(await storage.getOutboxItem('clase2.ipynb', 'cloud')).toBeUndefined();

    // Resolution 1: Save copy + load remote
    const copyRes = await engine.resolveConflictSaveCopy('clase2.ipynb', 'cloud');
    expect(copyRes.copyPath).toMatch(/^clase2_copia_\d{8}_\d{6}\.ipynb$/);
    expect(copyRes.remoteNotebook.cells[0]?.source).toBe('# Remoto');
    const savedCopy = await storage.getNotebook(copyRes.copyPath);
    expect(savedCopy?.notebook.cells[0]?.source).toBe('# Local');
    const updatedOriginal = await storage.getNotebook('clase2.ipynb');
    expect(updatedOriginal?.cloudSha).toBe('remote-sha-2');
    expect(updatedOriginal?.pendingCloudSync).toBe(false);

    // Resolution 2: Keep local overwrites with latest remote sha
    failConflict = false;
    await engine.resolveConflictKeepLocal('clase2.ipynb', 'cloud');
    const afterKeep = await storage.getNotebook('clase2.ipynb');
    expect(afterKeep?.cloudSha).toBe('remote-sha-3');

    engine.destroy();
  });

  it('falls back to cloud pull in loadNotebook when Jupyter is offline', async () => {
    const storage = createTargetedMemoryStorage();
    const remoteDoc = {
      nbformat: 4 as const,
      nbformat_minor: 5,
      metadata: {},
      cells: [createMarkdownCell('# Desde GitHub')],
    };

    const mockGateway = {
      getNotebook: vi.fn(async () => {
        throw new JupyterGatewayError('Offline', undefined, true);
      }),
    } as unknown as IJupyterGateway;

    const mockCloud: ICloudSyncProvider = {
      configure: vi.fn(),
      isConfigured: () => true,
      testConnection: vi.fn(async () => ({ ok: true })),
      getRemoteVersion: vi.fn(async () => ({ sha: 'sha-gh' })),
      pull: vi.fn(async () => ({
        notebook: remoteDoc,
        sha: 'sha-gh',
        path: 'remoto.ipynb',
      })),
      push: vi.fn(),
      list: vi.fn(async () => []),
    };

    const engine = new SyncEngine(storage, mockGateway, mockCloud);
    const loaded = await engine.loadNotebook('remoto.ipynb');
    expect(loaded.notebook.cells[0]?.source).toBe('# Desde GitHub');
    expect(loaded.cloudStatus).toBe('synced');
    expect(loaded.fromCache).toBe(false);

    const cached = await storage.getNotebook('remoto.ipynb');
    expect(cached?.cloudSha).toBe('sha-gh');

    engine.destroy();
  });
});
