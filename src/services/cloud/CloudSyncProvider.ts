import { CloudSyncSettings, NotebookDocument } from '../../types/nbformat';

export interface CloudRemoteItem {
  name: string;
  path: string;
  type: 'file' | 'dir';
  sha: string;
  size?: number;
}

export interface CloudPushResult {
  sha: string;
  path: string;
}

export interface CloudPullResult {
  notebook: NotebookDocument;
  sha: string;
  path: string;
}

export interface CloudTestResult {
  ok: boolean;
  detail?: string;
  error?: string;
}

export interface CloudSyncErrorOptions {
  status?: number;
  isNetworkError?: boolean;
  isConflict?: boolean;
  isAuthError?: boolean;
  isNotFound?: boolean;
}

export class CloudSyncError extends Error {
  readonly status?: number;
  readonly isNetworkError: boolean;
  readonly isConflict: boolean;
  readonly isAuthError: boolean;
  readonly isNotFound: boolean;

  constructor(message: string, options: CloudSyncErrorOptions = {}) {
    super(message);
    this.name = 'CloudSyncError';
    this.status = options.status;
    this.isNetworkError = Boolean(options.isNetworkError);
    this.isConflict = Boolean(options.isConflict);
    this.isAuthError = Boolean(options.isAuthError);
    this.isNotFound = Boolean(options.isNotFound);
  }
}

export interface ICloudSyncProvider {
  configure(settings: CloudSyncSettings): void;
  isConfigured(): boolean;
  testConnection(): Promise<CloudTestResult>;
  getRemoteVersion(path: string): Promise<{ sha: string } | null>;
  pull(path: string): Promise<CloudPullResult>;
  push(
    path: string,
    notebook: NotebookDocument,
    expectedSha?: string | null,
    commitMessage?: string
  ): Promise<CloudPushResult>;
  deleteFile?(
    path: string,
    sha?: string | null,
    commitMessage?: string
  ): Promise<void>;
  ensureDirectory?(dirPath: string): Promise<void>;
  renameDirectory?(
    oldDir: string,
    newDir: string
  ): Promise<Array<{ oldPath: string; newPath: string; newSha: string }>>;
  deleteDirectory?(dirPath: string): Promise<void>;
  list(dirPath?: string): Promise<CloudRemoteItem[]>;
}
