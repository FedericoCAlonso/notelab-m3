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

export interface GitHubRepoSummary {
  fullName: string;
  owner: string;
  name: string;
  defaultBranch: string;
  isPrivate: boolean;
}

/**
 * Normalizes owner & repo inputs, accepting full GitHub URLs
 * (`https://github.com/owner/repo.git`) or `owner/repo` shorthand.
 */
export function parseGitHubRepoInput(
  ownerInput: string,
  repoInput: string
): { owner: string; repo: string } {
  const rawRepo = repoInput.trim().replace(/\.git$/i, '').replace(/\/+$/, '');
  const rawOwner = ownerInput.trim().replace(/^@/, '').replace(/\/+$/, '');

  const urlMatch = rawRepo.match(
    /^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+)/i
  );
  if (urlMatch) {
    return {
      owner: urlMatch[1] ?? rawOwner,
      repo: (urlMatch[2] ?? '').replace(/\.git$/i, ''),
    };
  }

  if (rawRepo.includes('/')) {
    const parts = rawRepo.split('/').filter(Boolean);
    if (parts.length >= 2) {
      return {
        owner: parts[0] ?? rawOwner,
        repo: (parts[1] ?? '').replace(/\.git$/i, ''),
      };
    }
  }

  return { owner: rawOwner, repo: rawRepo };
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
    const parsed = parseGitHubRepoInput(settings.owner, settings.repo);
    this.settings = {
      ...settings,
      owner: parsed.owner,
      repo: parsed.repo,
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

  static async listAccessibleRepositories(token: string): Promise<GitHubRepoSummary[]> {
    const cleanToken = token.trim();
    if (!cleanToken) {
      throw new CloudSyncError('Ingresa tu token de GitHub primero.');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(
        `${GITHUB_API_BASE}/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member`,
        {
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${cleanToken}`,
            'X-GitHub-Api-Version': '2022-11-28',
          },
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new CloudSyncError(
            'Token inválido o sin permisos para listar repositorios. También puedes escribir Usuario y Repositorio manualmente.',
            { status: response.status, isAuthError: true }
          );
        }
        throw new CloudSyncError(`GitHub respondió HTTP ${response.status}`, {
          status: response.status,
        });
      }

      const data = (await response.json()) as Array<{
        full_name: string;
        name: string;
        private: boolean;
        default_branch?: string;
        owner?: { login?: string };
      }>;

      return data.map((r) => ({
        fullName: r.full_name,
        owner: r.owner?.login ?? r.full_name.split('/')[0] ?? '',
        name: r.name,
        defaultBranch: r.default_branch ?? 'main',
        isPrivate: Boolean(r.private),
      }));
    } catch (error) {
      if (error instanceof CloudSyncError) throw error;
      throw new CloudSyncError(
        error instanceof Error ? error.message : 'Error de red conectando con GitHub',
        { isNetworkError: true }
      );
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
        default_branch?: string;
        size?: number;
        permissions?: { push?: boolean };
      }>(`/repos/${encodeURIComponent(this.settings.owner)}/${encodeURIComponent(this.settings.repo)}`);

      if (repoInfo.permissions && repoInfo.permissions.push === false) {
        return {
          ok: false,
          error:
            'El token solo tiene lectura. Activa "Contents: Read and write" (Fine-grained PAT) o el scope "repo" (Classic PAT).',
        };
      }

      const defaultBranch = repoInfo.default_branch ?? 'main';
      if (this.settings.branch !== defaultBranch && (repoInfo.size ?? 0) > 0) {
        try {
          await this.requestGitHub(
            `/repos/${encodeURIComponent(this.settings.owner)}/${encodeURIComponent(this.settings.repo)}/branches/${encodeURIComponent(this.settings.branch)}`
          );
        } catch (branchErr) {
          if (branchErr instanceof CloudSyncError && branchErr.isNotFound) {
            return {
              ok: false,
              error: `La rama "${this.settings.branch}" no existe en ${repoInfo.full_name} (la rama por defecto es "${defaultBranch}").`,
            };
          }
        }
      }

      return {
        ok: true,
        detail: `${repoInfo.full_name} (${repoInfo.private ? 'privado' : 'público'}, rama ${this.settings.branch})`,
      };
    } catch (error) {
      if (error instanceof CloudSyncError) {
        if (error.status === 401) {
          return {
            ok: false,
            error: 'Token inválido o expirado (HTTP 401). Genera un nuevo PAT en GitHub.',
          };
        }
        if (error.status === 403) {
          return {
            ok: false,
            error:
              'Permiso denegado (HTTP 403). En Fine-grained PAT habilita Repository permissions → Contents: Read and write.',
          };
        }
        if (error.isNotFound) {
          return {
            ok: false,
            error: `No se encontró ${this.settings.owner}/${this.settings.repo} o el PAT no tiene acceso asignado a ese repositorio.`,
          };
        }
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

  async deleteFile(
    path: string,
    sha?: string | null,
    commitMessage?: string
  ): Promise<void> {
    let targetSha = sha ?? null;
    if (!targetSha) {
      const remote = await this.getRemoteVersion(path);
      if (!remote) return;
      targetSha = remote.sha;
    }

    const repoPath = encodePathSegments(this.resolveRepoPath(path));
    const performDelete = async (shaToDelete: string) => {
      await this.requestGitHub<unknown>(
        `/repos/${encodeURIComponent(this.settings.owner)}/${encodeURIComponent(this.settings.repo)}/contents/${repoPath}`,
        {
          method: 'DELETE',
          body: JSON.stringify({
            message: commitMessage || `NoteLab M3: eliminar ${cleanPathSegments(path)}`,
            sha: shaToDelete,
            branch: this.settings.branch,
          }),
        }
      );
    };

    try {
      await performDelete(targetSha);
    } catch (error) {
      if (error instanceof CloudSyncError && error.isNotFound) {
        return;
      }
      if (error instanceof CloudSyncError && error.isConflict) {
        const latest = await this.getRemoteVersion(path);
        if (!latest) return;
        await performDelete(latest.sha);
        return;
      }
      throw error;
    }
  }

  private async listRaw(dirPath = ''): Promise<GitHubContentResponse[]> {
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
      return items;
    } catch (error) {
      if (error instanceof CloudSyncError && error.isNotFound) {
        return [];
      }
      throw error;
    }
  }

  private async listAllFilesRecursive(
    dirPath: string
  ): Promise<Array<{ logicalPath: string; sha: string }>> {
    const entries = await this.listRaw(dirPath);
    const files: Array<{ logicalPath: string; sha: string }> = [];

    for (const entry of entries) {
      const logical = this.toLogicalPath(entry.path);
      if (entry.type === 'dir') {
        const subFiles = await this.listAllFilesRecursive(logical);
        files.push(...subFiles);
      } else if (entry.type === 'file') {
        files.push({ logicalPath: logical, sha: entry.sha });
      }
    }

    return files;
  }

  async ensureDirectory(dirPath: string): Promise<void> {
    const cleanDir = cleanPathSegments(dirPath);
    if (!cleanDir) return;

    const existing = await this.listRaw(cleanDir);
    if (existing.length > 0) return;

    const keepLogicalPath = `${cleanDir}/.gitkeep`;
    const repoPath = encodePathSegments(this.resolveRepoPath(keepLogicalPath));
    await this.requestGitHub<GitHubWriteResponse>(
      `/repos/${encodeURIComponent(this.settings.owner)}/${encodeURIComponent(this.settings.repo)}/contents/${repoPath}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          message: `NoteLab M3: crear carpeta ${cleanDir}`,
          content: '',
          branch: this.settings.branch,
        }),
      }
    );
  }

  async renameDirectory(
    oldDir: string,
    newDir: string
  ): Promise<Array<{ oldPath: string; newPath: string; newSha: string }>> {
    const cleanOld = cleanPathSegments(oldDir);
    const cleanNew = cleanPathSegments(newDir);
    if (!cleanOld || !cleanNew || cleanOld === cleanNew) return [];

    const files = await this.listAllFilesRecursive(cleanOld);
    const moved: Array<{ oldPath: string; newPath: string; newSha: string }> = [];
    const ref = encodeURIComponent(this.settings.branch);

    for (const file of files) {
      const prefix = `${cleanOld}/`;
      if (!file.logicalPath.startsWith(prefix)) continue;
      const rel = file.logicalPath.slice(prefix.length);
      const targetPath = `${cleanNew}/${rel}`;

      const oldRepoPath = encodePathSegments(this.resolveRepoPath(file.logicalPath));
      const item = await this.requestGitHub<GitHubContentResponse>(
        `/repos/${encodeURIComponent(this.settings.owner)}/${encodeURIComponent(this.settings.repo)}/contents/${oldRepoPath}?ref=${ref}`
      );
      const contentBase64 = typeof item.content === 'string' ? item.content.replace(/\s+/g, '') : '';

      const newRepoPath = encodePathSegments(this.resolveRepoPath(targetPath));
      const existingTarget = await this.getRemoteVersion(targetPath);
      const putBody: Record<string, string> = {
        message: `NoteLab M3: mover ${file.logicalPath} -> ${targetPath}`,
        content: contentBase64,
        branch: this.settings.branch,
      };
      if (existingTarget) {
        putBody.sha = existingTarget.sha;
      }

      const writeRes = await this.requestGitHub<GitHubWriteResponse>(
        `/repos/${encodeURIComponent(this.settings.owner)}/${encodeURIComponent(this.settings.repo)}/contents/${newRepoPath}`,
        {
          method: 'PUT',
          body: JSON.stringify(putBody),
        }
      );

      await this.deleteFile(
        file.logicalPath,
        item.sha || file.sha,
        `NoteLab M3: limpiar ${file.logicalPath} tras mover carpeta`
      );

      moved.push({
        oldPath: file.logicalPath,
        newPath: targetPath,
        newSha: writeRes.content?.sha ?? '',
      });
    }

    return moved;
  }

  async deleteDirectory(dirPath: string): Promise<void> {
    const cleanDir = cleanPathSegments(dirPath);
    if (!cleanDir) return;

    const files = await this.listAllFilesRecursive(cleanDir);
    for (const file of files) {
      await this.deleteFile(
        file.logicalPath,
        file.sha,
        `NoteLab M3: eliminar carpeta ${cleanDir}`
      );
    }
  }

  async list(dirPath = ''): Promise<CloudRemoteItem[]> {
    const items = await this.listRaw(dirPath);
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
  }
}
