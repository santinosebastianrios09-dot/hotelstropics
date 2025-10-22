// src/ai/hybrid.ts (ESM-ready)
// -------------------------------------------------------------
// Respuesta híbrida: FAQs primero, luego LLM (si hay OPENAI_API_KEY)
// Carga faqs desde src/data/faqs.json o faqs.json1 (NDJSON).
// Funciona con ESM: define __dirname usando import.meta.url.
// -------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type FaqItem = { q: string; a: string; keywords?: string[] };
type HybridOptions = { faqThreshold?: number; maxFaqs?: number };

// ---------- utils ----------
function normalize(text: string): string {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function tokenize(t: string) { return normalize(t).split(" ").filter(Boolean); }
function unique<T>(arr: T[]) { return Array.from(new Set(arr)); }
function jaccard(a: string[], b: string[]) {
  const A = new Set(a), B = new Set(b);
  const inter = [...A].filter(x => B.has(x)).length;
  const union = new Set([...A, ...B]).size;
  return union ? inter / union : 0;
}
function containsAll(h: string[], needles: string[]) {
  const H = new Set(h); return needles.length ? needles.every(n => H.has(n)) : false;
}

// ---------- load faqs ----------
function safeRead(p: string) { try { return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null; } catch { return null; } }
function tryLoadFaqsFromJson(p: string): FaqItem[] | null {
  const raw = safeRead(p); if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return null;
    return data.map((x: any) => ({
      q: String(x?.q ?? ""), a: String(x?.a ?? ""),
      keywords: Array.isArray(x?.keywords) ? x.keywords.map((k: any) => String(k)) : undefined
    })).filter(x => x.q && x.a);
  } catch { return null; }
}
function tryLoadFaqsFromJsonLines(p: string): FaqItem[] | null {
  const raw = safeRead(p); if (!raw) return null;
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out: FaqItem[] = [];
  for (const line of lines) {
    try {
      const x = JSON.parse(line);
      const item: FaqItem = {
        q: String(x?.q ?? ""), a: String(x?.a ?? ""),
        keywords: Array.isArray(x?.keywords) ? x.keywords.map((k: any) => String(k)) : undefined
      };
      if (item.q && item.a) out.push(item);
    } catch {}
  }
  return out.length ? out : null;
}

function loadFaqs(): FaqItem[] {
  // __dirname -> .../src/ai ; subimos a .../src
  const srcDir = path.resolve(__dirname, "..");
  const candidates = [
    path.join(srcDir, "data", "faqs.json"),
    path.join(srcDir, "data", "faqs.json1"),
  ];

  for (const p of candidates) {
    if (p.endsWith(".json")) {
      const a = tryLoadFaqsFromJson(p); if (a?.length) return a;
    } else {
      const a = tryLoadFaqsFromJsonLines(p); if (a?.length) return a;
    }
  }

  // fallback mínimo
  return [
    { q: "¿Cómo consultar disponibilidad?", a: "Usá /disponibilidad y decime fecha y destino.", keywords: ["disponibilidad","fecha","destino"] },
    { q: "¿Cómo hago una reserva?", a: "Con /reserva te pido nombre, fechas, destino y tipo (hotel/tour).", keywords: ["reserva","reservar","booking"] },
    { q: "¿Cómo ver el estado de mi reserva?", a: "Con /estado + ID te muestro el estado. También podés usar /resumen.", keywords: ["estado","id","resumen"] },
  ];
}

const FAQS_CACHE: { items: FaqItem[] | null } = { items: null };
function getFaqs() { return (FAQS_CACHE.items ??= loadFaqs()); }

// ---------- faq match ----------
function scoreFaq(user: string, faq: FaqItem): number {
  const u = unique(tokenize(user));
  const q = unique(tokenize(faq.q));
  const a = unique(tokenize(faq.a));
  const k = unique((faq.keywords ?? []).map(normalize));
  const s = Math.min(1, jaccard(u, q) * 0.8 + jaccard(u, a) * 0.2 + (k.length && containsAll(u, k) ? 0.3 : 0));
  return s;
}
function findBestFaq(user: string, opts?: HybridOptions) {
  const items = getFaqs();
  const max = Math.max(1, opts?.maxFaqs ?? 200);
  let best: { item: FaqItem; score: number } | null = null;
  for (let i = 0; i < Math.min(items.length, max); i++) {
    const item = items[i]; const score = scoreFaq(user, item);
    if (!best || score > best.score) best = { item, score };
  }
  const th = opts?.faqThreshold ?? 0.35;
  return best && best.score >= th ? best : null;
}

// ---------- openai (opcional) ----------
async function askOpenAI(userText: string, systemPrompt?: string): Promise<string> {
  let OpenAICtor: any;
  try { OpenAICtor = (await import("openai")).default as any; } catch { return ""; }
  const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY;
  if (!apiKey) return "";
  const client = new OpenAICtor({ apiKey });
  const sys = systemPrompt ?? "Eres un asistente de reservas de tours y hoteles. Responde breve y útil.";
  try {
    const res = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: `Usuario: ${userText}` }
      ]
    });
    return res?.choices?.[0]?.message?.content?.toString()?.trim() || "";
  } catch { return ""; }
}

// ---------- API ----------
export async function hybridReply(text: string, opts?: HybridOptions): Promise<string> {
  const q = (text || "").trim();
  if (!q) return "¿Podrías repetir la consulta?";
  const fromFaq = findBestFaq(q, opts);
  if (fromFaq) return fromFaq.item.a;
  const fromLLM = await askOpenAI(q);
  if (fromLLM) return fromLLM;
  return "Puedo ayudarte con disponibilidad (/disponibilidad), crear una reserva (/reserva) o ver su estado (/estado). Decime fecha y destino, o probá con /ayuda.";
}

export default hybridReply;
