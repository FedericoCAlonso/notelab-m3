export type RenderMode = 'full' | 'formula' | 'result' | 'hidden';

export type DiagnosticSeverity = 'error' | 'warning';

export interface Diagnostic {
  id: string;
  severity: DiagnosticSeverity;
  message: string;
  line: number; // 1-based line number in raw markdown
  blockId?: string;
  symbol?: string;
}

export interface SectionNode {
  id: string;
  level: number; // 1..6 (0 for preamble before first heading)
  title: string;
  slug: string;
  startLine: number; // 0-based inclusive
  endLine: number; // 0-based inclusive
  parentId: string | null;
  childrenIds: string[];
  blockIds: string[];
}

export interface ComputedColumnDef {
  name: string;
  expression: string;
  targetUnit?: string;
  line: number; // 1-based
}

export interface ParsedTableRow {
  line: number; // 1-based
  cells: string[];
}

export interface TableBlock {
  kind: 'table';
  id: string;
  sectionId: string;
  startLine: number; // 0-based inclusive
  endLine: number; // 0-based inclusive
  raw: string;
  tableName: string | null; // null if anonymous markdown table
  computedColumns: ComputedColumnDef[];
  headers: string[];
  alignments: Array<'left' | 'center' | 'right' | null>;
  rows: ParsedTableRow[];
}

export interface UnitDeclaration {
  name: string;
  definition?: string; // e.g. "100 m" or "1/1200 USD"
  line: number; // 1-based
}

export interface CalcStatement {
  id: string;
  line: number; // 1-based
  raw: string;
  kind: 'assignment' | 'expression' | 'unit_decl' | 'decimals_decl' | 'comment';
  target?: string; // variable name for assignment
  expression?: string; // RHS expression (without target unit or @mode)
  targetUnit?: string; // unit after `->`
  renderMode: RenderMode;
  unitDecl?: UnitDeclaration;
  decimals?: number;
}

export interface CalcBlock {
  kind: 'calc';
  id: string;
  sectionId: string;
  startLine: number;
  endLine: number;
  raw: string;
  defaultRenderMode: RenderMode;
  statements: CalcStatement[];
}

export interface InlineToken {
  id: string;
  raw: string; // e.g. "{{V := 220 V}}" or "{{P -> kW}}"
  startOffset: number; // char offset within block.raw
  endOffset: number;
  line: number; // 1-based
  kind: 'define' | 'interpolate';
  target?: string; // for define (:=)
  expression: string;
  targetUnit?: string;
  inMathContext: boolean; // true if inside $...$ or $$...$$
}

export type ControlWidgetType = 'input' | 'slider' | 'select';

export interface ControlToken {
  id: string;
  raw: string; // e.g. "[I: 4.5 A | slider 0..20 step=0.5]"
  startOffset: number; // char offset within block.raw
  endOffset: number;
  valueStartOffset: number; // char offset of value substring within block.raw
  valueEndOffset: number;
  line: number; // 1-based
  name: string; // variable symbol name
  valueExpr: string; // e.g. "4.5 A"
  numericPart: number | null; // e.g. 4.5
  unitSuffix: string; // e.g. "A" or ""
  widget: ControlWidgetType;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
}

export interface ProseBlock {
  kind: 'prose';
  id: string;
  sectionId: string;
  startLine: number;
  endLine: number;
  raw: string;
  inlineTokens: InlineToken[];
  controls: ControlToken[];
}

export interface HeadingBlock {
  kind: 'heading';
  id: string;
  sectionId: string;
  startLine: number;
  endLine: number;
  raw: string;
  level: number;
  title: string;
  slug: string;
}

export interface CodeBlock {
  kind: 'code';
  id: string;
  sectionId: string;
  startLine: number;
  endLine: number;
  raw: string;
  language: string;
  content: string;
}

export type DocBlock = HeadingBlock | ProseBlock | TableBlock | CalcBlock | CodeBlock;

export interface ReactiveDocumentAST {
  raw: string;
  lines: string[];
  sections: SectionNode[];
  blocks: DocBlock[];
  unitDeclarations: UnitDeclaration[];
  decimals: number | null;
}

export interface EvaluatedValue {
  raw: unknown; // number | mathjs Unit | string | array
  isUnit: boolean;
  isNumber: boolean;
  isString: boolean;
  unitString: string | null;
  numericValue: number | null;
  formattedText: string; // e.g. "990 W" or "274.67 USD"
  formattedTex: string; // e.g. "990\\,\\text{W}"
}

export interface EvaluatedSymbol {
  name: string;
  value?: EvaluatedValue;
  error?: string;
  line: number;
  blockId: string;
  dependencies: string[];
}

export interface EvaluatedTableCell {
  rawText: string;
  value?: EvaluatedValue;
  isComputed: boolean;
  error?: string;
}

export interface EvaluatedTable {
  blockId: string;
  name: string | null;
  headers: string[];
  computedColumnNames: Set<string>;
  computedFormulas: Record<string, string>; // colName -> "Cantidad * Precio"
  alignments: Array<'left' | 'center' | 'right' | null>;
  rows: EvaluatedTableCell[][];
  columnValues: Record<string, EvaluatedValue[]>;
  errors: string[];
}

export interface EvaluatedCalcLine {
  statementId: string;
  line: number;
  kind: CalcStatement['kind'];
  target?: string;
  renderMode: RenderMode;
  symbolicTex?: string;
  substitutedTex?: string;
  resultTex?: string;
  fullTex?: string; // assembled TeX ready for KaTeX according to renderMode
  value?: EvaluatedValue;
  error?: string;
  dependencies: string[];
  raw: string;
}

export interface EvaluatedCalcBlock {
  blockId: string;
  defaultRenderMode: RenderMode;
  lines: EvaluatedCalcLine[];
}

export interface DAGNodeInfo {
  id: string;
  kind: 'symbol' | 'table' | 'table_column' | 'expression';
  dependencies: string[];
  dependents: string[];
  blockId: string;
  line: number;
}

export interface DAGSnapshot {
  nodes: Map<string, DAGNodeInfo>;
  evaluationOrder: string[];
  cycles: string[][];
}

export interface EvaluatedDocument {
  ast: ReactiveDocumentAST;
  dag: DAGSnapshot;
  symbols: Map<string, EvaluatedSymbol>;
  tables: Map<string, EvaluatedTable>; // keyed by blockId
  tablesByName: Map<string, EvaluatedTable>; // keyed by tableName
  calcBlocks: Map<string, EvaluatedCalcBlock>; // keyed by blockId
  interpolatedProse: Map<string, string>; // keyed by blockId
  interpolatedCodeBlocks: Map<string, string>; // keyed by blockId (mermaid/svg)
  diagnostics: Diagnostic[];
  recomputedNodeIds: string[];
}
