import {
  CellOutput,
  JupyterContentItem,
  KernelInfo,
  NotebookDocument,
  RawNotebookDocumentJson,
  createEmptyNotebook,
  normalizeNotebookDocument,
  serializeNotebookDocument,
} from '../../types/nbformat';
import { KernelState } from '../../state/machines';
import {
  ConnectionErrorKind,
  classifyConnectionError,
} from './connectionDeepLink';

export interface ExecutionResult {
  executionCount: number | null;
  outputs: CellOutput[];
  hasError: boolean;
}

export interface StdinRequest {
  prompt: string;
  password: boolean;
  submit: (value: string) => void;
  cancel: () => void;
}

export interface ExecuteCodeCallbacks {
  onOutput?: (outputs: CellOutput[], executionCount: number | null) => void;
  onInputRequest?: (request: StdinRequest) => void;
}

export interface ConnectionTestResult {
  ok: boolean;
  version?: string;
  error?: string;
  errorKind?: ConnectionErrorKind;
}

export interface IJupyterGateway {
  configure(serverUrl: string, token: string): void;
  testConnection(): Promise<ConnectionTestResult>;

  // /api/contents
  listDirectory(path?: string): Promise<JupyterContentItem[]>;
  getNotebook(path: string): Promise<{ notebook: NotebookDocument; lastModified: string }>;
  getNotebookMetadata?(path: string): Promise<{ lastModified: string } | null>;
  saveNotebook(path: string, notebook: NotebookDocument): Promise<{ lastModified: string }>;
  createNotebook(path: string, notebook?: NotebookDocument): Promise<{ path: string; lastModified: string }>;
  renameNotebook(oldPath: string, newPath: string): Promise<{ path: string; lastModified: string }>;
  deleteItem(path: string): Promise<void>;

  // /api/kernels + WebSocket
  startKernel(kernelName?: string): Promise<KernelInfo>;
  getKernelStatus(kernelId: string): Promise<KernelInfo | null>;
  interruptKernel(kernelId: string): Promise<void>;
  restartKernel(kernelId: string): Promise<KernelInfo>;
  shutdownKernel(kernelId: string): Promise<void>;
  executeCode(
    kernelId: string,
    code: string,
    callbacks?: ExecuteCodeCallbacks
  ): Promise<ExecutionResult>;
  disconnectWebSocket(): void;
  onKernelStateChange(listener: (state: KernelState) => void): () => void;
}

interface JupyterWireMessage {
  header: {
    msg_id: string;
    username: string;
    session: string;
    date: string;
    msg_type: string;
    version: string;
  };
  parent_header: {
    msg_id?: string;
  };
  metadata: Record<string, unknown>;
  content: Record<string, unknown>;
  channel?: 'shell' | 'iopub' | 'stdin' | 'control';
  buffers?: unknown[];
}

