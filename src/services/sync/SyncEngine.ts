import { IJupyterGateway, JupyterGatewayError } from '../jupyter/JupyterGateway';
import { INotebookStorage, OutboxItem, StoredNotebookRecord } from '../storage/NotebookDB';
import { NotebookDocument, SyncStatus } from '../../types/nbformat';

export interface SyncStatusEvent {
  path: string;
  status: SyncStatus;
  message?: string;
}

type SyncListener = (event: SyncStatusEvent) => void;

const DEBOUNCE_MS = 800;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;

export class SyncEngine {
  private readonly storage: INotebookStorage;
  private readonly gateway: IJupyterGateway;
  private readonly listeners = new Set<SyncListener>();
  private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private isFlushing = false;
  private destroyed = false;
  private onlineHandler: (() => void) | null = null;
  private visibilityHandler: (() => void) | null = null;

  constructor(storage: INotebookStorage, gateway: IJupyterGateway) {
    this.storage = storage;
    this.gateway = gateway;
    this.attachBrowserLifecycleListeners();
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
   * Local-first write:
   * 1. Writes immediately to IndexedDB with pendingSync: true.
   * 2. Schedules debounced (800ms) Outbox enqueue + PUT to /api/contents.
   */
  async scheduleSave(path: string, notebook: NotebookDocument): Promise<void> {
    const existing = await this.storage.getNotebook(path);
    const record: StoredNotebookRecord = {
      path,
      notebook,
      updatedAt: Date.now(),
      syncedAt: existing?.syncedAt ?? null,
      pendingSync: true,
      isLocalOnly: existing?.isLocalOnly ?? false,
      serverLastModified: existing?.serverLastModified ?? null,
    };

    await this.storage.putNotebook(record);
    this.emit({ path, status: 'pending' });

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
   * Immediate write + immediate sync attempt (used by Ctrl+S).
   */
  async forceSync(path: string, notebook?: NotebookDocument): Promise<{ ok: boolean; offline: boolean; error?: string }> {
    const prevTimer = this.debounceTimers.get(path);
    if (prevTimer) {
      clearTimeout(prevTimer);
      this.debounceTimers.delete(path);
    }

    if (notebook) {
      const existing = await this.storage.getNotebook(path);
      await this.storage.putNotebook({
        path,
        notebook,
        updatedAt: Date.now(),
        syncedAt: existing?.syncedAt ?? null,
        pendingSync: true,
        isLocalOnly: existing?.isLocalOnly ?? false,
        serverLastModified: existing?.serverLastModified ?? null,
      });
    }

    await this.putOutboxEntry(path, 'save', true);
    return this.syncSinglePath(path);
  }

  private async enqueueAndFlush(path: string, action: 'save' | 'create'): Promise<void> {
    if (this.destroyed) return;
    await this.putOutboxEntry(path, action, false);
    await this.flushOutbox();
  }

  private async putOutboxEntry(
    path: string,
    action: 'save' | 'create',
    resetRetry: boolean
  ): Promise<void> {
    const existing = await this.storage.getOutboxItem(path);
    const now = Date.now();
    const item: OutboxItem = {
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
        if (item.nextRetryAt > now) {
          if (earliestNextRetry === null || item.nextRetryAt < earliestNextRetry) {
            earliestNextRetry = item.nextRetryAt;
          }
          continue;
        }

        const result = await this.syncSinglePath(item.path);
        if (!result.ok) {
          const updated = await this.storage.getOutboxItem(item.path);
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

  private async syncSinglePath(
    path: string
  ): Promise<{ ok: boolean; offline: boolean; error?: string }> {
    const record = await this.storage.getNotebook(path);
    if (!record) {
      await this.storage.deleteOutboxItem(path);
      return { ok: true, offline: false };
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      await this.bumpOutboxRetry(path, 'Sin conexión de red');
      this.emit({ path, status: 'offline', message: 'Sin conexión: guardado localmente' });
      return { ok: false, offline: true, error: 'Sin conexión de red' };
    }

    this.emit({ path, status: 'saving' });

    try {
      const { lastModified } = await this.gateway.saveNotebook(path, record.notebook);
      // Verify record wasn't modified again while PUT was in flight
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
        await this.storage.deleteOutboxItem(path);
        this.emit({ path, status: 'synced', message: 'Guardado en Termux' });
      } else {
        this.emit({ path, status: 'pending' });
      }

      return { ok: true, offline: false };
    } catch (error) {
      const isNetwork =
        error instanceof JupyterGatewayError ? error.isNetworkError : true;
      const errMsg = error instanceof Error ? error.message : 'Error de sincronización';

      await this.bumpOutboxRetry(path, errMsg);

      if (isNetwork) {
        this.emit({
          path,
          status: 'offline',
          message: 'Sin conexión: guardado localmente',
        });
      } else {
        this.emit({
          path,
          status: 'error',
          message: errMsg,
        });
      }

      return { ok: false, offline: isNetwork, error: errMsg };
    }
  }

  private async bumpOutboxRetry(path: string, lastError: string): Promise<void> {
    const existing = await this.storage.getOutboxItem(path);
    const retryCount = (existing?.retryCount ?? 0) + 1;
    const delayMs = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * Math.pow(2, retryCount - 1));
    const nextRetryAt = Date.now() + delayMs;

    await this.storage.putOutboxItem({
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
   * Loads a notebook prioritizing local unsynced changes over stale remote snapshots,
   * otherwise fetches from Jupyter Server and caches into IndexedDB.
   */
  async loadNotebook(path: string): Promise<{
    notebook: NotebookDocument;
    status: SyncStatus;
    fromCache: boolean;
  }> {
    const local = await this.storage.getNotebook(path);

    if (local?.pendingSync) {
      // Unsynced local edits take precedence so user never loses class notes
      return {
        notebook: local.notebook,
        status: 'pending',
        fromCache: true,
      };
    }

    try {
      const remote = await this.gateway.getNotebook(path);
      await this.storage.putNotebook({
        path,
        notebook: remote.notebook,
        updatedAt: Date.now(),
        syncedAt: Date.now(),
        pendingSync: false,
        isLocalOnly: false,
        serverLastModified: remote.lastModified,
      });
      return {
        notebook: remote.notebook,
        status: 'synced',
        fromCache: false,
      };
    } catch (error) {
      if (local) {
        return {
          notebook: local.notebook,
          status: 'offline',
          fromCache: true,
        };
      }
      throw error;
    }
  }
}
