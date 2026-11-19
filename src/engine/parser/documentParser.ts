import {
  CalcBlock,
  CalcStatement,
  CodeBlock,
  ComputedColumnDef,
  ControlToken,
  ControlWidgetType,
  DocBlock,
  HeadingBlock,
  InlineToken,
  ParsedTableRow,
  ProseBlock,
  ReactiveDocumentAST,
  RenderMode,
  SectionNode,
  TableBlock,
  UnitDeclaration,
} from './types';
import { splitTargetUnit } from '../math/expressionEvaluator';

const RENDER_MODE_ALIASES: Record<string, RenderMode> = {
  completo: 'full',
  full: 'full',
  formula: 'formula',
  fórmula: 'formula',
  resultado: 'result',
  result: 'result',
  oculto: 'hidden',
  hide: 'hidden',
  hidden: 'hidden',
};

function parseRenderModeToken(token: string | undefined, fallback: RenderMode): RenderMode {
  if (!token) return fallback;
  const cleaned = token.trim().replace(/^@/, '').toLowerCase();
  return RENDER_MODE_ALIASES[cleaned] ?? fallback;
}

function unwrapDirectiveLine(line: string): string {
  const trimmed = line.trim();
  const commentMatch = trimmed.match(/^<!--\s*(@.+?)\s*-->$/);
  if (commentMatch && commentMatch[1]) {
    return commentMatch[1].trim();
  }
  return trimmed;
}

function stripTrailingComment(line: string): string {
  let inQuote: string | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuote) {
      if (ch === inQuote && line[i - 1] !== '\\') {
        inQuote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      continue;
    }
    if (ch === '#') {
      return line.slice(0, i).trim();
    }
    if (ch === '/' && line[i + 1] === '/') {
      return line.slice(0, i).trim();
    }
  }
  return line.trim();
}

function slugifyHeading(title: string, seen: Map<string, number>): string {
  const base = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-') || 'seccion';
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return count === 0 ? base : `${base}-${count + 1}`;
}

function isTableSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return false;
  const stripped = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  const parts = stripped.split('|').map((p) => p.trim());
  if (parts.length === 0) return false;
  return parts.every((p) => /^:?-{2,}:?$/.test(p));
}

