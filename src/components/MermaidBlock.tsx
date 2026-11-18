import React, { useEffect, useId, useState } from 'react';

interface MermaidBlockProps {
  code: string;
  isDark?: boolean;
}

export const MermaidBlock: React.FC<MermaidBlockProps> = React.memo(({ code, isDark = false }) => {
  const reactId = useId();
  const renderId = `mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const renderDiagram = async () => {
      try {
        const mod = await import('mermaid');
        const mermaid = mod.default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: isDark ? 'dark' : 'default',
        });
        const { svg: renderedSvg } = await mermaid.render(`${renderId}-${Date.now()}`, code.trim());
        if (!cancelled) {
          setSvg(renderedSvg);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setSvg(null);
          setError(err instanceof Error ? err.message : 'Error de sintaxis Mermaid');
        }
      }
    };

    void renderDiagram();
    return () => {
      cancelled = true;
    };
  }, [code, isDark, renderId]);

  if (error) {
    return (
      <div className="my-2 rounded-xl border border-error/40 bg-error-container/30 p-3 space-y-1.5">
        <div className="text-xs font-medium text-error">Diagrama Mermaid inválido: {error}</div>
        <pre className="notelab-mono-block !my-0">{code}</pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="my-2 rounded-xl border border-outline-variant bg-surface-container p-4 text-xs text-on-surface-variant">
        Renderizando diagrama Mermaid...
      </div>
    );
  }

  return (
    <div
      className="my-3 overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest p-3 flex justify-center"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
});

MermaidBlock.displayName = 'MermaidBlock';
