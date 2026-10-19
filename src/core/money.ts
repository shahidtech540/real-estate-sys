import Decimal from "decimal.js";

/**
 * Money — `ARCHITECTURE.md` §12.6, `AGENTS.md` §5.8.
 *
 * The only place that adds, subtracts, divides, rounds or formats money.
 * `numeric(12,2)` in PostgreSQL, a decimal string on the wire (`API.md` §1.8),
 * never a JavaScript `number`.
 */
Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP });

export type DecimalInput = string | number | Decimal;

export function toDecimal(value: DecimalInput): Decimal {
  return value instanceof Decimal ? value : new Decimal(value);
}

/** Half-up to 2 decimals at the point a value is created (`ARCHITECTURE.md` §12.6). */
export function round2(value: DecimalInput): Decimal {
  return toDecimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Wire form: exactly two decimals, no separators — `API.md` §1.9 `DecimalString`. */
export function toWireAmount(value: DecimalInput): string {
  return round2(value).toFixed(2);
}

/** Display form: `1,250,000.00` with Latin digits (`DESIGN.md` §4.2). */
export function formatAmount(value: DecimalInput): string {
  const fixed = toWireAmount(value);
  const [whole, fraction] = fixed.split(".");
  const sign = whole.startsWith("-") ? "-" : "";
  const digits = sign ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${grouped}.${fraction}`;
}

export function addAmounts(...values: DecimalInput[]): Decimal {
  return values.reduce<Decimal>(
    (sum, value) => sum.plus(toDecimal(value)),
    new Decimal(0),
  );
}

export function subtractAmounts(
  left: DecimalInput,
  right: DecimalInput,
): Decimal {
  return toDecimal(left).minus(toDecimal(right));
}

export function compareAmounts(
  left: DecimalInput,
  right: DecimalInput,
): -1 | 0 | 1 {
  return toDecimal(left).comparedTo(toDecimal(right)) as -1 | 0 | 1;
}

export function isPositive(value: DecimalInput): boolean {
  return toDecimal(value).greaterThan(0);
}