function parseTableRowCells(line: string): string[] {
  const trimmed = line.trim();
  const stripped = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let current = '';
  for (let i = 0; i < stripped.length; i += 1) {
    const ch = stripped[i];
    if (ch === '\\' && stripped[i + 1] === '|') {
      current += '|';
      i += 1;
      continue;
    }
    if (ch === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

function parseTableAlignments(sepLine: string): Array<'left' | 'center' | 'right' | null> {
  return parseTableRowCells(sepLine).map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return null;
  });
}

function isTableHeaderStart(lines: string[], idx: number): boolean {
  const headerRaw = lines[idx];
  const sepRaw = lines[idx + 1];
  if (headerRaw === undefined || sepRaw === undefined) return false;
  const headerLine = headerRaw.trim();
  if (!headerLine.includes('|')) return false;
  return isTableSeparatorLine(sepRaw);
}

function parseCalcStatement(
  rawLine: string,
  lineNum: number,
  blockId: string,
  stmtIndex: number,
  defaultMode: RenderMode
): CalcStatement | null {
  const trimmed = rawLine.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('#') || trimmed.startsWith('//')) {
    return {
      id: `${blockId}-s${stmtIndex}`,
      line: lineNum,
      raw: rawLine,
      kind: 'comment',
      renderMode: defaultMode,
    };
  }

  const withoutComment = stripTrailingComment(trimmed);
  if (!withoutComment) {
    return {
      id: `${blockId}-s${stmtIndex}`,
      line: lineNum,
      raw: rawLine,
      kind: 'comment',
      renderMode: defaultMode,
    };
  }

  // @unidad <name> [= <def>]
  const unitMatch = withoutComment.match(/^@unidad\s+([A-Za-z][A-Za-z0-9_]*)(?:\s*=\s*(.+))?$/i);
  if (unitMatch && unitMatch[1]) {
    return {
      id: `${blockId}-s${stmtIndex}`,
      line: lineNum,
      raw: rawLine,
      kind: 'unit_decl',
      renderMode: 'hidden',
      unitDecl: {
        name: unitMatch[1].trim(),
        definition: unitMatch[2]?.trim(),
        line: lineNum,
      },
    };
  }

  // @decimales <n>
  const decMatch = withoutComment.match(/^@decimales\s+(\d+)$/i);
  if (decMatch && decMatch[1]) {
    return {
      id: `${blockId}-s${stmtIndex}`,
      line: lineNum,
      raw: rawLine,
      kind: 'decimals_decl',
      renderMode: 'hidden',
      decimals: Number(decMatch[1]),
    };
  }

  // Optional trailing @mode suffix
  let body = withoutComment;
  let renderMode = defaultMode;
  const modeMatch = body.match(/\s+@(completo|full|formula|fórmula|resultado|result|oculto|hide|hidden)$/i);
  if (modeMatch && modeMatch[1]) {
    renderMode = parseRenderModeToken(modeMatch[1], defaultMode);
    body = body.slice(0, modeMatch.index).trim();
  }

  // Assignment: ident = expr
  const assignMatch = body.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)\s*(.+)$/);
  if (assignMatch && assignMatch[1] && assignMatch[2]) {
    const target = assignMatch[1].trim();
    const { expr, targetUnit } = splitTargetUnit(assignMatch[2]);
    return {
      id: `${blockId}-s${stmtIndex}`,
      line: lineNum,
      raw: rawLine,
      kind: 'assignment',
      target,
      expression: expr,
      targetUnit,
      renderMode,
    };
  }

  const { expr, targetUnit } = splitTargetUnit(body);
  return {
    id: `${blockId}-s${stmtIndex}`,
    line: lineNum,
    raw: rawLine,
    kind: 'expression',
    expression: expr,
    targetUnit,
    renderMode,
  };
}

/**
 * Finds all `{{ ... }}` inline directives/interpolations in a prose block,
 * ignoring inline code spans (`` `...` ``) and tracking whether each token
 * sits inside LaTeX math (`$...$` or `$$...$$`).
 */
export function extractInlineTokens(
  raw: string,
  blockId: string,
  blockStartLine: number
): InlineToken[] {
  const tokens: InlineToken[] = [];
  let inCodeTicks = 0;
  let inBlockMath = false;
  let inInlineMath = false;
  let lineOffset = 0;
  let tokenIdx = 0;

  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];

    if (ch === '\n') {
      lineOffset += 1;
      i += 1;
      continue;
    }

    if (ch === '\\' && i + 1 < raw.length) {
      i += 2;
      continue;
    }

    // Track inline code spans
    if (ch === '`' && !inBlockMath && !inInlineMath) {
      let tickCount = 0;
      while (i + tickCount < raw.length && raw[i + tickCount] === '`') {
        tickCount += 1;
      }
      if (inCodeTicks === 0) {
        inCodeTicks = tickCount;
      } else if (inCodeTicks === tickCount) {
        inCodeTicks = 0;
      }
      i += tickCount;
      continue;
    }

    if (inCodeTicks > 0) {
      i += 1;
      continue;
    }

    // Track $$ and $ math regions
    if (ch === '$') {
      if (raw[i + 1] === '$') {
        inBlockMath = !inBlockMath;
        i += 2;
        continue;
      }
      if (!inBlockMath) {
        inInlineMath = !inInlineMath;
        i += 1;
        continue;
      }
    }

    // Detect {{ ... }}
    if (ch === '{' && raw[i + 1] === '{') {
      const closeIdx = raw.indexOf('}}', i + 2);
      if (closeIdx >= 0) {
        const inner = raw.slice(i + 2, closeIdx).trim();
        const tokenRaw = raw.slice(i, closeIdx + 2);
        const line = blockStartLine + lineOffset + 1; // 1-based

        if (inner) {
          const defMatch = inner.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:=\s*(.+)$/);
          if (defMatch && defMatch[1] && defMatch[2]) {
            const { expr, targetUnit } = splitTargetUnit(defMatch[2]);
            tokens.push({
              id: `${blockId}-t${tokenIdx++}`,
              raw: tokenRaw,
              startOffset: i,
              endOffset: closeIdx + 2,
              line,
              kind: 'define',
              target: defMatch[1].trim(),
              expression: expr,
              targetUnit,
              inMathContext: inBlockMath || inInlineMath,
            });
          } else {
            const { expr, targetUnit } = splitTargetUnit(inner);
            tokens.push({
              id: `${blockId}-t${tokenIdx++}`,
              raw: tokenRaw,
              startOffset: i,
              endOffset: closeIdx + 2,
              line,
              kind: 'interpolate',
              expression: expr,
              targetUnit,
              inMathContext: inBlockMath || inInlineMath,
            });
          }
        }

        // Advance lineOffset for any newlines inside {{ ... }}
        for (let k = i; k < closeIdx + 2; k += 1) {
          if (raw[k] === '\n') lineOffset += 1;
        }
        i = closeIdx + 2;
        continue;
      }
    }

    i += 1;
  }

  return tokens;
}

