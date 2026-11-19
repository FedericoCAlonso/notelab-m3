import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Code2,
  Eye,
  EyeOff,
  FileText,
  ImagePlus,
  Loader2,
  Play,
  Send,
  Trash2,
} from 'lucide-react';
import { NotebookCell } from '../types/nbformat';
import { CellState } from '../state/machines';
import { CommandId } from '../commands/CommandRegistry';
import { MarkdownRenderer } from './MarkdownRenderer';
import { CodeMirrorEditor } from './CodeMirrorEditor';
import { CellOutputRenderer } from './CellOutputRenderer';

export interface ActiveStdinPrompt {
  cellId: string;
  prompt: string;
  password: boolean;
  submit: (value: string) => void;
  cancel: () => void;
}

interface CellCardProps {
  cell: NotebookCell;
  index: number;
  isActive: boolean;
  cellState: CellState;
  isDark: boolean;
  canDelete: boolean;
  pendingStdin?: ActiveStdinPrompt | null;
  onSelect: (cellId: string) => void;
  onEnterEdit: (cellId: string) => void;
  onRunCell: (cellId: string) => void;
  onChangeSource: (cellId: string, source: string) => void;
  onAttachImage?: (cellId: string, file: File) => void;
  onToggleType: (cellId: string) => void;
  onToggleHideSource: (cellId: string) => void;
  onDelete: (cellId: string) => void;
  onShortcut: (commandId: CommandId) => void;
  onInstallModule?: (moduleName: string, cellId: string) => void;
}

