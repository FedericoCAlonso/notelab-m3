import { DBSchema, IDBPDatabase, openDB } from 'idb';
import {
  CellOutput,
  CloudSyncSettings,
  ConnectionSettings,
  NotebookDocument,
  SyncTarget,
} from '../../types/nbformat';

export interface StoredNotebookRecord {
  path: string;
  notebook: NotebookDocument;
  draftNotebook?: NotebookDocument | null;
  draftUpdatedAt?: number | null;
  updatedAt: number;
  syncedAt: number | null;
  pendingSync: boolean;
  isLocalOnly: boolean;
  serverLastModified: string | null;
  cloudSha?: string | null;
  cloudSyncedAt?: number | null;
  pendingCloudSync?: boolean;
}

export interface StoredFolderRecord {
  path: string;
  createdAt: number;
}

export interface CachedPythonBlockOutput {
  outputs: CellOutput[];
  hasError: boolean;
  lastBridgeHash: string | null;
  lastRunCode: string | null;
  updatedAt: number;
}

export interface StoredReactiveDocRecord {
  path: string; // e.g. "memoria-electrica.md"
  content: string; // pure plain-text extended Markdown
  updatedAt: number;
  createdAt: number;
  cloudSha?: string | null;
  cloudSyncedAt?: number | null;
  pendingCloudSync?: boolean;
  /** Local-only cache of Python block outputs (never serialized into .md) */
  pythonOutputCache?: Record<string, CachedPythonBlockOutput>;
}

export interface OutboxItem {
  id?: string;
  target?: SyncTarget;
  path: string;
  action: 'save' | 'create';
  createdAt: number;
  retryCount: number;
  nextRetryAt: number;
  lastError?: string;
}

export function makeOutboxId(target: SyncTarget, path: string): string {
  return `${target}:${path}`;
}

interface NoteLabDBSchema extends DBSchema {
  notebooks: {
    key: string;
    value: StoredNotebookRecord;
    indexes: { 'by-updated': number; 'by-pending': number };
  };
  folders: {
    key: string;
    value: StoredFolderRecord;
  };
  outbox: {
    key: string;
    value: OutboxItem;
    indexes: { 'by-next-retry': number };
  };
  outbox_v2: {
    key: string;
    value: OutboxItem;
    indexes: { 'by-next-retry': number };
  };
  settings: {
    key: string;
    value: ConnectionSettings;
  };
  reactive_docs: {
    key: string;
    value: StoredReactiveDocRecord;
    indexes: { 'by-updated': number };
  };
}

const DB_NAME = 'notelab-m3-db';
const DB_VERSION = 4;

export const DEFAULT_CLOUD_SYNC_SETTINGS: CloudSyncSettings = {
  enabled: false,
  provider: 'github',
  owner: '',
  repo: '',
  branch: 'main',
  basePath: '',
  token: '',
};

export const DEFAULT_CONNECTION_SETTINGS: ConnectionSettings = {
  serverUrl: 'http://localhost:8888',
  token: '',
  theme: 'auto',
  lastOpenedPath: null,
  cloud: { ...DEFAULT_CLOUD_SYNC_SETTINGS },
};

export interface INotebookStorage {
  getNotebook(path: string): Promise<StoredNotebookRecord | undefined>;
  putNotebook(record: StoredNotebookRecord): Promise<void>;
  deleteNotebook(path: string): Promise<void>;
  listAllNotebooks(): Promise<StoredNotebookRecord[]>;
  listFolders?(): Promise<StoredFolderRecord[]>;
  putFolder?(record: StoredFolderRecord): Promise<void>;
  deleteFolder?(path: string): Promise<void>;
  getOutboxItem(path: string, target?: SyncTarget): Promise<OutboxItem | undefined>;
  putOutboxItem(item: OutboxItem): Promise<void>;
  deleteOutboxItem(path: string, target?: SyncTarget): Promise<void>;
  listOutboxItems(): Promise<OutboxItem[]>;
  getSettings(): Promise<ConnectionSettings>;
  saveSettings(settings: ConnectionSettings): Promise<void>;
  getReactiveDoc?(path: string): Promise<StoredReactiveDocRecord | undefined>;
  putReactiveDoc?(record: StoredReactiveDocRecord): Promise<void>;
  deleteReactiveDoc?(path: string): Promise<void>;
  listAllReactiveDocs?(): Promise<StoredReactiveDocRecord[]>;
}

export class IndexedDBNotebookStorage implements INotebookStorage {
  private dbPromise: Promise<IDBPDatabase<NoteLabDBSchema>> | null = null;