function splitNumericAndUnit(valueExpr: string): { numericPart: number | null; unitSuffix: string } {
  const trimmed = valueExpr.trim();
  const match = trimmed.match(/^([+-]?(?:\d+\.?\d*|\.\d+))(?:\s*(.*))?$/);
  if (!match || !match[1]) {
    return { numericPart: null, unitSuffix: '' };
  }
  const num = Number(match[1]);
  return {
    numericPart: Number.isFinite(num) ? num : null,
    unitSuffix: (match[2] ?? '').trim(),
  };
}

function parseControlSpec(specRaw: string): {
  widget: ControlWidgetType;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
} | null {
  const trimmed = specRaw.trim();
  const typeMatch = trimmed.match(/^(input|slider|select)(?:\s+(.*))?$/i);
  if (!typeMatch || !typeMatch[1]) return null;

  const widget = typeMatch[1].toLowerCase() as ControlWidgetType;
  const rest = (typeMatch[2] ?? '').trim();

  if (widget === 'select') {
    const options = rest
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return { widget, options };
  }

  let min: number | undefined;
  let max: number | undefined;
  let step: number | undefined;

  // Support range shorthand `0..20` or `-10..100`
  const rangeMatch = rest.match(/([+-]?(?:\d+\.?\d*|\.\d+))\s*\.\.\s*([+-]?(?:\d+\.?\d*|\.\d+))/);
  if (rangeMatch && rangeMatch[1] && rangeMatch[2]) {
    min = Number(rangeMatch[1]);
    max = Number(rangeMatch[2]);
  }

  const minMatch = rest.match(/\bmin\s*=\s*([+-]?(?:\d+\.?\d*|\.\d+))/i);
  if (minMatch && minMatch[1]) min = Number(minMatch[1]);

  const maxMatch = rest.match(/\bmax\s*=\s*([+-]?(?:\d+\.?\d*|\.\d+))/i);
  if (maxMatch && maxMatch[1]) max = Number(maxMatch[1]);

  const stepMatch = rest.match(/\bstep\s*=\s*([+-]?(?:\d+\.?\d*|\.\d+))/i);
  if (stepMatch && stepMatch[1]) step = Number(stepMatch[1]);

  return { widget, min, max, step };
}

/**
 * Extracts declarative UI controls like:
 *   [V: 220 V | input]
 *   [I: 4.5 A | slider 0..20 step=0.5]
 *   [fp: 0.92 | select 0.8, 0.85, 0.92, 1.0]
 * Ignores inline code, math blocks, and standard Markdown links `[text](url)`.
 */
