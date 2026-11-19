import { EvaluatedDocument } from '../parser/types';

export interface ReactivePythonBridgeSnapshot {
  preambleCode: string;
  hash: string;
  bridgedSymbolCount: number;
  bridgedTableCount: number;
}

const PYTHON_KEYWORDS = new Set([
  'False',
  'None',
  'True',
  'and',
  'as',
  'assert',
  'async',
  'await',
  'break',
  'class',
  'continue',
  'def',
  'del',
  'elif',
  'else',
  'except',
  'finally',
  'for',
  'from',
  'global',
  'if',
  'import',
  'in',
  'is',
  'lambda',
  'nonlocal',
  'not',
  'or',
  'pass',
  'raise',
  'return',
  'try',
  'while',
  'with',
  'yield',
]);

function isSafePythonIdentifier(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !PYTHON_KEYWORDS.has(name);
}

export function isPythonCodeLanguage(lang: string): boolean {
  const normalized = lang.trim().toLowerCase();
  return normalized === 'python' || normalized === 'py';
}

export function parsePythonBlockVisibility(meta?: string): 'output-only' | 'show-code' | 'hidden' {
  const lower = (meta ?? '').toLowerCase();
  if (lower.includes('@oculto') || lower.includes('hide') || lower.includes('hidden')) {
    return 'hidden';
  }
  if (lower.includes('@mostrar') || lower.includes('show')) {
    return 'show-code';
  }
  return 'output-only';
}

/**
 * Generates an injection-safe Python preamble that bridges all evaluated variables
 * and named `@tabla:` tables from the Reactive Markdown DAG directly into the Jupyter kernel.
 *
 * - Scalar symbols become Python floats/strings (e.g. `V = 220.0`, `P = 910.8`)
 * - Units are exposed in `unidades` (e.g. `unidades["P"] == "W"`)
 * - Named tables become `pandas.DataFrame` when pandas is installed (or dict of column lists otherwise),
 *   with column units exposed in `<tabla>_unidades`.
 * - Safely enables `%matplotlib inline` when running inside IPython.
 */
export function buildReactivePythonPreamble(
  doc: EvaluatedDocument
): ReactivePythonBridgeSnapshot {
  const scalars: Record<string, number | string> = {};
  const units: Record<string, string> = {};

  for (const [name, sym] of doc.symbols) {
    if (!isSafePythonIdentifier(name) || !sym.value) continue;
    if (sym.value.numericValue !== null && Number.isFinite(sym.value.numericValue)) {
      scalars[name] = sym.value.numericValue;
    } else if (sym.value.isString) {
      scalars[name] = sym.value.formattedText;
    }
    if (sym.value.unitString) {
      units[name] = sym.value.unitString;
    }
  }

  const tablesPayload: Record<
    string,
    { columns: Record<string, Array<number | string>>; units: Record<string, string> }
  > = {};

  for (const [tableName, table] of doc.tablesByName) {
    if (!isSafePythonIdentifier(tableName)) continue;
    const columns: Record<string, Array<number | string>> = {};
    const tableUnits: Record<string, string> = {};

    table.headers.forEach((header, colIdx) => {
      const colData: Array<number | string> = [];
      let detectedUnit: string | null = null;

      for (const row of table.rows) {
        const cell = row[colIdx];
        if (cell?.value && cell.value.numericValue !== null && Number.isFinite(cell.value.numericValue)) {
          colData.push(cell.value.numericValue);
          if (!detectedUnit && cell.value.unitString) {
            detectedUnit = cell.value.unitString;
          }
        } else {
          colData.push(cell?.value ? cell.value.formattedText : cell?.rawText ?? '');
        }
      }

      columns[header] = colData;
      if (detectedUnit) {
        tableUnits[header] = detectedUnit;
      }
    });

    tablesPayload[tableName] = { columns, units: tableUnits };
  }

  const payloadObj = {
    scalars,
    units,
    tables: tablesPayload,
  };

  const payloadJson = JSON.stringify(payloadObj);
  // Safe base64/JSON literal embedding using JSON.stringify as a Python string literal
  const pythonJsonLiteral = JSON.stringify(payloadJson);

  const preambleCode = [
    '# --- NoteLab M3: Puente Reactivo (.md -> Python) ---',
    'import json as _nl_json',
    'try:',
    '    _nl_ip = get_ipython()',
    '    if _nl_ip is not None:',
    '        _nl_ip.run_line_magic("matplotlib", "inline")',
    'except Exception:',
    '    pass',
    `_nl_data = _nl_json.loads(${pythonJsonLiteral})`,
    'vars_md = dict(_nl_data["scalars"])',
    'unidades = dict(_nl_data["units"])',
    'for _nl_k, _nl_v in vars_md.items():',
    '    globals()[_nl_k] = _nl_v',
    'try:',
    '    import pandas as _nl_pd',
    'except Exception:',
    '    _nl_pd = None',
    'for _nl_tname, _nl_tinfo in _nl_data["tables"].items():',
    '    _nl_cols = _nl_tinfo["columns"]',
    '    globals()[_nl_tname] = _nl_pd.DataFrame(_nl_cols) if _nl_pd is not None else _nl_cols',
    '    globals()[f"{_nl_tname}_unidades"] = dict(_nl_tinfo["units"])',
    'del _nl_json, _nl_data, _nl_pd',
  ].join('\n');

  return {
    preambleCode,
    hash: payloadJson,
    bridgedSymbolCount: Object.keys(scalars).length,
    bridgedTableCount: Object.keys(tablesPayload).length,
  };
}
