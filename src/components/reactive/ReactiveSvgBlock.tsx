import React, { useMemo } from 'react';
import { AlertCircle } from 'lucide-react';

interface ReactiveSvgBlockProps {
  svgCode: string;
}

/**
 * Strips potentially unsafe elements and inline event handlers from user-authored SVG
 * while preserving pure vector primitives, labels, styles, and parametric dimensions.
 */
export function sanitizeParametricSvg(rawSvg: string): string {
  let clean = rawSvg.trim();
  // Remove dangerous elements completely
  clean = clean.replace(
    /<(script|iframe|object|embed|foreignObject)\b[^>]*>[\s\S]*?<\/\1>/gi,
    ''
  );
  clean = clean.replace(/<(script|iframe|object|embed|foreignObject)\b[^>]*\/?>/gi, '');
  // Remove on* event handlers (onclick, onload, etc.)
  clean = clean.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // Neutralize javascript: URIs
  clean = clean.replace(/(?:href|xlink:href)\s*=\s*["']\s*javascript:[^"']*["']/gi, '');
  return clean;
}

export const ReactiveSvgBlock: React.FC<ReactiveSvgBlockProps> = ({ svgCode }) => {
  const sanitized = useMemo(() => sanitizeParametricSvg(svgCode), [svgCode]);

  const hasSvgTag = /<svg\b/i.test(sanitized);

  if (!hasSvgTag) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-error-container/70 text-on-error-container px-3 py-2 text-xs">
        <AlertCircle className="w-4 h-4 shrink-0" />
        <span>El bloque SVG debe contener una etiqueta raíz &lt;svg&gt;...&lt;/svg&gt;.</span>
      </div>
    );
  }

  return (
    <div
      className="reactive-svg-block break-inside-avoid my-2 p-3 rounded-2xl border border-outline-variant/50 bg-surface-container-lowest/80 overflow-x-auto flex justify-center text-on-surface"
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
};
