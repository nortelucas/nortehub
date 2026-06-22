/**
 * Test: simula o pipeline de texto para o PDF 0458-PERFIS-R00
 * Verifica se isMeaningfulExtractedPdfText, isBarListDocumentText,
 * e parseBarListLine funcionam corretamente para o conteúdo real do PDF.
 *
 * Execute: node test-aluminorte.mjs
 */

// ─── Replicas das funções do ocrService.ts ────────────────────────────────────

function normalizeLineForStrictParsing(line) {
  return line
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCatalogMatchCode(code) {
  return code
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[‐-―]/g, "-")
    .replace(/[.\s-]+/g, "");
}

function isMeaningfulExtractedPdfText(text) {
  const trimmed = text.trim();
  if (trimmed.length < 30) return false;
  const controlChars = (trimmed.match(/[\x00-\x08\x0B\x0C\x0E-\x1F�]/g) || []).length;
  if (controlChars / trimmed.length > 0.02) return false;
  const normalized = normalizeLineForStrictParsing(trimmed);
  const alphaNumericChars = (normalized.match(/[A-Z0-9]/g) || []).length;
  if (alphaNumericChars / Math.max(normalized.length, 1) < 0.25) return false;
  const readableWords = normalized.match(/\b[A-Z]{2,}\b/g) || [];
  const knownDocumentTerms = /\b(PERFIL|TRATAMENTO|QTDE|BARRA|PESO|CODIGO|DESCRICAO|PRODUTO|ACABAMENTO|ORCAMENTO|COTACAO|ENTREGA|RELACAO|ORIENTACAO|CLIENTE|OBRA)\b/.test(normalized);
  return knownDocumentTerms || readableWords.length >= 5;
}

function isBarListDocumentText(text) {
  const normalized = normalizeLineForStrictParsing(text);
  return /\bRELACAO DE BARRAS\b/.test(normalized) || (
    /\bPERFIL\b/.test(normalized) &&
    /\bTRATAMENTO\b/.test(normalized) &&
    /\bQTDE\b/.test(normalized) &&
    /\bBARRA\b/.test(normalized) &&
    /\bPESO\b/.test(normalized)
  );
}

function isDocumentMetadataLine(normalizedLine) {
  return /^(RELACAO|EMITIDO|OBRA|CLIENTE|COR PREDOMINANTE|OBS\.?|PERFIL|TRATAMENTO|QTDE|BARRA|PESO|DATA|ATENCAO|CEM PRO|SUBTOTAL|TOTAL|SISTEMA|RELATORIO|BENEFICIAMENTO|EMPRESA|TOTAIS|PAG|PAGINA|SECAO|MATERIAL|TUBULAR)\b/.test(normalizedLine);
}

function isLikelyBarLength(value) {
  if (!Number.isInteger(value) || value < 2500 || value > 7000) return false;
  return value % 500 === 0 || [5800, 6100, 6200].includes(value);
}

