import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { generateWithGemini, getConfiguredGeminiApiKeys } from "../lib/geminiProxy";

dotenv.config({ quiet: true });

interface ExpectedItem {
  produto: string | string[];
  qtde?: number;
  acabamento?: string;
  comprimento?: number;
}

interface Fixture {
  name: string;
  file: string;
  mime?: string;
  expect: {
    count?: number;
    items?: ExpectedItem[];
  };
}

interface OCRItemLike {
  produto: string;
  produtoOriginal?: string;
  acabamento?: string;
  qtde: number;
  comprimento: number;
}

const unavailableModels = new Set<string>();
const originalFetch = globalThis.fetch;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function expandEnv(value: string): string {
  return value
    .replace(/%([^%]+)%/g, (_, key) => process.env[key] || "")
    .replace(/\$\{([^}]+)\}/g, (_, key) => process.env[key] || "");
}

function normalizeCode(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function normalizeFinish(value: string): string {
  return normalizeCode(value);
}

function inferMime(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  return "image/jpeg";
}

function readLocalCatalog(): Record<string, unknown> {
  const memoryPath = path.join(process.cwd(), "catalog_memory.json");
  const staticPath = path.join(process.cwd(), "src", "data", "catalog.json");
  const catalogPath = fs.existsSync(memoryPath) ? memoryPath : staticPath;
  return JSON.parse(fs.readFileSync(catalogPath, "utf8"));
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input.toString();

  if (url.startsWith("/api/gemini")) {
    const payload = JSON.parse(String(init?.body || "{}"));
    const result = await generateWithGemini({
      apiKeys: getConfiguredGeminiApiKeys(),
      payload,
      unavailableModels,
    });

    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (url.startsWith("/api/catalog")) {
    return new Response(JSON.stringify(readLocalCatalog()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  return originalFetch(input as any, init);
};

function getFixturePath(): string {
  const argIndex = process.argv.findIndex(arg => arg === "--fixtures");
  if (argIndex >= 0 && process.argv[argIndex + 1]) {
    return path.resolve(process.argv[argIndex + 1]);
  }
  return path.join(process.cwd(), "scripts", "ocr-user-fixtures.json");
}

function getOnlyFilter(): string | null {
  const argIndex = process.argv.findIndex(arg => arg === "--only");
  return argIndex >= 0 && process.argv[argIndex + 1] ? process.argv[argIndex + 1].toLowerCase() : null;
}

function getMaxAttempts(): number {
  const argIndex = process.argv.findIndex(arg => arg === "--max-attempts");
  const parsed = argIndex >= 0 && process.argv[argIndex + 1] ? Number(process.argv[argIndex + 1]) : 5;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 5;
}

function matchesExpectedItem(actual: OCRItemLike, expected: ExpectedItem): boolean {
  const expectedCodes = (Array.isArray(expected.produto) ? expected.produto : [expected.produto]).map(normalizeCode);
  const actualCodes = [actual.produto, actual.produtoOriginal || ""].map(normalizeCode).filter(Boolean);
  const productMatches = expectedCodes.some(expectedCode => actualCodes.includes(expectedCode));
  if (!productMatches) return false;

  if (expected.qtde !== undefined && Number(actual.qtde) !== Number(expected.qtde)) return false;
  if (expected.comprimento !== undefined && Number(actual.comprimento) !== Number(expected.comprimento)) return false;
  if (expected.acabamento !== undefined && normalizeFinish(actual.acabamento || "") !== normalizeFinish(expected.acabamento)) return false;

  return true;
}

function describeExpectedItem(expected: ExpectedItem): string {
  const product = Array.isArray(expected.produto) ? expected.produto.join("|") : expected.produto;
  return [product, expected.qtde !== undefined ? `q=${expected.qtde}` : ""].filter(Boolean).join(" ");
}

async function performWithRetry(filePath: string, mime: string, maxAttempts: number): Promise<{ items: OCRItemLike[] }> {
  const { performOCR } = await import("../src/services/ocrService");
  const fileBase64 = fs.readFileSync(filePath).toString("base64");

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await performOCR(fileBase64, mime, path.basename(filePath));
    } catch (error: any) {
      const retryAfterMs = Number(error?.retryAfterMs || 0);
      if (!retryAfterMs || attempt === maxAttempts) throw error;
      const waitMs = retryAfterMs + 500;
      console.log(`  retry ${attempt}/${maxAttempts} after ${Math.ceil(waitMs / 1000)}s`);
      await sleep(waitMs);
    }
  }

  throw new Error("OCR retry loop exhausted.");
}

async function runFixture(fixture: Fixture, maxAttempts: number): Promise<boolean> {
  const filePath = path.resolve(expandEnv(fixture.file));
  const mime = fixture.mime || inferMime(filePath);

  console.log(`\n[check] ${fixture.name}`);
  if (!fs.existsSync(filePath)) {
    console.log(`  FAIL missing file: ${filePath}`);
    return false;
  }

  try {
    const response = await performWithRetry(filePath, mime, maxAttempts);
    const items = response.items || [];
    const failures: string[] = [];

    if (fixture.expect.count !== undefined && items.length !== fixture.expect.count) {
      failures.push(`expected count ${fixture.expect.count}, got ${items.length}`);
    }

    for (const expected of fixture.expect.items || []) {
      if (!items.some(item => matchesExpectedItem(item, expected))) {
        failures.push(`missing ${describeExpectedItem(expected)}`);
      }
    }

    if (failures.length) {
      console.log("  FAIL");
      failures.forEach(failure => console.log(`  - ${failure}`));
      console.log("  actual:", items.map(item => `${item.produto}:${item.qtde}`).join(", "));
      return false;
    }

    console.log(`  PASS ${items.length} item(s): ${items.map(item => `${item.produto}:${item.qtde}`).join(", ")}`);
    return true;
  } catch (error: any) {
    console.log(`  FAIL ${error?.message || error}`);
    return false;
  }
}

async function main(): Promise<void> {
  const fixturePath = getFixturePath();
  const onlyFilter = getOnlyFilter();
  const maxAttempts = getMaxAttempts();
  const allFixtures = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as Fixture[];
  const fixtures = onlyFilter
    ? allFixtures.filter(fixture => fixture.name.toLowerCase().includes(onlyFilter))
    : allFixtures;
  let passed = 0;

  if (!fixtures.length) {
    console.error(`[error] no fixtures matched ${onlyFilter || fixturePath}`);
    process.exitCode = 1;
    return;
  }

  for (const fixture of fixtures) {
    if (await runFixture(fixture, maxAttempts)) passed++;
  }

  const failed = fixtures.length - passed;
  console.log(`\n[result] ${passed}/${fixtures.length} passed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
