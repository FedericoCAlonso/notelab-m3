import React from 'react';
import { NotebookDocument } from '../types/nbformat';
import { CellState, ExecutionQueueState, getCellState } from '../state/machines';
import { CommandId } from '../commands/CommandRegistry';
import { ActiveStdinPrompt, CellCard } from './CellCard';

interface NotebookViewProps {
  notebook: NotebookDocument;
  activeCellId: string | null;
  editingCellId: string | null;
  executionState: ExecutionQueueState;
  isDark: boolean;
  pendingStdin?: ActiveStdinPrompt | null;
  onSelectCell: (cellId: string) => void;
  onEnterEdit: (cellId: string) => void;
  onRunCell: (cellId: string) => void;
  onChangeSource: (cellId: string, source: string) => void;
  onAttachImage?: (cellId: string, file: File) => void;
  onToggleType: (cellId: string) => void;
  onToggleHideSource: (cellId: string) => void;
  onDeleteCell: (cellId: string) => void;
  onShortcut: (commandId: CommandId) => void;
  onInstallModule?: (moduleName: string, cellId: string) => void;
}

export const NotebookView: React.FC<NotebookViewProps> = ({
  notebook,
  activeCellId,
  editingCellId,
  executionState,
  isDark,
  pendingStdin,
  onSelectCell,
  onEnterEdit,
  onRunCell,
  onChangeSource,
  onAttachImage,
  onToggleType,
  onToggleHideSource,
  onDeleteCell,
  onShortcut,
  onInstallModule,
}) => {
  const resolveCellState = (cellId: string): CellState => {
    if (editingCellId === cellId) return 'EDITING';
    return getCellState(executionState, cellId);
  };

  return (
    <main className="w-full max-w-3xl mx-auto pt-16 pb-24 px-2 sm:px-3 space-y-2.5">
      {notebook.cells.map((cell, index) => (
        <CellCard
          key={cell.id}
          cell={cell}
          index={index}
          isActive={activeCellId === cell.id}
          cellState={resolveCellState(cell.id)}
          isDark={isDark}
          canDelete={notebook.cells.length > 1}
          pendingStdin={pendingStdin}
          onSelect={onSelectCell}
          onEnterEdit={onEnterEdit}
          onRunCell={onRunCell}
          onChangeSource={onChangeSource}
          onAttachImage={onAttachImage}
          onToggleType={onToggleType}
          onToggleHideSource={onToggleHideSource}
          onDelete={onDeleteCell}
          onShortcut={onShortcut}
          onInstallModule={onInstallModule}
        />
      ))}

      <footer className="notelab-no-print pt-4 pb-2 text-center text-xs text-on-surface-variant/65 select-none">
        <span>
          <kbd className="font-mono">Ctrl+/</kbd> atajos ·{' '}
          <kbd className="font-mono">Enter</kbd> editar ·{' '}
          <kbd className="font-mono">Ctrl+Enter</kbd> renderizar/ejecutar
        </span>
      </footer>
    </main>
  );
};
