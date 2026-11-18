/**
 * Strict nbformat v4 + Jupyter Server REST/WebSocket domain types.
 */

export type MultilineString = string | string[];

export interface MimeBundle {
  'text/plain'?: MultilineString;
  'text/html'?: MultilineString;
  'image/png'?: string;
  'image/jpeg'?: string;
  'image/svg+xml'?: MultilineString;
  'application/json'?: unknown;
  [mimeType: string]: unknown;
}

export interface StreamOutput {
  output_type: 'stream';
  name: 'stdout' | 'stderr';
  text: MultilineString;
}

export interface ExecuteResultOutput {
  output_type: 'execute_result';
  execution_count: number | null;
  data: MimeBundle;
  metadata: Record<string, unknown>;
}

export interface DisplayDataOutput {
  output_type: 'display_data';
  data: MimeBundle;
  metadata: Record<string, unknown>;
}

export interface ErrorOutput {
  output_type: 'error';
  ename: string;
  evalue: string;
  traceback: string[];
}

export type CellOutput =
  | StreamOutput
  | ExecuteResultOutput
  | DisplayDataOutput
  | ErrorOutput;

export type CellType = 'markdown' | 'code' | 'raw';

export interface CellMetadata {
  collapsed?: boolean;
  scrolled?: boolean;
  /** NoteLab M3 progressive output disclosure: hides code editor/source in viewing mode */
  notelab_hide_source?: boolean;
  [key: string]: unknown;
}

export interface BaseCell {
  id: string;
  cell_type: CellType;
  metadata: CellMetadata;
  source: string;
}

export type CellAttachments = Record<string, Record<string, string>>;

export interface MarkdownCell extends BaseCell {
  cell_type: 'markdown';
  attachments?: CellAttachments;
}

export interface CodeCell extends BaseCell {
  cell_type: 'code';
  execution_count: number | null;
  outputs: CellOutput[];
}

export interface RawCell extends BaseCell {
  cell_type: 'raw';
}

export type NotebookCell = MarkdownCell | CodeCell | RawCell;

export interface NotebookMetadata {
  kernelspec?: {
    display_name: string;
    language: string;
    name: string;
  };
  language_info?: {
    name: string;
    version?: string;
    mimetype?: string;
    file_extension?: string;
  };
  [key: string]: unknown;
}

export interface NotebookDocument {
  nbformat: 4;
  nbformat_minor: number;
  metadata: NotebookMetadata;
  cells: NotebookCell[];
}

/** Raw JSON shape as received from Jupyter /api/contents */
export interface RawNotebookCellJson {
  id?: string;
  cell_type: CellType;
  metadata?: Record<string, unknown>;
  source: MultilineString;
  execution_count?: number | null;
  outputs?: CellOutput[];
  attachments?: CellAttachments;
}

export interface RawNotebookDocumentJson {
  nbformat?: number;
  nbformat_minor?: number;
  metadata?: NotebookMetadata;
  cells?: RawNotebookCellJson[];
}

export interface JupyterContentItem {
  name: string;
  path: string;
  type: 'directory' | 'notebook' | 'file';
  writable: boolean;
  created: string;
  last_modified: string;
  size?: number | null;
  mimetype?: string | null;
  content?: JupyterContentItem[] | RawNotebookDocumentJson | string | null;
}

export interface KernelInfo {
  id: string;
  name: string;
  last_activity: string;
  execution_state: 'starting' | 'idle' | 'busy' | 'restarting' | 'autorestarting' | 'dead';
  connections: number;
}

export type ThemePreference = 'auto' | 'light' | 'dark';

export interface CloudSyncSettings {
  enabled: boolean;
  provider: 'github';
  owner: string;
  repo: string;
  branch: string;
  basePath: string;
  token: string;
}

export interface ConnectionSettings {
  serverUrl: string;
  token: string;
  theme: ThemePreference;
  lastOpenedPath: string | null;
  cloud?: CloudSyncSettings;
}

export type SyncTarget = 'jupyter' | 'cloud';

export type SyncStatus = 'synced' | 'saving' | 'pending' | 'offline' | 'error' | 'conflict';

export function normalizeMultiline(value: MultilineString | undefined | null): string {
  if (value == null) return '';
  return Array.isArray(value) ? value.join('') : value;
}

export function generateCellId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  }
  return `nl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createMarkdownCell(source = '', id = generateCellId()): MarkdownCell {
  return {
    id,
    cell_type: 'markdown',
    metadata: {},
    source,
  };
}

export function createCodeCell(source = '', id = generateCellId()): CodeCell {
  return {
    id,
    cell_type: 'code',
    metadata: {},
    source,
    execution_count: null,
    outputs: [],
  };
}

export function createEmptyNotebook(title = 'Apunte sin título'): NotebookDocument {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: {
        display_name: 'Python 3 (ipykernel)',
        language: 'python',
        name: 'python3',
      },
      language_info: {
        name: 'python',
        mimetype: 'text/x-python',
        file_extension: '.py',
      },
    },
    cells: [
      createMarkdownCell(`# ${title}\n\nPresiona \`Enter\` para editar esta celda, \`Ctrl + Enter\` para renderizar o \`Shift + Enter\` para continuar a la siguiente.`),
      createCodeCell('# Celda Python — Ctrl + Enter para ejecutar\nimport math\nprint(f"Euler: {math.e:.4f}")'),
    ],
  };
}

export function normalizeNotebookDocument(raw: RawNotebookDocumentJson): NotebookDocument {
  const cells: NotebookCell[] = (raw.cells ?? []).map((cell) => {
    const id = cell.id && cell.id.trim().length > 0 ? cell.id : generateCellId();
    const metadata: CellMetadata = { ...(cell.metadata ?? {}) };
    const source = normalizeMultiline(cell.source);

    if (cell.cell_type === 'code') {
      return {
        id,
        cell_type: 'code',
        metadata,
        source,
        execution_count: cell.execution_count ?? null,
        outputs: Array.isArray(cell.outputs) ? cell.outputs : [],
      };
    }

    if (cell.cell_type === 'raw') {
      return {
        id,
        cell_type: 'raw',
        metadata,
        source,
      };
    }

    return {
      id,
      cell_type: 'markdown',
      metadata,
      source,
      ...(cell.attachments && typeof cell.attachments === 'object'
        ? { attachments: cell.attachments }
        : {}),
    };
  });

  if (cells.length === 0) {
    cells.push(createMarkdownCell(''));
  }

  return {
    nbformat: 4,
    nbformat_minor: raw.nbformat_minor ?? 5,
    metadata: raw.metadata ?? {
      kernelspec: {
        display_name: 'Python 3 (ipykernel)',
        language: 'python',
        name: 'python3',
      },
    },
    cells,
  };
}

export function serializeNotebookDocument(doc: NotebookDocument): RawNotebookDocumentJson {
  return {
    nbformat: 4,
    nbformat_minor: doc.nbformat_minor || 5,
    metadata: doc.metadata,
    cells: doc.cells.map((cell) => {
      if (cell.cell_type === 'code') {
        return {
          id: cell.id,
          cell_type: 'code',
          metadata: cell.metadata,
          source: cell.source,
          execution_count: cell.execution_count,
          outputs: cell.outputs,
        };
      }
      return {
        id: cell.id,
        cell_type: cell.cell_type,
        metadata: cell.metadata,
        source: cell.source,
        ...(cell.cell_type === 'markdown' && cell.attachments
          ? { attachments: cell.attachments }
          : {}),
      };
    }),
  };
}
