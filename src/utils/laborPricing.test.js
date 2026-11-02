import { normalizeLaborMultiplier, parseLaborMultiplier, suggestedLaborPriceCents } from "./laborPricing";
import { normalizeCompanyWorkSettings } from "./companyWorkSettings";

test("the company multiplier defaults to two and accepts positive decimal changes", () => {
  [undefined, null, "", " ", 0, -1, Infinity, "bad", true].forEach((value) => {
    expect(parseLaborMultiplier(value)).toBeNull();
    expect(normalizeLaborMultiplier(value)).toBe(2);
  });
  expect(normalizeCompanyWorkSettings({}).laborMultiplier).toBe(2);
  expect(normalizeCompanyWorkSettings({ laborMultiplier: "2.5" }).laborMultiplier).toBe(2.5);
  expect(parseLaborMultiplier(0.75)).toBe(0.75);
});

test("price suggestions round to cents, support intentional zero, and reject invalid or overflowing costs", () => {
  expect(suggestedLaborPriceCents(4000, 2)).toBe(8000);
  expect(suggestedLaborPriceCents(1235, 2.5)).toBe(3088);
  expect(suggestedLaborPriceCents(0, 3)).toBe(0);
  [null, -1, 10.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].forEach((cost) => expect(suggestedLaborPriceCents(cost, 2)).toBeNull());
  expect(suggestedLaborPriceCents(4000, Number.MAX_VALUE)).toBeNull();
});
