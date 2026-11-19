import React from 'react';
import { Hash, ListTree, X } from 'lucide-react';
import { SectionNode } from '../../engine/parser/types';

interface ReactiveOutlineSheetProps {
  open: boolean;
  sections: SectionNode[];
  activeSectionId: string | null;
  onSelectSection: (section: SectionNode) => void;
  onClose: () => void;
}

export const ReactiveOutlineSheet: React.FC<ReactiveOutlineSheetProps> = ({
  open,
  sections,
  activeSectionId,
  onSelectSection,
  onClose,
}) => {
  if (!open) return null;

  const headingSections = sections.filter((s) => s.level > 0);

  return (
    <div className="fixed inset-0 z-50 flex justify-end no-print">
      <div
        className="fixed inset-0 bg-scrim/40 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <aside
        className="relative z-10 w-80 max-w-[85vw] h-full bg-surface-container-low border-l border-outline-variant/60 shadow-xl flex flex-col"
        aria-label="Índice jerárquico del documento"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant/50">
          <div className="flex items-center gap-2 text-sm font-semibold text-on-surface">
            <ListTree className="w-4 h-4 text-primary" />
            <span>Estructura del Documento</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full text-on-surface-variant hover:bg-surface-container-highest transition-colors"
            aria-label="Cerrar índice"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2.5 space-y-0.5">
          {headingSections.length === 0 ? (
            <p className="text-sm text-on-surface-variant/75 px-3 py-4">
              Agregá títulos con <code className="font-mono">#</code>,{' '}
              <code className="font-mono">##</code> o <code className="font-mono">###</code> para
              construir el índice jerárquico automáticamente.
            </p>
          ) : (
            headingSections.map((sec) => {
              const indentPx = Math.max(0, sec.level - 1) * 14;
              const isActive = sec.id === activeSectionId;
              return (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => {
                    onSelectSection(sec);
                    onClose();
                  }}
                  style={{ paddingLeft: `${12 + indentPx}px` }}
                  className={`w-full text-left pr-3 py-2 rounded-xl flex items-center gap-2 text-sm transition-colors ${
                    isActive
                      ? 'bg-secondary-container text-on-secondary-container font-semibold'
                      : 'text-on-surface hover:bg-surface-container-high'
                  }`}
                >
                  <Hash className="w-3.5 h-3.5 shrink-0 opacity-60" />
                  <span className="truncate">{sec.title}</span>
                  <span className="ml-auto text-[10px] font-mono opacity-55">
                    H{sec.level}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </aside>
    </div>
  );
};