export const CellCard: React.FC<CellCardProps> = React.memo(
  ({
    cell,
    index,
    isActive,
    cellState,
    isDark,
    canDelete,
    pendingStdin,
    onSelect,
    onEnterEdit,
    onRunCell,
    onChangeSource,
    onAttachImage,
    onToggleType,
    onToggleHideSource,
    onDelete,
    onShortcut,
    onInstallModule,
  }) => {
    const cardRef = useRef<HTMLDivElement | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const [stdinValue, setStdinValue] = useState('');
    const isEditing = cellState === 'EDITING';
    const isCode = cell.cell_type === 'code';
    const isSourceHidden = isCode && Boolean(cell.metadata.notelab_hide_source) && !isEditing;
    const activeStdin = pendingStdin && pendingStdin.cellId === cell.id ? pendingStdin : null;

    useEffect(() => {
      if (activeStdin) {
        setStdinValue('');
      }
    }, [activeStdin]);

    useEffect(() => {
      if (isActive && cardRef.current) {
        cardRef.current.scrollIntoView({
          block: 'nearest',
          behavior: 'smooth',
        });
      }
    }, [isActive]);

    const handleCardClick = () => {
      if (!isActive) {
        onSelect(cell.id);
      } else if (!isEditing) {
        onEnterEdit(cell.id);
      }
    };

    const surfaceClasses = isEditing
      ? 'bg-surface-container-low border-primary ring-2 ring-primary/25 shadow-sm'
      : isActive
      ? 'bg-surface-container-low border-primary/75 ring-1 ring-primary/30'
      : 'bg-surface-container-lowest border-transparent hover:border-outline-variant/60';

    const stateBorderOverride =
      cellState === 'ERROR'
        ? 'border-error/70'
        : cellState === 'RUNNING' || cellState === 'QUEUED'
        ? 'border-tertiary/70'
        : '';

    return (
      <article
        ref={cardRef}
        onClick={handleCardClick}
        data-cell-id={cell.id}
        data-cell-state={cellState}
        className={`group relative rounded-2xl border transition-colors duration-150 px-3 py-2.5 ${surfaceClasses} ${stateBorderOverride}`}
      >
        {/* Subtle Cell Metadata / Action Bar: visible when active, editing, running, or error */}
        {(isActive ||
          isEditing ||
          cellState === 'RUNNING' ||
          cellState === 'QUEUED' ||
          cellState === 'ERROR') && (
          <div
            className="notelab-no-print flex items-center justify-between gap-2 mb-1.5 text-xs text-on-surface-variant select-none"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-container text-on-surface-variant font-mono text-[11px]">
                {isCode ? (
                  <>
                    <Code2 className="w-3 h-3 text-primary" />
                    <span>
                      Py [{cell.execution_count ?? ' '}]
                    </span>
                  </>
                ) : (
                  <>
                    <FileText className="w-3 h-3 text-secondary" />
                    <span>MD #{index + 1}</span>
                  </>
                )}
              </span>

              {cellState === 'QUEUED' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-container text-[11px] font-medium">
                  En cola
                </span>
              )}

              {cellState === 'RUNNING' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary-container text-on-primary-container text-[11px] font-medium">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Ejecutando
                </span>
              )}

              {cellState === 'ERROR' && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-error-container text-on-error-container text-[11px] font-medium">
                  Error
                </span>
              )}
            </div>

            <div className="flex items-center gap-1">
              {!isCode && onAttachImage && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        onAttachImage(cell.id, file);
                      }
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    title="Adjuntar foto del pizarrón o imagen"
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-surface-container-high text-on-surface-variant transition-colors"
                  >
                    <ImagePlus className="w-3.5 h-3.5" />
                  </button>
                </>
              )}

              {isCode && (
                <button
                  type="button"
                  onClick={() => onToggleHideSource(cell.id)}
                  title="Ocultar/mostrar código (Ctrl+H)"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-surface-container-high text-on-surface-variant transition-colors"
                >
                  {cell.metadata.notelab_hide_source ? (
                    <Eye className="w-3.5 h-3.5" />
                  ) : (
                    <EyeOff className="w-3.5 h-3.5" />
                  )}
                </button>
              )}

              <button
                type="button"
                onClick={() => onToggleType(cell.id)}
                title="Cambiar Markdown / Python (Ctrl+M)"
                className="px-2 py-1 rounded-lg hover:bg-surface-container-high text-[11px] font-medium transition-colors"
              >
                {isCode ? '→ MD' : '→ Py'}
              </button>

              {isEditing ? (
                <button
                  type="button"
                  onClick={() => onRunCell(cell.id)}
                  title={isCode ? 'Ejecutar Python (Ctrl+Enter)' : 'Renderizar (Ctrl+Enter)'}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary text-on-primary text-[11px] font-medium shadow-xs hover:opacity-95 transition-opacity"
                >
                  {isCode ? (
                    <>
                      <Play className="w-3 h-3 fill-current" />
                      <span>Ejecutar</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-3 h-3" />
                      <span>Listo</span>
                    </>
                  )}
                </button>
              ) : isCode ? (
                <button
                  type="button"
                  onClick={() => onRunCell(cell.id)}
                  title="Ejecutar celda Python (Ctrl+Enter)"
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary-container text-on-primary-container text-[11px] font-medium hover:opacity-90 transition-opacity"
                >
                  <Play className="w-3 h-3 fill-current" />
                  <span>Run</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onEnterEdit(cell.id)}
                  className="px-2.5 py-1 rounded-full bg-surface-container-high text-on-surface text-[11px] font-medium"
                >
                  Editar
                </button>
              )}

              {canDelete && (
                <button
                  type="button"
                  onClick={() => onDelete(cell.id)}
                  title="Eliminar celda"
                  className="p-1 rounded-lg hover:bg-error-container hover:text-on-error-container text-on-surface-variant transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Cell Body */}
        {isEditing ? (
          <div onClick={(e) => e.stopPropagation()}>
            <CodeMirrorEditor
              value={cell.source}
              language={isCode ? 'python' : 'markdown'}
              isDark={isDark}
              autoFocus
              placeholder={
                isCode
                  ? '# Escribe código Python (Ctrl+Enter para ejecutar)'
                  : 'Escribe Markdown, tablas GFM, LaTeX ($...$, $$...$$) o diagramas ASCII...'
              }
              onChange={(val) => onChangeSource(cell.id, val)}
              onShortcut={onShortcut}
              onPasteImage={!isCode && onAttachImage ? (file) => onAttachImage(cell.id, file) : undefined}
            />
          </div>
        ) : isCode ? (
          <div>
            {isSourceHidden ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleHideSource(cell.id);
                }}
                className="inline-flex items-center gap-1.5 text-xs text-on-surface-variant/80 bg-surface-container px-2.5 py-1 rounded-full hover:bg-surface-container-high transition-colors"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Código Python oculto · Ctrl+H para ver</span>
              </button>
            ) : (
              <pre className="notelab-mono-block m-0!">
                <code>{cell.source || '# Celda Python vacía'}</code>
              </pre>
            )}
          </div>
        ) : (
          <MarkdownRenderer
            source={cell.source}
            attachments={cell.cell_type === 'markdown' ? cell.attachments : undefined}
            isDark={isDark}
          />
        )}

        {/* Interactive stdin prompt (input_request) */}
        {activeStdin && (
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              activeStdin.submit(stdinValue);
            }}
            className="notelab-no-print mt-2.5 p-2.5 rounded-xl bg-surface-container border border-primary/50 flex flex-wrap items-center gap-2"
          >
            {activeStdin.prompt && (
              <span className="text-xs font-mono text-on-surface">{activeStdin.prompt}</span>
            )}
            <input
              type={activeStdin.password ? 'password' : 'text'}
              autoFocus
              value={stdinValue}
              onChange={(e) => setStdinValue(e.target.value)}
              placeholder="Escribe la entrada (stdin)..."
              className="flex-1 min-w-[140px] px-2.5 py-1.5 rounded-lg bg-surface-container-lowest border border-outline-variant focus:border-primary outline-none text-xs font-mono text-on-surface"
            />
            <div className="flex items-center gap-1.5">
              <button
                type="submit"
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-primary text-on-primary text-xs font-medium"
              >
                <Send className="w-3 h-3" />
                <span>Enviar</span>
              </button>
              <button
                type="button"
                onClick={activeStdin.cancel}
                className="px-2.5 py-1.5 rounded-full text-xs text-on-surface-variant hover:bg-surface-container-high"
              >
                Cancelar
              </button>
            </div>
          </form>
        )}

        {/* Python Execution Outputs */}
        {isCode && cell.outputs.length > 0 && (
          <CellOutputRenderer
            outputs={cell.outputs}
            onInstallModule={
              onInstallModule ? (moduleName) => onInstallModule(moduleName, cell.id) : undefined
            }
          />
        )}
      </article>
    );
  }
);

CellCard.displayName = 'CellCard';
