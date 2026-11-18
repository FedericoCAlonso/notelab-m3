import { DEFAULT_NOTEBOOK_PATH, createStarterNotebook } from '../../data/welcomeNotebook';
import { ICloudSyncProvider } from '../cloud/CloudSyncProvider';
import { IJupyterGateway } from '../jupyter/JupyterGateway';
import { SyncEngine } from '../sync/SyncEngine';
import { INotebookStorage, StoredNotebookRecord } from './NotebookDB';
import {
  collectAncestorFolders,
  getBaseName,
  getParentDir,
  isDescendantOrSelf,
  normalizeNotebookPath,
  remapPathPrefix,
  validateFolderName,
} from './unifiedFiles';

export interface FolderOperationsDeps {
  storage: INotebookStorage;
  gateway: IJupyterGateway;
  cloudProvider: ICloudSyncProvider;
  syncEngine: SyncEngine;
}

export interface CreateFolderResult {
  ok: boolean;
  path?: string;
  error?: string;
}

export interface MoveOrRenameFolderResult {
  ok: boolean;
  changed?: boolean;
  oldPath?: string;
  newPath?: string;
  currentNotebookPath: string;
  activeDirPath: string;
  error?: string;
}

export interface MoveNotebookResult {
  ok: boolean;
  changed?: boolean;
  oldPath?: string;
  newPath?: string;
  currentNotebookPath: string;
  error?: string;
}

export interface DeleteFolderResult {
  ok: boolean;
  dirPath: string;
  currentNotebookPath: string;
  activeDirPath: string;
  switchedNotebook?: StoredNotebookRecord;
  error?: string;
}

function hasCaseInsensitiveMatch(target: string, candidates: Iterable<string>): boolean {
  const lower = normalizeNotebookPath(target).toLowerCase();
  for (const item of candidates) {
    if (normalizeNotebookPath(item).toLowerCase() === lower) {
      return true;
    }
  }
  return false;
}

async function persistLocalFolderWithAncestors(
  storage: INotebookStorage,
  dirPath: string
): Promise<void> {
  if (!storage.putFolder) return;
  const now = Date.now();
  for (const anc of collectAncestorFolders(dirPath)) {
    await storage.putFolder({ path: anc, createdAt: now });
  }
}

async function checkRemoteFolderCollision(
  deps: FolderOperationsDeps,
  targetDirPath: string
): Promise<boolean> {
  const parent = getParentDir(targetDirPath);
  const targetLower = normalizeNotebookPath(targetDirPath).toLowerCase();

  try {
    const items = await deps.gateway.listDirectory(parent);
    if (
      items.some(
        (item) =>
          item.type === 'directory' &&
          normalizeNotebookPath(item.path).toLowerCase() === targetLower
      )
    ) {
      return true;
    }
  } catch {
    // Offline or unreachable
  }

  if (deps.cloudProvider.isConfigured()) {
    try {
      const cloudItems = await deps.cloudProvider.list(parent);
      if (
        cloudItems.some(
          (item) =>
            item.type === 'dir' &&
            normalizeNotebookPath(item.path).toLowerCase() === targetLower
        )
      ) {
        return true;
      }
    } catch {
      // Offline or unreachable
    }
  }

  return false;
}

async function checkRemoteNotebookCollision(
  deps: FolderOperationsDeps,
  targetPath: string
): Promise<boolean> {
  const parent = getParentDir(targetPath);
  const targetLower = normalizeNotebookPath(targetPath).toLowerCase();

  try {
    const items = await deps.gateway.listDirectory(parent);
    if (
      items.some(
        (item) =>
          item.type === 'notebook' &&
          normalizeNotebookPath(item.path).toLowerCase() === targetLower
      )
    ) {
      return true;
    }
  } catch {
    // Offline or unreachable
  }

  if (deps.cloudProvider.isConfigured()) {
    try {
      const cloudItems = await deps.cloudProvider.list(parent);
      if (
        cloudItems.some(
          (item) =>
            item.type === 'file' &&
            normalizeNotebookPath(item.path).toLowerCase() === targetLower
        )
      ) {
        return true;
      }
    } catch {
      // Offline or unreachable
    }
  }

  return false;
}

