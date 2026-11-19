import { MathNode, Unit } from 'mathjs';
import { EvaluatedValue } from '../parser/types';
import { CURRENCY_UNITS, UnitEngine } from './unitRegistry';

export interface ParsedExpressionInfo {
  originalExpr: string;
  normalizedExpr: string;
  targetUnit?: string;
  ast: MathNode;
  rewrittenAst: MathNode;
  dependencies: string[];
}

export interface TableScopeProxy {
  __isReactiveTable: true;
  __rowCount: number;
  __row: (index: number) => Record<string, unknown>;
  fila: (key: string) => Record<string, unknown>;
  [columnName: string]: unknown;
}

const BUILTIN_FUNCTIONS = new Set([
  'sum',
  'avg',
  'mean',
  'min',
  'max',
  'count',
  'sqrt',
  'abs',
  'round',
  'floor',
  'ceil',
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'atan2',
  'log',
  'log10',
  'ln',
  'exp',
  'pow',
  'sign',
  'pi',
  'e',
  'true',
  'false',
  '__qty',
]);

export function normalizeMathText(input: string): string {
  return input
    .replace(/→/g, '->')
    .replace(/Ω/g, 'ohm')
    .replace(/[·×]/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .trim();
}

export function splitTargetUnit(rawExpr: string): { expr: string; targetUnit?: string } {
  const normalized = normalizeMathText(rawExpr);
  // Find top-level `->` not inside quotes or parens
  let depth = 0;
  let inQuote: string | null = null;
  for (let i = 0; i < normalized.length - 1; i += 1) {
    const ch = normalized[i];
    if (inQuote) {
      if (ch === inQuote && normalized[i - 1] !== '\\') {
        inQuote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      continue;
    }
    if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    else if (depth === 0 && ch === '-' && normalized[i + 1] === '>') {
      const expr = normalized.slice(0, i).trim();
      const targetUnit = normalized.slice(i + 2).trim();
      return { expr, targetUnit: targetUnit || undefined };
    }
  }
  return { expr: normalized };
}

interface AnyNode {
  type: string;
  op?: string;
  fn?: string | AnyNode;
  name?: string;
  value?: unknown;
  implicit?: boolean;
  args?: AnyNode[];
  content?: AnyNode;
  object?: AnyNode;
  index?: AnyNode & {
    dimensions?: AnyNode[];
    isObjectProperty?: () => boolean;
    getObjectProperty?: () => string;
  };
  toString: () => string;
}

function collectUnitExpressionSymbols(node: AnyNode): string[] | null {
  if (node.type === 'SymbolNode' && node.name) {
    return [node.name];
  }
  if (node.type === 'ParenthesisNode' && node.content) {
    return collectUnitExpressionSymbols(node.content);
  }
  if (node.type === 'OperatorNode' && node.args) {
    const [arg0, arg1] = node.args;
    if (node.op === '^' && arg0 && arg1) {
      const base = collectUnitExpressionSymbols(arg0);
      const isConstExp =
        arg1.type === 'ConstantNode' ||
        (arg1.type === 'OperatorNode' &&
          arg1.op === '-' &&
          arg1.args?.[0]?.type === 'ConstantNode');
      if (base && isConstExp) return base;
      return null;
    }
    if ((node.op === '*' || node.op === '/') && arg0 && arg1) {
      const left = collectUnitExpressionSymbols(arg0);
      const right = collectUnitExpressionSymbols(arg1);
      if (left && right) return [...left, ...right];
      return null;
    }
  }
  return null;
}

function isPureUnitExpr(node: AnyNode, engine: UnitEngine): boolean {
  const syms = collectUnitExpressionSymbols(node);
  if (!syms || syms.length === 0) return false;
  return syms.every((s) => engine.isKnownUnitToken(s));
}

function extractNumericLiteral(node: AnyNode): number | null {
  if (node.type === 'ConstantNode' && typeof node.value === 'number') {
    return node.value;
  }
  const unaryArg = node.args?.[0];
  if (
    node.type === 'OperatorNode' &&
    node.op === '-' &&
    node.args?.length === 1 &&
    unaryArg?.type === 'ConstantNode' &&
    typeof unaryArg.value === 'number'
  ) {
    return -unaryArg.value;
  }
  return null;
}

function hasExponentOrCustomUnit(node: AnyNode, engine: UnitEngine): boolean {
  if (node.type === 'SymbolNode' && node.name) {
    return engine.customUnits.has(node.name) || CURRENCY_UNITS.has(node.name);
  }
  if (node.type === 'OperatorNode' && node.op === '^') return true;
  if (node.type === 'ParenthesisNode' && node.content) {
    return hasExponentOrCustomUnit(node.content, engine);
  }
  if (node.type === 'OperatorNode' && node.args) {
    return node.args.some((arg) => hasExponentOrCustomUnit(arg, engine));
  }
  return false;
}

/**
 * Rewrites physical quantity literals like `220 V`, `1.2 USD/m`, `9.81 m/s^2`
 * into `__qty(value, "unit")` function calls so variable names like `V` or `m`
 * never collide with unit symbols in scope, and converts `table[0]` into `table.__row(0)`.
 */
export function rewriteQuantityAndTableAst(
  ast: MathNode,
  engine: UnitEngine,
  definedSymbols: ReadonlySet<string> = new Set(),
  tableNames: ReadonlySet<string> = new Set()
): MathNode {
  const { FunctionNode, SymbolNode, ConstantNode, AccessorNode, IndexNode } = engine.math as unknown as {
    FunctionNode: new (fn: MathNode | string, args: MathNode[]) => MathNode;
    SymbolNode: new (name: string) => MathNode;
    ConstantNode: new (value: unknown) => MathNode;
    AccessorNode: new (object: MathNode, index: MathNode) => MathNode;
    IndexNode: new (dimensions: MathNode[], dotNotation?: boolean) => MathNode;
  };

  const makeQtyNode = (numVal: number, unitStr: string): MathNode =>
    new FunctionNode(new SymbolNode('__qty'), [
      new ConstantNode(numVal),
      new ConstantNode(unitStr),
    ]);

  const transformNode = (rawNode: MathNode): MathNode => {
    const node = rawNode as unknown as AnyNode;

    // 1. Compound division quantity: (1.2 USD) / m or (9.81 m) / s^2
    if (
      node.type === 'OperatorNode' &&
      node.op === '/' &&
      node.args?.length === 2
    ) {
      const [left, right] = node.args;
      if (
        left &&
        right &&
        left.type === 'OperatorNode' &&
        left.op === '*' &&
        left.implicit === true &&
        left.args?.length === 2
      ) {
        const [leftNum, leftUnit] = left.args;
        const numVal = leftNum ? extractNumericLiteral(leftNum) : null;
        if (
          numVal !== null &&
          leftUnit &&
          isPureUnitExpr(leftUnit, engine) &&
          isPureUnitExpr(right, engine)
        ) {
          const rightSyms = collectUnitExpressionSymbols(right) ?? [];
          const rightCollidesWithVar = rightSyms.some((s) => definedSymbols.has(s));
          const stronglyUnit =
            !rightCollidesWithVar ||
            hasExponentOrCustomUnit(leftUnit, engine) ||
            hasExponentOrCustomUnit(right, engine);
          if (stronglyUnit) {
            const unitStr = `${leftUnit.toString()}/${right.toString()}`;
            return makeQtyNode(numVal, unitStr);
          }
        }
      }
    }

    // 2. Simple implicit quantity: 220 V, 4.5 A, 100 m, 4 u
    if (
      node.type === 'OperatorNode' &&
      node.op === '*' &&
      node.implicit === true &&
      node.args?.length === 2
    ) {
      const [numNode, unitNode] = node.args;
      const numVal = numNode ? extractNumericLiteral(numNode) : null;
      if (numVal !== null && unitNode && isPureUnitExpr(unitNode, engine)) {
        return makeQtyNode(numVal, unitNode.toString());
      }
    }

    // 3. Table 0-based row indexing: materiales[0] -> materiales.__row(0)
    const firstDim = node.index?.dimensions?.[0];
    if (
      node.type === 'AccessorNode' &&
      node.object &&
      node.index &&
      typeof node.index.isObjectProperty === 'function' &&
      !node.index.isObjectProperty() &&
      node.index.dimensions?.length === 1 &&
      firstDim
    ) {
      const obj = node.object;
      if (obj.type === 'SymbolNode' && obj.name && tableNames.has(obj.name)) {
        const transformedIdx = transformNode(firstDim as unknown as MathNode);
        const rowFnAccessor = new AccessorNode(
          new SymbolNode(obj.name),
          new IndexNode([new ConstantNode('__row')], true)
        );
        return new FunctionNode(rowFnAccessor, [transformedIdx]);
      }
    }

    return rawNode;
  };

  // Top-down recursive transform so compound `1.2 USD/m` matches before `1.2 USD`
  const walk = (n: MathNode): MathNode => {
    const replaced = transformNode(n);
    if (replaced !== n) {
      return replaced;
    }
    return n.map((child) => walk(child));
  };

  return walk(ast);
}

/**
 * Extracts symbol/table dependencies from a rewritten AST.
 * Note: `__qty(220, "V")` has zero variable dependencies!
 */
export function extractAstDependencies(
  rewrittenAst: MathNode,
  engine: UnitEngine,
  definedSymbols: ReadonlySet<string> = new Set()
): string[] {
  const deps = new Set<string>();

  const walk = (rawNode: MathNode, isFunctionCallee = false): void => {
    const node = rawNode as unknown as AnyNode;

    if (node.type === 'FunctionNode') {
      const fnNode = node.fn as AnyNode | undefined;
      if (fnNode?.type === 'SymbolNode' && fnNode.name === '__qty') {
        return; // Physical quantity literal, no variable dependencies
      }
      if (fnNode?.type === 'AccessorNode' && fnNode.object) {
        // e.g. materiales.fila("...") -> depends on `materiales`
        walk(fnNode.object as unknown as MathNode, false);
      } else if (fnNode) {
        walk(fnNode as unknown as MathNode, true);
      }
      for (const arg of node.args ?? []) {
        walk(arg as unknown as MathNode, false);
      }
      return;
    }

    if (node.type === 'AccessorNode' && node.object) {
      // e.g. materiales.Total -> capture `materiales.Total` AND `materiales` if needed
      const obj = node.object;
      if (
        obj.type === 'SymbolNode' &&
        obj.name &&
        node.index &&
        typeof node.index.isObjectProperty === 'function' &&
        node.index.isObjectProperty()
      ) {
        const prop = node.index.getObjectProperty?.();
        if (prop && prop !== '__row' && prop !== 'fila') {
          deps.add(`${obj.name}.${prop}`);
        }
        deps.add(obj.name);
        return;
      }
      walk(node.object as unknown as MathNode, false);
      if (node.index?.dimensions) {
        for (const dim of node.index.dimensions) {
          walk(dim as unknown as MathNode, false);
        }
      }
      return;
    }

    if (node.type === 'SymbolNode' && node.name) {
      if (isFunctionCallee || BUILTIN_FUNCTIONS.has(node.name)) {
        return;
      }
      // If it's a known unit token (like `s` in `m * 9.81 m/s^2`) and NOT defined as a document variable,
      // treat it as a physical unit rather than a variable dependency.
      if (!definedSymbols.has(node.name) && engine.isKnownUnitToken(node.name)) {
        return;
      }
      deps.add(node.name);
      return;
    }

    rawNode.forEach((child) => walk(child, false));
  };

  walk(rewrittenAst);
  return Array.from(deps);
}

export function parseExpression(
  rawExpr: string,
  engine: UnitEngine,
  definedSymbols: ReadonlySet<string> = new Set(),
  tableNames: ReadonlySet<string> = new Set()
): ParsedExpressionInfo {
  const { expr, targetUnit } = splitTargetUnit(rawExpr);
  const ast = engine.math.parse(expr);
  const rewrittenAst = rewriteQuantityAndTableAst(ast, engine, definedSymbols, tableNames);
  const dependencies = extractAstDependencies(rewrittenAst, engine, definedSymbols);

  return {
    originalExpr: rawExpr,
    normalizedExpr: expr,
    targetUnit,
    ast,
    rewrittenAst,
    dependencies,
  };
}

function unwrapArrayArg(arg: unknown): unknown[] {
  if (Array.isArray(arg)) return arg;
  if (arg && typeof arg === 'object' && 'valueOf' in arg) {
    const val = (arg as { valueOf: () => unknown }).valueOf();
    if (Array.isArray(val)) return val;
  }
  return [arg];
}

export function buildEvaluationScope(
  engine: UnitEngine,
  baseScope: Record<string, unknown>
): Record<string, unknown> {
  const { math, isMathUnit } = engine;

  const qtyFn = (val: number, unitStr: string): Unit => {
    const normalizedUnit = normalizeMathText(unitStr);
    const u = math.unit(normalizedUnit);
    return math.multiply(val, u) as Unit;
  };

  const sumFn = (...args: unknown[]): unknown => {
    const items = args.length === 1 ? unwrapArrayArg(args[0]) : args;
    const valid = items.filter((v) => v !== null && v !== undefined && v !== '');
    if (valid.length === 0) return 0;
    let acc: unknown = valid[0];
    for (let i = 1; i < valid.length; i += 1) {
      acc = math.add(acc as number, valid[i] as number);
    }
    return acc;
  };

  const avgFn = (...args: unknown[]): unknown => {
    const items = args.length === 1 ? unwrapArrayArg(args[0]) : args;
    const valid = items.filter((v) => v !== null && v !== undefined && v !== '');
    if (valid.length === 0) return 0;
    const total = sumFn(valid);
    return math.divide(total as number, valid.length);
  };

  const minFn = (...args: unknown[]): unknown => {
    const items = args.length === 1 ? unwrapArrayArg(args[0]) : args;
    const valid = items.filter((v) => v !== null && v !== undefined && v !== '');
    if (valid.length === 0) return 0;
    let best = valid[0];
    for (let i = 1; i < valid.length; i += 1) {
      if (math.smaller(valid[i] as number, best as number)) {
        best = valid[i];
      }
    }
    return best;
  };

  const maxFn = (...args: unknown[]): unknown => {
    const items = args.length === 1 ? unwrapArrayArg(args[0]) : args;
    const valid = items.filter((v) => v !== null && v !== undefined && v !== '');
    if (valid.length === 0) return 0;
    let best = valid[0];
    for (let i = 1; i < valid.length; i += 1) {
      if (math.larger(valid[i] as number, best as number)) {
        best = valid[i];
      }
    }
    return best;
  };

  const countFn = (arg: unknown): number => {
    if (arg && typeof arg === 'object' && '__isReactiveTable' in (arg as Record<string, unknown>)) {
      return (arg as TableScopeProxy).__rowCount;
    }
    return unwrapArrayArg(arg).length;
  };

  const lnFn = (x: unknown): unknown => {
    if (isMathUnit(x)) {
      throw new Error('ln() requiere un argumento adimensional');
    }
    return math.log(x as number);
  };

  return {
    ...baseScope,
    __qty: qtyFn,
    sum: sumFn,
    avg: avgFn,
    mean: avgFn,
    min: minFn,
    max: maxFn,
    count: countFn,
    ln: lnFn,
  };
}

export function translateMathError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/Units do not match/i.test(raw)) {
    return `Incompatibilidad de unidades: ${raw.replace(/Units do not match/i, 'las dimensiones no coinciden')}`;
  }
  if (/Undefined symbol\s+([A-Za-z0-9_]+)/i.test(raw)) {
    const m = raw.match(/Undefined symbol\s+([A-Za-z0-9_]+)/i);
    return `Variable no definida: "${m?.[1] ?? ''}"`;
  }
  if (/Unit "([^"]+)" not found/i.test(raw)) {
    const m = raw.match(/Unit "([^"]+)" not found/i);
    return `Unidad desconocida: "${m?.[1] ?? ''}" (podés declararla con @unidad ${m?.[1] ?? ''})`;
  }
  if (/Unexpected end of expression/i.test(raw)) {
    return 'Expresión incompleta';
  }
  return raw;
}

