import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  Code2,
  Download,
  Eye,
  FileText,
  GitBranch,
  Heading2,
  ListTree,
  Pencil,
  Plus,
  SlidersHorizontal,
  Table2,
  Trash2,
} from 'lucide-react';
import { CommandId } from '../../commands/CommandRegistry';
import {
  buildReactiveCompletionItems,
  createReactiveCompletionSource,
} from '../../engine/completion/reactiveCompletions';
import { ReactiveSession } from '../../engine/evaluator/evaluateDocument';
import {
  deleteBlockRange,
  insertBlockAfterLine,
  replaceBlockRange,
  updateControlValueInMarkdown,
} from '../../engine/parser/documentParser';
import { ControlToken, DocBlock, ProseBlock, SectionNode } from '../../engine/parser/types';
import { downloadReactiveLatex } from '../../services/reactive/latexExport';
import { CodeMirrorEditor } from '../CodeMirrorEditor';
import { MarkdownRenderer } from '../MarkdownRenderer';
import { MermaidBlock } from '../MermaidBlock';
import { ReactiveCalcBlockView } from './ReactiveCalcBlockView';
import { ReactiveOutlineSheet } from './ReactiveOutlineSheet';
import { ReactiveProseView } from './ReactiveProseView';
import { ReactiveSvgBlock } from './ReactiveSvgBlock';
import { ReactiveTableView } from './ReactiveTableView';

export interface ReactiveStatusSummary {
  symbolCount: number;
  tableCount: number;
  errorCount: number;
}

interface ReactiveDocWorkspaceProps {
  docPath?: string;
  content: string;
  isDark: boolean;
  onChangeContent: (nextContent: string) => void;
  onStatusChange?: (summary: ReactiveStatusSummary) => void;
  onOpenShortcuts?: () => void;
  onForceSave?: () => void;
}

const INSERT_TEMPLATES: Record<'heading' | 'prose' | 'calc' | 'table' | 'control' | 'diagram', string> = {
  heading: '## Nueva Sección',
  prose: 'Texto técnico con interpolación {{variable}} o ecuación $$E = m \\cdot c^2$$.',
  calc: '```calc\nx = 10 m\ny = x * 2\n```',
  table: [
    '@tabla: nueva_tabla',
    '@col Subtotal = Cantidad * Precio',
    '',
    '| Concepto | Cantidad | Precio | Subtotal |',
    '| :--- | :---: | :---: | :---: |',
    '| Ítem 1 | 2 u | 10 USD/u | — |',
  ].join('\n'),
  control:
    'Parámetro interactivo: tensión [V_prueba: 220 V | input] y corriente [I_prueba: 5 A | slider 0..20 step=0.5].',
  diagram: [
    '```mermaid',
    'flowchart LR',
    '  A["Entrada ({{V}})"] --> B["Carga ({{I}})"] --> C["Potencia: {{P}}"]',
    '```',
  ].join('\n'),
};