export async function createFolderOp(
  deps: FolderOperationsDeps,
  options: {
    parentDir: string;
    name: string;
    existingDirPaths: Iterable<string>;
  }
): Promise<CreateFolderResult> {
  const validation = validateFolderName(options.name);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  const cleanParent = normalizeNotebookPath(options.parentDir);
  const targetPath = cleanParent
    ? `${cleanParent}/${validation.name}`
    : validation.name;

  if (
    hasCaseInsensitiveMatch(targetPath, options.existingDirPaths) ||
    (await checkRemoteFolderCollision(deps, targetPath))
  ) {
    return { ok: false, error: `Ya existe la carpeta "${validation.name}"` };
  }

  await persistLocalFolderWithAncestors(deps.storage, targetPath);

  try {
    await deps.gateway.createDirectory?.(targetPath);
  } catch {
    // Local-first: directory persists locally even if Jupyter is offline
  }

  if (deps.cloudProvider.isConfigured()) {
    try {
      await deps.cloudProvider.ensureDirectory?.(targetPath);
    } catch {
      // Non-fatal if GitHub is offline
    }
  }

  return { ok: true, path: targetPath };
}

export async function renameFolderOp(
  deps: FolderOperationsDeps,
  options: {
    oldPath: string;
    newName: string;
    currentNotebookPath: string;
    activeDirPath: string;
    existingDirPaths: Iterable<string>;
  }
): Promise<MoveOrRenameFolderResult> {
  const validation = validateFolderName(options.newName);
  if (!validation.ok) {
    return {
      ok: false,
      error: validation.error,
      currentNotebookPath: options.currentNotebookPath,
      activeDirPath: options.activeDirPath,
    };
  }

  const cleanOld = normalizeNotebookPath(options.oldPath);
  const parent = getParentDir(cleanOld);
  const newPath = parent ? `${parent}/${validation.name}` : validation.name;

  return moveOrRenameFolderPath(deps, {
    oldPath: cleanOld,
    newPath,
    currentNotebookPath: options.currentNotebookPath,
    activeDirPath: options.activeDirPath,
    existingDirPaths: options.existingDirPaths,
  });
}

export async function moveFolderOp(
  deps: FolderOperationsDeps,
  options: {
    oldPath: string;
    targetParentDir: string;
    currentNotebookPath: string;
    activeDirPath: string;
    existingDirPaths: Iterable<string>;
  }
): Promise<MoveOrRenameFolderResult> {
  const cleanOld = normalizeNotebookPath(options.oldPath);
  const cleanTargetParent = normalizeNotebookPath(options.targetParentDir);

  if (isDescendantOrSelf(cleanTargetParent, cleanOld)) {
    return {
      ok: false,
      error: 'No se puede mover una carpeta dentro de sí misma',
      currentNotebookPath: options.currentNotebookPath,
      activeDirPath: options.activeDirPath,
    };
  }

  const baseName = getBaseName(cleanOld);
  const newPath = cleanTargetParent ? `${cleanTargetParent}/${baseName}` : baseName;

  return moveOrRenameFolderPath(deps, {
    oldPath: cleanOld,
    newPath,
    currentNotebookPath: options.currentNotebookPath,
    activeDirPath: options.activeDirPath,
    existingDirPaths: options.existingDirPaths,
  });
}

