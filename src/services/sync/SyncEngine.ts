import {
  CloudSyncError,
  ICloudSyncProvider,
} from '../cloud/CloudSyncProvider';
import { IJupyterGateway, JupyterGatewayError } from '../jupyter/JupyterGateway';
import {
  INotebookStorage,
  OutboxItem,
  StoredNotebookRecord,
  makeOutboxId,
} from '../storage/NotebookDB';
import { NotebookDocument, SyncStatus, SyncTarget } from '../../types/nbformat';

export interface SyncConflict {
  path: string;
  target: SyncTarget;
  message: string;
}

export interface SyncStatusEvent {
  path: string;
  target: SyncTarget;
  status: SyncStatus;
  message?: string;
  conflict?: SyncConflict;
}

export interface SyncActionResult {
  ok: boolean;
  offline: boolean;
  error?: string;
  conflict?: SyncConflict;
}

type SyncListener = (event: SyncStatusEvent) => void;

const DEBOUNCE_MS = 800;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;

function makeConflictCopyPath(originalPath: string): string {
  const withoutExt = originalPath.replace(/\.ipynb$/i, '');
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '_',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');
  return `${withoutExt}_copia_${stamp}.ipynb`;
}

export class SyncEngine {
  private readonly storage: INotebookStorage;
  private readonly gateway: IJupyterGateway;
  private cloudProvider: ICloudSyncProvider | null;
  private readonly listeners = new Set<SyncListener>();
  private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private isFlushing = false;
  private destroyed = false;
  private onlineHandler: (() => void) | null = null;
  private visibilityHandler: (() => void) | null = null;

  constructor(
    storage: INotebookStorage,
    gateway: IJupyterGateway,
    cloudProvider: ICloudSyncProvider | null = null
  ) {
    this.storage = storage;
    this.gateway = gateway;
    this.cloudProvider = cloudProvider;
    this.attachBrowserLifecycleListeners();
  }

  setCloudProvider(provider: ICloudSyncProvider | null): void {
    this.cloudProvider = provider;
  }

  private isCloudActive(): boolean {
    return Boolean(this.cloudProvider && this.cloudProvider.isConfigured());
  }

