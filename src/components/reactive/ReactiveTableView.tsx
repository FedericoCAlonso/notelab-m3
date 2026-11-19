import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Calculator, Plus, Table2, Trash2 } from 'lucide-react';
import { EvaluatedTable, TableBlock } from '../../engine/parser/types';

interface ReactiveTableViewProps {
  block: TableBlock;
  table: EvaluatedTable;
  viewMode: 'author' | 'deliverable';
  onUpdateCell?: (block: TableBlock, rowIndex: number, colIndex: number, nextValue: string) => void;
  onAppendRow?: (block: TableBlock) => void;
  onDeleteRow?: (block: TableBlock, rowIndex: number) => void;
}

function alignClass(align: 'left' | 'center' | 'right' | null): string {
  if (align === 'center') return 'text-center';
  if (align === 'right') return 'text-right';
  return 'text-left';
}

export const ReactiveTableView: React.FC<ReactiveTableViewProps> = ({
  block,
  table,
  viewMode,
  onUpdateCell,
  onAppendRow,
  onDeleteRow,
}) => {
  const [editingCell, setEditingCell] = useState<{ r: number; c: number } | null>(null);
  const [draftVal, setDraftVal] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editingCell) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editingCell]);

  const editableColIndices = table.headers
    .map((h, idx) =>
      idx < block.headers.length && !table.computedColumnNames.has(h) ? idx : -1
    )
    .filter((idx) => idx >= 0);

  const canInlineEdit = viewMode === 'author' && Boolean(onUpdateCell);

  const startCellEdit = (rIdx: number, cIdx: number) => {
    if (!canInlineEdit) return;
    if (!editableColIndices.includes(cIdx)) return;
    const rawCellText = block.rows[rIdx]?.cells[cIdx] ?? '';
    setDraftVal(rawCellText);
    setEditingCell({ r: rIdx, c: cIdx });
  };

  const commitCellEdit = (moveDir: 0 | 1 | -1 = 0) => {
    if (!editingCell) return;
    const { r, c } = editingCell;
    const prevRaw = block.rows[r]?.cells[c] ?? '';
    if (draftVal.trim() !== prevRaw.trim()) {
      onUpdateCell?.(block, r, c, draftVal);
    }

    if (moveDir === 0) {
      setEditingCell(null);
      return;
    }

    // Move Tab / Shift+Tab cleanly across editable cells
    const posInRow = editableColIndices.indexOf(c);
    let nextR = r;
    let nextPos = posInRow + moveDir;
    if (nextPos >= editableColIndices.length) {
      nextPos = 0;
      nextR = r + 1;
    } else if (nextPos < 0) {
      nextPos = editableColIndices.length - 1;
      nextR = r - 1;
    }

    const nextC = editableColIndices[nextPos];
    if (nextR >= 0 && nextR < block.rows.length && nextC !== undefined) {
      const nextRaw = block.rows[nextR]?.cells[nextC] ?? '';
      setDraftVal(nextRaw);
      setEditingCell({ r: nextR, c: nextC });
    } else {
      setEditingCell(null);
    }
  };

  return (
    <div className="reactive-table-block break-inside-avoid my-1">
      {viewMode === 'author' && (table.name || table.computedColumnNames.size > 0) && (
        <div className="no-print flex flex-wrap items-center gap-2 mb-1.5 px-0.5 select-none">
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
          {canInlineEdit && (
            <span className="text-[11px] text-on-surface-variant/70 ml-auto">
              Tocá una celda para editar (Tab avanza)
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
              {viewMode === 'author' && onDeleteRow && table.rows.length > 1 && (
                <th className="no-print w-8 px-1" aria-label="Acciones de fila" />
              )}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, rIdx) => (
              <tr
                key={rIdx}
                className="group/row border-b last:border-b-0 border-outline-variant/40 hover:bg-surface-container/40 transition-colors"
              >
                {row.map((cell, cIdx) => {
                  const isNumericOrUnit = Boolean(
                    cell.value && (cell.value.isNumber || cell.value.isUnit)
                  );
                  const isEditingThis =
                    editingCell?.r === rIdx && editingCell?.c === cIdx;
                  const isEditableCell =
                    canInlineEdit && editableColIndices.includes(cIdx);

                  return (
                    <td
                      key={cIdx}
                      onClick={(e) => {
                        if (isEditableCell) {
                          e.stopPropagation();
                          startCellEdit(rIdx, cIdx);
                        }
                      }}
                      onDoubleClick={(e) => {
                        if (isEditableCell) {
                          e.stopPropagation();
                        }
                      }}
                      className={`px-3 py-2 whitespace-nowrap ${alignClass(
                        table.alignments[cIdx] ?? null
                      )} ${
                        cell.isComputed
                          ? 'bg-primary-container/15 font-medium text-on-surface'
                          : isEditableCell
                            ? 'text-on-surface cursor-text hover:bg-surface-container-high/55'
                            : 'text-on-surface'
                      } ${isNumericOrUnit ? 'font-mono text-[13px]' : ''}`}
                    >
                      {isEditingThis ? (
                        <input
                          ref={inputRef}
                          type="text"
                          value={draftVal}
                          aria-label={`Editar celda fila ${rIdx + 1}, columna ${table.headers[cIdx] ?? cIdx + 1}`}
                          onChange={(e) => setDraftVal(e.target.value)}
                          onBlur={() => commitCellEdit(0)}
                          onKeyDown={(e) => {
                            if (e.key === 'Tab') {
                              e.preventDefault();
                              commitCellEdit(e.shiftKey ? -1 : 1);
                            } else if (e.key === 'Enter') {
                              e.preventDefault();
                              commitCellEdit(0);
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              setEditingCell(null);
                            }
                          }}
                          className="w-full min-w-[72px] bg-surface-container-highest text-on-surface font-mono text-xs px-1.5 py-0.5 rounded-md border border-primary outline-none"
                        />
                      ) : cell.error ? (
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
                {viewMode === 'author' && onDeleteRow && table.rows.length > 1 && (
                  <td className="no-print px-1 py-1 text-center">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingCell(null);
                        onDeleteRow(block, rIdx);
                      }}
                      title="Eliminar fila"
                      aria-label={`Eliminar fila ${rIdx + 1}`}
                      className="p-1 rounded-full text-on-surface-variant/50 hover:text-error hover:bg-error-container/50 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {viewMode === 'author' && onAppendRow && (
        <div className="no-print mt-1.5 flex justify-end">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAppendRow(block);
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-colors"
          >
            <Plus className="w-3.5 h-3.5 text-primary" />
            <span>Agregar fila</span>
          </button>
        </div>
      )}
    </div>
  );
};