async function moveOrRenameFolderPath(
  deps: FolderOperationsDeps,
  options: {
    oldPath: string;
    newPath: string;
    currentNotebookPath: string;
    activeDirPath: string;
    existingDirPaths: Iterable<string>;
  }
): Promise<MoveOrRenameFolderResult> {
  const cleanOld = normalizeNotebookPath(options.oldPath);
  const cleanNew = normalizeNotebookPath(options.newPath);

  if (!cleanOld || !cleanNew) {
    return {
      ok: false,
      error: 'Ruta de carpeta inválida',
      currentNotebookPath: options.currentNotebookPath,
      activeDirPath: options.activeDirPath,
    };
  }

  if (cleanOld === cleanNew) {
    return {
      ok: true,
      changed: false,
      oldPath: cleanOld,
      newPath: cleanNew,
      currentNotebookPath: options.currentNotebookPath,
      activeDirPath: options.activeDirPath,
    };
  }

  if (isDescendantOrSelf(cleanNew, cleanOld)) {
    return {
      ok: false,
      error: 'No se puede mover una carpeta dentro de una subcarpeta propia',
      currentNotebookPath: options.currentNotebookPath,
      activeDirPath: options.activeDirPath,
    };
  }

  const otherExistingDirs = Array.from(options.existingDirPaths).filter(
    (d) => normalizeNotebookPath(d).toLowerCase() !== cleanOld.toLowerCase()
  );

  if (
    hasCaseInsensitiveMatch(cleanNew, otherExistingDirs) ||
    (cleanNew.toLowerCase() !== cleanOld.toLowerCase() &&
      (await checkRemoteFolderCollision(deps, cleanNew)))
  ) {
    return {
      ok: false,
      error: `Ya existe una carpeta en "${cleanNew}"`,
      currentNotebookPath: options.currentNotebookPath,
      activeDirPath: options.activeDirPath,
    };
  }

  // 1. Remap local folder records
  if (deps.storage.listFolders && deps.storage.deleteFolder && deps.storage.putFolder) {
    const folders = await deps.storage.listFolders();
    for (const f of folders) {
      const remapped = remapPathPrefix(f.path, cleanOld, cleanNew);
      if (remapped) {
        await deps.storage.deleteFolder(f.path);
        await deps.storage.putFolder({ path: remapped, createdAt: f.createdAt });
      }
    }
  }
  await persistLocalFolderWithAncestors(deps.storage, cleanNew);

  // 2. Remap local notebooks inside the folder
  const allNotebooks = await deps.storage.listAllNotebooks();
  const movedNotebooks: Array<{
    oldNbPath: string;
    newNbPath: string;
    previous: StoredNotebookRecord;
  }> = [];

  for (const rec of allNotebooks) {
    const remapped = remapPathPrefix(rec.path, cleanOld, cleanNew);
    if (!remapped) continue;

    movedNotebooks.push({
      oldNbPath: rec.path,
      newNbPath: remapped,
      previous: rec,
    });

    await deps.storage.deleteNotebook(rec.path);
    await deps.storage.deleteOutboxItem(rec.path, 'jupyter');
    await deps.storage.deleteOutboxItem(rec.path, 'cloud');
    await deps.storage.putNotebook({
      ...rec,
      path: remapped,
      updatedAt: Date.now(),
      pendingSync: true,
      pendingCloudSync: deps.cloudProvider.isConfigured(),
    });
  }

  // 3. Rename/Move on Jupyter Server
  let jupyterRenamed = false;
  try {
    const targetParent = getParentDir(cleanNew);
    if (targetParent) {
      await deps.gateway.createDirectory?.(targetParent);
    }
    if (deps.gateway.renameItem) {
      await deps.gateway.renameItem(cleanOld, cleanNew);
    } else {
      await deps.gateway.renameNotebook(cleanOld, cleanNew);
    }
    jupyterRenamed = true;
  } catch {
    // Offline or folder did not exist on Jupyter yet
  }

  if (jupyterRenamed) {
    for (const item of movedNotebooks) {
      if (!item.previous.isLocalOnly && !item.previous.pendingSync) {
        const currentRec = await deps.storage.getNotebook(item.newNbPath);
        if (currentRec) {
          await deps.storage.putNotebook({
            ...currentRec,
            pendingSync: false,
            syncedAt: Date.now(),
          });
        }
      }
    }
  }

  // 4. Rename/Move on GitHub Cloud
  const cloudConfigured = deps.cloudProvider.isConfigured();
  const cloudMovedMap = new Map<string, string>();
  if (cloudConfigured && deps.cloudProvider.renameDirectory) {
    try {
      const movedFiles = await deps.cloudProvider.renameDirectory(cleanOld, cleanNew);
      for (const mf of movedFiles) {
        cloudMovedMap.set(normalizeNotebookPath(mf.newPath), mf.newSha);
      }
    } catch {
      // Offline or failed: outbox/forceSync below will push remaining notebooks
    }
  }

  for (const item of movedNotebooks) {
    const currentRec = await deps.storage.getNotebook(item.newNbPath);
    if (!currentRec) continue;

    const newCloudSha = cloudMovedMap.get(normalizeNotebookPath(item.newNbPath));
    if (newCloudSha) {
      await deps.storage.putNotebook({
        ...currentRec,
        cloudSha: newCloudSha,
        cloudSyncedAt: Date.now(),
        pendingCloudSync: false,
      });
    } else if (currentRec.pendingSync || currentRec.pendingCloudSync) {
      void deps.syncEngine.forceSync(item.newNbPath, currentRec.notebook);
    }
  }

  const nextCurrentNotebookPath =
    remapPathPrefix(options.currentNotebookPath, cleanOld, cleanNew) ??
    options.currentNotebookPath;
  const nextActiveDirPath =
    remapPathPrefix(options.activeDirPath, cleanOld, cleanNew) ??
    options.activeDirPath;

  return {
    ok: true,
    changed: true,
    oldPath: cleanOld,
    newPath: cleanNew,
    currentNotebookPath: nextCurrentNotebookPath,
    activeDirPath: nextActiveDirPath,
  };
}

