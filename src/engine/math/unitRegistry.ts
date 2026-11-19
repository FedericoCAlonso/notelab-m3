import { create, all, MathJsInstance, Unit } from 'mathjs';
import { EvaluatedValue, UnitDeclaration } from '../parser/types';

export const DEFAULT_CUSTOM_UNITS = ['USD', 'ARS', 'EUR', 'u', 'pza', 'hh'] as const;

export const CURRENCY_UNITS = new Set<string>(['USD', 'ARS', 'EUR']);

const UNIT_TEX_MAP: Record<string, string> = {
  ohm: '\\Omega',
  deg: '^\\circ',
  degC: '^\\circ\\text{C}',
  degF: '^\\circ\\text{F}',
  uF: '\\mu\\text{F}',
  uA: '\\mu\\text{A}',
  uV: '\\mu\\text{V}',
  um: '\\mu\\text{m}',
  us: '\\mu\\text{s}',
  uW: '\\mu\\text{W}',
  uH: '\\mu\\text{H}',
};

export interface UnitEngine {
  math: MathJsInstance;
  customUnits: Set<string>;
  decimals: number | null;
  registerCustomUnit: (decl: UnitDeclaration) => { ok: true } | { ok: false; error: string };
  isKnownUnitToken: (token: string) => boolean;
  isMathUnit: (val: unknown) => val is Unit;
  formatValue: (
    raw: unknown,
    decimalsOverride?: number | null,
    preserveUnit?: boolean
  ) => EvaluatedValue;
}

function normalizeUnitDefExpression(def: string): string {
  const trimmed = def.trim();
  // Support "1/1200 USD" -> "(1/1200) USD" so mathjs evaluates the numeric ratio before unit multiplication
  const ratioUnitMatch = trimmed.match(/^([+-]?\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?)\s+([A-Za-z_][A-Za-z0-9_/^*\-]*)$/);
  if (ratioUnitMatch) {
    return `(${ratioUnitMatch[1]}) ${ratioUnitMatch[2]}`;
  }
  return trimmed;
}

export function formatNumberSmart(num: number, decimals: number | null, isCurrency = false): string {
  if (!Number.isFinite(num)) {
    return Number.isNaN(num) ? 'NaN' : num > 0 ? '∞' : '-∞';
  }
  // Avoid -0
  const clean = Math.abs(num) < 1e-12 ? 0 : num;

  if (decimals !== null && decimals >= 0) {
    return clean.toFixed(decimals);
  }

  if (isCurrency) {
    return clean.toFixed(2);
  }

  if (Number.isInteger(clean)) {
    return String(clean);
  }

  // Up to 4 decimal places, stripping trailing zeros
  const rounded = Number(clean.toPrecision(6));
  if (Math.abs(rounded) >= 1e6 || (Math.abs(rounded) > 0 && Math.abs(rounded) < 1e-4)) {
    return rounded.toExponential(3).replace(/\.?0+e/, 'e');
  }
  const fixed = Number(rounded.toFixed(4));
  return String(fixed);
}

function formatSingleUnitPartToTex(unitToken: string): string {
  // Handle exponent like s^2 or m2
  const caretMatch = unitToken.match(/^([A-Za-z_]+)\^(-?\d+)$/);
  if (caretMatch && caretMatch[1] && caretMatch[2]) {
    const base = UNIT_TEX_MAP[caretMatch[1]] ?? `\\text{${caretMatch[1]}}`;
    return `${base}^{${caretMatch[2]}}`;
  }
  const compactPowMatch = unitToken.match(/^(m|cm|mm|km|ft|in)(2|3)$/);
  if (compactPowMatch && compactPowMatch[1] && compactPowMatch[2]) {
    return `\\text{${compactPowMatch[1]}}^{${compactPowMatch[2]}}`;
  }
  if (UNIT_TEX_MAP[unitToken]) {
    return UNIT_TEX_MAP[unitToken];
  }
  return `\\text{${unitToken}}`;
}

export function formatUnitStringToTex(unitStr: string): string {
  const cleaned = unitStr.trim();
  if (!cleaned) return '';

  const slashIdx = cleaned.indexOf('/');
  if (slashIdx >= 0) {
    const numPart = cleaned.slice(0, slashIdx).trim();
    const denPart = cleaned.slice(slashIdx + 1).trim().replace(/^\(|\)$/g, '');
    const numTex = numPart
      ? numPart
          .split(/\s+/)
          .filter(Boolean)
          .map(formatSingleUnitPartToTex)
          .join('\\cdot ')
      : '1';
    const denTex = denPart
      .split(/\s+/)
      .filter(Boolean)
      .map(formatSingleUnitPartToTex)
      .join('\\cdot ');
    return `\\frac{${numTex}}{${denTex}}`;
  }

  return cleaned
    .split(/\s+/)
    .filter(Boolean)
    .map(formatSingleUnitPartToTex)
    .join('\\cdot ');
}

