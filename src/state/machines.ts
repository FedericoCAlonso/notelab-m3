/**
 * Finite State Machines (FSM) for Cells and Jupyter Kernel.
 * Guarantees deterministic state transitions and ordered execution queuing.
 */

export type CellState = 'VIEWING' | 'EDITING' | 'QUEUED' | 'RUNNING' | 'ERROR';

export type CellEvent =
  | { type: 'ENTER_EDIT' }
  | { type: 'EXIT_EDIT' }
  | { type: 'ENQUEUE_EXECUTION' }
  | { type: 'START_EXECUTION' }
  | { type: 'EXECUTION_SUCCESS' }
  | { type: 'EXECUTION_ERROR' }
  | { type: 'CANCEL_EXECUTION' }
  | { type: 'RESET' };

export function transitionCellState(current: CellState, event: CellEvent): CellState {
  switch (event.type) {
    case 'ENTER_EDIT':
      if (current === 'VIEWING' || current === 'ERROR') {
        return 'EDITING';
      }
      return current;

    case 'EXIT_EDIT':
      if (current === 'EDITING') {
        return 'VIEWING';
      }
      return current;

    case 'ENQUEUE_EXECUTION':
      if (current === 'VIEWING' || current === 'EDITING' || current === 'ERROR') {
        return 'QUEUED';
      }
      return current;

    case 'START_EXECUTION':
      if (current === 'QUEUED' || current === 'VIEWING' || current === 'EDITING' || current === 'ERROR') {
        return 'RUNNING';
      }
      return current;

    case 'EXECUTION_SUCCESS':
      if (current === 'RUNNING' || current === 'QUEUED') {
        return 'VIEWING';
      }
      return current;

    case 'EXECUTION_ERROR':
      if (current === 'RUNNING' || current === 'QUEUED') {
        return 'ERROR';
      }
      return current;

    case 'CANCEL_EXECUTION':
      if (current === 'QUEUED' || current === 'RUNNING') {
        return 'VIEWING';
      }
      return current;

    case 'RESET':
      return 'VIEWING';

    default:
      return current;
  }
}

export type KernelState =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'IDLE'
  | 'BUSY'
  | 'DEAD';

export type KernelEvent =
  | { type: 'CONNECT' }
  | { type: 'CONNECTED' }
  | { type: 'STATUS_IDLE' }
  | { type: 'STATUS_BUSY' }
  | { type: 'DISCONNECT' }
  | { type: 'KERNEL_DIED' }
  | { type: 'RESTART' };

export function transitionKernelState(current: KernelState, event: KernelEvent): KernelState {
  switch (event.type) {
    case 'CONNECT':
      if (current === 'DISCONNECTED' || current === 'DEAD') {
        return 'CONNECTING';
      }
      return current;

    case 'CONNECTED':
      if (current === 'CONNECTING' || current === 'DISCONNECTED' || current === 'DEAD') {
        return 'IDLE';
      }
      return current;

    case 'STATUS_BUSY':
      if (current === 'IDLE' || current === 'CONNECTING') {
        return 'BUSY';
      }
      return current;

    case 'STATUS_IDLE':
      if (current === 'BUSY' || current === 'CONNECTING') {
        return 'IDLE';
      }
      return current;

    case 'RESTART':
      return 'CONNECTING';

    case 'KERNEL_DIED':
      return 'DEAD';

    case 'DISCONNECT':
      return 'DISCONNECTED';

    default:
      return current;
  }
}

/**
 * Ordered execution queue manager for rapid Shift+Enter runs across multiple cells.
 */
export interface ExecutionQueueState {
  cellStates: Record<string, CellState>;
  queue: string[];
  activeCellId: string | null;
}

export function createInitialExecutionQueueState(): ExecutionQueueState {
  return {
    cellStates: {},
    queue: [],
    activeCellId: null,
  };
}

export function getCellState(state: ExecutionQueueState, cellId: string): CellState {
  return state.cellStates[cellId] ?? 'VIEWING';
}

export function enqueueCellForExecution(
  state: ExecutionQueueState,
  cellId: string
): ExecutionQueueState {
  const alreadyQueued = state.queue.includes(cellId) || state.activeCellId === cellId;
  if (alreadyQueued) {
    return state;
  }

  const nextCellState = transitionCellState(getCellState(state, cellId), {
    type: 'ENQUEUE_EXECUTION',
  });

  return {
    ...state,
    cellStates: {
      ...state.cellStates,
      [cellId]: nextCellState,
    },
    queue: [...state.queue, cellId],
  };
}

export function dequeueNextCellForExecution(state: ExecutionQueueState): {
  nextState: ExecutionQueueState;
  cellId: string | null;
} {
  if (state.activeCellId !== null || state.queue.length === 0) {
    return { nextState: state, cellId: null };
  }

  const [head, ...rest] = state.queue;
  if (!head) {
    return { nextState: state, cellId: null };
  }

  return {
    cellId: head,
    nextState: {
      ...state,
      activeCellId: head,
      queue: rest,
      cellStates: {
        ...state.cellStates,
        [head]: transitionCellState(getCellState(state, head), {
          type: 'START_EXECUTION',
        }),
      },
    },
  };
}

export function finishCellExecution(
  state: ExecutionQueueState,
  cellId: string,
  hasError: boolean
): ExecutionQueueState {
  const nextCellState = transitionCellState(getCellState(state, cellId), {
    type: hasError ? 'EXECUTION_ERROR' : 'EXECUTION_SUCCESS',
  });

  return {
    ...state,
    activeCellId: state.activeCellId === cellId ? null : state.activeCellId,
    cellStates: {
      ...state.cellStates,
      [cellId]: nextCellState,
    },
  };
}

export function clearExecutionQueue(state: ExecutionQueueState): ExecutionQueueState {
  const updatedStates: Record<string, CellState> = { ...state.cellStates };
  for (const id of state.queue) {
    updatedStates[id] = transitionCellState(updatedStates[id] ?? 'VIEWING', {
      type: 'CANCEL_EXECUTION',
    });
  }
  if (state.activeCellId) {
    updatedStates[state.activeCellId] = transitionCellState(
      updatedStates[state.activeCellId] ?? 'VIEWING',
      { type: 'CANCEL_EXECUTION' }
    );
  }
  return {
    cellStates: updatedStates,
    queue: [],
    activeCellId: null,
  };
}