export function evaluateParsedExpression(
  parsed: ParsedExpressionInfo,
  engine: UnitEngine,
  baseScope: Record<string, unknown>
): { ok: true; value: EvaluatedValue } | { ok: false; error: string } {
  try {
    const scope = buildEvaluationScope(engine, baseScope);
    let result = parsed.rewrittenAst.compile().evaluate(scope);

    if (parsed.targetUnit) {
      const target = normalizeMathText(parsed.targetUnit);
      if (!engine.isMathUnit(result)) {
        return {
          ok: false,
          error: `No se puede convertir un valor sin unidad a "${parsed.targetUnit}"`,
        };
      }
      result = result.to(target);
    }

    return {
      ok: true,
      value: engine.formatValue(result, undefined, Boolean(parsed.targetUnit)),
    };
  } catch (err) {
    return {
      ok: false,
      error: translateMathError(err),
    };
  }
}

/**
 * Tries to evaluate a raw Markdown table cell (like "100 m", "1.2 USD/m", "42", "Cable 2.5mm").
 * If it parses & evaluates cleanly as a number or physical quantity, returns an EvaluatedValue;
 * otherwise preserves it as a text string value.
 */
export function parseTableCellValue(
  rawCell: string,
  engine: UnitEngine
): EvaluatedValue {
  const trimmed = rawCell.trim();
  if (!trimmed || trimmed === '—' || trimmed === '-' || trimmed === '=') {
    return engine.formatValue('');
  }

  // Only attempt numeric/unit evaluation if the cell starts with a number or +/-/.
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)/.test(trimmed)) {
    try {
      const parsed = parseExpression(trimmed, engine);
      const res = evaluateParsedExpression(parsed, engine, {});
      if (res.ok && (res.value.isNumber || res.value.isUnit)) {
        return res.value;
      }
    } catch {
      // Fallback to string
    }
  }

  return engine.formatValue(trimmed);
}
