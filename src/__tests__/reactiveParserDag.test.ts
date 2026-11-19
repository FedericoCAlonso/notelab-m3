import { describe, it, expect } from 'vitest';
import {
  parseReactiveDocument,
  replaceBlockRange,
} from '../engine/parser/documentParser';
import {
  ReactiveSession,
  evaluateReactiveDocument,
} from '../engine/evaluator/evaluateDocument';

const SAMPLE_DOC = `# Presupuesto Eléctrico

Parámetros base: tensión {{V := 220 V}} e impuesto {{iva := 0.21}}.

## Materiales

@tabla: materiales
@col Subtotal = Cantidad * Precio
@col Total = Subtotal * (1 + iva)

| Item | Cantidad | Precio | Subtotal | Total |
| :--- | :---: | :---: | :---: | :---: |
| Cable 2.5mm | 100 m | 1.2 USD/m | — | — |
| Térmica 16A | 4 u | 18 USD/u | — | — |

### Cálculos Eléctricos

\`\`\`calc
I = 4.5 A
P = V * I -> W
P_kw = P -> kW @formula
costo_total = sum(materiales.Total) @resultado
\`\`\`

La potencia calculada es {{P}} ({{P -> kW}}) y el presupuesto final asciende a {{costo_total}}.

$$P = {{V}} \\cdot {{I}} = {{P}}$$
`;

describe('Reactive Markdown Parser, Field-Level Tables & DAG', () => {
  it('builds Markdown heading hierarchy and preserves lossless block replacement', () => {
    const ast = parseReactiveDocument(SAMPLE_DOC);
    // Root + H1 + H2 + H3
    const headings = ast.sections.filter((s) => s.level > 0);
    expect(headings.map((h) => [h.level, h.title])).toEqual([
      [1, 'Presupuesto Eléctrico'],
      [2, 'Materiales'],
      [3, 'Cálculos Eléctricos'],
    ]);
    // H3 is child of H2, H2 is child of H1
    const [h1, h2, h3] = headings;
    expect(h1 && h2 && h3).toBeTruthy();
    expect(h2!.parentId).toBe(h1!.id);
    expect(h3!.parentId).toBe(h2!.id);

    // Replace heading block and check rest of document is untouched
    const headingBlock = ast.blocks.find((b) => b.kind === 'heading' && b.level === 2)!;
    const updated = replaceBlockRange(
      SAMPLE_DOC,
      headingBlock.startLine,
      headingBlock.endLine,
      '## Lista de Materiales'
    );
    expect(updated).toContain('## Lista de Materiales');
    expect(updated).toContain('| Cable 2.5mm | 100 m | 1.2 USD/m | — | — |');
  });

  it('evaluates named tables with chained field-level @col formulas, global vars, and aggregates', () => {
    const doc = evaluateReactiveDocument(SAMPLE_DOC);
    expect(doc.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);

    const table = doc.tablesByName.get('materiales');
    expect(table).toBeDefined();
    expect(table!.rows).toHaveLength(2);

    // Row 0: 100 m * 1.2 USD/m = 120.00 USD; * 1.21 = 145.20 USD
    expect(table!.rows[0]?.[3]?.value?.formattedText).toBe('120.00 USD');
    expect(table!.rows[0]?.[4]?.value?.formattedText).toBe('145.20 USD');

    // Row 1: 4 u * 18 USD/u = 72.00 USD; * 1.21 = 87.12 USD
    expect(table!.rows[1]?.[3]?.value?.formattedText).toBe('72.00 USD');
    expect(table!.rows[1]?.[4]?.value?.formattedText).toBe('87.12 USD');

    // Downstream calc block values
    expect(doc.symbols.get('P')?.value?.formattedText).toBe('990 W');
    expect(doc.symbols.get('P_kw')?.value?.formattedText).toBe('0.99 kW');
    expect(doc.symbols.get('costo_total')?.value?.formattedText).toBe('232.32 USD');

    // Inline interpolation in text and LaTeX
    const proseBlocks = doc.ast.blocks.filter((b) => b.kind === 'prose');
    const summaryText = doc.interpolatedProse.get(proseBlocks[1]!.id)!;
    expect(summaryText).toContain('**990 W**');
    expect(summaryText).toContain('**0.99 kW**');
    expect(summaryText).toContain('**232.32 USD**');

    const mathText = doc.interpolatedProse.get(proseBlocks[2]!.id)!;
    expect(mathText).toBe('$$P = 220\\,\\text{V} \\cdot 4.5\\,\\text{A} = 990\\,\\text{W}$$');
  });

  it('auto-appends @col computed columns even if omitted from markdown rows', () => {
    const md = `
@tabla: cargas
@col Potencia = V * I -> W

| Circuito | V | I |
| :--- | :---: | :---: |
| Luces | 220 V | 2 A |
| Tomas | 220 V | 5 A |

\`\`\`calc
P_tot = sum(cargas.Potencia) -> kW
\`\`\`
`;
    const doc = evaluateReactiveDocument(md);
    expect(doc.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const tbl = doc.tablesByName.get('cargas')!;
    expect(tbl.headers).toEqual(['Circuito', 'V', 'I', 'Potencia']);
    expect(tbl.rows[0]?.[3]?.value?.formattedText).toBe('440 W');
    expect(tbl.rows[1]?.[3]?.value?.formattedText).toBe('1100 W');
    expect(doc.symbols.get('P_tot')?.value?.formattedText).toBe('1.54 kW');
  });

  it('detects cyclic dependencies in the DAG and reports the exact cycle', () => {
    const md = `
\`\`\`calc
A = B + 1
B = A + 1
C = 10 m
\`\`\`
`;
    const doc = evaluateReactiveDocument(md);
    expect(doc.dag.cycles.length).toBeGreaterThan(0);
    expect(doc.diagnostics.some((d) => d.message.includes('Dependencia circular'))).toBe(true);
    // Independent node C still evaluates cleanly!
    expect(doc.symbols.get('C')?.value?.formattedText).toBe('10 m');
  });

  it('recomputes only affected downstream nodes incrementally on edits', () => {
    const session = new ReactiveSession();
    const md1 = `
\`\`\`calc
x = 10 m
y = x * 2
z = 50 kg
\`\`\`
`;
    const r1 = session.evaluate(md1);
    expect(r1.symbols.get('y')?.value?.formattedText).toBe('20 m');
    expect(r1.symbols.get('z')?.value?.formattedText).toBe('50 kg');

    // Change x from 10 m to 15 m; z should NOT be recomputed!
    const md2 = md1.replace('x = 10 m', 'x = 15 m');
    const r2 = session.evaluate(md2);
    expect(r2.symbols.get('y')?.value?.formattedText).toBe('30 m');
    expect(r2.symbols.get('z')?.value?.formattedText).toBe('50 kg');
    expect(r2.recomputedNodeIds).toEqual(['x', 'y']);
    expect(r2.recomputedNodeIds).not.toContain('z');
  });

  it('supports HTML-comment wrapped directives as an alias', () => {
    const md = `
<!-- @tabla: items -->
<!-- @col Doble = Valor * 2 -->

| Nombre | Valor |
| :--- | :---: |
| A | 5 m |
`;
    const doc = evaluateReactiveDocument(md);
    const tbl = doc.tablesByName.get('items');
    expect(tbl).toBeDefined();
    expect(tbl!.rows[0]?.[2]?.value?.formattedText).toBe('10 m');
  });
});