  private getDb(): Promise<IDBPDatabase<NoteLabDBSchema>> {
    if (!this.dbPromise) {
      this.dbPromise = openDB<NoteLabDBSchema>(DB_NAME, DB_VERSION, {
        async upgrade(db, oldVersion, _newVersion, transaction) {
          if (!db.objectStoreNames.contains('notebooks')) {
            const notebookStore = db.createObjectStore('notebooks', { keyPath: 'path' });
            notebookStore.createIndex('by-updated', 'updatedAt');
            notebookStore.createIndex('by-pending', 'updatedAt');
          }
          if (!db.objectStoreNames.contains('settings')) {
            db.createObjectStore('settings');
          }
          if (!db.objectStoreNames.contains('outbox_v2')) {
            const outboxV2 = db.createObjectStore('outbox_v2', { keyPath: 'id' });
            outboxV2.createIndex('by-next-retry', 'nextRetryAt');
          }
          if (!db.objectStoreNames.contains('folders')) {
            db.createObjectStore('folders', { keyPath: 'path' });
          }
          if (!db.objectStoreNames.contains('reactive_docs')) {
            const reactiveStore = db.createObjectStore('reactive_docs', { keyPath: 'path' });
            reactiveStore.createIndex('by-updated', 'updatedAt');
          }

          if (oldVersion > 0 && oldVersion < 2 && db.objectStoreNames.contains('outbox')) {
            const legacyItems = await transaction.objectStore('outbox').getAll();
            const outboxV2 = transaction.objectStore('outbox_v2');
            for (const item of legacyItems) {
              const target: SyncTarget = item.target ?? 'jupyter';
              await outboxV2.put({
                ...item,
                target,
                id: item.id ?? makeOutboxId(target, item.path),
              });
            }
            db.deleteObjectStore('outbox');
          }
        },
      });
    }
    return this.dbPromise;
  }

  async getNotebook(path: string): Promise<StoredNotebookRecord | undefined> {
    const db = await this.getDb();
    return db.get('notebooks', path);
  }

  async putNotebook(record: StoredNotebookRecord): Promise<void> {
    const db = await this.getDb();
    await db.put('notebooks', record);
  }

  async deleteNotebook(path: string): Promise<void> {
    const db = await this.getDb();
    await db.delete('notebooks', path);
  }

  async listAllNotebooks(): Promise<StoredNotebookRecord[]> {
    const db = await this.getDb();
    const all = await db.getAllFromIndex('notebooks', 'by-updated');
    return all.reverse();
  }

  async listFolders(): Promise<StoredFolderRecord[]> {
    const db = await this.getDb();
    return db.getAll('folders');
  }

  async putFolder(record: StoredFolderRecord): Promise<void> {
    const db = await this.getDb();
    const clean = record.path.replace(/^\/+|\/+$/g, '');
    if (!clean) return;
    await db.put('folders', { ...record, path: clean });
  }

  async deleteFolder(path: string): Promise<void> {
    const db = await this.getDb();
    const clean = path.replace(/^\/+|\/+$/g, '');
    if (!clean) return;
    await db.delete('folders', clean);
  }

  async getOutboxItem(path: string, target: SyncTarget = 'jupyter'): Promise<OutboxItem | undefined> {
    const db = await this.getDb();
    return db.get('outbox_v2', makeOutboxId(target, path));
  }

  async putOutboxItem(item: OutboxItem): Promise<void> {
    const db = await this.getDb();
    const target: SyncTarget = item.target ?? 'jupyter';
    await db.put('outbox_v2', {
      ...item,
      target,
      id: item.id ?? makeOutboxId(target, item.path),
    });
  }

  async deleteOutboxItem(path: string, target: SyncTarget = 'jupyter'): Promise<void> {
    const db = await this.getDb();
    await db.delete('outbox_v2', makeOutboxId(target, path));
  }

  async listOutboxItems(): Promise<OutboxItem[]> {
    const db = await this.getDb();
    return db.getAllFromIndex('outbox_v2', 'by-next-retry');
  }

  async getSettings(): Promise<ConnectionSettings> {
    const db = await this.getDb();
    const stored = await db.get('settings', 'default');
    if (!stored) {
      return {
        ...DEFAULT_CONNECTION_SETTINGS,
        cloud: { ...DEFAULT_CLOUD_SYNC_SETTINGS },
      };
    }
    return {
      ...DEFAULT_CONNECTION_SETTINGS,
      ...stored,
      cloud: {
        ...DEFAULT_CLOUD_SYNC_SETTINGS,
        ...(stored.cloud ?? {}),
      },
    };
  }

  async saveSettings(settings: ConnectionSettings): Promise<void> {
    const db = await this.getDb();
    await db.put('settings', settings, 'default');
  }

  async getReactiveDoc(path: string): Promise<StoredReactiveDocRecord | undefined> {
    const db = await this.getDb();
    return db.get('reactive_docs', path);
  }

  async putReactiveDoc(record: StoredReactiveDocRecord): Promise<void> {
    const db = await this.getDb();
    await db.put('reactive_docs', record);
  }

  async deleteReactiveDoc(path: string): Promise<void> {
    const db = await this.getDb();
    await db.delete('reactive_docs', path);
  }

  async listAllReactiveDocs(): Promise<StoredReactiveDocRecord[]> {
    const db = await this.getDb();
    const all = await db.getAllFromIndex('reactive_docs', 'by-updated');
    return all.reverse();
  }
}
