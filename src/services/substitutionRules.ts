import substitutionRulesData from "../data/substitutionRules.json";

export type SubstitutionStatus = "auto-converted" | "pending" | "accepted" | "declined";

export interface SubstitutionMetadata {
  status: SubstitutionStatus;
  produtoOriginal: string;
  produtoSugerido?: string;
  textoSugestao?: string;
  observacao?: string;
  conversaoAluminorte?: string;
}

export interface SubstitutionRuleRow {
  itemPedido: string;
  conversaoAluminorte: string;
  sugestao: string;
  comentarios: string;
}

interface ResolvedSubstitutionRule {
  itemPedido: string;
  conversaoAluminorte: string;
  sugestao: string;
  comentarios: string;
  autoProduct?: string;
  suggestionProduct?: string;
  isNaoTemos: boolean;
}

interface SubstitutionTarget {
  produto: string;
  produtoOriginal?: string;
  identificado: boolean;
  verificadoNoCatalogo?: boolean;
  autoCatalogCandidate?: boolean;
  substituicao?: SubstitutionMetadata;
}

export interface SubstitutionTextItem extends SubstitutionTarget {
  acabamento: string;
  qtde: number;
  comprimento: number;
}

export const defaultSubstitutionRules = substitutionRulesData as SubstitutionRuleRow[];

const CODE_REGEX = /\b(?:\d{2,6}-\d{2,6}[A-Z]{0,2}|\d{1,3}[A-Z]{1,5}\d{2,5}[A-Z]{0,3}|[A-Z]{1,5}-?\d{2,6}[A-Z]{0,3}|\d{4,6}[A-Z]{0,2})\b/i;
const CODE_GLOBAL_REGEX = new RegExp(CODE_REGEX.source, "gi");

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
}

export function normalizeSubstitutionCode(value: string): string {
  return normalizeText(value).replace(/[^A-Z0-9]/g, "");
}

function isBlankValue(value: string): boolean {
  const trimmed = value.trim();
  return !trimmed || trimmed === "-";
}

function isNaoTemosValue(value: string): boolean {
  return normalizeText(value) === "NAO TEMOS";
}

export function extractFirstSubstitutionCode(value: string): string | null {
  const match = value.trim().match(CODE_REGEX);
  return match ? match[0].toUpperCase() : null;
}

function expandItemKeys(itemPedido: string): string[] {
  const keys = new Set<string>();
  const fullKey = normalizeSubstitutionCode(itemPedido);
  if (fullKey) keys.add(fullKey);

  const codeMatches = itemPedido.match(CODE_GLOBAL_REGEX) || [];
  codeMatches.forEach((match) => {
    const key = normalizeSubstitutionCode(match);
    if (key) keys.add(key);
  });

  itemPedido.split(/[\/,;]/).forEach((part) => {
    const key = normalizeSubstitutionCode(part);
    if (key) keys.add(key);
  });

  return Array.from(keys);
}

function appendUniqueText(current: string, next: string): string {
  if (isBlankValue(next)) return current;
  if (!current) return next;

  const parts = current.split(" | ").map(part => part.trim());
  return parts.includes(next.trim()) ? current : `${current} | ${next}`;
}

function buildResolvedRule(row: SubstitutionRuleRow): ResolvedSubstitutionRule {
  const conversaoAluminorte = row.conversaoAluminorte || "";
  const sugestao = row.sugestao || "";
  const isNaoTemos = isNaoTemosValue(conversaoAluminorte);
  const hasConversionValue = !isBlankValue(conversaoAluminorte) && !isNaoTemos;
  const autoProduct = hasConversionValue ? extractFirstSubstitutionCode(conversaoAluminorte) || undefined : undefined;
  const suggestionProduct = !isBlankValue(sugestao) ? extractFirstSubstitutionCode(sugestao) || undefined : undefined;

  return {
    itemPedido: row.itemPedido,
    conversaoAluminorte,
    sugestao,
    comentarios: row.comentarios || "",
    autoProduct,
    suggestionProduct,
    isNaoTemos,
  };
}

