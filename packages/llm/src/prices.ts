/** USD per million tokens, effective from `from` (UTC) until the next entry. */
interface Price {
  from: string;
  inputPerMTok: number;
  /** Includes thinking tokens, which the provider bills as output. */
  outputPerMTok: number;
}

const GEMINI_3_6_FLASH: Price[] = [
  { from: "2026-01-01", inputPerMTok: 0.75, outputPerMTok: 3.75 },
  { from: "2027-01-01", inputPerMTok: 1.5, outputPerMTok: 7.5 },
];

/**
 * Paid-tier list prices from https://aistudio.google.com/docs/pricing, checked 2026-11-03. Calls
 * on the free tier cost nothing, but are logged at these prices so spend is known before a paid
 * key is used. A model missing here cannot be called: its cost could not be logged or budgeted.
 */
const PRICES: Record<string, Price[]> = {
  "gemini-3.6-flash": GEMINI_3_6_FLASH,
  // Not on the pricing page: requests for it are served by gemini-3.6-flash, so priced the same.
  "gemini-3.5-flash": GEMINI_3_6_FLASH,
  "gemini-3.5-flash-lite": [{ from: "2026-01-01", inputPerMTok: 0.3, outputPerMTok: 2.5 }],
};

export class UnknownModelPriceError extends Error {
  constructor(readonly modelId: string) {
    super(`No price for model ${modelId}: add it to packages/llm/src/prices.ts`);
    this.name = "UnknownModelPriceError";
  }
}

/** The price of `modelId` at `at`. Throws for a model with no price. */
export function priceOf(modelId: string, at: Date): Price {
  const price = PRICES[modelId]?.findLast((entry) => Date.parse(entry.from) <= at.getTime());
  if (!price) throw new UnknownModelPriceError(modelId);
  return price;
}

/** What a call cost, rounded to the micro-dollar like `llm_usage.cost_usd`. */
export function costUsd(
  modelId: string,
  tokens: { inputTokens: number; outputTokens: number },
  at: Date,
): number {
  const price = priceOf(modelId, at);
  const cost =
    (tokens.inputTokens * price.inputPerMTok + tokens.outputTokens * price.outputPerMTok) /
    1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
