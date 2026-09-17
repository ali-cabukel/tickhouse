import Decimal from "decimal.js";

export const price = (v: string) => new Decimal(v).toFixed(2);

export const volume = (n: number) =>
  new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);

/** Difference of a vs b in basis points. */
export const bps = (a: string, b: string) => {
  const base = new Decimal(b);
  return base.isZero() ? null : new Decimal(a).minus(base).div(base).times(10_000).toNumber();
};

export const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
