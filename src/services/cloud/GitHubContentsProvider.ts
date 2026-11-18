import {
  CloudSyncSettings,
  NotebookDocument,
  RawNotebookDocumentJson,
  normalizeNotebookDocument,
  serializeNotebookDocument,
} from '../../types/nbformat';
import {
  CloudPullResult,
  CloudPushResult,
  CloudRemoteItem,
  CloudSyncError,
  CloudTestResult,
  ICloudSyncProvider,
} from './CloudSyncProvider';

const GITHUB_API_BASE = 'https://api.github.com';

export function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function base64ToUtf8(base64: string): string {
  const clean = base64.replace(/\s+/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function cleanPathSegments(path: string): string {
  return path.replace(/^\/+|\/+$/g, '');
}

function encodePathSegments(path: string): string {
  const cleaned = cleanPathSegments(path);
  if (!cleaned) return '';
  return cleaned
    .split('/')
    .filter(Boolean)
    .map((s) => encodeURIComponent(s))
    .join('/');
}

interface GitHubContentResponse {
  name: string;
  path: string;
  sha: string;
  size?: number;
  type: 'file' | 'dir' | 'symlink' | 'submodule';
  content?: string;
  encoding?: string;
}

interface GitHubWriteResponse {
  content?: {
    path?: string;
    sha?: string;
  };
}

export class GitHubContentsProvider implements ICloudSyncProvider {
  private settings: CloudSyncSettings = {
    enabled: false,
    provider: 'github',
    owner: '',
    repo: '',
    branch: 'main',
    basePath: '',
    token: '',
  };

  constructor(initialSettings?: CloudSyncSettings) {
    if (initialSettings) {
      this.configure(initialSettings);
    }
  }

  configure(settings: CloudSyncSettings): void {
    this.settings = {
      ...settings,
      owner: settings.owner.trim(),
      repo: settings.repo.trim(),
      branch: settings.branch.trim() || 'main',
      basePath: cleanPathSegments(settings.basePath),
      token: settings.token.trim(),
    };
  }

  isConfigured(): boolean {
    return Boolean(
      this.settings.enabled &&
        this.settings.owner &&
        this.settings.repo &&
        this.settings.token
    );
  }

  private resolveRepoPath(logicalPath: string): string {
    const cleanLogical = cleanPathSegments(logicalPath);
    if (!this.settings.basePath) return cleanLogical;
    if (!cleanLogical) return this.settings.basePath;
    return `${this.settings.basePath}/${cleanLogical}`;
  }

  private toLogicalPath(repoPath: string): string {
    const cleanRepo = cleanPathSegments(repoPath);
    if (!this.settings.basePath) return cleanRepo;
    const prefix = `${this.settings.basePath}/`;
    if (cleanRepo.startsWith(prefix)) {
      return cleanRepo.slice(prefix.length);
    }
    if (cleanRepo === this.settings.basePath) {
      return '';
    }
    return cleanRepo;
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new CloudSyncError('Sincronización con GitHub no configurada', {
        isAuthError: false,
      });
    }
  }

  private async requestGitHub<T>(
    endpoint: string,
    options: RequestInit = {},
    timeoutMs = 12000
  ): Promise<T> {
    this.assertConfigured();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers = new Headers(options.headers);
      headers.set('Accept', 'application/vnd.github+json');
      headers.set('Authorization', `Bearer ${this.settings.token}`);
      headers.set('X-GitHub-Api-Version', '2022-11-28');
      if (options.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }

      const response = await fetch(`${GITHUB_API_BASE}${endpoint}`, {
        ...options,
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        let message = `GitHub HTTP ${response.status}`;
        try {
          const errJson = (await response.json()) as { message?: string };
          if (errJson?.message) {
            message = `${message}: ${errJson.message}`;
          }
        } catch {
          // ignore non-JSON body
        }

        throw new CloudSyncError(message, {
          status: response.status,
          isConflict: response.status === 409 || response.status === 422,
          isAuthError: response.status === 401 || response.status === 403,
          isNotFound: response.status === 404,
        });
      }

      if (response.status === 204) {
        return undefined as T;
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof CloudSyncError) {
        throw error;
      }
      const msg =
        error instanceof Error ? error.message : 'Error de red conectando con GitHub';
      throw new CloudSyncError(msg, { isNetworkError: true });
    } finally {
      clearTimeout(timer);
    }
  }

  async testConnection(): Promise<CloudTestResult> {
    if (!this.settings.owner || !this.settings.repo || !this.settings.token) {
      return {
        ok: false,
        error: 'Completa usuario/org, repositorio y token (PAT) de GitHub.',
      };
    }

    const prevEnabled = this.settings.enabled;
    this.settings = { ...this.settings, enabled: true };
    try {
      const repoInfo = await this.requestGitHub<{
        full_name: string;
        private: boolean;
        permissions?: { push?: boolean };
      }>(`/repos/${encodeURIComponent(this.settings.owner)}/${encodeURIComponent(this.settings.repo)}`);

      if (repoInfo.permissions && repoInfo.permissions.push === false) {
        return {
          ok: false,
          error: 'El token no tiene permiso de escritura (Contents: Read & write) en este repositorio.',
        };
      }

      return {
        ok: true,
        detail: `${repoInfo.full_name} (${repoInfo.private ? 'privado' : 'público'}, rama ${this.settings.branch})`,
      };
    } catch (error) {
      if (error instanceof CloudSyncError && error.isAuthError) {
        return {
          ok: false,
          error: 'Token de GitHub inválido o sin permisos sobre el repositorio.',
        };
      }
      if (error instanceof CloudSyncError && error.isNotFound) {
        return {
          ok: false,
          error: `No se encontró el repositorio ${this.settings.owner}/${this.settings.repo} (o el PAT no tiene acceso).`,
        };
      }
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'No se pudo conectar con GitHub',
      };
    } finally {
      this.settings = { ...this.settings, enabled: prevEnabled };
    }
  }

  async getRemoteVersion(path: string): Promise<{ sha: string } | null> {
    const repoPath = encodePathSegments(this.resolveRepoPath(path));
    const ref = encodeURIComponent(this.settings.branch);
    try {
      const item = await this.requestGitHub<GitHubContentResponse>(
        `/repos/${encodeURIComponent(this.settings.owner)}/${encodeURIComponent(this.settings.repo)}/contents/${repoPath}?ref=${ref}`
      );
      if (Array.isArray(item) || item.type !== 'file') {
        return null;
      }
      return { sha: item.sha };
    } catch (error) {
      if (error instanceof CloudSyncError && error.isNotFound) {
        return null;
      }
      throw error;
    }
  }

  async pull(path: string): Promise<CloudPullResult> {
    const repoPath = encodePathSegments(this.resolveRepoPath(path));
    const ref = encodeURIComponent(this.settings.branch);
    const item = await this.requestGitHub<GitHubContentResponse>(
      `/repos/${encodeURIComponent(this.settings.owner)}/${encodeURIComponent(this.settings.repo)}/contents/${repoPath}?ref=${ref}`
    );

    if (Array.isArray(item) || item.type !== 'file' || typeof item.content !== 'string') {
      throw new CloudSyncError('El recurso remoto en GitHub no es un archivo .ipynb válido');
    }

    const decoded = base64ToUtf8(item.content);
    let rawJson: RawNotebookDocumentJson;
    try {
      rawJson = JSON.parse(decoded) as RawNotebookDocumentJson;
    } catch {
      throw new CloudSyncError('El archivo remoto no contiene JSON nbformat v4 válido');
    }

    return {
      notebook: normalizeNotebookDocument(rawJson),
      sha: item.sha,
      path: this.toLogicalPath(item.path),
    };
  }

  async push(
    path: string,
    notebook: NotebookDocument,
    expectedSha?: string | null,
    commitMessage?: string
  ): Promise<CloudPushResult> {
    // If client has no recorded sha, ensure we don't blindly clobber a file created from another device
    if (!expectedSha) {
      const existing = await this.getRemoteVersion(path);
      if (existing) {
        throw new CloudSyncError(
          'El apunte ya existe en GitHub con una versión distinta.',
          { status: 409, isConflict: true }
        );
      }
    }

    const repoPath = encodePathSegments(this.resolveRepoPath(path));
    const serialized = JSON.stringify(serializeNotebookDocument(notebook), null, 2) + '\n';
    const contentBase64 = utf8ToBase64(serialized);

    const body: Record<string, string> = {
      message: commitMessage || `NoteLab M3: actualizar ${cleanPathSegments(path)}`,
      content: contentBase64,
      branch: this.settings.branch,
    };
    if (expectedSha) {
      body.sha = expectedSha;
    }

    const res = await this.requestGitHub<GitHubWriteResponse>(
      `/repos/${encodeURIComponent(this.settings.owner)}/${encodeURIComponent(this.settings.repo)}/contents/${repoPath}`,
      {
        method: 'PUT',
        body: JSON.stringify(body),
      }
    );

    const newSha = res.content?.sha;
    if (!newSha) {
      throw new CloudSyncError('GitHub no devolvió el SHA del archivo guardado');
    }

    return {
      sha: newSha,
      path: this.toLogicalPath(res.content?.path || this.resolveRepoPath(path)),
    };
  }

  async list(dirPath = ''): Promise<CloudRemoteItem[]> {
    const repoPath = encodePathSegments(this.resolveRepoPath(dirPath));
    const ref = encodeURIComponent(this.settings.branch);
    const suffix = repoPath ? `/${repoPath}` : '';

    try {
      const items = await this.requestGitHub<GitHubContentResponse | GitHubContentResponse[]>(
        `/repos/${encodeURIComponent(this.settings.owner)}/${encodeURIComponent(this.settings.repo)}/contents${suffix}?ref=${ref}`
      );
      if (!Array.isArray(items)) {
        return [];
      }

      return items
        .filter((item) => item.type === 'dir' || (item.type === 'file' && item.name.endsWith('.ipynb')))
        .map((item) => ({
          name: item.name,
          path: this.toLogicalPath(item.path),
          type: item.type === 'dir' ? ('dir' as const) : ('file' as const),
          sha: item.sha,
          size: item.size,
        }))
        .sort((a, b) => {
          if (a.type === 'dir' && b.type !== 'dir') return -1;
          if (a.type !== 'dir' && b.type === 'dir') return 1;
          return a.name.localeCompare(b.name);
        });
    } catch (error) {
      if (error instanceof CloudSyncError && error.isNotFound) {
        return [];
      }
      throw error;
    }
  }
}
