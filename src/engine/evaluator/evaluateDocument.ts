import { ReactiveDAG, DAGNodeInput } from '../dag/dependencyGraph';
import {
  ParsedExpressionInfo,
  TableScopeProxy,
  evaluateParsedExpression,
  parseExpression,
  parseTableCellValue,
} from '../math/expressionEvaluator';
import { formatCalcStatementToTex } from '../math/latexFormatter';
import { UnitEngine, createUnitEngine } from '../math/unitRegistry';
import { parseReactiveDocument } from '../parser/documentParser';
import {
  CalcBlock,
  CalcStatement,
  ControlToken,
  Diagnostic,
  EvaluatedCalcBlock,
  EvaluatedCalcLine,
  EvaluatedDocument,
  EvaluatedSymbol,
  EvaluatedTable,
  EvaluatedTableCell,
  EvaluatedValue,
  InlineToken,
  ProseBlock,
  ReactiveDocumentAST,
  TableBlock,
} from '../parser/types';

interface ExecutableNode {
  id: string;
  kind: 'symbol' | 'table' | 'expression';
  signature: string;
  blockId: string;
  line: number;
  rawDependencies: string[];
  tableBlock?: TableBlock;
  calcStatement?: CalcStatement;
  inlineDefine?: { block: ProseBlock; token: InlineToken };
  controlDefine?: { block: ProseBlock; control: ControlToken };
  parsedExpr?: ParsedExpressionInfo;
  parseError?: string;
}

interface CachedNodeResult {
  signature: string;
  symbol?: EvaluatedSymbol;
  table?: EvaluatedTable;
  tableProxy?: TableScopeProxy;
  calcLine?: EvaluatedCalcLine;
  rawScopeValue?: unknown;
}

function buildTableProxy(
  table: EvaluatedTable
): TableScopeProxy {
  const rowObjects: Record<string, unknown>[] = table.rows.map((rowCells) => {
    const obj: Record<string, unknown> = {};
    table.headers.forEach((header, idx) => {
      const cell = rowCells[idx];
      obj[header] = cell?.value ? cell.value.raw : cell?.rawText ?? '';
    });
    return obj;
  });

  const proxy: TableScopeProxy = {
    __isReactiveTable: true,
    __rowCount: table.rows.length,
    __row: (index: number) => {
      const i = Math.trunc(index);
      const found = rowObjects[i];
      if (!found) {
        throw new Error(`Fila fuera de rango [${i}] en tabla "${table.name ?? ''}"`);
      }
      return found;
    },
    fila: (key: string) => {
      const target = String(key).trim().toLowerCase();
      const firstHeader = table.headers[0];
      if (!firstHeader) {
        throw new Error(`La tabla "${table.name ?? ''}" no tiene columnas`);
      }
      const foundIdx = table.rows.findIndex(
        (r) => (r[0]?.rawText ?? '').trim().toLowerCase() === target
      );
      const found = foundIdx >= 0 ? rowObjects[foundIdx] : undefined;
      if (!found) {
        throw new Error(`No se encontró la fila "${key}" en tabla "${table.name ?? ''}"`);
      }
      return found;
    },
  };

  for (const header of table.headers) {
    const colVals = table.columnValues[header] ?? [];
    proxy[header] = colVals.map((v) => v.raw);
  }

  return proxy;
}

