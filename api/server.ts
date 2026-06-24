import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";
import { generateWithGemini, getConfiguredGeminiApiKeys } from "../lib/geminiProxy.js";
import pg from "pg";
const { Pool } = pg;

// ── PostgreSQL (Neon DB) ──────────────────────────────────────────────────────
const pgPool = (() => {
  try {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString || connectionString === "undefined") {
      console.warn("[PostgreSQL] DATABASE_URL não configurada.");
      return null;
    }
    return new Pool({
      connectionString,
      ssl: connectionString.includes("sslmode=require") || connectionString.includes("ssl=true")
        ? { rejectUnauthorized: false }
        : false,
    });
  } catch (e) {
    console.error("[PostgreSQL Init Error]", e);
    return null;
  }
})();

// Inicializa a tabela hub_links
async function initPostgresDB() {
  if (!pgPool) return;
  try {
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS hub_links (
        id INT PRIMARY KEY,
        links JSONB NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const res = await pgPool.query("SELECT id, links FROM hub_links WHERE id = 1;");
    const defaultLinks = [
      {
        id: "link-1",
        iconName: "FileText",
        title: "OCR de Perfis",
        subtitle: "Perfis de Alumínio",
        description: "Extração inteligente de dados e precificação automática de pedidos de perfis de alumínio. Suporta envio de arquivos PDF, imagens e Excel.",
        url: "ocr-perfis",
        isExternal: false,
        isActive: true,
        themeColor: "primary"
      },
      {
        id: "link-2",
        iconName: "Lock",
        title: "OCR de Componentes",
        subtitle: "Componentes e Acessórios",
        description: "Leitura automática e precificação inteligente para pedidos de acessórios, conexões e componentes de alumínio de forma integrada.\n\nocracess.vercel.app",
        url: "#",
        isExternal: false,
        isActive: true,
        themeColor: "slate"
      },
      {
        id: "link-3",
        iconName: "RefreshCw",
        title: "Portal de Devoluções",
        subtitle: "Portal de Devoluções",
        description: "Sistema para gerenciamento e conferência de devoluções de mercadorias e materiais operacionais. Acesso rápido e integrado.",
        url: "http://192.168.5.244:3008/",
        isExternal: true,
        isActive: true,
        themeColor: "blue"
      }
    ];

    if (res.rowCount === 0) {
      await pgPool.query("INSERT INTO hub_links (id, links) VALUES (1, $1::jsonb);", [JSON.stringify(defaultLinks)]);
      console.log("[PostgreSQL] Tabela hub_links inicializada com links padrões.");
    } else if (res.rows[0] && Array.isArray(res.rows[0].links) && res.rows[0].links.length === 0) {
      await pgPool.query("UPDATE hub_links SET links = $1::jsonb WHERE id = 1;", [JSON.stringify(defaultLinks)]);
      console.log("[PostgreSQL] Tabela hub_links atualizada de array vazio para links padrões.");
    }
  } catch (e) {
    console.error("[PostgreSQL Init DB Error]", e);
  }
}

initPostgresDB();

async function fetchHubLinksFromDB(): Promise<any[] | null> {
  if (!pgPool) return null;
  try {
    const res = await pgPool.query("SELECT links FROM hub_links WHERE id = 1;");
    if (res.rowCount && res.rows[0]) {
      return res.rows[0].links;
    }
    return null;
  } catch (e) {
    console.error("[PostgreSQL Read Links]", e);
    return null;
  }
}

async function saveHubLinksToDB(links: any[]): Promise<boolean> {
  if (!pgPool) return false;
  try {
    await pgPool.query(
      `INSERT INTO hub_links (id, links, updated_at) 
       VALUES (1, $1, CURRENT_TIMESTAMP) 
       ON CONFLICT (id) 
       DO UPDATE SET links = EXCLUDED.links, updated_at = CURRENT_TIMESTAMP;`,
      [JSON.stringify(links)]
    );
    return true;
  } catch (e) {
    console.error("[PostgreSQL Write Links]", e);
    return false;
  }
}

// ── Supabase ──────────────────────────────────────────────────────────────────
const supabase = (() => {
  try {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    if (!url || url === "undefined" || !key || key === "undefined") return null;
    return createClient(url, key);
  } catch (e) {
    console.error("[Supabase Init Error]", e);
    return null;
  }
})();

async function fetchFromDB(): Promise<any> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("knowledge_base")
      .select("catalog_data")
      .eq("id", 1)
      .single();
    if (error && error.code !== "PGRST116") throw error;
    return data ? data.catalog_data : null;
  } catch (e) {
    console.error("[Supabase Read]", e);
    return null;
  }
}

