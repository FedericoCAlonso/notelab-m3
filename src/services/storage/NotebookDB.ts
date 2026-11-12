import { DBSchema, IDBPDatabase, openDB } from 'idb';
import { ConnectionSettings, NotebookDocument } from '../../types/nbformat';

export interface StoredNotebookRecord {
  path: string;
  notebook: NotebookDocument;
  updatedAt: number;
  syncedAt: number | null;
  pendingSync: boolean;
  isLocalOnly: boolean;
  serverLastModified: string | null;
}

export interface OutboxItem {
  path: string;
  action: 'save' | 'create';
  createdAt: number;
  retryCount: number;
  nextRetryAt: number;
  lastError?: string;
}

interface NoteLabDBSchema extends DBSchema {
  notebooks: {
    key: string;
    value: StoredNotebookRecord;
    indexes: { 'by-updated': number; 'by-pending': number };
  };
  outbox: {
    key: string;
    value: OutboxItem;
    indexes: { 'by-next-retry': number };
  };
  settings: {
    key: string;
    value: ConnectionSettings;
  };
}

const DB_NAME = 'notelab-m3-db';
const DB_VERSION = 1;

export const DEFAULT_CONNECTION_SETTINGS: ConnectionSettings = {
  serverUrl: 'http://localhost:8888',
  token: '',
  theme: 'auto',
  lastOpenedPath: null,
};

export interface INotebookStorage {
  getNotebook(path: string): Promise<StoredNotebookRecord | undefined>;
  putNotebook(record: StoredNotebookRecord): Promise<void>;
  deleteNotebook(path: string): Promise<void>;
  listAllNotebooks(): Promise<StoredNotebookRecord[]>;
  getOutboxItem(path: string): Promise<OutboxItem | undefined>;
  putOutboxItem(item: OutboxItem): Promise<void>;
  deleteOutboxItem(path: string): Promise<void>;
  listOutboxItems(): Promise<OutboxItem[]>;
  getSettings(): Promise<ConnectionSettings>;
  saveSettings(settings: ConnectionSettings): Promise<void>;
}

export class IndexedDBNotebookStorage implements INotebookStorage {
  private dbPromise: Promise<IDBPDatabase<NoteLabDBSchema>> | null = null;

  private getDb(): Promise<IDBPDatabase<NoteLabDBSchema>> {
    if (!this.dbPromise) {
      this.dbPromise = openDB<NoteLabDBSchema>(DB_NAME, DB_VERSION, {
        upgrade(db) {
          if (!db.objectStoreNames.contains('notebooks')) {
            const notebookStore = db.createObjectStore('notebooks', { keyPath: 'path' });
            notebookStore.createIndex('by-updated', 'updatedAt');
            notebookStore.createIndex('by-pending', 'updatedAt');
          }
          if (!db.objectStoreNames.contains('outbox')) {
            const outboxStore = db.createObjectStore('outbox', { keyPath: 'path' });
            outboxStore.createIndex('by-next-retry', 'nextRetryAt');
          }
          if (!db.objectStoreNames.contains('settings')) {
            db.createObjectStore('settings');
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

  async getOutboxItem(path: string): Promise<OutboxItem | undefined> {
    const db = await this.getDb();
    return db.get('outbox', path);
  }

  async putOutboxItem(item: OutboxItem): Promise<void> {
    const db = await this.getDb();
    await db.put('outbox', item);
  }

  async deleteOutboxItem(path: string): Promise<void> {
    const db = await this.getDb();
    await db.delete('outbox', path);
  }

  async listOutboxItems(): Promise<OutboxItem[]> {
    const db = await this.getDb();
    return db.getAllFromIndex('outbox', 'by-next-retry');
  }

  async getSettings(): Promise<ConnectionSettings> {
    const db = await this.getDb();
    const stored = await db.get('settings', 'default');
    return stored ? { ...DEFAULT_CONNECTION_SETTINGS, ...stored } : DEFAULT_CONNECTION_SETTINGS;
  }

  async saveSettings(settings: ConnectionSettings): Promise<void> {
    const db = await this.getDb();
    await db.put('settings', settings, 'default');
  }
}