function evaluateTableBlock(
  block: TableBlock,
  engine: UnitEngine,
  globalScope: Record<string, unknown>,
  definedSymbols: ReadonlySet<string>,
  tableNames: ReadonlySet<string>,
  diagnostics: Diagnostic[]
): { table: EvaluatedTable; proxy: TableScopeProxy } {
  const errors: string[] = [];

  // Build final headers list: existing headers + any @col not explicitly present in markdown
  const headers = [...block.headers];
  const alignments = [...block.alignments];
  const computedColumnNames = new Set<string>();
  const computedFormulas: Record<string, string> = {};
  const computedDefsByName = new Map(block.computedColumns.map((c) => [c.name, c]));

  for (const colDef of block.computedColumns) {
    computedColumnNames.add(colDef.name);
    computedFormulas[colDef.name] = colDef.targetUnit
      ? `${colDef.expression} -> ${colDef.targetUnit}`
      : colDef.expression;
    if (!headers.includes(colDef.name)) {
      headers.push(colDef.name);
      alignments.push('right');
    }
  }

  // Parse computed column expressions and sort them topologically via a mini-DAG
  const colParsed = new Map<string, ParsedExpressionInfo>();
  const colParseErrors = new Map<string, string>();
  const colScopeNames = new Set<string>([...definedSymbols, ...headers]);

  const colDagInputs: DAGNodeInput[] = [];
  for (const colDef of block.computedColumns) {
    const fullExpr = colDef.targetUnit
      ? `${colDef.expression} -> ${colDef.targetUnit}`
      : colDef.expression;
    try {
      const parsed = parseExpression(fullExpr, engine, colScopeNames, tableNames);
      colParsed.set(colDef.name, parsed);
      colDagInputs.push({
        id: colDef.name,
        kind: 'table_column',
        rawDependencies: parsed.dependencies,
        blockId: block.id,
        line: colDef.line,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      colParseErrors.set(colDef.name, `Error en columna "${colDef.name}": ${msg}`);
      errors.push(`Columna ${colDef.name}: ${msg}`);
      diagnostics.push({
        id: `diag-col-parse-${block.id}-${colDef.name}`,
        severity: 'error',
        message: `Error de sintaxis en @col ${colDef.name}: ${msg}`,
        line: colDef.line,
        blockId: block.id,
      });
      colDagInputs.push({
        id: colDef.name,
        kind: 'table_column',
        rawDependencies: [],
        blockId: block.id,
        line: colDef.line,
      });
    }
  }

  const colDag = ReactiveDAG.build(colDagInputs);
  const cyclicCols = new Set<string>();
  for (const cycle of colDag.cycles) {
    const msg = `Ciclo entre columnas calculadas: ${cycle.join(' → ')}`;
    errors.push(msg);
    for (const c of cycle) cyclicCols.add(c);
    diagnostics.push({
      id: `diag-col-cycle-${block.id}-${cycle.join('-')}`,
      severity: 'error',
      message: msg,
      line: block.startLine + 1,
      blockId: block.id,
    });
  }

  // Evaluate rows
  const columnValues: Record<string, EvaluatedValue[]> = {};
  for (const h of headers) columnValues[h] = [];

  const evaluatedRows: EvaluatedTableCell[][] = block.rows.map((parsedRow) => {
    const rowCells: EvaluatedTableCell[] = headers.map((h, idx) => {
      const isComputed = computedColumnNames.has(h);
      const rawText = parsedRow.cells[idx] ?? '';
      if (isComputed) {
        return {
          rawText,
          isComputed: true,
        };
      }
      const val = parseTableCellValue(rawText, engine);
      return {
        rawText,
        value: val,
        isComputed: false,
      };
    });

    // Build local row scope with non-computed cells
    const rowScope: Record<string, unknown> = { ...globalScope };
    headers.forEach((h, idx) => {
      const cell = rowCells[idx];
      if (!computedColumnNames.has(h) && cell?.value) {
        rowScope[h] = cell.value.raw;
      }
    });

    // Evaluate computed columns in topological order
    for (const colName of colDag.evaluationOrder) {
      const colIdx = headers.indexOf(colName);
      if (colIdx < 0) continue;
      const existingCell = rowCells[colIdx];

      const parseErr = colParseErrors.get(colName);
      if (parseErr) {
        rowCells[colIdx] = {
          rawText: existingCell?.rawText ?? '',
          isComputed: true,
          error: parseErr,
        };
        continue;
      }

      const parsed = colParsed.get(colName);
      if (!parsed) continue;

      const evalRes = evaluateParsedExpression(parsed, engine, rowScope);
      if (evalRes.ok) {
        rowCells[colIdx] = {
          rawText: evalRes.value.formattedText,
          value: evalRes.value,
          isComputed: true,
        };
        rowScope[colName] = evalRes.value.raw;
      } else {
        rowCells[colIdx] = {
          rawText: existingCell?.rawText ?? '',
          isComputed: true,
          error: evalRes.error,
        };
        const colDef = computedDefsByName.get(colName);
        diagnostics.push({
          id: `diag-col-eval-${block.id}-${colName}-${parsedRow.line}`,
          severity: 'error',
          message: `Error en ${block.tableName ?? 'tabla'}.${colName} (fila línea ${parsedRow.line}): ${evalRes.error}`,
          line: colDef?.line ?? parsedRow.line,
          blockId: block.id,
        });
      }
    }

    // Mark cyclic columns on every row
    for (const cyclicCol of cyclicCols) {
      const colIdx = headers.indexOf(cyclicCol);
      if (colIdx >= 0) {
        rowCells[colIdx] = {
          rawText: rowCells[colIdx]?.rawText ?? '',
          isComputed: true,
          error: 'Ciclo entre columnas',
        };
      }
    }

    // Collect column values for downstream aggregation
    headers.forEach((h, idx) => {
      const cell = rowCells[idx];
      const colArr = columnValues[h];
      if (cell?.value && colArr) {
        colArr.push(cell.value);
      }
    });

    return rowCells;
  });

  const table: EvaluatedTable = {
    blockId: block.id,
    name: block.tableName,
    headers,
    computedColumnNames,
    computedFormulas,
    alignments,
    rows: evaluatedRows,
    columnValues,
    errors,
  };

  return {
    table,
    proxy: buildTableProxy(table),
  };
}

export class ReactiveSession {
  private prevCache = new Map<string, CachedNodeResult>();
  private prevEnvSignature = '';

  evaluate(rawMarkdown: string): EvaluatedDocument {
    const ast: ReactiveDocumentAST = parseReactiveDocument(rawMarkdown);
    const diagnostics: Diagnostic[] = [];

    // 1. Setup isolated UnitEngine with document-level custom units & decimals
    const engine = createUnitEngine(ast.decimals);
    const envSignature = JSON.stringify({
      units: ast.unitDeclarations.map((u) => `${u.name}=${u.definition ?? ''}`),
      decimals: ast.decimals,
    });
    const envChanged = envSignature !== this.prevEnvSignature;

    for (const unitDecl of ast.unitDeclarations) {
      const reg = engine.registerCustomUnit(unitDecl);
      if (!reg.ok) {
        diagnostics.push({
          id: `diag-unit-${unitDecl.line}-${unitDecl.name}`,
          severity: 'error',
          message: reg.error,
          line: unitDecl.line,
        });
      }
    }

    // 2. First pass: collect all defined symbol names & table names so AST quantity disambiguation knows variables
    const definedSymbols = new Set<string>();
    const tableNames = new Set<string>();

    for (const block of ast.blocks) {
      if (block.kind === 'table' && block.tableName) {
        tableNames.add(block.tableName);
        definedSymbols.add(block.tableName);
      } else if (block.kind === 'calc') {
        for (const stmt of block.statements) {
          if (stmt.kind === 'assignment' && stmt.target) {
            definedSymbols.add(stmt.target);
          }
        }
      } else if (block.kind === 'prose') {
        for (const tok of block.inlineTokens) {
          if (tok.kind === 'define' && tok.target) {
            definedSymbols.add(tok.target);
          }
        }
        for (const ctrl of block.controls) {
          definedSymbols.add(ctrl.name);
        }
      }
    }

    // 3. Build executable DAG node descriptors
    const execNodes = new Map<string, ExecutableNode>();
    const dagInputs: DAGNodeInput[] = [];
    const seenSymbolIds = new Set<string>();

    for (const block of ast.blocks) {
      if (block.kind === 'table') {
        const nodeId = block.tableName ?? `__tbl_${block.id}`;
        if (block.tableName) {
          if (seenSymbolIds.has(nodeId)) {
            diagnostics.push({
              id: `diag-dup-${nodeId}-${block.startLine}`,
              severity: 'warning',
              message: `Tabla duplicada: "${nodeId}" ya estaba definida anteriormente`,
              line: block.startLine + 1,
              blockId: block.id,
              symbol: nodeId,
            });
          }
          seenSymbolIds.add(nodeId);
        }

        // Gather global variable dependencies referenced by @col computed formulas
        const tableHeaders = new Set<string>([
          ...block.headers,
          ...block.computedColumns.map((c) => c.name),
        ]);
        const tableGlobalDeps = new Set<string>();
        for (const colDef of block.computedColumns) {
          const fullExpr = colDef.targetUnit
            ? `${colDef.expression} -> ${colDef.targetUnit}`
            : colDef.expression;
          try {
            const parsed = parseExpression(
              fullExpr,
              engine,
              new Set([...definedSymbols, ...tableHeaders]),
              tableNames
            );
            for (const dep of parsed.dependencies) {
              if (!tableHeaders.has(dep) && dep !== nodeId) {
                tableGlobalDeps.add(dep);
              }
            }
          } catch {
            // Syntax error will be reported during table evaluation
          }
        }

        const execNode: ExecutableNode = {
          id: nodeId,
          kind: 'table',
          signature: `tbl:${block.raw}`,
          blockId: block.id,
          line: block.startLine + 1,
          rawDependencies: Array.from(tableGlobalDeps),
          tableBlock: block,
        };
        execNodes.set(nodeId, execNode);
        dagInputs.push({
          id: nodeId,
          kind: 'table',
          rawDependencies: execNode.rawDependencies,
          blockId: block.id,
          line: execNode.line,
        });
      } else if (block.kind === 'calc') {
        for (const stmt of block.statements) {
          if (stmt.kind === 'comment' || stmt.kind === 'unit_decl' || stmt.kind === 'decimals_decl') {
            continue;
          }
          const fullExpr = stmt.targetUnit
            ? `${stmt.expression ?? ''} -> ${stmt.targetUnit}`
            : (stmt.expression ?? '');
          const nodeId = stmt.kind === 'assignment' && stmt.target ? stmt.target : stmt.id;

          if (stmt.kind === 'assignment' && stmt.target) {
            if (seenSymbolIds.has(nodeId)) {
              diagnostics.push({
                id: `diag-dup-${nodeId}-${stmt.line}`,
                severity: 'warning',
                message: `Variable redefinida: "${nodeId}" ya estaba declarada anteriormente`,
                line: stmt.line,
                blockId: block.id,
                symbol: nodeId,
              });
            }
            seenSymbolIds.add(nodeId);
          }

          let parsedExpr: ParsedExpressionInfo | undefined;
          let parseError: string | undefined;
          let deps: string[] = [];
          try {
            parsedExpr = parseExpression(fullExpr, engine, definedSymbols, tableNames);
            deps = parsedExpr.dependencies;
          } catch (err) {
            parseError = err instanceof Error ? err.message : String(err);
          }

          const execNode: ExecutableNode = {
            id: nodeId,
            kind: stmt.kind === 'assignment' ? 'symbol' : 'expression',
            signature: `calc:${stmt.kind}:${stmt.target ?? ''}:${fullExpr}:${stmt.renderMode}`,
            blockId: block.id,
            line: stmt.line,
            rawDependencies: deps,
            calcStatement: stmt,
            parsedExpr,
            parseError,
          };
          execNodes.set(nodeId, execNode);
          dagInputs.push({
            id: nodeId,
            kind: execNode.kind,
            rawDependencies: deps,
            blockId: block.id,
            line: stmt.line,
          });
        }
      } else if (block.kind === 'prose') {
        for (const tok of block.inlineTokens) {
          if (tok.kind !== 'define' || !tok.target) continue;
          const nodeId = tok.target;
          if (seenSymbolIds.has(nodeId)) {
            diagnostics.push({
              id: `diag-dup-${nodeId}-${tok.line}`,
              severity: 'warning',
              message: `Variable redefinida en línea: "${nodeId}"`,
              line: tok.line,
              blockId: block.id,
              symbol: nodeId,
            });
          }
          seenSymbolIds.add(nodeId);

          const fullExpr = tok.targetUnit
            ? `${tok.expression} -> ${tok.targetUnit}`
            : tok.expression;

          let parsedExpr: ParsedExpressionInfo | undefined;
          let parseError: string | undefined;
          let deps: string[] = [];
          try {
            parsedExpr = parseExpression(fullExpr, engine, definedSymbols, tableNames);
            deps = parsedExpr.dependencies;
          } catch (err) {
            parseError = err instanceof Error ? err.message : String(err);
          }

          const execNode: ExecutableNode = {
            id: nodeId,
            kind: 'symbol',
            signature: `inline:${nodeId}:${fullExpr}`,
            blockId: block.id,
            line: tok.line,
            rawDependencies: deps,
            inlineDefine: { block, token: tok },
            parsedExpr,
            parseError,
          };
          execNodes.set(nodeId, execNode);
          dagInputs.push({
            id: nodeId,
            kind: 'symbol',
            rawDependencies: deps,
            blockId: block.id,
            line: tok.line,
          });
        }

        for (const ctrl of block.controls) {
          const nodeId = ctrl.name;
          if (seenSymbolIds.has(nodeId)) {
            diagnostics.push({
              id: `diag-dup-${nodeId}-${ctrl.line}`,
              severity: 'warning',
              message: `Variable redefinida en control: "${nodeId}"`,
              line: ctrl.line,
              blockId: block.id,
              symbol: nodeId,
            });
          }
          seenSymbolIds.add(nodeId);

          let parsedExpr: ParsedExpressionInfo | undefined;
          let parseError: string | undefined;
          let deps: string[] = [];
          try {
            parsedExpr = parseExpression(ctrl.valueExpr, engine, definedSymbols, tableNames);
            deps = parsedExpr.dependencies;
          } catch (err) {
            parseError = err instanceof Error ? err.message : String(err);
          }

          const execNode: ExecutableNode = {
            id: nodeId,
            kind: 'symbol',
            signature: `ctrl:${nodeId}:${ctrl.valueExpr}`,
            blockId: block.id,
            line: ctrl.line,
            rawDependencies: deps,
            controlDefine: { block, control: ctrl },
            parsedExpr,
            parseError,
          };
          execNodes.set(nodeId, execNode);
          dagInputs.push({
            id: nodeId,
            kind: 'symbol',
            rawDependencies: deps,
            blockId: block.id,
            line: ctrl.line,
          });
        }
      }
    }

    // 4. Build DAG & determine minimal recomputation set
    const dag = ReactiveDAG.build(dagInputs);

    const cyclicNodeErrors = new Map<string, string>();
    for (const cycle of dag.cycles) {
      const msg = `Dependencia circular detectada: ${cycle.join(' → ')}`;
      for (const id of cycle) {
        cyclicNodeErrors.set(id, msg);
      }
      const firstId = cycle[0];
      const firstNode = firstId ? execNodes.get(firstId) : undefined;
      diagnostics.push({
        id: `diag-cycle-${cycle.join('-')}`,
        severity: 'error',
        message: msg,
        line: firstNode?.line ?? 1,
        blockId: firstNode?.blockId,
        symbol: firstId,
      });
    }

    const changedNodeIds: string[] = [];
    if (envChanged || this.prevCache.size === 0) {
      changedNodeIds.push(...dag.evaluationOrder);
    } else {
      for (const id of dag.evaluationOrder) {
        const node = execNodes.get(id);
        const cached = this.prevCache.get(id);
        if (!node || !cached || cached.signature !== node.signature) {
          changedNodeIds.push(id);
        }
      }
    }

    const recomputedSet = new Set<string>(
      envChanged ? dag.evaluationOrder : dag.getAffectedOrder(changedNodeIds)
    );

    // 5. Evaluate nodes in topological order (reusing cached untouched nodes!)
    const symbols = new Map<string, EvaluatedSymbol>();
    const symbolValues = new Map<string, EvaluatedValue>();
    const tables = new Map<string, EvaluatedTable>();
    const tablesByName = new Map<string, EvaluatedTable>();
    const calcLineMap = new Map<string, EvaluatedCalcLine>();
    const evalScope: Record<string, unknown> = {};
    const nextCache = new Map<string, CachedNodeResult>();

    for (const nodeId of dag.evaluationOrder) {
      const execNode = execNodes.get(nodeId);
      if (!execNode) continue;

      const canReuse = !recomputedSet.has(nodeId) && this.prevCache.has(nodeId);
      if (canReuse) {
        const cached = this.prevCache.get(nodeId)!;
        nextCache.set(nodeId, cached);
        if (cached.symbol) {
          symbols.set(nodeId, cached.symbol);
          if (cached.symbol.value) {
            symbolValues.set(nodeId, cached.symbol.value);
            evalScope[nodeId] = cached.symbol.value.raw;
          }
        }
        if (cached.table && execNode.tableBlock) {
          tables.set(execNode.tableBlock.id, cached.table);
          if (cached.table.name) {
            tablesByName.set(cached.table.name, cached.table);
            evalScope[cached.table.name] = cached.tableProxy;
          }
        }
        if (cached.calcLine && execNode.calcStatement) {
          calcLineMap.set(execNode.calcStatement.id, cached.calcLine);
        }
        continue;
      }

      // Fresh evaluation of this node
      if (execNode.kind === 'table' && execNode.tableBlock) {
        const { table, proxy } = evaluateTableBlock(
          execNode.tableBlock,
          engine,
          evalScope,
          definedSymbols,
          tableNames,
          diagnostics
        );
        tables.set(execNode.tableBlock.id, table);
        if (table.name) {
          tablesByName.set(table.name, table);
          evalScope[table.name] = proxy;
        }
        nextCache.set(nodeId, {
          signature: execNode.signature,
          table,
          tableProxy: proxy,
        });
        continue;
      }

      // Calc statement or inline define
      const stmt = execNode.calcStatement;
      const renderMode = stmt?.renderMode ?? 'full';

      if (execNode.parseError || !execNode.parsedExpr) {
        const errMsg = `Error de sintaxis: ${execNode.parseError ?? 'expresión inválida'}`;
        diagnostics.push({
          id: `diag-parse-${nodeId}-${execNode.line}`,
          severity: 'error',
          message: errMsg,
          line: execNode.line,
          blockId: execNode.blockId,
          symbol: execNode.kind === 'symbol' ? nodeId : undefined,
        });

        const symEntry: EvaluatedSymbol | undefined =
          execNode.kind === 'symbol'
            ? {
                name: nodeId,
                error: errMsg,
                line: execNode.line,
                blockId: execNode.blockId,
                dependencies: execNode.rawDependencies,
              }
            : undefined;
        if (symEntry) symbols.set(nodeId, symEntry);

        const calcLine: EvaluatedCalcLine | undefined = stmt
          ? {
              statementId: stmt.id,
              line: stmt.line,
              kind: stmt.kind,
              target: stmt.target,
              renderMode,
              error: errMsg,
              dependencies: execNode.rawDependencies,
              raw: stmt.raw,
            }
          : undefined;
        if (calcLine && stmt) calcLineMap.set(stmt.id, calcLine);
        continue;
      }

      const evalRes = evaluateParsedExpression(execNode.parsedExpr, engine, evalScope);
      if (evalRes.ok) {
        const val = evalRes.value;
        let symEntry: EvaluatedSymbol | undefined;
        if (execNode.kind === 'symbol') {
          symEntry = {
            name: nodeId,
            value: val,
            line: execNode.line,
            blockId: execNode.blockId,
            dependencies: execNode.rawDependencies,
          };
          symbols.set(nodeId, symEntry);
          symbolValues.set(nodeId, val);
          evalScope[nodeId] = val.raw;
        }

        let calcLine: EvaluatedCalcLine | undefined;
        if (stmt) {
          const tex = formatCalcStatementToTex({
            target: stmt.target,
            rewrittenAst: execNode.parsedExpr.rewrittenAst,
            resultValue: val,
            symbols: symbolValues,
            renderMode,
            decimals: ast.decimals,
          });
          calcLine = {
            statementId: stmt.id,
            line: stmt.line,
            kind: stmt.kind,
            target: stmt.target,
            renderMode,
            symbolicTex: tex.symbolicTex,
            substitutedTex: tex.substitutedTex,
            resultTex: tex.resultTex,
            fullTex: tex.fullTex,
            value: val,
            dependencies: execNode.rawDependencies,
            raw: stmt.raw,
          };
          calcLineMap.set(stmt.id, calcLine);
        }

        nextCache.set(nodeId, {
          signature: execNode.signature,
          symbol: symEntry,
          calcLine,
          rawScopeValue: val.raw,
        });
      } else {
        diagnostics.push({
          id: `diag-eval-${nodeId}-${execNode.line}`,
          severity: 'error',
          message: evalRes.error,
          line: execNode.line,
          blockId: execNode.blockId,
          symbol: execNode.kind === 'symbol' ? nodeId : undefined,
        });

        if (execNode.kind === 'symbol') {
          symbols.set(nodeId, {
            name: nodeId,
            error: evalRes.error,
            line: execNode.line,
            blockId: execNode.blockId,
            dependencies: execNode.rawDependencies,
          });
        }
        if (stmt) {
          calcLineMap.set(stmt.id, {
            statementId: stmt.id,
            line: stmt.line,
            kind: stmt.kind,
            target: stmt.target,
            renderMode,
            error: evalRes.error,
            dependencies: execNode.rawDependencies,
            raw: stmt.raw,
          });
        }
      }
    }

    // Populate error entries for any cyclic nodes (which were not in evaluationOrder)
    for (const [cyclicId, cycleMsg] of cyclicNodeErrors) {
      const execNode = execNodes.get(cyclicId);
      if (!execNode) continue;
      if (execNode.kind === 'symbol') {
        symbols.set(cyclicId, {
          name: cyclicId,
          error: cycleMsg,
          line: execNode.line,
          blockId: execNode.blockId,
          dependencies: execNode.rawDependencies,
        });
      }
      if (execNode.calcStatement) {
        calcLineMap.set(execNode.calcStatement.id, {
          statementId: execNode.calcStatement.id,
          line: execNode.calcStatement.line,
          kind: execNode.calcStatement.kind,
          target: execNode.calcStatement.target,
          renderMode: execNode.calcStatement.renderMode,
          error: cycleMsg,
          dependencies: execNode.rawDependencies,
          raw: execNode.calcStatement.raw,
        });
      }
    }

    // 6. Assemble EvaluatedCalcBlock map preserving statement order
    const calcBlocks = new Map<string, EvaluatedCalcBlock>();
    for (const block of ast.blocks) {
      if (block.kind !== 'calc') continue;
      const calcBlock: CalcBlock = block;
      const lines: EvaluatedCalcLine[] = calcBlock.statements.map((stmt) => {
        const existing = calcLineMap.get(stmt.id);
        if (existing) return existing;
        return {
          statementId: stmt.id,
          line: stmt.line,
          kind: stmt.kind,
          target: stmt.target,
          renderMode: stmt.renderMode,
          dependencies: [],
          raw: stmt.raw,
        };
      });
      calcBlocks.set(calcBlock.id, {
        blockId: calcBlock.id,
        defaultRenderMode: calcBlock.defaultRenderMode,
        lines,
      });
    }

    // 7. Resolve `{{...}}` interpolations AND declarative controls in all ProseBlocks
    const interpolatedProse = new Map<string, string>();
    for (const block of ast.blocks) {
      if (block.kind !== 'prose') continue;
      if (block.inlineTokens.length === 0 && block.controls.length === 0) {
        interpolatedProse.set(block.id, block.raw);
        continue;
      }

      type SpanItem =
        | { kind: 'inline'; start: number; end: number; tok: InlineToken }
        | { kind: 'control'; start: number; end: number; ctrl: ControlToken };

      const spans: SpanItem[] = [
        ...block.inlineTokens.map((tok) => ({
          kind: 'inline' as const,
          start: tok.startOffset,
          end: tok.endOffset,
          tok,
        })),
        ...block.controls.map((ctrl) => ({
          kind: 'control' as const,
          start: ctrl.startOffset,
          end: ctrl.endOffset,
          ctrl,
        })),
      ].sort((a, b) => a.start - b.start);

      let out = '';
      let cursor = 0;

      for (const span of spans) {
        if (span.start < cursor) continue;
        out += block.raw.slice(cursor, span.start);
        cursor = span.end;

        if (span.kind === 'control') {
          const sym = symbols.get(span.ctrl.name);
          if (sym?.value) {
            out += `**${sym.value.formattedText}**`;
          } else {
            out += `**${span.ctrl.valueExpr}**`;
          }
          continue;
        }

        const tok = span.tok;
        if (tok.kind === 'define' && tok.target) {
          const sym = symbols.get(tok.target);
          if (sym?.value) {
            out += tok.inMathContext ? sym.value.formattedTex : `**${sym.value.formattedText}**`;
          } else {
            const msg = sym?.error ?? `Error al definir ${tok.target}`;
            out += tok.inMathContext
              ? `\\color{red}{\\text{[Error]}}`
              : `\`[Error: ${msg}]\``;
          }
          continue;
        }

        // Read / interpolate expression
        const fullExpr = tok.targetUnit
          ? `${tok.expression} -> ${tok.targetUnit}`
          : tok.expression;

        try {
          const parsed = parseExpression(fullExpr, engine, definedSymbols, tableNames);
          const evalRes = evaluateParsedExpression(parsed, engine, evalScope);
          if (evalRes.ok) {
            out += tok.inMathContext
              ? evalRes.value.formattedTex
              : `**${evalRes.value.formattedText}**`;
          } else {
            diagnostics.push({
              id: `diag-interp-${tok.id}`,
              severity: 'error',
              message: `Error en {{${tok.expression}}}: ${evalRes.error}`,
              line: tok.line,
              blockId: block.id,
            });
            out += tok.inMathContext
              ? `\\color{red}{\\text{[Error]}}`
              : `\`[Error: ${evalRes.error}]\``;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          diagnostics.push({
            id: `diag-interp-parse-${tok.id}`,
            severity: 'error',
            message: `Error de sintaxis en {{${tok.expression}}}: ${msg}`,
            line: tok.line,
            blockId: block.id,
          });
          out += tok.inMathContext
            ? `\\color{red}{\\text{[Error]}}`
            : `\`[Error: ${msg}]\``;
        }
      }

      out += block.raw.slice(cursor);
      interpolatedProse.set(block.id, out);
    }

    // 8. Interpolate parametric `mermaid` and `svg` blocks (`{{expr}}` and `{{expr | num}}`)
    const interpolatedCodeBlocks = new Map<string, string>();
    for (const block of ast.blocks) {
      if (block.kind !== 'code') continue;
      if (block.language !== 'mermaid' && block.language !== 'svg') continue;

      const resolved = block.content.replace(/\{\{([^}]+)\}\}/g, (fullMatch, innerRaw: string) => {
        const trimmed = innerRaw.trim();
        if (!trimmed) return fullMatch;

        // Optional `| num` filter extracts pure numeric value for SVG attributes
        let numericOnly = false;
        let exprPart = trimmed;
        const pipeIdx = trimmed.lastIndexOf('|');
        if (pipeIdx >= 0) {
          const filter = trimmed.slice(pipeIdx + 1).trim().toLowerCase();
          if (filter === 'num' || filter === 'number') {
            numericOnly = true;
            exprPart = trimmed.slice(0, pipeIdx).trim();
          }
        }

        try {
          const parsed = parseExpression(exprPart, engine, definedSymbols, tableNames);
          const evalRes = evaluateParsedExpression(parsed, engine, evalScope);
          if (evalRes.ok) {
            if (numericOnly && evalRes.value.numericValue !== null) {
              return String(Number(evalRes.value.numericValue.toFixed(4)));
            }
            return evalRes.value.formattedText;
          }
          diagnostics.push({
            id: `diag-code-interp-${block.id}-${exprPart}`,
            severity: 'error',
            message: `Error en diagrama ${block.language} ({{${exprPart}}}): ${evalRes.error}`,
            line: block.startLine + 1,
            blockId: block.id,
          });
          return fullMatch;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          diagnostics.push({
            id: `diag-code-parse-${block.id}-${exprPart}`,
            severity: 'error',
            message: `Error de sintaxis en diagrama ${block.language} ({{${exprPart}}}): ${msg}`,
            line: block.startLine + 1,
            blockId: block.id,
          });
          return fullMatch;
        }
      });

      interpolatedCodeBlocks.set(block.id, resolved);
    }

    this.prevCache = nextCache;
    this.prevEnvSignature = envSignature;

    return {
      ast,
      dag: dag.toSnapshot(),
      symbols,
      tables,
      tablesByName,
      calcBlocks,
      interpolatedProse,
      interpolatedCodeBlocks,
      diagnostics,
      recomputedNodeIds: Array.from(recomputedSet),
    };
  }
}

export function evaluateReactiveDocument(rawMarkdown: string): EvaluatedDocument {
  const session = new ReactiveSession();
  return session.evaluate(rawMarkdown);
}
