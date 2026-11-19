import { describe, it, expect } from 'vitest';
import {
  DEFAULT_REACTIVE_DOC_PATH,
  WELCOME_REACTIVE_DOC_CONTENT,
  createEmptyReactiveDocTemplate,
} from '../data/welcomeReactiveDoc';
import { evaluateReactiveDocument } from '../engine/evaluator/evaluateDocument';
import {
  ensureMarkdownExtension,
  getReactiveDocBaseName,
} from '../services/reactive/reactiveDocExport';

describe('Reactive Document Templates & Export Helpers', () => {
  it('evaluates the welcome reactive document with zero errors', () => {
    const doc = evaluateReactiveDocument(WELCOME_REACTIVE_DOC_CONTENT);
    const errors = doc.diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toEqual([]);

    expect(doc.symbols.get('P')?.value?.formattedText).toBe('910.8 W');
    expect(doc.symbols.get('P_kw')?.value?.formattedText).toBe('0.9108 kW');
    expect(doc.symbols.get('E_diaria')?.value?.formattedText).toBe('7.2864 kWh');
    expect(doc.symbols.get('subtotal_mat')?.value?.formattedText).toBe('269.00 USD');
    expect(doc.symbols.get('total_usd')?.value?.formattedText).toBe('325.49 USD');
    expect(doc.symbols.get('total_ars')?.value?.formattedText).toBe('390588.00 ARS');

    const tbl = doc.tablesByName.get('materiales');
    expect(tbl).toBeDefined();
    expect(tbl!.rows).toHaveLength(4);
    expect(tbl!.computedColumnNames.has('Subtotal')).toBe(true);
    expect(tbl!.computedColumnNames.has('Total')).toBe(true);
  });

  it('evaluates newly created empty reactive templates cleanly', () => {
    const md = createEmptyReactiveDocTemplate('Ensayo de Laboratorio');
    const doc = evaluateReactiveDocument(md);
    expect(doc.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(doc.symbols.get('P')?.value?.formattedText).toBe('550 W');
    expect(doc.symbols.get('total')?.value?.formattedText).toBe('30.00 USD');
  });

  it('normalizes markdown filenames cleanly', () => {
    expect(DEFAULT_REACTIVE_DOC_PATH).toBe('memoria-electrica.md');
    expect(ensureMarkdownExtension('presupuesto')).toBe('presupuesto.md');
    expect(ensureMarkdownExtension('/carpeta/calculo.md/')).toBe('carpeta/calculo.md');
    expect(getReactiveDocBaseName('carpeta/calculo')).toBe('calculo.md');
  });
});