async function saveToDB(catalogData: any): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { error } = await supabase
      .from("knowledge_base")
      .upsert({ id: 1, catalog_data: catalogData });
    if (error) throw error;
    return true;
  } catch (e) {
    console.error("[Supabase Write]", e);
    return false;
  }
}

// ── Usage tracking ────────────────────────────────────────────────────────────
async function recordUsageInSupabase(username: string, ip: string, count: number): Promise<boolean> {
  if (!supabase) return false;
  const today = new Date().toISOString().slice(0, 10);
  try {
    const { data: rows, error: readErr } = await supabase
      .from("usage_tracking")
      .select("count")
      .eq("ip", ip)
      .eq("date", today)
      .limit(1);
    if (readErr) throw readErr;
    if (rows && rows.length > 0) {
      const { error } = await supabase
        .from("usage_tracking")
        .update({ 
          count: (Number(rows[0].count) || 0) + count,
          username: username
        })
        .eq("ip", ip)
        .eq("date", today);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from("usage_tracking")
        .insert({ username, ip, date: today, count });
      if (error) throw error;
    }
    return true;
  } catch (e) {
    console.error("[Usage] Supabase write failed:", e);
    return false;
  }
}

async function loadUsageFromSupabase(): Promise<any> {
  if (!supabase) return null;
  try {
    let rows: any[] = [];
    const pageSize = 1000;
    for (let page = 0; ; page++) {
      const from = page * pageSize;
      const { data, error } = await supabase
        .from("usage_tracking")
        .select("*")
        .order("date", { ascending: false })
        .range(from, from + pageSize - 1);
      if (error) throw error;
      rows = rows.concat(data || []);
      if (!data || data.length < pageSize) break;
    }
    const users: Record<string, string> = {};
    const daily: Record<string, Record<string, number>> = {};
    for (const row of rows) {
      const username = String(row.username || "SemNome");
      const ip = String(row.ip || "unknown");
      const date = String(row.date || "");
      const count = Number(row.count) || 0;
      users[ip] = username;
      if (!daily[date]) daily[date] = {};
      daily[date][username] = (daily[date][username] || 0) + count;
    }
    return { users, daily, entries: rows, source: "supabase" };
  } catch (e) {
    console.error("[Usage] Supabase read failed:", e);
    return null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function readStaticSubstitutionRules(): any[] {
  try {
    const rulesPath = path.join(process.cwd(), "src", "data", "substitutionRules.json");
    const rules = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
    return Array.isArray(rules) ? rules : [];
  } catch {
    return [];
  }
}

function normalizeSubstitutionRules(value: unknown): any[] {
  if (!Array.isArray(value)) throw new Error("substitutionRules deve ser uma lista.");
  return (value as any[])
    .map((rule, index) => ({
      row: Number.isFinite(Number(rule.row)) ? Number(rule.row) : index + 1,
      itemPedido: String(rule.itemPedido || "").trim(),
      conversaoAluminorte: String(rule.conversaoAluminorte || "").trim(),
      sugestao: String(rule.sugestao || "").trim(),
      comentarios: String(rule.comentarios || "").trim(),
    }))
    .filter((r) => r.itemPedido);
}

function normalizeCode(c: string): string {
  return String(c || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[‐-―]/g, "-")
    .replace(/[\s-]+/g, "");
}

function normalizeFirstName(value: unknown): string {
  const first = String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")[0]
    .replace(/[^\p{L}'-]/gu, "");
  return first ? first.slice(0, 30) : "SemNome";
}

// ── Rate limiting (per warm container) ───────────────────────────────────────
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_MAX = Number(process.env.GEMINI_PROXY_RATE_LIMIT_MAX || 300);
const RATE_LIMIT_WINDOW_MS = 60_000;
const unavailableModels = new Set<string>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_MAX;
}

// ── Express app ───────────────────────────────────────────────────────────────
const app = express();

// Restore original URL path on Vercel rewrites so Express routing matches client paths correctly
app.use((req, res, next) => {
  try {
    const originalUrl = req.headers["x-forwarded-uri"] || req.headers["x-matched-path"];
    if (originalUrl) {
      req.url = String(originalUrl);
    }
    next();
  } catch (error: any) {
    console.error("Middleware rewrite crash:", error);
    res.status(500).json({
      error: "Erro no middleware de roteamento.",
      message: error?.message || String(error),
      stack: error?.stack || ""
    });
  }
});

app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"] }));
app.use(express.json({ limit: "10mb" }));

app.get("/api/health", (_req, res) => {
  try {
    res.json({ status: "ok", runtime: "vercel-express" });
  } catch (error: any) {
    console.error("[/api/health] Crash:", error);
    res.status(500).json({
      error: error?.message || "Erro no healthcheck.",
      stack: error?.stack || String(error),
    });
  }
});

// Gemini OCR
app.all("/api/gemini", async (req, res) => {
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") return res.status(200).end();

    const apiKeys = getConfiguredGeminiApiKeys();

    if (req.method === "GET") {
      return res.status(200).json({
        ok: true,
        provider: "gemini",
        hasGeminiKey: apiKeys.length > 0,
        geminiKeyCount: apiKeys.length,
      });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const clientIp = String(req.headers["x-forwarded-for"] || "unknown").split(",")[0].trim();
    if (isRateLimited(clientIp)) {
      return res.status(429).json({ error: "Limite de requisições atingido. Aguarde um minuto." });
    }

    if (!apiKeys.length) {
      return res.status(503).json({
        error: "Nenhuma chave Gemini configurada. Configure GEMINI_API_KEY na Vercel e faça redeploy.",
      });
    }

    const { fileBase64, mimeType, prompt, textOnly, responseMode } = req.body;
    if (!prompt) return res.status(400).json({ error: "prompt é obrigatório." });

    const result = await generateWithGemini({
      apiKeys,
      payload: { fileBase64, mimeType, prompt, textOnly, responseMode },
      unavailableModels,
    });

    if (typeof result.body.retryAfterSeconds === "number") {
      res.setHeader("Retry-After", String(result.body.retryAfterSeconds));
    }
    return res.status(result.status).json(result.body);
  } catch (error: any) {
    console.error("[/api/gemini] Crash:", error);
    return res.status(500).json({
      error: error?.message || "Erro interno do servidor.",
      stack: error?.stack || String(error),
    });
  }
});

const upload = multer({ storage: multer.memoryStorage() });

// Webhook OCR (CSV output)
app.post("/api/webhook", upload.single("file"), async (req, res) => {
  try {
    const apiKeys = getConfiguredGeminiApiKeys();

    if (!apiKeys.length) {
      return res.status(503).json({
        error: "Nenhuma chave Gemini configurada.",
      });
    }

    let prompt = req.body.prompt;
    let fileBase64 = req.body.fileBase64;
    let mimeType = req.body.mimeType;

    if (req.file) {
      fileBase64 = req.file.buffer.toString("base64");
      mimeType = req.file.mimetype;
    }

    if (!prompt) {
      return res.status(400).json({ error: "prompt é obrigatório." });
    }

    const result = await generateWithGemini({
      apiKeys,
      payload: { fileBase64, mimeType, prompt, textOnly: !fileBase64, responseMode: "ocr" },
      unavailableModels,
    });

    if (result.status !== 200) {
      return res.status(result.status).json(result.body);
    }

    const items = Array.isArray(result.body.items) ? result.body.items : [];
    
    // Generate CSV
    const headers = ["produto", "produtoOriginal", "acabamento", "qtde", "comprimento", "identificado"];
    const csvLines = [headers.join(",")];
    
    for (const item of items) {
      const row = headers.map(h => {
        let val = (item as any)[h];
        if (val === null || val === undefined) val = "";
        val = String(val).replace(/"/g, '""');
        return `"${val}"`;
      });
      csvLines.push(row.join(","));
    }
    
    const csvContent = "\uFEFF" + csvLines.join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="resultado_ocr.csv"');
    return res.status(200).send(csvContent);
  } catch (error: any) {
    console.error("[/api/webhook] Crash:", error);
    return res.status(500).json({
      error: error?.message || "Erro interno do servidor.",
      stack: error?.stack || String(error),
    });
  }
});

// ── Local Catalog Storage Fallbacks ───────────────────────────────────────────
function getLocalCatalogPath(): string {
  const catalogPath = path.join(process.cwd(), "catalog_memory.json");
  const legacyPath = path.join(process.cwd(), "src", "data", "catalog.json");
  return fs.existsSync(catalogPath) ? catalogPath : legacyPath;
}

function readLocalCatalog(): any {
  try {
    const finalPath = getLocalCatalogPath();
    if (fs.existsSync(finalPath)) {
      return JSON.parse(fs.readFileSync(finalPath, "utf8"));
    }
  } catch (e) {
    console.error("[Local Read Error]", e);
  }
  return null;
}

function writeLocalCatalog(data: any): boolean {
  try {
    const catalogPath = path.join(process.cwd(), "catalog_memory.json");
    fs.writeFileSync(catalogPath, JSON.stringify(data, null, 2));
    return true;
  } catch (e) {
    console.warn("[Local Write Fallback] Could not write catalog_memory.json, keeping in memory.");
    return false;
  }
}

// Hub Links - GET
app.get("/api/hub-links", async (_req, res) => {
  try {
    const links = await fetchHubLinksFromDB();
    if (links) {
      return res.json(links);
    }
    return res.json([]);
  } catch (err: any) {
    console.error("[/api/hub-links] GET Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Hub Links - POST
app.post("/api/hub-links", async (req, res) => {
  try {
    const { links } = req.body;
    if (!Array.isArray(links)) {
      return res.status(400).json({ error: "Dados inválidos: 'links' deve ser uma lista." });
    }
    const success = await saveHubLinksToDB(links);
    res.json({ success });
  } catch (err: any) {
    console.error("[/api/hub-links] POST Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Catalog - GET
app.get("/api/catalog", async (_req, res) => {
  try {
    const staticSubstitutionRules = readStaticSubstitutionRules();
    const dbData = await fetchFromDB();
    if (dbData) {
      return res.json({
        products: dbData.products || [],
        history: dbData.history || [],
        aliases: dbData.aliases || {},
        blacklist: dbData.blacklist || [],
        tubeDimensions: Array.isArray(dbData.tubeDimensions) ? dbData.tubeDimensions : [],
        substitutionRules: Array.isArray(dbData.substitutionRules)
          ? dbData.substitutionRules
          : staticSubstitutionRules,
        source: "supabase",
      });
    }

    // Fallback to local file
    const localData = readLocalCatalog();
    if (localData) {
      return res.json({
        products: localData.products || [],
        history: localData.history || [],
        aliases: localData.aliases || {},
        blacklist: localData.blacklist || [],
        tubeDimensions: Array.isArray(localData.tubeDimensions) ? localData.tubeDimensions : [],
        substitutionRules: Array.isArray(localData.substitutionRules)
          ? localData.substitutionRules
          : staticSubstitutionRules,
        source: "local-fs",
      });
    }

    return res.json({
      products: [],
      history: [],
      aliases: {},
      blacklist: [],
      tubeDimensions: [],
      substitutionRules: staticSubstitutionRules,
      source: "empty",
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Save catalog - POST
app.post("/api/save-catalog", async (req, res) => {
  try {
    const { products, historyItem, aliasItem, blacklist } = req.body;

    if (products !== undefined && !Array.isArray(products)) {
      return res.status(400).json({ error: "Dados inválidos: 'products' deve ser uma lista." });
    }

    let currentData = await fetchFromDB();
    if (!currentData) {
      currentData = readLocalCatalog() || {
        products: [],
        history: [],
        aliases: {},
        blacklist: [],
      };
    }

    const currentProducts: string[] = Array.isArray(currentData.products) ? currentData.products : [];
    const currentHistory: any[] = Array.isArray(currentData.history) ? currentData.history : [];
    const currentAliases: Record<string, string> = currentData.aliases || {};
    const currentBlacklist: string[] = Array.isArray(currentData.blacklist) ? currentData.blacklist : [];

    const newProducts = products
      ? Array.from(new Set([...currentProducts, ...products]))
      : currentProducts;
    const newBlacklist = blacklist
      ? Array.from(new Set([...currentBlacklist, ...blacklist]))
      : currentBlacklist;
    const newHistory = [...currentHistory];

    if (historyItem) {
      newHistory.unshift({
        ...historyItem,
        id: Math.random().toString(36).substring(2, 9),
        date: new Date().toISOString(),
      });
    }

    if (aliasItem?.badCode && aliasItem?.goodCode) {
      currentAliases[aliasItem.badCode] = aliasItem.goodCode;
    }

    const normalizedBlacklist = new Set(newBlacklist.map(normalizeCode).filter(Boolean));
    const cleanProducts = newProducts.filter((p) => !normalizedBlacklist.has(normalizeCode(p)));
    const cleanAliases: Record<string, string> = {};
    for (const [key, value] of Object.entries(currentAliases)) {
      if (
        !normalizedBlacklist.has(normalizeCode(key)) &&
        !normalizedBlacklist.has(normalizeCode(String(value)))
      ) {
        cleanAliases[key] = String(value);
      }
    }

    const updatedData = {
      ...currentData,
      products: cleanProducts,
      history: newHistory,
      aliases: cleanAliases,
      blacklist: newBlacklist,
    };

    const dbSaved = await saveToDB(updatedData);
    const localSaved = writeLocalCatalog(updatedData);

    res.json({
      success: true,
      productsCount: cleanProducts.length,
      persisted: dbSaved ? "supabase" : (localSaved ? "local-fs" : "ephemeral"),
    });
  } catch (err: any) {
    console.error("[/api/save-catalog] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Substitution rules - GET
app.get("/api/substitutions", async (_req, res) => {
  try {
    const staticRules = readStaticSubstitutionRules();
    const dbData = await fetchFromDB();
    if (dbData) {
      return res.json({
        substitutionRules: Array.isArray(dbData.substitutionRules)
          ? dbData.substitutionRules
          : staticRules,
        source: "supabase",
        savedInDatabase: Array.isArray(dbData.substitutionRules),
      });
    }

    const localData = readLocalCatalog();
    if (localData) {
      return res.json({
        substitutionRules: Array.isArray(localData.substitutionRules)
          ? localData.substitutionRules
          : staticRules,
        source: "local-fs",
        savedInDatabase: Array.isArray(localData.substitutionRules),
      });
    }

    return res.json({ substitutionRules: staticRules, source: "static", savedInDatabase: false });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Substitution rules - POST
app.post("/api/substitutions", async (req, res) => {
  try {
    const substitutionRules = normalizeSubstitutionRules(req.body?.substitutionRules);
    let currentData = await fetchFromDB();
    if (!currentData) {
      currentData = readLocalCatalog() || {
        products: [],
        history: [],
        aliases: {},
        blacklist: [],
      };
    }

    const updatedData = {
      ...currentData,
      substitutionRules,
      substitutionRulesUpdatedAt: new Date().toISOString(),
    };

    const dbSaved = await saveToDB(updatedData);
    const localSaved = writeLocalCatalog(updatedData);

    res.json({
      success: true,
      count: substitutionRules.length,
      persisted: dbSaved ? "supabase" : (localSaved ? "local-fs" : "ephemeral"),
    });
  } catch (err: any) {
    console.error("[/api/substitutions] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Usage tracking - POST
app.post("/api/track", async (req, res) => {
  try {
    const ip = String(req.headers["x-forwarded-for"] || "unknown").split(",")[0].trim();
    const count = Math.max(0, Number(req.body?.count) || 0);
    const providedUsername = String(req.body?.username || "").trim();
    if (!providedUsername) return res.json({ needsName: true, known: false });
    const username = normalizeFirstName(providedUsername);
    const tracked = await recordUsageInSupabase(username, ip, count);
    res.json({ username, known: true, tracked });
  } catch (error: any) {
    console.error("[/api/track] Crash:", error);
    return res.status(500).json({
      error: error?.message || "Erro interno do servidor no tracking.",
      stack: error?.stack || String(error),
    });
  }
});

// Usage dashboard - GET
app.get("/api/users", async (_req, res) => {
  try {
    const data = await loadUsageFromSupabase();
    res.json(data || { users: {}, daily: {}, entries: [], source: "empty" });
  } catch (error: any) {
    console.error("[/api/users] Crash:", error);
    return res.status(500).json({
      error: error?.message || "Erro interno do servidor ao carregar usuários.",
      stack: error?.stack || String(error),
    });
  }
});

// ── Local Dev Server Startup (Vite & Express listener) ───────────────────────
if (!process.env.VERCEL) {
  const PORT = Number(process.env.PORT || 3008);
  const startLocalServer = async () => {
    try {
      const viteModuleName = "vite";
      const { createServer: createViteServer } = await import(viteModuleName);
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);

      app.listen(PORT, "0.0.0.0", () => {
        console.log(`[Server] Local server running on http://localhost:${PORT}`);
      });
    } catch (e) {
      console.error("[Server] Failed to initialize local dev server with Vite:", e);
      // Fallback: Plain Express server
      app.listen(PORT, "0.0.0.0", () => {
        console.log(`[Server] Local server running on http://localhost:${PORT} (Express fallback)`);
      });
    }
  };
  startLocalServer();
}

export default app;