export const ReactiveDocWorkspace: React.FC<ReactiveDocWorkspaceProps> = ({
  docPath = 'memoria.md',
  content,
  isDark,
  onChangeContent,
  onStatusChange,
  onOpenShortcuts,
  onForceSave,
}) => {
  const sessionRef = useRef<ReactiveSession | null>(null);
  if (!sessionRef.current) {
    sessionRef.current = new ReactiveSession();
  }

  const evaluated = useMemo(() => {
    return sessionRef.current!.evaluate(content);
  }, [content]);

  const [viewMode, setViewMode] = useState<'author' | 'deliverable'>('author');
  const [rawSourceMode, setRawSourceMode] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);

  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<string>('');

  const blockElsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const contentRef = useRef(content);
  contentRef.current = content;

  const blocks = evaluated.ast.blocks;
  const errorDiagnostics = useMemo(
    () => evaluated.diagnostics.filter((d) => d.severity === 'error'),
    [evaluated.diagnostics]
  );

  const completionSource = useMemo(() => {
    const items = buildReactiveCompletionItems(evaluated);
    return createReactiveCompletionSource(items);
  }, [evaluated]);

  const handleUpdateControl = useCallback(
    (block: ProseBlock, control: ControlToken, nextValueExpr: string) => {
      const nextMd = updateControlValueInMarkdown(
        contentRef.current,
        block,
        control,
        nextValueExpr
      );
      if (nextMd !== contentRef.current) {
        onChangeContent(nextMd);
      }
    },
    [onChangeContent]
  );

  // Sync status summary to TopAppBar
  useEffect(() => {
    onStatusChange?.({
      symbolCount: evaluated.symbols.size,
      tableCount: evaluated.tablesByName.size,
      errorCount: errorDiagnostics.length,
    });
  }, [evaluated.symbols.size, evaluated.tablesByName.size, errorDiagnostics.length, onStatusChange]);

  // Keep activeBlockId valid
  useEffect(() => {
    if (blocks.length === 0) {
      setActiveBlockId(null);
      setEditingBlockId(null);
      return;
    }
    if (!activeBlockId || !blocks.some((b) => b.id === activeBlockId)) {
      const first = blocks[0];
      if (first) setActiveBlockId(first.id);
    }
  }, [blocks, activeBlockId]);

  const activeBlock = useMemo(
    () => blocks.find((b) => b.id === activeBlockId) ?? null,
    [blocks, activeBlockId]
  );

  const startEditingBlock = useCallback((block: DocBlock) => {
    if (viewMode === 'deliverable') return;
    setActiveBlockId(block.id);
    setEditingBlockId(block.id);
    setEditDraft(block.raw);
  }, [viewMode]);

  const commitBlockEdit = useCallback(
    (advanceNext = false) => {
      if (!editingBlockId) return;
      const idx = blocks.findIndex((b) => b.id === editingBlockId);
      const block = idx >= 0 ? blocks[idx] : null;
      if (!block) {
        setEditingBlockId(null);
        return;
      }

      if (editDraft !== block.raw) {
        const nextMd = replaceBlockRange(
          contentRef.current,
          block.startLine,
          block.endLine,
          editDraft
        );
        onChangeContent(nextMd);
      }

      setEditingBlockId(null);

      if (advanceNext) {
        const nextBlock = blocks[idx + 1];
        if (nextBlock) {
          setActiveBlockId(nextBlock.id);
          setTimeout(() => {
            blockElsRef.current.get(nextBlock.id)?.scrollIntoView({
              behavior: 'smooth',
              block: 'nearest',
            });
          }, 30);
        }
      }
    },
    [editingBlockId, blocks, editDraft, onChangeContent]
  );

  const handleInsertTemplate = useCallback(
    (kind: 'heading' | 'prose' | 'calc' | 'table' | 'control' | 'diagram') => {
      const targetBlock = blocks.find((b) => b.id === (editingBlockId ?? activeBlockId));
      const afterLine = targetBlock ? targetBlock.endLine : evaluated.ast.lines.length - 1;
      const nextMd = insertBlockAfterLine(
        contentRef.current,
        afterLine,
        INSERT_TEMPLATES[kind]
      );
      setEditingBlockId(null);
      setViewMode('author');
      onChangeContent(nextMd);
    },
    [blocks, editingBlockId, activeBlockId, evaluated.ast.lines.length, onChangeContent]
  );

  const handleDeleteBlock = useCallback(
    (block: DocBlock) => {
      const nextMd = deleteBlockRange(contentRef.current, block.startLine, block.endLine);
      setEditingBlockId(null);
      onChangeContent(nextMd);
    },
    [onChangeContent]
  );

  const moveBlockSelection = useCallback(
    (delta: -1 | 1) => {
      if (blocks.length === 0) return;
      if (editingBlockId) {
        commitBlockEdit(false);
      }
      const curIdx = blocks.findIndex((b) => b.id === activeBlockId);
      const base = curIdx < 0 ? 0 : curIdx;
      const nextIdx = Math.min(blocks.length - 1, Math.max(0, base + delta));
      const nextBlock = blocks[nextIdx];
      if (nextBlock) {
        setActiveBlockId(nextBlock.id);
        blockElsRef.current.get(nextBlock.id)?.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        });
      }
    },
    [blocks, activeBlockId, editingBlockId, commitBlockEdit]
  );

  const handleEditorShortcut = useCallback(
    (commandId: CommandId) => {
      switch (commandId) {
        case 'cell.runAndStay':
          if (rawSourceMode) {
            setRawSourceMode(false);
          } else {
            commitBlockEdit(false);
          }
          break;
        case 'cell.runAndAdvance':
          if (rawSourceMode) {
            setRawSourceMode(false);
          } else {
            commitBlockEdit(true);
          }
          break;
        case 'cell.moveUp':
          moveBlockSelection(-1);
          break;
        case 'cell.moveDown':
          moveBlockSelection(1);
          break;
        case 'cell.insertBelow':
          handleInsertTemplate('calc');
          break;
        case 'notebook.forceSync':
          commitBlockEdit(false);
          onForceSave?.();
          break;
        case 'app.openShortcuts':
          onOpenShortcuts?.();
          break;
        default:
          break;
      }
    },
    [
      rawSourceMode,
      commitBlockEdit,
      moveBlockSelection,
      handleInsertTemplate,
      onForceSave,
      onOpenShortcuts,
    ]
  );

  // Global keyboard-first handler when in ReactiveDocWorkspace
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inInput =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        Boolean(target?.closest('.cm-editor'));

      const hasMod = e.ctrlKey || e.metaKey;

      // Ctrl+O -> Toggle hierarchical outline
      if (hasMod && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        setOutlineOpen((prev) => !prev);
        return;
      }

      // Ctrl+S -> Save & commit
      if (hasMod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (editingBlockId) commitBlockEdit(false);
        onForceSave?.();
        return;
      }

      if (inInput || rawSourceMode || outlineOpen) return;

      if (e.key === 'ArrowDown' || (e.altKey && e.key === 'ArrowDown')) {
        e.preventDefault();
        moveBlockSelection(1);
      } else if (e.key === 'ArrowUp' || (e.altKey && e.key === 'ArrowUp')) {
        e.preventDefault();
        moveBlockSelection(-1);
      } else if (e.key === 'Enter' && !e.shiftKey && !hasMod && activeBlock && viewMode === 'author') {
        e.preventDefault();
        startEditingBlock(activeBlock);
      } else if (hasMod && e.key.toLowerCase() === 'b' && viewMode === 'author') {
        e.preventDefault();
        handleInsertTemplate('calc');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    activeBlock,
    editingBlockId,
    rawSourceMode,
    outlineOpen,
    viewMode,
    commitBlockEdit,
    moveBlockSelection,
    startEditingBlock,
    handleInsertTemplate,
    onForceSave,
  ]);

  const handleJumpToSection = useCallback(
    (section: SectionNode) => {
      const firstBlockId = section.blockIds[0];
      if (!firstBlockId) return;
      setActiveBlockId(firstBlockId);
      setTimeout(() => {
        blockElsRef.current.get(firstBlockId)?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      }, 40);
    },
    []
  );

  const renderBlockContent = (block: DocBlock) => {
    if (block.kind === 'heading') {
      const headingTagClass: Record<number, string> = {
        1: 'text-2xl sm:text-[1.75rem] font-bold tracking-tight mt-3 mb-1.5 pb-1 border-b border-outline-variant/40',
        2: 'text-xl sm:text-[1.4rem] font-semibold mt-4 mb-1',
        3: 'text-lg sm:text-[1.18rem] font-semibold mt-3 mb-1 text-on-surface/95',
        4: 'text-base font-semibold mt-2.5 mb-0.5 text-on-surface/90',
        5: 'text-sm font-semibold uppercase tracking-wide mt-2 text-on-surface-variant',
        6: 'text-xs font-semibold uppercase tracking-wider mt-2 text-on-surface-variant',
      };
      return (
        <div className={headingTagClass[block.level] ?? headingTagClass[3]}>
          {block.title}
        </div>
      );
    }

    if (block.kind === 'prose') {
      const interpolated = evaluated.interpolatedProse.get(block.id) ?? block.raw;
      return (
        <ReactiveProseView
          block={block}
          interpolatedSource={interpolated}
          symbols={evaluated.symbols}
          isDark={isDark}
          onUpdateControl={handleUpdateControl}
        />
      );
    }

    if (block.kind === 'table') {
      const evalTable = evaluated.tables.get(block.id);
      if (!evalTable) {
        return <MarkdownRenderer source={block.raw} isDark={isDark} />;
      }
      return <ReactiveTableView table={evalTable} viewMode={viewMode} />;
    }

    if (block.kind === 'calc') {
      const evalCalc = evaluated.calcBlocks.get(block.id);
      if (!evalCalc) return null;
      return <ReactiveCalcBlockView evaluated={evalCalc} viewMode={viewMode} />;
    }

    if (block.kind === 'code') {
      if (block.language === 'mermaid') {
        const parametricCode =
          evaluated.interpolatedCodeBlocks.get(block.id) ?? block.content;
        return <MermaidBlock code={parametricCode} isDark={isDark} />;
      }
      if (block.language === 'svg') {
        const parametricSvg =
          evaluated.interpolatedCodeBlocks.get(block.id) ?? block.content;
        return <ReactiveSvgBlock svgCode={parametricSvg} />;
      }
      return <MarkdownRenderer source={block.raw} isDark={isDark} />;
    }

    return null;
  };

  return (
    <main className="w-full max-w-4xl mx-auto px-3 sm:px-6 pt-16 pb-28">
      {/* Contextual Reactive Toolbar (hidden in print) */}
      <div className="no-print sticky top-14 z-20 -mx-1 px-2 py-2 mb-4 bg-surface/92 backdrop-blur-md border-b border-outline-variant/40 flex flex-wrap items-center gap-2">
        {/* Dual View Mode Segmented Switch */}
        <div
          className="inline-flex rounded-full bg-surface-container p-0.5 border border-outline-variant/50"
          role="group"
          aria-label="Modo de vista"
        >
          <button
            type="button"
            onClick={() => setViewMode('author')}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              viewMode === 'author'
                ? 'bg-secondary-container text-on-secondary-container shadow-xs'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <Pencil className="w-3.5 h-3.5" />
            <span>Autor</span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (editingBlockId) commitBlockEdit(false);
              setRawSourceMode(false);
              setViewMode('deliverable');
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              viewMode === 'deliverable'
                ? 'bg-secondary-container text-on-secondary-container shadow-xs'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Entregable</span>
          </button>
        </div>

        {/* Hierarchical Outline button */}
        <button
          type="button"
          onClick={() => setOutlineOpen(true)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium bg-surface-container hover:bg-surface-container-high text-on-surface transition-colors"
          title="Abrir índice jerárquico (Ctrl+O)"
        >
          <ListTree className="w-3.5 h-3.5 text-primary" />
          <span>Índice</span>
        </button>

        {/* Raw plain-text Markdown toggle */}
        {viewMode === 'author' && (
          <button
            type="button"
            onClick={() => {
              if (editingBlockId) commitBlockEdit(false);
              setRawSourceMode((prev) => !prev);
            }}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium transition-colors ${
              rawSourceMode
                ? 'bg-primary text-on-primary'
                : 'bg-surface-container hover:bg-surface-container-high text-on-surface'
            }`}
            title="Ver/editar el archivo Markdown completo en texto plano"
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>{rawSourceMode ? 'Volver a bloques' : 'Fuente .md'}</span>
          </button>
        )}

        {/* Export .tex (LaTeX) button */}
        <button
          type="button"
          onClick={() => downloadReactiveLatex(docPath, evaluated)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium bg-surface-container hover:bg-surface-container-high text-on-surface transition-colors"
          title="Exportar memoria evaluada a LaTeX (.tex)"
        >
          <Download className="w-3.5 h-3.5 text-primary" />
          <span>.tex</span>
        </button>

        {/* DAG Diagnostics Pill */}
        <button
          type="button"
          onClick={() => setDiagnosticsOpen((prev) => !prev)}
          className={`ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
            errorDiagnostics.length > 0
              ? 'bg-error-container text-on-error-container'
              : 'bg-success-container/75 text-on-success-container'
          }`}
        >
          {errorDiagnostics.length > 0 ? (
            <>
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>
                {errorDiagnostics.length}{' '}
                {errorDiagnostics.length === 1 ? 'error' : 'errores'}
              </span>
            </>
          ) : (
            <>
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>
                {evaluated.symbols.size} vars
                {evaluated.tablesByName.size > 0
                  ? ` · ${evaluated.tablesByName.size} ${
                      evaluated.tablesByName.size === 1 ? 'tabla' : 'tablas'
                    }`
                  : ''}
              </span>
            </>
          )}
        </button>
      </div>

      {/* Expandable Diagnostics Panel */}
      {diagnosticsOpen && (
        <div className="no-print mb-4 rounded-2xl border border-outline-variant/60 bg-surface-container-low p-3 text-xs space-y-1.5">
          <div className="font-semibold text-on-surface flex items-center justify-between">
            <span>Diagnósticos del Grafo Reactivo (DAG)</span>
            <span className="font-mono text-on-surface-variant">
              Orden: {evaluated.dag.evaluationOrder.length} nodos
            </span>
          </div>
          {evaluated.diagnostics.length === 0 ? (
            <div className="text-on-surface-variant">
              Sin errores ni advertencias dimensionales. Todas las dependencias están sincronizadas.
            </div>
          ) : (
            <ul className="space-y-1">
              {evaluated.diagnostics.map((d) => (
                <li
                  key={d.id}
                  className={`flex items-start gap-2 rounded-lg px-2.5 py-1.5 ${
                    d.severity === 'error'
                      ? 'bg-error-container/60 text-on-error-container'
                      : 'bg-warning-container/60 text-on-warning-container'
                  }`}
                >
                  <span className="font-mono shrink-0">L{d.line}</span>
                  <span>{d.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Raw Full-File Plain-Text Editor Mode */}
      {rawSourceMode ? (
        <div className="space-y-2">
          <div className="text-xs text-on-surface-variant flex items-center justify-between px-1">
            <span>Editando documento Markdown plano completo (Ctrl+Enter para volver a bloques)</span>
            <span className="font-mono">{evaluated.ast.lines.length} líneas</span>
          </div>
          <CodeMirrorEditor
            value={content}
            language="markdown"
            isDark={isDark}
            autoFocus
            completionSource={completionSource}
            onChange={onChangeContent}
            onShortcut={handleEditorShortcut}
          />
        </div>
      ) : (
        /* Hierarchical Block Flow */
        <article
          className={`reactive-doc-article space-y-2.5 ${
            viewMode === 'deliverable' ? 'reactive-deliverable' : ''
          }`}
        >
          {blocks.map((block) => {
            const isEditing = editingBlockId === block.id;
            const isActive = activeBlockId === block.id && viewMode === 'author';
            const rendered = !isEditing ? renderBlockContent(block) : null;

            // Hide empty deliverable blocks (e.g. @oculto calc blocks)
            if (!isEditing && rendered === null) {
              return null;
            }

            return (
              <div
                key={block.id}
                ref={(el) => {
                  if (el) blockElsRef.current.set(block.id, el);
                  else blockElsRef.current.delete(block.id);
                }}
                onClick={() => {
                  if (viewMode !== 'author') return;
                  if (editingBlockId && editingBlockId !== block.id) {
                    commitBlockEdit(false);
                  }
                  setActiveBlockId(block.id);
                }}
                onDoubleClick={() => {
                  if (viewMode === 'author' && !isEditing) {
                    startEditingBlock(block);
                  }
                }}
                className={`group relative rounded-2xl transition-all ${
                  viewMode === 'deliverable'
                    ? 'px-0.5 py-0.5'
                    : isEditing
                      ? 'p-2 bg-surface-container-low border border-primary/60 shadow-xs'
                      : isActive
                        ? 'px-2.5 py-1.5 bg-surface-container-low/55 ring-1 ring-primary/35'
                        : 'px-2.5 py-1.5 hover:bg-surface-container-low/35'
                }`}
              >
                {isEditing ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-on-surface-variant px-1">
                      <span className="font-mono uppercase tracking-wider">
                        {block.kind === 'calc'
                          ? 'Bloque de cálculo'
                          : block.kind === 'table'
                            ? 'Tabla reactiva'
                            : block.kind === 'heading'
                              ? `Título H${block.level}`
                              : 'Markdown'}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            commitBlockEdit(false);
                          }}
                          className="px-2.5 py-0.5 rounded-full bg-primary text-on-primary font-medium"
                        >
                          Listo (Ctrl+Enter)
                        </button>
                      </div>
                    </div>
                    <CodeMirrorEditor
                      value={editDraft}
                      language="markdown"
                      isDark={isDark}
                      autoFocus
                      completionSource={completionSource}
                      onChange={setEditDraft}
                      onShortcut={handleEditorShortcut}
                    />
                  </div>
                ) : (
                  <>
                    {rendered}
                    {/* Subtle hover/active action pills in Author mode */}
                    {viewMode === 'author' && isActive && (
                      <div className="no-print absolute -top-2.5 right-2 flex items-center gap-1 bg-surface-container-high border border-outline-variant/60 rounded-full px-1.5 py-0.5 shadow-xs">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            startEditingBlock(block);
                          }}
                          className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-full text-on-surface hover:bg-surface-container-highest"
                          title="Editar bloque (Enter)"
                        >
                          <Pencil className="w-3 h-3" />
                          <span>Editar</span>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteBlock(block);
                          }}
                          className="p-1 rounded-full text-on-surface-variant hover:text-error hover:bg-error-container/50"
                          title="Eliminar bloque"
                          aria-label="Eliminar bloque"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}

          {/* Quick-insert bar in Author mode */}
          {viewMode === 'author' && (
            <div className="no-print pt-4 flex flex-wrap items-center gap-2 border-t border-outline-variant/40 mt-6">
              <span className="text-xs font-medium text-on-surface-variant inline-flex items-center gap-1 mr-1">
                <Plus className="w-3.5 h-3.5" />
                Insertar:
              </span>
              <button
                type="button"
                onClick={() => handleInsertTemplate('heading')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-surface-container hover:bg-surface-container-high text-on-surface transition-colors"
              >
                <Heading2 className="w-3.5 h-3.5 text-primary" />
                <span>Sección</span>
              </button>
              <button
                type="button"
                onClick={() => handleInsertTemplate('prose')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-surface-container hover:bg-surface-container-high text-on-surface transition-colors"
              >
                <FileText className="w-3.5 h-3.5 text-primary" />
                <span>Texto</span>
              </button>
              <button
                type="button"
                onClick={() => handleInsertTemplate('calc')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-secondary-container/70 hover:bg-secondary-container text-on-secondary-container transition-colors"
              >
                <Calculator className="w-3.5 h-3.5" />
                <span>Cálculo</span>
              </button>
              <button
                type="button"
                onClick={() => handleInsertTemplate('table')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-secondary-container/70 hover:bg-secondary-container text-on-secondary-container transition-colors"
              >
                <Table2 className="w-3.5 h-3.5" />
                <span>Tabla @tabla</span>
              </button>
              <button
                type="button"
                onClick={() => handleInsertTemplate('control')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-tertiary-container/70 hover:bg-tertiary-container text-on-tertiary-container transition-colors"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>Control</span>
              </button>
              <button
                type="button"
                onClick={() => handleInsertTemplate('diagram')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-tertiary-container/70 hover:bg-tertiary-container text-on-tertiary-container transition-colors"
              >
                <GitBranch className="w-3.5 h-3.5" />
                <span>Diagrama</span>
              </button>
            </div>
          )}
        </article>
      )}

      <ReactiveOutlineSheet
        open={outlineOpen}
        sections={evaluated.ast.sections}
        activeSectionId={activeBlock?.sectionId ?? null}
        onSelectSection={handleJumpToSection}
        onClose={() => setOutlineOpen(false)}
      />
    </main>
  );
};
