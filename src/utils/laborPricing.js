export const DEFAULT_LABOR_MULTIPLIER = 2;

export const parseLaborMultiplier = (value) => {
  if (!["number", "string"].includes(typeof value) || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

export const normalizeLaborMultiplier = (value) => parseLaborMultiplier(value) ?? DEFAULT_LABOR_MULTIPLIER;

export const suggestedLaborPriceCents = (internalCostCents, multiplier) => {
  if (!Number.isSafeInteger(internalCostCents) || internalCostCents < 0) return null;
  const price = Math.round(internalCostCents * normalizeLaborMultiplier(multiplier));
  return Number.isSafeInteger(price) ? price : null;
};
