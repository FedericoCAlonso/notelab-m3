import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildUnifiedFileList,
  generateUniqueNotebookPath,
  makeDuplicateNotebookPath,
} from '../services/storage/unifiedFiles';
import { StoredNotebookRecord } from '../services/storage/NotebookDB';
import { JupyterContentItem, createMarkdownCell } from '../types/nbformat';
import { CloudRemoteItem } from '../services/cloud/CloudSyncProvider';
import { GitHubContentsProvider } from '../services/cloud/GitHubContentsProvider';

function makeLocalRecord(
  path: string,
  overrides: Partial<StoredNotebookRecord> = {}
): StoredNotebookRecord {
  return {
    path,
    notebook: {
      nbformat: 4,
      nbformat_minor: 5,
      metadata: {},
      cells: [createMarkdownCell('# Note')],
    },
    updatedAt: 1000,
    syncedAt: 900,
    pendingSync: false,
    isLocalOnly: false,
    serverLastModified: '2026-11-18T10:00:00Z',
    ...overrides,
  };
}

describe('unifiedFiles (single list & deduplication)', () => {
  it('merges local, Jupyter and GitHub entries into one record per normalized path', () => {
    const local: StoredNotebookRecord[] = [
      makeLocalRecord('Algebra.ipynb', {
        pendingSync: true,
        cloudSha: 'sha-alg',
        cloudSyncedAt: 950,
        pendingCloudSync: false,
      }),
      makeLocalRecord('Fisica/Tema1.ipynb', {
        isLocalOnly: true,
        syncedAt: null,
        pendingSync: true,
      }),
    ];

    const remote: JupyterContentItem[] = [
      {
        name: 'Algebra.ipynb',
        path: 'Algebra.ipynb',
        type: 'notebook',
        writable: true,
        created: '',
        last_modified: '',
      },
      {
        name: 'Fisica',
        path: 'Fisica',
        type: 'directory',
        writable: true,
        created: '',
        last_modified: '',
      },
    ];

    const cloud: CloudRemoteItem[] = [
      {
        name: 'Algebra.ipynb',
        path: 'Algebra.ipynb',
        type: 'file',
        sha: 'sha-alg',
      },
      {
        name: 'SoloNube.ipynb',
        path: 'SoloNube.ipynb',
        type: 'file',
        sha: 'sha-cloud',
      },
    ];

    const res = buildUnifiedFileList({
      currentDir: '',
      filter: 'folder',
      localNotebooks: local,
      remoteItems: remote,
      cloudItems: cloud,
      cloudEnabled: true,
    });

    expect(res.directories).toEqual([
      {
        kind: 'dir',
        path: 'Fisica',
        name: 'Fisica',
        inJupyter: true,
        inCloud: false,
      },
    ]);

    expect(res.notebooks.map((n) => n.path)).toEqual([
      'Algebra.ipynb',
      'SoloNube.ipynb',
    ]);

    const algebra = res.notebooks[0]!;
    expect(algebra.inLocal).toBe(true);
    expect(algebra.inJupyter).toBe(true);
    expect(algebra.inCloud).toBe(true);
    expect(algebra.pendingJupyter).toBe(true);
    expect(algebra.pendingCloud).toBe(false);
    expect(algebra.preferredLoadSource).toBe('auto');

    const soloNube = res.notebooks[1]!;
    expect(soloNube.inLocal).toBe(false);
    expect(soloNube.inCloud).toBe(true);
    expect(soloNube.preferredLoadSource).toBe('cloud');

    // Pending filter surfaces subfolder pending notes too
    const pendingRes = buildUnifiedFileList({
      currentDir: '',
      filter: 'pending',
      localNotebooks: local,
      remoteItems: remote,
      cloudItems: cloud,
      cloudEnabled: true,
    });
    expect(pendingRes.notebooks.map((n) => n.path).sort()).toEqual([
      'Algebra.ipynb',
      'Fisica/Tema1.ipynb',
    ]);
  });

  it('generates unique paths without collisions when importing or duplicating', () => {
    const existing = [
      'Clase.ipynb',
      'Clase_2.ipynb',
      'Clase_copia.ipynb',
      'mat/Guia.ipynb',
    ];

    expect(generateUniqueNotebookPath('Clase.ipynb', existing)).toBe('Clase_3.ipynb');
    expect(generateUniqueNotebookPath('Nueva.ipynb', existing)).toBe('Nueva.ipynb');
    expect(makeDuplicateNotebookPath('Clase.ipynb', existing)).toBe('Clase_copia_2.ipynb');
    expect(makeDuplicateNotebookPath('mat/Guia.ipynb', existing)).toBe('mat/Guia_copia.ipynb');
  });
});

describe('GitHubContentsProvider.deleteFile', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deletes an existing file using its SHA and ignores 404 cleanly', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ commit: { sha: 'c1' } }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ message: 'Not Found' }),
      });
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

    await provider.deleteFile('viejo.ipynb', 'sha-old');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('DELETE');

    // Missing file on GitHub should not throw
    await expect(provider.deleteFile('noexiste.ipynb')).resolves.toBeUndefined();
  });
});
