import { describe, it, expect } from 'vitest';
import { WELCOME_REACTIVE_DOC_CONTENT } from '../data/welcomeReactiveDoc';
import { evaluateReactiveDocument } from '../engine/evaluator/evaluateDocument';
import {
  appendTableRowInMarkdown,
  deleteTableRowInMarkdown,
  parseReactiveDocument,
  updateTableCellInMarkdown,
} from '../engine/parser/documentParser';
import { evaluatePlotBlock } from '../engine/plot/plotEvaluator';
import { TableBlock } from '../engine/parser/types';

describe('Reactive Enhancements — Inline Table Editing & Offline SVG Plots', () => {
  it('updates a table cell, appends a smart default row, and deletes a row losslessly', () => {
    const ast1 = parseReactiveDocument(WELCOME_REACTIVE_DOC_CONTENT);
    const tbl1 = ast1.blocks.find((b): b is TableBlock => b.kind === 'table')!;
    expect(tbl1.tableName).toBe('materiales');
    expect(tbl1.rows).toHaveLength(4);

    // 1. Update cell (row 0, col 1: "100 m" -> "200 m")
    const mdEdited = updateTableCellInMarkdown(
      WELCOME_REACTIVE_DOC_CONTENT,
      tbl1,
      0,
      1,
      '200 m'
    );
    const evalEdited = evaluateReactiveDocument(mdEdited);
    // Subtotal increased by 120 USD (269 -> 389 USD)
    expect(evalEdited.symbols.get('subtotal_mat')?.value?.formattedText).toBe('389.00 USD');
    expect(mdEdited).toContain('@col Subtotal = Cantidad * Precio');

    // 2. Append row with smart unit inference from previous row ("1 u", "1 USD/u", "—" for computed cols)
    const tbl2 = evalEdited.ast.blocks.find((b): b is TableBlock => b.kind === 'table')!;
    const mdAppended = appendTableRowInMarkdown(mdEdited, tbl2);
    const evalAppended = evaluateReactiveDocument(mdAppended);
    const evaluatedTbl = evalAppended.tablesByName.get('materiales')!;
    expect(evaluatedTbl.rows).toHaveLength(5);
    // New row has 1 u * 1 USD/u = 1.00 USD -> subtotal becomes 390.00 USD
    expect(evalAppended.symbols.get('subtotal_mat')?.value?.formattedText).toBe('390.00 USD');

    // 3. Delete the appended row back
    const tbl3 = evalAppended.ast.blocks.find((b): b is TableBlock => b.kind === 'table')!;
    const mdDeleted = deleteTableRowInMarkdown(mdAppended, tbl3, 4);
    const evalDeleted = evaluateReactiveDocument(mdDeleted);
    expect(evalDeleted.tablesByName.get('materiales')?.rows).toHaveLength(4);
    expect(evalDeleted.symbols.get('subtotal_mat')?.value?.formattedText).toBe('389.00 USD');
  });

  it('evaluates offline SVG bar plot from a named @tabla: with interpolated title', () => {
    const doc = evaluateReactiveDocument(WELCOME_REACTIVE_DOC_CONTENT);
    const plotRes = evaluatePlotBlock(
      `
titulo: Costos totales ({{total_usd}})
tabla: materiales
x: Ítem
y: Total
tipo: barras
`,
      doc
    );

    expect(plotRes.ok).toBe(true);
    if (!plotRes.ok || plotRes.kind !== 'bar') return;
    expect(plotRes.title).toBe('Costos totales (325.49 USD)');
    expect(plotRes.bars).toHaveLength(4);
    expect(plotRes.bars[0]?.value).toBeCloseTo(145.2, 2);
    expect(plotRes.bars[0]?.formattedValue).toBe('145.20 USD');
  });

  it('evaluates offline multi-curve mathematical function plot using live DAG variables', () => {
    const doc = evaluateReactiveDocument(WELCOME_REACTIVE_DOC_CONTENT);
    const plotRes = evaluatePlotBlock(
      `
titulo: Onda ({{V}})
x: 0..40
y: V * sin(x * pi / 20) | v(t)
y2: I * 20 * cos(x * pi / 20) | i(t)
puntos: 40
`,
      doc
    );

    expect(plotRes.ok).toBe(true);
    if (!plotRes.ok || plotRes.kind !== 'line') return;
    expect(plotRes.title).toBe('Onda (220 V)');
    expect(plotRes.series).toHaveLength(2);
    expect(plotRes.series[0]?.label).toBe('v(t)');
    expect(plotRes.series[0]?.points).toHaveLength(41);
    // At x = 10, sin(pi/2) = 1 -> y = V = 220
    expect(plotRes.yMax).toBeCloseTo(220, 1);
    expect(plotRes.yMin).toBeCloseTo(-220, 1);
  });

  it('reports clear Spanish errors on invalid plot blocks', () => {
    const doc = evaluateReactiveDocument(WELCOME_REACTIVE_DOC_CONTENT);
    const badTable = evaluatePlotBlock('tabla: inexistente\ny: Total', doc);
    expect(badTable.ok).toBe(false);
    if (!badTable.ok) {
      expect(badTable.error).toContain('inexistente');
    }
  });
});