function parseNumberToken(raw) {
  const normalized = raw.replace(",", ".");
  const value = parseFloat(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  const integerLike = !raw.includes(",") && !raw.includes(".");
  return { value, integerLike };
}

function extractNumberTokens(line) {
  return Array.from(line.matchAll(/\d{1,6}(?:[.,]\d{1,3})?/g))
    .map((match) => {
      const token = parseNumberToken(match[0]);
      if (!token) return null;
      return { ...token, index: match.index ?? 0 };
    })
    .filter(Boolean);
}

function extractQuantityAndLengthFromLine(lineAfterCode) {
  const tokens = extractNumberTokens(lineAfterCode);
  const lengthIndex = tokens.findIndex(t => t.integerLike && isLikelyBarLength(t.value));
  if (lengthIndex <= 0) return {};
  const quantityToken = tokens
    .slice(0, lengthIndex)
    .reverse()
    .find(t => t.integerLike && Number.isInteger(t.value) && t.value > 0 && !isLikelyBarLength(t.value));
  return { qtde: quantityToken?.value, comprimento: tokens[lengthIndex].value };
}

function mapTreatmentToAcabamento(value) {
  const normalized = normalizeLineForStrictParsing(value);
  if (/\bEPPF\b/.test(normalized) || /RAL\s*9005|PRETO/.test(normalized)) return "EPPF";
  if (/\bEBCO\b/.test(normalized) || /RAL\s*(9003|9010)|BRANCO/.test(normalized)) return "EBCO";
  if (/\bFOS\b/.test(normalized) || /FOSCO/.test(normalized)) return "FOS";
  if (/\bNT\b/.test(normalized) || /NATURAL|BRUTO|SEM\s+PINTURA/.test(normalized)) return "NT";
  return "NT";
}

const STRICT_PRODUCT_CODE_SOURCE = String.raw`(?:\d{1,3}[A-Z]{1,5}\s*-?\s*[A-Z]?\d{1,6}[A-Z]{0,3}|[A-Z]{1,5}\s*-?\s*[A-Z]{1,5}\s*-?\s*\d{1,6}[A-Z]{0,3}|[A-Z]{1,5}\s*-?\s*\d{1,6}[A-Z]{0,3}|\d{2,6}\s*-\s*\d{2,6}[A-Z]{0,2}|\d{4,6}[A-Z]{0,2})`;
const STRICT_LINE_PRODUCT_CODE_REGEX = new RegExp(`^(${STRICT_PRODUCT_CODE_SOURCE})\\b`);

function parseBarListLine(line) {
  const normalizedLine = normalizeLineForStrictParsing(line);
  if (!normalizedLine) return null;
  if (isDocumentMetadataLine(normalizedLine)) return null;
  if (/^[A-Z]{1,4}-P-RAL\d{4}/.test(normalizedLine) || /^SOLIDO-/.test(normalizedLine)) return null;

  const codeMatch = normalizedLine.match(STRICT_LINE_PRODUCT_CODE_REGEX);
  if (!codeMatch) return null;

  const rawCode = codeMatch[1];
  const rest = normalizedLine.slice(rawCode.length).trim();
  const { qtde, comprimento } = extractQuantityAndLengthFromLine(rest);
  if (!qtde || !comprimento) return null;

  const treatment = rest
    .replace(/\b\d{1,5}\s+\d{4,6}\b.*$/, "")
    .trim();

  const acabamento = mapTreatmentToAcabamento(treatment);

  return { code: rawCode, qtde, comprimento, acabamento, rest_preview: rest.slice(0, 50) };
}

// ─── Conteúdo real do PDF (como viria do PDF.js) ─────────────────────────────

const PDF_TEXT = `Data Calc.: 03/06/2026 16:32:28
Obs.: Para que o material abaixo seja suficiente para a montagem de todos os caixilhos e preciso seguir o relatorio de Orientacao de Cortes da Obra
Obra cod.:
Cliente:
NL-26-06-0458-R00 COLEGIO ADVENTISTA
LAERTE
Trat./Cor predom.: PINTURA BRANCO BRILHANTE - RAL9003B
Nome:
Relacao de Barras
Emitido por: ADMINISTRADOR 03/06/2026 16:35
Perfil Trat./Cor Qtde Barra Peso (kg) Sobra (kg) ( % )
AZ-P-RAL9003B Arremate-RAL9003-BRANCO BRILH.
RM005 PINTURA BRANCO BRILHANTE - RAL9003B 6 6000 7,272 1,857 25,53
7,272 1,857
CM CONTRAMARCO
CL006 1 6000 6,672 6,476 97,07
CL011 1 6000 1,902 1,790 94,13
CM200 6 6000 7,128 1,851 25,98
15,702 10,118
22,974 11,975 52,12
SA-P-RAL9003B Solido-RAL9003-BRANCO BRILH.
42014 PINTURA BRANCO BRILHANTE - RAL9003B 4 6000 8,856 3,155 35,63
BG037 PINTURA BRANCO BRILHANTE - RAL9003B 8 6000 9,984 1,295 12,97
FA-259 PINTURA BRANCO BRILHANTE - RAL9003B 96 6000 359,424 20,203 5,62
FA-260 PINTURA BRANCO BRILHANTE - RAL9003B 503 6000 3.992,814 175,234 4,39
4.371,078 199,887
SBRUTO SOLIDO BRUTO
3046 23 6000 219,420 44,177 20,13
3047 45 6000 105,030 19,282 18,36
324,450 63,459
4.695,528 263,345 5,61
SBRUTO SOLIDO BRUTO
CL006 1 6000 6,672 5,111 76,60
CL011 1 6000 1,902 1,012 53,20
8,574 6,123
8,574 6,123 71,41
SmartCEM - Esquadgroup NORTE LUMI INDUSTRIA E COM DE METAIS LTDA 1 / 2
Perfil Trat./Cor Qtde Barra Peso (kg) Sobra (kg) ( % )
TA-P-RAL9003B Tubular-RAL9003-BRANCO BRILH.
42006 PINTURA BRANCO BRILHANTE - RAL9003B 2 6000 18,924 8,140 43,02
42007 PINTURA BRANCO BRILHANTE - RAL9003B 1 6000 7,680 0,108 1,40
42012 PINTURA BRANCO BRILHANTE - RAL9003B 6 6000 30,204 8,047 26,64
42032 PINTURA BRANCO BRILHANTE - RAL9003B 7 6000 58,170 4,296 7,39
FA-255 PINTURA BRANCO BRILHANTE - RAL9003B 83 6000 380,970 22,736 5,97
FA-256 PINTURA BRANCO BRILHANTE - RAL9003B 29 6000 139,200 11,680 8,39
FA-258 PINTURA BRANCO BRILHANTE - RAL9003B 294 6000 1.040,760 64,697 6,22
1.675,908 119,704
1.675,908 119,704 7,14
TOTAL: 6.402,984 401,147 6,26
SmartCEM - Esquadgroup NORTE LUMI INDUSTRIA E COM DE METAIS LTDA 2 / 2`;

// ─── Testes ───────────────────────────────────────────────────────────────────

console.log("=== isMeaningfulExtractedPdfText ===");
console.log("Resultado:", isMeaningfulExtractedPdfText(PDF_TEXT));  // esperado: true

console.log("\n=== isBarListDocumentText ===");
console.log("Resultado:", isBarListDocumentText(PDF_TEXT));  // esperado: true

console.log("\n=== parseBarListLine para cada linha ===");
const expected = [
  "RM005", "CL006", "CL011", "CM200",
  "42014", "BG037", "FA-259", "FA-260",
  "3046", "3047", "CL006", "CL011",
  "42006", "42007", "42012", "42032",
  "FA-255", "FA-256", "FA-258"
];

let extracted = [];
let failed = [];

for (const line of PDF_TEXT.split("\n")) {
  const result = parseBarListLine(line);
  if (result) {
    extracted.push(result);
    process.stdout.write(`  ✓ ${result.code.padEnd(10)} qtde=${String(result.qtde).padEnd(4)} comp=${result.comprimento}  acab=${result.acabamento}  |  ${result.rest_preview}\n`);
  }
}

console.log("\n=== Verificação de completude ===");
for (const code of expected) {
  const normalizedCode = normalizeCatalogMatchCode(code);
  const found = extracted.find(e => normalizeCatalogMatchCode(e.code) === normalizedCode);
  if (found) {
    console.log(`  ✓ ${code}`);
  } else {
    console.log(`  ✗ ${code}  ← NÃO EXTRAÍDO`);
    failed.push(code);
  }
}

if (failed.length === 0) {
  console.log("\n✅ TODOS os 19 itens extraídos corretamente pelo parser de texto.");
} else {
  console.log(`\n❌ ${failed.length} item(s) ausente(s): ${failed.join(", ")}`);
}
