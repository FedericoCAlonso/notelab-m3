import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

interface MarkdownRendererProps {
  source: string;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = React.memo(({ source }) => {
  if (!source.trim()) {
    return (
      <p className="text-sm italic text-on-surface-variant/65 py-1 select-none">
        Celda Markdown vacía — presiona Enter o toca para editar
      </p>
    );
  }

  return (
    <div className="notelab-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          table({ children, ...props }) {
            return (
              <div className="notelab-table-scroll">
                <table {...props}>{children}</table>
              </div>
            );
          },
          a({ children, href, ...props }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                {...props}
              >
                {children}
              </a>
            );
          },
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
});

MarkdownRenderer.displayName = 'MarkdownRenderer';
