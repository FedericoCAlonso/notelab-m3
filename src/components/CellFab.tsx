import React, { useState } from 'react';
import { Code2, FileText, Plus, X } from 'lucide-react';

interface CellFabProps {
  onAddMarkdown: () => void;
  onAddCode: () => void;
}

export const CellFab: React.FC<CellFabProps> = ({ onAddMarkdown, onAddCode }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="notelab-no-print fixed bottom-4 right-4 z-30 flex flex-col items-end gap-2">
      {expanded && (
        <div className="flex flex-col items-end gap-2 mb-1">
          <button
            type="button"
            onClick={() => {
              setExpanded(false);
              onAddCode();
            }}
            className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-2xl bg-secondary-container text-on-secondary-container shadow-md text-xs font-medium hover:opacity-95 transition-all"
          >
            <Code2 className="w-4 h-4" />
            <span>Celda Python</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setExpanded(false);
              onAddMarkdown();
            }}
            className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-2xl bg-secondary-container text-on-secondary-container shadow-md text-xs font-medium hover:opacity-95 transition-all"
          >
            <FileText className="w-4 h-4" />
            <span>Celda Markdown</span>
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-label={expanded ? 'Cerrar menú de inserción' : 'Insertar nueva celda'}
        title="Insertar celda (Ctrl+B)"
        className="w-12 h-12 rounded-2xl bg-primary-container text-on-primary-container shadow-lg hover:shadow-xl active:scale-95 flex items-center justify-center transition-all"
      >
        {expanded ? <X className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
      </button>
    </div>
  );
};
