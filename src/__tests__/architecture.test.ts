import { describe, expect, it, vi } from 'vitest';
import {
  normalizeNotebookDocument,
  serializeNotebookDocument,
  createCodeCell,
  createMarkdownCell,
} from '../types/nbformat';
import {
  clearExecutionQueue,
  createInitialExecutionQueueState,
  dequeueNextCellForExecution,
  enqueueCellForExecution,
  finishCellExecution,
  getCellState,
  transitionCellState,
  transitionKernelState,
} from '../state/machines';
import { CommandRegistry } from '../commands/CommandRegistry';
import { SyncEngine } from '../services/sync/SyncEngine';
import {
  INotebookStorage,
  OutboxItem,
  StoredNotebookRecord,
  DEFAULT_CONNECTION_SETTINGS,
} from '../services/storage/NotebookDB';
import { IJupyterGateway, JupyterGatewayError } from '../services/jupyter/JupyterGateway';

describe('nbformat v4 serialization', () => {
  it('normalizes array sources and preserves metadata, execution_count and outputs', () => {
    const raw = {
      nbformat: 4,
      nbformat_minor: 5,
      metadata: {
        kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
        custom_flag: true,
      },
      cells: [
        {
          id: 'md1',
          cell_type: 'markdown' as const,
          metadata: { tags: ['intro'] },
          source: ['# Hola\n', 'Mundo'],
        },
        {
          id: 'py1',
          cell_type: 'code' as const,
          metadata: { notelab_hide_source: true },
          source: ['print(42)'],
          execution_count: 7,
          outputs: [
            { output_type: 'stream' as const, name: 'stdout' as const, text: '42\n' },
          ],
        },
      ],
    };

    const doc = normalizeNotebookDocument(raw);
    expect(doc.nbformat).toBe(4);
    expect(doc.cells[0]?.source).toBe('# Hola\nMundo');
    expect(doc.cells[1]?.cell_type).toBe('code');
    if (doc.cells[1]?.cell_type === 'code') {
      expect(doc.cells[1].execution_count).toBe(7);
      expect(doc.cells[1].outputs).toHaveLength(1);
    }

    const roundTrip = serializeNotebookDocument(doc);
    expect(roundTrip.metadata?.custom_flag).toBe(true);
    expect(roundTrip.cells?.[1]?.metadata?.notelab_hide_source).toBe(true);
  });
});

describe('Finite State Machines (Cell, Kernel & Execution Queue)', () => {
  it('transitions cell states deterministically', () => {
    let s = transitionCellState('VIEWING', { type: 'ENTER_EDIT' });
    expect(s).toBe('EDITING');
    s = transitionCellState(s, { type: 'ENQUEUE_EXECUTION' });
    expect(s).toBe('QUEUED');
    s = transitionCellState(s, { type: 'START_EXECUTION' });
    expect(s).toBe('RUNNING');
    s = transitionCellState(s, { type: 'EXECUTION_ERROR' });
    expect(s).toBe('ERROR');
    s = transitionCellState(s, { type: 'ENTER_EDIT' });
    expect(s).toBe('EDITING');
    s = transitionCellState(s, { type: 'EXIT_EDIT' });
    expect(s).toBe('VIEWING');
  });

  it('transitions kernel states deterministically', () => {
    let k = transitionKernelState('DISCONNECTED', { type: 'CONNECT' });
    expect(k).toBe('CONNECTING');
    k = transitionKernelState(k, { type: 'CONNECTED' });
    expect(k).toBe('IDLE');
    k = transitionKernelState(k, { type: 'STATUS_BUSY' });
    expect(k).toBe('BUSY');
    k = transitionKernelState(k, { type: 'STATUS_IDLE' });
    expect(k).toBe('IDLE');
    k = transitionKernelState(k, { type: 'KERNEL_DIED' });
    expect(k).toBe('DEAD');
  });

  it('processes queued cells in strict FIFO order without overlapping', () => {
    let q = createInitialExecutionQueueState();
    q = enqueueCellForExecution(q, 'cell-1');
    q = enqueueCellForExecution(q, 'cell-2');
    expect(getCellState(q, 'cell-1')).toBe('QUEUED');
    expect(getCellState(q, 'cell-2')).toBe('QUEUED');

    const step1 = dequeueNextCellForExecution(q);
    expect(step1.cellId).toBe('cell-1');
    q = step1.nextState;
    expect(getCellState(q, 'cell-1')).toBe('RUNNING');

    // Second dequeue while active must return null
    const blocked = dequeueNextCellForExecution(q);
    expect(blocked.cellId).toBeNull();

    q = finishCellExecution(q, 'cell-1', false);
    expect(getCellState(q, 'cell-1')).toBe('VIEWING');

    const step2 = dequeueNextCellForExecution(q);
    expect(step2.cellId).toBe('cell-2');
    q = clearExecutionQueue(step2.nextState);
    expect(q.activeCellId).toBeNull();
    expect(q.queue).toHaveLength(0);
  });
});