export async function moveNotebookOp(
  deps: FolderOperationsDeps,
  options: {
    oldPath: string;
    targetDir: string;
    currentNotebookPath: string;
    existingPaths: Iterable<string>;
  }
): Promise<MoveNotebookResult> {
  const cleanOld = normalizeNotebookPath(options.oldPath);
  const cleanTargetDir = normalizeNotebookPath(options.targetDir);
  const fileName = getBaseName(cleanOld);
  const newPath = cleanTargetDir ? `${cleanTargetDir}/${fileName}` : fileName;

  if (newPath === cleanOld) {
    return {
      ok: true,
      changed: false,
      oldPath: cleanOld,
      newPath,
      currentNotebookPath: options.currentNotebookPath,
    };
  }

  if (
    hasCaseInsensitiveMatch(newPath, options.existingPaths) ||
    (await checkRemoteNotebookCollision(deps, newPath))
  ) {
    return {
      ok: false,
      error: `Ya existe un apunte llamado ${newPath}`,
      currentNotebookPath: options.currentNotebookPath,
    };
  }

  let existing = await deps.storage.getNotebook(cleanOld);
  if (!existing) {
    try {
      await deps.syncEngine.loadNotebook(cleanOld);
      existing = await deps.storage.getNotebook(cleanOld);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'No se pudo leer el apunte para moverlo',
        currentNotebookPath: options.currentNotebookPath,
      };
    }
  }

  if (!existing) {
    return {
      ok: false,
      error: 'No se encontró el apunte origen',
      currentNotebookPath: options.currentNotebookPath,
    };
  }

  if (cleanTargetDir) {
    await persistLocalFolderWithAncestors(deps.storage, cleanTargetDir);
  }

  await deps.storage.deleteNotebook(cleanOld);
  await deps.storage.deleteOutboxItem(cleanOld, 'jupyter');
  await deps.storage.deleteOutboxItem(cleanOld, 'cloud');
  await deps.storage.putNotebook({
    path: newPath,
    notebook: existing.notebook,
    draftNotebook: existing.draftNotebook ?? null,
    draftUpdatedAt: existing.draftUpdatedAt ?? null,
    updatedAt: Date.now(),
    syncedAt: existing.syncedAt,
    pendingSync: true,
    isLocalOnly: existing.isLocalOnly,
    serverLastModified: existing.serverLastModified,
    cloudSha: null,
    cloudSyncedAt: null,
    pendingCloudSync: deps.cloudProvider.isConfigured(),
  });

  try {
    if (cleanTargetDir) {
      await deps.gateway.createDirectory?.(cleanTargetDir);
    }
    if (!existing.isLocalOnly) {
      await deps.gateway.renameNotebook(cleanOld, newPath);
    }
  } catch {
    // Outbox sync will push to newPath
  }

  if (deps.cloudProvider.isConfigured() && deps.cloudProvider.deleteFile) {
    try {
      await deps.cloudProvider.deleteFile(
        cleanOld,
        existing.cloudSha ?? null,
        `NoteLab M3: mover ${cleanOld} -> ${newPath}`
      );
    } catch {
      // Non-fatal
    }
  }

  void deps.syncEngine.forceSync(newPath, existing.notebook);

  return {
    ok: true,
    changed: true,
    oldPath: cleanOld,
    newPath,
    currentNotebookPath:
      normalizeNotebookPath(options.currentNotebookPath) === cleanOld
        ? newPath
        : options.currentNotebookPath,
  };
}