function mergeRule(existing: ResolvedSubstitutionRule | undefined, next: ResolvedSubstitutionRule): ResolvedSubstitutionRule {
  if (!existing) return next;

  const existingRank = (existing.autoProduct ? 4 : 0) + (existing.isNaoTemos && existing.suggestionProduct ? 2 : 0) + (existing.suggestionProduct ? 1 : 0);
  const nextRank = (next.autoProduct ? 4 : 0) + (next.isNaoTemos && next.suggestionProduct ? 2 : 0) + (next.suggestionProduct ? 1 : 0);
  const winner = nextRank > existingRank ? next : existing;
  const loser = winner === next ? existing : next;

  return {
    ...winner,
    comentarios: appendUniqueText(winner.comentarios, loser.comentarios),
  };
}

function buildSubstitutionLookup(rows: SubstitutionRuleRow[]): Record<string, ResolvedSubstitutionRule> {
  return rows.reduce<Record<string, ResolvedSubstitutionRule>>((lookup, row) => {
    const rule = buildResolvedRule(row);
    expandItemKeys(rule.itemPedido).forEach((key) => {
      lookup[key] = mergeRule(lookup[key], rule);
    });
    return lookup;
  }, {});
}

function isActionableRule(rule: ResolvedSubstitutionRule): boolean {
  return Boolean(rule.autoProduct || rule.suggestionProduct);
}

function buildManualLineVariants(line: string): Array<{ text: string; qtde: number }> {
  const trimmed = line.trim();
  if (!trimmed) return [];

  const variants: Array<{ text: string; qtde: number }> = [];
  const addVariant = (text: string, qtde: number) => {
    const cleanText = text.trim();
    if (!cleanText) return;
    if (variants.some(variant => variant.text === cleanText && variant.qtde === qtde)) return;
    variants.push({ text: cleanText, qtde });
  };
  const withoutMarker = trimmed.replace(/^\s*(?:[-*]|\d{1,3}[.)-])\s*/, "").trim();

  const leadingQuantity = withoutMarker.match(/^(\d{1,5})\s+(.+)$/);
  if (leadingQuantity && /[A-Z]/.test(normalizeText(leadingQuantity[2]))) {
    const qtde = Number.parseInt(leadingQuantity[1], 10);
    if (Number.isFinite(qtde) && qtde > 0) {
      addVariant(leadingQuantity[2], qtde);
    }
  }

  const trailingQuantity = withoutMarker.match(/^(.+?)\s*[-:;]?\s+(\d{1,5})$/);
  if (trailingQuantity && /[A-Z]/.test(normalizeText(trailingQuantity[1]))) {
    const qtde = Number.parseInt(trailingQuantity[2], 10);
    if (Number.isFinite(qtde) && qtde > 0) {
      addVariant(trailingQuantity[1], qtde);
    }
  }

  if (withoutMarker && withoutMarker !== trimmed) {
    addVariant(withoutMarker, 1);
  }

  addVariant(trimmed, 1);

  return variants;
}

function findRuleInText(
  text: string,
  lookup: Record<string, ResolvedSubstitutionRule>
): { rule: ResolvedSubstitutionRule; productText: string } | null {
  const exactKey = normalizeSubstitutionCode(text);
  if (exactKey && lookup[exactKey]) {
    return { rule: lookup[exactKey], productText: text.trim() };
  }

  const codeMatches = text.match(CODE_GLOBAL_REGEX) || [];
  for (const match of codeMatches) {
    const key = normalizeSubstitutionCode(match);
    if (key && lookup[key]) {
      return { rule: lookup[key], productText: match.toUpperCase() };
    }
  }

  return null;
}