  private attachBrowserLifecycleListeners(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    this.onlineHandler = () => {
      void this.flushOutbox();
    };
    this.visibilityHandler = () => {
      if (document.visibilityState === 'visible') {
        void this.flushOutbox();
      }
    };

    window.addEventListener('online', this.onlineHandler);
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  destroy(): void {
    this.destroyed = true;
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (typeof window !== 'undefined' && this.onlineHandler) {
      window.removeEventListener('online', this.onlineHandler);
    }
    if (typeof document !== 'undefined' && this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
    }
  }

  subscribe(listener: SyncListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: SyncStatusEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  /**
   * Writes edits exclusively to the local working buffer (`draftNotebook`) in IndexedDB
   * without overwriting the saved file (`notebook`) or triggering remote network syncs.
   */
  async saveDraftBuffer(path: string, draft: NotebookDocument): Promise<void> {
    const existing = await this.storage.getNotebook(path);
    const now = Date.now();
    const record: StoredNotebookRecord = existing
      ? {
          ...existing,
          draftNotebook: draft,
          draftUpdatedAt: now,
        }
      : {
          path,
          notebook: draft,
          draftNotebook: draft,
          draftUpdatedAt: now,
          updatedAt: now,
          syncedAt: null,
          pendingSync: false,
          isLocalOnly: true,
          serverLastModified: null,
        };

    await this.storage.putNotebook(record);
  }

  /**
   * Discards the unsaved working buffer (`draftNotebook`) and restores the last saved file.
   */
  async discardDraftBuffer(path: string): Promise<NotebookDocument | null> {
    const prevTimer = this.debounceTimers.get(path);
    if (prevTimer) {
      clearTimeout(prevTimer);
      this.debounceTimers.delete(path);
    }

    const existing = await this.storage.getNotebook(path);
    if (!existing) return null;

    await this.storage.putNotebook({
      ...existing,
      draftNotebook: null,
      draftUpdatedAt: null,
    });
    return existing.notebook;
  }

  /**
   * Commits the working buffer over the saved file (`notebook`) and triggers sync
   * across active remote targets.
   */
  async commitAndSync(path: string, draft: NotebookDocument): Promise<SyncActionResult> {
    const prevTimer = this.debounceTimers.get(path);
    if (prevTimer) {
      clearTimeout(prevTimer);
      this.debounceTimers.delete(path);
    }

    const cloudActive = this.isCloudActive();
    const existing = await this.storage.getNotebook(path);
    await this.storage.putNotebook({
      path,
      notebook: draft,
      draftNotebook: null,
      draftUpdatedAt: null,
      updatedAt: Date.now(),
      syncedAt: existing?.syncedAt ?? null,
      pendingSync: true,
      isLocalOnly: existing?.isLocalOnly ?? true,
      serverLastModified: existing?.serverLastModified ?? null,
      cloudSha: existing?.cloudSha ?? null,
      cloudSyncedAt: existing?.cloudSyncedAt ?? null,
      pendingCloudSync: cloudActive ? true : (existing?.pendingCloudSync ?? false),
    });

    return this.forceSync(path);
  }

  /**
   * Local-first write (legacy helper):
   * 1. Writes immediately to IndexedDB with pendingSync: true (and pendingCloudSync when cloud is active).
   * 2. Schedules debounced (800ms) Outbox enqueue + push to active targets.
   */
  async scheduleSave(path: string, notebook: NotebookDocument): Promise<void> {
    const existing = await this.storage.getNotebook(path);
    const cloudActive = this.isCloudActive();

    const record: StoredNotebookRecord = {
      path,
      notebook,
      updatedAt: Date.now(),
      syncedAt: existing?.syncedAt ?? null,
      pendingSync: true,
      isLocalOnly: existing?.isLocalOnly ?? false,
      serverLastModified: existing?.serverLastModified ?? null,
      cloudSha: existing?.cloudSha ?? null,
      cloudSyncedAt: existing?.cloudSyncedAt ?? null,
      pendingCloudSync: cloudActive ? true : (existing?.pendingCloudSync ?? false),
    };

    await this.storage.putNotebook(record);
    this.emit({ path, target: 'jupyter', status: 'pending' });
    if (cloudActive) {
      this.emit({ path, target: 'cloud', status: 'pending' });
    }

    const prevTimer = this.debounceTimers.get(path);
    if (prevTimer) {
      clearTimeout(prevTimer);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(path);
      void this.enqueueAndFlush(path, existing?.isLocalOnly ? 'create' : 'save');
    }, DEBOUNCE_MS);

    this.debounceTimers.set(path, timer);
  }

  /**
   * Immediate write + immediate sync attempt across Jupyter and (if enabled) Cloud.
   */
  async forceSync(path: string, notebook?: NotebookDocument): Promise<SyncActionResult> {
    const prevTimer = this.debounceTimers.get(path);
    if (prevTimer) {
      clearTimeout(prevTimer);
      this.debounceTimers.delete(path);
    }

    const cloudActive = this.isCloudActive();

    if (notebook) {
      const existing = await this.storage.getNotebook(path);
      await this.storage.putNotebook({
        path,
        notebook,
        draftNotebook: existing?.draftNotebook ?? null,
        draftUpdatedAt: existing?.draftUpdatedAt ?? null,
        updatedAt: Date.now(),
        syncedAt: existing?.syncedAt ?? null,
        pendingSync: true,
        isLocalOnly: existing?.isLocalOnly ?? false,
        serverLastModified: existing?.serverLastModified ?? null,
        cloudSha: existing?.cloudSha ?? null,
        cloudSyncedAt: existing?.cloudSyncedAt ?? null,
        pendingCloudSync: cloudActive ? true : (existing?.pendingCloudSync ?? false),
      });
    }

    await this.putOutboxEntry(path, 'jupyter', 'save', true);
    if (cloudActive) {
      await this.putOutboxEntry(path, 'cloud', 'save', true);
    }

    const jupyterResult = await this.syncSingleTarget(path, 'jupyter');
    if (cloudActive) {
      const cloudResult = await this.syncSingleTarget(path, 'cloud');
      if (cloudResult.conflict) return cloudResult;
      if (!jupyterResult.ok && cloudResult.ok) {
        return jupyterResult;
      }
      if (!cloudResult.ok && jupyterResult.ok) {
        return cloudResult;
      }
    }
    return jupyterResult;
  }

  /**
   * Queues all local notebooks that haven't been synced to the cloud yet.
   */
  async enqueueAllPendingCloud(): Promise<void> {
    if (!this.isCloudActive()) return;
    const all = await this.storage.listAllNotebooks();
    for (const rec of all) {
      if (rec.pendingCloudSync || !rec.cloudSyncedAt) {
        await this.putOutboxEntry(rec.path, 'cloud', 'save', true);
      }
    }
    await this.flushOutbox();
  }

  private async enqueueAndFlush(path: string, action: 'save' | 'create'): Promise<void> {
    if (this.destroyed) return;
    await this.putOutboxEntry(path, 'jupyter', action, false);
    if (this.isCloudActive()) {
      await this.putOutboxEntry(path, 'cloud', action, false);
    }
    await this.flushOutbox();
  }

  private async putOutboxEntry(
    path: string,
    target: SyncTarget,
    action: 'save' | 'create',
    resetRetry: boolean
  ): Promise<void> {
    const existing = await this.storage.getOutboxItem(path, target);
    const now = Date.now();
    const item: OutboxItem = {
      id: makeOutboxId(target, path),
      target,
      path,
      action,
      createdAt: existing?.createdAt ?? now,
      retryCount: resetRetry ? 0 : (existing?.retryCount ?? 0),
      nextRetryAt: resetRetry ? now : Math.min(existing?.nextRetryAt ?? now, now),
    };
    await this.storage.putOutboxItem(item);
  }

  async flushOutbox(): Promise<void> {
    if (this.destroyed || this.isFlushing) return;
    this.isFlushing = true;

    try {
      const items = await this.storage.listOutboxItems();
      const now = Date.now();
      let earliestNextRetry: number | null = null;

      for (const item of items) {
        if (this.destroyed) break;
        const target: SyncTarget = item.target ?? 'jupyter';

        if (item.nextRetryAt > now) {
          if (earliestNextRetry === null || item.nextRetryAt < earliestNextRetry) {
            earliestNextRetry = item.nextRetryAt;
          }
          continue;
        }

        const result = await this.syncSingleTarget(item.path, target);
        if (!result.ok && !result.conflict) {
          const updated = await this.storage.getOutboxItem(item.path, target);
          if (
            updated &&
            (earliestNextRetry === null || updated.nextRetryAt < earliestNextRetry)
          ) {
            earliestNextRetry = updated.nextRetryAt;
          }
        }
      }

      if (earliestNextRetry !== null && !this.destroyed) {
        this.scheduleRetryTimer(Math.max(500, earliestNextRetry - Date.now()));
      }
    } finally {
      this.isFlushing = false;
    }
  }

  private async syncSingleTarget(path: string, target: SyncTarget): Promise<SyncActionResult> {
    if (target === 'cloud') {
      return this.syncCloudPath(path);
    }
    return this.syncJupyterPath(path);
  }

  private async syncJupyterPath(path: string): Promise<SyncActionResult> {
    const record = await this.storage.getNotebook(path);
    if (!record) {
      await this.storage.deleteOutboxItem(path, 'jupyter');
      return { ok: true, offline: false };
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      await this.bumpOutboxRetry(path, 'jupyter', 'Sin conexión de red');
      this.emit({ path, target: 'jupyter', status: 'offline', message: 'Sin conexión: guardado localmente' });
      return { ok: false, offline: true, error: 'Sin conexión de red' };
    }

    this.emit({ path, target: 'jupyter', status: 'saving' });

    try {
      // Check remote modification timestamp if supported and previously synced
      if (
        record.serverLastModified &&
        !record.isLocalOnly &&
        typeof this.gateway.getNotebookMetadata === 'function'
      ) {
        const remoteMeta = await this.gateway.getNotebookMetadata(path);
        if (remoteMeta && remoteMeta.lastModified !== record.serverLastModified) {
          await this.storage.deleteOutboxItem(path, 'jupyter');
          const conflict: SyncConflict = {
            path,
            target: 'jupyter',
            message: 'El apunte fue modificado en Jupyter Server desde otro lugar.',
          };
          this.emit({
            path,
            target: 'jupyter',
            status: 'conflict',
            message: conflict.message,
            conflict,
          });
          return { ok: false, offline: false, error: conflict.message, conflict };
        }
      }

      const { lastModified } = await this.gateway.saveNotebook(path, record.notebook);
      const latest = await this.storage.getNotebook(path);
      const stillMatches = latest && latest.updatedAt === record.updatedAt;

      if (latest) {
        await this.storage.putNotebook({
          ...latest,
          syncedAt: Date.now(),
          pendingSync: !stillMatches,
          isLocalOnly: false,
          serverLastModified: lastModified,
        });
      }

      if (stillMatches) {
        await this.storage.deleteOutboxItem(path, 'jupyter');
        this.emit({ path, target: 'jupyter', status: 'synced', message: 'Guardado en Termux' });
      } else {
        this.emit({ path, target: 'jupyter', status: 'pending' });
      }

      return { ok: true, offline: false };
    } catch (error) {
      const isNetwork =
        error instanceof JupyterGatewayError ? error.isNetworkError : true;
      const errMsg = error instanceof Error ? error.message : 'Error de sincronización';

      await this.bumpOutboxRetry(path, 'jupyter', errMsg);

      if (isNetwork) {
        this.emit({
          path,
          target: 'jupyter',
          status: 'offline',
          message: 'Sin conexión: guardado localmente',
        });
      } else {
        this.emit({
          path,
          target: 'jupyter',
          status: 'error',
          message: errMsg,
        });
      }

      return { ok: false, offline: isNetwork, error: errMsg };
    }
  }

  private async syncCloudPath(path: string): Promise<SyncActionResult> {
    if (!this.cloudProvider || !this.cloudProvider.isConfigured()) {
      await this.storage.deleteOutboxItem(path, 'cloud');
      return { ok: true, offline: false };
    }

    const record = await this.storage.getNotebook(path);
    if (!record) {
      await this.storage.deleteOutboxItem(path, 'cloud');
      return { ok: true, offline: false };
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      await this.bumpOutboxRetry(path, 'cloud', 'Sin conexión de red');
      this.emit({ path, target: 'cloud', status: 'offline', message: 'Nube offline: pendiente' });
      return { ok: false, offline: true, error: 'Sin conexión de red' };
    }

    this.emit({ path, target: 'cloud', status: 'saving' });

    try {
      const res = await this.cloudProvider.push(
        path,
        record.notebook,
        record.cloudSha ?? null
      );

      const latest = await this.storage.getNotebook(path);
      const stillMatches = latest && latest.updatedAt === record.updatedAt;

      if (latest) {
        await this.storage.putNotebook({
          ...latest,
          cloudSha: res.sha,
          cloudSyncedAt: Date.now(),
          pendingCloudSync: !stillMatches,
        });
      }

      if (stillMatches) {
        await this.storage.deleteOutboxItem(path, 'cloud');
        this.emit({ path, target: 'cloud', status: 'synced', message: 'Guardado en GitHub' });
      } else {
        this.emit({ path, target: 'cloud', status: 'pending' });
      }

      return { ok: true, offline: false };
    } catch (error) {
      if (error instanceof CloudSyncError && error.isConflict) {
        await this.storage.deleteOutboxItem(path, 'cloud');
        const conflict: SyncConflict = {
          path,
          target: 'cloud',
          message: error.message || 'Conflicto con versión remota en GitHub.',
        };
        this.emit({
          path,
          target: 'cloud',
          status: 'conflict',
          message: conflict.message,
          conflict,
        });
        return { ok: false, offline: false, error: conflict.message, conflict };
      }

      const isNetwork =
        error instanceof CloudSyncError ? error.isNetworkError : true;
      const errMsg = error instanceof Error ? error.message : 'Error al sincronizar con la nube';

      await this.bumpOutboxRetry(path, 'cloud', errMsg);

      if (isNetwork) {
        this.emit({
          path,
          target: 'cloud',
          status: 'offline',
          message: 'Nube sin conexión: guardado localmente',
        });
      } else {
        this.emit({
          path,
          target: 'cloud',
          status: 'error',
          message: errMsg,
        });
      }

      return { ok: false, offline: isNetwork, error: errMsg };
    }
  }

  /**
   * Conflict resolution 1: Keep local notebook and overwrite remote target.
   */
  async resolveConflictKeepLocal(path: string, target: SyncTarget): Promise<void> {
    const record = await this.storage.getNotebook(path);
    if (!record) return;

    if (target === 'cloud') {
      if (!this.cloudProvider || !this.cloudProvider.isConfigured()) return;
      this.emit({ path, target: 'cloud', status: 'saving' });
      const remote = await this.cloudProvider.getRemoteVersion(path);
      const res = await this.cloudProvider.push(
        path,
        record.notebook,
        remote?.sha ?? null,
        `NoteLab M3: resolver conflicto (conservar local) en ${path}`
      );
      await this.storage.putNotebook({
        ...record,
        cloudSha: res.sha,
        cloudSyncedAt: Date.now(),
        pendingCloudSync: false,
      });
      await this.storage.deleteOutboxItem(path, 'cloud');
      this.emit({ path, target: 'cloud', status: 'synced', message: 'Guardado en GitHub' });
      return;
    }

    this.emit({ path, target: 'jupyter', status: 'saving' });
    const { lastModified } = await this.gateway.saveNotebook(path, record.notebook);
    await this.storage.putNotebook({
      ...record,
      syncedAt: Date.now(),
      pendingSync: false,
      isLocalOnly: false,
      serverLastModified: lastModified,
    });
    await this.storage.deleteOutboxItem(path, 'jupyter');
    this.emit({ path, target: 'jupyter', status: 'synced', message: 'Guardado en Termux' });
  }

  /**
   * Conflict resolution 2: Discard local changes and use remote version.
   */
  async resolveConflictUseRemote(
    path: string,
    target: SyncTarget
  ): Promise<NotebookDocument> {
    const existing = await this.storage.getNotebook(path);

    if (target === 'cloud') {
      if (!this.cloudProvider || !this.cloudProvider.isConfigured()) {
        throw new Error('Proveedor de nube no configurado');
      }
      const pulled = await this.cloudProvider.pull(path);
      await this.storage.putNotebook({
        path,
        notebook: pulled.notebook,
        draftNotebook: null,
        draftUpdatedAt: null,
        updatedAt: Date.now(),
        syncedAt: existing?.syncedAt ?? null,
        pendingSync: existing?.pendingSync ?? false,
        isLocalOnly: existing?.isLocalOnly ?? false,
        serverLastModified: existing?.serverLastModified ?? null,
        cloudSha: pulled.sha,
        cloudSyncedAt: Date.now(),
        pendingCloudSync: false,
      });
      await this.storage.deleteOutboxItem(path, 'cloud');
      this.emit({ path, target: 'cloud', status: 'synced', message: 'Actualizado desde GitHub' });
      return pulled.notebook;
    }

    const remote = await this.gateway.getNotebook(path);
    await this.storage.putNotebook({
      path,
      notebook: remote.notebook,
      draftNotebook: null,
      draftUpdatedAt: null,
      updatedAt: Date.now(),
      syncedAt: Date.now(),
      pendingSync: false,
      isLocalOnly: false,
      serverLastModified: remote.lastModified,
      cloudSha: existing?.cloudSha ?? null,
      cloudSyncedAt: existing?.cloudSyncedAt ?? null,
      pendingCloudSync: this.isCloudActive(),
    });
    await this.storage.deleteOutboxItem(path, 'jupyter');
    this.emit({ path, target: 'jupyter', status: 'synced', message: 'Actualizado desde Termux' });
    return remote.notebook;
  }

  /**
   * Conflict resolution 3: Save local version as a new copy and pull remote into `path`.
   */
  async resolveConflictSaveCopy(
    path: string,
    target: SyncTarget
  ): Promise<{ copyPath: string; remoteNotebook: NotebookDocument }> {
    const localRecord = await this.storage.getNotebook(path);
    const copyPath = makeConflictCopyPath(path);

    if (localRecord) {
      await this.storage.putNotebook({
        path: copyPath,
        notebook: localRecord.draftNotebook ?? localRecord.notebook,
        draftNotebook: null,
        draftUpdatedAt: null,
        updatedAt: Date.now(),
        syncedAt: null,
        pendingSync: true,
        isLocalOnly: true,
        serverLastModified: null,
        cloudSha: null,
        cloudSyncedAt: null,
        pendingCloudSync: this.isCloudActive(),
      });
      await this.putOutboxEntry(copyPath, 'jupyter', 'create', true);
      if (this.isCloudActive()) {
        await this.putOutboxEntry(copyPath, 'cloud', 'create', true);
      }
    }

    const remoteNotebook = await this.resolveConflictUseRemote(path, target);
    void this.flushOutbox();
    return { copyPath, remoteNotebook };
  }

  private async bumpOutboxRetry(
    path: string,
    target: SyncTarget,
    lastError: string
  ): Promise<void> {
    const existing = await this.storage.getOutboxItem(path, target);
    const retryCount = (existing?.retryCount ?? 0) + 1;
    const delayMs = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * Math.pow(2, retryCount - 1));
    const nextRetryAt = Date.now() + delayMs;

    await this.storage.putOutboxItem({
      id: makeOutboxId(target, path),
      target,
      path,
      action: existing?.action ?? 'save',
      createdAt: existing?.createdAt ?? Date.now(),
      retryCount,
      nextRetryAt,
      lastError,
    });

    this.scheduleRetryTimer(delayMs);
  }