interface PendingExecution {
  msgId: string;
  outputs: CellOutput[];
  executionCount: number | null;
  hasError: boolean;
  gotShellReply: boolean;
  gotIopubIdle: boolean;
  callbacks?: ExecuteCodeCallbacks;
  resolve: (result: ExecutionResult) => void;
  reject: (err: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

function createUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function encodeJupyterPath(path: string): string {
  const cleaned = path.replace(/^\/+|\/+$/g, '');
  if (!cleaned) return '';
  return cleaned
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function normalizeBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  return trimmed || 'http://localhost:8888';
}

export class JupyterGatewayError extends Error {
  readonly status?: number;
  readonly isNetworkError: boolean;

  constructor(message: string, status?: number, isNetworkError = false) {
    super(message);
    this.name = 'JupyterGatewayError';
    this.status = status;
    this.isNetworkError = isNetworkError;
  }
}

export class JupyterHttpWebSocketGateway implements IJupyterGateway {
  private serverUrl = 'http://localhost:8888';
  private token = '';
  private sessionId = createUuid();
  private ws: WebSocket | null = null;
  private wsKernelId: string | null = null;
  private wsConnectPromise: Promise<WebSocket> | null = null;
  private pendingExecutions = new Map<string, PendingExecution>();
  private kernelListeners = new Set<(state: KernelState) => void>();

  constructor(serverUrl = 'http://localhost:8888', token = '') {
    this.configure(serverUrl, token);
  }

  configure(serverUrl: string, token: string): void {
    const nextUrl = normalizeBaseUrl(serverUrl);
    const nextToken = token.trim();
    if (nextUrl !== this.serverUrl || nextToken !== this.token) {
      this.disconnectWebSocket();
    }
    this.serverUrl = nextUrl;
    this.token = nextToken;
  }

  onKernelStateChange(listener: (state: KernelState) => void): () => void {
    this.kernelListeners.add(listener);
    return () => {
      this.kernelListeners.delete(listener);
    };
  }

  private emitKernelState(state: KernelState): void {
    for (const listener of this.kernelListeners) {
      listener(state);
    }
  }

  private buildHeaders(extra?: HeadersInit): Headers {
    const headers = new Headers(extra);
    if (this.token) {
      headers.set('Authorization', `token ${this.token}`);
    }
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    return headers;
  }

  private async requestJson<T>(
    endpoint: string,
    options: RequestInit = {},
    timeoutMs = 10000
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.serverUrl}${endpoint}`, {
        ...options,
        headers: this.buildHeaders(options.headers),
        signal: controller.signal,
      });

      if (!response.ok) {
        let detail = `HTTP ${response.status}`;
        try {
          const errBody = (await response.json()) as { message?: string };
          if (errBody?.message) detail = `${detail}: ${errBody.message}`;
        } catch {
          // ignore non-JSON error body
        }
        throw new JupyterGatewayError(detail, response.status, false);
      }

      if (response.status === 204) {
        return undefined as T;
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof JupyterGatewayError) {
        throw error;
      }
      const message =
        error instanceof Error ? error.message : 'No se pudo conectar con Jupyter Server';
      throw new JupyterGatewayError(message, undefined, true);
    } finally {
      clearTimeout(timer);
    }
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const apiInfo = await this.requestJson<{ version?: string }>('/api', {
        method: 'GET',
      }, 5000);
      // Verify auth by hitting /api/contents root
      await this.requestJson<JupyterContentItem>('/api/contents?content=0', {
        method: 'GET',
      }, 5000);
      return { ok: true, version: apiInfo.version ?? 'Jupyter Server' };
    } catch (error) {
      const classified = classifyConnectionError(error);
      return {
        ok: false,
        error: classified.message,
        errorKind: classified.kind,
      };
    }
  }

  async listDirectory(path = ''): Promise<JupyterContentItem[]> {
    const encoded = encodeJupyterPath(path);
    const endpoint = encoded
      ? `/api/contents/${encoded}?type=directory&content=1`
      : `/api/contents?type=directory&content=1`;
    const item = await this.requestJson<JupyterContentItem>(endpoint, { method: 'GET' });
    if (!Array.isArray(item.content)) {
      return [];
    }
    return [...item.content].sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') return -1;
      if (a.type !== 'directory' && b.type === 'directory') return 1;
      return a.name.localeCompare(b.name);
    });
  }

  async getNotebook(path: string): Promise<{ notebook: NotebookDocument; lastModified: string }> {
    const encoded = encodeJupyterPath(path);
    const item = await this.requestJson<JupyterContentItem>(
      `/api/contents/${encoded}?type=notebook&content=1`,
      { method: 'GET' }
    );
    const rawContent = item.content as RawNotebookDocumentJson | undefined;
    if (!rawContent || typeof rawContent !== 'object' || Array.isArray(rawContent)) {
      throw new JupyterGatewayError('El archivo no contiene un notebook nbformat v4 válido');
    }
    return {
      notebook: normalizeNotebookDocument(rawContent),
      lastModified: item.last_modified,
    };
  }

  async getNotebookMetadata(path: string): Promise<{ lastModified: string } | null> {
    const encoded = encodeJupyterPath(path);
    try {
      const item = await this.requestJson<JupyterContentItem>(
        `/api/contents/${encoded}?type=notebook&content=0`,
        { method: 'GET' }
      );
      return { lastModified: item.last_modified };
    } catch (error) {
      if (error instanceof JupyterGatewayError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async saveNotebook(
    path: string,
    notebook: NotebookDocument
  ): Promise<{ lastModified: string }> {
    const encoded = encodeJupyterPath(path);
    const payload = {
      type: 'notebook',
      format: 'json',
      content: serializeNotebookDocument(notebook),
    };
    const item = await this.requestJson<JupyterContentItem>(`/api/contents/${encoded}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    return { lastModified: item.last_modified };
  }

  async createNotebook(
    path: string,
    notebook?: NotebookDocument
  ): Promise<{ path: string; lastModified: string }> {
    const normalizedPath = path.endsWith('.ipynb') ? path : `${path}.ipynb`;
    const title = normalizedPath.split('/').pop()?.replace(/\.ipynb$/i, '') || 'Apunte';
    const doc = notebook ?? createEmptyNotebook(title);
    const { lastModified } = await this.saveNotebook(normalizedPath, doc);
    return { path: normalizedPath.replace(/^\/+/, ''), lastModified };
  }

  async renameNotebook(
    oldPath: string,
    newPath: string
  ): Promise<{ path: string; lastModified: string }> {
    const encodedOld = encodeJupyterPath(oldPath);
    const cleanNew = newPath.replace(/^\/+/, '');
    const item = await this.requestJson<JupyterContentItem>(`/api/contents/${encodedOld}`, {
      method: 'PATCH',
      body: JSON.stringify({ path: cleanNew }),
    });
    return { path: item.path, lastModified: item.last_modified };
  }

  async deleteItem(path: string): Promise<void> {
    const encoded = encodeJupyterPath(path);
    await this.requestJson<void>(`/api/contents/${encoded}`, { method: 'DELETE' });
  }

  async startKernel(kernelName = 'python3'): Promise<KernelInfo> {
    this.emitKernelState('CONNECTING');
    try {
      const info = await this.requestJson<KernelInfo>('/api/kernels', {
        method: 'POST',
        body: JSON.stringify({ name: kernelName }),
      });
      await this.ensureWebSocket(info.id);
      this.emitKernelState('IDLE');
      return info;
    } catch (error) {
      this.emitKernelState('DISCONNECTED');
      throw error;
    }
  }

  async getKernelStatus(kernelId: string): Promise<KernelInfo | null> {
    try {
      return await this.requestJson<KernelInfo>(`/api/kernels/${encodeURIComponent(kernelId)}`, {
        method: 'GET',
      });
    } catch (error) {
      if (error instanceof JupyterGatewayError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async interruptKernel(kernelId: string): Promise<void> {
    await this.requestJson<void>(`/api/kernels/${encodeURIComponent(kernelId)}/interrupt`, {
      method: 'POST',
    });
  }

  async restartKernel(kernelId: string): Promise<KernelInfo> {
    this.emitKernelState('CONNECTING');
    this.rejectAllPending('Kernel reiniciado');
    const info = await this.requestJson<KernelInfo>(
      `/api/kernels/${encodeURIComponent(kernelId)}/restart`,
      { method: 'POST' }
    );
    this.disconnectWebSocket();
    await this.ensureWebSocket(info.id);
    this.emitKernelState('IDLE');
    return info;
  }

  async shutdownKernel(kernelId: string): Promise<void> {
    this.rejectAllPending('Kernel apagado');
    this.disconnectWebSocket();
    try {
      await this.requestJson<void>(`/api/kernels/${encodeURIComponent(kernelId)}`, {
        method: 'DELETE',
      });
    } finally {
      this.emitKernelState('DISCONNECTED');
    }
  }

  private buildWebSocketUrl(kernelId: string): string {
    const wsBase = this.serverUrl.replace(/^http/i, 'ws');
    const params = new URLSearchParams();
    params.set('session_id', this.sessionId);
    if (this.token) {
      params.set('token', this.token);
    }
    return `${wsBase}/api/kernels/${encodeURIComponent(kernelId)}/channels?${params.toString()}`;
  }

  private async ensureWebSocket(kernelId: string): Promise<WebSocket> {
    if (
      this.ws &&
      this.wsKernelId === kernelId &&
      this.ws.readyState === WebSocket.OPEN
    ) {
      return this.ws;
    }

    if (this.wsConnectPromise && this.wsKernelId === kernelId) {
      return this.wsConnectPromise;
    }

    if (this.ws && this.wsKernelId !== kernelId) {
      this.disconnectWebSocket();
    }

    this.wsKernelId = kernelId;
    const url = this.buildWebSocketUrl(kernelId);

    this.wsConnectPromise = new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(url);
      let settled = false;

      const connectTimeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          socket.close();
          reject(new JupyterGatewayError('Tiempo de espera agotado al abrir WebSocket del kernel', undefined, true));
        }
      }, 10000);

      socket.onopen = () => {
        clearTimeout(connectTimeout);
        settled = true;
        this.ws = socket;
        this.wsConnectPromise = null;
        this.emitKernelState('IDLE');
        resolve(socket);
      };

      socket.onmessage = (event) => {
        this.handleSocketMessage(event.data);
      };

      socket.onerror = () => {
        if (!settled) {
          clearTimeout(connectTimeout);
          settled = true;
          this.wsConnectPromise = null;
          this.emitKernelState('DEAD');
          reject(new JupyterGatewayError('Error de conexión WebSocket con el kernel', undefined, true));
        }
      };

      socket.onclose = () => {
        clearTimeout(connectTimeout);
        this.wsConnectPromise = null;
        if (this.ws === socket) {
          this.ws = null;
          this.rejectAllPending('Conexión WebSocket cerrada');
          this.emitKernelState('DISCONNECTED');
        }
      };
    });