export function extractSubstitutionItemsFromText(
  text: string,
  rules = defaultSubstitutionRules,
  quantityColumnIndex?: number
): SubstitutionTextItem[] {
  const substitutionLookup = buildSubstitutionLookup(rules.length > 0 ? rules : defaultSubstitutionRules);
  const items: SubstitutionTextItem[] = [];

  for (const line of text.split(/\r?\n/)) {
    let customQtde: number | undefined = undefined;
    if (quantityColumnIndex !== undefined) {
      const tokens = line.trim().split(/\s+/);
      const qtyToken = tokens[quantityColumnIndex];
      if (qtyToken) {
        const cleanQtyToken = qtyToken.replace(/[^\d]/g, "");
        const parsedQty = Number.parseInt(cleanQtyToken, 10);
        if (Number.isFinite(parsedQty) && parsedQty > 0) {
          customQtde = parsedQty;
        }
      }
    }

    for (const variant of buildManualLineVariants(line)) {
      const match = findRuleInText(variant.text, substitutionLookup);
      if (!match || !isActionableRule(match.rule)) continue;

      items.push({
        produto: match.productText,
        produtoOriginal: line.trim() || variant.text.trim(),
        acabamento: "NT",
        qtde: customQtde !== undefined ? customQtde : variant.qtde,
        comprimento: 6000,
        identificado: false,
        verificadoNoCatalogo: false,
      });
      break;
    }
  }

  return items;
}

function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = Array(a.length + 1).fill(null).map(() => Array(b.length + 1).fill(null));
  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
}

function findRuleForItem(
  item: SubstitutionTarget,
  lookup: Record<string, ResolvedSubstitutionRule>,
  allowFuzzy = true
): ResolvedSubstitutionRule | undefined {
  const candidates = [item.produto, item.produtoOriginal || ""]
    .map(normalizeSubstitutionCode)
    .filter(Boolean);

  // 1. Busca exata
  for (const key of candidates) {
    const rule = lookup[key];
    if (rule) return rule;
  }

  if (!allowFuzzy) return undefined;

  // 2. Busca fuzzy (erros de digitação como LAMGRIL DUPO -> LAMBRILDUPLO)
  const allKeys = Object.keys(lookup);
  for (const key of candidates) {
    if (key.length <= 7) continue; // Evita fuzzy match em códigos curtos (ex: SU097) para não gerar falsos positivos

    let bestMatchKey = "";
    let bestDistance = Infinity;

    for (const dictKey of allKeys) {
      // Diferença de tamanho muito grande = não compensa calcular Levenshtein
      if (Math.abs(dictKey.length - key.length) > 3) continue;

      const distance = levenshteinDistance(key, dictKey);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestMatchKey = dictKey;
      }
    }

    // Tolerância: até 2 erros para palavras médias, 3 para palavras longas
    const maxTolerance = key.length >= 10 ? 3 : 2;
    if (bestDistance <= maxTolerance && bestMatchKey) {
      return lookup[bestMatchKey];
    }
  }

  return undefined;
}

function buildMetadata(status: SubstitutionStatus, item: SubstitutionTarget, rule: ResolvedSubstitutionRule): SubstitutionMetadata {
  return {
    status,
    produtoOriginal: item.produto,
    produtoSugerido: status === "auto-converted" ? rule.autoProduct : rule.suggestionProduct,
    textoSugestao: isBlankValue(rule.sugestao) ? undefined : rule.sugestao,
    observacao: isBlankValue(rule.comentarios) ? undefined : rule.comentarios,
    conversaoAluminorte: isBlankValue(rule.conversaoAluminorte) ? undefined : rule.conversaoAluminorte,
  };
}

export function applySubstitutionRules<T extends SubstitutionTarget>(items: T[], rules = defaultSubstitutionRules): T[] {
  const substitutionLookup = buildSubstitutionLookup(rules.length > 0 ? rules : defaultSubstitutionRules);

  return items.map((item) => {
    const rule = findRuleForItem(item, substitutionLookup, !item.autoCatalogCandidate);
    if (!rule) return item;

    if (rule.autoProduct) {
      return {
        ...item,
        produto: rule.autoProduct,
        produtoOriginal: item.produto,
        identificado: true,
        substituicao: buildMetadata("auto-converted", item, rule),
      };
    }

    if (rule.suggestionProduct) {
      return {
        ...item,
        substituicao: buildMetadata("pending", item, rule),
      };
    }

    return item;
  });
}
