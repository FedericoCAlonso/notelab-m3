import { JupyterContentItem } from '../../types/nbformat';
import { CloudRemoteItem } from '../cloud/CloudSyncProvider';
import { StoredNotebookRecord } from './NotebookDB';

export type FileListFilter = 'folder' | 'all' | 'pending';

export interface UnifiedDirectoryEntry {
  kind: 'dir';
  path: string;
  name: string;
  inJupyter: boolean;
  inCloud: boolean;
}

export interface UnifiedNotebookEntry {
  kind: 'notebook';
  path: string;
  name: string;
  inLocal: boolean;
  inJupyter: boolean;
  inCloud: boolean;
  pendingJupyter: boolean;
  pendingCloud: boolean;
  isLocalOnly: boolean;
  updatedAt: number | null;
  preferredLoadSource: 'auto' | 'cloud';
}

export interface UnifiedFileListResult {
  directories: UnifiedDirectoryEntry[];
  notebooks: UnifiedNotebookEntry[];
}

export function normalizeNotebookPath(path: string): string {
  return path.replace(/^\/+|\/+$/g, '');
}

export function getParentDir(path: string): string {
  const clean = normalizeNotebookPath(path);
  const idx = clean.lastIndexOf('/');
  return idx >= 0 ? clean.slice(0, idx) : '';
}

export function getBaseName(path: string): string {
  const clean = normalizeNotebookPath(path);
  const idx = clean.lastIndexOf('/');
  return idx >= 0 ? clean.slice(idx + 1) : clean;
}

/**
 * Generates a non-colliding `.ipynb` path against existing paths (case-insensitive check).
 */
export function generateUniqueNotebookPath(
  desiredPath: string,
  existingPaths: Iterable<string>
): string {
  const clean = normalizeNotebookPath(desiredPath);
  const ensuredExt = clean.toLowerCase().endsWith('.ipynb') ? clean : `${clean}.ipynb`;
  const existingLower = new Set<string>();
  for (const p of existingPaths) {
    existingLower.add(normalizeNotebookPath(p).toLowerCase());
  }

  if (!existingLower.has(ensuredExt.toLowerCase())) {
    return ensuredExt;
  }

  const dir = getParentDir(ensuredExt);
  const base = getBaseName(ensuredExt).replace(/\.ipynb$/i, '');
  let counter = 2;
  while (true) {
    const candidateName = `${base}_${counter}.ipynb`;
    const candidatePath = dir ? `${dir}/${candidateName}` : candidateName;
    if (!existingLower.has(candidatePath.toLowerCase())) {
      return candidatePath;
    }
    counter += 1;
  }
}

export function makeDuplicateNotebookPath(
  sourcePath: string,
  existingPaths: Iterable<string>
): string {
  const clean = normalizeNotebookPath(sourcePath);
  const dir = getParentDir(clean);
  const base = getBaseName(clean).replace(/\.ipynb$/i, '');
  const desired = dir ? `${dir}/${base}_copia.ipynb` : `${base}_copia.ipynb`;
  return generateUniqueNotebookPath(desired, existingPaths);
}

export interface BuildUnifiedListOptions {
  currentDir: string;
  filter: FileListFilter;
  localNotebooks: StoredNotebookRecord[];
  remoteItems: JupyterContentItem[];
  cloudItems: CloudRemoteItem[];
  cloudEnabled: boolean;
}