export function createUnitEngine(decimals: number | null = null): UnitEngine {
  const math = create(all ?? {});
  const customUnits = new Set<string>();

  for (const unitName of DEFAULT_CUSTOM_UNITS) {
    try {
      math.createUnit(unitName, {}, { override: true });
      customUnits.add(unitName);
    } catch {
      // ignore if already registered
    }
  }

  const isKnownUnitToken = (token: string): boolean => {
    if (!token || !/^[A-Za-z][A-Za-z0-9_]*$/.test(token)) return false;
    // Exclude common single-letter math constants / variables that should not be mistaken when isolated unless valid unit
    if (customUnits.has(token)) return true;
    try {
      const UnitCtor = math.Unit as unknown as {
        isValuelessUnit?: (name: string) => boolean;
      };
      if (typeof UnitCtor?.isValuelessUnit === 'function') {
        return UnitCtor.isValuelessUnit(token);
      }
      math.unit(1, token);
      return true;
    } catch {
      return false;
    }
  };

  const isMathUnit = (val: unknown): val is Unit => {
    return Boolean(
      val &&
        typeof val === 'object' &&
        'isUnit' in (val as Record<string, unknown>) &&
        (val as { isUnit?: boolean }).isUnit === true
    );
  };

  const registerCustomUnit = (
    decl: UnitDeclaration
  ): { ok: true } | { ok: false; error: string } => {
    const name = decl.name.trim();
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
      return { ok: false, error: `Nombre de unidad inválido: "${name}"` };
    }
    try {
      if (!decl.definition || !decl.definition.trim()) {
        math.createUnit(name, {}, { override: true });
      } else {
        const normalized = normalizeUnitDefExpression(decl.definition);
        const evaluated = math.evaluate(normalized);
        if (!isMathUnit(evaluated)) {
          return {
            ok: false,
            error: `La definición de unidad "${name} = ${decl.definition}" debe resultar en una cantidad con unidad`,
          };
        }
        math.createUnit(name, { definition: evaluated }, { override: true });
      }
      customUnits.add(name);
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: `No se pudo definir la unidad "${name}": ${message}`,
      };
    }
  };

  const formatValue = (
    raw: unknown,
    decimalsOverride: number | null = undefined as unknown as null,
    preserveUnit = false
  ): EvaluatedValue => {
    const effectiveDecimals = decimalsOverride !== undefined ? decimalsOverride : engine.decimals;

    if (isMathUnit(raw)) {
      const unitObj = raw as unknown as {
        simplify?: () => Unit;
        fixPrefix?: boolean;
        units?: unknown[];
      };
      const shouldSimplify =
        !preserveUnit &&
        !unitObj.fixPrefix &&
        typeof unitObj.simplify === 'function' &&
        (unitObj.units?.length ?? 0) > 1;
      const displayUnit = shouldSimplify ? unitObj.simplify!() : raw;
      const unitLabel = displayUnit.formatUnits().trim();
      const numVal = unitLabel ? displayUnit.toNumber(unitLabel) : Number(displayUnit.value);
      const isCurrency = CURRENCY_UNITS.has(unitLabel);
      const numStr = formatNumberSmart(numVal, effectiveDecimals, isCurrency);
      const formattedText = unitLabel ? `${numStr} ${unitLabel}` : numStr;
      const unitTex = unitLabel ? formatUnitStringToTex(unitLabel) : '';
      const formattedTex = unitTex
        ? unitTex.startsWith('^\\circ')
          ? `${numStr}${unitTex}`
          : `${numStr}\\,${unitTex}`
        : numStr;

      return {
        raw: displayUnit,
        isUnit: Boolean(unitLabel),
        isNumber: !unitLabel,
        isString: false,
        unitString: unitLabel || null,
        numericValue: numVal,
        formattedText,
        formattedTex,
      };
    }

    if (typeof raw === 'number') {
      const numStr = formatNumberSmart(raw, effectiveDecimals, false);
      return {
        raw,
        isUnit: false,
        isNumber: true,
        isString: false,
        unitString: null,
        numericValue: raw,
        formattedText: numStr,
        formattedTex: numStr,
      };
    }

    if (typeof raw === 'string') {
      return {
        raw,
        isUnit: false,
        isNumber: false,
        isString: true,
        unitString: null,
        numericValue: null,
        formattedText: raw,
        formattedTex: `\\text{${raw.replace(/([%$#_{}&])/g, '\\$1')}}`,
      };
    }

    const str = String(raw ?? '');
    return {
      raw,
      isUnit: false,
      isNumber: false,
      isString: false,
      unitString: null,
      numericValue: null,
      formattedText: str,
      formattedTex: `\\text{${str.replace(/([%$#_{}&])/g, '\\$1')}}`,
    };
  };

  const engine: UnitEngine = {
    math,
    customUnits,
    decimals,
    registerCustomUnit,
    isKnownUnitToken,
    isMathUnit,
    formatValue,
  };

  return engine;
}
