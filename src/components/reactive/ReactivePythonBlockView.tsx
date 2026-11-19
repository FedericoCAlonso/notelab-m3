import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Eye,
  EyeOff,
  Loader2,
  Play,
  RefreshCw,
} from 'lucide-react';
import { CodeBlock } from '../../engine/parser/types';
import { parsePythonBlockVisibility } from '../../engine/python/reactivePythonBridge';
import { CellOutput } from '../../types/nbformat';
import { CellOutputRenderer } from '../CellOutputRenderer';

export interface ReactivePythonRunState {
  running: boolean;
  outputs: CellOutput[];
  hasError: boolean;
  lastBridgeHash: string | null;
  lastRunCode: string | null;
  fromCache?: boolean;
  errorMessage?: string;
}

interface ReactivePythonBlockViewProps {
  block: CodeBlock;
  viewMode: 'author' | 'deliverable';
  runState?: ReactivePythonRunState;
  currentBridgeHash: string;
  bridgedSymbolCount: number;
  bridgedTableCount: number;
  onRun: () => void;
  onInstallModule?: (moduleName: string) => void;
}

export const ReactivePythonBlockView: React.FC<ReactivePythonBlockViewProps> = ({
  block,
  viewMode,
  runState,
  currentBridgeHash,
  bridgedSymbolCount,
  bridgedTableCount,
  onRun,
  onInstallModule,
}) => {
  const [hideSourceInAuthor, setHideSourceInAuthor] = useState(false);

  const visibility = parsePythonBlockVisibility(block.meta);
  const outputs = runState?.outputs ?? [];
  const isRunning = Boolean(runState?.running);
  const hasRunBefore = runState?.lastBridgeHash !== null && runState?.lastBridgeHash !== undefined;
  const isStale =
    hasRunBefore &&
    (runState?.lastBridgeHash !== currentBridgeHash ||
      runState?.lastRunCode !== block.content);

  // Deliverable / Print mode visibility rules
  if (viewMode === 'deliverable') {
    if (visibility === 'hidden') return null;
    if (visibility === 'output-only' && outputs.length === 0) return null;

    return (
      <div className="reactive-python-block break-inside-avoid my-2">
        {visibility === 'show-code' && (
          <pre className="notelab-mono-block rounded-xl border border-outline-variant/50 bg-surface-container-low px-3 py-2 text-xs font-mono overflow-x-auto mb-2">
            {block.content}
          </pre>
        )}
        {outputs.length > 0 && (
          <CellOutputRenderer outputs={outputs} onInstallModule={onInstallModule} />
        )}
      </div>
    );
  }

  return (
    <div className="reactive-python-block break-inside-avoid rounded-2xl border border-outline-variant/60 bg-surface-container-lowest/90 overflow-hidden">
      {/* Header toolbar (hidden on print) */}
      <div
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        className="no-print flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-surface-container-low/90 border-b border-outline-variant/40 text-xs"
      >
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <span className="inline-flex items-center gap-1 font-mono font-semibold text-primary">
            <Cpu className="w-3.5 h-3.5" />
            <span>Python</span>
          </span>

          {(bridgedSymbolCount > 0 || bridgedTableCount > 0) && (
            <span
              className="text-[11px] text-on-surface-variant px-2 py-0.5 rounded-full bg-surface-container-high/80"
              title="Variables y tablas del documento .md inyectadas automáticamente en Python (tablas como pandas.DataFrame)"
            >
              Puente: {bridgedSymbolCount} vars
              {bridgedTableCount > 0 ? ` · ${bridgedTableCount} tbl` : ''}
            </span>
          )}

          {visibility === 'hidden' && (
            <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full bg-surface-container-highest text-on-surface-variant">
              <EyeOff className="w-3 h-3" />
              oculto
            </span>
          )}

          {isStale && !isRunning && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-warning-container text-on-warning-container">
              <RefreshCw className="w-3 h-3" />
              Datos actualizados
            </span>
          )}

          {runState?.fromCache && !isStale && !isRunning && (
            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-surface-container-highest text-on-surface-variant">
              Caché local
            </span>
          )}

          {hasRunBefore && !isStale && !isRunning && !runState?.hasError && !runState?.fromCache && (
            <span className="inline-flex items-center gap-1 text-[11px] text-on-success-container">
              <CheckCircle2 className="w-3 h-3 text-success" />
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setHideSourceInAuthor((prev) => !prev)}
            title={hideSourceInAuthor ? 'Mostrar código Python' : 'Ocultar código Python'}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] text-on-surface-variant hover:bg-surface-container-high transition-colors"
          >
            {hideSourceInAuthor ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          </button>

          <button
            type="button"
            disabled={isRunning}
            onClick={onRun}
            className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-primary text-on-primary text-xs font-medium hover:opacity-95 transition-opacity disabled:opacity-60"
          >
            {isRunning ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Ejecutando</span>
              </>
            ) : (
              <>
                <Play className="w-3 h-3 fill-current" />
                <span>{isStale ? 'Re-ejecutar' : 'Ejecutar'}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Python Source Preview */}
      {!hideSourceInAuthor && (
        <pre className="notelab-mono-block px-3.5 py-2.5 text-[13.5px] leading-relaxed font-mono overflow-x-auto text-on-surface m-0">
          {block.content}
        </pre>
      )}

      {/* Connection / execution error */}
      {runState?.errorMessage && (
        <div className="mx-3 mb-2.5 flex items-start gap-2 rounded-xl bg-error-container/75 text-on-error-container px-3 py-2 text-xs">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{runState.errorMessage}</span>
        </div>
      )}

      {/* Outputs (matplotlib PNG/SVG, pandas HTML DataFrames, stdout/stderr, pip install) */}
      {outputs.length > 0 && (
        <div className="px-3 pb-3">
          <CellOutputRenderer outputs={outputs} onInstallModule={onInstallModule} />
        </div>
      )}
    </div>
  );
};