export async function deleteFolderOp(
  deps: FolderOperationsDeps,
  options: {
    dirPath: string;
    scope: 'everywhere' | 'local_only';
    currentNotebookPath: string;
    activeDirPath: string;
  }
): Promise<DeleteFolderResult> {
  const cleanDir = normalizeNotebookPath(options.dirPath);
  const allLocalNotebooks = await deps.storage.listAllNotebooks();
  const insideNotebooks = allLocalNotebooks.filter((rec) =>
    isDescendantOrSelf(rec.path, cleanDir)
  );
  const outsideNotebooks = allLocalNotebooks.filter(
    (rec) => !isDescendantOrSelf(rec.path, cleanDir)
  );

  const currentAffected = isDescendantOrSelf(options.currentNotebookPath, cleanDir);

  if (options.scope === 'local_only' && currentAffected && outsideNotebooks.length === 0) {
    return {
      ok: false,
      dirPath: cleanDir,
      currentNotebookPath: options.currentNotebookPath,
      activeDirPath: options.activeDirPath,
      error: 'Abre o conserva otro apunte fuera de esta carpeta antes de quitar la copia local',
    };
  }

  if (deps.storage.listFolders && deps.storage.deleteFolder) {
    const folders = await deps.storage.listFolders();
    for (const f of folders) {
      if (isDescendantOrSelf(f.path, cleanDir)) {
        await deps.storage.deleteFolder(f.path);
      }
    }
  }

  for (const rec of insideNotebooks) {
    await deps.storage.deleteNotebook(rec.path);
    await deps.storage.deleteOutboxItem(rec.path, 'jupyter');
    await deps.storage.deleteOutboxItem(rec.path, 'cloud');
  }

  if (options.scope === 'everywhere') {
    try {
      if (deps.gateway.deleteDirectory) {
        await deps.gateway.deleteDirectory(cleanDir);
      } else {
        await deps.gateway.deleteItem(cleanDir);
      }
    } catch {
      // Ignore if absent on Jupyter or offline
    }

    if (deps.cloudProvider.isConfigured() && deps.cloudProvider.deleteDirectory) {
      try {
        await deps.cloudProvider.deleteDirectory(cleanDir);
      } catch {
        // Ignore if absent on GitHub or offline
      }
    }
  }

  let remaining = await deps.storage.listAllNotebooks();
  if (remaining.length === 0) {
    const starter = createStarterNotebook();
    const starterRecord: StoredNotebookRecord = {
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
    };
    await deps.storage.putNotebook(starterRecord);
    remaining = [starterRecord];
  }

  const switchedNotebook = currentAffected ? remaining[0] : undefined;
  const nextCurrentNotebookPath = switchedNotebook
    ? switchedNotebook.path
    : options.currentNotebookPath;
  const nextActiveDirPath = isDescendantOrSelf(options.activeDirPath, cleanDir)
    ? getParentDir(cleanDir)
    : options.activeDirPath;

  return {
    ok: true,
    dirPath: cleanDir,
    currentNotebookPath: nextCurrentNotebookPath,
    activeDirPath: nextActiveDirPath,
    switchedNotebook,
  };
}
