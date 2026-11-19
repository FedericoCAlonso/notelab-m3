import { describe, it, expect } from 'vitest';
import { createUnitEngine } from '../engine/math/unitRegistry';
import {
  evaluateParsedExpression,
  parseExpression,
} from '../engine/math/expressionEvaluator';
import { formatCalcStatementToTex } from '../engine/math/latexFormatter';
import { EvaluatedValue } from '../engine/parser/types';

describe('Reactive Math & Units Engine', () => {
  it('evaluates SI physics quantities and explicit unit conversions', () => {
    const engine = createUnitEngine();
    const parsed = parseExpression('220 V * 4.5 A -> W', engine);
    const res = evaluateParsedExpression(parsed, engine, {});
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.formattedText).toBe('990 W');
      expect(res.value.formattedTex).toBe('990\\,\\text{W}');
    }

    const parsedKw = parseExpression('220 V * 4.5 A -> kW', engine);
    const resKw = evaluateParsedExpression(parsedKw, engine, {});
    expect(resKw.ok).toBe(true);
    if (resKw.ok) {
      expect(resKw.value.formattedText).toBe('0.99 kW');
    }
  });

  it('prevents variable/unit name collisions like V = 220 V and m = 10 kg', () => {
    const engine = createUnitEngine();
    const defined = new Set(['V', 'm', 't']);

    const pV = parseExpression('220 V', engine, defined);
    expect(pV.dependencies).toEqual([]); // Must NOT depend on V!
    const rV = evaluateParsedExpression(pV, engine, { V: engine.math.unit('999 V') });
    expect(rV.ok).toBe(true);
    if (rV.ok) {
      expect(rV.value.formattedText).toBe('220 V');
    }

    // F = m * 9.81 m/s^2 with m = 10 kg in scope
    const pF = parseExpression('m * 9.81 m/s^2 -> N', engine, defined);
    expect(pF.dependencies).toEqual(['m']);
    const rF = evaluateParsedExpression(pF, engine, { m: engine.math.unit('10 kg') });
    expect(rF.ok).toBe(true);
    if (rF.ok) {
      expect(rF.value.formattedText).toBe('98.1 N');
    }

    // v = 100 m / t with t = 10 s in scope
    const pv = parseExpression('100 m / t -> m/s', engine, defined);
    expect(pv.dependencies).toEqual(['t']);
    const rv = evaluateParsedExpression(pv, engine, { t: engine.math.unit('10 s') });
    expect(rv.ok).toBe(true);
    if (rv.ok) {
      expect(rv.value.formattedText).toBe('10 m / s');
    }
  });

  it('detects dimensional incompatibility with clear Spanish error messages', () => {
    const engine = createUnitEngine();
    const parsed = parseExpression('220 V + 4.5 A', engine);
    const res = evaluateParsedExpression(parsed, engine, {});
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.toLowerCase()).toContain('incompatibilidad de unidades');
    }
  });

  it('supports default currencies/units and custom @unidad declarations', () => {
    const engine = createUnitEngine();
    const regArs = engine.registerCustomUnit({
      name: 'ARS',
      definition: '1/1200 USD',
      line: 1,
    });
    expect(regArs.ok).toBe(true);

    const regRollo = engine.registerCustomUnit({
      name: 'rollo',
      definition: '100 m',
      line: 2,
    });
    expect(regRollo.ok).toBe(true);

    const r1 = evaluateParsedExpression(parseExpression('2400 ARS -> USD', engine), engine, {});
    expect(r1.ok).toBe(true);
    if (r1.ok) {
      expect(r1.value.formattedText).toBe('2.00 USD');
    }

    const r2 = evaluateParsedExpression(parseExpression('3 rollo -> m', engine), engine, {});
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.value.formattedText).toBe('300 m');
    }

    const r3 = evaluateParsedExpression(parseExpression('100 m * 1.2 USD/m', engine), engine, {});
    expect(r3.ok).toBe(true);
    if (r3.ok) {
      expect(r3.value.formattedText).toBe('120.00 USD');
    }
  });

  it('formats AST into SMath-style LaTeX for full, formula, and result modes', () => {
    const engine = createUnitEngine();
    const defined = new Set(['V', 'I']);
    const valV = evaluateParsedExpression(parseExpression('220 V', engine), engine, {});
    const valI = evaluateParsedExpression(parseExpression('4.5 A', engine), engine, {});
    expect(valV.ok && valI.ok).toBe(true);
    if (!valV.ok || !valI.ok) return;

    const symbols = new Map<string, EvaluatedValue>([
      ['V', valV.value],
      ['I', valI.value],
    ]);

    const parsedP = parseExpression('V * I -> W', engine, defined);
    const valP = evaluateParsedExpression(parsedP, engine, {
      V: valV.value.raw,
      I: valI.value.raw,
    });
    expect(valP.ok).toBe(true);
    if (!valP.ok) return;

    const full = formatCalcStatementToTex({
      target: 'P_total',
      rewrittenAst: parsedP.rewrittenAst,
      resultValue: valP.value,
      symbols,
      renderMode: 'full',
      decimals: null,
    });
    expect(full.fullTex).toBe(
      'P_{\\text{total}} = V \\cdot I = 220\\,\\text{V} \\cdot 4.5\\,\\text{A} = 990\\,\\text{W}'
    );

    const formula = formatCalcStatementToTex({
      target: 'P_total',
      rewrittenAst: parsedP.rewrittenAst,
      resultValue: valP.value,
      symbols,
      renderMode: 'formula',
      decimals: null,
    });
    expect(formula.fullTex).toBe('P_{\\text{total}} = V \\cdot I = 990\\,\\text{W}');

    const resultOnly = formatCalcStatementToTex({
      target: 'P_total',
      rewrittenAst: parsedP.rewrittenAst,
      resultValue: valP.value,
      symbols,
      renderMode: 'result',
      decimals: null,
    });
    expect(resultOnly.fullTex).toBe('P_{\\text{total}} = 990\\,\\text{W}');
  });
});
