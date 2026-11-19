import React, { useEffect, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { ControlToken, EvaluatedSymbol, ProseBlock } from '../../engine/parser/types';
import { MarkdownRenderer } from '../MarkdownRenderer';

interface ReactiveProseViewProps {
  block: ProseBlock;
  interpolatedSource: string;
  symbols: ReadonlyMap<string, EvaluatedSymbol>;
  isDark: boolean;
  onUpdateControl: (block: ProseBlock, control: ControlToken, nextValueExpr: string) => void;
}

const SingleControlWidget: React.FC<{
  control: ControlToken;
  symbol?: EvaluatedSymbol;
  onCommit: (nextValueExpr: string) => void;
}> = ({ control, symbol, onCommit }) => {
  const [draftNum, setDraftNum] = useState<string>(
    control.numericPart !== null ? String(control.numericPart) : control.valueExpr
  );

  useEffect(() => {
    setDraftNum(
      control.numericPart !== null ? String(control.numericPart) : control.valueExpr
    );
  }, [control.numericPart, control.valueExpr]);

  const formatWithUnit = (numStr: string): string => {
    const cleaned = numStr.trim();
    if (!cleaned) return control.valueExpr;
    return control.unitSuffix ? `${cleaned} ${control.unitSuffix}` : cleaned;
  };

  if (control.widget === 'slider') {
    const min = control.min ?? 0;
    const max = control.max ?? 100;
    const step = control.step ?? (max - min <= 10 ? 0.1 : 1);
    const currentVal = control.numericPart ?? min;

    return (
      <div
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        className="inline-flex items-center gap-2.5 px-3 py-1.5 rounded-2xl bg-surface-container border border-outline-variant/60 text-xs"
      >
        <span className="font-mono font-semibold text-primary">{control.name}</span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={currentVal}
          aria-label={`Control deslizante para ${control.name}`}
          onChange={(e) => {
            onCommit(formatWithUnit(e.target.value));
          }}
          className="w-28 sm:w-36 accent-primary cursor-pointer"
        />
        <span className="font-mono font-medium text-on-surface tabular-nums min-w-[4.2rem] text-right">
          {symbol?.value ? symbol.value.formattedText : control.valueExpr}
        </span>
      </div>
    );
  }

  if (control.widget === 'select') {
    const options = control.options ?? [];
    const currentValue = control.valueExpr;
    const allOptions = options.includes(currentValue)
      ? options
      : [currentValue, ...options];

    return (
      <label
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-2xl bg-surface-container border border-outline-variant/60 text-xs"
      >
        <span className="font-mono font-semibold text-primary">{control.name}</span>
        <select
          value={currentValue}
          aria-label={`Selector para ${control.name}`}
          onChange={(e) => onCommit(e.target.value)}
          className="bg-surface-container-lowest text-on-surface font-mono text-xs px-2 py-0.5 rounded-lg border border-outline-variant/70 focus:border-primary outline-none cursor-pointer"
        >
          {allOptions.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </label>
    );
  }

  // Default: 'input'
  return (
    <label
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-2xl bg-surface-container border border-outline-variant/60 text-xs"
    >
      <span className="font-mono font-semibold text-primary">{control.name}</span>
      <input
        type="number"
        value={draftNum}
        min={control.min}
        max={control.max}
        step={control.step ?? 'any'}
        aria-label={`Entrada numérica para ${control.name}`}
        onChange={(e) => {
          const val = e.target.value;
          setDraftNum(val);
          if (val !== '' && !Number.isNaN(Number(val))) {
            onCommit(formatWithUnit(val));
          }
        }}
        className="w-20 bg-surface-container-lowest text-on-surface font-mono text-xs tabular-nums px-2 py-0.5 rounded-lg border border-outline-variant/70 focus:border-primary outline-none"
      />
      {control.unitSuffix && (
        <span className="font-mono text-on-surface-variant">{control.unitSuffix}</span>
      )}
    </label>
  );
};

export const ReactiveProseView: React.FC<ReactiveProseViewProps> = ({
  block,
  interpolatedSource,
  symbols,
  isDark,
  onUpdateControl,
}) => {
  return (
    <div className="space-y-2">
      <MarkdownRenderer source={interpolatedSource} isDark={isDark} />

      {block.controls.length > 0 && (
        <div
          className="no-print flex flex-wrap items-center gap-2 pt-1"
          aria-label="Controles paramétricos del párrafo"
        >
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-on-surface-variant/80 select-none">
            <SlidersHorizontal className="w-3 h-3 text-primary" />
          </span>
          {block.controls.map((ctrl) => (
            <SingleControlWidget
              key={ctrl.id}
              control={ctrl}
              symbol={symbols.get(ctrl.name)}
              onCommit={(nextVal) => onUpdateControl(block, ctrl, nextVal)}
            />
          ))}
        </div>
      )}
    </div>
  );
};
