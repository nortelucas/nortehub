import * as pdfjsLib from "pdfjs-dist";
import * as XLSX from "xlsx";
import mammoth from "mammoth";
import { catalogedMeasuredProfiles, MeasuredProfileCategory } from "../data/measuredProfiles";
import {
  applySubstitutionRules,
  extractSubstitutionItemsFromText,
  type SubstitutionMetadata,
  type SubstitutionRuleRow,
  type SubstitutionTextItem,
} from "./substitutionRules";
import {
  CLASSIFY_PROMPT,
  getProfilePromptChain,
  parseClassificationResult,
  type DocumentProfileKey,
} from "./documentProfiles";

if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
  const isNodeRuntime =
    typeof window === "undefined" &&
    typeof process !== "undefined" &&
    typeof process.cwd === "function";

  if (isNodeRuntime) {
    const workerFilename = pdfjsLib.version.startsWith("4") ? "pdf.worker.mjs" : "pdf.worker.js";
    pdfjsLib.GlobalWorkerOptions.workerSrc = `${process.cwd().replace(/\\/g, "/")}/node_modules/pdfjs-dist/build/${workerFilename}`;
  } else {
    const workerFilename = pdfjsLib.version.startsWith("4") ? "pdf.worker.mjs" : "pdf.worker.min.js";
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/${workerFilename}`;
  }
}

const log = (...args: any[]) => { console.log("[OCR]", ...args); };

export interface OCRItem {
  id?: string;
  produto: string;
  produtoOriginal?: string;
  acabamento: string;
  qtde: number;
  comprimento: number;
  identificado: boolean;
  verificadoNoCatalogo?: boolean;
  preco?: number;
  box_2d?: number[]; // [ymin, xmin, ymax, xmax] (0-1000)
  sourceFileId?: string;
  sourceFileName?: string;
  sourceSheetName?: string;
  autoCatalogCandidate?: boolean;
  preserveProductCode?: boolean;
  skipOriginalTextBlacklist?: boolean;
  corrigidoManualmente?: boolean;
  substituicao?: SubstitutionMetadata;
}

export interface OCRAIReview {
  status: "ok" | "warning" | "unavailable";
  summary: string;
  issues: string[];
  checkedItems?: number;
}

/**
 * Read-only diagnostic produced AFTER extraction. It never alters items — it only
 * flags documents that were likely read poorly, so they can be reviewed and (via the
 * `ocr-profile` skill) get a dedicated/refined reading profile. See SELF_IMPROVEMENT below.
 */
export interface OCRSelfImprovementHint {
  /** True when the document looks like a layout that lacks a dedicated profile. */
  suggestNewProfile: boolean;
  /** Profile key that handled this document ("GENERIC" means no specialized match). */
  profileKeyUsed?: string;
  /** Human-readable reasons (also surfaced in the validation report discrepancies). */
  reasons: string[];
  /** Produtos whose quantity looks misread (ex: a bar length or a round "N,000"). */
  suspectQuantityProducts: string[];
}

export interface OCRValidationReport {
  totalPages: number;
  pagesWithNoItems: number[];
  totalItems: number;
  unidentifiedItems: number;
  uncatalogedItems: number;
  discrepancies: string[];
  aiReview?: OCRAIReview;
  selfImprovementHint?: OCRSelfImprovementHint;
}

export interface OCRResponse {
  items: OCRItem[];
  validationReport?: OCRValidationReport;
}

export class OCRRetryableError extends Error {
  retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = "OCRRetryableError";
    this.retryAfterMs = retryAfterMs;
  }
}

export interface CatalogData {
  products: string[];
  aliases: Record<string, string>;
  blacklist: string[];
  tubeDimensions?: TubeDimension[];
  substitutionRules?: SubstitutionRuleRow[];
}

export interface TubeDimension {
  code: string;
  weightKgM?: number;
  tg?: string;
  inchA?: string;
  inchB?: string;
  inchThickness?: string;
  mmA: number;
  mmB: number;
  mmThickness: number;
}

const DEFAULT_RECTANGULAR_TUBE_DIMENSIONS: TubeDimension[] = [
  { code: "TUB-4500", weightKgM: 0.186, tg: "TG-074", inchA: "1\"", inchB: "1/2", mmA: 25.40, mmB: 12.70, mmThickness: 1.10 },
  { code: "TUB-4501", weightKgM: 0.299, tg: "TG-001", inchA: "1\"", inchB: "1/2", inchThickness: "1/16", mmA: 25.40, mmB: 12.70, mmThickness: 1.58 },
  { code: "TUB-4509", weightKgM: 0.498, tg: "TG-002", mmA: 30.00, mmB: 20.00, mmThickness: 2.00 },
  { code: "TUB-4545", weightKgM: 0.645, tg: "TG-003", inchA: "1\"1/2", inchB: "1\"", mmA: 38.10, mmB: 25.40, mmThickness: 2.00 },
  { code: "TUB-4652", weightKgM: 0.396, tg: "TG-083", inchA: "2\"", inchB: "1/2\"", mmA: 50.80, mmB: 12.70, mmThickness: 1.20 },
  { code: "TUB-4536", weightKgM: 0.517, tg: "TG-004", inchA: "2\"", inchB: "1/2", inchThickness: "1/16", mmA: 50.80, mmB: 12.70, mmThickness: 1.58 },
  { code: "TUB-4673", weightKgM: 0.328, inchA: "2\"", inchB: "1\"", mmA: 50.80, mmB: 25.40, mmThickness: 0.80 },
  { code: "TUB-4576", weightKgM: 0.402, tg: "TG-073", inchA: "2\"", inchB: "1\"", mmA: 50.80, mmB: 25.40, mmThickness: 1.00 },
  { code: "TUB-4560", weightKgM: 0.596, tg: "TG-005", inchA: "2\"", inchB: "1\"", inchThickness: "1/16", mmA: 50.80, mmB: 25.40, mmThickness: 1.50 },
  { code: "TUB-4504", weightKgM: 0.783, tg: "TG-007", inchA: "2\"", inchB: "1\"", mmA: 50.80, mmB: 25.40, mmThickness: 2.00 },
  { code: "TUB-4512", weightKgM: 0.698, inchA: "2\"", inchB: "1\"1/2", mmA: 50.80, mmB: 38.10, mmThickness: 1.50 },
  { code: "TUB-4513", weightKgM: 0.921, tg: "TG-008", inchA: "2\"", inchB: "1\"1/2", mmA: 50.80, mmB: 38.10, mmThickness: 2.00 },
  { code: "TUB-4542", weightKgM: 0.687, inchA: "2\"3/8", inchB: "1\"1/2", mmA: 60.30, mmB: 38.10, mmThickness: 1.35 },
  { code: "TUB-4543", weightKgM: 0.788, tg: "TG-026", inchA: "2\"3/8", inchB: "1\"1/2", mmA: 60.30, mmB: 38.10, mmThickness: 1.70 },
  { code: "TUB-4591", weightKgM: 0.905, tg: "TG-013", inchA: "3\"", inchB: "1\"", mmA: 76.20, mmB: 25.40, mmThickness: 2.00 },
  { code: "TUB-4539", weightKgM: 0.688, inchA: "3\"", inchB: "1\"", mmA: 76.20, mmB: 25.40, mmThickness: 1.20 },
  { code: "TUB-4653", weightKgM: 0.908, tg: "TG-038", inchA: "3\"", inchB: "1\"1/2", inchThickness: "1/16", mmA: 76.20, mmB: 38.10, mmThickness: 1.58 },
  { code: "TUB-4517", weightKgM: 1.088, tg: "TG-014", inchA: "3\"", inchB: "1\"1/2", mmA: 76.20, mmB: 38.10, mmThickness: 2.00 },
  { code: "TUB-4518", weightKgM: 1.789, tg: "TG-081", inchA: "3\"", inchB: "1\"1/2", inchThickness: "1/8", mmA: 76.20, mmB: 38.10, mmThickness: 3.05 },
  { code: "TUB-4657", weightKgM: 1.353, inchA: "3\"", inchB: "2\"", mmA: 76.20, mmB: 50.80, mmThickness: 2.00 },
  { code: "TUB-4573", weightKgM: 2.076, tg: "TG-035", inchA: "3\"", inchB: "2\"", inchThickness: "1/8", mmA: 76.20, mmB: 50.80, mmThickness: 3.17 },
  { code: "TUB-4537", weightKgM: 1.712, tg: "TG-018", inchA: "4\"", inchB: "1\"1/2", mmA: 101.60, mmB: 38.10, mmThickness: 2.40 },
  { code: "TUB-4658", weightKgM: 1.335, inchA: "4\"", inchB: "2\"", inchThickness: "1/16", mmA: 101.60, mmB: 50.80, mmThickness: 1.58 },
  { code: "74500", weightKgM: 1.609, tg: "TG-072", inchA: "4\"", inchB: "2\"", mmA: 101.60, mmB: 50.80, mmThickness: 2.00 },
  { code: "TUB-4599", weightKgM: 1.928, tg: "TG-019", inchA: "4\"", inchB: "2\"", mmA: 101.60, mmB: 50.80, mmThickness: 2.40 },
  { code: "TUB-4530", weightKgM: 2.420, tg: "TG-021", inchA: "4\"", inchB: "2\"", inchThickness: "1/8", mmA: 101.60, mmB: 50.80, mmThickness: 3.05 },
  { code: "TUB-4520", weightKgM: 3.199, tg: "TG-024", inchA: "6\"", inchB: "1\"1/2", inchThickness: "1/8", mmA: 152.40, mmB: 38.10, mmThickness: 3.05 },
  { code: "TUB-4559", weightKgM: 3.389, tg: "TG-082", inchA: "6\"", inchB: "2\"", inchThickness: "1/8", mmA: 152.40, mmB: 50.80, mmThickness: 3.05 },
  { code: "TUB-4604", weightKgM: 3.868, inchA: "6\"", inchB: "3\"", inchThickness: "1/8", mmA: 152.40, mmB: 76.20, mmThickness: 3.17 },
  { code: "TUB-4661", weightKgM: 3.800, mmA: 180.00, mmB: 76.00, mmThickness: 2.80 },
];

function normalizeCatalogMatchCode(code: string): string {
  return code
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[.\s-]+/g, "");
}

function formatRecognizedCatalogCode(code: string): string {
  const compact = code
    .trim()
    .toUpperCase()
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\./g, "")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, "");

  if (!(/[A-Z]/.test(compact) && /\d/.test(compact))) return compact;

  // Normalize CF+digits pattern into the standard CFC-DIGITS format.
  // Handles: CF5600 → CFC-5600, CF-5600 → CFC-5600, CFC5600 → CFC-5600, CFC-5600 → CFC-5600 (unchanged)
  const normalized = compact.replace(/CFC?-?(\d+)/g, "CFC-$1");

  // Remove hyphens EXCEPT when preceded by "C" and followed by a digit (e.g. SU055C-5600, SU055CFC-5600)
  return normalized.replace(/-/g, (match, offset) => {
    const before = normalized[offset - 1] ?? "";
    const after = normalized[offset + 1] ?? "";
    return before === "C" && /\d/.test(after) ? match : "";
  });
}

function normalizeDimensionCode(code: string): string {
  return normalizeCatalogMatchCode(code);
}

function formatDimension(value: number): string {
  return value.toFixed(2).replace(".", ",");
}

function buildTubeDimensionAliases(dimensions: TubeDimension[]): Array<[string, string]> {
  return dimensions.flatMap((dimension) => {
    const code = normalizeDimensionCode(dimension.code);
    const aliases: Array<[string, string]> = [[
      `TUBO RETANGULAR ${formatDimension(dimension.mmA)}X${formatDimension(dimension.mmB)}X${formatDimension(dimension.mmThickness)}`,
      code,
    ]];

    const inchMeasures = [dimension.inchA, dimension.inchB, dimension.inchThickness].filter(
      (measure): measure is string => Boolean(measure && measure !== "-")
    );

    if (inchMeasures.length >= 2) {
      aliases.push([`TUBO RETANGULAR ${inchMeasures.join("X")}`, code]);
    }

    return aliases;
  });
}

const CATALOGED_MEASURED_PROFILE_CODES = new Set(
  catalogedMeasuredProfiles.map(profile => normalizeDimensionCode(profile.code))
);

const MEASURED_PROFILE_LABELS: Record<MeasuredProfileCategory, string> = {
  flatBar: "BARRA CHATA",
  angleUnequal: "CANTONEIRA DESIGUAL",
  angleEqual: "CANTONEIRA",
  profileU: "PERFIL U",
  profileT: "PERFIL T",
  roundTube: "TUBO REDONDO",
  rectTube: "TUBO RETANGULAR",
  squareTube: "TUBO QUADRADO",
};

function buildCatalogedMeasuredProfileAliases(): Array<[string, string]> {
  return catalogedMeasuredProfiles.flatMap((profile) => {
    const label = MEASURED_PROFILE_LABELS[profile.category];
    const aliases: Array<[string, string]> = [
      [`${label} ${profile.mmMeasures.map(formatDimension).join("X")}`, profile.code],
    ];

    const inchMeasures = profile.inchMeasures.filter(Boolean);
    if (inchMeasures.length > 0 && inchMeasures.length === profile.mmMeasures.length) {
      aliases.push([`${label} ${inchMeasures.join("X")}`, profile.code]);
    }

    return aliases;
  });
}

const MEASURED_PROFILE_ALIASES: Array<[string, string]> = [
  ...buildCatalogedMeasuredProfileAliases(),
  ["BARRA CHATA 5/8X3/16", "BAR010"],
  ["BARRA CHATA 1/2X1/8", "BAR012"],
  ["BARRA CHATA 5/8X1/8", "BAR013"],
  ["BARRA CHATA 3/4X1/8", "BAR014"],
  ["BARRA CHATA 7/8X1/8", "BAR015"],
  ["BARRA CHATA 1X1/8", "BAR016"],
  ["BARRA CHATA 1.1/4X1/8", "BAR019"],
  ["BARRA CHATA 1.1/2X1/8", "BAR022"],
  ["BARRA CHATA 2X1/8", "BAR027"],
  ["BARRA CHATA 3X1/8", "BAR032"],
  ["BARRA CHATA 1/2X3/16", "BAR047"],
  ["BARRA CHATA 5/8X3/16", "BAR049"],
  ["BARRA CHATA 3/4X3/16", "BAR050"],
  ["BARRA CHATA 1X3/16", "BAR053"],
  ["BARRA CHATA 1.1/4X3/16", "BAR054"],
  ["BARRA CHATA 15,88X4,76", "BAR010"],
  ["BARRA CHATA 12,70X3,18", "BAR012"],
  ["BARRA CHATA 15,87X3,18", "BAR013"],
  ["BARRA CHATA 19,05X3,17", "BAR014"],
  ["BARRA CHATA 22,20X3,17", "BAR015"],
  ["BARRA CHATA 25,40X3,18", "BAR016"],
  ["BARRA CHATA 31,75X3,17", "BAR019"],
  ["BARRA CHATA 38,10X3,18", "BAR022"],
  ["BARRA CHATA 50,80X3,18", "BAR027"],
  ["BARRA CHATA 76,20X3,18", "BAR032"],
  ["BARRA CHATA 12,70X4,76", "BAR047"],
  ["BARRA CHATA 15,87X4,76", "BAR049"],
  ["BARRA CHATA 19,05X4,76", "BAR050"],
  ["BARRA CHATA 25,40X4,76", "BAR053"],
  ["BARRA CHATA 31,75X4,76", "BAR054"],
  ["BARRA CHATA 38,10X4,76", "BAR057"],
  ["BARRA CHATA 12,70X6,35", "BAR086"],
  ["BARRA CHATA 19,05X6,35", "BAR089"],
  ["BARRA CHATA 25,40X6,35", "BAR091"],
  ["BARRA CHATA 31,75X6,35", "BAR093"],
  ["BARRA CHATA 50,80X6,35", "BAR100"],
  ["CANTONEIRA 12,70X1,58", "L002"],
  ["CANTONEIRA 19,05X1,58", "L009"],
  ["CANTONEIRA 19,05X3,18", "L011"],
  ["CANTONEIRA 25,40X1,58", "L013"],
  ["CANTONEIRA 25,40X3,18", "L014"],
  ["CANTONEIRA 31,75X3,20", "L018"],
  ["CANTONEIRA 38,10X3,18", "L022"],
  ["CANTONEIRA 38,10X4,76", "L023"],
  ["CANTONEIRA 50,80X3,18", "L025"],
  ["CANTONEIRA 50,80X4,76", "L026"],
  ["CANTONEIRA 15,87X1,60", "L405"],
  ["CANTONEIRA 50,80X2,00", "L612"],
  ["CANTONEIRA 38,10X1,57", "L744"],
  ["CANTONEIRA DESIGUAL 25,40X12,70X3,20", "L093"],
  ["CANTONEIRA 25,40X12,70X3,20", "L093"],
  ["CANTONEIRA 25X12X2", "L093"],
  ["CANTONEIRA DESIGUAL 38,10X25,40X3,20", "L100"],
  ["CANTONEIRA 38,10X25,40X3,20", "L100"],
  ["CANTONEIRA 38X25X2", "L100"],
  ["CANTONEIRA DESIGUAL 50,80X25,40X3,20", "L104"],
  ["CANTONEIRA 50,80X25,40X3,20", "L104"],
  ["CANTONEIRA 50,8X25,4X2", "L104"],
  ["CANTONEIRA DESIGUAL 32X16,2X1,20", "CT209"],
  ["CANTONEIRA 32X16,2X1,20", "CT209"],
  ["TUBO REDONDO 19,05X1,00", "TUB001"],
  ["TUBO REDONDO 9,52X1,58", "TUB003"],
  ["TUBO REDONDO 12,70X1,24", "TUB009"],
  ["TUBO REDONDO 15,88X1,00", "TUB017"],
  ["TUBO REDONDO 15,87X1,58", "TUB019"],
  ["TUBO REDONDO 19,05X1,20", "TUB027"],
  ["TUBO REDONDO 19,05X1,58", "TUB028"],
  ["TUBO REDONDO 22,22X1,00", "TUB036"],
  ["TUBO REDONDO 22,22X1,58", "TUB038"],
  ["TUBO REDONDO 25,40X0,90", "TUB044"],
  ["TUBO REDONDO 25,40X1,58", "TUB046"],
  ["TUBO REDONDO 31,75X1,58", "TUB058"],
  ["TUBO REDONDO 38,10X1,50", "TUB069"],
  ["TUBO REDONDO 50,50X2,00", "TUB091"],
  ["TUBO REDONDO 50,80X1,27", "TUB502"],
  ["TUBO REDONDO 76,20X1,27", "TUB503"],
  ["TUBO REDONDO 101,60X1,50", "TUB504"],
  ["TUBO REDONDO 50,80X1,58", "TUB610"],
  ...buildTubeDimensionAliases(DEFAULT_RECTANGULAR_TUBE_DIMENSIONS),
  ["TUBO RETANGULAR 38,10X25,40X1,20", "TUB4545L"],
  ["TUBO RETANGULAR 50,80X25,40X1,20", "TUB4563"],
  ["TUBO QUADRADO 12,70X12,70X1,30", "TUB4001"],
  ["TUBO QUADRADO 15,87X15,87X1,50", "TUB4002"],
  ["TUBO QUADRADO 19,05X19,05X1,50", "TUB4003"],
  ["TUBO QUADRADO 25,40X25,40X1,50", "TUB4008"],
  ["TUBO QUADRADO 31,75X31,75X1,20", "TUB4011"],
  ["TUBO QUADRADO 38,10X38,10X1,50", "TUB4014"],
  ["TUBO QUADRADO 50,80X50,80X1,40", "TUB4020"],
  ["TUBO QUADRADO 80,00X80,00X1,80", "TUB4034"],
  ["TUBO QUADRADO 101,60X101,60X2,50", "TUB4054"],
  ["TUBO QUADRADO 25,40X25,40X1,00", "TUB4061"],
];

function normalizeMeasuredProfileText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    // Abreviações e erros comuns
    .replace(/\bTUBOS?\b|\bTUB\b/g, "TUBO")
    .replace(/\bBARRAS?\b|\bBAR\b/g, "BARRA")
    .replace(/\bCHATAS?\b|\bCHA\b|\bCHAT\b/g, "CHATA")
    .replace(/\bCANTONEIRAS?\b|\bCANT\b|\bCANTON\b/g, "CANTONEIRA")
    .replace(/\bPERFIS?\b|\bPERF\b/g, "PERFIL")
    .replace(/\bQUADRADOS?\b|\bQUAD\b|\bQUADR\b/g, "QUADRADO")
    .replace(/\bREDONDOS?\b|\bRED\b|\bREDON\b/g, "REDONDO")
    .replace(/\bRETANGULARES?\b|\bRETANGULAR\b|\bRET\b|\bRETANG\b/g, "RETANGULAR")
    .replace(/\bMM\b/g, "")
    .replace(/[×*]/g, "X")
    .replace(/([A-Z])\.(?=\d)/g, "$1 ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseInchToken(token: string): number {
  const normalized = token.replace(",", ".").trim();
  const mixed = normalized.match(/^(\d+)[.\s]+(\d+)\/(\d+)$/);
  if (mixed) {
    return (Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3])) * 25.4;
  }

  const fraction = normalized.match(/^(\d+)\/(\d+)$/);
  if (fraction) {
    return (Number(fraction[1]) / Number(fraction[2])) * 25.4;
  }

  return Number(normalized);
}

function parseDimensionSegment(segment: string, asInch: boolean): number | null {
  const normalized = segment.replace(/["']/g, " ").replace(/-/g, " ").trim();

  if (asInch) {
    const mixed = normalized.match(/(\d+)(?:[.\s]+)(\d+)\s*\/\s*(\d+)\s*$/);
    if (mixed) {
      return (Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3])) * 25.4;
    }

    const fraction = normalized.match(/(\d+)\s*\/\s*(\d+)\s*$/);
    if (fraction) {
      return (Number(fraction[1]) / Number(fraction[2])) * 25.4;
    }
  }

  const number = normalized.match(/(\d+(?:[,.]\d+)?)\s*$/);
  if (!number) return null;

  const value = Number(number[1].replace(",", "."));
  return asInch ? value * 25.4 : value;
}

function measuresFromText(value: string): number[] {
  let text = value.replace(/(\d+)\.(\d+)\/(\d+)/g, "$1 $2/$3");
  const dimensionSegments = text.split(/\s*X\s*/).filter(Boolean);
  if (dimensionSegments.length >= 2) {
    const hasMetricDecimal = dimensionSegments.some(segment => /\d+[,.]\d+/.test(segment));
    const hasInchNotation = !hasMetricDecimal && /["']|\d+\s*\/\s*\d+/.test(text);
    const wholeNumberSegments = dimensionSegments
      .map(segment => segment.trim().match(/(?:^|\s)(\d+)$/)?.[1])
      .filter((measure): measure is string => Boolean(measure));
    const hasCompactInchMeasures = !hasMetricDecimal &&
      !hasInchNotation &&
      wholeNumberSegments.length === dimensionSegments.length &&
      wholeNumberSegments.every(measure => Number(measure) > 0 && Number(measure) <= 12);
    const dimensions = dimensionSegments
      .map(segment => parseDimensionSegment(segment, hasInchNotation || hasCompactInchMeasures))
      .filter((measure): measure is number => measure !== null);

    if (dimensions.length >= 2) return dimensions.slice(0, 3);
  }

  const hasFractions = /\d+\s*\/\s*\d+/.test(text);

  if (hasFractions) {
    const metricPrefix = text.split(/\s+\d+(?:\s+\d+\/\d+|\d*\/\d+)/)[0];
    const metricNumbers = metricPrefix.match(/\d+(?:[,.]\d+)?/g) || [];
    if (metricNumbers.length >= 2) {
      return metricNumbers.slice(0, 3).map(n => Number(n.replace(",", ".")));
    }

    const tokens = text.match(/\d+(?:[.\s]\d+\/\d+)|\d+\/\d+|\d+(?:[,.]\d+)?/g) || [];
    const measures: number[] = [];

    for (let i = 0; i < tokens.length; i++) {
      const current = tokens[i];
      const next = tokens[i + 1];
      if (/^\d+$/.test(current) && next && /^\d+\/\d+$/.test(next)) {
        measures.push(parseInchToken(`${current} ${next}`));
        i++;
      } else if (/^\d+\/\d+$/.test(current)) {
        measures.push(parseInchToken(current));
      } else {
        measures.push(Number(current.replace(",", ".")) * 25.4);
      }
    }

    return measures.slice(0, 3);
  }

  const finalNumbers = (text.match(/\d+(?:[,.]\d+)?/g) || [])
    .slice(0, 3)
    .map(n => Number(n.replace(",", ".")));
  const hasMetricDecimal = /[,.]\d+/.test(text);

  if (!hasMetricDecimal && finalNumbers.length > 0 && finalNumbers.every(measure => measure > 0 && measure <= 12)) {
    return finalNumbers.map(measure => measure * 25.4);
  }

  return finalNumbers;
}

function almostEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= 0.9;
}

function isCloseMeasure(a: number, b: number): boolean {
  const tolerance = Math.max(1.2, Math.max(Math.abs(a), Math.abs(b)) * 0.035);
  return Math.abs(a - b) <= tolerance;
}

function isCloseThickness(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1.35;
}

function measuresScore(inputNumbers: number[], aliasNumbers: number[], wantsAngle: boolean): number | null {
  if (wantsAngle && inputNumbers.length === 2 && almostEqual(inputNumbers[0], inputNumbers[1])) {
    if (aliasNumbers.length === 3 && !almostEqual(aliasNumbers[0], aliasNumbers[1])) {
      return null;
    }
    return isCloseMeasure(inputNumbers[0], aliasNumbers[0]) ? Math.abs(inputNumbers[0] - aliasNumbers[0]) : null;
  }

  const relevantAliasNumbers = aliasNumbers.slice(0, inputNumbers.length);
  if (relevantAliasNumbers.length !== inputNumbers.length) return null;

  let score = 0;
  for (let index = 0; index < inputNumbers.length; index++) {
    const input = inputNumbers[index];
    const alias = relevantAliasNumbers[index];
    if (index >= 2 ? !isCloseThickness(input, alias) : !isCloseMeasure(input, alias)) return null;
    score += Math.abs(input - alias) * (index >= 2 ? 2 : 1);
  }

  return score;
}

export function resolveMeasuredProfileCode(raw: string, tubeDimensions: TubeDimension[] = []): string | null {
  const normalized = normalizeMeasuredProfileText(raw);
  const inputNumbers = measuresFromText(normalized);
  if (!inputNumbers.length) return null;

  const startsWithTubePrefix = /^(?:TUB|TB|TQ|TR|TBR)[-\s]*\d/i.test(normalized);
  const startsWithFlatBarPrefix = /^BAR[-\s]*\d/i.test(normalized);
  const startsWithAnglePrefix = /^(?:L|CT)[-\s]*\d/i.test(normalized);
  const startsWithProfileUPrefix = /^U[-\s]*\d/i.test(normalized);
  const startsWithProfileTPrefix = /^T[-\s]*\d/i.test(normalized) && !/^(?:TB|TUB|TQ|TR|TBR)/i.test(normalized);

  const wantsTube = /\bTUBO\b/.test(normalized) || startsWithTubePrefix;
  const wantsFlatBar = (/\bBARRA\b/.test(normalized) && /\bCHATA\b/.test(normalized)) || startsWithFlatBarPrefix;
  const wantsAngle = /\bCANTONEIRA\b/.test(normalized) || startsWithAnglePrefix;
  const wantsProfileU = /\bPERFIL\s+U\b/.test(normalized) || startsWithProfileUPrefix;
  const wantsProfileT = /\bPERFIL\s+T\b/.test(normalized) || startsWithProfileTPrefix;

  let wantsRound = /\bREDONDO\b/.test(normalized) || /^TBR[-\s]*\d/i.test(normalized);
  let wantsSquare = /\bQUADRADO\b/.test(normalized) || /^TQ[-\s]*\d/i.test(normalized) || (wantsTube && inputNumbers.length >= 2 && almostEqual(inputNumbers[0], inputNumbers[1]));
  let wantsRect = /\bRETANGULAR\b/.test(normalized) || /^TR[-\s]*\d/i.test(normalized) || (wantsTube && !wantsRound && !wantsSquare && inputNumbers.length >= 2 && (inputNumbers.length === 3 || (inputNumbers[0] >= 9 && inputNumbers[1] >= 9)));

  if (wantsSquare && inputNumbers.length >= 2 && !almostEqual(inputNumbers[0], inputNumbers[1])) {
    wantsSquare = false;
    wantsRect = true;
  }

  const hasExplicitType = wantsTube || wantsFlatBar || wantsAngle || wantsProfileU || wantsProfileT;

  if (!hasExplicitType) return null;

  const measuredProfileAliases = tubeDimensions.length > 0
    ? [...MEASURED_PROFILE_ALIASES, ...buildTubeDimensionAliases(tubeDimensions)]
    : MEASURED_PROFILE_ALIASES;
  const matches: Array<{ code: string; score: number; omittedMeasure: number; cataloged: boolean }> = [];

  for (const [description, code] of measuredProfileAliases) {
    const alias = normalizeMeasuredProfileText(description);
    if (wantsTube && !/\bTUBO\b/.test(alias)) continue;
    if (wantsSquare && !/\bQUADRADO\b/.test(alias)) continue;
    if (wantsRound && !/\bREDONDO\b/.test(alias)) continue;
    if (wantsRect && !/\bRETANGULAR\b/.test(alias)) continue;
    if (wantsFlatBar && !(/\bBARRA\b/.test(alias) && /\bCHATA\b/.test(alias))) continue;
    if (wantsAngle && !/\bCANTONEIRA\b/.test(alias)) continue;
    if (wantsProfileU && !/\bPERFIL\s+U\b/.test(alias)) continue;
    if (wantsProfileT && !/\bPERFIL\s+T\b/.test(alias)) continue;

    const aliasNumbers = measuresFromText(alias);
    let score = measuresScore(inputNumbers, aliasNumbers, wantsAngle);

    if (inputNumbers.length >= 2) {
      const swappedInputNumbers = [inputNumbers[1], inputNumbers[0], ...inputNumbers.slice(2)];
      const swappedScore = measuresScore(swappedInputNumbers, aliasNumbers, wantsAngle);
      if (swappedScore !== null) {
        if (score === null || swappedScore < score) {
          score = swappedScore;
        }
      }
    }

    if (score !== null) {
      matches.push({
        code,
        score,
        omittedMeasure: aliasNumbers[inputNumbers.length] ?? 0,
        cataloged: CATALOGED_MEASURED_PROFILE_CODES.has(normalizeDimensionCode(code)),
      });
    }
  }

  if (!matches.length) return null;

  const bestCatalogedMatches = matches.some(match => match.cataloged)
    ? matches.filter(match => match.cataloged)
    : matches;

  bestCatalogedMatches.sort((a, b) =>
    a.score - b.score ||
    a.omittedMeasure - b.omittedMeasure
  );
  const bestScore = bestCatalogedMatches[0].score;
  const bestMatches = bestCatalogedMatches.filter(match => Math.abs(match.score - bestScore) < 0.001);
  const bestCodes = new Set(bestMatches.map(match => match.code));

  if (wantsTube && inputNumbers.length < 3 && bestCodes.size > 1 && bestMatches.every(match => match.omittedMeasure === bestMatches[0].omittedMeasure)) {
    return null;
  }

  return bestCatalogedMatches[0].code;
}

function compactTubeCode(value: string): string | null {
  const compact = normalizeCatalogMatchCode(value);
  return /^TUB\d{3,4}[A-Z]?$/.test(compact) ? compact : null;
}

function buildCatalogCodeSet(products: string[]): Set<string> {
  return new Set(products.map(normalizeCatalogMatchCode).filter(Boolean));
}

function buildAliasLookup(aliases: Record<string, string>): Record<string, string> {
  return Object.entries(aliases || {}).reduce<Record<string, string>>((lookup, [key, value]) => {
    const normalizedKey = normalizeCatalogMatchCode(key);
    if (normalizedKey) lookup[normalizedKey] = value;
    return lookup;
  }, {});
}

function mergeCatalogedMeasuredProducts(products: string[]): string[] {
  const merged = [...products];
  const normalizedProducts = new Set(merged.map(product => normalizeDimensionCode(product)));

  for (const profile of catalogedMeasuredProfiles) {
    const normalizedCode = normalizeDimensionCode(profile.code);
    if (!normalizedProducts.has(normalizedCode)) {
      merged.push(profile.code);
      normalizedProducts.add(normalizedCode);
    }
  }

  return merged;
}

/**
 * Fetches catalog from API with fallback to static file.
 * Call once per OCR operation and pass the result downstream.
 */
async function fetchCatalog(): Promise<CatalogData> {
  try {
    const response = await fetch(`/api/catalog?_t=${Date.now()}`);
    if (response.ok) {
      const data = await response.json();
      return {
        products: mergeCatalogedMeasuredProducts(Array.isArray(data.products) ? data.products : []),
        aliases: data.aliases || {},
        blacklist: Array.isArray(data.blacklist) ? data.blacklist : [],
        tubeDimensions: Array.isArray(data.tubeDimensions) ? data.tubeDimensions : [],
        substitutionRules: Array.isArray(data.substitutionRules) ? data.substitutionRules : [],
      };
    }
  } catch (err) {
    console.warn("Could not fetch catalog, using fallback:", err);
  }

  try {
    const catalogModule = await import("../data/catalog.json");
    return {
      products: mergeCatalogedMeasuredProducts(catalogModule.default.products || []),
      aliases: (catalogModule.default as any).aliases || {},
      blacklist: (catalogModule.default as any).blacklist || [],
      tubeDimensions: (catalogModule.default as any).tubeDimensions || [],
      substitutionRules: [],
    };
  } catch {
    return { products: [], aliases: {}, blacklist: [] };
  }
}

/**
 * Parses a single line to extract product code and description.
 * Supports:
 * - Alphanumeric: LG002 - MARCO (prefix: LG)
 * - Numeric: 42032 - DOBRADIÇA (no prefix)
 */
function parseLegacyLine(line: string) {
  // Groups: (1) code | (2) description — stops at '(', '-', or end of line
  const regex = /^([A-Z]{2}-?\d{3,4}|\d{2,3}-\d{2,4}|\d{4,6})\s*[-–]\s*([A-ZÀ-Ú\s]+?)(?:\s*[\(\(]|$|\s*-)/u;
  const match = line.trim().match(regex);

  if (!match) return null;

  const code = match[1].trim();
  const description = match[2].trim();

  const isAlphanumeric = /^[A-Z]{2}\d/.test(code);
  const prefixMatch = isAlphanumeric ? code.match(/^[A-Z]+/) : null;
  const prefix = prefixMatch ? prefixMatch[0] : "";
  const label = prefix ? `${description} ${prefix}` : description;

  return {
    code,
    description,
    label,
    type: isAlphanumeric ? 'alphanumeric' : 'numeric',
  };
}

interface StrictCatalogMatch {
  code: string;
  label: string;
  qtde?: number;
  comprimento?: number;
  acabamento?: string;
  produtoOriginal?: string;
  referenceCode?: string;
  verificadoNoCatalogo?: boolean;
  autoCatalogCandidate?: boolean;
  preserveProductCode?: boolean;
  skipOriginalTextBlacklist?: boolean;
  identificado?: boolean;
}

interface ParsedNumberToken {
  value: number;
  integerLike: boolean;
}

interface ParsedNumberTokenMatch extends ParsedNumberToken {
  index: number;
}

function normalizeLineForStrictParsing(line: string): string {
  return line
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

const STRICT_PRODUCT_CODE_SOURCE = String.raw`(?:\d{1,3}[A-Z]{1,5}\s*-?\s*[A-Z]?\d{1,6}[A-Z]{0,3}|[A-Z]{1,5}\s*-?\s*[A-Z]{1,5}\s*-?\s*\d{1,6}[A-Z]{0,3}|[A-Z]{1,5}\s*-?\s*\d{1,6}[A-Z]{0,3}|\d{2,6}\s*-\s*\d{2,6}[A-Z]{0,2}|\d{4,6}[A-Z]{0,2})`;
const STRICT_LINE_PRODUCT_CODE_REGEX = new RegExp(`^(${STRICT_PRODUCT_CODE_SOURCE})\\b`);
const STRICT_ANY_PRODUCT_CODE_REGEX = new RegExp(`(^|\\s)(${STRICT_PRODUCT_CODE_SOURCE})\\b`);

function isDocumentMetadataLine(normalizedLine: string): boolean {
  return /^(RELACAO|EMITIDO|OBRA|CLIENTE|COR PREDOMINANTE|OBS\.?|PERFIL|TRATAMENTO|QTDE|BARRA|PESO|DATA|ATENCAO|CEM PRO|SUBTOTAL|TOTAL|SISTEMA|RELATORIO|BENEFICIAMENTO|EMPRESA|TOTAIS|PAG|PAGINA|SECAO|MATERIAL|TUBULAR)\b/.test(normalizedLine);
}

function parseNumberToken(raw: string): ParsedNumberToken | null {
  const hasSeparator = /[.,]/.test(raw);

  if (!hasSeparator) {
    const value = Number(raw);
    return Number.isFinite(value) ? { value, integerLike: true } : null;
  }

  const [whole, fraction = ""] = raw.split(/[.,]/);
  const isThousandsLike = fraction.length === 3 && Number(whole) <= 9;
  const value = isThousandsLike
    ? Number(`${whole}${fraction}`)
    : Number(`${whole}.${fraction}`);

  return Number.isFinite(value)
    ? { value, integerLike: isThousandsLike }
    : null;
}

function isLikelyBarLength(value: number): boolean {
  if (!Number.isInteger(value) || value < 2500 || value > 7000) return false;
  return value % 500 === 0 || [5800, 6100, 6200].includes(value);
}

function extractNumberTokens(line: string): ParsedNumberTokenMatch[] {
  return Array.from(line.matchAll(/\d{1,6}(?:[.,]\d{1,3})?/g))
    .map((match): ParsedNumberTokenMatch | null => {
      const token = parseNumberToken(match[0]);
      if (!token) return null;
      const index = match.index ?? 0;
      return {
        ...token,
        index,
      };
    })
    .filter((token): token is ParsedNumberTokenMatch => Boolean(token));
}

function extractQuantityAndLengthFromLine(lineAfterCode: string): { qtde?: number; comprimento?: number } {
  const tokens = extractNumberTokens(lineAfterCode);

  const lengthIndex = tokens.findIndex(token => token.integerLike && isLikelyBarLength(token.value));
  if (lengthIndex <= 0) return {};

  const quantityToken = tokens
    .slice(0, lengthIndex)
    .reverse()
    .find(token =>
      token.integerLike &&
      Number.isInteger(token.value) &&
      token.value > 0 &&
      !isLikelyBarLength(token.value)
    );

  return {
    qtde: quantityToken?.value,
    comprimento: tokens[lengthIndex].value,
  };
}

function extractQuoteQuantityLengthAndTreatment(lineAfterCode: string): { qtde?: number; comprimento?: number; treatment?: string } {
  const tokens = extractNumberTokens(lineAfterCode);
  const lengthIndex = tokens.findIndex(token => token.integerLike && isLikelyBarLength(token.value));
  if (lengthIndex < 0) return {};

  const quantityToken = tokens
    .slice(lengthIndex + 1)
    .find(token =>
      token.integerLike &&
      Number.isInteger(token.value) &&
      token.value > 0 &&
      !isLikelyBarLength(token.value)
    );

  const treatmentSource = lineAfterCode.slice(0, tokens[lengthIndex].index).trim();
  const treatment = extractQuoteTreatmentText(treatmentSource);

  return {
    qtde: quantityToken?.value,
    comprimento: tokens[lengthIndex].value,
    treatment,
  };
}

function extractQuoteTreatmentText(value: string): string | undefined {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return undefined;

  const marker = cleaned.match(/\b(TST\s*-\s*\d{2,6}.*|RAL\s*\d{4}[A-Z]?.*|PRETO\b.*|BRANCO\b.*|NATURAL\b.*|BRUTO\b.*|LINHEIRO\b.*)$/i);
  return (marker?.[1] || cleaned)
    .replace(/\s*-\s*/g, "-")
    .trim();
}

function normalizeAcabamento(value: string): string {
  const normalized = normalizeLineForStrictParsing(value);
  if (!normalized || normalized === "NAO IDENTIFICADO" || normalized === "N/A" || normalized === "NA") return "NT";
  if (["NT", "EPPF", "EBCO", "FOS"].includes(normalized)) return normalized;
  if (/\bEPPF\b/.test(normalized) || /RAL\s*9005|PRETO/.test(normalized)) return "EPPF";
  if (/\bEBCO\b/.test(normalized) || /RAL\s*(9003|9010)|BRANCO/.test(normalized)) return "EBCO";
  if (/\bFOS\b/.test(normalized) || /FOSCO/.test(normalized)) return "FOS";
  if (/\bNT\b/.test(normalized) || /NATURAL|BRUTO|SEM\s+PINTURA/.test(normalized)) return "NT";
  return normalized;
}

function normalizeComprimento(value: unknown): number {
  const numericValue = typeof value === "number"
    ? value
    : Number(String(value ?? "").replace(/\./g, "").replace(",", "."));

  if (!Number.isFinite(numericValue) || numericValue <= 0) return 6000;
  if (numericValue >= 3 && numericValue <= 10) return Math.round(numericValue * 1000);
  return Math.round(numericValue);
}

function mapTreatmentToAcabamento(value: string): string {
  const normalized = normalizeAcabamento(value);
  if (["NT", "EPPF", "EBCO", "FOS"].includes(normalized)) return normalized;
  return "NT";
}

function extractAcabamentoFromLine(line: string): string | null {
  const normalized = normalizeLineForStrictParsing(line);
  const treatmentMatch = normalized.match(/\bTRATAMENTO\s*:\s*(.+)$/);
  if (treatmentMatch) {
    return mapTreatmentToAcabamento(treatmentMatch[1]);
  }
  const beneficiamentoMatch = normalized.match(/\bBENEFICIAMENTO\s+(.+)$/);
  if (beneficiamentoMatch) {
    return mapTreatmentToAcabamento(beneficiamentoMatch[1]);
  }
  return null;
}

function isBarListDocumentText(text: string): boolean {
  const normalized = normalizeLineForStrictParsing(text);
  return /\bRELACAO DE BARRAS\b/.test(normalized) || (
    /\bPERFIL\b/.test(normalized) &&
    /\bTRATAMENTO\b/.test(normalized) &&
    /\bQTDE\b/.test(normalized) &&
    /\bBARRA\b/.test(normalized) &&
    /\bPESO\b/.test(normalized)
  );
}

function isSmartCemBarSummaryDocumentText(text: string): boolean {
  const normalized = normalizeLineForStrictParsing(text);
  return (
    /\bCODIGO\s*:/.test(normalized) &&
    /\bTRATAMENTO\s*:/.test(normalized) &&
    /\bNUMERO DE BARRAS\s*:/.test(normalized) &&
    /\bCOMPRIMENTO DA BARRA\s*:/.test(normalized)
  );
}

function formatSmartCemBarSummaryCode(rawCode: string): string {
  const compact = normalizeLineForStrictParsing(rawCode)
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, "");

  if (!compact) return "";

  if (/[_.]/.test(compact) || /^[A-Z]{2,}-[A-Z]{2,}\d/.test(compact)) {
    return compact;
  }

  return formatRecognizedCatalogCode(compact);
}

function parseSmartCemBarSummaryBlocks(text: string): StrictCatalogMatch[] {
  if (!isSmartCemBarSummaryDocumentText(text)) return [];

  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const matches: StrictCatalogMatch[] = [];
  let current: {
    code: string;
    treatment: string;
    description?: string;
    qtde?: number;
    comprimento?: number;
    sourceLines: string[];
  } | null = null;

  const flushCurrent = () => {
    if (!current?.code || !current.qtde || !current.comprimento) return;

    matches.push({
      code: current.code,
      label: current.description || current.code,
      qtde: current.qtde,
      comprimento: current.comprimento,
      acabamento: normalizeAcabamento(current.treatment || "NT"),
      produtoOriginal: current.sourceLines.join(" | "),
      autoCatalogCandidate: isAutoCatalogableProfileCode(current.code),
      preserveProductCode: true,
      identificado: true,
    });
  };

  for (const line of lines) {
    const normalizedLine = normalizeLineForStrictParsing(line);
    const codeMatch = normalizedLine.match(/^CODIGO\s*:\s*(.+?)\s+TRATAMENTO\s*:\s*(.+)$/);

    if (codeMatch) {
      flushCurrent();
      current = {
        code: formatSmartCemBarSummaryCode(codeMatch[1]),
        treatment: codeMatch[2].trim(),
        sourceLines: [line],
      };
      continue;
    }

    if (!current) continue;

    current.sourceLines.push(line);

    const descriptionMatch = normalizedLine.match(/^SERIE\s*:\s*(.*?)\s+DESCRICAO\s*:\s*(.+)$/);
    if (descriptionMatch) {
      current.description = descriptionMatch[2].trim();
      continue;
    }

    const barsMatch = normalizedLine.match(/^NUMERO DE BARRAS\s*:\s*(\d{1,5})\b/);
    if (barsMatch) {
      const qtde = Number.parseInt(barsMatch[1], 10);
      if (Number.isFinite(qtde) && qtde > 0) current.qtde = qtde;
      continue;
    }

    const lengthMatch = normalizedLine.match(/^COMPRIMENTO DA BARRA\s*:\s*(\d{3,6})\b/);
    if (lengthMatch) {
      const comprimento = Number.parseInt(lengthMatch[1], 10);
      if (Number.isFinite(comprimento) && comprimento > 0) current.comprimento = comprimento;
    }
  }

  flushCurrent();
  return matches;
}

function parseCemOneRomaneioBlocks(text: string): StrictCatalogMatch[] {
  if (!isCemOneRomaneioDocumentText(text)) return [];

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const matches: StrictCatalogMatch[] = [];

  let currentCode: string | null = null;
  let currentTreatmentParts: string[] = [];
  let currentComprimento = 6000;
  let currentSourceLines: string[] = [];

  // Matches codes like 45EC-209, ALG-2017, CL009, ECBG-214, TUB-4526, D-055, VL097
  // Excludes RAL codes (RAL7021 etc.) which are treatment identifiers, not product codes
  const PROFILE_CODE_RE = /^([A-Z0-9]{1,6}-[A-Z0-9]{1,6}|[A-Z]{1,4}\d{2,6}[A-Z]{0,2}|\d{2}[A-Z]{1,4}-\d{3,4})\s/;
  const SKIP_LINE_RE = /^(PERFIL|TRATAMENTO|MEDIDA|PESO|ROMANEIO|EMITIDO|DATA\s+DE|CEM\s+ONE|ATENCAO|ALUMISOFT|DJ\s+ESQUADRIAS|\d{3,6},\d{3})/;

  const mapCemOneTreatment = (parts: string[]): string => {
    const combined = normalizeLineForStrictParsing(parts.join(" "));
    if (/\bNATURAL\b/.test(combined)) return "NT";
    if (/\bFOSCO\b/.test(combined)) return "FOS";
    if (/\bBRANCO\b|RAL\s*(9003|9010)\b/.test(combined)) return "EBCO";
    if (/\bNEGRO\b|RAL\s*(7021|9005|7016|7022|7024)\b/.test(combined)) return "EPPF";
    return "NT";
  };

  const flush = (qtde: number) => {
    if (!currentCode || qtde <= 0) return;
    matches.push({
      code: currentCode,
      label: currentCode,
      qtde,
      comprimento: currentComprimento,
      acabamento: mapCemOneTreatment(currentTreatmentParts),
      produtoOriginal: [currentCode, ...currentSourceLines].join(" | "),
      autoCatalogCandidate: true,
      preserveProductCode: true,
      identificado: true,
    });
    currentCode = null;
    currentTreatmentParts = [];
    currentComprimento = 6000;
    currentSourceLines = [];
  };

  for (const line of lines) {
    const norm = normalizeLineForStrictParsing(line);
    if (!norm || SKIP_LINE_RE.test(norm)) continue;

    // "N BR" can appear anywhere in a line (inline with code OR on its own line)
    const qtdeInLine = norm.match(/\b(\d{1,3})\s+BR\b/);

    // Product code at start — must have both letters and digits, must not be a RAL color code
    const codeMatch = norm.match(PROFILE_CODE_RE);
    const hasCode = !!codeMatch && /[A-Z]/.test(codeMatch[1]) && /\d/.test(codeMatch[1]) && !/^RAL\d/.test(codeMatch[1]);

    if (hasCode && qtdeInLine) {
      // PDF.js row-based format: code + treatment + quantity all on one line
      // e.g. "45EC-209 PINTURA CINZA NEGRO - 2 BR 6000 0,0 4,140 173,88"
      const code = formatRecognizedCatalogCode(codeMatch[1]);
      const qtde = Number.parseInt(qtdeInLine[1], 10);
      const rest = norm.slice(codeMatch[0].length).trim();
      const comprMatch = rest.match(/\b(3000|6000)\b/);
      const comprimento = comprMatch ? Number.parseInt(comprMatch[1], 10) : 6000;
      const qtdePos = rest.indexOf(qtdeInLine[0]);
      const treatmentRaw = (qtdePos >= 0 ? rest.slice(0, qtdePos) : rest)
        .replace(/\s*-\s*$/, "").trim();
      const treatmentParts: string[] = treatmentRaw && /[A-Z]/.test(treatmentRaw) ? [treatmentRaw] : [];
      // Also accumulate any deferred treatment from previous lines (shouldn't happen but safe)
      const allTreatment = [...currentTreatmentParts, ...treatmentParts];
      matches.push({
        code,
        label: code,
        qtde,
        comprimento,
        acabamento: mapCemOneTreatment(allTreatment),
        produtoOriginal: line.trim(),
        autoCatalogCandidate: true,
        preserveProductCode: true,
        identificado: true,
      });
      currentCode = null;
      currentTreatmentParts = [];
      currentComprimento = 6000;
      currentSourceLines = [];
      continue;
    }

    if (qtdeInLine && currentCode) {
      // Quantity found on its own line (or continuation line) while a code is pending
      flush(Number.parseInt(qtdeInLine[1], 10));
      continue;
    }

    if (hasCode) {
      // Code without quantity on same line — accumulate until "N BR" appears
      currentCode = formatRecognizedCatalogCode(codeMatch[1]);
      currentTreatmentParts = [];
      currentComprimento = 6000;
      currentSourceLines = [];
      const rest = norm.slice(codeMatch[0].length).trim();
      if (rest) {
        const comprMatch = rest.match(/\b(3000|6000)\b/);
        if (comprMatch) currentComprimento = Number.parseInt(comprMatch[1], 10);
        const treatmentPart = comprMatch
          ? rest.slice(0, rest.indexOf(comprMatch[0])).replace(/\s*-\s*$/, "").trim()
          : rest.replace(/\s*-\s*$/, "").trim();
        if (treatmentPart && /[A-Z]/.test(treatmentPart)) currentTreatmentParts.push(treatmentPart);
      }
      continue;
    }

    if (!currentCode) continue;

    // RAL color code anywhere in the line → treatment continuation
    const ralInLine = norm.match(/\bRAL\s*\d{4}\b/);
    if (ralInLine) {
      currentTreatmentParts.push(ralInLine[0]);
      currentSourceLines.push(line);
      continue;
    }

    // Treatment keywords at start of line
    if (/^(ANODIZADO|FOSCO|PINTURA|PRETO|BRANCO|NEGRO|NATURAL)\b/.test(norm)) {
      currentTreatmentParts.push(norm);
      currentSourceLines.push(line);
      continue;
    }

    // Numbers-only line: extract comprimento
    if (/^\d{3,4}[\s,]/.test(norm) && !/[A-Z]/.test(norm.slice(0, 5))) {
      const comprMatch = norm.match(/^(3000|6000)\b/);
      if (comprMatch) currentComprimento = Number.parseInt(comprMatch[1], 10);
      currentSourceLines.push(line);
      continue;
    }

    // Other line inside product group (description) — accumulate for produtoOriginal
    currentSourceLines.push(line);
  }

  return matches;
}

function isMaterialsRelationDocumentText(text: string): boolean {
  const normalized = normalizeLineForStrictParsing(text);
  const isClassicMaterialsRelation =
    /\bRELACAO DE MATERIAIS\b/.test(normalized) &&
    /\bPERFIS\b/.test(normalized) &&
    /\bCODIGO\b/.test(normalized) &&
    /\bDESCRICAO\b/.test(normalized) &&
    /\bBARRA\b/.test(normalized) &&
    /\bQTDE\b/.test(normalized) &&
    /\bPESO\s+BRUTO\b/.test(normalized);
  // SmartCEM-Alumisoft "PERFIS" relation (ex: BALCONY): Codigo | Descricao | Trat./Cor | Barra | Qtde.
  // Mesma ordem de colunas (Barra antes de Qtde) da Relacao de Materiais, sem coluna Peso,
  // entao parseMaterialsRelationLine ja extrai corretamente (qtde apos o comprimento).
  const isAlumisoftPerfisRelation =
    /\bSMARTCEM\s*-\s*ALUMISOFT\b/.test(normalized) &&
    /\bPERFIS\b/.test(normalized) &&
    /\bBARRA\b/.test(normalized) &&
    /\bQTDE\b/.test(normalized);
  return isClassicMaterialsRelation || isAlumisoftPerfisRelation;
}

function isBarCalculationDocumentText(text: string): boolean {
  const normalized = normalizeLineForStrictParsing(text);
  return (
    /\bRESUMO DO CALCULO DE BARRAS\b/.test(normalized) ||
    (/\bSECAO\b/.test(normalized) &&
     /\bMATERIAL\b/.test(normalized) &&
     /\bBARRA\b/.test(normalized) &&
     /\bQTDE\b/.test(normalized) &&
     /\bPESO\b/.test(normalized) &&
     /\bTIPO\b/.test(normalized))
  );
}

function isQuantityFirstListText(text: string, catalogProducts?: Set<string>): boolean {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return false;

  let matchCount = 0;
  for (const line of lines) {
    const normalizedLine = normalizeLineForStrictParsing(line);
    if (isDocumentMetadataLine(normalizedLine)) continue;

    const match = normalizedLine.match(/^(\d{1,3})\s+([A-Z]{1,5}-?\d{1,6}[A-Z]{0,3}|[A-Z]{1,5}\d{1,6}[A-Z]{0,3}|[A-Z]{1,5}-\d{1,6}[A-Z]{0,3})(?:\s+|$)/);
    if (match) {
      matchCount++;
      continue;
    }

    const tokens = normalizedLine.split(/\s+/);
    if (tokens.length >= 2 && /^\d{1,3}$/.test(tokens[0])) {
      const potentialCode = normalizeCatalogMatchCode(tokens[1]);
      if (catalogProducts && catalogProducts.has(potentialCode)) {
        matchCount++;
      }
    }
  }

  const activeLines = lines.filter(l => !isDocumentMetadataLine(normalizeLineForStrictParsing(l)));
  if (activeLines.length === 0) return false;
  return matchCount / activeLines.length >= 0.6;
}

function isQuoteDeliveryDocumentText(text: string): boolean {
  const normalized = normalizeLineForStrictParsing(text);
  return (
    /\bCODIGO\b/.test(normalized) &&
    /\bDESCRICAO\b/.test(normalized) &&
    /\bTRATAMENTO\s*\/\s*COR\b/.test(normalized) &&
    /(?:^|\s)COMP\.?(?:\s|$)/.test(normalized) &&
    /\bQTDE\.?\b/.test(normalized) &&
    /\bBARRA\b/.test(normalized) &&
    /\bTOTAL\b/.test(normalized) &&
    /\bKG\b/.test(normalized)
  );
}

function isSujvidrosCotacaoBarrasDocumentText(text: string): boolean {
  const normalized = normalizeLineForStrictParsing(text);
  return /RELATORIO\s+DE\s+COTACAO\s+DE\s+BARRAS/.test(normalized);
}

function isAcecampPurchaseOrderDocumentText(text: string): boolean {
  const normalized = normalizeLineForStrictParsing(text);
  return (
    /\bPEDIDO DE COMPRA\b/.test(normalized) &&
    /\bREFERENCIA\b/.test(normalized) &&
    /\bKG BR\b/.test(normalized)
  );
}

function isNeocaSimulacaoComprasDocumentText(text: string): boolean {
  const normalized = normalizeLineForStrictParsing(text);
  return (
    /\bSIMULACAO DE COMPRAS\b/.test(normalized) &&
    /\bQTDE\.?\s*COMPRAR\b/.test(normalized)
  );
}

function isEcgProductRelationDocumentText(text: string): boolean {
  const normalized = normalizeLineForStrictParsing(text);
  return (
    /\bRELACAO DOS PRODUTOS\b/.test(normalized) &&
    /\bQTD\b/.test(normalized) &&
    !/\bBARRA\s+QTDE\b/.test(normalized)
  );
}

function isCemOneRomaneioDocumentText(text: string): boolean {
  const normalized = normalizeLineForStrictParsing(text);
  return (
    /\bROMANEIO DE PERFIS\b/.test(normalized) &&
    /\bCEM\s+ONE\b/.test(normalized)
  );
}

function parseQuoteDeliveryLine(line: string): StrictCatalogMatch | null {
  const normalizedLine = normalizeLineForStrictParsing(line);
  if (!normalizedLine) return null;

  if (isDocumentMetadataLine(normalizedLine) || /^(COTACAO|HORA|USUARIO|ENTREGA|EMPRESA|ENDERECO|TELEFONE|FAX|CNPJ|IE|CODIGO|DESCRICAO|REFERENCIA|COMP)\b/.test(normalizedLine)) {
    return null;
  }

  const codeMatch = normalizedLine.match(STRICT_LINE_PRODUCT_CODE_REGEX);
  if (!codeMatch) return null;

  const rawCode = codeMatch[1];
  const rest = normalizedLine.slice(rawCode.length).trim();
  const { qtde, comprimento, treatment } = extractQuoteQuantityLengthAndTreatment(rest);
  if (!qtde || !comprimento) return null;

  const code = formatRecognizedCatalogCode(rawCode);

  return {
    code,
    label: code,
    qtde,
    comprimento,
    acabamento: normalizeAcabamento(treatment || "NT"),
    produtoOriginal: line.trim(),
    autoCatalogCandidate: true,
  };
}

function extractMaterialsRelationQuantityAndLength(lineAfterCode: string): { qtde?: number; comprimento?: number; treatment?: string; lengthIndex?: number } {
  const tokens = extractNumberTokens(lineAfterCode);
  const lengthTokenIndex = tokens.findIndex(token => token.integerLike && isLikelyBarLength(token.value));
  if (lengthTokenIndex < 0) return {};

  const lengthToken = tokens[lengthTokenIndex];
  const quantityToken = tokens
    .slice(lengthTokenIndex + 1)
    .find(token =>
      token.integerLike &&
      Number.isInteger(token.value) &&
      token.value > 0 &&
      !isLikelyBarLength(token.value)
    );

  return {
    qtde: quantityToken?.value,
    comprimento: lengthToken.value,
    treatment: lineAfterCode.slice(0, lengthToken.index).trim(),
    lengthIndex: lengthToken.index,
  };
}

function extractMaterialsRelationDescriptionProduct(value: string): string {
  return value
    .replace(/\s+-\s+(?=POR FAVOR|FAVOR|INFORMAR|OBS(?:ERVACAO)?\b).*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseMaterialsRelationLine(line: string): StrictCatalogMatch | null {
  const normalizedLine = normalizeLineForStrictParsing(line);
  if (!normalizedLine) return null;

  if (isDocumentMetadataLine(normalizedLine) && !/^PERFIL\s+/.test(normalizedLine)) {
    return null;
  }

  const codeMatch = normalizedLine.match(STRICT_LINE_PRODUCT_CODE_REGEX);
  if (codeMatch) {
    const rawCode = codeMatch[1];
    const rest = normalizedLine.slice(rawCode.length).trim();
    const { qtde, comprimento, treatment } = extractMaterialsRelationQuantityAndLength(rest);
    if (!qtde || !comprimento) return null;

    const code = formatRecognizedCatalogCode(rawCode);

    return {
      code,
      label: code,
      qtde,
      comprimento,
      acabamento: mapTreatmentToAcabamento(treatment || "NT"),
      produtoOriginal: line.trim(),
      autoCatalogCandidate: isAutoCatalogableProfileCode(code),
      preserveProductCode: true,
      identificado: true,
    };
  }

  const { qtde, comprimento, lengthIndex } = extractMaterialsRelationQuantityAndLength(normalizedLine);
  if (!qtde || !comprimento || lengthIndex === undefined) return null;

  const product = extractMaterialsRelationDescriptionProduct(normalizedLine.slice(0, lengthIndex));
  if (!product || product.length < 3 || !/[A-Z]/.test(product)) return null;

  return {
    code: product,
    label: product,
    qtde,
    comprimento,
    acabamento: "NT",
    produtoOriginal: line.trim(),
    verificadoNoCatalogo: false,
    preserveProductCode: true,
    identificado: false,
  };
}

function parseBarListLine(line: string): StrictCatalogMatch | null {
  const normalizedLine = normalizeLineForStrictParsing(line);
  if (!normalizedLine) return null;

  if (isDocumentMetadataLine(normalizedLine)) {
    return null;
  }

  if (/^[A-Z]{1,4}-P-RAL\d{4}/.test(normalizedLine) || /^SOLIDO-/.test(normalizedLine)) {
    return null;
  }

  const codeMatch = normalizedLine.match(STRICT_LINE_PRODUCT_CODE_REGEX);
  if (!codeMatch) return null;

  const rawCode = codeMatch[1];
  const rest = normalizedLine.slice(rawCode.length).trim();
  const { qtde, comprimento } = extractQuantityAndLengthFromLine(rest);

  if (!qtde || !comprimento) return null;

  const treatment = rest
    .replace(/\b\d{1,5}\s+\d{4,6}\b.*$/, "")
    .replace(/\bPINTURA\b/g, "PINTURA")
    .trim();
  const code = formatRecognizedCatalogCode(rawCode);

  const normalizedMatchCode = normalizeCatalogMatchCode(code);
  const isAutoCandidate = normalizedMatchCode.length >= 2 && normalizedMatchCode.length <= 16 && /[A-Z]/.test(normalizedMatchCode) && !/^\d+$/.test(normalizedMatchCode);

  return {
    code,
    label: code,
    qtde,
    comprimento,
    acabamento: mapTreatmentToAcabamento(treatment),
    produtoOriginal: line.trim(),
    autoCatalogCandidate: isAutoCandidate,
    preserveProductCode: true,
    identificado: true,
  };
}

function parseAluminorteRelacaoBarrasLine(line: string): StrictCatalogMatch | null {
  const parsed = parseBarListLine(line);
  return parsed
    ? { ...parsed, preserveProductCode: true, skipOriginalTextBlacklist: true }
    : null;
}

function parseSujvidrosCotacaoBarrasLine(line: string): StrictCatalogMatch | null {
  const normalizedLine = normalizeLineForStrictParsing(line);
  if (!normalizedLine) return null;
  // Skip separator lines (---) and known SUJVIDROS header patterns
  if (/^-{5,}/.test(normalizedLine)) return null;
  if (/^(SUJVIDROS|RELATORIO|CLIENTE|OBRA|EMISSAO|PAGINA|LEVANTAMENTO)\b/.test(normalizedLine)) return null;
  if (isDocumentMetadataLine(normalizedLine)) return null;

  // Match product code at start of line.
  // Handles: 20SP-F01/20SP-M21 (\d[A-Z]-[A-Z]\d), MONT-6,5 ([A-Z]-\d,\d), CT026/TBR1" ([A-Z]\d)
  // Also handles em-dash spacing: "20SP - M21" after normalizeLineForStrictParsing converts – → -
  const codeMatch = normalizedLine.match(
    /^(\d{1,3}[A-Z]{1,5}\s*-\s*[A-Z]?\d{1,6}|[A-Z]{2,6}-\d{1,2},\d{1,2}|[A-Z]{2,5}\d{1,6}["']?)(?=\s|$)/
  );
  if (!codeMatch) return null;

  const rawCode = codeMatch[1]
    .replace(/\s*-\s*/g, '-')
    .replace(/['"]/g, '')
    .trim();

  // Extract the last two standalone integers from the line.
  // Negative lookahead/lookbehind prevents matching digits inside "6,5" or "1.1/2" fractions.
  const intTokens = [...normalizedLine.matchAll(/(?<![,.])\b(\d{1,6})\b(?![,.])/g)]
    .map(m => parseInt(m[1], 10))
    .filter(v => Number.isFinite(v) && v > 0);

  if (intTokens.length < 2) return null;

  const comprimento = intTokens[intTokens.length - 1];
  const qtde = intTokens[intTokens.length - 2];

  if (!isLikelyBarLength(comprimento) || qtde <= 0) return null;

  return {
    code: rawCode,
    label: rawCode,
    qtde,
    comprimento,
    produtoOriginal: line.trim(),
    autoCatalogCandidate: true,
    preserveProductCode: true,
    identificado: true,
  };
}

function parseAcecampPurchaseOrderLine(line: string): StrictCatalogMatch | null {
  const normalizedLine = normalizeLineForStrictParsing(line);
  if (!normalizedLine) return null;

  // Skip non-product lines
  if (/^(CODIGO|REFERENCIA|DESCRICAO|QTDE|CUSTO|KG|PAGINA|WWW|DATA|HORA|FORNECEDOR|ENDERECO|USUARIO|FORMA DE PAGAMENTO|AUTORIZADO|CONTATO|PEDIDO DE COMPRA|ACECAMP)\b/.test(normalizedLine)) return null;
  // Skip summary line (only numbers, e.g. "380 972,4 34.035,23")
  if (/^\d{2,4}\s+\d+[,.]\d/.test(normalizedLine) && !/[A-Z]/.test(normalizedLine)) return null;

  // Find QTDE: an integer immediately followed by CUSTO (X,XX) then KG_BR (X,XXXX — 4 decimal places).
  // This uniquely identifies the trailing numeric block without matching "1,59" in descriptions.
  const trailingMatch = normalizedLine.match(/\b(\d+)\s+\d+,\d{2}\s+\d+,\d{4}\b/);
  if (!trailingMatch) return null;

  const qtde = parseInt(trailingMatch[1], 10);
  if (qtde <= 0) return null;

  // Everything before the trailing numbers block
  const beforeNums = normalizedLine.slice(0, normalizedLine.indexOf(trailingMatch[0])).trim();

  // CÓDIGO ends with a treatment suffix (NAT/EBCO/EPPF/FOS) preceded by hyphen or space
  const codigoSuffixMatch = beforeNums.match(/(?:[-\s])(NAT|EBCO|EPPF|FOS)\s+/);
  if (!codigoSuffixMatch) return null;

  const treatmentSuffix = codigoSuffixMatch[1];
  const acabamento = treatmentSuffix === 'EBCO' ? 'EBCO'
    : treatmentSuffix === 'EPPF' ? 'EPPF'
    : treatmentSuffix === 'FOS' ? 'FOS'
    : 'NT';

  const codigoSuffixEnd = beforeNums.indexOf(codigoSuffixMatch[0]) + codigoSuffixMatch[0].length;
  const afterCodigo = beforeNums.slice(codigoSuffixEnd).trim();

  // REFERENCIA: first compact code token before description
  const refMatch = afterCodigo.match(/^([A-Z0-9][A-Z0-9\-]*)/);
  if (!refMatch) return null;

  const code = refMatch[1];
  // Reject pure description keywords
  if (/^(PERFIL|BARRA|CHATA|TUBO|ALUMINIO|SOLIDO|TUBULAR|NATURAL|REDONDO|AUTORIZADO)$/.test(code)) return null;

  return {
    code,
    label: code,
    qtde,
    comprimento: 6000,
    acabamento,
    produtoOriginal: line.trim(),
    autoCatalogCandidate: true,
    preserveProductCode: true,
    identificado: true,
  };
}

function parseNeocaSimulacaoComprasLine(line: string): StrictCatalogMatch | null {
  const normalizedLine = normalizeLineForStrictParsing(line);
  if (!normalizedLine) return null;

  // Skip header / metadata lines
  if (/^(CODIGO|DESCRICAO|COR|UN|QTDE|SIMULACAO|DESCRICAO:|RELATORIO|EMITIDO|EMISSAO|PAGINA|NEOCA)\b/.test(normalizedLine)) return null;
  if (/\bRELATORIO DE ITENS\b/.test(normalizedLine) || /\bSIMULACAO NRO\b/.test(normalizedLine)) return null;

  // Qtde.Comprar is the trailing "N,NNN" token (integer scaled by 1000): "2,000" -> 2, "18,000" -> 18.
  const qtyMatch = normalizedLine.match(/\b(\d{1,4}),(\d{3})\s*$/);
  if (!qtyMatch) return null;
  const qtde = Number.parseInt(qtyMatch[1], 10);
  if (!Number.isFinite(qtde) || qtde <= 0) return null;

  // Everything before the quantity token holds: CODIGO DESCRICAO COR UN
  const beforeQty = normalizedLine.slice(0, qtyMatch.index).trim();

  // CODIGO is the first token. It may carry an alternate reference in parentheses, e.g. "25-548 (L-715)".
  const codeMatch = beforeQty.match(/^([A-Z0-9][A-Z0-9-]*)/);
  if (!codeMatch) return null;
  const code = formatRecognizedCatalogCode(codeMatch[1]);
  if (!code) return null;

  // Cor + UN sit at the end of beforeQty (e.g. "PRETO BR"). Use them for acabamento; UN (BR) is ignored.
  const acabamento = mapTreatmentToAcabamento(beforeQty);

  return {
    code,
    label: code,
    qtde,
    comprimento: 6000,
    acabamento,
    produtoOriginal: line.trim(),
    autoCatalogCandidate: true,
    preserveProductCode: true,
    identificado: true,
  };
}

function parseEcgProductRelationLine(line: string): StrictCatalogMatch | null {
  const normalizedLine = normalizeLineForStrictParsing(line);
  if (!normalizedLine) return null;

  // Skip header / metadata / contact lines
  if (/^(CODIGO|DESCRICAO|QTD|PERFIL|RELACAO|ECG|ATACADAO|CLIENTE|ORCAMENTO|DATA|CNPJ|CEL|WWW|ESQUADRIAS|RUA|MG\b)/.test(normalizedLine)) return null;

  // CODIGO is the first column (first whitespace-delimited token). In this layout the
  // first token is always the product code, so we read it directly instead of relying on
  // the shared code regex — that lets us keep dimensional tube codes like "TB38X76".
  const firstTokenMatch = normalizedLine.match(/^([A-Z0-9][A-Z0-9"'./-]*)\s+(.+)$/);
  if (!firstTokenMatch) return null;
  const rawCode = firstTokenMatch[1];
  const rest = firstTokenMatch[2].trim();

  // The code must contain a digit and be a plausible length. Pure-numeric codes (ex: 25540)
  // must be 4-6 digits to avoid grabbing stray small numbers from non-product lines.
  if (!/\d/.test(rawCode) || rawCode.length < 3 || rawCode.length > 14) return null;
  if (/^\d+$/.test(rawCode) && !/^\d{4,6}$/.test(rawCode)) return null;

  // Qtd (barras) is the LAST standalone integer on the line. Numbers inside the
  // description (ex: "3 A 6 MM", "38 X 76", "LINHA 25") come before it and are ignored.
  const intTokens = [...rest.matchAll(/(?<![,.\d])(\d{1,4})(?![,.\d])/g)]
    .map(m => Number.parseInt(m[1], 10))
    .filter(v => Number.isFinite(v) && v > 0);
  if (intTokens.length === 0) return null;
  const qtde = intTokens[intTokens.length - 1];
  if (qtde <= 0) return null;

  const code = formatRecognizedCatalogCode(rawCode);
  const normalizedMatchCode = normalizeCatalogMatchCode(code);
  const isAutoCandidate = normalizedMatchCode.length >= 2 && normalizedMatchCode.length <= 16;

  return {
    code,
    label: code,
    qtde,
    comprimento: 6000,
    acabamento: "NT",
    produtoOriginal: line.trim(),
    autoCatalogCandidate: isAutoCandidate,
    preserveProductCode: true,
    identificado: true,
  };
}

function extractBarCalculationQuantityAndLength(lineAfterCode: string): { qtde?: number; comprimento?: number } {
  const tokens = extractNumberTokens(lineAfterCode);
  const lengthTokenIndex = tokens.findIndex(token => token.integerLike && isLikelyBarLength(token.value));
  if (lengthTokenIndex < 0) return {};

  const lengthToken = tokens[lengthTokenIndex];
  const quantityToken = tokens
    .slice(lengthTokenIndex + 1)
    .find(token =>
      token.integerLike &&
      Number.isInteger(token.value) &&
      token.value > 0 &&
      !isLikelyBarLength(token.value)
    );

  return {
    qtde: quantityToken?.value,
    comprimento: lengthToken.value,
  };
}

function parseBarCalculationLine(line: string): StrictCatalogMatch | null {
  const normalizedLine = normalizeLineForStrictParsing(line);
  if (!normalizedLine) return null;

  if (isDocumentMetadataLine(normalizedLine)) {
    return null;
  }

  if (/^(PESO|TOTAIS|TUBULAR|SOLIDO)\b/.test(normalizedLine)) {
    return null;
  }

  const codeMatch = normalizedLine.match(STRICT_LINE_PRODUCT_CODE_REGEX);
  if (!codeMatch) return null;

  const rawCode = codeMatch[1];
  const rest = normalizedLine.slice(rawCode.length).trim();
  const { qtde, comprimento } = extractBarCalculationQuantityAndLength(rest);

  if (!comprimento) return null;

  const code = formatRecognizedCatalogCode(rawCode);
  const normalizedMatchCode = normalizeCatalogMatchCode(code);
  const isAutoCandidate = normalizedMatchCode.length >= 2 && normalizedMatchCode.length <= 16 && /[A-Z]/.test(normalizedMatchCode) && !/^\d+$/.test(normalizedMatchCode);

  return {
    code,
    label: code,
    qtde: qtde ?? 1,
    comprimento,
    produtoOriginal: line.trim(),
    autoCatalogCandidate: isAutoCandidate,
    preserveProductCode: true,
    identificado: true,
  };
}

function extractBudgetQuantity(normalizedLine: string): number | undefined {
  const unitQuantity = normalizedLine.match(/\bUN\b\s+(\d{1,5})(?=\s+\d+[,.]\d+)/);
  if (unitQuantity) {
    const quantity = Number.parseInt(unitQuantity[1], 10);
    return Number.isFinite(quantity) && quantity > 0 ? quantity : undefined;
  }

  const unitIndex = normalizedLine.lastIndexOf(" UN ");
  if (unitIndex < 0) return undefined;

  const afterUnit = normalizedLine.slice(unitIndex + 4);
  const firstInteger = afterUnit.match(/\b(\d{1,5})\b/);
  if (!firstInteger) return undefined;

  const quantity = Number.parseInt(firstInteger[1], 10);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : undefined;
}

function extractBudgetProfileCode(descriptionAfterPerfil: string): string | null {
  const codeSegment = descriptionAfterPerfil
    .replace(/\bUN\b.*$/, "")
    .split(/\s+-\s+/)[0]
    .trim();
  if (!codeSegment) return null;

  const spacedCode = codeSegment.match(/^([A-Z]{1,5})\s+(\d{1,6}[A-Z]{0,3})\b/);
  if (spacedCode) return formatRecognizedCatalogCode(`${spacedCode[1]}${spacedCode[2]}`);

  const compactCode = codeSegment.match(/^([A-Z]{1,5}\d{1,6}[A-Z]{0,3})\b/);
  if (compactCode) return formatRecognizedCatalogCode(compactCode[1]);

  const jSlimCode = codeSegment.match(/^(J\s+SLIM)\b/);
  if (jSlimCode) return formatRecognizedCatalogCode(jSlimCode[1]);

  const stopTokens = new Set([
    "ACET",
    "ANOD",
    "BC",
    "BR",
    "BRANCO",
    "CR",
    "EBCO",
    "EPPF",
    "FOS",
    "NAT",
    "NATURAL",
    "PRETO",
  ]);

  const codeTokens: string[] = [];
  for (const token of codeSegment.split(/\s+/)) {
    const cleanedToken = token.replace(/[.,;:]+$/g, "");
    if (!cleanedToken || stopTokens.has(cleanedToken) || /^RAL\d{4}[A-Z]?$/.test(cleanedToken)) break;
    codeTokens.push(cleanedToken);
  }

  if (!codeTokens.length) return null;
  return formatRecognizedCatalogCode(codeTokens.join(" "));
}

function parseBudgetProfileSource(line: string, requireReferenceCode: boolean): StrictCatalogMatch | null {
  const normalizedLine = normalizeLineForStrictParsing(line);
  const match = normalizedLine.match(requireReferenceCode
    ? /^(\d{3,6})\s+PERFIL\s+(.+)$/
    : /^(?:(\d{3,6})\s+)?PERFIL\s+(.+)$/
  );
  if (!match) return null;

  const code = extractBudgetProfileCode(match[2]);
  if (!code || /^\d+$/.test(normalizeCatalogMatchCode(code))) return null;

  return {
    code,
    label: code,
    qtde: extractBudgetQuantity(normalizedLine),
    comprimento: 6000,
    acabamento: "NT",
    produtoOriginal: line.trim(),
    referenceCode: match[1],
    autoCatalogCandidate: true,
  };
}

function parseBudgetDescriptionLine(line: string): StrictCatalogMatch | null {
  return parseBudgetProfileSource(line, true);
}

/**
 * Parses a single order/catalog line to extract a product code and, when present,
 * the quantity from tables such as "Perfil ... Qtde Tamanho".
 */
function parseQuantityFirstListLine(line: string): StrictCatalogMatch | null {
  const normalizedLine = normalizeLineForStrictParsing(line);
  if (!normalizedLine) return null;

  if (isDocumentMetadataLine(normalizedLine)) {
    return null;
  }

  const match = normalizedLine.match(/^(\d{1,3})\s+([A-Z]{1,5}-?\d{1,6}[A-Z]{0,3}|[A-Z]{1,5}\d{1,6}[A-Z]{0,3}|[A-Z]{1,5}-\d{1,6}[A-Z]{0,3})(?:\s+(.*))?$/);
  if (!match) return null;

  const qtde = Number.parseInt(match[1], 10);
  const rawCode = match[2];
  const rest = match[3] || "";
  const code = formatRecognizedCatalogCode(rawCode);

  let comprimento = 6000;
  const tokens = extractNumberTokens(rest);
  const lengthToken = tokens.find(token => token.integerLike && isLikelyBarLength(token.value));
  if (lengthToken) {
    comprimento = lengthToken.value;
  }

  const acabamento = mapTreatmentToAcabamento(rest);

  return {
    code,
    label: code,
    qtde,
    comprimento,
    acabamento,
    produtoOriginal: line.trim(),
    autoCatalogCandidate: isAutoCatalogableProfileCode(code),
  };
}

function parseProductVariantTableText(text: string): StrictCatalogMatch[] {
  const normalizedText = normalizeLineForStrictParsing(text);
  if (
    !/\bPRODUTO\b/.test(normalizedText) ||
    !/\bVARIANTE DO PRODUTO\b/.test(normalizedText) ||
    !/\bQUANTIDADE\b/.test(normalizedText)
  ) {
    return [];
  }

  const codeSource = String.raw`(?:[A-Z]{1,5}-?\d{2,6}[A-Z]{0,3}|\d{4,6})`;
  const rowRegex = new RegExp(
    String.raw`(?:^|\s)(${codeSource})\s*-\s*(.+?)\s+((?:PRETO|BRANCO|NATURAL|BRUTO|FOSCO|ANODIZADO|METAL)[A-Z0-9\s./-]*?\/\s*(\d{3,5})\s*MM)\s+([A-Z]*RAL\s*\d{4}[A-Z]?|RAL\s*\d{4}[A-Z]?|[A-Z0-9-]+)\s+(\d{1,5})\s+BR\b`,
    "g"
  );
  const matches: StrictCatalogMatch[] = [];

  for (const match of normalizedText.matchAll(rowRegex)) {
    const rawCode = match[1];
    const description = match[2].trim();
    const variant = match[3].trim();
    const length = Number.parseInt(match[4], 10);
    const specification = match[5].trim();
    const quantity = Number.parseInt(match[6], 10);
    const code = formatRecognizedCatalogCode(rawCode);

    if (!code || !Number.isFinite(quantity) || quantity <= 0) continue;

    matches.push({
      code,
      label: code,
      qtde: quantity,
      comprimento: Number.isFinite(length) && length > 0 ? length : 6000,
      acabamento: normalizeAcabamento(`${specification} ${variant}`),
      produtoOriginal: `${rawCode} - ${description}`,
      autoCatalogCandidate: isAutoCatalogableProfileCode(code),
    });
  }

  return matches;
}

function parseLine(line: string): StrictCatalogMatch | null {
  const normalizedLine = normalizeLineForStrictParsing(line);
  if (!normalizedLine) return null;
  if (isDocumentMetadataLine(normalizedLine)) return null;

  const budgetDescriptionMatch = parseBudgetDescriptionLine(line);
  if (budgetDescriptionMatch) return budgetDescriptionMatch;

  const handwrittenMatch = normalizedLine.match(/^\d{1,3}\s*-\s*([A-Z]{1,5}\s*-?\s*[A-Z]\d{1,4}[A-Z]{0,2}|[A-Z]{1,5}\s*-?\s*\d{2,6}[A-Z]{0,3})\s*-\s*(\d{1,4})\b/);
  if (handwrittenMatch) {
    const quantity = Number.parseInt(handwrittenMatch[2], 10);
    const code = formatRecognizedCatalogCode(handwrittenMatch[1]);
    return {
      code,
      label: code,
      qtde: Number.isFinite(quantity) && quantity > 0 ? quantity : undefined,
    };
  }

  const codeMatch = normalizedLine.match(STRICT_ANY_PRODUCT_CODE_REGEX);
  if (!codeMatch) return null;

  const rawCode = codeMatch[2];
  const code = formatRecognizedCatalogCode(rawCode);
  const codeStart = codeMatch.index || 0;
  const prefix = normalizedLine.slice(0, codeStart).trim();
  const restStart = codeStart + codeMatch[1].length + rawCode.length;
  const rest = normalizedLine.slice(restStart).replace(/^\s*-\s*/, "").trim();
  
  let { qtde, comprimento } = extractQuantityAndLengthFromLine(rest);

  if (qtde === undefined && prefix.length > 0) {
    const prefixQuantityMatch = prefix.match(/^(\d{1,4})\s*[:=\-]?\s*$/);
    if (prefixQuantityMatch) {
      const parsedQty = Number.parseInt(prefixQuantityMatch[1], 10);
      if (Number.isFinite(parsedQty) && parsedQty > 0) {
        qtde = parsedQty;
      }
    }
  }

  if (qtde === undefined) {
    const cleanedRest = rest.replace(/RAL\s*\d{4}[A-Z]{0,2}/gi, "");
    const tokens = extractNumberTokens(cleanedRest);
    let foundQtde: number | undefined = undefined;
    let foundLength: number | undefined = undefined;

    for (const token of tokens) {
      const slice = cleanedRest.slice(token.index);
      const isMeterLength = /^\d+(?:[.,]\d+)?\s*(M\b|MT\b|MTS\b|METRO|METROS)/i.test(slice);
      
      if (isMeterLength) {
        foundLength = Math.round(token.value * 1000);
      } else if (token.integerLike && isLikelyBarLength(token.value)) {
        foundLength = token.value;
      } else if (token.integerLike && Number.isInteger(token.value) && token.value > 0) {
        if (foundQtde === undefined) {
          foundQtde = token.value;
        }
      }
    }
    if (foundQtde !== undefined) {
      qtde = foundQtde;
    }
    if (foundLength !== undefined) {
      comprimento = foundLength;
    }
  }

  let description = rest
    .replace(/\b\d{1,6}(?:[.,]\d{1,3})?.*$/, "")
    .replace(/\s*[\(\[].*$/, "")
    .trim();
  if (/^[^\w\s]+$/u.test(description)) {
    description = "";
  }
  const prefixMatch = normalizeCatalogMatchCode(code).match(/^[A-Z]+/);
  const label = description
    ? `${description}${prefixMatch ? ` ${prefixMatch[0]}` : ""}`
    : code;

  const normalizedMatchCode = normalizeCatalogMatchCode(code);
  const isAutoCandidate = normalizedMatchCode.length >= 2 && normalizedMatchCode.length <= 16 && /[A-Z]/.test(normalizedMatchCode) && !/^\d+$/.test(normalizedMatchCode);

  return {
    code,
    label,
    qtde,
    comprimento,
    produtoOriginal: line.trim(),
    autoCatalogCandidate: isAutoCandidate,
  };
}

/**
 * Strict parser: matches lines against catalog to extract verified product codes.
 * Accepts pre-fetched catalog to avoid redundant API calls.
 */
export async function processTextWithStrictCatalog(
  text: string,
  catalog?: CatalogData,
  quantityColumnIndex?: number
): Promise<StrictCatalogMatch[]> {
  const rawLines = text.split('\n');
  const foundCodes: StrictCatalogMatch[] = [];
  let currentAcabamento = "NT";
  const isQuoteDeliveryDocument = isQuoteDeliveryDocumentText(text);
  const isMaterialsRelationDocument = isMaterialsRelationDocumentText(text);
  const isSmartCemBarSummaryDocument = isSmartCemBarSummaryDocumentText(text);
  const isAluminorteBarrasDocument = isAluminorteRelacaoBarrasDocumentText(text);
  const isBarListDocument = !isAluminorteBarrasDocument && isBarListDocumentText(text);
  const isBarCalculationDocument = isBarCalculationDocumentText(text);
  const isSujvidrosCotacaoBarrasDocument = isSujvidrosCotacaoBarrasDocumentText(text);
  const isAcecampPurchaseOrderDocument = isAcecampPurchaseOrderDocumentText(text);
  const isNeocaSimulacaoComprasDocument = isNeocaSimulacaoComprasDocumentText(text);
  const isEcgProductRelationDocument = isEcgProductRelationDocumentText(text);
  const isCemOneRomaneioDocument = isCemOneRomaneioDocumentText(text);

  const catalogData = catalog || await fetchCatalog();
  const normalizedCatalog = buildCatalogCodeSet(catalogData.products);
  const normalizedBlacklist = buildCatalogCodeSet(catalogData.blacklist || []);
  const isQuantityFirstList = isQuantityFirstListText(text, normalizedCatalog);
  const productVariantItems = parseProductVariantTableText(text);
  const smartCemBarSummaryItems = isSmartCemBarSummaryDocument
    ? parseSmartCemBarSummaryBlocks(text)
    : [];
  const cemOneRomaneioItems = isCemOneRomaneioDocument
    ? parseCemOneRomaneioBlocks(text)
    : [];

  if (productVariantItems.length > 0) {
    return productVariantItems
      .filter(parsed => {
        const normalizedCode = normalizeCatalogMatchCode(parsed.code);
        return !Array.from(normalizedBlacklist).some(b => b !== "" && normalizedCode.includes(b));
      })
      .map(parsed => {
        const normalizedCode = normalizeCatalogMatchCode(parsed.code);
        const isCatalogCode = normalizedCatalog.has(normalizedCode);
        return {
          ...parsed,
          verificadoNoCatalogo: isCatalogCode,
          autoCatalogCandidate: parsed.autoCatalogCandidate && !isCatalogCode,
        };
      });
  }

  if (smartCemBarSummaryItems.length > 0) {
    return smartCemBarSummaryItems
      .filter(parsed => {
        const normalizedCode = normalizeCatalogMatchCode(parsed.code);
        return !Array.from(normalizedBlacklist).some(b => b !== "" && normalizedCode.includes(b));
      })
      .map(parsed => {
        const normalizedCode = normalizeCatalogMatchCode(parsed.code);
        const isCatalogCode = normalizedCatalog.has(normalizedCode);
        return {
          ...parsed,
          verificadoNoCatalogo: isCatalogCode,
          autoCatalogCandidate: parsed.autoCatalogCandidate && !isCatalogCode,
        };
      });
  }

  if (cemOneRomaneioItems.length > 0) {
    return cemOneRomaneioItems
      .filter(parsed => {
        const normalizedCode = normalizeCatalogMatchCode(parsed.code);
        return !Array.from(normalizedBlacklist).some(b => b !== "" && normalizedCode.includes(b));
      })
      .map(parsed => {
        const normalizedCode = normalizeCatalogMatchCode(parsed.code);
        const isCatalogCode = normalizedCatalog.has(normalizedCode);
        return {
          ...parsed,
          verificadoNoCatalogo: isCatalogCode,
          autoCatalogCandidate: parsed.autoCatalogCandidate && !isCatalogCode,
        };
      });
  }

  for (const line of rawLines) {
    const acabamento = extractAcabamentoFromLine(line);
    if (acabamento) {
      currentAcabamento = acabamento;
      continue;
    }

    const parsed = isQuoteDeliveryDocument
      ? parseQuoteDeliveryLine(line)
      : isMaterialsRelationDocument
        ? parseMaterialsRelationLine(line)
        : isAluminorteBarrasDocument
          ? parseAluminorteRelacaoBarrasLine(line)
          : isBarListDocument
            ? parseBarListLine(line)
            : isBarCalculationDocument
              ? parseBarCalculationLine(line)
              : isSujvidrosCotacaoBarrasDocument
                ? parseSujvidrosCotacaoBarrasLine(line)
                : isAcecampPurchaseOrderDocument
                  ? parseAcecampPurchaseOrderLine(line)
                  : isNeocaSimulacaoComprasDocument
                    ? parseNeocaSimulacaoComprasLine(line)
                  : isEcgProductRelationDocument
                    ? parseEcgProductRelationLine(line)
                  : isQuantityFirstList
                  ? parseQuantityFirstListLine(line)
                  : parseLine(line);
    if (!parsed) continue;

    if (quantityColumnIndex !== undefined) {
      const tokens = line.trim().split(/\s+/);
      const qtyToken = tokens[quantityColumnIndex];
      if (qtyToken) {
        const cleanQtyToken = qtyToken.replace(/[^\d]/g, "");
        const parsedQty = Number.parseInt(cleanQtyToken, 10);
        if (Number.isFinite(parsedQty) && parsedQty > 0) {
          parsed.qtde = parsedQty;
        }
      }
    }

    const normalizedCode = normalizeCatalogMatchCode(parsed.code);
    if (["VZP001", "VZC001", "VZC002", "002"].includes(normalizedCode)) continue;
    if (Array.from(normalizedBlacklist).some(b => b !== "" && normalizedCode.includes(b))) continue;
    const isCatalogCode = normalizedCatalog.has(normalizedCode);
    if (!isCatalogCode && !parsed.autoCatalogCandidate && !parsed.preserveProductCode) continue;

    foundCodes.push({
      ...parsed,
      produtoOriginal: parsed.produtoOriginal || line.trim(),
      acabamento: parsed.acabamento || currentAcabamento,
      verificadoNoCatalogo: isCatalogCode,
      autoCatalogCandidate: parsed.autoCatalogCandidate && !isCatalogCode,
    });
  }

  return foundCodes;
}

const SYSTEM_PROMPT = `
REGRA ABSOLUTA - DOCUMENTO COMPLETO ANTES DO PREVIEW:
- O OCR deve percorrer TODO o documento antes de retornar o resultado para preview.
- Se o arquivo tiver 4 paginas, as 4 paginas devem ser lidas em ordem; se tiver 10 paginas, as 10 devem ser lidas em ordem.
- Nunca trate apenas as primeiras paginas como suficientes. Nunca finalize a extracao enquanto houver pagina do documento sem leitura.
- Em PDF com multiplas paginas, cada pagina deve ser processada e seus itens devem ser acumulados mantendo a ordem original do documento.

REGRA CRITICA PARA LINHAS MANUSCRITAS COM ITEM-CODIGO-QTDE:
- Quando uma linha estiver no formato "06-LG047-01", "07-LG002-02" ou "13-LG061-25", o primeiro numero e apenas o numero do item e deve ser ignorado; o meio e o produto; o ultimo numero e a quantidade.
- Exemplos corretos: "06-LG047-01" -> produto "LG047", qtde 1; "07-LG002-02" -> produto "LG002", qtde 2; "13-LG061-25" -> produto "LG061", qtde 25.
- NUNCA junte a quantidade ao produto. "LG047-01" esta errado como produto; o correto e produto "LG047" e qtde 1.

REGRA CRITICA PARA LINHAS MANUSCRITAS COM CÓDIGO E QUANTIDADE (Ex: "SU-093 = B(4)"):
- Se encontrar formatos como "CÓDIGO = B(QUANTIDADE)" ou "CÓDIGO = B QUANTIDADE", onde "B" pode significar barra(s), extraia a quantidade numérica que está entre os parênteses ou logo após.
- Exemplo: "SU-093 = B(4)" -> produto "SU-093", qtde 4.
- Exemplo: "SU-100 = B(10)" -> produto "SU-100", qtde 10.
- Ignore letras extras usadas para quantificar, como "B", focando apenas no número.

REGRA CRITICA PARA ORCAMENTOS COM CODIGO NUMERICO E DESCRICAO:
- Em tabelas com cabecalhos como "Codigo", "Descricao", "Estoque Disp", "UN", "Quantidade Orcamento", "Peso Unitario" e "Peso Total", se a descricao comecar com "PERFIL", o produto verdadeiro esta dentro da descricao, nao na coluna numerica "Codigo".
- Ignore codigos puramente numericos como "8014", "8019" ou "8006" quando a mesma linha tiver uma descricao "PERFIL ...".
- Ignore o valor da coluna "Estoque Disp" (geralmente um numero antes do "UN"). A quantidade correta é o numero APOS o "UN" (na coluna "Quantidade Orcamento").
- Exemplos corretos: "8014 PERFIL SU 111 CR - PERFIL MONTANTE ... 0 UN 37 3,0000 111,0000" -> produto "SU111", qtde 37; "6949 PERFIL PC 004 CR - TUBO ... 2 UN 75 3,6960 277,2000" -> produto "PC004", qtde 75; "6947 PERFIL ALG 72 CR - GUARDA CORPO ... 10 UN 67 ..." -> produto "ALG72", qtde 67.
- Remova espacos internos no codigo do perfil lido na descricao: "SU 111" vira "SU111"; "PC 004" vira "PC004"; "J SLIM" vira "JSLIM".
- Nesses casos, preencha "produtoOriginal" com a descricao ou linha original usada para extrair o perfil.

REGRA CRITICA PARA TABELAS COM PERFIL/QTDE:
- Em tabelas com cabecalhos como "Perfil", "Qtde", "Tamanho", "Barra", "Peso(KG)" ou "Sobra(KG)", use o valor da coluna "Perfil" como produto e o valor da coluna "Qtde" como quantidade.
- Atenção: No layout "Relação de Barras", o código na coluna "Perfil" pode ser puramente numérico (ex: 25548). Extraia-o fielmente.
- Exemplo: "CM200 CONTRAMARCO CM 5054 6000 6004.152 278.639" -> produto "CM200", qtde 5054, comprimento 6000. O peso e a sobra devem ser ignorados.
- Compare o produto com o catalogo ignorando apenas hifens e espacos. Se o documento mostra "SU010" e o catalogo tem "SU-010", considere como codigo valido e mantenha "SU010".

REGRA CRITICA PARA RELACAO DE MATERIAIS:
- Em relatorios "Relacao de Materiais" / "PERFIS" com colunas "Codigo", "Descricao", "Tratamento / Cor", "Barra", "Qtde" e "Peso Bruto", a coluna "Barra" vem ANTES da coluna "Qtde".
- A quantidade correta e o primeiro inteiro depois do comprimento da barra. Numeros dentro da descricao, como "CORRER 2", "CORRER 3", "2 PLANOS", "A 40,00" ou "E 3,00", nunca sao quantidade.
- Exemplo: "SU001 MARCO SUPERIOR / CORRER 2 6000 6 27,432" -> produto "SU001", qtde 6, comprimento 6000.

REGRA CRITICA PARA COTACAO COM TRATAMENTO/COR:
- Em tabelas com cabecalhos "CODIGO/DESCRICAO", "REFERENCIA", "TRATAMENTO/COR", "COMP.", "QTDE.", "BARRA(KG)" e "TOTAL(KG)", a coluna "TRATAMENTO/COR" e cor/acabamento, NUNCA quantidade.
- Codigos dentro do tratamento/cor, como "TST-0320 LINHEIRO", "RAL9005" ou nomes de cor, devem preencher acabamento. O numero 0320 de "TST-0320" nunca e qtde.
- A quantidade correta vem exclusivamente da coluna "QTDE.", geralmente depois de "COMP.". "COMP." e comprimento (ex: 6.000 = 6000). "BARRA(KG)" e "TOTAL(KG)" sao pesos e devem ser ignorados.

REGRA PARA PERFIS TABELADOS POR MEDIDA:
- Se o documento descrever barras por tipo e medida (mesmo usando abreviações e erros de digitação), como "tubo quadrado 50x50", "tub 50", "barra chata 50x3", "bar 50x3", "cantoneira 50x50", "cant 50x50", "perfil U 3/4" ou "perf T 1", trate a descrição (incluindo a abreviação) como produto.
- Preservar a abreviação + medida é fundamental para o sistema mapear no catálogo dimensional.
- Exemplo: "cant 50x50" corresponde à cantoneira. Extraia "CANT 50X50" no campo produto.
- Para esses casos, o campo produto pode ser a descrição completa quando o código não estiver escrito no documento.

REGRA CRITICA PARA LISTAS COM QUANTIDADE ANTES DO CÓDIGO:
- Se a linha começar com um número isolado, seguido imediatamente pelo código do produto (Ex: "09 CM-060", "02 TUB-4054", "18 RP-020"), o PRIMEIRO NÚMERO é a quantidade.
- Exemplo: "18 RP-020" -> produto "RP-020", qtde 18.
- Nesses casos, o número que vem antes do código NUNCA é o item/linha, e sim a quantidade desejada. Use-o como 'qtde'.

REGRA PARA ITENS DESCRITIVOS SEM CÓDIGO ALFANUMÉRICO:
- Se uma linha contiver apenas uma descrição de produto (ex: "LAMBRIL DUPLO", "ARREMATE", "LAMGRIL DUPO") sem nenhum código alfanumérico associado, extraia essa descrição EXATAMENTE como está escrita para o campo 'produto'.
- Nunca ignore uma linha apenas porque ela não possui um formato de código padrão (a menos que seja apenas uma cor, como BRANCO ou RAL9005). Muitas vezes essas descrições existem no dicionário de substituição.

Você é um especialista em leitura de documentos de pedidos de perfis de alumínio.
Sua tarefa é extrair informações de tabelas ou listas no documento.

ATENÇÃO - ORDEM DE LEITURA (MUITO IMPORTANTE):
Mantenha A ORDEM EXATA DOS ITENS conforme aparecem no documento, lendo estritamente de cima para baixo, linha por linha.
Isso é CRUCIAL para não misturar os pedidos.

REGRA ABSOLUTA — FIDELIDADE AO CÓDIGO DO PRODUTO:
O campo 'produto' deve conter o código EXATAMENTE como aparece escrito no documento, sem nenhuma alteração.
- Se o documento mostra "30-023", retorne "30-023". NÃO retorne "MN023" nem "MN-023".
- Se o documento mostra "BG-010", retorne "BG-010". NÃO retorne "CL010" nem qualquer variação.
- Mantenha traços, pontos e qualquer separador que existir no código original.
- NUNCA troque um prefixo numérico por um prefixo alfabético (ex: "30-" NÃO vira "MN-").
- NUNCA invente ou "corrija" um código para algo que pareça mais familiar. Copie fielmente o que está escrito.
- Quando houver uma coluna "CÓDIGO" ou similar, use APENAS o valor dessa coluna como produto, exceto no layout "Codigo/Descricao/UN/Quantidade Orcamento" em que a coluna "Codigo" e puramente numerica e a descricao comeca com "PERFIL"; nesse caso use o perfil dentro da descricao.

ATENÇÃO - DISTINÇÃO DE DADOS:
1. CABEÇALHO/METADADOS: Códigos como "SA-P-RAL..." ou descrições no topo da página geralmente são metadados de pintura/tratamento e NÃO são o nome do produto de cada linha.
2. DADOS DA LINHA: O nome do produto (Perfil) é o código que aparece na coluna de código de cada linha (ex: 30-023, BG-010, LG028, 25548). Use-o exatamente como está.
3. QUANTIDADE vs COMPRIMENTO vs PESO: A 'quantidade' (qtde) é o número de peças ou barras pedidas. ATENÇÃO: a coluna de quantidade pode vir nomeada como 'barras'. A quantidade é SEMPRE UM NÚMERO INTEIRO (sem vírgulas ou decimais, ex: 2, 10, 60). NUNCA extraia valores numéricos quebrados ou com decimais para a quantidade. O 'comprimento' (comp.) é o tamanho de cada barra em milímetros (geralmente um número grande como 3000 ou 6000). SE O DOCUMENTO MOSTRAR "6.000", ISSO SIGNIFICA 6000 (mm). NUNCA EXTRAIA APENAS "6". Colunas referentes a PESO (ex: "BARRA (KG)", "PESO") contêm valores com decimais (ex: 1,02, 3,83) e DEVEM SER COMPLETAMENTE IGNORADAS na extração. Preste muita atenção para não confundir as colunas.

ATENÇÃO - LISTA NEGRA / NEGATIVAÇÃO (MUITO IMPORTANTE):
NUNCA identifique os seguintes termos como sendo o 'produto' principal da linha. Eles são ruídos, cabeçalhos ou metadados de cor:
- Códigos que começam com "AZ-P" (Ex: AZ-P-RAL9003B).
- Códigos RAL isolados (Ex: RAL9005, RAL9003).
- Termos como "PINTADO", "BRANCO", "PRETO", "SEM TRATAMENTO".
Se uma linha contiver apenas esses termos, DESCARTE a linha completamente.

ATENÇÃO PARA PEDIDOS ESCRITOS À MÃO E LOCALIZAÇÃO ESPACIAL:
- Observe com atenção documentos escritos em letras garrafais (maiúsculas) e caligrafia manual. Muitas vezes letras podem parecer números (ex: o 'G' pode parecer '6', o 'O' pode parecer '0', o 'B' pode parecer '8', o 'I' ou 'L' pode parecer '1').
- Observe linhas no formato "Item - Código - Quantidade" (Ex: "04- BG057 - 19").
- Muitas vezes a folha ou anotação possui DUAS OU MAIS COLUNAS verticais. Trate cada lado independentemente.
- LOCALIZAÇÃO: Para cada item identificado, você DEVE retornar o campo 'box_2d' contendo as coordenadas do CÓDIGO DO PRODUTO no formato [ymin, xmin, ymax, xmax] em uma escala de 0 a 1000.

REGRAS DE EXTRAÇÃO:
- No campo 'produto' (Perfil), use APENAS o código isolado, em MAIÚSCULAS, SEM nenhuma descrição. Exemplos corretos: "SU001", "P412", "30-023", "TUB-4513", "Z-203". Exemplos ERRADOS: "SU001 - MARCO SUPERIOR", "TUBO RETANGULAR 50,80 X 38,10". O código geralmente é a primeira informação da linha ou a informação acima da descrição. Se a célula contiver código + descrição, extraia SOMENTE o código (geralmente os primeiros caracteres alfanuméricos).
- REGRA DE PRODUTO COM FURO (CF): Se o item contiver "V", "VENTILADO", "VENTILADA", "COM FURO", "C/ FURO", "C/FURO", "CF", "C/F" na descrição ou no código, o código final no campo 'produto' DEVE terminar com "CF". Exemplo: "Z-203 V" vira "Z-203CF". "Z203 VENTILADA" vira "Z203CF". "VZ051 C/ FURO" vira "VZ051CF". Isso é OBRIGATÓRIO. O sufixo "S/ FURO" significa SEM furo — ignore-o; não adicione "CF".
- No campo 'comprimento' (Barra), extraia apenas a numeração (ex: 6000). SE NÃO ENCONTRAR, CONSIDERE 6000 POR PADRÃO.
- No campo 'qtde' (Quantidade), extraia CUIDADOSAMENTE o número da respectiva coluna de quantidade. Lembre-se: quantidade NUNCA tem decimais. Valores como 1,02 ou 3.83 são pesos e devem ser descartados. SE NÃO ENCONTRAR, CONSIDERE 1 POR PADRÃO.

Mapeamento de Acabamento (Tratamento):
- bruto ou natural = NT
- preto pintado (incluindo RAL9005) = EPPF
- branco brilhante ou pintado (incluindo RAL9003, RAL9010) = EBCO
- Natural fosco, fosco ou anodizado fosco = FOS
- Códigos RAL: Se encontrar códigos como RAL9005, RAL9003, etc., identifique-os como o Tratamento/Acabamento.
- ATENÇÃO: Se o código do produto vier acompanhado de um código RAL (ex: "AZ-P-RAL9003B"), o código RAL refere-se à COR e deve ser mapeado para o Tratamento (ex: EBCO), enquanto a parte anterior pode ser o Perfil. No entanto, se o documento listar o RAL como o identificador principal da linha, extraia-o com cautela.
- tudo que for diferente dessas cores, deve considerado natural = NT.
- Natural/bruto/sem pintura = NT - deve conter NT na exportação, nada diferente disso.

Campos a extrair:
- Perfil -> produto (EXATAMENTE como está escrito no documento)
- Linha/descrição original -> produtoOriginal (em orçamentos com "Codigo/Descricao", copie a descrição ou a linha completa; não repita apenas o código)
- Tratamento -> acabamento (use os códigos acima)
- Qtde -> qtde
- Barra -> comprimento
- Coordenadas do Código -> box_2d [ymin, xmin, ymax, xmax]

Se o código do produto não for identificado, marque 'identificado' como false. Caso encontre um código válido, marque 'identificado' como true.

Sempre retorne um JSON válido estruturado com a chave 'items'.
`;

const FALLBACK_SYSTEM_PROMPT = `
Você é um especialista em extração de dados de pedidos.
Extraia a lista de perfis do documento com precisão absoluta.

REGRA 1 - FOCO NO CÓDIGO E QUANTIDADE: 
Para cada linha, extraia APENAS o código do produto (Ex: RM002, CM063, SU279) e a quantidade numérica.
A quantidade é SEMPRE um número inteiro e pode estar distante na coluna. Se estiver escrito "432", extraia 432.
Nunca invente quantidades. Se não tiver certeza ou não houver, use 1.
Em tabelas "Codigo / Descricao / UN / Quantidade Orcamento", ignore o codigo numerico inicial quando a descricao comecar com "PERFIL"; extraia o perfil da descricao (ex: "PERFIL SU 111 CR" -> "SU111") e a quantidade apos "UN".

REGRA 2 - ORDEM EXATA:
Mantenha a ORDEM EXATA dos itens de cima para baixo, linha por linha.

REGRA 3 - IGNORAR TEXTOS E CORES:
Ignore completamente textos descritivos, informações de peso e cabeçalhos.
Ignore nomes e códigos de pintura (ex: AZ-P-RAL9003B, PINTURA, BRANCO BRILHANTE).

Retorne um JSON estritamente no seguinte formato (sem coordenadas):
{
  "items": [
    {
      "produto": "CÓDIGO",
      "qtde": NUMERO,
      "comprimento": 6000,
      "acabamento": "NT",
      "identificado": true,
      "verificadoNoCatalogo": true
    }
  ]
}
`;

// BUDGET_IMAGE_RETRY_PROMPT was replaced by the documentProfiles system.
// Budget-specific prompt is now in READING_PROFILES["BUDGET_TABLE"].promptChain.

interface ImagePreprocessReport {
  level: "baixa" | "media" | "alta";
  originalWidth: number;
  originalHeight: number;
  outputWidth: number;
  outputHeight: number;
  cropRatio: number;
  foregroundDensity: number;
  usedBlueInkFocus: boolean;
}

interface PreparedVisionImage {
  fileBase64: string;
  mimeType: string;
  report?: ImagePreprocessReport;
  pageNumber?: number;
  totalPages?: number;
}

function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith("image/") && mimeType !== "image/svg+xml";
}

function inferMimeType(mimeType: string, fileName: string): string {
  const normalizedFileName = fileName.toLowerCase();
  if (mimeType && mimeType !== "application/octet-stream") return mimeType;
  if (normalizedFileName.endsWith(".pdf")) return "application/pdf";
  if (normalizedFileName.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (normalizedFileName.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (normalizedFileName.endsWith(".xls")) return "application/vnd.ms-excel";
  if (normalizedFileName.endsWith(".csv")) return "text/csv";
  return mimeType;
}

function isPdfFile(mimeType: string, fileName: string): boolean {
  return mimeType === "application/pdf" || mimeType.includes("pdf") || fileName.toLowerCase().endsWith(".pdf");
}

function isMeaningfulExtractedPdfText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 30) return false;

  const controlChars = (trimmed.match(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFD]/g) || []).length;
  if (controlChars / trimmed.length > 0.02) return false;

  const normalized = normalizeLineForStrictParsing(trimmed);
  const alphaNumericChars = (normalized.match(/[A-Z0-9]/g) || []).length;
  if (alphaNumericChars / Math.max(normalized.length, 1) < 0.25) return false;

  const readableWords = normalized.match(/\b[A-Z]{2,}\b/g) || [];
  const knownDocumentTerms = /\b(PERFIL|TRATAMENTO|QTDE|BARRA|PESO|CODIGO|DESCRICAO|PRODUTO|ACABAMENTO|ORCAMENTO|COTACAO|ENTREGA|RELACAO|ORIENTACAO|CLIENTE|OBRA)\b/.test(normalized);

  return knownDocumentTerms || readableWords.length >= 5;
}

function isAluminorteRelacaoBarrasDocumentText(text: string): boolean {
  const normalized = normalizeLineForStrictParsing(text);
  return (
    /\bRELACAO DE BARRAS\b/.test(normalized) &&
    /\bTRAT\.?\/?COR\b/.test(normalized) &&
    (/\bSMARTCEM\b/.test(normalized) || /\bNORTE\s+LUMI\b/.test(normalized) || /\bALUMINORTE\b/.test(normalized))
  );
}

function isBarListFileName(fileName: string): boolean {
  return normalizeLineForStrictParsing(fileName).includes("BARRA");
}

function isMaterialsRelationFileName(fileName: string): boolean {
  const normalized = normalizeLineForStrictParsing(fileName);
  return normalized.includes("RELACAO DE MATERIAIS") || normalized.includes("RELACAO DE PERFIS");
}

function isCutOrientationFileName(fileName: string): boolean {
  const normalized = normalizeLineForStrictParsing(fileName);
  return /\bP\d{4}-\d+\b/.test(normalized) && normalized.includes("PERFIL");
}

function shouldPreferBestPromptAttempt(profileKey: DocumentProfileKey): boolean {
  return ["BAR_LIST", "ALUMINORTE_RELACAO_BARRAS", "SMARTCEM_BAR_SUMMARY", "CUT_ORIENTATION_TABLE", "PROFILE_TABLE", "MATERIALS_RELATION_TABLE", "COLOR_MATRIX_TABLE", "BAR_CALCULATION", "DESCRIPTION_CODE_TABLE", "COTACAO_OBRA_TABLE"].includes(profileKey);
}

function enoughItemsForDenseTable(profileKey: DocumentProfileKey, itemCount: number): boolean {
  if (!shouldPreferBestPromptAttempt(profileKey)) return itemCount > 0;
  return itemCount >= 8;
}

function loadImageFromBase64(fileBase64: string, mimeType: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Nao foi possivel carregar a imagem para pre-processamento."));
    image.src = `data:${mimeType};base64,${fileBase64}`;
  });
}

async function prepareImageForVision(fileBase64: string, mimeType: string): Promise<PreparedVisionImage> {
  if (!isImageMime(mimeType) || typeof document === "undefined") {
    return { fileBase64, mimeType };
  }

  try {
    const image = await loadImageFromBase64(fileBase64, mimeType);
    const originalWidth = image.naturalWidth || image.width;
    const originalHeight = image.naturalHeight || image.height;
    if (!originalWidth || !originalHeight) return { fileBase64, mimeType };

    const targetVisionLongEdge = 1400;
    const minReadableLongEdge = 1200;
    const originalReport: ImagePreprocessReport = {
      level: "media",
      originalWidth,
      originalHeight,
      outputWidth: originalWidth,
      outputHeight: originalHeight,
      cropRatio: 1,
      foregroundDensity: 0,
      usedBlueInkFocus: false,
    };

    const originalLongEdge = Math.max(originalWidth, originalHeight);
    const shouldResizeForVision = originalLongEdge < minReadableLongEdge || originalLongEdge > targetVisionLongEdge;

    if (!shouldResizeForVision) {
      return { fileBase64, mimeType, report: originalReport };
    }

    const safeOutputScale = targetVisionLongEdge / originalLongEdge;
    const safeOutputWidth = Math.max(1, Math.round(originalWidth * safeOutputScale));
    const safeOutputHeight = Math.max(1, Math.round(originalHeight * safeOutputScale));
    const safeOutputCanvas = document.createElement("canvas");
    safeOutputCanvas.width = safeOutputWidth;
    safeOutputCanvas.height = safeOutputHeight;
    const safeOutputContext = safeOutputCanvas.getContext("2d");
    if (!safeOutputContext) return { fileBase64, mimeType, report: originalReport };

    safeOutputContext.imageSmoothingEnabled = true;
    safeOutputContext.imageSmoothingQuality = "high";
    safeOutputContext.fillStyle = "#ffffff";
    safeOutputContext.fillRect(0, 0, safeOutputWidth, safeOutputHeight);
    safeOutputContext.drawImage(image, 0, 0, safeOutputWidth, safeOutputHeight);
    const safeOptimizedDataUrl = safeOutputCanvas.toDataURL("image/jpeg", 0.85);
    const safeOptimizedBase64 = safeOptimizedDataUrl.split(",")[1] || fileBase64;

    return {
      fileBase64: safeOptimizedBase64,
      mimeType: "image/jpeg",
      report: {
        ...originalReport,
        level: originalLongEdge < minReadableLongEdge ? "alta" : "baixa",
        outputWidth: safeOutputWidth,
        outputHeight: safeOutputHeight,
      },
    };

  } catch (err) {
    console.warn("Falha no pre-processamento da imagem. Enviando imagem original.", err);
    return { fileBase64, mimeType };
  }
}

async function renderPdfPagesForVision(fileBase64: string): Promise<PreparedVisionImage[]> {
  if (typeof document === "undefined") return [];

  try {
    const binaryString = atob(fileBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const pagesToRender = pdf.numPages;
    const renderedPages: PreparedVisionImage[] = [];

    for (let pageNum = 1; pageNum <= pagesToRender; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const baseViewport = page.getViewport({ scale: 1 });
      const targetLongEdge = 1400;
      const baseLongEdge = Math.max(baseViewport.width, baseViewport.height);
      const scale = Math.max(2, Math.min(3.5, targetLongEdge / Math.max(baseLongEdge, 1)));
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error(`Nao foi possivel preparar a pagina ${pageNum}/${pdf.numPages} do PDF para OCR.`);
      }

      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport }).promise;

      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      const renderedBase64 = dataUrl.split(",")[1];
      if (!renderedBase64) {
        throw new Error(`Nao foi possivel gerar imagem da pagina ${pageNum}/${pdf.numPages} do PDF para OCR.`);
      }

      renderedPages.push({
        fileBase64: renderedBase64,
        mimeType: "image/jpeg",
        pageNumber: pageNum,
        totalPages: pdf.numPages,
        report: {
          level: "alta",
          originalWidth: baseViewport.width,
          originalHeight: baseViewport.height,
          outputWidth: canvas.width,
          outputHeight: canvas.height,
          cropRatio: 1,
          foregroundDensity: 0,
          usedBlueInkFocus: false,
        },
      });
    }

    if (renderedPages.length !== pdf.numPages) {
      throw new Error(`OCR incompleto bloqueado: PDF tem ${pdf.numPages} paginas, mas apenas ${renderedPages.length} foram preparadas.`);
    }

    return renderedPages;
  } catch (err) {
    console.error("Falha ao renderizar todas as paginas do PDF para imagem.", err);
    throw err;
  }
}

/**
 * Extracts text from a digital PDF via PDF.js.
 * Returns null when the PDF has no meaningful text (scanned image).
 */
async function extractTextFromPDF(
  fileBase64: string,
  onProgress?: (current: number, total: number) => void,
  maxPages: number = 0,
  pageCountOut?: { value: number }
): Promise<string | null> {
  try {
    const binaryString = atob(fileBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const textParts: string[] = [];

    const numPages = pdf.numPages;
    if (pageCountOut) pageCountOut.value = numPages;
    const pagesToScan: number[] = [];

    if (maxPages > 0 && numPages > maxPages) {
      const half = Math.floor(maxPages / 2);
      for (let i = 1; i <= half; i++) pagesToScan.push(i);
      for (let i = numPages - half + 1; i <= numPages; i++) {
        if (!pagesToScan.includes(i)) pagesToScan.push(i);
      }
    } else {
      for (let i = 1; i <= numPages; i++) pagesToScan.push(i);
    }

    for (let i = 0; i < pagesToScan.length; i++) {
      const pageNum = pagesToScan[i];
      if (onProgress) onProgress(i + 1, pagesToScan.length);

      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      const textItems = (textContent.items as any[])
        .filter(item => String(item.str || "").trim())
        .map(item => ({
          str: String(item.str || ""),
          x: Number(item.transform?.[4] || 0),
          y: Number(item.transform?.[5] || 0),
        }))
        .sort((a, b) => {
          const yDiff = b.y - a.y;
          return Math.abs(yDiff) > 3 ? yDiff : a.x - b.x;
        });

      const lineGroups: Array<{ y: number; items: Array<{ str: string; x: number }> }> = [];

      for (const item of textItems) {
        const line = lineGroups.find(group => Math.abs(group.y - item.y) <= 3);
        if (line) {
          line.items.push({ str: item.str, x: item.x });
        } else {
          lineGroups.push({ y: item.y, items: [{ str: item.str, x: item.x }] });
        }
      }

      const lines = lineGroups.map(group =>
        group.items
          .sort((a, b) => a.x - b.x)
          .map(item => item.str)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim()
      ).filter(Boolean);

      textParts.push(lines.join("\n"));
    }

    const fullText = textParts.join("\n\n").trim();
    if (fullText.length < 30) return null;
    return fullText;
  } catch (err) {
    console.warn("PDF.js text extraction failed, will use AI vision:", err);
    return null;
  }
}

/**
 * AI API caller using exclusively Gemini.
 */
async function callAIResilient<T extends Record<string, any> = OCRResponse>(
  payload: any,
  expectedKey: string = "items"
): Promise<T> {
  try {
    log(`Tentando extração com provedor: GEMINI...`);
    const response = await fetch("/api/gemini", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const responseText = await response.text().catch(() => "");
      let errorMessage = "";
      let retryAfterMs = 0;

      try {
        const errorData = responseText ? JSON.parse(responseText) : {};
        errorMessage = errorData.error || errorData.message || "";
        retryAfterMs = Number(errorData.retryAfterMs || 0);
      } catch {
        errorMessage = responseText.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      }

      if (
        response.status === 429 ||
        response.status === 503 ||
        response.status >= 500 ||
        retryAfterMs > 0 ||
        errorMessage.includes("FUNCTION_INVOCATION_FAILED")
      ) {
        throw new OCRRetryableError(
          errorMessage || "Cota ou erro temporario de servidor. A fila sera retomada automaticamente.",
          retryAfterMs > 0 ? retryAfterMs : 5000
        );
      }

      throw new Error(errorMessage || `Erro de conexão (${response.status})`);
    }

    const data = await response.json();
    if (data.retry || data.retryAfterMs) {
      throw new OCRRetryableError(
        data.error || "Cota temporariamente indisponivel. A fila sera retomada automaticamente.",
        Number(data.retryAfterMs || 60_000)
      );
    }

    if (!data[expectedKey]) throw new Error("A IA retornou um formato inesperado.");

    log(`Sucesso com provedor: GEMINI`);
    return data as T;
  } catch (err: any) {
    if (err instanceof OCRRetryableError) {
      console.warn(`Provedor GEMINI em standby por cota:`, err.message);
      throw err;
    }

    console.warn(`Provedor GEMINI falhou:`, err.message);
    throw new Error(`O motor de IA falhou. Último erro: ${err.message}`);
  }
}

/**
 * Lightweight AI call that returns the raw text response.
 * Used for document classification where the response is a small JSON string
 * and no specific key is expected.
 */
async function callAIRawText(payload: any): Promise<string> {
  try {
    const response = await fetch("/api/gemini", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, responseMode: "classify" }),
    });
    if (!response.ok) return "";
    const data = await response.json();
    if (data.retry || data.retryAfterMs) {
      throw new OCRRetryableError(
        data.error || "Cota temporariamente indisponivel. A fila sera retomada automaticamente.",
        Number(data.retryAfterMs || 60_000)
      );
    }
    return data?.text ?? data?.content ?? data?.result ?? JSON.stringify(data);
  } catch (err) {
    if (err instanceof OCRRetryableError) throw err;
    return "";
  }
}

async function callAIRawAudit(payload: any): Promise<string> {
  try {
    const response = await fetch("/api/gemini", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, responseMode: "audit" }),
    });
    if (!response.ok) return "";
    const data = await response.json();
    if (data.retry || data.retryAfterMs) {
      throw new OCRRetryableError(
        data.error || "Cota temporariamente indisponivel. O re-check sera retomado na proxima tentativa.",
        Number(data.retryAfterMs || 60_000)
      );
    }
    return data?.text ?? data?.content ?? data?.result ?? JSON.stringify(data);
  } catch (err) {
    if (err instanceof OCRRetryableError) throw err;
    return "";
  }
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

/**
 * Merges strict-parser codes into the Gemini response items.
 * Updates existing items that match, and appends codes that were missed entirely.
 */
function mergeStrictCodes(items: OCRItem[], strictCodes: StrictCatalogMatch[]): OCRItem[] {
  const consumedStrictIndexes = new Set<number>();

  const merged = items.map(item => {
    const itemText = normalizeCatalogMatchCode(item.produto);
    const matchingStrictIndex = strictCodes.findIndex((sc, index) => {
      if (consumedStrictIndexes.has(index)) return false;
      const strictCode = normalizeCatalogMatchCode(sc.code);
      const referenceCode = sc.referenceCode ? normalizeCatalogMatchCode(sc.referenceCode) : "";
      return itemText === strictCode || itemText.includes(strictCode) || (referenceCode !== "" && itemText === referenceCode);
    });

    const matchingStrictCode = matchingStrictIndex >= 0 ? strictCodes[matchingStrictIndex] : null;
    if (matchingStrictCode) {
      consumedStrictIndexes.add(matchingStrictIndex);
      return {
        ...item,
        produto: matchingStrictCode.code,
        produtoOriginal: matchingStrictCode.produtoOriginal || item.produtoOriginal || item.produto,
        acabamento: matchingStrictCode.acabamento || item.acabamento,
        qtde: matchingStrictCode.qtde ?? item.qtde,
        comprimento: matchingStrictCode.comprimento ?? item.comprimento,
        verificadoNoCatalogo: matchingStrictCode.verificadoNoCatalogo ?? true,
        identificado: matchingStrictCode.identificado ?? true,
        autoCatalogCandidate: matchingStrictCode.autoCatalogCandidate || item.autoCatalogCandidate,
        preserveProductCode: matchingStrictCode.preserveProductCode || item.preserveProductCode,
        skipOriginalTextBlacklist: matchingStrictCode.skipOriginalTextBlacklist || item.skipOriginalTextBlacklist,
      };
    }
    return item;
  });

  strictCodes.forEach((match, index) => {
    if (!consumedStrictIndexes.has(index)) {
      merged.push({
        produto: match.code,
        produtoOriginal: match.produtoOriginal || match.code,
        acabamento: match.acabamento || "NT",
        qtde: match.qtde ?? 1,
        comprimento: match.comprimento ?? 6000,
        identificado: match.identificado ?? true,
        verificadoNoCatalogo: match.verificadoNoCatalogo ?? true,
        autoCatalogCandidate: match.autoCatalogCandidate,
        preserveProductCode: match.preserveProductCode,
        skipOriginalTextBlacklist: match.skipOriginalTextBlacklist,
      });
    }
  });

  const budgetReferenceCodes = new Set(
    strictCodes
      .map(match => match.referenceCode ? normalizeCatalogMatchCode(match.referenceCode) : "")
      .filter(Boolean)
  );

  return budgetReferenceCodes.size > 0
    ? merged.filter(item => !budgetReferenceCodes.has(normalizeCatalogMatchCode(item.produto)))
    : merged;
}

function mergeSubstitutionTextItems(items: OCRItem[], substitutionItems: SubstitutionTextItem[]): OCRItem[] {
  if (!substitutionItems.length) return items;

  const originalItemKeys = new Set(
    items
      .flatMap(item => [item.produto, item.produtoOriginal || ""])
      .map(normalizeCatalogMatchCode)
      .filter(Boolean)
  );
  const merged = [...items];

  substitutionItems.forEach((item) => {
    const itemKeys = [item.produto, item.produtoOriginal || ""]
      .map(normalizeCatalogMatchCode)
      .filter(Boolean);

    if (itemKeys.some(key => originalItemKeys.has(key))) return;

    merged.push(item);
  });

  return merged;
}

/**
 * Strips any trailing description from an OCR product code.
 * e.g. "SU001 - MARCO SUPERIOR / CORRER 2 (25C-001)" → "SU001"
 *      "P412 (25-540) - MARCO LATERAL"               → "P412"
 *      "30-023"                                       → "30-023"  (unchanged)
 */
function cleanProductCode(raw: string): string {
  let upper = raw.trim().toUpperCase();
  upper = upper.replace(/([A-Z]{1,5})\s*\.\s*(\d+)/g, "$1$2");

  const codeAndDescription = upper.match(/^([A-Z0-9]{1,6}(?:\s*-\s*[A-Z0-9]{1,6})?|\d{1,3}[A-Z]{1,5}\s*-\s*\d{1,6}|[A-Z]{1,5}\s+\d{1,6}[A-Z]{0,3})\s+-\s+(.+)$/);
  if (codeAndDescription) {
    const code = formatRecognizedCatalogCode(codeAndDescription[1]);
    const description = codeAndDescription[2].trim();
    const descriptionIsFuroMarker = /^(VENTILAD[OA]|V|COM\s+FURO|C\/\s*FURO|C\/F|CF)\b/.test(description);

    if (code && /[0-9]/.test(code)) {
      return descriptionIsFuroMarker && !code.endsWith("CF") ? `${code}CF` : code;
    }
  }

  // Rule for RAL colors: If code contains RAL9005, RAL9003 etc, it's a color indicator.
  // We try to extract the profile before it.
  const ralMatch = upper.match(/^(.*?)[- ]?(RAL[ ]?\d{4}[A-Z]?)(.*)$/);
  if (ralMatch) {
    const prefix = ralMatch[1].trim();
    if (prefix && prefix.length >= 2) {
      return prefix;
    }
    // If it's just the RAL code, return it as is (will be marked out of catalog if not found)
    return ralMatch[2].trim();
  }

  // Variantes e sufixos de Furo / Ventilado
  const furoPattern = /(?:\s+|-)(VENTILAD[OA]|V|COM\s+FURO|C\/\s*FURO|C\/F|CF)$/i;
  let hasFuro = false;
  if (furoPattern.test(upper)) {
    hasFuro = true;
    upper = upper.replace(furoPattern, "").trim();
  } else if (upper.endsWith("CF")) {
    hasFuro = true;
    upper = upper.slice(0, -2).trim();
  }

  const codeWithLetterSuffix = upper.match(/^([A-Z]{1,5}-?\d{2,6}\s+[A-Z])\b/);
  if (codeWithLetterSuffix) {
    return hasFuro ? `${codeWithLetterSuffix[1]}CF` : codeWithLetterSuffix[1];
  }

  let firstToken = upper.split(/\s+/)[0].replace(/[.,;:]+$/, "");

  if (hasFuro) {
    firstToken += "CF";
  }

  // Accept it if it looks like a product code: optional letters, mandatory digits, optional dash/letters suffix
  if (/^[A-Z0-9-]{2,12}$/.test(firstToken) && /[0-9]/.test(firstToken)) {
    return firstToken;
  }
  return hasFuro ? upper + "CF" : upper;
}

function splitHandwrittenQuantity(item: OCRItem): OCRItem {
  const product = (item.produto || "").trim().toUpperCase().replace(/\s+/g, "");
  const match = product.match(/^([A-Z]{2,}\d{3,4})-(\d{1,3})$/);

  if (!match) return item;

  const quantity = Number.parseInt(match[2], 10);
  if (!Number.isFinite(quantity) || quantity <= 0) return item;

  return {
    ...item,
    produtoOriginal: item.produtoOriginal || item.produto,
    produto: match[1],
    qtde: quantity,
  };
}

function isLikelyDocumentMetadataItem(item: OCRItem): boolean {
  if (item.preserveProductCode) return false;

  const source = normalizeLineForStrictParsing(item.produtoOriginal || item.produto || "");
  const product = normalizeCatalogMatchCode(item.produto || "");
  if (!source || !product) return false;

  if (
    isDocumentMetadataLine(source) ||
    /\b(RELACAO DE BARRAS|EMITIDO POR|DATA DO CALCULO|COR PREDOMINANTE)\b/.test(source)
  ) {
    return true;
  }

  const standaloneProjectTitle = source.match(/^([A-Z]{2,5}\d{1,4})-\d{3,5}$/);
  return Boolean(standaloneProjectTitle && product === normalizeCatalogMatchCode(standaloneProjectTitle[1]));
}

function isAutoCatalogableProfileCode(code: string): boolean {
  const normalized = normalizeCatalogMatchCode(code);
  return normalized.length >= 2 && normalized.length <= 16 && /[A-Z]/.test(normalized) && !/^\d+$/.test(normalized);
}

function isExplicitBudgetProfileSource(item: OCRItem): boolean {
  if (!isAutoCatalogableProfileCode(item.produto)) return false;
  if (item.autoCatalogCandidate) return true;

  const sourceMatch = parseBudgetProfileSource(item.produtoOriginal || "", false);
  return Boolean(sourceMatch && normalizeCatalogMatchCode(sourceMatch.code) === normalizeCatalogMatchCode(item.produto));
}

export async function saveAutoCatalogProducts(products: string[]): Promise<Set<string>> {
  const uniqueProducts = Array.from(new Set(
    products
      .map(product => formatRecognizedCatalogCode(product))
      .filter(isAutoCatalogableProfileCode)
  ));

  if (!uniqueProducts.length || typeof fetch === "undefined") return new Set();

  try {
    const response = await fetch("/api/save-catalog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ products: uniqueProducts }),
    });

    if (!response.ok) return new Set();
    return new Set(uniqueProducts.map(normalizeCatalogMatchCode));
  } catch (err) {
    console.warn("Falha ao auto-cadastrar perfis extraidos da descricao.", err);
    return new Set();
  }
}

/**
 * Validates and normalizes OCR items against the catalog.
 * Accepts pre-fetched catalog to avoid redundant API calls.
 */
async function validateAndNormalizeResponse(
  response: OCRResponse,
  catalog?: CatalogData
): Promise<OCRResponse> {
  try {
    // Strip descriptions the AI may have appended to the product code and fix Acabamento for RAL colors
    response.items = response.items.map(item => {
      let raw = item.produto || "";
      let acabamento = normalizeAcabamento(item.acabamento || "NT");
      const budgetProfile = parseBudgetProfileSource(item.produtoOriginal || raw, false) ||
        parseBudgetProfileSource(raw, false);

      if (budgetProfile) {
        raw = budgetProfile.code;
        item = {
          ...item,
          produtoOriginal: budgetProfile.produtoOriginal || item.produtoOriginal || item.produto,
          qtde: budgetProfile.qtde ?? item.qtde,
          comprimento: budgetProfile.comprimento ?? item.comprimento,
          autoCatalogCandidate: budgetProfile.autoCatalogCandidate || item.autoCatalogCandidate,
        };
      }

      // Auto-mapping for RAL colors found in product string
      if (raw.includes("RAL9005")) acabamento = "EPPF";
      else if (raw.includes("RAL9003") || raw.includes("RAL9010")) acabamento = "EBCO";

      let finalProduct = cleanProductCode(raw);

      // REGRA DE PRODUTO COM FURO (CF):
      const originalText = (item.produtoOriginal || raw).toUpperCase();
      const hasSemFuro = /\b(SEM\s+FURO|S\/\s*FURO|S\/F|SF)\b/i.test(originalText);
      if (!hasSemFuro) {
        if (!["US285", "US294", "VZP001"].includes(finalProduct)) {
          const hasFuroMarker = /\b(VENTILAD[OA]|COM\s+FURO|C\/\s*FURO|C\/F|CF)\b/i.test(originalText);
          if (hasFuroMarker && !finalProduct.endsWith("CF")) {
            finalProduct = `${finalProduct}CF`;
          }
        }
      }

      return splitHandwrittenQuantity({
        ...item,
        acabamento,
        comprimento: normalizeComprimento(item.comprimento),
        produtoOriginal: item.produtoOriginal || raw,
        produto: finalProduct,
      });
    });
    response.items = response.items.filter(item => !isLikelyDocumentMetadataItem(item));
    response.items = applySubstitutionRules(response.items, catalog?.substitutionRules || []);

    const {
      products: catalogProducts,
      aliases,
      blacklist,
      tubeDimensions = [],
    } = catalog || await fetchCatalog();
    const normalizedBlacklist = buildCatalogCodeSet(blacklist || []);

    // Filtrar itens na Blacklist (Negativação) - Sempre deve ser feito
    response.items = response.items.filter(item => {
      const normalizedCleaned = normalizeCatalogMatchCode(item.produto);
      if (["VZP001", "VZC001", "VZC002", "002"].includes(normalizedCleaned)) return false;

      const normalizedOriginal = item.produtoOriginal ? normalizeCatalogMatchCode(item.produtoOriginal) : "";

      // Se o produto ficou vazio após a limpeza, também deve ser descartado
      if (!normalizedCleaned) return false;

      // Verifica de forma agressiva: se qualquer termo banido estiver contido 
      // de forma exata ou na string limpa/original
      const cleanedLooksLikeProductCode = /[A-Z].*\d|\d.*[A-Z]/.test(normalizedCleaned);
      const isBlacklisted = Array.from(normalizedBlacklist).some(b => {
        if (!b) return false;
        if (normalizedCleaned.includes(b)) return true;
        if (item.skipOriginalTextBlacklist) return false;
        return !cleanedLooksLikeProductCode && normalizedOriginal.includes(b);
      });

      return !isBlacklisted;
    });

    if (catalogProducts.length > 0) {
      const normalizedCatalog = buildCatalogCodeSet(catalogProducts);
      const normalizedAliases = buildAliasLookup(aliases);
      const compactTubeCatalog = new Set(
        catalogProducts
          .map(compactTubeCode)
          .filter((code): code is string => Boolean(code))
      );

      response.items = response.items.map(item => {
        const normalizedItemCode = normalizeCatalogMatchCode(item.produto);
        const compactTubeItemCode = compactTubeCode(item.produto);

        if (compactTubeItemCode) {
          const verifiedTubeCode = compactTubeCatalog.has(compactTubeItemCode);
          return {
            ...item,
            produto: verifiedTubeCode ? formatRecognizedCatalogCode(item.produto) : item.produto,
            verificadoNoCatalogo: verifiedTubeCode,
            identificado: verifiedTubeCode ? true : item.identificado,
          };
        }

        let measuredProfileCode = resolveMeasuredProfileCode(item.produto, tubeDimensions);
        if (!measuredProfileCode && item.produtoOriginal && item.produtoOriginal !== item.produto) {
          measuredProfileCode = resolveMeasuredProfileCode(item.produtoOriginal, tubeDimensions);
        }
        if (measuredProfileCode) {
          return {
            ...item,
            produto: measuredProfileCode,
            verificadoNoCatalogo: true,
            identificado: true,
          };
        }

        // 1. Alias match (learned corrections)
        if (normalizedAliases[normalizedItemCode]) {
          return {
            ...item,
            produto: normalizedAliases[normalizedItemCode],
            verificadoNoCatalogo: true,
            identificado: true,
          };
        }

        // 2. Exact match
        if (normalizedCatalog.has(normalizedItemCode)) {
          return {
            ...item,
            produto: formatRecognizedCatalogCode(item.produto),
            verificadoNoCatalogo: true,
            identificado: true,
          };
        }

        if (item.preserveProductCode) {
          return {
            ...item,
            verificadoNoCatalogo: false,
            identificado: item.identificado ?? true,
          };
        }

        // 3. Contained match: messy OCR text that wraps a valid code
        const containedCode = Array.from(normalizedCatalog).find(
          validCode => normalizedItemCode.includes(validCode) && validCode.length >= 4
        );

        if (containedCode) {
          const finalCode = item.produto.toUpperCase().endsWith("CF") && !containedCode.endsWith("CF")
            ? containedCode + "CF"
            : containedCode;

          return {
            ...item,
            produto: finalCode,
            verificadoNoCatalogo: true,
            identificado: true,
          };
        }

        // 4. Fuzzy match (Levenshtein) — distance 1 for ≥4 chars, distance 2 for ≥6 chars
        let minDistance = Infinity;
        let bestMatch = null;

        for (const validCode of normalizedCatalog) {
          if (Math.abs(validCode.length - normalizedItemCode.length) <= 2) {
            const dist = levenshteinDistance(normalizedItemCode, validCode);
            if (dist < minDistance) {
              minDistance = dist;
              bestMatch = validCode;
            }
          }
        }

        if (
          bestMatch &&
          ((minDistance === 1 && normalizedItemCode.length >= 6) ||
            (minDistance <= 2 && normalizedItemCode.length >= 9))
        ) {
          return {
            ...item,
            produto: bestMatch,
            verificadoNoCatalogo: true,
            identificado: true,
          };
        }

        // Not found in catalog — keep as-is, mark unverified
        return { ...item, verificadoNoCatalogo: false };
      });
    }

    response.items = response.items.map(item => {
      if (!item.verificadoNoCatalogo && item.identificado !== false && isExplicitBudgetProfileSource(item)) {
        return {
          ...item,
          autoCatalogCandidate: true
        };
      }
      return item;
    });
  } catch (e) {
    console.warn("Could not load or process catalog for validation", e);
  }
  return response;
}

/**
 * SELF_IMPROVEMENT — read-only flag for documents that were probably read poorly.
 *
 * This does NOT learn or modify anything; it only raises a hint so a human can review
 * and, if needed, run the `ocr-profile` skill to add/refine a profile. Signals used:
 *  - the document fell back to the GENERIC profile (no specialized layout matched);
 *  - a large share of items came out unidentified;
 *  - quantities that look misread — a bar length used as qty, or a round "N,000"
 *    (the classic thousands-separator misparse, ex: "2,000" read as 2000).
 */
function buildSelfImprovementHint(
  items: OCRItem[],
  profileKeyUsed?: string
): OCRSelfImprovementHint | undefined {
  if (items.length === 0) return undefined;

  const reasons: string[] = [];

  const suspectQuantityProducts = items
    .filter(it => {
      const q = it.qtde;
      if (!Number.isFinite(q) || q <= 0) return false;
      // A bar length mistaken for a quantity, or a round thousands value (e.g. 2.000 -> 2000).
      return isLikelyBarLength(q) || (q >= 2000 && q % 1000 === 0);
    })
    .map(it => it.produto);

  const usedGenericProfile = profileKeyUsed === "GENERIC" || profileKeyUsed === undefined;
  if (usedGenericProfile && items.length >= 3) {
    reasons.push("Documento lido pelo perfil genérico — pode ser um layout novo sem perfil dedicado.");
  }

  const unidentified = items.filter(it => it.identificado === false).length;
  if (items.length >= 4 && unidentified / items.length >= 0.5) {
    reasons.push(`${unidentified} de ${items.length} itens não foram identificados — leitura possivelmente incorreta.`);
  }

  if (suspectQuantityProducts.length > 0) {
    reasons.push(
      `Quantidade suspeita em ${suspectQuantityProducts.length} item(ns) (${suspectQuantityProducts.slice(0, 5).join(", ")})` +
      ` — confira se não houve erro de leitura (ex: comprimento ou "N,000" lido como quantidade).`
    );
  }

  if (reasons.length === 0) return undefined;

  return {
    suggestNewProfile: usedGenericProfile && items.length >= 3,
    profileKeyUsed,
    reasons,
    suspectQuantityProducts,
  };
}

function buildValidationReport(
  items: OCRItem[],
  totalPages: number,
  itemsPerPage: number[],
  profileKeyUsed?: string
): OCRValidationReport {
  const pagesWithNoItems = itemsPerPage
    .map((count, idx) => (count === 0 ? idx + 1 : null))
    .filter((p): p is number => p !== null);

  const unidentifiedItems = items.filter(it => it.identificado === false).length;
  const uncatalogedItems = items.filter(
    it => it.verificadoNoCatalogo === false && !it.autoCatalogCandidate
  ).length;

  const discrepancies: string[] = [];
  if (pagesWithNoItems.length > 0) {
    discrepancies.push(
      `${pagesWithNoItems.length === 1 ? "Página" : "Páginas"} sem itens: ${pagesWithNoItems.join(", ")}`
    );
  }
  if (unidentifiedItems > 0) {
    discrepancies.push(
      `${unidentifiedItems} item${unidentifiedItems > 1 ? "s" : ""} não identificado${unidentifiedItems > 1 ? "s" : ""}`
    );
  }
  if (uncatalogedItems > 0) {
    discrepancies.push(
      `${uncatalogedItems} item${uncatalogedItems > 1 ? "s" : ""} fora do catálogo`
    );
  }

  const selfImprovementHint = buildSelfImprovementHint(items, profileKeyUsed);
  if (selfImprovementHint) {
    // Surface in the existing discrepancies list so the current UI shows it with no UI changes.
    discrepancies.push(...selfImprovementHint.reasons);
  }

  return {
    totalPages,
    pagesWithNoItems,
    totalItems: items.length,
    unidentifiedItems,
    uncatalogedItems,
    discrepancies,
    selfImprovementHint,
  };
}

function appendAIReviewToReport(report: OCRValidationReport, aiReview: OCRAIReview): OCRValidationReport {
  const discrepancies = [...report.discrepancies];
  if (aiReview.status !== "ok") {
    discrepancies.push(`IA Re-check: ${aiReview.summary}`);
  }

  return {
    ...report,
    discrepancies,
    aiReview,
  };
}

function trimRecheckText(text: string): string {
  const maxChars = 60000;
  if (text.length <= maxChars) return text;
  const head = text.slice(0, Math.floor(maxChars * 0.55));
  const tail = text.slice(-Math.floor(maxChars * 0.45));
  return `${head}\n\n[...trecho central omitido para caber no re-check...]\n\n${tail}`;
}

function itemCandidateCodes(item: OCRItem): string[] {
  const values = [
    item.produto,
    item.produtoOriginal || "",
    item.substituicao?.produtoOriginal || "",
  ];
  const codes = values
    .flatMap(value => {
      const cleaned = cleanProductCode(value || "");
      return [value, cleaned];
    })
    .map(value => normalizeCatalogMatchCode(value || ""))
    .filter(code => code && /\d/.test(code));

  return Array.from(new Set(codes));
}

function codesOverlap(a: OCRItem, b: OCRItem): boolean {
  const aCodes = itemCandidateCodes(a);
  const bCodes = itemCandidateCodes(b);
  return aCodes.some(aCode =>
    bCodes.some(bCode =>
      aCode === bCode ||
      (aCode.length >= 4 && bCode.length >= 4 && (aCode.includes(bCode) || bCode.includes(aCode)))
    )
  );
}

function sameQuantityAndLength(a: OCRItem, b: OCRItem): boolean {
  const quantityA = Math.round(Number(a.qtde || 0));
  const quantityB = Math.round(Number(b.qtde || 0));
  if (quantityA !== quantityB) return false;
  return normalizeComprimento(a.comprimento) === normalizeComprimento(b.comprimento);
}

function formatRecheckItem(item: OCRItem): string {
  return `${item.produto || item.produtoOriginal || "item"} q=${item.qtde || "?"} c=${normalizeComprimento(item.comprimento)}`;
}

function compareAIRecheckItems(finalItems: OCRItem[], recheckItems: OCRItem[]): OCRAIReview {
  if (recheckItems.length === 0) {
    return {
      status: "warning",
      summary: "a segunda leitura da IA nao retornou itens para comparar",
      issues: ["A lista final foi mantida, mas a IA nao conseguiu confirmar os itens em uma segunda leitura."],
      checkedItems: 0,
    };
  }

  const usedFinalIndexes = new Set<number>();
  const missingInFinal: OCRItem[] = [];
  const finishIssues: string[] = [];

  for (const recheckItem of recheckItems) {
    const finalIndex = finalItems.findIndex((finalItem, index) =>
      !usedFinalIndexes.has(index) &&
      codesOverlap(finalItem, recheckItem) &&
      sameQuantityAndLength(finalItem, recheckItem)
    );

    if (finalIndex < 0) {
      missingInFinal.push(recheckItem);
      continue;
    }

    usedFinalIndexes.add(finalIndex);
    const finalItem = finalItems[finalIndex];
    const finalFinish = normalizeAcabamento(finalItem.acabamento || "NT");
    const recheckFinish = normalizeAcabamento(recheckItem.acabamento || "NT");
    if (finalFinish !== recheckFinish) {
      finishIssues.push(`${finalItem.produto}: acabamento final ${finalFinish}, IA leu ${recheckFinish}`);
    }
  }

  const notConfirmedByAI = finalItems.filter((_, index) => !usedFinalIndexes.has(index));
  const issues = [
    ...missingInFinal.slice(0, 5).map(item => `Possivel item ausente na lista final: ${formatRecheckItem(item)}`),
    ...notConfirmedByAI.slice(0, 5).map(item => `Item final nao confirmado pela IA: ${formatRecheckItem(item)}`),
    ...finishIssues.slice(0, 5),
  ];

  if (missingInFinal.length > 5) issues.push(`Mais ${missingInFinal.length - 5} possiveis ausencias nao exibidas.`);
  if (notConfirmedByAI.length > 5) issues.push(`Mais ${notConfirmedByAI.length - 5} itens finais nao confirmados nao exibidos.`);
  if (finishIssues.length > 5) issues.push(`Mais ${finishIssues.length - 5} divergencias de acabamento nao exibidas.`);

  if (issues.length === 0) {
    return {
      status: "ok",
      summary: `IA confirmou ${finalItems.length} item${finalItems.length === 1 ? "" : "s"} na segunda leitura`,
      issues: [],
      checkedItems: recheckItems.length,
    };
  }

  return {
    status: "warning",
    summary: `IA leu ${recheckItems.length} item${recheckItems.length === 1 ? "" : "s"}; lista final tem ${finalItems.length}`,
    issues,
    checkedItems: recheckItems.length,
  };
}

function buildAIRecheckPrompt(profileKey: DocumentProfileKey, totalPages: number, pageNumber?: number): string {
  const profilePrompt = getProfilePromptChain(profileKey, "")[0] || SYSTEM_PROMPT;
  const pageHint = pageNumber
    ? `Esta chamada revisa apenas a pagina ${pageNumber} de ${totalPages}.`
    : `Esta chamada revisa o documento completo com ${totalPages} pagina${totalPages === 1 ? "" : "s"}.`;

  return `${profilePrompt}

RE-CHECK DE IA:
- Faca uma segunda leitura independente do documento.
- Extraia novamente todos os itens de produto visiveis.
- Use quantidade inteira, comprimento em mm e acabamento conforme o documento.
- Ignore totais, subtotais, pesos, percentuais, cabecalhos e rodapes.
- ${pageHint}
- Retorne somente JSON com a chave "items".`;
}

function buildFinalItemsForAudit(items: OCRItem[]): string {
  return items
    .map((item, index) => {
      const original = item.produtoOriginal && item.produtoOriginal !== item.produto
        ? ` | original=${item.produtoOriginal}`
        : "";
      return `${index + 1}. produto=${item.produto}${original} | acabamento=${item.acabamento || "NT"} | qtde=${item.qtde} | comprimento=${normalizeComprimento(item.comprimento)}`;
    })
    .join("\n");
}

function buildAITextAuditPrompt(finalItems: OCRItem[], text: string, totalPages: number): string {
  return `Voce e o Re-check final de uma extracao de perfis de aluminio.

Compare o DOCUMENTO ORIGINAL com a LISTA FINAL EXTRAIDA.

Objetivo:
- Confirmar se todos os itens de produto do documento aparecem na lista final.
- Conferir produto, acabamento, quantidade inteira e comprimento.
- Ignore totais, subtotais, pesos, percentuais, cabecalhos, rodapes e linhas de grupo.
- Ignore aviso de item fora do catalogo; catalogo nao faz parte desta conferencia.
- Se produto final foi convertido, use o campo original como referencia de leitura.
- Em Relacao de Barras SmartCEM/Aluminorte, codigos numericos como 42006, 42007, 42012, 42014 e 42032 sao produtos validos.

Retorne somente JSON sem markdown neste formato:
{
  "status": "ok" ou "warning",
  "summary": "resumo curto",
  "issues": ["somente divergencias relevantes"],
  "checkedItems": numero_de_itens_conferidos_no_documento
}

LISTA FINAL EXTRAIDA:
${buildFinalItemsForAudit(finalItems)}

DOCUMENTO ORIGINAL (${totalPages} pagina${totalPages === 1 ? "" : "s"}):
${trimRecheckText(text)}`;
}

function parseAIReview(raw: string): OCRAIReview | null {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  if (!cleaned) return null;

  try {
    const parsed = JSON.parse(cleaned);
    const issues = Array.isArray(parsed.issues)
      ? parsed.issues.map((issue: unknown) => String(issue)).filter(Boolean)
      : [];
    const status = parsed.status === "ok" && issues.length === 0 ? "ok" : "warning";
    const summary = String(parsed.summary || (status === "ok" ? "IA confirmou a segunda leitura" : "IA encontrou possiveis divergencias"));
    const checkedItems = Number(parsed.checkedItems);

    return {
      status,
      summary,
      issues,
      checkedItems: Number.isFinite(checkedItems) ? checkedItems : undefined,
    };
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]);
      const issues = Array.isArray(parsed.issues)
        ? parsed.issues.map((issue: unknown) => String(issue)).filter(Boolean)
        : [];
      const status = parsed.status === "ok" && issues.length === 0 ? "ok" : "warning";
      const checkedItems = Number(parsed.checkedItems);
      return {
        status,
        summary: String(parsed.summary || "IA concluiu a conferencia"),
        issues,
        checkedItems: Number.isFinite(checkedItems) ? checkedItems : undefined,
      };
    } catch {
      return null;
    }
  }
}

async function runAIRecheck(
  finalItems: OCRItem[],
  source: {
    text?: string | null;
    documents?: PreparedVisionImage[];
    profileKey: DocumentProfileKey;
    totalPages: number;
  }
): Promise<OCRAIReview> {
  if (finalItems.length === 0) {
    return {
      status: "unavailable",
      summary: "sem itens finais para comparar",
      issues: ["O re-check por IA precisa de uma lista final com itens."],
    };
  }

  try {
    let recheckItems: OCRItem[] = [];

    if (source.text?.trim()) {
      const auditPrompt = buildAITextAuditPrompt(finalItems, source.text, source.totalPages);
      const rawAudit = await callAIRawAudit({ fileBase64: "", mimeType: "text/plain", prompt: auditPrompt, textOnly: true });
      const parsedAudit = parseAIReview(rawAudit);
      if (parsedAudit) return parsedAudit;

      const prompt = `${buildAIRecheckPrompt(source.profileKey, source.totalPages)}

Texto extraido do documento:

${trimRecheckText(source.text)}`;
      const attempt = await callAIResilient({ fileBase64: "", mimeType: "text/plain", prompt, textOnly: true });
      recheckItems = attempt.items || [];
    } else if (source.documents?.length) {
      for (let index = 0; index < source.documents.length; index++) {
        if (index > 0) await new Promise(resolve => setTimeout(resolve, 1500));
        const documentPage = source.documents[index];
        const prompt = buildAIRecheckPrompt(
          source.profileKey,
          source.documents.length,
          documentPage.pageNumber || index + 1
        );
        const attempt = await callAIResilient({
          fileBase64: documentPage.fileBase64,
          mimeType: documentPage.mimeType,
          prompt,
        });
        recheckItems.push(...(attempt.items || []));
      }
    } else {
      return {
        status: "unavailable",
        summary: "documento sem fonte disponivel para segunda leitura da IA",
        issues: ["Nao havia texto nem imagem preparada para o re-check por IA."],
      };
    }

    return compareAIRecheckItems(finalItems, recheckItems);
  } catch (err: any) {
    log("IA Re-check nao conseguiu concluir a segunda leitura.", err);
    return {
      status: "unavailable",
      summary: "IA nao conseguiu concluir a segunda conferencia",
      issues: [err?.message || "Falha desconhecida no re-check por IA."],
    };
  }
}

async function extractTextFromDocx(fileBase64: string): Promise<string> {
  try {
    const binaryString = window.atob(fileBase64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const result = await mammoth.extractRawText({ arrayBuffer: bytes.buffer });
    return result.value || "";
  } catch (err) {
    console.error("Erro ao extrair texto do Word:", err);
    return "";
  }
}

interface ExtractedSheet {
  sheetName: string;
  text: string;
  structuredItems?: OCRItem[];
  structuredProfile?: DocumentProfileKey;
}

function normalizeSheetHeader(value: string): string {
  return normalizeLineForStrictParsing(value).replace(/[^A-Z0-9]/g, "");
}

function findSheetHeader(headerByKey: Record<string, string>, candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    const header = headerByKey[normalizeSheetHeader(candidate)];
    if (header) return header;
  }
  return undefined;
}

function parseIntegerCell(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const integer = Math.round(value);
    return integer > 0 ? integer : undefined;
  }

  const text = String(value ?? "").replace(/\u00a0/g, " ").trim();
  const match = text.match(/\d+/);
  if (!match) return undefined;

  const integer = Number.parseInt(match[0], 10);
  return Number.isFinite(integer) && integer > 0 ? integer : undefined;
}

function parseQuantityCell(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value) && value > 0 ? value : undefined;
  }

  const text = String(value ?? "").replace(/\u00a0/g, " ").trim();
  if (!text) return undefined;

  const wholeDecimal = text.match(/^(\d{1,5})[.,]0+$/);
  if (wholeDecimal) {
    const quantity = Number.parseInt(wholeDecimal[1], 10);
    return Number.isFinite(quantity) && quantity > 0 ? quantity : undefined;
  }

  if (/\d+[.,]\d+/.test(text)) return undefined;

  const integerMatch = text.match(/\b(\d{1,5})\b/);
  if (!integerMatch) return undefined;

  const quantity = Number.parseInt(integerMatch[1], 10);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : undefined;
}

function extractLeadingProfileCode(value: string): string | null {
  const normalized = normalizeLineForStrictParsing(value);
  const match = normalized.match(/^([A-Z]{1,5}\s*[-.]?\s*\d{1,6}[A-Z]{0,3}|[A-Z]{1,5}\d{1,6}[A-Z]{0,3})(?=\s*(?:\/|-|\(|$|\b))/);
  return match ? formatRecognizedCatalogCode(match[1]) : null;
}

function extractSpreadsheetProductCode(rawProduct: string, description: string): string {
  const product = rawProduct.trim();
  const descriptionCode = extractLeadingProfileCode(description);
  const internalCode = /^\d{2,3}\s*-\s*\d{3,6}$/.test(product);

  if (internalCode && descriptionCode) return descriptionCode;

  const primaryProduct = product
    .replace(/\s*\(.*?\)\s*$/, "")
    .replace(/\s+-\s+.*$/, "")
    .trim();

  const withoutTreatmentSuffix = primaryProduct.replace(/[-\s](NAT|EBCO|EPPF|FOS|BR|BC)$/i, "");
  return formatRecognizedCatalogCode(withoutTreatmentSuffix || primaryProduct || descriptionCode || description);
}

export function parseStructuredProfileSheet(sheet: XLSX.WorkSheet): OCRItem[] {
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
  if (!rows.length) return [];

  const firstRowKeys = Object.keys(rows[0] || {});
  const headerByKey = firstRowKeys.reduce<Record<string, string>>((lookup, key) => {
    lookup[normalizeSheetHeader(key)] = key;
    return lookup;
  }, {});

  const productHeader = findSheetHeader(headerByKey, ["Codigo", "Cod", "Produto", "Perfil", "Referencia"]);
  const descriptionHeader = findSheetHeader(headerByKey, ["Nome", "Descricao", "Produto Nome", "Item"]);
  const finishHeader = findSheetHeader(headerByKey, ["Cor", "Acabamento", "Tratamento", "Tratamento Cor", "Trat./Cor"]);
  const quantityHeader = findSheetHeader(headerByKey, [
    "Qt.Barras",
    "Qtd.Barras",
    "Qtde.Barras",
    "Qt Barras",
    "Qtd Barras",
    "Qtde Barras",
    "Quantidade Barras",
    "Barras",
    "Quantidade",
    "Qtde",
    "Qtd",
  ]);

  if (!productHeader || !quantityHeader || (!descriptionHeader && !finishHeader)) return [];

  return rows.flatMap((row): OCRItem[] => {
    const rawProduct = String(row[productHeader] ?? "").trim();
    const description = descriptionHeader ? String(row[descriptionHeader] ?? "").trim() : "";
    if (!rawProduct && !description) return [];

    const qtde = parseQuantityCell(row[quantityHeader]);
    if (!qtde) return [];

    const produto = extractSpreadsheetProductCode(rawProduct, description);
    if (!produto) return [];

    const acabamento = finishHeader ? normalizeAcabamento(String(row[finishHeader] ?? "NT")) : "NT";
    const produtoOriginal = [rawProduct, description].filter(Boolean).join(" - ") || produto;

    return [{
      produto,
      produtoOriginal,
      acabamento,
      qtde,
      comprimento: 6000,
      identificado: true,
      preserveProductCode: true,
    }];
  });
}

function parseExportedProfileSheet(sheet: XLSX.WorkSheet): OCRItem[] {
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  if (!rows.length) return [];

  const firstRowKeys = Object.keys(rows[0] || {});
  const headerByKey = firstRowKeys.reduce<Record<string, string>>((lookup, key) => {
    lookup[normalizeSheetHeader(key)] = key;
    return lookup;
  }, {});

  const productHeader = headerByKey.PRODUTO;
  const finishHeader = headerByKey.ACABAMENTO;
  const quantityHeader = headerByKey.QTDE || headerByKey.QUANTIDADE;
  const lengthHeader = headerByKey.COMPRIMENTO || headerByKey.BARRA || headerByKey.TAMANHO;

  if (!productHeader || !finishHeader || !quantityHeader) return [];

  return rows.flatMap((row): OCRItem[] => {
    const rawProduct = String(row[productHeader] ?? "").trim();
    if (!rawProduct) return [];

    const qtde = parseQuantityCell(row[quantityHeader]);
    if (!qtde) return [];

    const comprimento = lengthHeader ? parseIntegerCell(row[lengthHeader]) ?? 6000 : 6000;
    const acabamento = normalizeAcabamento(String(row[finishHeader] ?? "NT"));
    const produto = formatRecognizedCatalogCode(rawProduct);

    return [{
      produto,
      produtoOriginal: rawProduct,
      acabamento,
      qtde,
      comprimento,
      identificado: true,
      preserveProductCode: true,
    }];
  });
}

function findHeaderIndex(headers: string[], candidates: string[]): number {
  const normalizedCandidates = new Set(candidates.map(normalizeSheetHeader));
  return headers.findIndex(header => normalizedCandidates.has(normalizeSheetHeader(header)));
}

function parseDfcQuoteSheet(sheet: XLSX.WorkSheet): OCRItem[] {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false, blankrows: false });
  const headerRowIndex = rows.findIndex(row => {
    const headers = row.map(value => String(value ?? ""));
    return findHeaderIndex(headers, ["Cód", "Cod", "Codigo", "Código"]) >= 0 &&
      findHeaderIndex(headers, ["Quantidade", "Qtde", "Qtd"]) >= 0 &&
      findHeaderIndex(headers, ["Cor", "Acabamento"]) >= 0;
  });

  if (headerRowIndex < 0) return [];

  const headers = rows[headerRowIndex].map(value => String(value ?? ""));
  const productIndex = findHeaderIndex(headers, ["Cód", "Cod", "Codigo", "Código"]);
  const quantityIndex = findHeaderIndex(headers, ["Quantidade", "Qtde", "Qtd"]);
  const finishIndex = findHeaderIndex(headers, ["Cor", "Acabamento"]);
  const lengthIndex = findHeaderIndex(headers, ["Comprimento", "Barra", "Tamanho"]);

  if (productIndex < 0 || quantityIndex < 0 || finishIndex < 0) return [];

  return rows.slice(headerRowIndex + 1).flatMap((row): OCRItem[] => {
    const rawProduct = String(row[productIndex] ?? "").trim();
    if (!rawProduct || normalizeSheetHeader(rawProduct) === "COD") return [];

    const qtde = parseQuantityCell(row[quantityIndex]);
    if (!qtde) return [];

    const comprimento = lengthIndex >= 0 ? parseIntegerCell(row[lengthIndex]) ?? 6000 : 6000;
    const acabamento = normalizeAcabamento(String(row[finishIndex] ?? "NT"));
    const produto = formatRecognizedCatalogCode(rawProduct);

    return [{
      produto,
      produtoOriginal: rawProduct,
      acabamento,
      qtde,
      comprimento,
      identificado: true,
      preserveProductCode: true,
    }];
  });
}

async function extractTextFromExcel(fileBase64: string): Promise<ExtractedSheet[]> {
  try {
    const workbook = XLSX.read(fileBase64, { type: "base64" });
    const sheets: ExtractedSheet[] = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet);
      if (csv && csv.trim()) {
        const structuredProfileItems = parseStructuredProfileSheet(sheet);
        const exportedItems = structuredProfileItems.length ? [] : parseExportedProfileSheet(sheet);
        const dfcItems = structuredProfileItems.length || exportedItems.length ? [] : parseDfcQuoteSheet(sheet);
        sheets.push({
          sheetName,
          text: csv,
          structuredItems: structuredProfileItems.length ? structuredProfileItems : exportedItems.length ? exportedItems : dfcItems,
          structuredProfile: structuredProfileItems.length
            ? "DESCRIPTION_CODE_TABLE"
            : exportedItems.length
              ? "EXPORTED_PROFILE_CSV"
              : dfcItems.length
                ? "DFC_QUOTE_SHEET"
                : undefined,
        });
      }
    }
    return sheets;
  } catch (err) {
    console.error("Erro ao extrair texto do Excel:", err);
    return [];
  }
}

/**
 * Main OCR function.
 * Strategy:
 * 1. Fetch catalog once for the entire operation.
 * 2. PDFs: try PDF.js text extraction first (free, instant).
 *    - Digital PDF → text to Gemini + strict parser merge.
 *    - Scanned PDF → full image to Gemini vision.
 * 3. Excel/Word: Extract text via xlsx/mammoth and pass to Gemini Text.
 * 4. Images -> preserve original, resize only when very large, then Gemini vision.
 */
export async function performOCR(fileBase64: string, mimeType: string, fileName: string = ""): Promise<OCRResponse> {
  try {
    const effectiveMimeType = inferMimeType(mimeType, fileName);
    log("Iniciando OCR...", { mimeType, effectiveMimeType, fileName });

    const catalog = await fetchCatalog();
    const dynamicBlacklist = catalog.blacklist && catalog.blacklist.length > 0
      ? `\n\nITENS ESPECIFICOS PARA IGNORAR (NAO EXTRAIR):\n- ${catalog.blacklist.join("\n- ")}`
      : "";
    const basePrompt = SYSTEM_PROMPT + dynamicBlacklist;
    let response: OCRResponse;
    let _totalPages = 1;
    let _itemsPerPage: number[] = [];
    let _aiRecheckText: string | null = null;
    let _aiRecheckDocuments: PreparedVisionImage[] = [];
    let _aiRecheckProfileKey: DocumentProfileKey = "GENERIC";

    const isDocx = fileName.toLowerCase().endsWith(".docx") || effectiveMimeType.includes("wordprocessingml");
    const isExcel = fileName.toLowerCase().endsWith(".xlsx") || fileName.toLowerCase().endsWith(".xls") || fileName.toLowerCase().endsWith(".csv") || effectiveMimeType.includes("spreadsheetml") || effectiveMimeType.includes("csv") || effectiveMimeType.includes("excel");

    if (isExcel) {
      log("Excel/CSV detectado. Extraindo texto via XLSX.");
      const sheets = await extractTextFromExcel(fileBase64);
      _aiRecheckText = sheets.map(sheet => `Aba: ${sheet.sheetName}\n${sheet.text}`).join("\n\n");
      _aiRecheckProfileKey = sheets.find(sheet => sheet.structuredProfile)?.structuredProfile || "GENERIC";
      let allItems: OCRItem[] = [];

      for (const sheet of sheets) {
        if (sheet.structuredItems?.length) {
          log(`Perfil ${sheet.structuredProfile} detectado na aba ${sheet.sheetName}: ${sheet.structuredItems.length} itens.`);
          sheet.structuredItems.forEach(item => { item.sourceSheetName = sheet.sheetName; });
          allItems = allItems.concat(sheet.structuredItems);
          continue;
        }

        const strictCodes = await processTextWithStrictCatalog(sheet.text, catalog);
        const substitutionItems = extractSubstitutionItemsFromText(sheet.text, catalog.substitutionRules || []);
        
        const prompt = basePrompt + "\n\nExtraia os dados dos perfis do seguinte texto:\n\n" + sheet.text;
        const sheetResponse = await callAIResilient({ fileBase64: "", mimeType: "text/plain", prompt, textOnly: true });
        
        sheetResponse.items = mergeStrictCodes(sheetResponse.items, strictCodes);
        sheetResponse.items = mergeSubstitutionTextItems(sheetResponse.items, substitutionItems);
        
        // Atribui a aba a todos os itens
        sheetResponse.items.forEach(item => { item.sourceSheetName = sheet.sheetName; });
        
        allItems = allItems.concat(sheetResponse.items);
      }
      _totalPages = sheets.length || 1;
      response = { items: allItems };

    } else if (isDocx) {
      log("Word (.docx) detectado. Extraindo texto via mammoth.");
      const extractedText = await extractTextFromDocx(fileBase64);
      _aiRecheckText = extractedText;
      const strictCodes = await processTextWithStrictCatalog(extractedText, catalog);
      const substitutionItems = extractSubstitutionItemsFromText(extractedText, catalog.substitutionRules || []);
      
      const prompt = basePrompt + "\n\nExtraia os dados dos perfis do seguinte texto:\n\n" + extractedText;
      response = await callAIResilient({ fileBase64: "", mimeType: "text/plain", prompt, textOnly: true });
      
      response.items = mergeStrictCodes(response.items, strictCodes);
      response.items = mergeSubstitutionTextItems(response.items, substitutionItems);

    } else {
      let extractedText: string | null = null;
      let hadUnusablePdfText = false;
      if (isPdfFile(effectiveMimeType, fileName)) {
        const pdfPageCountOut = { value: 1 };
        extractedText = await extractTextFromPDF(fileBase64, undefined, 0, pdfPageCountOut);
        _totalPages = pdfPageCountOut.value;
        if (extractedText && !isMeaningfulExtractedPdfText(extractedText)) {
          hadUnusablePdfText = true;
          log("Texto extraido do PDF parece codificado por fonte customizada. Usando leitura visual.");
          extractedText = null;
        }
      }

      if (extractedText) {
        log("Texto extraído detectado (PDF digital). Texto extraído via PDF.js.");
        _aiRecheckText = extractedText;

        const isQuoteDeliveryDocument = isQuoteDeliveryDocumentText(extractedText);
        const isMaterialsRelationDocument = isMaterialsRelationDocumentText(extractedText);
        const isSmartCemBarSummaryDocument = isSmartCemBarSummaryDocumentText(extractedText);
        const isAluminorteRelacaoBarrasDocument = isAluminorteRelacaoBarrasDocumentText(extractedText);
        const isBarListDocument = !isAluminorteRelacaoBarrasDocument && (isBarListDocumentText(extractedText) || isBarListFileName(fileName));
        const isBarCalculationDocument = isBarCalculationDocumentText(extractedText);
        const isSujvidrosCotacaoBarrasDocument = isSujvidrosCotacaoBarrasDocumentText(extractedText);
        const isAcecampPurchaseOrderDoc = isAcecampPurchaseOrderDocumentText(extractedText);
        const isNeocaSimulacaoComprasDoc = isNeocaSimulacaoComprasDocumentText(extractedText);
        const isEcgProductRelationDoc = isEcgProductRelationDocumentText(extractedText);
        const isCemOneRomaneioDoc = isCemOneRomaneioDocumentText(extractedText);
        _aiRecheckProfileKey = isAluminorteRelacaoBarrasDocument
          ? "ALUMINORTE_RELACAO_BARRAS"
          : isSmartCemBarSummaryDocument
            ? "SMARTCEM_BAR_SUMMARY"
            : isQuoteDeliveryDocument
              ? "QUOTE_DELIVERY_TABLE"
              : isMaterialsRelationDocument
                ? "MATERIALS_RELATION_TABLE"
                : isBarListDocument
                  ? "BAR_LIST"
                  : isBarCalculationDocument
                    ? "BAR_CALCULATION"
                    : isSujvidrosCotacaoBarrasDocument
                      ? "SUJVIDROS_COTACAO_BARRAS"
                      : isAcecampPurchaseOrderDoc
                        ? "ACECAMP_PURCHASE_ORDER"
                        : isNeocaSimulacaoComprasDoc
                          ? "NEOCA_SIMULACAO_COMPRAS"
                          : isEcgProductRelationDoc
                            ? "ECG_PRODUCT_RELATION"
                            : isCemOneRomaneioDoc
                              ? "CEMONE_ROMANEIO_PERFIS"
                              : "GENERIC";
        const strictCodes = await processTextWithStrictCatalog(extractedText, catalog);
        const substitutionItems = isSmartCemBarSummaryDocument
          ? []
          : extractSubstitutionItemsFromText(extractedText, catalog.substitutionRules || []);
        log(`Strict Parser encontrou ${strictCodes.length} produtos.`);

        if (isAluminorteRelacaoBarrasDocument && strictCodes.length > 0) {
          log(`Aluminorte Relacao de Barras lida pelo parser local (${strictCodes.length} itens). Pulando IA.`);
          response = { items: [] };
        } else if (isAluminorteRelacaoBarrasDocument) {
          log("Layout Aluminorte Relacao de Barras detectado no PDF digital. Usando perfil ALUMINORTE_RELACAO_BARRAS.");
          const promptChain = getProfilePromptChain("ALUMINORTE_RELACAO_BARRAS", dynamicBlacklist);
          response = { items: [] };

          for (let i = 0; i < promptChain.length; i++) {
            const prompt = `${promptChain[i]}\n\nTexto extraido do PDF:\n\n${extractedText}`;
            const attempt = await callAIResilient({ fileBase64: "", mimeType: "text/plain", prompt, textOnly: true });
            if ((attempt.items || []).length > 0) {
              response = attempt;
              log(`Perfil ALUMINORTE_RELACAO_BARRAS no PDF digital retornou ${attempt.items.length} itens.`);
              break;
            }
            log(`Perfil ALUMINORTE_RELACAO_BARRAS no PDF digital retornou vazio no prompt ${i + 1}.`);
          }
        } else if (isSmartCemBarSummaryDocument && strictCodes.length > 0) {
          log(`SmartCEM Relacao de Barras lida pelo parser local (${strictCodes.length} itens). Pulando IA.`);
          response = { items: [] };
        } else if (isSmartCemBarSummaryDocument) {
          log("Layout SmartCEM Relacao de Barras detectado no PDF digital. Usando perfil SMARTCEM_BAR_SUMMARY.");
          const promptChain = getProfilePromptChain("SMARTCEM_BAR_SUMMARY", dynamicBlacklist);
          response = { items: [] };

          for (let i = 0; i < promptChain.length; i++) {
            const prompt = `${promptChain[i]}\n\nTexto extraido do PDF:\n\n${extractedText}`;
            const attempt = await callAIResilient({ fileBase64: "", mimeType: "text/plain", prompt, textOnly: true });
            if ((attempt.items || []).length > 0) {
              response = attempt;
              log(`Perfil SMARTCEM_BAR_SUMMARY no PDF digital retornou ${attempt.items.length} itens.`);
              break;
            }
            log(`Perfil SMARTCEM_BAR_SUMMARY no PDF digital retornou vazio no prompt ${i + 1}.`);
          }
        } else if (isQuoteDeliveryDocument && strictCodes.length > 0) {
          log(`Cotacao/Entrega lida pelo parser local (${strictCodes.length} itens). Pulando IA.`);
          response = { items: [] };
        } else if (isQuoteDeliveryDocument) {
          log("Layout Cotacao/Entrega detectado no PDF digital. Usando perfil QUOTE_DELIVERY_TABLE.");
          const promptChain = getProfilePromptChain("QUOTE_DELIVERY_TABLE", dynamicBlacklist);
          response = { items: [] };

          for (let i = 0; i < promptChain.length; i++) {
            const prompt = `${promptChain[i]}\n\nTexto extraido do PDF:\n\n${extractedText}`;
            const attempt = await callAIResilient({ fileBase64: "", mimeType: "text/plain", prompt, textOnly: true });
            if ((attempt.items || []).length > 0) {
              response = attempt;
              log(`Perfil QUOTE_DELIVERY_TABLE no PDF digital retornou ${attempt.items.length} itens.`);
              break;
            }
            log(`Perfil QUOTE_DELIVERY_TABLE no PDF digital retornou vazio no prompt ${i + 1}.`);
          }
        } else if (isMaterialsRelationDocument && strictCodes.length > 0) {
          log(`Relacao de Materiais lida pelo parser local (${strictCodes.length} itens). Pulando IA.`);
          response = { items: [] };
        } else if (isMaterialsRelationDocument) {
          log("Layout Relacao de Materiais detectado no PDF digital. Usando perfil MATERIALS_RELATION_TABLE.");
          const promptChain = getProfilePromptChain("MATERIALS_RELATION_TABLE", dynamicBlacklist);
          response = { items: [] };

          for (let i = 0; i < promptChain.length; i++) {
            const prompt = `${promptChain[i]}\n\nTexto extraido do PDF:\n\n${extractedText}`;
            const attempt = await callAIResilient({ fileBase64: "", mimeType: "text/plain", prompt, textOnly: true });
            if ((attempt.items || []).length > 0) {
              response = attempt;
              log(`Perfil MATERIALS_RELATION_TABLE no PDF digital retornou ${attempt.items.length} itens.`);
              break;
            }
            log(`Perfil MATERIALS_RELATION_TABLE no PDF digital retornou vazio no prompt ${i + 1}.`);
          }
        } else if (isBarListDocument && strictCodes.length > 0) {
          log(`Relação de Barras lida pelo parser local (${strictCodes.length} itens). Pulando IA.`);
          response = { items: [] };
        } else if (isBarListDocument) {
          log("Layout Relação de Barras detectado no PDF digital. Usando perfil BAR_LIST.");
          const promptChain = getProfilePromptChain("BAR_LIST", dynamicBlacklist);
          response = { items: [] };

          for (let i = 0; i < promptChain.length; i++) {
            const prompt = `${promptChain[i]}\n\nTexto extraido do PDF:\n\n${extractedText}`;
            const attempt = await callAIResilient({ fileBase64: "", mimeType: "text/plain", prompt, textOnly: true });
            if ((attempt.items || []).length > 0) {
              response = attempt;
              log(`Perfil BAR_LIST no PDF digital retornou ${attempt.items.length} itens.`);
              break;
            }
            log(`Perfil BAR_LIST no PDF digital retornou vazio no prompt ${i + 1}.`);
          }
        } else if (isBarCalculationDocument && strictCodes.length > 0) {
          log(`Resumo do Cálculo de Barras lido pelo parser local (${strictCodes.length} itens). Pulando IA.`);
          response = { items: [] };
        } else if (isBarCalculationDocument) {
          log("Layout Resumo do Cálculo de Barras detectado no PDF digital. Usando perfil BAR_CALCULATION.");
          const promptChain = getProfilePromptChain("BAR_CALCULATION", dynamicBlacklist);
          response = { items: [] };

          for (let i = 0; i < promptChain.length; i++) {
            const prompt = `${promptChain[i]}\n\nTexto extraido do PDF:\n\n${extractedText}`;
            const attempt = await callAIResilient({ fileBase64: "", mimeType: "text/plain", prompt, textOnly: true });
            if ((attempt.items || []).length > 0) {
              response = attempt;
              log(`Perfil BAR_CALCULATION no PDF digital retornou ${attempt.items.length} itens.`);
              break;
            }
            log(`Perfil BAR_CALCULATION no PDF digital retornou vazio no prompt ${i + 1}.`);
          }
        } else if (isSujvidrosCotacaoBarrasDocument && strictCodes.length > 0) {
          log(`SUJVIDROS Cotação de Barras lida pelo parser local (${strictCodes.length} itens). Pulando IA.`);
          response = { items: [] };
        } else if (isSujvidrosCotacaoBarrasDocument) {
          log("Layout SUJVIDROS Cotação de Barras detectado no PDF digital. Usando perfil SUJVIDROS_COTACAO_BARRAS.");
          const promptChain = getProfilePromptChain("SUJVIDROS_COTACAO_BARRAS", dynamicBlacklist);
          response = { items: [] };

          for (let i = 0; i < promptChain.length; i++) {
            const prompt = `${promptChain[i]}\n\nTexto extraido do PDF:\n\n${extractedText}`;
            const attempt = await callAIResilient({ fileBase64: "", mimeType: "text/plain", prompt, textOnly: true });
            if ((attempt.items || []).length > 0) {
              response = attempt;
              log(`Perfil SUJVIDROS_COTACAO_BARRAS no PDF digital retornou ${attempt.items.length} itens.`);
              break;
            }
            log(`Perfil SUJVIDROS_COTACAO_BARRAS no PDF digital retornou vazio no prompt ${i + 1}.`);
          }
        } else if (isAcecampPurchaseOrderDoc && strictCodes.length > 0) {
          log(`Pedido de Compra ACECAMP lido pelo parser local (${strictCodes.length} itens). Pulando IA.`);
          response = { items: [] };
        } else if (isAcecampPurchaseOrderDoc) {
          log("Layout Pedido de Compra ACECAMP detectado no PDF digital. Usando perfil ACECAMP_PURCHASE_ORDER.");
          const promptChain = getProfilePromptChain("ACECAMP_PURCHASE_ORDER", dynamicBlacklist);
          response = { items: [] };

          for (let i = 0; i < promptChain.length; i++) {
            const prompt = `${promptChain[i]}\n\nTexto extraido do PDF:\n\n${extractedText}`;
            const attempt = await callAIResilient({ fileBase64: "", mimeType: "text/plain", prompt, textOnly: true });
            if ((attempt.items || []).length > 0) {
              response = attempt;
              log(`Perfil ACECAMP_PURCHASE_ORDER no PDF digital retornou ${attempt.items.length} itens.`);
              break;
            }
            log(`Perfil ACECAMP_PURCHASE_ORDER no PDF digital retornou vazio no prompt ${i + 1}.`);
          }
        } else if (isNeocaSimulacaoComprasDoc && strictCodes.length > 0) {
          log(`Simulação de Compras NEOCA lida pelo parser local (${strictCodes.length} itens). Pulando IA.`);
          response = { items: [] };
        } else if (isNeocaSimulacaoComprasDoc) {
          log("Layout Simulação de Compras NEOCA detectado no PDF digital. Usando perfil NEOCA_SIMULACAO_COMPRAS.");
          const promptChain = getProfilePromptChain("NEOCA_SIMULACAO_COMPRAS", dynamicBlacklist);
          response = { items: [] };

          for (let i = 0; i < promptChain.length; i++) {
            const prompt = `${promptChain[i]}\n\nTexto extraido do PDF:\n\n${extractedText}`;
            const attempt = await callAIResilient({ fileBase64: "", mimeType: "text/plain", prompt, textOnly: true });
            if ((attempt.items || []).length > 0) {
              response = attempt;
              log(`Perfil NEOCA_SIMULACAO_COMPRAS no PDF digital retornou ${attempt.items.length} itens.`);
              break;
            }
            log(`Perfil NEOCA_SIMULACAO_COMPRAS no PDF digital retornou vazio no prompt ${i + 1}.`);
          }
        } else if (isEcgProductRelationDoc && strictCodes.length > 0) {
          log(`Relação dos Produtos ECG lida pelo parser local (${strictCodes.length} itens). Pulando IA.`);
          response = { items: [] };
        } else if (isEcgProductRelationDoc) {
          log("Layout Relação dos Produtos ECG detectado no PDF digital. Usando perfil ECG_PRODUCT_RELATION.");
          const promptChain = getProfilePromptChain("ECG_PRODUCT_RELATION", dynamicBlacklist);
          response = { items: [] };

          for (let i = 0; i < promptChain.length; i++) {
            const prompt = `${promptChain[i]}\n\nTexto extraido do PDF:\n\n${extractedText}`;
            const attempt = await callAIResilient({ fileBase64: "", mimeType: "text/plain", prompt, textOnly: true });
            if ((attempt.items || []).length > 0) {
              response = attempt;
              log(`Perfil ECG_PRODUCT_RELATION no PDF digital retornou ${attempt.items.length} itens.`);
              break;
            }
            log(`Perfil ECG_PRODUCT_RELATION no PDF digital retornou vazio no prompt ${i + 1}.`);
          }
        } else if (isCemOneRomaneioDoc && strictCodes.length > 0) {
          log(`CEM ONE Romaneio de Perfis lido pelo parser local (${strictCodes.length} itens). Pulando IA.`);
          response = { items: [] };
        } else if (isCemOneRomaneioDoc) {
          log("Layout CEM ONE Romaneio de Perfis detectado no PDF digital. Usando perfil CEMONE_ROMANEIO_PERFIS.");
          const promptChain = getProfilePromptChain("CEMONE_ROMANEIO_PERFIS", dynamicBlacklist);
          response = { items: [] };

          for (let i = 0; i < promptChain.length; i++) {
            const prompt = `${promptChain[i]}\n\nTexto extraido do PDF:\n\n${extractedText}`;
            const attempt = await callAIResilient({ fileBase64: "", mimeType: "text/plain", prompt, textOnly: true });
            if ((attempt.items || []).length > 0) {
              response = attempt;
              log(`Perfil CEMONE_ROMANEIO_PERFIS no PDF digital retornou ${attempt.items.length} itens.`);
              break;
            }
            log(`Perfil CEMONE_ROMANEIO_PERFIS no PDF digital retornou vazio no prompt ${i + 1}.`);
          }
        } else if (strictCodes.length > 0) {
          log(`Documento digital lido pelo parser local (${strictCodes.length} itens). Pulando IA.`);
          response = { items: [] };
        } else {
          const prompt = basePrompt + "\n\nExtraia os dados dos perfis do seguinte texto:\n\n" + extractedText;
          try {
            response = await callAIResilient({ fileBase64: "", mimeType: "text/plain", prompt, textOnly: true });
          } catch (aiErr) {
            log("Erro ao chamar IA no PDF digital, utilizando fallback do parser estrito:", aiErr);
            if (strictCodes.length > 0) {
              response = { items: [] };
            } else {
              throw aiErr;
            }
          }
        }
        log(`IA retornou ${response.items?.length || 0} itens via PDF digital:`, response.items?.map(it => it.produto).join(", "));
        response.items = mergeStrictCodes(response.items, strictCodes);
        response.items = mergeSubstitutionTextItems(response.items, substitutionItems);
      } else {
        // ── Profile-based image/vision reading (Scanned PDF or Image) ────────────
        const renderedPdfPages = isPdfFile(effectiveMimeType, fileName)
          ? await renderPdfPagesForVision(fileBase64)
          : [];
        const preparedDocuments = renderedPdfPages.length > 0
          ? renderedPdfPages
          : [await prepareImageForVision(fileBase64, effectiveMimeType)];
        _totalPages = preparedDocuments.length;
        _aiRecheckDocuments = preparedDocuments;
        log("Documento preparado para análise visual.", {
          pages: preparedDocuments.length,
          renderedPdf: renderedPdfPages.length > 0,
          report: preparedDocuments[0]?.report,
        });

        // Step 1: Classify the document type with a lightweight AI probe
        const forcedProfileKey: DocumentProfileKey | null = isMaterialsRelationFileName(fileName)
          ? "MATERIALS_RELATION_TABLE"
          : isBarListFileName(fileName)
            ? "BAR_LIST"
            : (hadUnusablePdfText && isCutOrientationFileName(fileName) ? "CUT_ORIENTATION_TABLE" : null);
        let profileKey: DocumentProfileKey = forcedProfileKey || "GENERIC";
        if (forcedProfileKey) {
          log(`Documento forcado para o perfil ${forcedProfileKey}; classificacao visual ignorada para economizar tokens.`);
        } else {
        try {
          log("Classificando tipo de documento...");
          const classificationDocument = preparedDocuments[0];
          const rawClassification = await callAIRawText({
            fileBase64: classificationDocument.fileBase64,
            mimeType: classificationDocument.mimeType,
            prompt: CLASSIFY_PROMPT,
            textOnly: false,
          });

          if (rawClassification) {
            const classification = parseClassificationResult(rawClassification);
            profileKey = classification.profile;
            log(`Documento classificado como: ${profileKey} (dificuldade ${classification.difficulty})`, classification.notes);
          } else {
            log("Classificação retornou vazio. Usando perfil GENERIC.");
          }
        } catch (classifyErr) {
          if (classifyErr instanceof OCRRetryableError) throw classifyErr;
          log("Classificação falhou, usando perfil GENERIC.", classifyErr);
        }

        }

        // Step 2: Try the profile chain. Dense tables keep the best attempt,
        // because a partial one-item answer is worse than trying the next profile prompt.
        const promptChain = getProfilePromptChain(profileKey, dynamicBlacklist);
        _aiRecheckProfileKey = profileKey;
        response = { items: [] };

        for (let pageIndex = 0; pageIndex < preparedDocuments.length; pageIndex++) {
          if (pageIndex > 0) {
            log("Aguardando 4 segundos entre páginas para respeitar limites de cota da API...");
            await new Promise(resolve => setTimeout(resolve, 4000));
          }
          const preparedDocument = preparedDocuments[pageIndex];
          let bestPageAttempt: OCRResponse = { items: [] };


          for (let i = 0; i < promptChain.length; i++) {
            if (i > 0) {
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
            const completeDocumentHint = preparedDocuments.length > 1
              ? `\n\nREGRA DE DOCUMENTO COMPLETO: o arquivo tem ${preparedDocuments.length} paginas e o sistema vai processar TODAS em ordem antes de liberar o preview. Esta chamada corresponde exclusivamente a pagina ${pageIndex + 1} de ${preparedDocuments.length}. Extraia todos os itens visiveis nesta pagina, sem ignorar linhas legiveis. Se a pagina tiver uma tabela, percorra todas as linhas da tabela ate o rodape. Uma resposta com apenas 1 item em pagina cheia deve ser considerada incompleta.`
              : "";
            const profilePrompt = promptChain[i] + completeDocumentHint;
            log(`Tentando perfil ${profileKey} — página ${pageIndex + 1}/${preparedDocuments.length}, prompt ${i + 1}/${promptChain.length}`);
            const attempt = await callAIResilient({
              fileBase64: preparedDocument.fileBase64,
              mimeType: preparedDocument.mimeType,
              prompt: profilePrompt,
            });
            const attemptCount = (attempt.items || []).length;
            if (attemptCount > (bestPageAttempt.items || []).length) {
              bestPageAttempt = attempt;
            }

            if (attemptCount > 0) {
              if (shouldPreferBestPromptAttempt(profileKey) && !enoughItemsForDenseTable(profileKey, attemptCount)) {
                log(`Perfil ${profileKey} retornou tentativa parcial com ${attemptCount} itens na pagina ${pageIndex + 1}. Tentando proximo prompt para comparar.`);
                continue;
              }
              log(`Perfil ${profileKey} — página ${pageIndex + 1}, prompt ${i + 1} retornou ${attempt.items.length} itens:`, attempt.items.map(it => it.produto).join(", "));
              break;
            }
            log(`Perfil ${profileKey} — página ${pageIndex + 1}, prompt ${i + 1} retornou vazio. Tentando próximo...`);
          }

          const pageItemCount = (bestPageAttempt.items || []).length;
          _itemsPerPage.push(pageItemCount);
          if (pageItemCount > 0) {
            response.items.push(...bestPageAttempt.items);
            log(`Perfil ${profileKey} escolheu melhor tentativa da pagina ${pageIndex + 1} com ${bestPageAttempt.items.length} itens.`);
          } else {
            log(`Perfil ${profileKey} não retornou itens na página ${pageIndex + 1}.`);
          }
        }
      }
    }

    const sortedResponse = await validateAndNormalizeResponse(response, catalog);
    const validationReport = buildValidationReport(sortedResponse.items, _totalPages, _itemsPerPage, _aiRecheckProfileKey);
    const aiReview = await runAIRecheck(sortedResponse.items, {
      text: _aiRecheckText,
      documents: _aiRecheckDocuments,
      profileKey: _aiRecheckProfileKey,
      totalPages: _totalPages,
    });
    sortedResponse.validationReport = appendAIReviewToReport(validationReport, aiReview);

    return sortedResponse;
  } catch (error: any) {
    console.error("OCR Service Error:", error);
    throw error;
  }
}

/**
 * Processes raw text (WhatsApp/email paste) to extract OCR items.
 */
export async function performOCRFromText(text: string, quantityColumnIndex?: number): Promise<OCRResponse> {
  try {
    log("Iniciando OCR a partir de texto...");
    if (!text.trim()) return { items: [] };

    const catalog = await fetchCatalog();
    const dynamicBlacklist = catalog.blacklist && catalog.blacklist.length > 0
      ? `\n\nITENS ESPECIFICOS PARA IGNORAR (NAO EXTRAIR):\n- ${catalog.blacklist.join("\n- ")}`
      : "";
    const columnHint = quantityColumnIndex !== undefined
      ? `\n\nIMPORTANTE: Em cada linha desta listagem, a COLUNA ${quantityColumnIndex + 1} (contando da esquerda, separadas por espaços) contém a QUANTIDADE do item.`
      : "";
    const basePrompt = SYSTEM_PROMPT + dynamicBlacklist;

    const isQuoteDeliveryDocument = isQuoteDeliveryDocumentText(text);
    const isMaterialsRelationDocument = isMaterialsRelationDocumentText(text);
    const isSmartCemBarSummaryDocument = isSmartCemBarSummaryDocumentText(text);
    const isAluminorteBarrasTextDocument = isAluminorteRelacaoBarrasDocumentText(text);
    const isBarCalculationDocument = isBarCalculationDocumentText(text);
    const isSujvidrosCotacaoBarrasDocument = isSujvidrosCotacaoBarrasDocumentText(text);
    const isAcecampPurchaseOrderTextDocument = isAcecampPurchaseOrderDocumentText(text);
    const isNeocaSimulacaoComprasTextDocument = isNeocaSimulacaoComprasDocumentText(text);
    const isEcgProductRelationTextDocument = isEcgProductRelationDocumentText(text);
    const isCemOneRomaneioTextDocument = isCemOneRomaneioDocumentText(text);
    const isQuantityFirstList = isQuantityFirstListText(text, buildCatalogCodeSet(catalog.products));
    const recheckProfileKey: DocumentProfileKey = isQuoteDeliveryDocument
      ? "QUOTE_DELIVERY_TABLE"
      : isMaterialsRelationDocument
        ? "MATERIALS_RELATION_TABLE"
        : isSmartCemBarSummaryDocument
          ? "SMARTCEM_BAR_SUMMARY"
          : isAluminorteBarrasTextDocument
            ? "ALUMINORTE_RELACAO_BARRAS"
            : isBarCalculationDocument
              ? "BAR_CALCULATION"
              : isSujvidrosCotacaoBarrasDocument
                ? "SUJVIDROS_COTACAO_BARRAS"
                : isNeocaSimulacaoComprasTextDocument
                  ? "NEOCA_SIMULACAO_COMPRAS"
                : isEcgProductRelationTextDocument
                  ? "ECG_PRODUCT_RELATION"
                : isCemOneRomaneioTextDocument
                  ? "CEMONE_ROMANEIO_PERFIS"
                : isQuantityFirstList
                  ? "QUANTITY_FIRST_LIST"
                  : "GENERIC";
    const strictCodes = await processTextWithStrictCatalog(text, catalog, quantityColumnIndex);
    const substitutionItems = isSmartCemBarSummaryDocument
      ? []
      : extractSubstitutionItemsFromText(text, catalog.substitutionRules || [], quantityColumnIndex);
    const nonEmptyLineCount = text.split(/\r?\n/).filter(line => line.trim()).length;
    const canResolveFromSubstitutionsOnly =
      strictCodes.length === 0 &&
      substitutionItems.length > 0 &&
      substitutionItems.length === nonEmptyLineCount;

    let response: OCRResponse;
    if ((isQuoteDeliveryDocument || isMaterialsRelationDocument || isSmartCemBarSummaryDocument || isAluminorteBarrasTextDocument || isBarCalculationDocument || isSujvidrosCotacaoBarrasDocument || isAcecampPurchaseOrderTextDocument || isNeocaSimulacaoComprasTextDocument || isEcgProductRelationTextDocument || isCemOneRomaneioTextDocument) && strictCodes.length > 0) {
      response = { items: mergeStrictCodes([], strictCodes) };
      response.items = mergeSubstitutionTextItems(response.items, substitutionItems);
    } else if (canResolveFromSubstitutionsOnly) {
      response = { items: substitutionItems };
    } else {
      const promptBase = isQuoteDeliveryDocument
        ? getProfilePromptChain("QUOTE_DELIVERY_TABLE", dynamicBlacklist)[0]
        : isMaterialsRelationDocument
          ? getProfilePromptChain("MATERIALS_RELATION_TABLE", dynamicBlacklist)[0]
          : isSmartCemBarSummaryDocument
            ? getProfilePromptChain("SMARTCEM_BAR_SUMMARY", dynamicBlacklist)[0]
            : isAluminorteBarrasTextDocument
              ? getProfilePromptChain("ALUMINORTE_RELACAO_BARRAS", dynamicBlacklist)[0]
              : isBarCalculationDocument
                ? getProfilePromptChain("BAR_CALCULATION", dynamicBlacklist)[0]
                : isSujvidrosCotacaoBarrasDocument
                  ? getProfilePromptChain("SUJVIDROS_COTACAO_BARRAS", dynamicBlacklist)[0]
                  : isNeocaSimulacaoComprasTextDocument
                    ? getProfilePromptChain("NEOCA_SIMULACAO_COMPRAS", dynamicBlacklist)[0]
                  : isEcgProductRelationTextDocument
                    ? getProfilePromptChain("ECG_PRODUCT_RELATION", dynamicBlacklist)[0]
                  : isCemOneRomaneioTextDocument
                    ? getProfilePromptChain("CEMONE_ROMANEIO_PERFIS", dynamicBlacklist)[0]
                  : isQuantityFirstList
                    ? getProfilePromptChain("QUANTITY_FIRST_LIST", dynamicBlacklist)[0]
                    : basePrompt;
      const prompt = promptBase + columnHint + "\n\nExtraia os dados dos perfis do seguinte texto:\n\n" + text;
      try {
        response = await callAIResilient({ fileBase64: "", mimeType: "text/plain", prompt, textOnly: true });
      } catch (aiErr) {
        log("Erro ao chamar IA no OCR de texto, utilizando fallback do parser estrito:", aiErr);
        if (strictCodes.length > 0 || substitutionItems.length > 0) {
          response = { items: [] };
        } else {
          throw aiErr;
        }
      }
      response.items = mergeStrictCodes(response.items, strictCodes);
      response.items = mergeSubstitutionTextItems(response.items, substitutionItems);
    }

    const sortedResponse = await validateAndNormalizeResponse(response, catalog);
    const validationReport = buildValidationReport(sortedResponse.items, 1, [sortedResponse.items.length], recheckProfileKey);
    const aiReview = await runAIRecheck(sortedResponse.items, {
      text,
      profileKey: recheckProfileKey,
      totalPages: 1,
    });
    sortedResponse.validationReport = appendAIReviewToReport(validationReport, aiReview);

    return sortedResponse;
  } catch (error: any) {
    console.error("OCR Service (Text) Error:", error);
    throw error;
  }
}

/**
 * Builds the product catalog by extracting codes from a PDF index/table.
 */
export async function generateCatalogFromPDF(
  fileBase64: string,
  onProgress?: (current: number, total: number, message?: string) => void
): Promise<string[]> {
  try {
    const prompt = `
      Você é um assistente de catálogo especializado em extrair códigos de perfis de alumínio.

      INSTRUÇÕES IMPORTANTES:
      1. Foque prioritariamente em páginas de ÍNDICE ou SUMÁRIO (geralmente com colunas como 'CÓDIGO', 'DESCRIÇÃO', 'PÁG').
      2. Extraia TODOS os códigos alfanuméricos da coluna 'CÓDIGO'.
      3. Mantenha a formatação original do código (ex: '20SP - M19', 'DS - 238').

      Retorne APENAS um objeto JSON com a chave 'products' contendo um array de strings.
      Exemplo: { "products": ["20SP - M19", "DS - 238", "MN - 015"] }
    `;

    const extractedText = await extractTextFromPDF(fileBase64, (c, t) => {
      if (onProgress) onProgress(c, t, `Lendo pág. ${c}/${t}...`);
    }, 20);

    if (onProgress) onProgress(20, 20, "Organizando códigos...");

    let response: { products: string[] };
    if (extractedText) {
      response = await callAIResilient<{ products: string[] }>({
        fileBase64: "",
        mimeType: "text/plain",
        prompt: prompt + "\n\nTexto do catálogo:\n" + extractedText,
        textOnly: true,
        responseMode: "catalog",
      }, "products");
    } else {
      response = await callAIResilient<{ products: string[] }>({
        fileBase64,
        mimeType: "application/pdf",
        prompt,
        responseMode: "catalog",
      }, "products");
    }

    const codes = response.products || [];
    return Array.isArray(codes) ? codes : [];
  } catch (err) {
    console.error("performOCR failed:", err);
    return [];
  }
}

export async function blacklistCode(code: string): Promise<boolean> {
  try {
    const response = await fetch("/api/save-catalog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blacklist: [code] }),
    });
    return response.ok;
  } catch (err) {
    console.error("Failed to blacklist code:", err);
    return false;
  }
}
