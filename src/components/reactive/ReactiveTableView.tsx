import React from 'react';
import { AlertCircle, Calculator, Table2 } from 'lucide-react';
import { EvaluatedTable } from '../../engine/parser/types';

interface ReactiveTableViewProps {
  table: EvaluatedTable;
  viewMode: 'author' | 'deliverable';
}

function alignClass(align: 'left' | 'center' | 'right' | null): string {
  if (align === 'center') return 'text-center';
  if (align === 'right') return 'text-right';
  return 'text-left';
}

export const ReactiveTableView: React.FC<ReactiveTableViewProps> = ({
  table,
  viewMode,
}) => {
  return (
    <div className="reactive-table-block break-inside-avoid my-1">
      {viewMode === 'author' && (table.name || table.computedColumnNames.size > 0) && (
        <div className="flex flex-wrap items-center gap-2 mb-1.5 px-0.5 select-none">
          {table.name && (
            <span className="inline-flex items-center gap-1 text-xs font-mono font-medium px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-container">
              <Table2 className="w-3 h-3" />
              @tabla: {table.name}
            </span>
          )}
          {table.computedColumnNames.size > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] text-on-surface-variant">
              <Calculator className="w-3 h-3 text-primary" />
              {table.computedColumnNames.size}{' '}
              {table.computedColumnNames.size === 1
                ? 'columna calculada'
                : 'columnas calculadas'}
            </span>
          )}
        </div>
      )}

      {table.errors.length > 0 && (
        <div className="mb-2 rounded-xl bg-error-container/75 text-on-error-container px-3 py-2 text-xs space-y-0.5">
          {table.errors.map((err, idx) => (
            <div key={idx} className="flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{err}</span>
            </div>
          ))}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-outline-variant/60 bg-surface-container-lowest">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-surface-container-low border-b border-outline-variant/70">
              {table.headers.map((header, idx) => {
                const isComputed = table.computedColumnNames.has(header);
                const formula = table.computedFormulas[header];
                return (
                  <th
                    key={`${header}-${idx}`}
                    className={`px-3 py-2 font-semibold text-on-surface whitespace-nowrap ${alignClass(
                      table.alignments[idx] ?? null
                    )} ${isComputed ? 'bg-primary-container/30' : ''}`}
                    title={formula ? `Fórmula por campo: ${header} = ${formula}` : undefined}
                  >
                    <div className="flex flex-col">
                      <span className="inline-flex items-center gap-1 justify-inherit">
                        {header}
                      </span>
                      {viewMode === 'author' && isComputed && formula && (
                        <span className="text-[10px] font-mono font-normal text-primary/90 truncate max-w-[180px]">
                          = {formula}
                        </span>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, rIdx) => (
              <tr
                key={rIdx}
                className="border-b last:border-b-0 border-outline-variant/40 hover:bg-surface-container/40 transition-colors"
              >
                {row.map((cell, cIdx) => {
                  const isNumericOrUnit = Boolean(
                    cell.value && (cell.value.isNumber || cell.value.isUnit)
                  );
                  return (
                    <td
                      key={cIdx}
                      className={`px-3 py-2 whitespace-nowrap ${alignClass(
                        table.alignments[cIdx] ?? null
                      )} ${
                        cell.isComputed
                          ? 'bg-primary-container/15 font-medium text-on-surface'
                          : 'text-on-surface'
                      } ${isNumericOrUnit ? 'font-mono text-[13px]' : ''}`}
                    >
                      {cell.error ? (
                        <span
                          className="inline-flex items-center gap-1 text-xs text-error font-sans"
                          title={cell.error}
                        >
                          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                          Error
                        </span>
                      ) : cell.value ? (
                        cell.value.formattedText
                      ) : (
                        cell.rawText
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
