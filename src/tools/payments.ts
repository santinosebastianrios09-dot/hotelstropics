// src/tools/payments.ts
import crypto from "crypto";

export type PaymentStatus = "approved" | "pending" | "failure";

export interface CreatePaymentInput {
  amount: number;
  currency: string;
  description: string;
  externalReference?: string;
  metadata?: Record<string, any>;
  successUrl?: string;
  failureUrl?: string;
  pendingUrl?: string;
}

export interface CreatePaymentResult {
  checkoutUrl: string;
  externalReference: string;
}

function env(name: string, def?: string) {
  const v = process.env[name];
  return (v === undefined || v === null || v === "") ? def : v;
}

export function paymentsProvider() {
  const PORT = env("PORT", "8080");
  const PUBLIC_WEB_ORIGIN = env("PUBLIC_WEB_ORIGIN");
  const PAYMENTS_PROVIDER = String(env("PAYMENTS_PROVIDER", "mock")).toLowerCase();

  if (PAYMENTS_PROVIDER !== "mock") {
    console.warn(`[payments] Provider '${PAYMENTS_PROVIDER}' no implementado; usando 'mock'.`);
  }

  return {
    async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
      const ref = input.externalReference || `ord_${crypto.randomBytes(6).toString("hex")}`;
      const origin = PUBLIC_WEB_ORIGIN || `http://localhost:${PORT}`;

      // Mock checkout local
      const checkoutUrl =
        `${origin}/payments/mock/checkout?` +
        `ref=${encodeURIComponent(ref)}` +
        `&amount=${encodeURIComponent(input.amount)}` +
        `&currency=${encodeURIComponent(input.currency)}` +
        `&desc=${encodeURIComponent(input.description)}`;

      return { checkoutUrl, externalReference: ref };
    },
  };
}
