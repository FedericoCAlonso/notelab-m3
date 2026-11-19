import React from 'react';
import { Package } from 'lucide-react';
import {
  CellOutput,
  MimeBundle,
  normalizeMultiline,
} from '../types/nbformat';
import { mapImportToPackage, parseMissingModule } from '../services/python/packageManager';

interface CellOutputRendererProps {
  outputs: CellOutput[];
  onInstallModule?: (moduleName: string) => void;
}

// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_REGEX = /\u001b\[[0-9;]*[a-zA-Z]/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_REGEX, '');
}

function sanitizeHtmlOutput(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '');
}

function renderMimeBundle(data: MimeBundle, key: string): React.ReactNode {
  if (typeof data['image/png'] === 'string') {
    const src = data['image/png'].startsWith('data:')
      ? data['image/png']
      : `data:image/png;base64,${data['image/png'].replace(/\s+/g, '')}`;
    return (
      <div key={key} className="my-1.5 overflow-x-auto">
        <img
          src={src}
          alt="Resultado gráfico Python"
          className="max-w-full h-auto rounded-lg bg-white p-1.5 border border-outline-variant/40"
        />
      </div>
    );
  }

  if (typeof data['image/jpeg'] === 'string') {
    const src = data['image/jpeg'].startsWith('data:')
      ? data['image/jpeg']
      : `data:image/jpeg;base64,${data['image/jpeg'].replace(/\s+/g, '')}`;
    return (
      <div key={key} className="my-1.5 overflow-x-auto">
        <img
          src={src}
          alt="Resultado gráfico Python"
          className="max-w-full h-auto rounded-lg border border-outline-variant/40"
        />
      </div>
    );
  }

  if (data['image/svg+xml']) {
    const svgText = normalizeMultiline(data['image/svg+xml']);
    const svgDataUri = `data:image/svg+xml;utf8,${encodeURIComponent(svgText)}`;
    return (
      <div key={key} className="my-1.5 overflow-x-auto">
        <img
          src={svgDataUri}
          alt="Gráfico SVG Python"
          className="max-w-full h-auto rounded-lg bg-white p-1.5 border border-outline-variant/40"
        />
      </div>
    );
  }

  if (data['text/html']) {
    const rawHtml = normalizeMultiline(data['text/html']);
    const safeHtml = sanitizeHtmlOutput(rawHtml);
    return (
      <div
        key={key}
        className="notelab-html-output my-1.5 rounded-lg border border-outline-variant/50 bg-surface-container-lowest p-2"
        dangerouslySetInnerHTML={{ __html: safeHtml }}
      />
    );
  }

  if (data['text/plain']) {
    const text = stripAnsi(normalizeMultiline(data['text/plain']));
    return (
      <pre
        key={key}
        className="font-mono text-[14.5px] leading-[1.45] whitespace-pre overflow-x-auto text-on-surface py-1 m-0"
      >
        {text}
      </pre>
    );
  }

  return null;
}

export const CellOutputRenderer: React.FC<CellOutputRendererProps> = React.memo(
  ({ outputs, onInstallModule }) => {
  if (!outputs || outputs.length === 0) return null;

  return (
    <div className="mt-2 pt-2 border-t border-outline-variant/60 space-y-1.5">
      {outputs.map((output, idx) => {
        const key = `${output.output_type}-${idx}`;

        if (output.output_type === 'stream') {
          const text = stripAnsi(normalizeMultiline(output.text));
          const isStderr = output.name === 'stderr';
          return (
            <pre
              key={key}
              className={`font-mono text-[14.5px] leading-[1.45] whitespace-pre overflow-x-auto rounded-lg px-2.5 py-1.5 m-0 ${
                isStderr
                  ? 'bg-error-container/45 text-on-error-container'
                  : 'bg-surface-container-low text-on-surface'
              }`}
            >
              {text}
            </pre>
          );
        }

        if (output.output_type === 'execute_result' || output.output_type === 'display_data') {
          return renderMimeBundle(output.data, key);
        }

        if (output.output_type === 'error') {
          const traceText = output.traceback.map(stripAnsi).join('\n');
          const missingModule = parseMissingModule(output.ename, output.evalue);
          const suggestedPackage = missingModule ? mapImportToPackage(missingModule) : null;
          return (
            <div
              key={key}
              className="rounded-xl bg-error-container/70 text-on-error-container px-3 py-2 border border-error/40"
            >
              <div className="font-mono text-sm font-semibold">
                {output.ename}: {output.evalue}
              </div>
              {suggestedPackage && onInstallModule && (
                <button
                  type="button"
                  onClick={() => onInstallModule(suggestedPackage)}
                  className="notelab-no-print mt-1.5 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary text-on-primary text-xs font-semibold"
                >
                  <Package className="w-3.5 h-3.5" />
                  <span>Instalar {suggestedPackage}</span>
                </button>
              )}
              {traceText && (
                <pre className="font-mono text-xs leading-relaxed whitespace-pre overflow-x-auto mt-1.5 m-0 opacity-90">
                  {traceText}
                </pre>
              )}
            </div>
          );
        }

        return null;
      })}
    </div>
  );
  }
);

CellOutputRenderer.displayName = 'CellOutputRenderer';
