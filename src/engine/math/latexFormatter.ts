import { MathNode } from 'mathjs';
import { EvaluatedValue, RenderMode } from '../parser/types';
import { formatNumberSmart, formatUnitStringToTex } from './unitRegistry';

const GREEK_LETTERS = new Set([
  'alpha',
  'beta',
  'gamma',
  'Gamma',
  'delta',
  'Delta',
  'epsilon',
  'zeta',
  'eta',
  'theta',
  'Theta',
  'iota',
  'kappa',
  'lambda',
  'Lambda',
  'mu',
  'nu',
  'xi',
  'Xi',
  'pi',
  'Pi',
  'rho',
  'sigma',
  'Sigma',
  'tau',
  'upsilon',
  'phi',
  'Phi',
  'chi',
  'psi',
  'Psi',
  'omega',
  'Omega',
]);

const TEX_STANDARD_FUNCS = new Set(['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'log', 'ln', 'exp', 'min', 'max']);

interface AnyNode {
  type: string;
  op?: string;
  fn?: string | AnyNode;
  name?: string;
  value?: unknown;
  args?: AnyNode[];
  content?: AnyNode;
  object?: AnyNode;
  index?: AnyNode & {
    dimensions?: AnyNode[];
    isObjectProperty?: () => boolean;
    getObjectProperty?: () => string;
  };
}

function escapeTexText(str: string): string {
  return str.replace(/([%$#_{}&])/g, '\\$1');
}

function formatBaseIdent(ident: string): string {
  if (GREEK_LETTERS.has(ident)) {
    return `\\${ident}`;
  }
  if (ident.length <= 2) {
    return ident;
  }
  return `\\text{${escapeTexText(ident)}}`;
}

export function formatSymbolToTex(name: string): string {
  const parts = name.split('_').filter((p) => p.length > 0);
  const firstPart = parts[0];
  if (parts.length <= 1 || !firstPart) {
    return formatBaseIdent(name);
  }
  const base = formatBaseIdent(firstPart);
  const subRaw = parts.slice(1).join('_');
  const sub =
    /^\d+$/.test(subRaw) || subRaw.length === 1
      ? subRaw
      : GREEK_LETTERS.has(subRaw)
        ? `\\${subRaw}`
        : `\\text{${escapeTexText(subRaw)}}`;
  return `${base}_{${sub}}`;
}

function operatorPrecedence(op?: string, isUnary = false): number {
  if (isUnary) return 3;
  switch (op) {
    case '+':
    case '-':
      return 1;
    case '*':
    case '/':
      return 2;
    case '^':
      return 4;
    default:
      return 5;
  }
}

interface TexRenderContext {
  substitute: boolean;
  symbols: ReadonlyMap<string, EvaluatedValue>;
  decimals: number | null;
  didSubstitute: boolean;
}

function wrapParens(tex: string): string {
  return `\\left(${tex}\\right)`;
}

function renderNodeToTex(
  rawNode: AnyNode,
  ctx: TexRenderContext,
  parentPrec = 0,
  isRightChild = false
): string {
  if (rawNode.type === 'ParenthesisNode' && rawNode.content) {
    const inner = renderNodeToTex(rawNode.content, ctx, 0, false);
    return wrapParens(inner);
  }

  if (rawNode.type === 'ConstantNode') {
    if (typeof rawNode.value === 'number') {
      return formatNumberSmart(rawNode.value, ctx.decimals, false);
    }
    if (typeof rawNode.value === 'string') {
      return `\\text{"${escapeTexText(rawNode.value)}"}`;
    }
    return String(rawNode.value ?? '');
  }

  if (rawNode.type === 'SymbolNode' && rawNode.name) {
    if (ctx.substitute) {
      const resolved = ctx.symbols.get(rawNode.name);
      if (resolved) {
        ctx.didSubstitute = true;
        const valTex = resolved.formattedTex;
        const isNegative = resolved.numericValue !== null && resolved.numericValue < 0;
        const needsWrap =
          (isNegative && parentPrec >= 2) ||
          (resolved.isUnit && parentPrec >= 4);
        return needsWrap ? wrapParens(valTex) : valTex;
      }
    }
    return formatSymbolToTex(rawNode.name);
  }

  if (rawNode.type === 'FunctionNode') {
    const fnNode = rawNode.fn as AnyNode | undefined;
    const args = rawNode.args ?? [];

    // Physical quantity literal: __qty(220, "V")
    if (fnNode?.type === 'SymbolNode' && fnNode.name === '__qty' && args.length === 2) {
      const [arg0, arg1] = args;
      const numVal = typeof arg0?.value === 'number' ? arg0.value : Number(arg0?.value);
      const unitStr = String(arg1?.value ?? '');
      const numTex = formatNumberSmart(numVal, null, false);
      const unitTex = formatUnitStringToTex(unitStr);
      const qtyTex = unitTex.startsWith('^\\circ')
        ? `${numTex}${unitTex}`
        : `${numTex}\\,${unitTex}`;
      const needsWrap = (numVal < 0 && parentPrec >= 2) || parentPrec >= 4;
      return needsWrap ? wrapParens(qtyTex) : qtyTex;
    }

    // Method call like materiales.fila("Cable")
    if (fnNode?.type === 'AccessorNode') {
      const fnTex = renderNodeToTex(fnNode, ctx, 0, false);
      const argsTex = args.map((a) => renderNodeToTex(a, ctx, 0, false)).join(', ');
      return `${fnTex}${wrapParens(argsTex)}`;
    }

    const fnName = fnNode?.type === 'SymbolNode' ? (fnNode.name ?? '') : '';
    const firstArg = args[0];

    if (fnName === 'sqrt' && args.length === 1 && firstArg) {
      return `\\sqrt{${renderNodeToTex(firstArg, ctx, 0, false)}}`;
    }
    if (fnName === 'abs' && args.length === 1 && firstArg) {
      return `\\left|${renderNodeToTex(firstArg, ctx, 0, false)}\\right|`;
    }
    if (fnName === 'sum' && args.length === 1 && firstArg) {
      return `\\sum\\left(${renderNodeToTex(firstArg, ctx, 0, false)}\\right)`;
    }

    const fnTex = TEX_STANDARD_FUNCS.has(fnName)
      ? `\\${fnName}`
      : `\\operatorname{${escapeTexText(fnName)}}`;
    const argsTex = args.map((a) => renderNodeToTex(a, ctx, 0, false)).join(', ');
    return `${fnTex}${wrapParens(argsTex)}`;
  }

  if (rawNode.type === 'AccessorNode' && rawNode.object) {
    const objTex = renderNodeToTex(rawNode.object, ctx, 5, false);
    if (
      rawNode.index &&
      typeof rawNode.index.isObjectProperty === 'function' &&
      rawNode.index.isObjectProperty()
    ) {
      const prop = rawNode.index.getObjectProperty?.() ?? '';
      if (prop === '__row') {
        return objTex;
      }
      return `${objTex}.\\text{${escapeTexText(prop)}}`;
    }
    const dims = (rawNode.index?.dimensions ?? [])
      .map((d) => renderNodeToTex(d, ctx, 0, false))
      .join(', ');
    return `${objTex}\\left[${dims}\\right]`;
  }

  if (rawNode.type === 'OperatorNode' && rawNode.args) {
    const op = rawNode.op;
    if (rawNode.args.length === 1 && rawNode.args[0]) {
      const argTex = renderNodeToTex(rawNode.args[0], ctx, 3, true);
      const res = op === '-' ? `-${argTex}` : `${op ?? ''}${argTex}`;
      return parentPrec > 3 ? wrapParens(res) : res;
    }

    if (rawNode.args.length === 2 && rawNode.args[0] && rawNode.args[1]) {
      const [left, right] = rawNode.args;
      const myPrec = operatorPrecedence(op, false);

      if (op === '/') {
        const leftTex = renderNodeToTex(left, ctx, 0, false);
        const rightTex = renderNodeToTex(right, ctx, 0, false);
        const frac = `\\frac{${leftTex}}{${rightTex}}`;
        return parentPrec >= 4 ? wrapParens(frac) : frac;
      }

      if (op === '^') {
        const baseTex = renderNodeToTex(left, ctx, 4, false);
        const expTex = renderNodeToTex(right, ctx, 0, false);
        return `{${baseTex}}^{${expTex}}`;
      }

      const leftTex = renderNodeToTex(left, ctx, myPrec, false);
      const rightTex = renderNodeToTex(right, ctx, op === '-' ? myPrec + 1 : myPrec, true);
      const opTex = op === '*' ? ' \\cdot ' : ` ${op ?? ''} `;
      const combined = `${leftTex}${opTex}${rightTex}`;
      const needsParens = myPrec < parentPrec || (isRightChild && myPrec === parentPrec && op === '-');
      return needsParens ? wrapParens(combined) : combined;
    }
  }

  return '';
}

export interface FormattedCalcTex {
  symbolicTex: string;
  substitutedTex: string;
  resultTex: string;
  fullTex: string;
}

export function formatCalcStatementToTex(params: {
  target?: string;
  rewrittenAst: MathNode;
  resultValue: EvaluatedValue;
  symbols: ReadonlyMap<string, EvaluatedValue>;
  renderMode: RenderMode;
  decimals: number | null;
}): FormattedCalcTex {
  const { target, rewrittenAst, resultValue, symbols, renderMode, decimals } = params;
  const anyAst = rewrittenAst as unknown as AnyNode;

  const symCtx: TexRenderContext = {
    substitute: false,
    symbols,
    decimals,
    didSubstitute: false,
  };
  const symbolicTex = renderNodeToTex(anyAst, symCtx, 0, false);

  const subCtx: TexRenderContext = {
    substitute: true,
    symbols,
    decimals,
    didSubstitute: false,
  };
  const substitutedTex = renderNodeToTex(anyAst, subCtx, 0, false);
  const resultTex = resultValue.formattedTex;

  const lhsPrefix = target ? `${formatSymbolToTex(target)} = ` : '';

  const normalizeCompare = (s: string) => s.replace(/\s+/g, '');

  const parts: string[] = [];

  if (renderMode === 'result') {
    parts.push(resultTex);
  } else if (renderMode === 'formula') {
    if (normalizeCompare(symbolicTex) !== normalizeCompare(resultTex)) {
      parts.push(symbolicTex);
    }
    parts.push(resultTex);
  } else {
    // 'full' (or 'hidden' previewed in Author mode)
    if (normalizeCompare(symbolicTex) !== normalizeCompare(resultTex)) {
      parts.push(symbolicTex);
    }
    if (
      subCtx.didSubstitute &&
      normalizeCompare(substitutedTex) !== normalizeCompare(symbolicTex) &&
      normalizeCompare(substitutedTex) !== normalizeCompare(resultTex)
    ) {
      parts.push(substitutedTex);
    }
    parts.push(resultTex);
  }

  const fullTex = `${lhsPrefix}${parts.join(' = ')}`;

  return {
    symbolicTex,
    substitutedTex,
    resultTex,
    fullTex,
  };
}