export function extractControlTokens(
  raw: string,
  blockId: string,
  blockStartLine: number
): ControlToken[] {
  const controls: ControlToken[] = [];
  let inCodeTicks = 0;
  let inBlockMath = false;
  let inInlineMath = false;
  let lineOffset = 0;
  let ctrlIdx = 0;

  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '\n') {
      lineOffset += 1;
      i += 1;
      continue;
    }
    if (ch === '\\' && i + 1 < raw.length) {
      i += 2;
      continue;
    }

    if (ch === '`' && !inBlockMath && !inInlineMath) {
      let tickCount = 0;
      while (i + tickCount < raw.length && raw[i + tickCount] === '`') {
        tickCount += 1;
      }
      if (inCodeTicks === 0) inCodeTicks = tickCount;
      else if (inCodeTicks === tickCount) inCodeTicks = 0;
      i += tickCount;
      continue;
    }
    if (inCodeTicks > 0) {
      i += 1;
      continue;
    }

    if (ch === '$') {
      if (raw[i + 1] === '$') {
        inBlockMath = !inBlockMath;
        i += 2;
        continue;
      }
      if (!inBlockMath) {
        inInlineMath = !inInlineMath;
        i += 1;
        continue;
      }
    }

    if (!inBlockMath && !inInlineMath && ch === '[') {
      const closeIdx = raw.indexOf(']', i + 1);
      // Skip if unclosed, multiline, or immediately followed by `(` (Markdown link)
      if (closeIdx > i + 1 && raw[closeIdx + 1] !== '(') {
        const inner = raw.slice(i + 1, closeIdx);
        if (!inner.includes('\n') && inner.includes('|') && inner.includes(':')) {
          const pipePos = inner.indexOf('|');
          const left = inner.slice(0, pipePos);
          const right = inner.slice(pipePos + 1);
          const colonPos = left.indexOf(':');
          const namePart = colonPos >= 0 ? left.slice(0, colonPos).trim() : '';
          const valuePartRaw = colonPos >= 0 ? left.slice(colonPos + 1) : '';
          const valueExpr = valuePartRaw.trim();
          const parsedSpec = parseControlSpec(right);

          if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(namePart) && valueExpr && parsedSpec) {
            const leadingSpaces = valuePartRaw.length - valuePartRaw.trimStart().length;
            const valueStartOffset = i + 1 + colonPos + 1 + leadingSpaces;
            const valueEndOffset = valueStartOffset + valueExpr.length;
            const { numericPart, unitSuffix } = splitNumericAndUnit(valueExpr);

            controls.push({
              id: `${blockId}-ctrl-${ctrlIdx++}`,
              raw: raw.slice(i, closeIdx + 1),
              startOffset: i,
              endOffset: closeIdx + 1,
              valueStartOffset,
              valueEndOffset,
              line: blockStartLine + lineOffset + 1,
              name: namePart,
              valueExpr,
              numericPart,
              unitSuffix,
              widget: parsedSpec.widget,
              min: parsedSpec.min,
              max: parsedSpec.max,
              step: parsedSpec.step,
              options: parsedSpec.options,
            });
            i = closeIdx + 1;
            continue;
          }
        }
      }
    }

    i += 1;
  }

  return controls;
}

