import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { CellAttachments } from '../types/nbformat';
import { MermaidBlock } from './MermaidBlock';

interface MarkdownRendererProps {
  source: string;
  attachments?: CellAttachments;
  isDark?: boolean;
}

export function resolveAttachmentUrl(
  src: string | undefined,
  attachments?: CellAttachments
): string | undefined {
  if (!src || !src.startsWith('attachment:') || !attachments) {
    return src;
  }
  const key = src.slice('attachment:'.length);
  const bundle = attachments[key];
  if (!bundle) return src;
  const entry = Object.entries(bundle).find(([, data]) => typeof data === 'string');
  if (!entry) return src;
  const [mime, base64] = entry;
  return base64.startsWith('data:') ? base64 : `data:${mime};base64,${base64}`;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = React.memo(
  ({ source, attachments, isDark = false }) => {
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
          urlTransform={(url) => {
            if (url.startsWith('attachment:')) return url;
            const lower = url.trim().toLowerCase();
            if (
              lower.startsWith('http://') ||
              lower.startsWith('https://') ||
              lower.startsWith('mailto:') ||
              lower.startsWith('data:image/') ||
              lower.startsWith('#') ||
              lower.startsWith('/') ||
              !lower.includes(':')
            ) {
              return url;
            }
            return '';
          }}
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
            img({ src, alt, ...props }) {
              const resolved = resolveAttachmentUrl(src, attachments);
              return (
                <img
                  src={resolved}
                  alt={alt ?? ''}
                  className="max-w-full h-auto rounded-xl border border-outline-variant my-2"
                  {...props}
                />
              );
            },
            pre({ children, ...props }) {
              if (
                React.isValidElement<{ className?: string }>(children) &&
                typeof children.props?.className === 'string' &&
                children.props.className.includes('language-mermaid')
              ) {
                return <>{children}</>;
              }
              return <pre {...props}>{children}</pre>;
            },
            code({ className, children, ...props }) {
              if (typeof className === 'string' && className.includes('language-mermaid')) {
                const rawCode = String(children).replace(/\n$/, '');
                return <MermaidBlock code={rawCode} isDark={isDark} />;
              }
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              );
            },
          }}
        >
          {source}
        </ReactMarkdown>
      </div>
    );
  }
);

MarkdownRenderer.displayName = 'MarkdownRenderer';
