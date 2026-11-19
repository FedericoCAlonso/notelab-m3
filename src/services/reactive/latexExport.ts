import { EvaluatedDocument, EvaluatedTable } from '../../engine/parser/types';

function escapeLatexText(text: string): string {
  return text
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([%$#_{}&])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

/**
 * Converts Markdown prose (preserving inline `$...$` and display `$$...$$` math)
 * into clean LaTeX body paragraphs.
 */
function markdownProseToLatex(markdown: string): string {
  // Split around $$...$$ and $...$ math segments so math stays untouched
  const segments = markdown.split(/(\$\$[\s\S]*?\$\$|\$[^$\n]+?\$)/g);
  return segments
    .map((seg, idx) => {
      if (idx % 2 === 1) {
        // Math segment: convert $$...$$ to \[...\]
        if (seg.startsWith('$$') && seg.endsWith('$$')) {
          return `\\[\n${seg.slice(2, -2).trim()}\n\\]`;
        }
        return seg;
      }
      // Plain Markdown segment: handle **bold**, *italic*, `code`
      let out = escapeLatexText(seg);
      out = out.replace(/\*\*(.+?)\*\*/g, '\\textbf{$1}');
      out = out.replace(/\*(.+?)\*/g, '\\textit{$1}');
      out = out.replace(/`([^`]+)`/g, '\\texttt{$1}');
      return out;
    })
    .join('');
}

function tableToLatex(table: EvaluatedTable): string {
  const colSpec = table.alignments
    .map((a) => (a === 'center' ? 'c' : a === 'right' ? 'r' : 'l'))
    .join('');
  const effectiveSpec = colSpec || 'l'.repeat(Math.max(1, table.headers.length));

  const headerRow = table.headers
    .map((h) => `\\textbf{${escapeLatexText(h)}}`)
    .join(' & ');

  const bodyRows = table.rows.map((row) =>
    row
      .map((cell) => {
        if (cell.error) return '\\textit{Error}';
        const text = cell.value ? cell.value.formattedText : cell.rawText;
        return escapeLatexText(text);
      })
      .join(' & ')
  );

  return [
    '\\begin{table}[h]',
    '\\centering',
    `\\begin{tabular}{${effectiveSpec}}`,
    '\\toprule',
    `${headerRow} \\\\`,
    '\\midrule',
    ...bodyRows.map((r) => `${r} \\\\`),
    '\\bottomrule',
    '\\end{tabular}',
    table.name ? `\\caption{${escapeLatexText(table.name)}}` : '',
    '\\end{table}',
  ]
    .filter(Boolean)
    .join('\n');
}

export function exportEvaluatedDocumentToLatex(
  doc: EvaluatedDocument,
  documentTitle: string
): string {
  const cleanTitle = documentTitle.replace(/\.md$/i, '').trim() || 'Memoria Técnica';
  const bodyParts: string[] = [];

  for (const block of doc.ast.blocks) {
    if (block.kind === 'heading') {
      const cmd =
        block.level === 1
          ? 'section'
          : block.level === 2
            ? 'subsection'
            : block.level === 3
              ? 'subsubsection'
              : 'paragraph';
      bodyParts.push(`\\${cmd}{${escapeLatexText(block.title)}}`);
      continue;
    }

    if (block.kind === 'prose') {
      const interpolated = doc.interpolatedProse.get(block.id) ?? block.raw;
      bodyParts.push(markdownProseToLatex(interpolated));
      continue;
    }

    if (block.kind === 'table') {
      const evalTable = doc.tables.get(block.id);
      if (evalTable) {
        bodyParts.push(tableToLatex(evalTable));
      }
      continue;
    }

    if (block.kind === 'calc') {
      const evalCalc = doc.calcBlocks.get(block.id);
      if (!evalCalc) continue;
      const visibleEquations = evalCalc.lines.filter(
        (l) =>
          l.kind !== 'comment' &&
          l.kind !== 'unit_decl' &&
          l.kind !== 'decimals_decl' &&
          l.renderMode !== 'hidden' &&
          l.fullTex &&
          !l.error
      );
      if (visibleEquations.length === 0) continue;

      if (visibleEquations.length === 1 && visibleEquations[0]?.fullTex) {
        bodyParts.push(`\\[\n${visibleEquations[0].fullTex}\n\\]`);
      } else {
        const alignLines = visibleEquations
          .map((l) => `  ${(l.fullTex ?? '').replace(' = ', ' &= ')}`)
          .join(' \\\\\n');
        bodyParts.push(`\\begin{align*}\n${alignLines}\n\\end{align*}`);
      }
      continue;
    }

    if (block.kind === 'code') {
      if (block.language === 'mermaid' || block.language === 'svg') {
        bodyParts.push(`% Diagrama ${block.language} omitido en exportación .tex`);
      } else {
        bodyParts.push(`\\begin{verbatim}\n${block.content}\n\\end{verbatim}`);
      }
    }
  }

  return [
    '\\documentclass[11pt,a4paper]{article}',
    '\\usepackage[utf8]{inputenc}',
    '\\usepackage[T1]{fontenc}',
    '\\usepackage[spanish]{babel}',
    '\\usepackage{amsmath,amssymb}',
    '\\usepackage{booktabs}',
    '\\usepackage[margin=2.2cm]{geometry}',
    '',
    `\\title{${escapeLatexText(cleanTitle)}}`,
    '\\date{\\today}',
    '',
    '\\begin{document}',
    '\\maketitle',
    '',
    bodyParts.join('\n\n'),
    '',
    '\\end{document}',
    '',
  ].join('\n');
}

export function downloadReactiveLatex(
  path: string,
  doc: EvaluatedDocument
): void {
  const baseName = (path.split('/').pop() || 'memoria').replace(/\.md$/i, '');
  const texContent = exportEvaluatedDocumentToLatex(doc, baseName);
  const blob = new Blob([texContent], { type: 'application/x-tex;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `${baseName}.tex`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