export function parseReactiveDocument(rawInput: string): ReactiveDocumentAST {
  const normalizedRaw = rawInput.replace(/\r\n/g, '\n');
  const lines = normalizedRaw.split('\n');

  const sections: SectionNode[] = [];
  const blocks: DocBlock[] = [];
  const unitDeclarations: UnitDeclaration[] = [];
  let decimals: number | null = null;

  const slugCounts = new Map<string, number>();

  // Section stack for building Markdown heading hierarchy
  const rootSection: SectionNode = {
    id: 'sec-0',
    level: 0,
    title: 'Inicio',
    slug: 'inicio',
    startLine: 0,
    endLine: Math.max(0, lines.length - 1),
    parentId: null,
    childrenIds: [],
    blockIds: [],
  };
  sections.push(rootSection);
  const sectionStack: SectionNode[] = [rootSection];
  let currentSection: SectionNode = rootSection;

  let blockSeq = 0;
  let sectionSeq = 1;

  const nextBlockId = (prefix: string) => `${prefix}-${blockSeq++}`;

  const pushBlock = (block: DocBlock) => {
    blocks.push(block);
    currentSection.blockIds.push(block.id);
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    // Skip blank lines between top-level blocks
    if (!trimmed) {
      i += 1;
      continue;
    }

    // 1. ATX Heading (#..######)
    const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (headingMatch && headingMatch[1] && headingMatch[2]) {
      const level = headingMatch[1].length;
      const title = headingMatch[2].trim();
      const slug = slugifyHeading(title, slugCounts);

      // Pop sections with level >= current heading level
      while (
        sectionStack.length > 1 &&
        (sectionStack[sectionStack.length - 1]?.level ?? 0) >= level
      ) {
        const popped = sectionStack.pop()!;
        popped.endLine = Math.max(popped.startLine, i - 1);
      }

      const parent = sectionStack[sectionStack.length - 1] ?? rootSection;
      const newSection: SectionNode = {
        id: `sec-${sectionSeq++}`,
        level,
        title,
        slug,
        startLine: i,
        endLine: Math.max(i, lines.length - 1),
        parentId: parent.id,
        childrenIds: [],
        blockIds: [],
      };
      parent.childrenIds.push(newSection.id);
      sections.push(newSection);
      sectionStack.push(newSection);
      currentSection = newSection;

      const hBlock: HeadingBlock = {
        kind: 'heading',
        id: nextBlockId('hdg'),
        sectionId: newSection.id,
        startLine: i,
        endLine: i,
        raw: line,
        level,
        title,
        slug,
      };
      pushBlock(hBlock);
      i += 1;
      continue;
    }

    // 2. Fenced blocks (```calc or ```other)
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})\s*([A-Za-z0-9_-]*)(.*)$/);
    if (fenceMatch && fenceMatch[1]) {
      const fenceMarker = fenceMatch[1];
      const fenceChar = fenceMarker[0] ?? '`';
      const lang = (fenceMatch[2] ?? '').toLowerCase();
      const rest = (fenceMatch[3] ?? '').trim();
      const startLine = i;
      i += 1;

      const bodyLines: Array<{ text: string; lineNum: number }> = [];
      const closePattern = new RegExp(`^${fenceChar}{${fenceMarker.length},}\\s*$`);
      while (i < lines.length && !closePattern.test((lines[i] ?? '').trim())) {
        bodyLines.push({ text: lines[i] ?? '', lineNum: i + 1 });
        i += 1;
      }
      const endLine = i < lines.length ? i : lines.length - 1;
      if (i < lines.length) i += 1; // consume closing fence

      const raw = lines.slice(startLine, endLine + 1).join('\n');

      if (lang === 'calc') {
        const blockId = nextBlockId('calc');
        const defaultRenderMode = parseRenderModeToken(rest.split(/\s+/)[0], 'full');
        const statements: CalcStatement[] = [];
        bodyLines.forEach((bLine, idx) => {
          const stmt = parseCalcStatement(
            bLine.text,
            bLine.lineNum,
            blockId,
            idx,
            defaultRenderMode
          );
          if (stmt) {
            statements.push(stmt);
            if (stmt.kind === 'unit_decl' && stmt.unitDecl) {
              unitDeclarations.push(stmt.unitDecl);
            } else if (stmt.kind === 'decimals_decl' && stmt.decimals !== undefined) {
              decimals = stmt.decimals;
            }
          }
        });

        const calcBlock: CalcBlock = {
          kind: 'calc',
          id: blockId,
          sectionId: currentSection.id,
          startLine,
          endLine,
          raw,
          defaultRenderMode,
          statements,
        };
        pushBlock(calcBlock);
      } else {
        const codeBlock: CodeBlock = {
          kind: 'code',
          id: nextBlockId('code'),
          sectionId: currentSection.id,
          startLine,
          endLine,
          raw,
          language: lang,
          content: bodyLines.map((b) => b.text).join('\n'),
        };
        pushBlock(codeBlock);
      }
      continue;
    }

    // 3. Top-level standalone @unidad / @decimales directive outside calc blocks
    const unwrapped = unwrapDirectiveLine(line);
    const topUnitMatch = unwrapped.match(/^@unidad\s+([A-Za-z][A-Za-z0-9_]*)(?:\s*=\s*(.+))?$/i);
    if (topUnitMatch && topUnitMatch[1]) {
      unitDeclarations.push({
        name: topUnitMatch[1].trim(),
        definition: topUnitMatch[2]?.trim(),
        line: i + 1,
      });
      i += 1;
      continue;
    }

    // 4. Named Table directives (@tabla: / @col) OR anonymous GFM table
    const isTableDirective = /^@tabla\s*:/i.test(unwrapped) || /^@col\s+/i.test(unwrapped);
    if (isTableDirective || isTableHeaderStart(lines, i)) {
      const startLine = i;
      let tableName: string | null = null;
      const computedColumns: ComputedColumnDef[] = [];

      let scanIdx = i;
      while (scanIdx < lines.length) {
        const scanLine = lines[scanIdx] ?? '';
        const dirLine = unwrapDirectiveLine(scanLine);
        const tableMatch = dirLine.match(/^@tabla\s*:\s*([A-Za-z_][A-Za-z0-9_]*)$/i);
        if (tableMatch && tableMatch[1]) {
          tableName = tableMatch[1].trim();
          scanIdx += 1;
          continue;
        }
        const colMatch = dirLine.match(/^@col\s+([^=]+?)\s*=\s*(.+)$/i);
        if (colMatch && colMatch[1] && colMatch[2]) {
          const colName = colMatch[1].trim();
          const { expr, targetUnit } = splitTargetUnit(stripTrailingComment(colMatch[2]));
          computedColumns.push({
            name: colName,
            expression: expr,
            targetUnit,
            line: scanIdx + 1,
          });
          scanIdx += 1;
          continue;
        }
        if (!scanLine.trim()) {
          scanIdx += 1;
          continue;
        }
        break;
      }

      if (isTableHeaderStart(lines, scanIdx)) {
        const headers = parseTableRowCells(lines[scanIdx] ?? '');
        const alignments = parseTableAlignments(lines[scanIdx + 1] ?? '');
        let rowIdx = scanIdx + 2;
        const rows: ParsedTableRow[] = [];

        while (rowIdx < lines.length) {
          const rawRowLine = lines[rowIdx] ?? '';
          const rLine = rawRowLine.trim();
          if (!rLine || !rLine.includes('|')) break;
          // Stop if another directive or heading begins
          if (/^#{1,6}\s/.test(rLine) || /^(`{3,}|~{3,})/.test(rLine)) break;
          rows.push({
            line: rowIdx + 1,
            cells: parseTableRowCells(rawRowLine),
          });
          rowIdx += 1;
        }

        const endLine = rowIdx - 1;
        const tableBlock: TableBlock = {
          kind: 'table',
          id: nextBlockId('tbl'),
          sectionId: currentSection.id,
          startLine,
          endLine,
          raw: lines.slice(startLine, endLine + 1).join('\n'),
          tableName,
          computedColumns,
          headers,
          alignments,
          rows,
        };
        pushBlock(tableBlock);
        i = rowIdx;
        continue;
      }
      // If directives weren't followed by a valid GFM table, fall through to prose
    }

    // 5. Prose block (paragraphs, lists, blockquotes, display math $$...$$)
    const startLine = i;
    let inDisplayMath = false;
    while (i < lines.length) {
      const cur = lines[i] ?? '';
      const curTrimmed = cur.trim();

      // Track multi-line $$...$$ blocks so they stay inside the same prose block
      const ddMatches = cur.match(/(?<!\\)\$\$/g);
      if (ddMatches && ddMatches.length % 2 === 1) {
        inDisplayMath = !inDisplayMath;
      }

      if (!inDisplayMath && i > startLine) {
        if (!curTrimmed) break;
        if (/^#{1,6}\s+/.test(cur)) break;
        if (/^(`{3,}|~{3,})/.test(curTrimmed)) break;
        const curDir = unwrapDirectiveLine(cur);
        if (/^@tabla\s*:/i.test(curDir) || /^@col\s+/i.test(curDir)) break;
        if (isTableHeaderStart(lines, i)) break;
      }

      i += 1;
    }

    const endLine = i - 1;
    const raw = lines.slice(startLine, endLine + 1).join('\n');
    const blockId = nextBlockId('prose');
    const inlineTokens = extractInlineTokens(raw, blockId, startLine);
    const controls = extractControlTokens(raw, blockId, startLine);

    const proseBlock: ProseBlock = {
      kind: 'prose',
      id: blockId,
      sectionId: currentSection.id,
      startLine,
      endLine,
      raw,
      inlineTokens,
      controls,
    };
    pushBlock(proseBlock);
  }

  // Close remaining open sections
  while (sectionStack.length > 0) {
    const popped = sectionStack.pop()!;
    popped.endLine = Math.max(popped.startLine, lines.length - 1);
  }

  return {
    raw: normalizedRaw,
    lines,
    sections,
    blocks,
    unitDeclarations,
    decimals,
  };
}

/**
 * Replaces lines [startLine..endLine] (0-based inclusive) with nextBlockRaw,
 * preserving every other byte of the Markdown document.
 */
export function replaceBlockRange(
  rawMarkdown: string,
  startLine: number,
  endLine: number,
  nextBlockRaw: string
): string {
  const normalized = rawMarkdown.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const before = lines.slice(0, startLine);
  const after = lines.slice(endLine + 1);
  const replacementLines = nextBlockRaw.replace(/\r\n/g, '\n').split('\n');
  return [...before, ...replacementLines, ...after].join('\n');
}

export function insertBlockAfterLine(
  rawMarkdown: string,
  afterLine: number,
  newBlockRaw: string
): string {
  const normalized = rawMarkdown.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const clamped = Math.min(Math.max(afterLine, -1), lines.length - 1);
  const before = lines.slice(0, clamped + 1);
  const after = lines.slice(clamped + 1);
  const insertLines = newBlockRaw.replace(/\r\n/g, '\n').split('\n');
  const result = [...before];
  if (result.length > 0 && (result[result.length - 1] ?? '').trim() !== '') {
    result.push('');
  }
  result.push(...insertLines);
  if (after.length > 0 && (after[0] ?? '').trim() !== '') {
    result.push('');
  }
  result.push(...after);
  return result.join('\n');
}

export function deleteBlockRange(
  rawMarkdown: string,
  startLine: number,
  endLine: number
): string {
  const normalized = rawMarkdown.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const before = lines.slice(0, startLine);
  const after = lines.slice(endLine + 1);
  // Collapse double blank lines left behind
  while (
    before.length > 0 &&
    after.length > 0 &&
    (before[before.length - 1] ?? '').trim() === '' &&
    (after[0] ?? '').trim() === ''
  ) {
    after.shift();
  }
  return [...before, ...after].join('\n');
}

/**
 * Bidirectionally updates a declarative control's value directly inside the plain-text Markdown,
 * preserving its surrounding text, widget spec, and every other byte of the document.
 */
export function updateControlValueInMarkdown(
  rawMarkdown: string,
  block: ProseBlock,
  control: ControlToken,
  nextValueExpr: string
): string {
  const cleanVal = nextValueExpr.trim();
  if (!cleanVal) return rawMarkdown;
  const nextBlockRaw =
    block.raw.slice(0, control.valueStartOffset) +
    cleanVal +
    block.raw.slice(control.valueEndOffset);
  return replaceBlockRange(rawMarkdown, block.startLine, block.endLine, nextBlockRaw);
}
