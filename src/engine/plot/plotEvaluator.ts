import { createUnitEngine } from '../math/unitRegistry';
import {
  evaluateParsedExpression,
  parseExpression,
} from '../math/expressionEvaluator';
import { EvaluatedDocument } from '../parser/types';

export interface PlotPoint {
  x: number;
  y: number;
}

export interface PlotSeries {
  label: string;
  points: PlotPoint[];
}

export interface BarDatum {
  label: string;
  value: number;
  formattedValue: string;
}

export type EvaluatedPlot =
  | {
      ok: true;
      kind: 'line';
      title?: string;
      xLabel?: string;
      yLabel?: string;
      xMin: number;
      xMax: number;
      yMin: number;
      yMax: number;
      series: PlotSeries[];
    }
  | {
      ok: true;
      kind: 'bar';
      title?: string;
      xLabel?: string;
      yLabel?: string;
      unitLabel?: string;
      bars: BarDatum[];
    }
  | {
      ok: false;
      error: string;
    };

function interpolatePlotText(text: string | undefined, doc: EvaluatedDocument): string | undefined {
  if (!text) return undefined;
  return text.replace(/\{\{([^}]+)\}\}/g, (match, expr: string) => {
    const key = expr.trim();
    const sym = doc.symbols.get(key);
    if (sym?.value) return sym.value.formattedText;
    return match;
  });
}

function buildNumericScope(doc: EvaluatedDocument): Record<string, number> {
  const scope: Record<string, number> = {};
  for (const [name, sym] of doc.symbols) {
    if (sym.value && sym.value.numericValue !== null && Number.isFinite(sym.value.numericValue)) {
      scope[name] = sym.value.numericValue;
    }
  }
  return scope;
}

/**
 * Evaluates a declarative offline ` ```plot ` block against the document's live DAG.
 *
 * Supports two modes:
 * 1. Table mode:
 *    tabla: materiales
 *    x: Ítem
 *    y: Total
 *    tipo: barras | linea
 * 2. Mathematical function mode:
 *    x: 0..40
 *    y: V * sin(x * pi / 20)
 *    y2: V * cos(x * pi / 20)   (optional additional curves)
 */