    return this.wsConnectPromise;
  }

  disconnectWebSocket(): void {
    this.rejectAllPending('WebSocket desconectado');
    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      this.wsKernelId = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.onmessage = null;
      socket.close();
    }
    this.wsConnectPromise = null;
  }

  private rejectAllPending(reason: string): void {
    for (const [msgId, pending] of this.pendingExecutions.entries()) {
      clearTimeout(pending.timeoutId);
      pending.reject(new JupyterGatewayError(reason, undefined, true));
      this.pendingExecutions.delete(msgId);
    }
  }

  async executeCode(
    kernelId: string,
    code: string,
    callbacks?: ExecuteCodeCallbacks
  ): Promise<ExecutionResult> {
    const socket = await this.ensureWebSocket(kernelId);
    const msgId = createUuid();

    const message: JupyterWireMessage = {
      header: {
        msg_id: msgId,
        username: 'notelab',
        session: this.sessionId,
        date: new Date().toISOString(),
        msg_type: 'execute_request',
        version: '5.3',
      },
      parent_header: {},
      metadata: {},
      content: {
        code,
        silent: false,
        store_history: true,
        user_expressions: {},
        allow_stdin: Boolean(callbacks?.onInputRequest),
        stop_on_error: true,
      },
      channel: 'shell',
    };

    return new Promise<ExecutionResult>((resolve, reject) => {
      const startTimeout = () =>
        setTimeout(() => {
          const pending = this.pendingExecutions.get(msgId);
          if (pending) {
            this.pendingExecutions.delete(msgId);
            reject(new JupyterGatewayError('Tiempo de ejecución excedido (60s)'));
          }
        }, 60000);

      const timeoutId = startTimeout();

      this.pendingExecutions.set(msgId, {
        msgId,
        outputs: [],
        executionCount: null,
        hasError: false,
        gotShellReply: false,
        gotIopubIdle: false,
        callbacks,
        resolve,
        reject,
        timeoutId,
      });

      this.emitKernelState('BUSY');
      socket.send(JSON.stringify(message));
    });
  }

  private handleSocketMessage(rawData: unknown): void {
    if (typeof rawData !== 'string') return;
    let msg: JupyterWireMessage;
    try {
      msg = JSON.parse(rawData) as JupyterWireMessage;
    } catch {
      return;
    }

    const msgType = msg.header?.msg_type;
    const parentMsgId = msg.parent_header?.msg_id;

    if (msgType === 'status') {
      const executionState = msg.content?.execution_state as string | undefined;
      if (executionState === 'busy') {
        this.emitKernelState('BUSY');
      } else if (executionState === 'idle') {
        this.emitKernelState('IDLE');
      } else if (executionState === 'dead') {
        this.emitKernelState('DEAD');
      }
    }

    if (!parentMsgId) return;
    const pending = this.pendingExecutions.get(parentMsgId);
    if (!pending) return;

    switch (msgType) {
      case 'execute_input': {
        const count = msg.content?.execution_count;
        if (typeof count === 'number') {
          pending.executionCount = count;
        }
        break;
      }

      case 'stream': {
        const name = (msg.content?.name === 'stderr' ? 'stderr' : 'stdout') as 'stdout' | 'stderr';
        const text = String(msg.content?.text ?? '');
        const last = pending.outputs[pending.outputs.length - 1];
        if (last && last.output_type === 'stream' && last.name === name) {
          last.text = `${typeof last.text === 'string' ? last.text : last.text.join('')}${text}`;
        } else {
          pending.outputs.push({
            output_type: 'stream',
            name,
            text,
          });
        }
        pending.callbacks?.onOutput?.([...pending.outputs], pending.executionCount);
        break;
      }

      case 'execute_result': {
        const count =
          typeof msg.content?.execution_count === 'number'
            ? msg.content.execution_count
            : pending.executionCount;
        pending.executionCount = count;
        pending.outputs.push({
          output_type: 'execute_result',
          execution_count: count,
          data: (msg.content?.data as CellOutput extends { data: infer D } ? D : never) ?? {},
          metadata: (msg.content?.metadata as Record<string, unknown>) ?? {},
        });
        pending.callbacks?.onOutput?.([...pending.outputs], pending.executionCount);
        break;
      }

      case 'display_data': {
        pending.outputs.push({
          output_type: 'display_data',
          data: (msg.content?.data as CellOutput extends { data: infer D } ? D : never) ?? {},
          metadata: (msg.content?.metadata as Record<string, unknown>) ?? {},
        });
        pending.callbacks?.onOutput?.([...pending.outputs], pending.executionCount);
        break;
      }

      case 'clear_output': {
        pending.outputs = [];
        pending.callbacks?.onOutput?.([], pending.executionCount);
        break;
      }

      case 'error': {
        pending.hasError = true;
        pending.outputs.push({
          output_type: 'error',
          ename: String(msg.content?.ename ?? 'Error'),
          evalue: String(msg.content?.evalue ?? ''),
          traceback: Array.isArray(msg.content?.traceback)
            ? msg.content.traceback.map(String)
            : [],
        });
        pending.callbacks?.onOutput?.([...pending.outputs], pending.executionCount);
        break;
      }

      case 'execute_reply': {
        pending.gotShellReply = true;
        if (typeof msg.content?.execution_count === 'number') {
          pending.executionCount = msg.content.execution_count;
        }
        if (msg.content?.status === 'error') {
          pending.hasError = true;
        }
        this.tryResolvePending(pending);
        break;
      }

      case 'status': {
        if (msg.content?.execution_state === 'idle') {
          pending.gotIopubIdle = true;
          this.tryResolvePending(pending);
        }
        break;
      }

      case 'input_request': {
        const prompt = String(msg.content?.prompt ?? '');
        const password = Boolean(msg.content?.password);

        const sendInputReply = (value: string) => {
          if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
          const reply = {
            header: {
              msg_id: createUuid(),
              username: 'notelab',
              session: this.sessionId,
              date: new Date().toISOString(),
              msg_type: 'input_reply',
              version: '5.3',
            },
            parent_header: msg.header,
            metadata: {},
            content: { value },
            channel: 'stdin',
          };
          this.ws.send(JSON.stringify(reply));
        };

        if (!pending.callbacks?.onInputRequest) {
          sendInputReply('');
          break;
        }

        // Pause timeout while waiting for user stdin input
        clearTimeout(pending.timeoutId);
        let answered = false;

        const resumeTimeout = () => {
          pending.timeoutId = setTimeout(() => {
            const p = this.pendingExecutions.get(pending.msgId);
            if (p) {
              this.pendingExecutions.delete(pending.msgId);
              p.reject(new JupyterGatewayError('Tiempo de ejecución excedido (60s)'));
            }
          }, 60000);
        };

        pending.callbacks.onInputRequest({
          prompt,
          password,
          submit: (value: string) => {
            if (answered) return;
            answered = true;
            resumeTimeout();
            sendInputReply(value);
          },
          cancel: () => {
            if (answered) return;
            answered = true;
            resumeTimeout();
            if (this.wsKernelId) {
              void this.interruptKernel(this.wsKernelId).catch(() => sendInputReply(''));
            } else {
              sendInputReply('');
            }
          },
        });
        break;
      }

      default:
        break;
    }
  }

  private tryResolvePending(pending: PendingExecution): void {
    if (pending.gotShellReply && pending.gotIopubIdle) {
      clearTimeout(pending.timeoutId);
      this.pendingExecutions.delete(pending.msgId);
      pending.resolve({
        executionCount: pending.executionCount,
        outputs: pending.outputs,
        hasError: pending.hasError,
      });
    }
  }
}