  private scheduleRetryTimer(delayMs: number): void {
    if (this.destroyed) return;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.flushOutbox();
    }, delayMs);
  }

  /**
   * Loads a notebook prioritizing any unsaved local buffer (`draftNotebook`),
   * then local unsynced changes over stale remote snapshots,
   * otherwise fetches from Jupyter Server (or Cloud fallback) and caches into IndexedDB.
   */
  async loadNotebook(
    path: string,
    preferredSource: 'auto' | 'cloud' = 'auto'
  ): Promise<{
    notebook: NotebookDocument;
    status: SyncStatus;
    cloudStatus?: SyncStatus;
    fromCache: boolean;
    hasUnsavedChanges: boolean;
  }> {
    const local = await this.storage.getNotebook(path);

    if (local?.draftNotebook) {
      return {
        notebook: local.draftNotebook,
        status: local.pendingSync ? 'pending' : (local.syncedAt ? 'synced' : 'offline'),
        cloudStatus: local.pendingCloudSync ? 'pending' : (local.cloudSyncedAt ? 'synced' : undefined),
        fromCache: true,
        hasUnsavedChanges: true,
      };
    }

    if (local?.pendingSync || local?.pendingCloudSync) {
      return {
        notebook: local.notebook,
        status: local.pendingSync ? 'pending' : 'synced',
        cloudStatus: local.pendingCloudSync ? 'pending' : (local.cloudSyncedAt ? 'synced' : undefined),
        fromCache: true,
        hasUnsavedChanges: false,
      };
    }

    if (preferredSource === 'cloud' && this.isCloudActive() && this.cloudProvider) {
      try {
        const pulled = await this.cloudProvider.pull(path);
        await this.storage.putNotebook({
          path,
          notebook: pulled.notebook,
          draftNotebook: null,
          draftUpdatedAt: null,
          updatedAt: Date.now(),
          syncedAt: local?.syncedAt ?? null,
          pendingSync: false,
          isLocalOnly: local?.isLocalOnly ?? true,
          serverLastModified: local?.serverLastModified ?? null,
          cloudSha: pulled.sha,
          cloudSyncedAt: Date.now(),
          pendingCloudSync: false,
        });
        return {
          notebook: pulled.notebook,
          status: local?.syncedAt ? 'synced' : 'offline',
          cloudStatus: 'synced',
          fromCache: false,
          hasUnsavedChanges: false,
        };
      } catch (error) {
        if (local) {
          return {
            notebook: local.notebook,
            status: 'offline',
            cloudStatus: 'offline',
            fromCache: true,
            hasUnsavedChanges: false,
          };
        }
        throw error;
      }
    }

    try {
      const remote = await this.gateway.getNotebook(path);
      await this.storage.putNotebook({
        path,
        notebook: remote.notebook,
        draftNotebook: null,
        draftUpdatedAt: null,
        updatedAt: Date.now(),
        syncedAt: Date.now(),
        pendingSync: false,
        isLocalOnly: false,
        serverLastModified: remote.lastModified,
        cloudSha: local?.cloudSha ?? null,
        cloudSyncedAt: local?.cloudSyncedAt ?? null,
        pendingCloudSync: local?.pendingCloudSync ?? false,
      });
      return {
        notebook: remote.notebook,
        status: 'synced',
        cloudStatus: local?.cloudSyncedAt ? 'synced' : undefined,
        fromCache: false,
        hasUnsavedChanges: false,
      };
    } catch (jupyterError) {
      if (this.isCloudActive() && this.cloudProvider) {
        try {
          const pulled = await this.cloudProvider.pull(path);
          await this.storage.putNotebook({
            path,
            notebook: pulled.notebook,
            draftNotebook: null,
            draftUpdatedAt: null,
            updatedAt: Date.now(),
            syncedAt: local?.syncedAt ?? null,
            pendingSync: false,
            isLocalOnly: local?.isLocalOnly ?? true,
            serverLastModified: local?.serverLastModified ?? null,
            cloudSha: pulled.sha,
            cloudSyncedAt: Date.now(),
            pendingCloudSync: false,
          });
          return {
            notebook: pulled.notebook,
            status: 'offline',
            cloudStatus: 'synced',
            fromCache: false,
            hasUnsavedChanges: false,
          };
        } catch {
          // Fall through to local cache if available
        }
      }

      if (local) {
        return {
          notebook: local.notebook,
          status: 'offline',
          cloudStatus: this.isCloudActive() ? 'offline' : undefined,
          fromCache: true,
          hasUnsavedChanges: false,
        };
      }
      throw jupyterError;
    }
  }
}