describe('CommandRegistry (Android Physical Keyboard)', () => {
  it('routes VIEWING vs EDITING shortcuts cleanly without relying on Esc', () => {
    const registry = new CommandRegistry();
    const calls: string[] = [];

    registry.registerMany([
      {
        id: 'cell.enterEdit',
        label: 'Edit',
        description: '',
        shortcutDisplay: 'Enter',
        bindings: [{ key: 'Enter', whenMode: 'VIEWING' }],
        execute: () => {
          calls.push('enterEdit');
        },
      },
      {
        id: 'cell.runAndStay',
        label: 'Run',
        description: '',
        shortcutDisplay: 'Ctrl+Enter',
        bindings: [{ key: 'Enter', ctrl: true, whenMode: 'ANY' }],
        execute: () => {
          calls.push('runAndStay');
        },
      },
      {
        id: 'cell.moveUp',
        label: 'Up',
        description: '',
        shortcutDisplay: 'Alt+ArrowUp',
        bindings: [{ key: 'ArrowUp', alt: true, whenMode: 'ANY' }],
        execute: () => {
          calls.push('moveUp');
        },
      },
    ]);

    const baseCtx = {
      activeCellId: 'c1',
      activeCellState: 'VIEWING' as const,
      isModalOpen: false,
      isTitleEditing: false,
      isTextInputFocused: false,
    };

    expect(
      registry.handleKeyEvent(
        { key: 'Enter', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false },
        baseCtx
      )
    ).toBe('cell.enterEdit');

    // In EDITING mode, plain Enter must NOT trigger enterEdit
    expect(
      registry.handleKeyEvent(
        { key: 'Enter', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false },
        { ...baseCtx, activeCellState: 'EDITING' }
      )
    ).toBeNull();

    // In EDITING mode, Ctrl+Enter triggers runAndStay
    expect(
      registry.handleKeyEvent(
        { key: 'Enter', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false },
        { ...baseCtx, activeCellState: 'EDITING' }
      )
    ).toBe('cell.runAndStay');

    // Alt+ArrowUp works in EDITING mode
    expect(
      registry.handleKeyEvent(
        { key: 'ArrowUp', ctrlKey: false, metaKey: false, shiftKey: false, altKey: true },
        { ...baseCtx, activeCellState: 'EDITING' }
      )
    ).toBe('cell.moveUp');

    expect(calls).toEqual(['enterEdit', 'runAndStay', 'moveUp']);
  });
});

describe('SyncEngine (Local-First + Outbox)', () => {
  function createMemoryStorage(): INotebookStorage {
    const notebooks = new Map<string, StoredNotebookRecord>();
    const outbox = new Map<string, OutboxItem>();
    let settings = DEFAULT_CONNECTION_SETTINGS;

    return {
      getNotebook: async (path) => notebooks.get(path),
      putNotebook: async (rec) => {
        notebooks.set(rec.path, rec);
      },
      deleteNotebook: async (path) => {
        notebooks.delete(path);
      },
      listAllNotebooks: async () => Array.from(notebooks.values()),
      getOutboxItem: async (path) => outbox.get(path),
      putOutboxItem: async (item) => {
        outbox.set(item.path, item);
      },
      deleteOutboxItem: async (path) => {
        outbox.delete(path);
      },
      listOutboxItems: async () => Array.from(outbox.values()),
      getSettings: async () => settings,
      saveSettings: async (next) => {
        settings = next;
      },
    };
  }

  it('writes immediately to local storage and retries via outbox when server is unreachable', async () => {
    const storage = createMemoryStorage();
    let shouldFail = true;

    const mockGateway = {
      saveNotebook: vi.fn(async () => {
        if (shouldFail) {
          throw new JupyterGatewayError('Termux suspended', undefined, true);
        }
        return { lastModified: '2026-11-12T20:00:00Z' };
      }),
    } as unknown as IJupyterGateway;

    const engine = new SyncEngine(storage, mockGateway);
    const doc = {
      nbformat: 4 as const,
      nbformat_minor: 5,
      metadata: {},
      cells: [createMarkdownCell('# Clase 1'), createCodeCell('x = 1')],
    };

    const failRes = await engine.forceSync('clase1.ipynb', doc);
    expect(failRes.ok).toBe(false);
    expect(failRes.offline).toBe(true);

    const savedLocal = await storage.getNotebook('clase1.ipynb');
    expect(savedLocal?.pendingSync).toBe(true);
    const queued = await storage.getOutboxItem('clase1.ipynb');
    expect(queued?.retryCount).toBe(1);

    // Termux wakes up -> retry succeeds
    shouldFail = false;
    await storage.putOutboxItem({ ...queued!, nextRetryAt: Date.now() - 10 });
    await engine.flushOutbox();

    const syncedLocal = await storage.getNotebook('clase1.ipynb');
    expect(syncedLocal?.pendingSync).toBe(false);
    expect(await storage.getOutboxItem('clase1.ipynb')).toBeUndefined();

    engine.destroy();
  });
});