export function evaluatePlotBlock(
  rawPlotContent: string,
  doc: EvaluatedDocument
): EvaluatedPlot {
  const config: Record<string, string> = {};
  const yExpressions: Array<{ label: string; expr: string }> = [];

  for (const rawLine of rawPlotContent.split('\n')) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx < 0) continue;
    const key = trimmed.slice(0, colonIdx).trim().toLowerCase();
    const val = trimmed.slice(colonIdx + 1).trim();
    if (!val) continue;

    if (key === 'y' || /^y\d+$/.test(key)) {
      // Optional inline label via `expr | label`
      const pipeIdx = val.indexOf('|');
      if (pipeIdx >= 0) {
        yExpressions.push({
          expr: val.slice(0, pipeIdx).trim(),
          label: val.slice(pipeIdx + 1).trim() || val.slice(0, pipeIdx).trim(),
        });
      } else {
        yExpressions.push({ expr: val, label: val });
      }
      if (!config.y) config.y = val;
    } else {
      config[key] = val;
    }
  }

  const title = interpolatePlotText(config.titulo ?? config.title, doc);
  const xLabel = interpolatePlotText(config.ejex ?? config.xlabel, doc);
  const yLabel = interpolatePlotText(config.ejey ?? config.ylabel, doc);
  const tipo = (config.tipo ?? config.type ?? '').toLowerCase();

  // Mode 1: Table Plot (`tabla: materiales`)
  const tableName = config.tabla ?? config.table;
  if (tableName) {
    const table = doc.tablesByName.get(tableName.trim());
    if (!table) {
      return {
        ok: false,
        error: `No se encontró la tabla "@tabla: ${tableName}" en el documento.`,
      };
    }

    const xColName = config.x ?? table.headers[0] ?? '';
    const yColName = (config.y ?? '').split('|')[0]?.trim() || table.headers[table.headers.length - 1] || '';

    const xIdx = table.headers.indexOf(xColName);
    const yIdx = table.headers.indexOf(yColName);
    if (xIdx < 0) {
      return { ok: false, error: `La columna "${xColName}" no existe en "${tableName}".` };
    }
    if (yIdx < 0) {
      return { ok: false, error: `La columna "${yColName}" no existe en "${tableName}".` };
    }

    let detectedUnit: string | undefined;
    const bars: BarDatum[] = [];
    const linePts: PlotPoint[] = [];

    table.rows.forEach((row, rIdx) => {
      const xCell = row[xIdx];
      const yCell = row[yIdx];
      const yNum = yCell?.value?.numericValue;
      if (yNum === null || yNum === undefined || !Number.isFinite(yNum)) return;
      if (!detectedUnit && yCell?.value?.unitString) {
        detectedUnit = yCell.value.unitString;
      }
      const label = xCell?.value ? xCell.value.formattedText : (xCell?.rawText ?? `#${rIdx + 1}`);
      bars.push({
        label,
        value: yNum,
        formattedValue: yCell?.value ? yCell.value.formattedText : String(yNum),
      });

      const xNum = xCell?.value?.numericValue;
      linePts.push({
        x: xNum !== null && xNum !== undefined && Number.isFinite(xNum) ? xNum : rIdx + 1,
        y: yNum,
      });
    });

    if (bars.length === 0) {
      return {
        ok: false,
        error: `La columna "${yColName}" no contiene valores numéricos graficables.`,
      };
    }

    if (tipo === 'linea' || tipo === 'line') {
      const xs = linePts.map((p) => p.x);
      const ys = linePts.map((p) => p.y);
      const xMin = Math.min(...xs);
      const xMax = Math.max(...xs);
      const yMin = Math.min(...ys);
      const yMax = Math.max(...ys);
      return {
        ok: true,
        kind: 'line',
        title,
        xLabel: xLabel ?? xColName,
        yLabel: yLabel ?? (detectedUnit ? `${yColName} [${detectedUnit}]` : yColName),
        xMin: xMin === xMax ? xMin - 1 : xMin,
        xMax: xMin === xMax ? xMax + 1 : xMax,
        yMin: yMin === yMax ? yMin - 1 : yMin,
        yMax: yMin === yMax ? yMax + 1 : yMax,
        series: [{ label: yColName, points: linePts }],
      };
    }

    return {
      ok: true,
      kind: 'bar',
      title,
      xLabel: xLabel ?? xColName,
      yLabel: yLabel ?? (detectedUnit ? `${yColName} [${detectedUnit}]` : yColName),
      unitLabel: detectedUnit,
      bars,
    };
  }

  // Mode 2: Mathematical Function Plot (`x: 0..40`, `y: V * sin(x)`)
  if (yExpressions.length === 0) {
    return {
      ok: false,
      error: 'Especificá al menos una función `y: ...` o una tabla `tabla: nombre`.',
    };
  }

  const numericScope = buildNumericScope(doc);
  const engine = createUnitEngine();
  const rangeRaw = config.x ?? '0..10';
  const rangeMatch = rangeRaw.match(/^(.+?)\.\.(.+)$/);
  let xMin = 0;
  let xMax = 10;

  if (rangeMatch && rangeMatch[1] && rangeMatch[2]) {
    try {
      const pMin = parseExpression(rangeMatch[1].trim(), engine, new Set(Object.keys(numericScope)));
      const pMax = parseExpression(rangeMatch[2].trim(), engine, new Set(Object.keys(numericScope)));
      const rMin = evaluateParsedExpression(pMin, engine, numericScope);
      const rMax = evaluateParsedExpression(pMax, engine, numericScope);
      if (rMin.ok && rMin.value.numericValue !== null) xMin = rMin.value.numericValue;
      if (rMax.ok && rMax.value.numericValue !== null) xMax = rMax.value.numericValue;
    } catch {
      return { ok: false, error: `Rango de x inválido: "${rangeRaw}" (ej. x: 0..40)` };
    }
  }

  if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || xMax <= xMin) {
    return { ok: false, error: `Rango de x inválido: x_max debe ser mayor que x_min.` };
  }

  const rawPoints = Number(config.puntos ?? config.points ?? 140);
  const sampleCount = Math.min(400, Math.max(20, Number.isFinite(rawPoints) ? Math.trunc(rawPoints) : 140));

  const definedVars = new Set([...Object.keys(numericScope), 'x']);
  const series: PlotSeries[] = [];
  let yMin = Infinity;
  let yMax = -Infinity;

  for (const item of yExpressions) {
    try {
      const parsed = parseExpression(item.expr, engine, definedVars);
      const compiled = parsed.rewrittenAst.compile();
      const points: PlotPoint[] = [];

      for (let i = 0; i <= sampleCount; i += 1) {
        const xVal = xMin + ((xMax - xMin) * i) / sampleCount;
        const evalRes = compiled.evaluate({ ...numericScope, x: xVal });
        const yNum = typeof evalRes === 'number' ? evalRes : Number(evalRes);
        if (Number.isFinite(yNum)) {
          points.push({ x: xVal, y: yNum });
          if (yNum < yMin) yMin = yNum;
          if (yNum > yMax) yMax = yNum;
        }
      }

      if (points.length === 0) {
        return { ok: false, error: `La función "${item.expr}" no devolvió valores reales en el rango.` };
      }

      series.push({ label: item.label, points });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Error en "${item.expr}": ${msg}` };
    }
  }

  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
    return { ok: false, error: 'No se pudieron evaluar puntos válidos para graficar.' };
  }

  if (Math.abs(yMax - yMin) < 1e-9) {
    const pad = Math.abs(yMin) * 0.1 || 1;
    yMin -= pad;
    yMax += pad;
  }

  return {
    ok: true,
    kind: 'line',
    title,
    xLabel: xLabel ?? 'x',
    yLabel: yLabel ?? (series.length === 1 ? series[0]?.label : 'y'),
    xMin,
    xMax,
    yMin,
    yMax,
    series,
  };
}