export function buildUnifiedFileList({
  currentDir,
  filter,
  localNotebooks,
  remoteItems,
  cloudItems,
  cloudEnabled,
}: BuildUnifiedListOptions): UnifiedFileListResult {
  const dir = normalizeNotebookPath(currentDir);
  const dirMap = new Map<string, UnifiedDirectoryEntry>();
  const nbMap = new Map<string, UnifiedNotebookEntry>();

  const ensureDir = (
    dirPath: string,
    flags: { inJupyter?: boolean; inCloud?: boolean }
  ) => {
    const clean = normalizeNotebookPath(dirPath);
    if (!clean) return;
    if (getParentDir(clean) !== dir) return;

    const existing = dirMap.get(clean);
    if (existing) {
      if (flags.inJupyter) existing.inJupyter = true;
      if (flags.inCloud) existing.inCloud = true;
      return;
    }

    dirMap.set(clean, {
      kind: 'dir',
      path: clean,
      name: getBaseName(clean),
      inJupyter: Boolean(flags.inJupyter),
      inCloud: Boolean(flags.inCloud),
    });
  };

  const ensureNotebook = (
    rawPath: string,
    patch: Partial<UnifiedNotebookEntry>
  ) => {
    const clean = normalizeNotebookPath(rawPath);
    if (!clean) return;
    if (filter === 'folder' && getParentDir(clean) !== dir) return;

    const existing = nbMap.get(clean);
    if (existing) {
      if (patch.inLocal !== undefined) existing.inLocal = existing.inLocal || patch.inLocal;
      if (patch.inJupyter !== undefined) existing.inJupyter = existing.inJupyter || patch.inJupyter;
      if (patch.inCloud !== undefined) existing.inCloud = existing.inCloud || patch.inCloud;
      if (patch.pendingJupyter !== undefined) {
        existing.pendingJupyter = existing.pendingJupyter || patch.pendingJupyter;
      }
      if (patch.pendingCloud !== undefined) {
        existing.pendingCloud = existing.pendingCloud || patch.pendingCloud;
      }
      if (patch.isLocalOnly !== undefined) {
        existing.isLocalOnly = existing.isLocalOnly && patch.isLocalOnly;
      }
      if (patch.updatedAt !== undefined && patch.updatedAt !== null) {
        existing.updatedAt = Math.max(existing.updatedAt ?? 0, patch.updatedAt);
      }
      existing.preferredLoadSource =
        !existing.inLocal && !existing.inJupyter && existing.inCloud ? 'cloud' : 'auto';
      return;
    }

    const inLocal = Boolean(patch.inLocal);
    const inJupyter = Boolean(patch.inJupyter);
    const inCloud = Boolean(patch.inCloud);

    nbMap.set(clean, {
      kind: 'notebook',
      path: clean,
      name: getBaseName(clean),
      inLocal,
      inJupyter,
      inCloud,
      pendingJupyter: Boolean(patch.pendingJupyter),
      pendingCloud: Boolean(patch.pendingCloud),
      isLocalOnly: patch.isLocalOnly ?? false,
      updatedAt: patch.updatedAt ?? null,
      preferredLoadSource: !inLocal && !inJupyter && inCloud ? 'cloud' : 'auto',
    });
  };

  // 1. Local IndexedDB records
  for (const rec of localNotebooks) {
    const clean = normalizeNotebookPath(rec.path);
    if (filter === 'folder') {
      const prefix = dir ? `${dir}/` : '';
      if (clean.startsWith(prefix)) {
        const rest = clean.slice(prefix.length);
        const slashIdx = rest.indexOf('/');
        if (slashIdx > 0) {
          const subDirName = rest.slice(0, slashIdx);
          ensureDir(dir ? `${dir}/${subDirName}` : subDirName, {});
        }
      }
    }

    ensureNotebook(clean, {
      inLocal: true,
      inJupyter: !rec.isLocalOnly && Boolean(rec.syncedAt),
      inCloud: cloudEnabled && Boolean(rec.cloudSha || rec.cloudSyncedAt),
      pendingJupyter: rec.pendingSync,
      pendingCloud: cloudEnabled && Boolean(rec.pendingCloudSync),
      isLocalOnly: rec.isLocalOnly,
      updatedAt: rec.updatedAt,
    });
  }

  // 2. Jupyter Server directory items
  for (const item of remoteItems) {
    if (item.type === 'directory') {
      if (filter === 'folder') {
        ensureDir(item.path, { inJupyter: true });
      }
    } else if (item.type === 'notebook') {
      ensureNotebook(item.path, {
        inJupyter: true,
        isLocalOnly: false,
      });
    }
  }

  // 3. GitHub Cloud directory items
  if (cloudEnabled) {
    for (const item of cloudItems) {
      if (item.type === 'dir') {
        if (filter === 'folder') {
          ensureDir(item.path, { inCloud: true });
        }
      } else if (item.type === 'file') {
        ensureNotebook(item.path, {
          inCloud: true,
        });
      }
    }
  }

  const directories = Array.from(dirMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  let notebooks = Array.from(nbMap.values());
  if (filter === 'pending') {
    notebooks = notebooks.filter((n) => n.pendingJupyter || n.pendingCloud);
  }

  notebooks.sort((a, b) => {
    if (filter !== 'folder') {
      const diff = (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
      if (diff !== 0) return diff;
    }
    return a.name.localeCompare(b.name);
  });

  return { directories, notebooks };
}
