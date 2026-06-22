import React, { useState, useRef, useEffect, useMemo } from "react";
import { performOCR, OCRItem, OCRValidationReport, performOCRFromText, blacklistCode, OCRRetryableError, saveAutoCatalogProducts } from "./services/ocrService";
import { generateId } from "../lib/utils";
import { Admin } from "./Admin";
import { Help } from "./Help";
import { Users } from "./Users";
import { Substitutions } from "./Substitutions";
import { Hub } from "./Hub";
import { Config, HubLinkData } from "./Config";
import * as XLSX from "xlsx";
import {
  Upload,
  FileText,
  Download,
  Loader2,
  AlertCircle,
  AlertTriangle,
  Trash2,
  Edit2,
  Save,
  X,
  CheckSquare,
  Square,
  Layers,
  Check,
  Clock,
  Camera,
  HelpCircle,
  Ban,
  Target,
  ListChecks,
  UserRound,
  Plus,
  SlidersHorizontal,
  RefreshCw,
  PlusCircle,
  Banknote,
  ArrowLeft
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { motion, AnimatePresence } from "motion/react";

interface Prices {
  NT: string;
  EPPF: string;
  EBCO: string;
  FOS: string;
}

export interface QueueItem {
  id: string;
  file: File;
  status: 'pending' | 'processing' | 'done' | 'error' | 'paused';
  error?: string;
  resultCount?: number;
  retryCount?: number;
}

const isFuroCode = (code: string) => {
  const upper = code.toUpperCase();
  return upper.endsWith("CF") || ["US285", "US294", "VZP001"].includes(upper);
};

const formatRetryWait = (ms: number) => {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes}min`;
};

const MAX_OCR_TRANSIENT_RETRIES = 4;

const normalizeAcabamentoCode = (value: string) => {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();

  if (!normalized || normalized === "NAO IDENTIFICADO") return "NT";
  if (["NT", "EPPF", "EBCO", "FOS"].includes(normalized)) return normalized;
  if (/RAL\s*9005|PRETO/.test(normalized)) return "EPPF";
  if (/RAL\s*(9003|9010)|BRANCO/.test(normalized)) return "EBCO";
  if (/FOSCO/.test(normalized)) return "FOS";
  if (/NATURAL|BRUTO|SEM\s+PINTURA/.test(normalized)) return "NT";
  return normalized;
};

const TooltipWrapper = ({ children, content }: { children: React.ReactNode; content: string }) => {
  return (
    <div className="group relative inline-flex">
      {children}
      <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-max max-w-xs rounded-md bg-slate-900/95 backdrop-blur-sm px-3 py-1.5 text-xs font-medium text-white opacity-0 transition-opacity duration-200 ease-in-out group-hover:opacity-100 z-[100] shadow-xl text-center ring-1 ring-white/10">
        {content}
        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 border-[5px] border-transparent border-t-slate-900/95"></div>
      </div>
    </div>
  );
};

type BrowserCompatibility = {
  level: "ok" | "warning" | "error";
  title: string;
  message: string;
  browserLabel: string;
  issues: string[];
};

function getBrowserInfo(): { name: string; version: number | null; label: string } {
  const ua = navigator.userAgent;
  const edge = ua.match(/Edg\/(\d+)/);
  const chrome = ua.match(/(?:Chrome|CriOS)\/(\d+)/);
  const firefox = ua.match(/Firefox\/(\d+)/);
  const safari = ua.match(/Version\/(\d+).+Safari/);

  if (edge) return { name: "Edge", version: Number(edge[1]), label: `Edge ${edge[1]}` };
  if (chrome) return { name: "Chrome", version: Number(chrome[1]), label: `Chrome ${chrome[1]}` };
  if (firefox) return { name: "Firefox", version: Number(firefox[1]), label: `Firefox ${firefox[1]}` };
  if (safari) return { name: "Safari", version: Number(safari[1]), label: `Safari ${safari[1]}` };
  return { name: "Desconhecido", version: null, label: "Navegador desconhecido" };
}

function detectBrowserCompatibility(): BrowserCompatibility {
  const issues: string[] = [];
  const browser = getBrowserInfo();
  const minVersions: Record<string, number> = {
    Chrome: 109,
    Edge: 109,
    Firefox: 102,
    Safari: 15,
  };

  const requiredChecks: Array<[boolean, string]> = [
    [typeof fetch === "function", "fetch"],
    [typeof FileReader !== "undefined", "leitura de arquivos"],
    [typeof Blob !== "undefined", "arquivos Blob"],
    [typeof Uint8Array !== "undefined" && typeof ArrayBuffer !== "undefined", "memoria binaria"],
    [typeof TextDecoder !== "undefined", "decodificacao de texto"],
    [typeof atob === "function", "base64"],
    [typeof Worker !== "undefined", "worker de PDF"],
  ];

  requiredChecks.forEach(([supported, label]) => {
    if (!supported) issues.push(label);
  });

  try {
    const canvas = document.createElement("canvas");
    const canUseCanvas = Boolean(canvas.getContext?.("2d")) && typeof canvas.toDataURL === "function";
    if (!canUseCanvas) issues.push("canvas para imagem/PDF");
  } catch {
    issues.push("canvas para imagem/PDF");
  }

  const minVersion = minVersions[browser.name];
  const isOldBrowser = Boolean(minVersion && browser.version && browser.version < minVersion);
  const isUnknownBrowser = browser.name === "Desconhecido";

  if (issues.length > 0) {
    return {
      level: "error",
      title: "Navegador incompatível",
      message: "A leitura de PDF/imagem pode falhar neste navegador.",
      browserLabel: browser.label,
      issues,
    };
  }

  if (isOldBrowser || isUnknownBrowser) {
    return {
      level: "warning",
      title: "Navegador desatualizado",
      message: "Atualize para Chrome ou Edge recente para evitar falhas no OCR.",
      browserLabel: browser.label,
      issues: isOldBrowser ? [`versao minima recomendada: ${browser.name} ${minVersion}`] : ["versao nao identificada"],
    };
  }

  return {
    level: "ok",
    title: "Navegador compatível",
    message: "Leitura de arquivos, PDF e imagens habilitada.",
    browserLabel: browser.label,
    issues: [],
  };
}

function BrowserCompatibilityNotice() {
  const [compatibility] = useState<BrowserCompatibility>(() => detectBrowserCompatibility());
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const isOk = compatibility.level === "ok";
  const Icon = isOk ? Check : AlertTriangle;
  const colorClass = isOk
    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
    : compatibility.level === "warning"
      ? "border-amber-200 bg-amber-50 text-amber-950"
      : "border-red-200 bg-red-50 text-red-950";

  if (dismissed) return null;

  return (
    <div
      className={`fixed bottom-4 right-4 z-40 w-[min(360px,calc(100vw-2rem))] rounded-lg border px-3 py-2 text-left shadow-lg backdrop-blur transition hover:shadow-xl ${colorClass}`}
      aria-label={`${compatibility.title}: ${compatibility.message}`}
    >
      <div className="flex items-start gap-2">
        <Icon className={`mt-0.5 h-4 w-4 flex-shrink-0 ${isOk ? "text-emerald-600" : compatibility.level === "warning" ? "text-amber-600" : "text-red-600"}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold leading-tight">{compatibility.title}</div>
            <div className="text-[10px] font-medium uppercase tracking-wide opacity-70">{compatibility.browserLabel}</div>
          </div>
          <div className="mt-0.5 text-xs leading-snug opacity-85">{compatibility.message}</div>
          {!isOk && (
            <button
              type="button"
              onClick={() => setExpanded(value => !value)}
              className="mt-1 text-[11px] font-medium underline underline-offset-2 opacity-70 hover:opacity-100 transition-opacity"
            >
              {expanded ? "Ocultar detalhes" : "Ver detalhes"}
            </button>
          )}
          {expanded && compatibility.issues.length > 0 && (
            <div className="mt-2 border-t border-current/15 pt-2 text-xs leading-snug opacity-90">
              Recursos afetados: {compatibility.issues.join(", ")}.
            </div>
          )}
        </div>
        {isOk && (
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="ml-1 flex-shrink-0 rounded-md bg-emerald-600 px-3 py-1 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 transition-colors"
          >
            OK
          </button>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [currentView, setCurrentView] = useState<'hub' | 'ocr-perfis' | 'admin' | 'help' | 'users' | 'substitutions' | 'config'>(() => {
    const path = window.location.pathname;
    if (path === '/ocr-perfis') return 'ocr-perfis';
    if (path === '/admin') return 'admin';
    if (path === '/help') return 'help';
    if (path === '/users') return 'users';
    if (path === '/substitutions') return 'substitutions';
    if (path === '/config') return 'config';
    return 'hub';
  });

  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname;
      setCurrentView(
        path === '/ocr-perfis' ? 'ocr-perfis' :
          path === '/admin' ? 'admin' :
            path === '/help' ? 'help' :
              path === '/users' ? 'users' :
                path === '/substitutions' ? 'substitutions' :
                  path === '/config' ? 'config' : 'hub'
      );
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);


  const navigateTo = (view: 'hub' | 'ocr-perfis' | 'admin' | 'help' | 'users' | 'substitutions' | 'config') => {
    const path = view === 'hub' ? '/' : `/${view}`;
    window.history.pushState({}, '', path);
    setCurrentView(view);
  };

  const DEFAULT_HUB_LINKS: HubLinkData[] = [
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

  const [hubLinks, setHubLinks] = useState<HubLinkData[]>(() => {
    const saved = localStorage.getItem("aluminorte_hub_links");
    return saved ? JSON.parse(saved) : DEFAULT_HUB_LINKS;
  });

  useEffect(() => {
    localStorage.setItem("aluminorte_hub_links", JSON.stringify(hubLinks));
  }, [hubLinks]);

  const [prices, setPrices] = useState<Prices>(() => {
    const saved = localStorage.getItem("aluminorte_prices");
    return saved ? JSON.parse(saved) : { NT: "0", EPPF: "0", EBCO: "0", FOS: "0" };
  });

  const [furoPrice, setFuroPrice] = useState(() => {
    const saved = localStorage.getItem("aluminorte_furo_price");
    return saved ? saved : "0";
  });

  const [queue, setQueueState] = useState<QueueItem[]>([]);
  const queueRef = useRef<QueueItem[]>([]);

  const setQueue = (val: React.SetStateAction<QueueItem[]>) => {
    setQueueState(prev => {
      const next = typeof val === 'function' ? val(prev) : val;
      queueRef.current = next;
      return next;
    });
  };

  const [aglutinar, setAglutinar] = useState(() => {
    const saved = localStorage.getItem("aluminorte_aglutinar");
    return saved === null ? true : saved === "true";
  });

  const [isProcessing, setIsProcessing] = useState(false);
  const isProcessingRef = useRef(false);

  const [results, setResults] = useState<OCRItem[]>(() => {
    const saved = localStorage.getItem("aluminorte_results");
    return saved ? JSON.parse(saved) : [];
  });

  const [validationReports, setValidationReports] = useState<OCRValidationReport[]>([]);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [reportingErrorIdx, setReportingErrorIdx] = useState<number | null>(null);
  const [massEditValue, setMassEditValue] = useState<{
    acabamento?: string;
    preco?: string;
    comprimento?: string;
  }>({});
  const [extraPrices, setExtraPrices] = useState<Record<string, string>>(() => {
    const saved = localStorage.getItem("aluminorte_extra_prices");
    return saved ? JSON.parse(saved) : {};
  });
  const [colorCodeInput, setColorCodeInput] = useState("");
  const [colorPriceInput, setColorPriceInput] = useState("");
  const [charsToRemove, setCharsToRemove] = useState("");
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [prefixText, setPrefixText] = useState("");
  const [suffixText, setSuffixText] = useState("");
  const [massEditTab, setMassEditTab] = useState<'alterar' | 'apagar' | 'substituir' | 'incluir'>('alterar');
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isTextModalOpen, setIsTextModalOpen] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [isProcessingText, setIsProcessingText] = useState(false);
  const [textStep, setTextStep] = useState<'input' | 'columnSelect'>('input');
  const [parsedTextLines, setParsedTextLines] = useState<string[][]>([]);
  const [selectedQuantityCol, setSelectedQuantityCol] = useState<number | null>(null);
  const resultsTableRef = useRef<HTMLDivElement>(null);
  const [accessName, setAccessName] = useState(() => localStorage.getItem("aluminorte_access_name") || "");
  const [accessNameInput, setAccessNameInput] = useState(() => localStorage.getItem("aluminorte_access_name") || "");
  const [accessError, setAccessError] = useState<string | null>(null);
  const [isRegisteringAccess, setIsRegisteringAccess] = useState(false);
  const [isIdentifyingAccess, setIsIdentifyingAccess] = useState(() => !localStorage.getItem("aluminorte_access_name"));
  const accessRegisteredRef = useRef(false);

  // Grouped results â€” only computed when aglutinar is off and there are multiple sources
  const groupedResults = useMemo(() => {
    const sourceIds = [...new Set(results.map(r => r.sourceFileId).filter(Boolean))];
    if (aglutinar || sourceIds.length <= 1) return null;

    const groups: { fileId: string; fileName: string; items: { item: OCRItem; globalIdx: number }[] }[] = [];
    const seen = new Map<string, number>();

    results.forEach((item, globalIdx) => {
      const fileId = item.sourceFileId || "__unknown__";
      const fileName = item.sourceFileName || "Documento";
      if (!seen.has(fileId)) {
        seen.set(fileId, groups.length);
        groups.push({ fileId, fileName, items: [] });
      }
      groups[seen.get(fileId)!].items.push({ item, globalIdx });
    });

    return groups;
  }, [results, aglutinar]);

  useEffect(() => {
    localStorage.setItem("aluminorte_aglutinar", String(aglutinar));
  }, [aglutinar]);

  useEffect(() => {
    localStorage.setItem("aluminorte_prices", JSON.stringify(prices));
  }, [prices]);

  useEffect(() => {
    localStorage.setItem("aluminorte_furo_price", furoPrice);
  }, [furoPrice]);

  useEffect(() => {
    localStorage.setItem("aluminorte_extra_prices", JSON.stringify(extraPrices));
  }, [extraPrices]);

  useEffect(() => {
    localStorage.setItem("aluminorte_results", JSON.stringify(results));
  }, [results]);

  const normalizeAccessName = (value: string) => (
    value.trim().replace(/\s+/g, " ").split(" ")[0].replace(/[^\p{L}'-]/gu, "").slice(0, 30)
  );

  const registerAccessName = async (name: string) => {
    const normalizedName = normalizeAccessName(name);
    if (!normalizedName) {
      setAccessError("Informe seu primeiro nome para acessar.");
      return false;
    }

    setIsRegisteringAccess(true);
    setAccessError(null);
    try {
      localStorage.setItem("aluminorte_access_name", normalizedName);
      setAccessName(normalizedName);
      setAccessNameInput(normalizedName);
      accessRegisteredRef.current = true;

      await fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: 0, username: normalizedName }),
      });
      return true;
    } catch (err) {
      console.error("Erro ao registrar acesso", err);
      return true;
    } finally {
      setIsRegisteringAccess(false);
    }
  };

  useEffect(() => {
    if (accessName) {
      setIsIdentifyingAccess(false);
      return;
    }

    let cancelled = false;
    setIsIdentifyingAccess(true);

    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count: 0 }),
    })
      .then(response => response.json())
      .then(data => {
        if (cancelled) return;
        if (data.username && !data.needsName) {
          const normalizedName = normalizeAccessName(data.username);
          if (normalizedName) {
            localStorage.setItem("aluminorte_access_name", normalizedName);
            setAccessName(normalizedName);
            setAccessNameInput(normalizedName);
            accessRegisteredRef.current = true;
          }
        }
      })
      .catch(() => { })
      .finally(() => {
        if (!cancelled) setIsIdentifyingAccess(false);
      });

    return () => {
      cancelled = true;
    };
  }, [accessName]);

  useEffect(() => {
    if (!accessName || accessRegisteredRef.current) return;
    accessRegisteredRef.current = true;
    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count: 0, username: accessName }),
    }).catch(() => { });
  }, [accessName]);

  const trackUsage = (count = 1) => {
    if (!accessName) return;
    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count, username: accessName }),
    }).catch(() => { });
  };

  const handlePriceChange = (key: keyof Prices, value: string) => {
    setPrices(prev => ({ ...prev, [key]: value }));
  };

  const addColorPrice = () => {
    const code = colorCodeInput.trim().toUpperCase();
    const price = colorPriceInput.trim();
    if (!code || !price) return;
    setExtraPrices((prev: Record<string, string>) => ({ ...prev, [code]: price }));
    setColorCodeInput("");
    setColorPriceInput("");
  };

  const removeColorPrice = (code: string) => {
    setExtraPrices((prev: Record<string, string>) => { const n = { ...prev }; delete n[code]; return n; });
  };

  const handleFiles = (files: FileList | File[]) => {
    if (files && files.length > 0) {
      const newFiles = Array.from(files).map(file => ({
        id: generateId(),
        file,
        status: 'pending' as const,
      }));
      setQueue(prev => [...prev, ...newFiles]);
      setError(null);
      setTimeout(processQueue, 100);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) handleFiles(e.target.files);
  };

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
  };

  const removeFromQueue = (id: string) => {
    setQueue(prev => prev.filter(item => item.id !== id));
  };

  const fileToBase64 = (file: File): Promise<string> => {
    const MAX_DIMENSION = 1600;
    const JPEG_QUALITY = 0.85;

    return new Promise((resolve, reject) => {
      if (!file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result?.toString().split(",")[1] || "");
        reader.onerror = reject;
        return;
      }

      const img = new Image();
      const objectUrl = URL.createObjectURL(file);

      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        let { width, height } = img;

        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
          if (width > height) {
            height = Math.round((height * MAX_DIMENSION) / width);
            width = MAX_DIMENSION;
          } else {
            width = Math.round((width * MAX_DIMENSION) / height);
            height = MAX_DIMENSION;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("Canvas não suportado")); return; }
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
        resolve(dataUrl.split(",")[1] || "");
      };

      img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("Falha ao carregar imagem")); };
      img.src = objectUrl;
    });
  };

  const processQueue = async () => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;
    setIsProcessing(true);
    setError(null);

    while (true) {
      let currentItem: QueueItem | undefined;

      const currentQueue = queueRef.current;
      const index = currentQueue.findIndex(item => item.status === 'pending' || item.status === 'paused');

      if (index !== -1) {
        currentItem = currentQueue[index];
        setQueue(prev => {
          const nextQueue = [...prev];
          const syncIndex = nextQueue.findIndex(item => item.id === currentItem!.id);
          if (syncIndex !== -1) {
            nextQueue[syncIndex] = { ...nextQueue[syncIndex], status: 'processing' };
          }
          return nextQueue;
        });
      }

      if (!currentItem) break;

      try {
        const base64 = await fileToBase64(currentItem.file);
        const response = await performOCR(base64, currentItem.file.type, currentItem.file.name);
        const finalItems = (response.items || []).map(item => ({
          ...item,
          id: item.id || generateId(),
          sourceFileId: item.sourceSheetName ? `${currentItem!.id}_${item.sourceSheetName}` : currentItem!.id,
          sourceFileName: item.sourceSheetName ? `${currentItem!.file.name} - ${item.sourceSheetName}` : currentItem!.file.name,
        }));

        if (finalItems.length === 0) {
          const emptyMessage = "Nenhum produto foi identificado neste arquivo. Tente reenviar o PDF/imagem com mais nitidez ou use Inserir texto manualmente.";
          setError(emptyMessage);
          setQueue(prev =>
            prev.map(item =>
              item.id === currentItem!.id
                ? { ...item, status: 'error', error: emptyMessage, resultCount: 0 }
                : item
            )
          );
        } else {
          const startIndex = results.length;
          setResults(prev => {
            const next = [...prev, ...finalItems];
            return next;
          });

          setSelectedIndices(prevSel => {
            const nextSel = new Set(prevSel);
            for (let j = 0; j < finalItems.length; j++) {
              nextSel.add(startIndex + j);
            }
            return nextSel;
          });

          setQueue(prev =>
            prev.map(item =>
              item.id === currentItem!.id
                ? { ...item, status: 'done', resultCount: finalItems.length }
                : item
            )
          );

          if (response.validationReport) {
            setValidationReports(prev => [...prev, response.validationReport!]);
          }

          // Track OCR usage (fire-and-forget)
          trackUsage(1);

          // Scroll to results after first file completes
          setTimeout(() => {
            resultsTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 300);
        }
      } catch (err: any) {
        if (!(err instanceof OCRRetryableError)) {
          console.error(err);
        }
        const errorMsg = err.message || "";
        const retryCount = (currentItem.retryCount || 0) + 1;

        let isTransientError =
          err instanceof OCRRetryableError ||
          errorMsg.includes("429") ||
          errorMsg.includes("500") ||
          errorMsg.includes("Limite") ||
          errorMsg.includes("Cota") ||
          errorMsg.includes("503") ||
          errorMsg.includes("demand") ||
          errorMsg.includes("FUNCTION_INVOCATION_FAILED") ||
          errorMsg.includes("modelos ativos falharam");

        // Erros de cota da API (retryAfterMs alto) são retentados indefinidamente;
        // erros de timeout/servidor têm backoff exponencial com limite de 12 tentativas.
        const baseRetryMs = err instanceof OCRRetryableError
          ? Math.max(err.retryAfterMs, 5_000)
          : (errorMsg.includes("FUNCTION_INVOCATION_FAILED") ? 8_000 : 60_000);

        const isQuotaError = err instanceof OCRRetryableError && err.retryAfterMs >= 30_000;
        const MAX_SERVER_RETRIES = 12;

        const retryAfterMs = isQuotaError
          ? baseRetryMs
          : Math.min(baseRetryMs * (1.5 ** Math.min(retryCount - 1, 4)), 300_000);

        const reachedRetryLimit = !isQuotaError && retryCount > MAX_SERVER_RETRIES;

        if (isTransientError && !reachedRetryLimit) {
          const waitLabel = formatRetryWait(retryAfterMs);

          setQueue(prev =>
            prev.map(item =>
              item.id === currentItem!.id
                ? { ...item, status: 'paused', retryCount, error: `Aguardando. Tentativa ${retryCount}${!isQuotaError ? `/${MAX_SERVER_RETRIES}` : ""}. Retomando automaticamente em ${waitLabel}.` }
                : item
            )
          );
          await new Promise(resolve => setTimeout(resolve, retryAfterMs));
          continue;
        } else {
          const finalErrorMsg = reachedRetryLimit
            ? `Falha persistente após ${MAX_SERVER_RETRIES} tentativas. Verifique a conexão ou tente um arquivo menor/mais nítido.`
            : (errorMsg || "Erro desconhecido.");

          setQueue(prev =>
            prev.map(item =>
              item.id === currentItem!.id
                ? { ...item, status: 'error', error: finalErrorMsg }
                : item
            )
          );
        }
      }

      const hasMore = queueRef.current.some(
        item => item.status === 'pending' || item.status === 'paused'
      );
      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 6000)); // 6s de respiro para respeitar a cota gratuita de 15 RPM de forma segura
      }
    }

    setIsProcessing(false);
    isProcessingRef.current = false;
  };

  const getFinalPrice = (item: OCRItem) => {
    if (item.preco !== undefined) return item.preco;
    const code = normalizeAcabamentoCode(item.acabamento || "NT");
    const globalPrice = parseFloat(extraPrices[code] ?? prices[code as keyof Prices] ?? "0");
    let priceVal = globalPrice;
    if (isFuroCode(item.produto)) {
      priceVal += parseFloat(furoPrice || "0");
    }
    return priceVal;
  };

  const formatItemForExport = (item: OCRItem) => {
    const priceVal = getFinalPrice(item);
    const finalAcabamento = normalizeAcabamentoCode(item.acabamento || "NT");
    return { PRODUTO: item.produto, ACABAMENTO: finalAcabamento, QTDE: item.qtde, "PREÇO": priceVal, COMPRIMENTO: item.comprimento };
  };


  const downloadCSV = (items: OCRItem[], filename: string) => {
    const formatted = items.map(item => {
      const priceVal = getFinalPrice(item);
      const finalAcabamento = normalizeAcabamentoCode(item.acabamento || "NT");
      return {
        PRODUTO: item.produto,
        ACABAMENTO: finalAcabamento,
        QTDE: item.qtde,
        "PREÇO": priceVal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
        COMPRIMENTO: item.comprimento,
      };
    });

    const ws = XLSX.utils.json_to_sheet(formatted);
    const csv = XLSX.utils.sheet_to_csv(ws, { FS: ";" });

    // ANSI encoding for Excel compatibility
    const buffer = new Uint8Array(csv.length);
    for (let i = 0; i < csv.length; i++) buffer[i] = csv.charCodeAt(i) & 0xff;

    const blob = new Blob([buffer], { type: "text/csv;charset=windows-1252;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const exportToCSV = () => {
    if (results.length === 0) return;

    const selectedItems = results.filter((_: OCRItem, i: number) => selectedIndices.has(i));
    if (selectedItems.length === 0) {
      setError("Selecione pelo menos um item para exportar.");
      return;
    }

    // Auto-aprendizado: Salva produtos exportados não-verificados no catálogo
    const unverifiedProducts = selectedItems
      .filter((item: OCRItem) => {
        if (item.verificadoNoCatalogo) return false;
        if (item.corrigidoManualmente) return false;
        const origClean = (item.produtoOriginal || "").replace(/\s+/g, "").toUpperCase();
        const currClean = (item.produto || "").replace(/\s+/g, "").toUpperCase();
        return !item.produtoOriginal || origClean === currClean;
      })
      .map((item: OCRItem) => item.produto);
    
    if (unverifiedProducts.length > 0) {
      saveAutoCatalogProducts(unverifiedProducts).catch(err => console.warn("Falha no autoaprendizado:", err));
      
      // Atualiza visualmente
      setResults(prev => prev.map((item, i) => 
        selectedIndices.has(i) && !item.verificadoNoCatalogo && !item.corrigidoManualmente
          ? { ...item, verificadoNoCatalogo: true, identificado: true }
          : item
      ));
    }

    if (!aglutinar && groupedResults) {
      // One CSV download per source document (with 400ms delay between each)
      groupedResults.forEach((group: typeof groupedResults[0], groupIdx: number) => {
        const groupSelected = group.items
          .filter(({ globalIdx }) => selectedIndices.has(globalIdx))
          .map(({ item }) => item);
        if (groupSelected.length === 0) return;
        const baseName = group.fileName.replace(/\.[^.]+$/, "").replace(/\s+/g, "_");
        setTimeout(() => {
          downloadCSV(groupSelected, `${baseName}_${new Date().getTime()}.csv`);
        }, groupIdx * 400);
      });
    } else {
      downloadCSV(selectedItems, `extracao_perfis_${new Date().getTime()}.csv`);
    }
  };

  const reset = () => {
    if (isProcessing) return;
    setQueue([]);
    setResults([]);
    setValidationReports([]);
    localStorage.removeItem("aluminorte_results");
    setSelectedIndices(new Set());
    setEditingIdx(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const toggleSelectAll = () => {
    if (selectedIndices.size === results.length) {
      setSelectedIndices(new Set());
    } else {
      setSelectedIndices(new Set(results.map((_, i) => i)));
    }
  };

  const toggleSelect = (idx: number) => {
    const next = new Set(selectedIndices);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    setSelectedIndices(next);
  };

  const updateItem = (idx: number, updates: Partial<OCRItem>) => {
    const next = [...results];
    const currentItem = next[idx];
    let corrigidoManualmente = currentItem.corrigidoManualmente;

    if (updates.produto !== undefined) {
      const orig = currentItem.produtoOriginal || "";
      const curr = updates.produto;
      if (orig.replace(/\s+/g, "").toUpperCase() !== curr.replace(/\s+/g, "").toUpperCase()) {
        corrigidoManualmente = true;
      }
    }

    next[idx] = { 
      ...currentItem, 
      ...updates,
      ...(corrigidoManualmente !== undefined ? { corrigidoManualmente } : {})
    };
    setResults(next);
  };

  const handleAddItem = () => {
    const newItem: OCRItem = {
      id: generateId(),
      produto: "",
      produtoOriginal: "",
      acabamento: "NT",
      qtde: 1,
      comprimento: 6000,
      identificado: true,
      verificadoNoCatalogo: false,
      preserveProductCode: true,
      corrigidoManualmente: true,
    };

    setResults(prev => [newItem, ...prev]);
    setSelectedIndices(prevSel => {
      const nextSel = new Set<number>([0]);
      prevSel.forEach(idx => nextSel.add(idx + 1));
      return nextSel;
    });
    setReportingErrorIdx(null);
    setEditingIdx(0);
    setTimeout(() => {
      resultsTableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  const applyMassEdit = () => {
    const next = [...results];
    selectedIndices.forEach(idx => {
      const updates: Partial<OCRItem> = {};
      if (massEditValue.acabamento) updates.acabamento = massEditValue.acabamento.toUpperCase();
      if (massEditValue.preco) updates.preco = Number(massEditValue.preco);
      if (massEditValue.comprimento) updates.comprimento = Number(massEditValue.comprimento);
      next[idx] = { ...next[idx], ...updates };
    });
    setResults(next);
    setMassEditValue({});
  };

  const applyRemoveChars = () => {
    if (charsToRemove.length === 0) return;
    const next = [...results];
    selectedIndices.forEach(idx => {
      let val = next[idx].produto;
      charsToRemove.split("").forEach(char => {
        val = val.split(char).join("");
      });
      next[idx] = { ...next[idx], produto: val.trim() };
    });
    setResults(next);
    setCharsToRemove("");
  };

  const applyReplaceText = () => {
    if (!findText) return;
    const next = [...results];
    selectedIndices.forEach(idx => {
      let val = next[idx].produto;
      val = val.split(findText).join(replaceText);
      next[idx] = { ...next[idx], produto: val.trim() };
    });
    setResults(next);
    setFindText("");
    setReplaceText("");
  };

  const applyAddFixes = () => {
    if (!prefixText && !suffixText) return;
    const next = [...results];
    selectedIndices.forEach(idx => {
      let val = next[idx].produto;
      if (prefixText) val = prefixText + val;
      if (suffixText) val = val + suffixText;
      next[idx] = { ...next[idx], produto: val };
    });
    setResults(next);
    setPrefixText("");
    setSuffixText("");
  };

  const handleDelete = (idx: number) => {
    const next = results.filter((_, i) => i !== idx);
    setResults(next);
    localStorage.setItem("aluminorte_results", JSON.stringify(next));

    setSelectedIndices(prevSel => {
      const nextSel = new Set<number>();
      prevSel.forEach(i => {
        if (i < idx) nextSel.add(i);
        else if (i > idx) nextSel.add(i - 1);
      });
      return nextSel;
    });
  };

  const handleSaveEdit = async (idx: number) => {
    const item = results[idx];
    const orig = item.produtoOriginal ? item.produtoOriginal.replace(/\s+/g, "").toUpperCase() : "";
    const curr = item.produto.replace(/\s+/g, "").toUpperCase();
    const wasReported = reportingErrorIdx === idx;

    setEditingIdx(null);
    setReportingErrorIdx(null);

    if (orig && curr && orig !== curr) {
      const teachSystem =
        wasReported ||
        window.confirm(
          `Deseja ensinar ao sistema que "${orig}" deve ser automaticamente convertido para "${curr}" nas próximas vezes?`
        );

      if (teachSystem) {
        // Atualização otimista
        const next = [...results];
        next[idx] = { ...next[idx], identificado: true, verificadoNoCatalogo: true, corrigidoManualmente: true };
        setResults(next);
        localStorage.setItem("aluminorte_results", JSON.stringify(next));

        try {
          await fetch("/api/save-catalog", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ products: [], aliasItem: { badCode: orig, goodCode: curr } }),
          });
        } catch (err) {
          console.error("Falha ao salvar a regra de memória", err);
        }
      } else {
        const next = [...results];
        next[idx] = { ...next[idx], corrigidoManualmente: true };
        setResults(next);
        localStorage.setItem("aluminorte_results", JSON.stringify(next));
      }
    }
  };

  const handleBlacklist = async (idx: number) => {
    const item = results[idx];
    const code = item.produtoOriginal || item.produto;

    if (window.confirm(`Deseja negativar o código "${code}"? Ele não será mais identificado como produto nas próximas leituras.`)) {
      handleDelete(idx);
      try {
        await blacklistCode(code);
      } catch (err) {
        console.error("Erro ao negativar código", err);
      }
    }
  };

  const handleMarkAsFuro = async (idx: number) => {
    const item = results[idx];
    const oldCode = item.produto;
    if (oldCode.toUpperCase().endsWith("CF")) return;

    const newCode = oldCode + "CF";

    // Aplica correção visual otimista
    const next = [...results];
    next[idx] = { ...next[idx], produto: newCode, corrigidoManualmente: true };
    setResults(next);
    localStorage.setItem("aluminorte_results", JSON.stringify(next));

    // Salva silenciosamente como um aprendizado no Banco de Dados (ex: VZ051 -> VZ051CF)
    try {
      await fetch("/api/save-catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aliasItem: { badCode: oldCode, goodCode: newCode } }),
      });
    } catch (err) {
      console.error("Erro ao salvar regra CF no catálogo:", err);
    }
  };

  const handleAcceptSubstitution = (idx: number) => {
    const item = results[idx];
    const suggestion = item.substituicao?.produtoSugerido;
    if (!suggestion) return;

    const next = [...results];
    next[idx] = {
      ...item,
      produto: suggestion,
      identificado: true,
      corrigidoManualmente: true,
      substituicao: item.substituicao
        ? { ...item.substituicao, status: "accepted" }
        : undefined,
    } as OCRItem;
    setResults(next);
  };

  const handleDeclineSubstitution = (idx: number) => {
    const item = results[idx];
    if (!item.substituicao) return;

    const next = [...results];
    next[idx] = {
      ...item,
      substituicao: { ...item.substituicao, status: "declined" },
    };
    setResults(next);
  };

  const handleCloseTextModal = () => {
    if (isProcessingText) return;
    setIsTextModalOpen(false);
    setTextStep('input');
    setTextInput('');
    setSelectedQuantityCol(null);
    setParsedTextLines([]);
  };

  const handleAnalyzeColumns = () => {
    const lines = textInput
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean)
      .slice(0, 8)
      .map(l => l.split(/\s+/));
    if (lines.length === 0) return;
    const maxC = Math.max(...lines.map(l => l.length));
    let bestCol = 0;
    let bestScore = -1;
    for (let c = 0; c < maxC; c++) {
      let score = 0;
      for (const row of lines) {
        const t = row[c];
        if (!t) continue;
        const n = parseInt(t, 10);
        if (!isNaN(n) && n > 0 && n < 2500 && String(n) === t) score++;
      }
      if (score > bestScore) { bestScore = score; bestCol = c; }
    }
    setParsedTextLines(lines);
    setSelectedQuantityCol(bestScore > 0 ? bestCol : null);
    setTextStep('columnSelect');
  };

  const handleProcessText = async () => {
    if (!textInput.trim()) return;

    setIsProcessingText(true);
    setError(null);

    try {
      const response = await performOCRFromText(textInput, selectedQuantityCol !== null ? selectedQuantityCol : undefined);
      const newItems = response.items || [];

      if (newItems.length === 0) {
        setError("Nenhum item foi extraído do texto. Verifique o formato e tente novamente.");
      } else {
        const finalItems = newItems.map(it => ({ ...it, id: it.id || generateId() }));
        const startIndex = results.length;

        setResults(prev => [...prev, ...finalItems]);
        setSelectedIndices(prevSel => {
          const nextSel = new Set(prevSel);
          for (let j = 0; j < finalItems.length; j++) {
            nextSel.add(startIndex + j);
          }
          return nextSel;
        });

        if (response.validationReport) {
          setValidationReports(prev => [...prev, response.validationReport!]);
        }

        setIsTextModalOpen(false);
        setTextInput("");
        setTextStep('input');
        setSelectedQuantityCol(null);
        setParsedTextLines([]);
        trackUsage(1);

        setTimeout(() => {
          resultsTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 300);
      }
    } catch (err: any) {
      if (err instanceof OCRRetryableError) {
        const waitLabel = formatRetryWait(Math.max(err.retryAfterMs, 5_000));
        setError(`Gemini em standby por cota. Aguarde ${waitLabel} e tente novamente.`);
      } else {
        console.error(err);
        setError(err.message || "Ocorreu um erro ao processar o texto.");
      }
    } finally {
      setIsProcessingText(false);
    }
  };

  if (!accessName && currentView !== "users" && currentView !== "hub" && isIdentifyingAccess) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-50 flex items-center justify-center p-4 font-sans">
        <Card className="w-full max-w-sm border-none ring-1 ring-slate-900/5 shadow-lg shadow-slate-900/5 rounded-2xl bg-white">
          <CardContent className="py-10 flex items-center justify-center text-slate-500 text-sm">
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Verificando acesso...
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!accessName && currentView !== "users" && currentView !== "hub") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-50 flex items-center justify-center p-4 font-sans">
        <Card className="w-full max-w-sm border-none ring-1 ring-slate-900/5 shadow-lg shadow-slate-900/5 rounded-2xl bg-white">
          <CardHeader className="text-center space-y-3">
            <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <UserRound className="w-6 h-6 text-primary" />
            </div>
            <div>
              <CardTitle className="text-xl text-slate-900">Identificação de acesso</CardTitle>
              <CardDescription>Informe seu primeiro nome para usar o OCR.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={async (event) => {
                event.preventDefault();
                await registerAccessName(accessNameInput);
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="access-name">Primeiro nome</Label>
                <Input
                  id="access-name"
                  value={accessNameInput}
                  onChange={(event) => {
                    setAccessNameInput(event.target.value);
                    setAccessError(null);
                  }}
                  placeholder="Ex: Ana"
                  autoFocus
                  maxLength={30}
                  disabled={isRegisteringAccess}
                />
              </div>
              {accessError && (
                <div className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {accessError}
                </div>
              )}
              <Button type="submit" className="w-full" disabled={isRegisteringAccess}>
                {isRegisteringAccess ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                Entrar
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (currentView === 'hub') {
    return <Hub navigateTo={navigateTo} hubLinks={hubLinks} />;
  }

  if (currentView === 'config') {
    return <Config hubLinks={hubLinks} setHubLinks={setHubLinks} navigateTo={navigateTo} />;
  }

  return (
    <>
      {currentView !== 'hub' && currentView !== 'config' && (
        <div className="fixed bottom-6 left-6 z-[9999] md:bottom-8 md:left-8">
          <Button 
            size="lg"
            onClick={() => navigateTo('hub')}
            className="rounded-full shadow-xl bg-slate-900 hover:bg-slate-800 text-white flex items-center gap-3 px-5 md:px-6 h-12 md:h-14 transition-all hover:scale-105 active:scale-95 ring-4 ring-white/50"
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="font-semibold text-sm md:text-base">Menu Principal</span>
          </Button>
        </div>
      )}

      <AnimatePresence>
        {isTextModalOpen && (
          <div
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={handleCloseTextModal}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <Card className="border-none shadow-none">
                {textStep === 'input' ? (
                  <>
                    <CardHeader>
                      <CardTitle>Inserir Texto Manualmente</CardTitle>
                      <CardDescription>Cole o texto do seu pedido abaixo. O sistema irá identificar os códigos dos produtos.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="relative">
                        <Textarea
                          className="w-full h-64 p-3 border rounded-lg font-mono text-sm bg-slate-50 focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-shadow"
                          placeholder={`Exemplo:\n25548 NT 10 6000\nLG028 EPPF 5 3000\nSU-001 BRANCO 20 6.0M`}
                          value={textInput}
                          maxLength={6000}
                          onChange={(e) => setTextInput(e.target.value)}
                          autoFocus
                        />
                        <span className={`absolute bottom-2 right-3 text-[10px] tabular-nums pointer-events-none ${textInput.length > 5500 ? "text-red-400 font-bold" : "text-slate-400"}`}>
                          {textInput.length}/6000
                        </span>
                      </div>
                    </CardContent>
                    <CardFooter className="flex justify-end gap-2 bg-slate-50 p-4 border-t">
                      <Button variant="ghost" onClick={handleCloseTextModal}>
                        Cancelar
                      </Button>
                      <Button onClick={handleAnalyzeColumns} disabled={!textInput.trim()}>
                        Próximo
                      </Button>
                    </CardFooter>
                  </>
                ) : (
                  <>
                    <CardHeader>
                      <CardTitle>Qual coluna é a quantidade?</CardTitle>
                      <CardDescription>
                        Identificamos {parsedTextLines.length} linha(s). Clique na coluna que representa a QUANTIDADE de cada item.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {(() => {
                        const maxCols = parsedTextLines.length > 0
                          ? Math.min(Math.max(...parsedTextLines.map(l => l.length)), 8)
                          : 0;
                        return (
                          <div className="overflow-x-auto rounded-lg border border-slate-200">
                            <table className="w-full text-sm font-mono">
                              <thead>
                                <tr>
                                  {Array.from({ length: maxCols }, (_, i) => (
                                    <th key={i} className="p-0 border-r last:border-r-0 border-slate-200">
                                      <button
                                        onClick={() => setSelectedQuantityCol(i)}
                                        className={`w-full px-3 py-2 text-center text-xs font-semibold transition-colors ${
                                          selectedQuantityCol === i
                                            ? 'bg-primary text-white'
                                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                        }`}
                                      >
                                        Coluna {i + 1}
                                      </button>
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {parsedTextLines.map((tokens, rowIdx) => (
                                  <tr key={rowIdx} className={rowIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                                    {Array.from({ length: maxCols }, (_, colIdx) => (
                                      <td
                                        key={colIdx}
                                        onClick={() => setSelectedQuantityCol(colIdx)}
                                        className={`px-3 py-1.5 text-center cursor-pointer border-r last:border-r-0 border-slate-100 transition-colors ${
                                          selectedQuantityCol === colIdx
                                            ? 'bg-primary/10 text-primary font-semibold'
                                            : 'hover:bg-slate-100'
                                        }`}
                                      >
                                        {tokens[colIdx] ?? <span className="text-slate-300">—</span>}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        );
                      })()}
                      {error && !isProcessingText && (
                        <Alert variant="destructive">
                          <AlertCircle className="h-4 w-4" />
                          <AlertTitle>Erro</AlertTitle>
                          <AlertDescription>{error}</AlertDescription>
                        </Alert>
                      )}
                    </CardContent>
                    <CardFooter className="flex justify-between gap-2 bg-slate-50 p-4 border-t">
                      <Button variant="ghost" onClick={() => setTextStep('input')} disabled={isProcessingText}>
                        ← Voltar
                      </Button>
                      <div className="flex gap-2">
                        <Button variant="ghost" onClick={handleCloseTextModal} disabled={isProcessingText}>
                          Cancelar
                        </Button>
                        <Button onClick={handleProcessText} disabled={isProcessingText || selectedQuantityCol === null}>
                          {isProcessingText ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              Processando...
                            </>
                          ) : "Analisar e Adicionar"}
                        </Button>
                      </div>
                    </CardFooter>
                  </>
                )}
              </Card>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        <motion.div
          key="app"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-50 p-4 md:p-8 font-sans"
          onPaste={(e) => {
            const items = e.clipboardData?.items;
            if (!items) return;
            const files: File[] = [];
            for (let i = 0; i < items.length; i++) {
              if (items[i].type.indexOf('image') !== -1) {
                const file = items[i].getAsFile();
                if (file) files.push(file);
              }
            }
            if (files.length > 0) {
              handleFiles(files);
            }
          }}
        >
          <div className="max-w-7xl mx-auto space-y-8">
            <header className="flex flex-col md:flex-row items-center justify-between gap-4 bg-white/80 backdrop-blur p-4 md:p-5 rounded-2xl shadow-sm ring-1 ring-slate-900/5">
              <div className="flex items-center gap-3 md:gap-4">
                <img
                  src="/logo.png"
                  alt="Aluminorte Logo"
                  className="h-8 md:h-10 object-contain cursor-pointer"
                  onClick={() => navigateTo('hub')}
                />
                <Separator orientation="vertical" className="h-10 hidden md:block bg-slate-200" />
                <div className="text-center md:text-left">
                  <h1 className="text-xl md:text-2xl font-bold tracking-tight text-slate-900">
                    OCR de Perfis
                  </h1>
                  <p className="text-sm text-slate-500">Extraia dados e gere planilhas precificadas.</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                {accessName && (
                  <Badge
                    variant="outline"
                    className="bg-slate-50 text-slate-600 border-slate-200 px-3 py-1 cursor-pointer"
                    title="Clique para trocar o usuário desta máquina"
                    onClick={() => {
                      localStorage.removeItem("aluminorte_access_name");
                      accessRegisteredRef.current = false;
                      setAccessName("");
                      setAccessNameInput("");
                    }}
                  >
                    <UserRound className="w-3 h-3 mr-1" />
                    {accessName}
                  </Badge>
                )}
                <TooltipWrapper content="Acesse a Base de Conhecimento e Versão (Duplo Clique)">
                  <Badge
                    variant="outline"
                    className="bg-primary/10 text-primary border-primary/20 px-3 py-1 font-bold cursor-help"
                    onDoubleClick={() => navigateTo('admin')}
                  >
                    v1.6.0
                  </Badge>
                </TooltipWrapper>
                <TooltipWrapper content="Voltar ao Portal Hub">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => navigateTo('hub')}
                    className="text-slate-500 hover:text-primary hover:bg-primary/5 rounded-full outline-none"
                  >
                    <Layers className="w-5 h-5" />
                  </Button>
                </TooltipWrapper>
                <TooltipWrapper content="Editar itens de conversão e sugestão">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => navigateTo('substitutions')}
                    className="text-slate-500 hover:text-primary hover:bg-primary/5 rounded-full outline-none"
                  >
                    <ListChecks className="w-5 h-5" />
                  </Button>
                </TooltipWrapper>
                <TooltipWrapper content="Central de Ajuda e Explicação Visuais">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => navigateTo('help')}
                    className="text-slate-500 hover:text-primary hover:bg-primary/5 rounded-full outline-none"
                  >
                    <HelpCircle className="w-5 h-5" />
                  </Button>
                </TooltipWrapper>
              </div>
            </header>

            {currentView === 'users' ? (
              <Users />
            ) : currentView === 'substitutions' ? (
              <Substitutions onBack={() => navigateTo('ocr-perfis')} />
            ) : currentView === 'admin' ? (
              <Admin onBack={() => navigateTo('ocr-perfis')} />
            ) : currentView === 'help' ? (
              <Help onBack={() => navigateTo('ocr-perfis')} />
            ) : (
              <>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  <div className="space-y-8">
                    {/* Precos por Cor */}
                    <Card className="bg-white border-none ring-1 ring-slate-900/5 shadow-lg shadow-slate-900/5 rounded-2xl overflow-hidden">
                      <CardHeader className="border-b border-slate-100 pb-4">
                        <div className="flex items-center gap-3">
                          <span className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0">
                            <Banknote className="w-4 h-4" />
                          </span>
                          <div>
                            <CardTitle className="text-base font-bold tracking-tight text-slate-900">Preços por Cor</CardTitle>
                            <CardDescription className="text-sm text-slate-500">Preço por barra, por acabamento.</CardDescription>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="pt-4 space-y-4">
                        {/* Fixed codes */}
                        <div className="divide-y divide-slate-100">
                          {(["NT", "EPPF", "EBCO", "FOS"] as const).map((key) => (
                            <div key={key} className="flex items-center justify-between gap-3 py-2 first:pt-0">
                              <Label htmlFor={`price-${key}`} className="font-mono text-[13px] font-bold text-slate-800 tracking-tight">{key}</Label>
                              <div className="relative w-28">
                                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-slate-400 pointer-events-none">R$</span>
                                <Input
                                  id={`price-${key}`}
                                  type="number"
                                  className="h-8 pl-8 text-right tabular-nums font-mono text-xs bg-slate-50 text-slate-900 placeholder:text-slate-400 border border-slate-200 rounded-lg focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:border-primary/50"
                                  value={prices[key]}
                                  onChange={(e) => handlePriceChange(key, e.target.value)}
                                  placeholder="0,00"
                                />
                              </div>
                            </div>
                          ))}
                          <div className="flex items-center justify-between gap-3 py-2">
                            <Label htmlFor="price-furo" className="text-xs text-slate-500 font-semibold">
                              Adicional p/ furo
                              <span className="ml-1.5 font-mono text-[11px] font-bold text-slate-400">CF</span>
                            </Label>
                            <div className="relative w-28">
                              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-slate-400 pointer-events-none">R$</span>
                              <Input
                                id="price-furo"
                                type="number"
                                className="h-8 pl-8 text-right tabular-nums font-mono text-xs bg-slate-50 text-slate-900 placeholder:text-slate-400 border border-slate-200 rounded-lg focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:border-primary/50"
                                value={furoPrice}
                                onChange={(e) => setFuroPrice(e.target.value)}
                                placeholder="0,00"
                              />
                            </div>
                          </div>
                        </div>

                        {/* Custom code entry */}
                        <div className="rounded-xl bg-slate-50/70 border border-slate-100 p-3 space-y-2">
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Outra cor</p>
                          <div className="flex gap-2">
                            <Input
                              className="h-8 flex-1 uppercase font-mono text-xs bg-white text-slate-900 placeholder:text-slate-400 placeholder:normal-case placeholder:font-sans border border-slate-200 rounded-lg focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:border-primary/50"
                              placeholder="Ex: RAL9005"
                              maxLength={10}
                              value={colorCodeInput}
                              onChange={(e) => setColorCodeInput(e.target.value.toUpperCase())}
                              onKeyDown={(e) => e.key === "Enter" && addColorPrice()}
                              aria-label="Código da cor"
                            />
                            <div className="relative w-24">
                              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-slate-400 pointer-events-none">R$</span>
                              <Input
                                type="text"
                                inputMode="decimal"
                                className="h-8 pl-8 text-right tabular-nums font-mono text-xs bg-white text-slate-900 placeholder:text-slate-400 border border-slate-200 rounded-lg focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:border-primary/50"
                                placeholder="0,00"
                                value={colorPriceInput}
                                onChange={(e) => setColorPriceInput(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && addColorPrice()}
                                aria-label="Preço da cor"
                              />
                            </div>
                            <Button
                              size="icon"
                              className="h-8 w-8 bg-primary hover:bg-primary/90 text-white rounded-lg shadow-sm shadow-primary/30 shrink-0"
                              onClick={addColorPrice}
                              disabled={!colorCodeInput || !colorPriceInput}
                              aria-label="Adicionar preço da cor"
                            >
                              <Plus className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>

                        {Object.keys(extraPrices).length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {Object.entries(extraPrices).map(([code, price]) => (
                              <span key={code} className="group flex items-center gap-1.5 bg-slate-50 text-slate-700 border border-slate-200 rounded-lg px-2 py-1 font-mono text-[11px] font-semibold">
                                {code}
                                <span className="text-slate-400 font-normal">R$ {price}</span>
                                <button
                                  onClick={() => removeColorPrice(code)}
                                  className="text-slate-300 hover:text-red-600 transition-colors"
                                  aria-label={`Remover preço de ${code}`}
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>

                  </div>

                  {/* Upload e Processamento */}
                  <Card className="lg:col-span-2 bg-white border-none ring-1 ring-slate-900/5 shadow-lg shadow-slate-900/5 rounded-2xl">
                    <CardHeader>
                      <div className="flex items-center gap-3">
                        <span className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0">
                          <FileText className="w-4 h-4" />
                        </span>
                        <div>
                          <CardTitle className="text-base md:text-lg font-bold tracking-tight text-slate-900">Upload do Documento</CardTitle>
                          <CardDescription className="text-sm text-slate-500">Arraste, selecione ou cole (Ctrl+V) o PDF ou Imagem do pedido.</CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div
                        onClick={() => fileInputRef.current?.click()}
                        onDragOver={onDragOver}
                        onDragLeave={onDragLeave}
                        onDrop={onDrop}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInputRef.current?.click(); } }}
                        className={`
                          group border-2 border-dashed rounded-3xl px-6 py-12 text-center cursor-pointer transition-all outline-none focus-visible:ring-2 focus-visible:ring-primary/40
                          ${isDragging ? 'border-primary bg-primary/5' : 'border-slate-300 bg-white hover:border-slate-400 hover:shadow-sm'}
                        `}
                      >
                        <input
                          type="file"
                          ref={fileInputRef}
                          className="hidden"
                          multiple
                          accept="image/*,application/pdf,.docx,.xlsx,.xls,.csv"
                          onChange={handleFileChange}
                        />
                        <input
                          type="file"
                          ref={cameraInputRef}
                          className="hidden"
                          accept="image/*,application/pdf,.docx,.xlsx,.xls,.csv"
                          capture="environment"
                          onChange={handleFileChange}
                        />
                        <div className="flex flex-col items-center gap-2">
                          <div className={`w-16 h-16 rounded-2xl text-white flex items-center justify-center mb-2 transition-all ${isDragging ? 'bg-primary scale-110 rotate-3' : 'bg-slate-900 group-hover:scale-105'}`}>
                            <Upload className="w-7 h-7" />
                          </div>
                          <span className="font-bold tracking-tight text-slate-900">
                            {isDragging ? 'Solte o arquivo aqui' : 'Arraste o documento ou clique para selecionar'}
                          </span>
                          <span className="text-sm text-slate-400">PDF · Imagem · Excel · Word · CSV — aceita vários arquivos de uma vez</span>
                        </div>
                      </div>

                      <div className="md:hidden">
                        <Button
                          type="button"
                          className="w-full flex items-center justify-center gap-2 h-16 text-lg font-bold shadow-md bg-primary hover:bg-primary/90"
                          onClick={(e) => {
                            e.stopPropagation();
                            cameraInputRef.current?.click();
                          }}
                        >
                          <Camera className="w-6 h-6" />
                          Tirar Foto do Pedido
                        </Button>
                      </div>

                      <div className="relative flex items-center">
                        <div className="flex-grow border-t border-slate-200"></div>
                        <span className="flex-shrink mx-4 text-xs text-slate-400">OU</span>
                        <div className="flex-grow border-t border-slate-200"></div>
                      </div>

                      <TooltipWrapper content="Cole transcrições manuais do WhatsApp ou E-mails">
                        <Button
                          variant="secondary"
                          className="w-full flex"
                          onClick={() => { setError(null); setIsTextModalOpen(true); setTextStep('input'); }}
                          disabled={isProcessing}
                        >
                          <FileText className="w-4 h-4 mr-2" />
                          Inserir texto manualmente
                        </Button>
                      </TooltipWrapper>

                      {queue.length > 1 && (
                        <div
                          className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer select-none transition-all ${aglutinar
                            ? "bg-primary/5 border-primary/30"
                            : "bg-slate-50 border-slate-200 hover:border-slate-300"
                            }`}
                          onClick={() => setAglutinar(v => !v)}
                        >
                          <div className={`w-10 h-6 rounded-full transition-colors flex items-center px-0.5 flex-shrink-0 ${aglutinar ? "bg-primary" : "bg-slate-300"}`}>
                            <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${aglutinar ? "translate-x-4" : "translate-x-0"}`} />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-slate-800">Aglutinar orçamentos</p>
                            <p className="text-xs text-slate-500 leading-tight">
                              {aglutinar
                                ? "Todos os documentos serão unidos em uma única exportação"
                                : "Cada documento será exportado separadamente"}
                            </p>
                          </div>
                        </div>
                      )}

                      {queue.length > 0 && (
                        <div className="space-y-3 mt-4">
                          <div className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                              <Layers className="w-4 h-4" />
                              Fila de Processamento ({queue.length})
                            </h3>
                            <Button variant="ghost" size="sm" onClick={() => setQueue([])} className="text-slate-500 h-8">
                              Limpar Fila
                            </Button>
                          </div>

                          <div className="max-h-64 overflow-y-auto space-y-2 pr-2">
                            {queue.map(item => (
                              <div key={item.id} className="flex items-center p-3 border rounded-lg bg-slate-50 gap-3 relative overflow-hidden">
                                {item.status === 'processing' && (
                                  <div className="absolute inset-0 bg-blue-50/50 pointer-events-none" />
                                )}
                                <FileText className={`w-5 h-5 z-10 ${item.status === 'error' ? 'text-red-400' : 'text-slate-400'}`} />
                                <div className="flex-1 truncate z-10">
                                  <p className="text-sm font-medium text-slate-800 truncate">{item.file.name}</p>
                                  <div className="flex flex-col gap-0.5">
                                    <span className="text-xs text-slate-500">{(item.file.size / 1024).toFixed(1)} KB</span>
                                    {item.status === 'paused' && item.error && (
                                      <span className="text-[11px] text-amber-600 truncate max-w-[400px] font-medium animate-pulse" title={item.error}>
                                        {item.error}
                                      </span>
                                    )}
                                    {item.status === 'error' && item.error && (
                                      <span className="text-[11px] text-red-500 truncate max-w-[400px] font-medium" title={item.error}>
                                        {item.error}
                                      </span>
                                    )}
                                  </div>
                                </div>

                                <div className="z-10 flex items-center shrink-0">
                                  {item.status === 'pending' && <Badge variant="outline" className="text-slate-500">Pendente</Badge>}
                                  {item.status === 'processing' && (
                                    <Badge className="bg-blue-100/80 text-blue-700 hover:bg-blue-100 border-blue-200">
                                      <Loader2 className="w-3 h-3 mr-1 animate-spin" /> Analisando
                                    </Badge>
                                  )}
                                  {item.status === 'done' && (
                                    <Badge className="bg-green-100/80 text-green-700 hover:bg-green-100 border-green-200">
                                      <Check className="w-3 h-3 mr-1" /> OK ({item.resultCount})
                                    </Badge>
                                  )}
                                  {item.status === 'paused' && (
                                    <Badge className="bg-amber-100/80 text-amber-700 hover:bg-amber-100 border-amber-200" title={item.error}>
                                      <Clock className="w-3 h-3 mr-1" /> Pausado
                                    </Badge>
                                  )}
                                  {item.status === 'error' && (
                                    <Badge variant="destructive" title={item.error}>
                                      <AlertCircle className="w-3 h-3" />
                                    </Badge>
                                  )}

                                  {(item.status === 'pending' || item.status === 'paused' || item.status === 'error') && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-6 w-6 ml-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-full"
                                      onClick={(e) => { e.stopPropagation(); removeFromQueue(item.id); }}
                                    >
                                      <X className="w-3 h-3" />
                                    </Button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {error && (
                        <Alert variant="destructive">
                          <AlertCircle className="h-4 w-4" />
                          <AlertTitle>Erro</AlertTitle>
                          <AlertDescription>{error}</AlertDescription>
                        </Alert>
                      )}

                      <div className="flex gap-4">
                        <TooltipWrapper content="Aviso: Irá expurgar os arquivos na fila e produtos identificados">
                          <Button
                            variant="ghost"
                            className="w-full text-slate-500 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                            onClick={reset}
                            disabled={isProcessing || (results.length === 0 && queue.length === 0)}
                          >
                            <Trash2 className="w-4 h-4 mr-2" /> Limpar Resultados e Recomeçar
                          </Button>
                        </TooltipWrapper>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Resultados */}
                <AnimatePresence>
                  {results.length > 0 && (
                    <motion.div
                      ref={resultsTableRef}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 20 }}
                      className="space-y-4 pt-10"
                    >
                      {/* Mass Edit Toolbar */}
                      {selectedIndices.size > 0 && (
                        <Card className="bg-white border-none ring-1 ring-slate-900/5 shadow-lg shadow-slate-900/5 border-l-4 border-l-primary rounded-2xl overflow-hidden mb-6 animate-in fade-in duration-200">
                          <CardContent className="p-4 md:p-5">
                            {/* Header / Selection Count */}
                            <div className="flex items-center gap-2.5 pb-3 mb-3 border-b border-slate-100">
                              <span className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                                <Layers className="w-4 h-4" />
                              </span>
                              <span className="font-bold text-slate-900 text-sm">
                                {selectedIndices.size} {selectedIndices.size === 1 ? 'item selecionado' : 'itens selecionados'}
                              </span>
                              <span className="hidden md:inline text-xs text-slate-400">— as ações abaixo afetam apenas a seleção</span>
                            </div>

                            {/* Actions wrap container */}
                            <div className="flex flex-wrap items-center gap-y-4 gap-x-5 text-xs">
                              
                              {/* Block 1: Alterar Valores */}
                              <div className="flex flex-wrap items-center gap-2.5">
                                <Label className="text-xs text-slate-500 font-semibold whitespace-nowrap">Acabamento:</Label>
                                <Input
                                  className="h-8 w-24 bg-slate-50 text-slate-900 placeholder:text-slate-400 text-xs border border-slate-200 rounded-lg focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:border-primary/50"
                                  placeholder="Cor"
                                  maxLength={10}
                                  value={massEditValue.acabamento || ""}
                                  onChange={(e) => setMassEditValue(prev => ({ ...prev, acabamento: e.target.value }))}
                                />

                                <Label className="text-xs text-slate-500 font-semibold whitespace-nowrap">Barra:</Label>
                                <Input
                                  type="text" inputMode="numeric"
                                  className="h-8 w-24 bg-slate-50 text-slate-900 placeholder:text-slate-400 text-xs border border-slate-200 rounded-lg focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:border-primary/50"
                                  placeholder="Comprimento"
                                  value={massEditValue.comprimento || ""}
                                  onChange={(e) => setMassEditValue(prev => ({ ...prev, comprimento: e.target.value }))}
                                />

                                <Button
                                  size="sm"
                                  className="h-8 bg-primary hover:bg-primary/90 text-white font-bold text-xs rounded-lg shadow-sm shadow-primary/30 transition-all active:scale-95 cursor-pointer px-4.5"
                                  onClick={applyMassEdit}
                                >
                                  Aplicar em Massa
                                </Button>
                              </div>

                              {/* Separator */}
                              <div className="hidden xl:block h-6 w-px bg-slate-200 self-center" />

                              {/* Block 2: Localizar & Apagar */}
                              <div className="flex flex-wrap items-center gap-2.5">
                                <Label className="text-xs text-slate-500 font-semibold whitespace-nowrap">Localizar & Apagar:</Label>
                                <Input
                                  className="h-8 w-32 bg-slate-50 text-slate-900 placeholder:text-slate-400 text-xs border border-slate-200 rounded-lg focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:border-primary/50"
                                  placeholder="Texto"
                                  maxLength={20}
                                  value={charsToRemove}
                                  onChange={(e) => setCharsToRemove(e.target.value)}
                                />

                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-semibold text-xs rounded-lg transition-all active:scale-95 cursor-pointer px-4 disabled:opacity-50 disabled:pointer-events-none"
                                  onClick={applyRemoveChars}
                                  disabled={!charsToRemove}
                                >
                                  Apagar
                                </Button>
                              </div>

                              {/* Separator */}
                              <div className="hidden xl:block h-6 w-px bg-slate-200 self-center" />

                              {/* Block 3: Substituir */}
                              <div className="flex flex-wrap items-center gap-2.5">
                                <Label className="text-xs text-slate-500 font-semibold whitespace-nowrap">Substituir:</Label>
                                <Input
                                  className="h-8 w-24 bg-slate-50 text-slate-900 placeholder:text-slate-400 text-xs border border-slate-200 rounded-lg focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:border-primary/50"
                                  placeholder="De"
                                  maxLength={30}
                                  value={findText}
                                  onChange={(e) => setFindText(e.target.value)}
                                />

                                <Label className="text-xs text-slate-500 font-semibold whitespace-nowrap">Para:</Label>
                                <Input
                                  className="h-8 w-24 bg-slate-50 text-slate-900 placeholder:text-slate-400 text-xs border border-slate-200 rounded-lg focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:border-primary/50"
                                  placeholder="Para"
                                  maxLength={30}
                                  value={replaceText}
                                  onChange={(e) => setReplaceText(e.target.value)}
                                />

                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-semibold text-xs rounded-lg transition-all active:scale-95 cursor-pointer px-4 disabled:opacity-50 disabled:pointer-events-none"
                                  onClick={applyReplaceText}
                                  disabled={!findText}
                                >
                                  Substituir
                                </Button>
                              </div>

                              {/* Separator */}
                              <div className="hidden xl:block h-6 w-px bg-slate-200 self-center" />

                              {/* Block 4: Incluir */}
                              <div className="flex flex-wrap items-center gap-2.5">
                                <Label className="text-xs text-slate-500 font-semibold whitespace-nowrap">Incluir:</Label>
                                <Input
                                  className="h-8 w-24 bg-slate-50 text-slate-900 placeholder:text-slate-400 text-xs border border-slate-200 rounded-lg focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:border-primary/50"
                                  placeholder="Início"
                                  maxLength={20}
                                  value={prefixText}
                                  onChange={(e) => setPrefixText(e.target.value)}
                                />

                                <Label className="text-xs text-slate-500 font-semibold whitespace-nowrap">Fim:</Label>
                                <Input
                                  className="h-8 w-24 bg-slate-50 text-slate-900 placeholder:text-slate-400 text-xs border border-slate-200 rounded-lg focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:border-primary/50"
                                  placeholder="Fim"
                                  maxLength={20}
                                  value={suffixText}
                                  onChange={(e) => setSuffixText(e.target.value)}
                                />

                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-semibold text-xs rounded-lg transition-all active:scale-95 cursor-pointer px-4 disabled:opacity-50 disabled:pointer-events-none"
                                  onClick={applyAddFixes}
                                  disabled={!prefixText && !suffixText}
                                >
                                  Adicionar
                                </Button>
                              </div>

                            </div>
                          </CardContent>
                        </Card>
                      )}

                      {/* Re-check banner — roda antes de exibir a prévia */}
                      {validationReports.length > 0 && (
                        validationReports.some(r => r.discrepancies.length > 0) ? (
                          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-start gap-2.5">
                            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                            <div className="text-xs space-y-0.5">
                              <p className="font-semibold text-amber-800">Re-check antes da prévia</p>
                              {validationReports.map((report, i) =>
                                report.discrepancies.length > 0 ? (
                                  <div key={i} className="text-amber-700 space-y-0.5">
                                    <p>
                                      {validationReports.length > 1 && <span className="font-medium">Arquivo {i + 1}: </span>}
                                      {`${report.totalPages} pág · ${report.totalItems} itens · `}
                                      {report.discrepancies.join(" · ")}
                                    </p>
                                    {report.aiReview?.issues.slice(0, 3).map((issue, issueIdx) => (
                                      <p key={issueIdx} className="pl-3 text-amber-700/90">
                                        {issue}
                                      </p>
                                    ))}
                                    {report.aiReview?.status === "ok" && (
                                      <p className="pl-3 text-emerald-700">
                                        IA confirmou: {report.aiReview.summary}
                                      </p>
                                    )}
                                  </div>
                                ) : null
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-xs text-green-700 px-1">
                            <Check className="w-3.5 h-3.5" />
                            <span>
                              Re-check OK — {validationReports.reduce((s, r) => s + r.totalPages, 0)} pág · {results.length} itens · {validationReports.every(r => r.aiReview?.status === "ok") ? "IA confirmou a segunda leitura" : "sem divergências"}
                            </span>
                          </div>
                        )
                      )}

                      <Card className="bg-white border-none ring-1 ring-slate-900/5 shadow-lg shadow-slate-900/5 rounded-2xl overflow-hidden">
                        <CardHeader className="bg-white border-b border-slate-100 p-4 md:p-6">
                          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div className="flex items-center gap-3">
                              <span className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0">
                                <ListChecks className="w-4 h-4" />
                              </span>
                              <div>
                                <CardTitle className="text-base md:text-lg font-bold tracking-tight text-slate-900">Prévia dos Dados</CardTitle>
                                <CardDescription className="text-sm text-slate-500">Confira, edite e selecione os itens.</CardDescription>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-semibold"
                                onClick={handleAddItem}
                              >
                                <Plus className="w-4 h-4 mr-2" />
                                INCLUIR
                              </Button>
                              <Button
                                size="sm"
                                className="bg-gradient-to-r from-primary to-orange-600 text-white font-bold shadow-md shadow-primary/30 hover:from-primary/90 hover:to-orange-600/90"
                                onClick={exportToCSV}
                              >
                                <Download className="w-4 h-4 mr-2" />
                                BAIXAR
                              </Button>
                              <Separator orientation="vertical" className="h-8 hidden md:block" />
                              <div className="flex flex-wrap gap-2 items-center">
                                <Badge className="bg-green-100 text-green-700 border-green-200">
                                  {results.filter(r => r.verificadoNoCatalogo).length} No Catálogo
                                </Badge>
                                {results.some(r => !r.verificadoNoCatalogo) && (
                                  <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                                    {results.filter(r => !r.verificadoNoCatalogo).length} Fora do Catálogo
                                  </Badge>
                                )}
                                {groupedResults && (
                                  <Badge
                                    variant="outline"
                                    className="bg-blue-50 text-blue-700 border-blue-200 cursor-pointer"
                                    onClick={() => setAglutinar((v: boolean) => !v)}
                                  >
                                    {groupedResults.length} docs · separados
                                  </Badge>
                                )}
                                {!groupedResults && results.some((r: OCRItem) => r.sourceFileId) && (
                                  <Badge
                                    variant="outline"
                                    className="bg-primary/10 text-primary border-primary/20 cursor-pointer"
                                    onClick={() => setAglutinar((v: boolean) => !v)}
                                  >
                                    aglutinado
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="p-0">
                          <div className="max-h-[600px] overflow-auto">
                            <Table className="w-full">
                              <TableHeader className="sticky top-0 bg-white/95 backdrop-blur-sm z-10 shadow-sm hidden md:table-header-group">
                                <TableRow>
                                  <TableHead className="w-[50px]">
                                    <Button variant="ghost" size="icon" onClick={toggleSelectAll} aria-label="Selecionar todos os itens">
                                      {results.length > 0 && selectedIndices.size === results.length ? (
                                        <CheckSquare className="w-5 h-5 text-primary" />
                                      ) : (
                                        <Square className="w-5 h-5 text-slate-400" />
                                      )}
                                    </Button>
                                  </TableHead>
                                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Produto</TableHead>
                                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Acabamento</TableHead>
                                  <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-slate-400">Qtde</TableHead>
                                  <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-slate-400">Preço</TableHead>
                                  <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-slate-400">Comprimento</TableHead>
                                  <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-slate-400">Ações</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody className="block md:table-row-group p-4 md:p-0">
                                {(() => {
                                  const renderRow = (item: OCRItem, idx: number) => {
                                    const isEditing = editingIdx === idx;
                                    const price = getFinalPrice(item);
                                    const isOutOfCatalog = !item.verificadoNoCatalogo;
                                    const substitution = item.substituicao;
                                    const isSuggestionPending = substitution?.status === "pending" && Boolean(substitution.produtoSugerido);
                                    const renderSubstitutionBadge = () => {
                                      if (!substitution) return null;

                                      if (substitution.status === "auto-converted") {
                                        return <Badge variant="outline" className="bg-indigo-50 text-indigo-600 border-indigo-200 text-[10px] h-4 px-1">Convertido</Badge>;
                                      }
                                      if (substitution.status === "pending") {
                                        return <Badge variant="outline" className="bg-cyan-50 text-cyan-700 border-cyan-200 text-[10px] h-4 px-1">Sugestão</Badge>;
                                      }
                                      if (substitution.status === "accepted") {
                                        return <Badge variant="outline" className="bg-emerald-50 text-emerald-600 border-emerald-200 text-[10px] h-4 px-1">Substituído</Badge>;
                                      }
                                      if (substitution.status === "declined") {
                                        return <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200 text-[10px] h-4 px-1">Mantido</Badge>;
                                      }
                                      return null;
                                    };
                                    const renderSubstitutionNotice = (compact = false) => {
                                      if (!substitution) return null;

                                      const baseClass = compact
                                        ? "rounded-md border border-cyan-100 bg-cyan-50/60 p-2 text-xs text-slate-700 space-y-1"
                                        : "mt-1 rounded-md border border-cyan-100 bg-cyan-50/60 p-2 text-xs text-slate-700 space-y-1 max-w-xl";

                                      if (isSuggestionPending) {
                                        return (
                                          <div className={baseClass}>
                                            <div><span className="font-semibold text-cyan-800">Sugestão:</span> {substitution.textoSugestao || substitution.produtoSugerido}</div>
                                            {substitution.observacao && <div><span className="font-semibold text-cyan-800">Obs:</span> {substitution.observacao}</div>}
                                            <div className="flex flex-wrap items-center gap-2 pt-1">
                                              <span className="font-medium text-slate-700">Gostaria de substituir esse item pela sugestão?</span>
                                              <Button size="sm" className="h-7 px-2 text-xs bg-cyan-700 text-white hover:bg-cyan-800" onClick={() => handleAcceptSubstitution(idx)}>
                                                <Check className="w-3 h-3 mr-1" /> SIM
                                              </Button>
                                              <Button size="sm" variant="outline" className="h-7 px-2 text-xs bg-white" onClick={() => handleDeclineSubstitution(idx)}>
                                                <X className="w-3 h-3 mr-1" /> NÃO
                                              </Button>
                                            </div>
                                          </div>
                                        );
                                      }

                                      if (substitution.status === "auto-converted") {
                                        return (
                                          <div className={baseClass}>
                                            <div>
                                              <span className="font-semibold text-indigo-700">Conversão Aluminorte:</span> {substitution.produtoOriginal} substituído por nosso código {item.produto}.
                                            </div>
                                            {substitution.observacao && <div><span className="font-semibold text-indigo-700">Obs:</span> {substitution.observacao}</div>}
                                          </div>
                                        );
                                      }

                                      if (substitution.status === "accepted" || substitution.status === "declined") {
                                        return (
                                          <div className={baseClass}>
                                            {substitution.status === "accepted"
                                              ? <>Substituição aceita: {substitution.produtoOriginal} -&gt; {item.produto}.</>
                                              : <>Sugestão recusada. Mantido: {item.produto}.</>}
                                          </div>
                                        );
                                      }

                                      return null;
                                    };

                                    return (
                                      <TableRow
                                        key={idx}
                                        className={`transition-colors ${selectedIndices.has(idx) ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-slate-50/70"}`}
                                      >
                                        {/* Mobile Card View */}
                                        <td colSpan={7} className="p-0 md:hidden">
                                          <div className={`p-4 mb-2 border rounded-lg shadow-sm space-y-2 ${isOutOfCatalog ? "bg-amber-50/40 border-amber-200" : "bg-white"}`}>
                                            <div className="flex justify-between items-start">
                                              <div className="font-bold text-slate-800 pr-4 flex-1">
                                                {isEditing ? (
                                                  <Input className="h-9" maxLength={30} value={item.produto} onChange={(e) => updateItem(idx, { produto: e.target.value })} />
                                                ) : (
                                                  <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="font-mono text-[13px] font-bold text-slate-800 tracking-tight">{item.produto}</span>
                                                    {item.verificadoNoCatalogo && <Badge variant="outline" className="bg-green-50 text-green-600 border-green-200 text-[10px] h-4 px-1">Catálogo</Badge>}
                                                    {isOutOfCatalog && <Badge variant="outline" className="bg-amber-50 text-amber-600 border-amber-200 text-[10px] h-4 px-1">Fora Catálogo</Badge>}
                                                    {(item as any).corrigidoManualmente && <Badge variant="outline" className="bg-blue-50 text-blue-600 border-blue-200 text-[10px] h-4 px-1">Corrigido</Badge>}
                                                    {renderSubstitutionBadge()}
                                                  </div>
                                                )}
                                              </div>
                                              <div className="flex items-center flex-shrink-0 -mr-2">
                                                {isEditing ? (
                                                  <Button size="icon" variant="ghost" className="h-8 w-8 text-green-600" onClick={() => handleSaveEdit(idx)}><Save className="w-4 h-4" /></Button>
                                                ) : (
                                                  <div className="flex gap-1">
                                                    {!isFuroCode(item.produto) && (
                                                      <TooltipWrapper content="Identificar como 'Com Furo' (CF)">
                                                        <Button size="icon" variant="ghost" className="h-8 w-8 text-blue-500 hover:text-blue-600" onClick={() => handleMarkAsFuro(idx)}><Target className="w-4 h-4" /></Button>
                                                      </TooltipWrapper>
                                                    )}
                                                    <TooltipWrapper content="Reportar erro e corrigir">
                                                      <Button size="icon" variant="ghost" className="h-8 w-8 text-amber-500 hover:text-amber-600" onClick={() => { setReportingErrorIdx(idx); setEditingIdx(idx); }}><AlertTriangle className="w-4 h-4" /></Button>
                                                    </TooltipWrapper>
                                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-slate-400" onClick={() => setEditingIdx(idx)}><Edit2 className="w-4 h-4" /></Button>
                                                  </div>
                                                )}
                                                <Button variant="ghost" size="icon" onClick={() => toggleSelect(idx)}>
                                                  {selectedIndices.has(idx) ? <CheckSquare className="w-5 h-5 text-primary" /> : <Square className="w-5 h-5 text-slate-400" />}
                                                </Button>
                                              </div>
                                            </div>
                                            <div className="grid grid-cols-2 gap-x-4 gap-y-2 pt-2 border-t text-sm">
                                              <div className="text-slate-500 font-medium">Acabamento</div>
                                              <div className="text-right">
                                                {isEditing ? <Input className="border rounded px-2 py-1 text-sm h-8 w-full text-right" maxLength={10} value={item.acabamento} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateItem(idx, { acabamento: e.target.value.toUpperCase() })} /> : <Badge variant={item.acabamento === "NÃO IDENTIFICADO" ? "destructive" : "secondary"}>{item.acabamento}</Badge>}
                                              </div>
                                              <div className="text-slate-500 font-medium">Qtde</div>
                                              <div className="text-right">{isEditing ? <Input type="number" className="h-8 w-full text-right" value={item.qtde} onChange={(e) => updateItem(idx, { qtde: Number(e.target.value) })} /> : item.qtde}</div>
                                              <div className="text-slate-500 font-medium">Preço</div>
                                              <div className="text-right">{isEditing ? <Input type="number" className="h-8 w-full text-right" value={item.preco !== undefined ? item.preco : price} onChange={(e) => updateItem(idx, { preco: Number(e.target.value) })} /> : <span className="font-mono tabular-nums text-slate-800">R$ {price.toFixed(2)}</span>}</div>
                                              <div className="text-slate-500 font-medium">Comprimento</div>
                                              <div className="text-right">{isEditing ? <Input type="number" className="h-8 w-full text-right" value={item.comprimento} onChange={(e) => updateItem(idx, { comprimento: Number(e.target.value) })} /> : item.comprimento}</div>
                                            </div>
                                            {!isEditing && renderSubstitutionNotice(true)}
                                          </div>
                                        </td>

                                        {/* Desktop Table View */}
                                        <TableCell className={`hidden md:table-cell ${isOutOfCatalog ? "bg-amber-50/30" : ""}`}>
                                          <Button variant="ghost" size="icon" onClick={() => toggleSelect(idx)}>
                                            {selectedIndices.has(idx) ? <CheckSquare className="w-5 h-5 text-primary" /> : <Square className="w-5 h-5 text-slate-400" />}
                                          </Button>
                                        </TableCell>
                                        <TableCell className={`hidden md:table-cell font-medium ${isOutOfCatalog ? "bg-amber-50/30" : ""}`}>
                                          <div className="flex items-center gap-2">
                                            {isEditing ? (
                                              <Input className="h-8 w-full" maxLength={30} value={item.produto} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateItem(idx, { produto: e.target.value })} />
                                            ) : (
                                              <>
                                                <span className="font-mono text-[13px] font-bold text-slate-800 tracking-tight">{item.produto}</span>
                                                {item.verificadoNoCatalogo && <Badge variant="outline" className="bg-green-50 text-green-600 border-green-200 text-[10px] h-4 px-1">Catálogo</Badge>}
                                                {isOutOfCatalog && <Badge variant="outline" className="bg-amber-50 text-amber-600 border-amber-200 text-[10px] h-4 px-1">Fora Catálogo</Badge>}
                                                {(item as any).corrigidoManualmente && <Badge variant="outline" className="bg-blue-50 text-blue-600 border-blue-200 text-[10px] h-4 px-1">Corrigido</Badge>}
                                                {renderSubstitutionBadge()}
                                              </>
                                            )}
                                          </div>
                                          {!isEditing && renderSubstitutionNotice()}
                                        </TableCell>
                                        <TableCell className={`hidden md:table-cell ${isOutOfCatalog ? "bg-amber-50/30" : ""}`}>
                                          {isEditing ? <Input className="border rounded px-2 py-1 text-sm h-8 w-full" maxLength={10} value={item.acabamento} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateItem(idx, { acabamento: e.target.value.toUpperCase() })} /> : <Badge variant={item.acabamento === "NÃO IDENTIFICADO" ? "destructive" : "secondary"}>{item.acabamento}</Badge>}
                                        </TableCell>
                                        <TableCell className={`hidden md:table-cell text-right ${isOutOfCatalog ? "bg-amber-50/30" : ""}`}>
                                          {isEditing ? <Input type="number" className="h-8 w-20 ml-auto" value={item.qtde} onChange={(e) => updateItem(idx, { qtde: Number(e.target.value) })} /> : item.qtde}
                                        </TableCell>
                                        <TableCell className={`hidden md:table-cell text-right ${isOutOfCatalog ? "bg-amber-50/30" : ""}`}>
                                          {isEditing ? <Input type="number" className="h-8 w-20 ml-auto" value={item.preco !== undefined ? item.preco : price} onChange={(e) => updateItem(idx, { preco: Number(e.target.value) })} /> : <span className="font-mono tabular-nums text-slate-800">R$ {price.toFixed(2)}</span>}
                                        </TableCell>
                                        <TableCell className={`hidden md:table-cell text-right ${isOutOfCatalog ? "bg-amber-50/30" : ""}`}>
                                          {isEditing ? <Input type="number" className="h-8 w-24 ml-auto" value={item.comprimento} onChange={(e) => updateItem(idx, { comprimento: Number(e.target.value) })} /> : item.comprimento}
                                        </TableCell>
                                        <TableCell className={`hidden md:table-cell text-right ${isOutOfCatalog ? "bg-amber-50/30" : ""}`}>
                                          <div className="flex items-center justify-end gap-1">
                                            {isEditing ? (
                                              <Button size="icon" variant="ghost" className="h-8 w-8 text-green-600" onClick={() => handleSaveEdit(idx)}><Save className="w-4 h-4" /></Button>
                                            ) : (
                                              <div className="flex gap-1">
                                                {!isFuroCode(item.produto) && (
                                                  <TooltipWrapper content="Identificar como 'Com Furo' (CF) e aprender">
                                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-blue-500 hover:text-blue-600" onClick={() => handleMarkAsFuro(idx)}><Target className="w-4 h-4" /></Button>
                                                  </TooltipWrapper>
                                                )}
                                                <TooltipWrapper content="Reportar erro e corrigir">
                                                  <Button size="icon" variant="ghost" className="h-8 w-8 text-amber-500 hover:text-amber-600" onClick={() => { setReportingErrorIdx(idx); setEditingIdx(idx); }}><AlertTriangle className="w-4 h-4" /></Button>
                                                </TooltipWrapper>
                                                <Button size="icon" variant="ghost" className="h-8 w-8 text-slate-400" onClick={() => setEditingIdx(idx)}><Edit2 className="w-4 h-4" /></Button>
                                              </div>
                                            )}
                                            <Button size="icon" variant="ghost" className="h-8 w-8 text-slate-400 hover:text-amber-600" title="Negativar (Não é produto)" onClick={() => handleBlacklist(idx)}><Ban className="w-4 h-4" /></Button>
                                            <Button size="icon" variant="ghost" className="h-8 w-8 text-red-400" onClick={() => handleDelete(idx)}>
                                              <Trash2 className="w-4 h-4" />
                                            </Button>
                                          </div>
                                        </TableCell>
                                      </TableRow>
                                    );
                                  };

                                  if (groupedResults) {
                                    // Grouped view: file header row + items per document
                                    return groupedResults.flatMap(group => {
                                      const groupSelected = group.items.filter(({ globalIdx }) => selectedIndices.has(globalIdx));
                                      const allSelected = groupSelected.length === group.items.length;
                                      const headerRow = (
                                        <TableRow key={`hdr-${group.fileId}`} className="bg-blue-50/70 hover:bg-blue-50/70 border-b-0">
                                          <td colSpan={7} className="px-4 py-2.5">
                                            <div className="flex items-center gap-3">
                                              <button
                                                className="flex-shrink-0"
                                                onClick={() => {
                                                  const next = new Set(selectedIndices);
                                                  if (allSelected) {
                                                    group.items.forEach(({ globalIdx }) => next.delete(globalIdx));
                                                  } else {
                                                    group.items.forEach(({ globalIdx }) => next.add(globalIdx));
                                                  }
                                                  setSelectedIndices(next);
                                                }}
                                              >
                                                {allSelected
                                                  ? <CheckSquare className="w-4 h-4 text-primary" />
                                                  : <Square className="w-4 h-4 text-slate-400" />}
                                              </button>
                                              <FileText className="w-4 h-4 text-blue-600 flex-shrink-0" />
                                              <span className="text-sm font-semibold text-blue-900 truncate flex-1">{group.fileName}</span>
                                              <Badge className="bg-blue-100 text-blue-700 border-blue-200 flex-shrink-0">
                                                {group.items.length} {group.items.length === 1 ? "item" : "itens"}
                                              </Badge>
                                            </div>
                                          </td>
                                        </TableRow>
                                      );
                                      return [headerRow, ...group.items.map(({ item, globalIdx }) => renderRow(item, globalIdx))];
                                    });
                                  }

                                  // Flat view (aglutinado)
                                  return results.map((item: OCRItem, idx: number) => renderRow(item, idx));
                                })()}
                              </TableBody>
                            </Table>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            )}

            {/* Footer */}
            <footer className="text-center text-slate-400 text-sm pb-8">
              <p>© 2026 Sistema de OCR de Alumínio. Desenvolvido para precisão e agilidade.</p>
            </footer>
          </div>
        </motion.div>
      </AnimatePresence>
      <BrowserCompatibilityNotice />
    </>
  );
}

