import { describe, it, expect } from 'vitest';
import {
  parseReactiveDocument,
  updateControlValueInMarkdown,
} from '../engine/parser/documentParser';
import {
  ReactiveSession,
  evaluateReactiveDocument,
} from '../engine/evaluator/evaluateDocument';
import { buildReactiveCompletionItems } from '../engine/completion/reactiveCompletions';
import { sanitizeParametricSvg } from '../components/reactive/ReactiveSvgBlock';
import { exportEvaluatedDocumentToLatex } from '../services/reactive/latexExport';

const PHASE2_DOC = `# Circuito Paramétrico

Ver [referencia técnica](https://example.com). Usamos tensión [V: 220 V | input min=100 max=400], corriente [I: 5 A | slider 0..20 step=0.5] y factor [fp: 0.9 | select 0.8, 0.9, 1.0].

\`\`\`calc @oculto
k_seg = 1.25
\`\`\`

\`\`\`calc
P = V * I * fp -> W
ancho = 120 mm
\`\`\`

\`\`\`mermaid
flowchart LR
  A["Tensión {{V}}"] --> B["Potencia {{P}}"]
\`\`\`

\`\`\`svg
<svg viewBox="0 0 200 60" width="{{ancho | num}}">
  <rect x="0" y="0" width="{{ancho | num}}" height="20" />
  <text x="5" y="45">{{P}}</text>
</svg>
\`\`\`

## Resumen

@tabla: resumen
@col Potencia = V_row * I_row -> W

| Caso | V_row | I_row |
| :--- | :---: | :---: |
| Nominal | 220 V | 5 A |
`;

describe('Reactive Phase 2 — Declarative Controls, Parametric Diagrams, Autocomplete & LaTeX Export', () => {
  it('parses input/slider/select controls without confusing Markdown links and updates bidirectionally', () => {
    const ast = parseReactiveDocument(PHASE2_DOC);
    const prose = ast.blocks.find((b) => b.kind === 'prose')!;
    expect(prose.kind).toBe('prose');
    if (prose.kind !== 'prose') return;

    expect(prose.controls).toHaveLength(3);
    expect(prose.controls[0]?.name).toBe('V');
    expect(prose.controls[0]?.widget).toBe('input');
    expect(prose.controls[0]?.numericPart).toBe(220);
    expect(prose.controls[0]?.unitSuffix).toBe('V');
    expect(prose.controls[0]?.min).toBe(100);
    expect(prose.controls[0]?.max).toBe(400);

    expect(prose.controls[1]?.name).toBe('I');
    expect(prose.controls[1]?.widget).toBe('slider');
    expect(prose.controls[1]?.min).toBe(0);
    expect(prose.controls[1]?.max).toBe(20);
    expect(prose.controls[1]?.step).toBe(0.5);

    expect(prose.controls[2]?.name).toBe('fp');
    expect(prose.controls[2]?.widget).toBe('select');
    expect(prose.controls[2]?.options).toEqual(['0.8', '0.9', '1.0']);

    const session = new ReactiveSession();
    const eval1 = session.evaluate(PHASE2_DOC);
    expect(eval1.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(eval1.symbols.get('P')?.value?.formattedText).toBe('990 W');

    // Bidirectionally move slider I from 5 A to 10 A
    const updatedMd = updateControlValueInMarkdown(
      PHASE2_DOC,
      prose,
      prose.controls[1]!,
      '10 A'
    );
    expect(updatedMd).toContain('[I: 10 A | slider 0..20 step=0.5]');
    expect(updatedMd).toContain('[referencia técnica](https://example.com)');

    const eval2 = session.evaluate(updatedMd);
    expect(eval2.symbols.get('P')?.value?.formattedText).toBe('1980 W');
    // Incremental recomputation: only I and P should be recomputed, NOT ancho or k_seg
    expect(eval2.recomputedNodeIds).toContain('I');
    expect(eval2.recomputedNodeIds).toContain('P');
    expect(eval2.recomputedNodeIds).not.toContain('ancho');
  });

  it('interpolates parametric Mermaid and SVG blocks including | num filter and sanitizes unsafe SVG', () => {
    const doc = evaluateReactiveDocument(PHASE2_DOC);
    const mermaidBlock = doc.ast.blocks.find((b) => b.kind === 'code' && b.language === 'mermaid')!;
    const svgBlock = doc.ast.blocks.find((b) => b.kind === 'code' && b.language === 'svg')!;

    const mermaidOut = doc.interpolatedCodeBlocks.get(mermaidBlock.id)!;
    expect(mermaidOut).toContain('Tensión 220 V');
    expect(mermaidOut).toContain('Potencia 990 W');

    const svgOut = doc.interpolatedCodeBlocks.get(svgBlock.id)!;
    expect(svgOut).toContain('width="120"');
    expect(svgOut).toContain('<text x="5" y="45">990 W</text>');

    const unsafe = '<svg onclick="alert(1)"><script>evil()</script><rect width="10" /><a href="javascript:alert(2)">x</a></svg>';
    const clean = sanitizeParametricSvg(unsafe);
    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('onclick');
    expect(clean).not.toContain('javascript:');
    expect(clean).toContain('<rect width="10" />');
  });

  it('generates contextual CodeMirror completions from evaluated variables, tables, and directives', () => {
    const doc = evaluateReactiveDocument(PHASE2_DOC);
    const completions = buildReactiveCompletionItems(doc);
    const labels = new Set(completions.map((c) => c.label));

    expect(labels.has('P')).toBe(true);
    expect(labels.has('V')).toBe(true);
    expect(labels.has('resumen')).toBe(true);
    expect(labels.has('resumen.Potencia')).toBe(true);
    expect(labels.has('@tabla:')).toBe(true);
    expect(labels.has('@col')).toBe(true);
    expect(labels.has('[var | slider]')).toBe(true);

    const pItem = completions.find((c) => c.label === 'P');
    expect(pItem?.detail).toBe('990 W');
  });

  it('exports evaluated document to clean compilable LaTeX omitting @oculto blocks', () => {
    const doc = evaluateReactiveDocument(PHASE2_DOC);
    const tex = exportEvaluatedDocumentToLatex(doc, 'circuito.md');

    expect(tex).toContain('\\documentclass[11pt,a4paper]{article}');
    expect(tex).toContain('\\section{Circuito Paramétrico}');
    expect(tex).toContain('\\subsection{Resumen}');
    // Hidden block variable k_seg must NOT appear in exported LaTeX
    expect(tex).not.toContain('k_{\\text{seg}}');
    // Visible equations & evaluated table values MUST appear
    expect(tex).toContain('990\\,\\text{W}');
    expect(tex).toContain('\\toprule');
    expect(tex).toContain('1100 W');
  });
});
