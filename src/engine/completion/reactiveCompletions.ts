import { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { EvaluatedDocument } from '../parser/types';

const DIRECTIVE_COMPLETIONS: Completion[] = [
  { label: '@tabla:', type: 'keyword', detail: 'Nombrar tabla Markdown', apply: '@tabla: nombre' },
  { label: '@col', type: 'keyword', detail: 'Columna calculada por campo', apply: '@col Total = ' },
  { label: '@unidad', type: 'keyword', detail: 'Declarar unidad / moneda', apply: '@unidad ' },
  { label: '@decimales', type: 'keyword', detail: 'Fijar decimales globales', apply: '@decimales 2' },
  { label: '@completo', type: 'keyword', detail: 'Fórmula + sustitución + resultado' },
  { label: '@formula', type: 'keyword', detail: 'Fórmula simbólica + resultado' },
  { label: '@resultado', type: 'keyword', detail: 'Solo resultado final' },
  { label: '@oculto', type: 'keyword', detail: 'Ocultar en modo Entregable/PDF' },
];

const FUNCTION_COMPLETIONS: Completion[] = [
  { label: 'sum', type: 'function', detail: 'Suma de columna con unidades', apply: 'sum(' },
  { label: 'avg', type: 'function', detail: 'Promedio de columna', apply: 'avg(' },
  { label: 'min', type: 'function', detail: 'Mínimo', apply: 'min(' },
  { label: 'max', type: 'function', detail: 'Máximo', apply: 'max(' },
  { label: 'count', type: 'function', detail: 'Cantidad de filas', apply: 'count(' },
  { label: 'sqrt', type: 'function', detail: 'Raíz cuadrada', apply: 'sqrt(' },
  { label: 'abs', type: 'function', detail: 'Valor absoluto', apply: 'abs(' },
  { label: 'round', type: 'function', detail: 'Redondeo', apply: 'round(' },
];

const CONTROL_SNIPPETS: Completion[] = [
  {
    label: '[var | input]',
    type: 'snippet',
    detail: 'Control input numérico con unidad',
    apply: '[V: 220 V | input]',
  },
  {
    label: '[var | slider]',
    type: 'snippet',
    detail: 'Control deslizador con rango',
    apply: '[I: 4.5 A | slider 0..20 step=0.5]',
  },
  {
    label: '[var | select]',
    type: 'snippet',
    detail: 'Selector de opciones',
    apply: '[fp: 0.92 | select 0.8, 0.85, 0.92, 1.0]',
  },
];

const COMMON_UNITS: Completion[] = [
  { label: 'V', type: 'constant', detail: 'Voltios' },
  { label: 'A', type: 'constant', detail: 'Amperios' },
  { label: 'W', type: 'constant', detail: 'Vatios' },
  { label: 'kW', type: 'constant', detail: 'Kilovatios' },
  { label: 'kWh', type: 'constant', detail: 'Kilovatio-hora' },
  { label: 'ohm', type: 'constant', detail: 'Ohmios (Ω)' },
  { label: 'Hz', type: 'constant', detail: 'Hertz' },
  { label: 'm', type: 'constant', detail: 'Metros' },
  { label: 'mm', type: 'constant', detail: 'Milímetros' },
  { label: 'm2', type: 'constant', detail: 'Metros cuadrados' },
  { label: 'kg', type: 'constant', detail: 'Kilogramos' },
  { label: 'N', type: 'constant', detail: 'Newtons' },
  { label: 'Pa', type: 'constant', detail: 'Pascales' },
  { label: 'MPa', type: 'constant', detail: 'Megapascales' },
  { label: 'USD', type: 'constant', detail: 'Dólares' },
  { label: 'ARS', type: 'constant', detail: 'Pesos argentinos' },
  { label: 'EUR', type: 'constant', detail: 'Euros' },
  { label: 'u', type: 'constant', detail: 'Unidades' },
];

export function buildReactiveCompletionItems(doc: EvaluatedDocument): Completion[] {
  const items: Completion[] = [];

  for (const [name, sym] of doc.symbols) {
    items.push({
      label: name,
      type: 'variable',
      detail: sym.value ? sym.value.formattedText : sym.error ? 'error' : 'variable',
      boost: 3,
    });
  }

  for (const [tableName, table] of doc.tablesByName) {
    items.push({
      label: tableName,
      type: 'class',
      detail: `tabla (${table.rows.length} filas)`,
      boost: 2,
    });
    for (const header of table.headers) {
      items.push({
        label: `${tableName}.${header}`,
        type: 'property',
        detail: table.computedColumnNames.has(header) ? 'columna @col' : 'columna tabla',
        boost: 2,
      });
    }
  }

  for (const unitDecl of doc.ast.unitDeclarations) {
    items.push({
      label: unitDecl.name,
      type: 'constant',
      detail: unitDecl.definition ? `= ${unitDecl.definition}` : 'unidad custom',
      boost: 1,
    });
  }

  return [
    ...items,
    ...DIRECTIVE_COMPLETIONS,
    ...FUNCTION_COMPLETIONS,
    ...CONTROL_SNIPPETS,
    ...COMMON_UNITS,
  ];
}

export function createReactiveCompletionSource(items: Completion[]) {
  return (context: CompletionContext): CompletionResult | null => {
    // Match @directives, table.Column, variable identifiers, or `[` control snippets
    const word = context.matchBefore(/(@[A-Za-z_]*|[A-Za-z_][A-Za-z0-9_.]*|\[[A-Za-z_]*)/);
    if (!word) return null;
    if (word.from === word.to && !context.explicit) return null;

    return {
      from: word.from,
      options: items,
      validFor: /^(@[A-Za-z_]*|[A-Za-z0-9_.]*|\[[^\]]*)$/,
    };
  };
}
