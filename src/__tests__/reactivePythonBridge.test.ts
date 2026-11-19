import { describe, it, expect } from 'vitest';
import { WELCOME_REACTIVE_DOC_CONTENT } from '../data/welcomeReactiveDoc';
import { evaluateReactiveDocument } from '../engine/evaluator/evaluateDocument';
import { parseReactiveDocument } from '../engine/parser/documentParser';
import {
  buildReactivePythonPreamble,
  isPythonCodeLanguage,
  parsePythonBlockVisibility,
} from '../engine/python/reactivePythonBridge';

describe('Reactive Markdown -> Python Hybrid Bridge', () => {
  it('bridges scalar variables, units, and @tabla: tables into safe Python preamble', () => {
    const doc = evaluateReactiveDocument(WELCOME_REACTIVE_DOC_CONTENT);
    const bridge = buildReactivePythonPreamble(doc);

    expect(bridge.bridgedSymbolCount).toBeGreaterThanOrEqual(8);
    expect(bridge.bridgedTableCount).toBe(1);
    expect(bridge.preambleCode).toContain('import json as _nl_json');
    expect(bridge.preambleCode).toContain('import pandas as _nl_pd');
    expect(bridge.preambleCode).toContain('run_line_magic("matplotlib", "inline")');

    const payload = JSON.parse(bridge.hash) as {
      scalars: Record<string, number | string>;
      units: Record<string, string>;
      tables: Record<
        string,
        { columns: Record<string, Array<number | string>>; units: Record<string, string> }
      >;
    };

    expect(payload.scalars.V).toBe(220);
    expect(payload.scalars.I).toBe(4.5);
    expect(payload.scalars.P).toBeCloseTo(910.8, 3);
    expect(payload.units.P).toBe('W');
    expect(payload.units.total_usd).toBe('USD');

    expect(payload.tables.materiales).toBeDefined();
    expect(payload.tables.materiales?.columns.Subtotal).toEqual([120, 72, 42, 35]);
    expect(payload.tables.materiales?.units.Total).toBe('USD');
  });

  it('changes bridge hash when reactive data changes and stays stable for prose-only edits', () => {
    const doc1 = evaluateReactiveDocument(WELCOME_REACTIVE_DOC_CONTENT);
    const bridge1 = buildReactivePythonPreamble(doc1);

    const proseEdited = WELCOME_REACTIVE_DOC_CONTENT.replace(
      'Circuito de Taller',
      'Circuito Principal de Taller'
    );
    const bridgeProse = buildReactivePythonPreamble(evaluateReactiveDocument(proseEdited));
    expect(bridgeProse.hash).toBe(bridge1.hash);

    const dataEdited = WELCOME_REACTIVE_DOC_CONTENT.replace('4.5 A', '10 A');
    const bridgeData = buildReactivePythonPreamble(evaluateReactiveDocument(dataEdited));
    expect(bridgeData.hash).not.toBe(bridge1.hash);
  });

  it('parses python fence language aliases and visibility directives (@mostrar / @oculto)', () => {
    const md = `
\`\`\`python
print(1)
\`\`\`

\`\`\`py @mostrar
print(2)
\`\`\`

\`\`\`python @oculto
x = 10
\`\`\`
`;
    const ast = parseReactiveDocument(md);
    const codeBlocks = ast.blocks.filter((b) => b.kind === 'code');
    expect(codeBlocks).toHaveLength(3);

    expect(isPythonCodeLanguage(codeBlocks[0]!.language)).toBe(true);
    expect(isPythonCodeLanguage(codeBlocks[1]!.language)).toBe(true);
    expect(parsePythonBlockVisibility(codeBlocks[0]!.meta)).toBe('output-only');
    expect(parsePythonBlockVisibility(codeBlocks[1]!.meta)).toBe('show-code');
    expect(parsePythonBlockVisibility(codeBlocks[2]!.meta)).toBe('hidden');
  });
});
