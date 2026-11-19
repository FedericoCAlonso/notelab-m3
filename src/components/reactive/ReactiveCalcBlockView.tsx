import React, { useMemo } from 'react';
import katex from 'katex';
import { AlertCircle, EyeOff, SlidersHorizontal } from 'lucide-react';
import { EvaluatedCalcBlock, EvaluatedCalcLine } from '../../engine/parser/types';

interface ReactiveCalcBlockViewProps {
  evaluated: EvaluatedCalcBlock;
  viewMode: 'author' | 'deliverable';
}

function renderKatexHtml(tex: string): string {
  try {
    return katex.renderToString(tex, {
      displayMode: true,
      throwOnError: false,
      strict: false,
    });
  } catch {
    return tex;
  }
}

const CalcLineRow: React.FC<{
  line: EvaluatedCalcLine;
  viewMode: 'author' | 'deliverable';
}> = React.memo(({ line, viewMode }) => {
  const html = useMemo(
    () => (line.fullTex ? renderKatexHtml(line.fullTex) : ''),
    [line.fullTex]
  );

  if (line.kind === 'comment') {
    if (viewMode === 'deliverable') return null;
    return (
      <div className="text-xs font-mono text-on-surface-variant/65 py-0.5">
        {line.raw.trim()}
      </div>
    );
  }

  if (line.kind === 'unit_decl' || line.kind === 'decimals_decl') {
    if (viewMode === 'deliverable') return null;
    return (
      <div className="inline-flex items-center gap-1.5 text-xs font-mono px-2 py-0.5 rounded-md bg-surface-container-high/80 text-on-surface-variant mr-2 my-0.5">
        <SlidersHorizontal className="w-3 h-3 text-primary" />
        <span>{line.raw.trim()}</span>
      </div>
    );
  }

  if (line.renderMode === 'hidden' && viewMode === 'deliverable') {
    return null;
  }

  if (line.error) {
    return (
      <div className="flex items-start gap-2 rounded-xl bg-error-container/70 text-on-error-container px-3 py-2 my-1 text-sm">
        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <div className="font-mono text-xs opacity-80 truncate">{line.raw.trim()}</div>
          <div className="font-medium leading-snug">{line.error}</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`reactive-calc-eq overflow-x-auto py-0.5 ${
        line.renderMode === 'hidden' ? 'opacity-65' : ''
      }`}
    >
      <div className="flex items-center gap-2 min-w-max">
        <div
          className="reactive-katex-line"
          dangerouslySetInnerHTML={{ __html: html }}
        />
        {viewMode === 'author' && line.renderMode === 'hidden' && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-surface-container-highest text-on-surface-variant">
            <EyeOff className="w-3 h-3" />
            oculto
          </span>
        )}
      </div>
    </div>
  );
});

CalcLineRow.displayName = 'CalcLineRow';

export const ReactiveCalcBlockView: React.FC<ReactiveCalcBlockViewProps> = ({
  evaluated,
  viewMode,
}) => {
  const hasVisibleLinesInDeliverable = evaluated.lines.some(
    (l) =>
      l.kind !== 'comment' &&
      l.kind !== 'unit_decl' &&
      l.kind !== 'decimals_decl' &&
      l.renderMode !== 'hidden'
  );

  if (viewMode === 'deliverable' && !hasVisibleLinesInDeliverable) {
    return null;
  }

  const isAllHidden = evaluated.defaultRenderMode === 'hidden' || !hasVisibleLinesInDeliverable;

  return (
    <div
      className={`reactive-calc-block break-inside-avoid ${
        viewMode === 'author'
          ? `rounded-2xl border px-3.5 py-2.5 ${
              isAllHidden
                ? 'border-dashed border-outline-variant/80 bg-surface-container-low/60'
                : 'border-outline-variant/50 bg-surface-container-lowest/80'
            }`
          : 'py-1'
      }`}
    >
      {viewMode === 'author' && isAllHidden && (
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-on-surface-variant mb-1.5 select-none">
          <EyeOff className="w-3.5 h-3.5" />
          <span>Bloque de configuración / cálculo oculto en modo Entregable</span>
        </div>
      )}

      <div className="space-y-1">
        {evaluated.lines.map((line) => (
          <CalcLineRow key={line.statementId} line={line} viewMode={viewMode} />
        ))}
      </div>
    </div>
  );
};
