type GeminiResponseMode = "ocr" | "catalog" | "classify" | "audit";

interface GeminiProxyPayload {
  fileBase64?: string;
  mimeType?: string;
  prompt: string;
  textOnly?: boolean;
  responseMode?: GeminiResponseMode;
}

interface GeminiProxyOptions {
  apiKey?: string;
  apiKeys?: string[];
  payload: GeminiProxyPayload;
  unavailableModels: Set<string>;
}

interface GeminiProxyResult {
  status: number;
  body: Record<string, unknown>;
}

const DEFAULT_MODELS = [
  "gemini-2.5-pro",
  "gemini-3.5-flash",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash-lite",
  "gemini-1.5-pro",
  "gemini-1.5-flash",
  "gemini-1.5-flash-8b",
];

const keyCooldownUntil = new Map<string, number>();
let nextKeyCursor = 0;

const OCR_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          produto: { type: "STRING" },
          produtoOriginal: { type: "STRING" },
          acabamento: { type: "STRING" },
          qtde: { type: "NUMBER" },
          comprimento: { type: "NUMBER" },
          identificado: { type: "BOOLEAN" },
          box_2d: { type: "ARRAY", items: { type: "NUMBER" } },
        },
        required: ["produto", "produtoOriginal", "acabamento", "qtde", "comprimento", "identificado"],
      },
    },
  },
  required: ["items"],
};

const CATALOG_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    products: {
      type: "ARRAY",
      items: { type: "STRING" },
    },
  },
  required: ["products"],
};

function getModelList(): string[] {
  const configuredModels = process.env.GEMINI_MODELS
    ?.split(",")
    .map(model => model.trim())
    .filter(Boolean);

  return configuredModels?.length ? configuredModels : DEFAULT_MODELS;
}

export function getConfiguredGeminiApiKeys(): string[] {
  const primaryKey = (process.env.GEMINI_API_KEY || "").trim();
  const extraKeys = (process.env.GEMINI_API_KEYS || "")
    .split(",")
    .map(k => k.trim())
    .filter(Boolean);

  // Primary (paid) key first, then free backup keys — deduplicated
  const allKeys = [primaryKey, ...extraKeys].filter(Boolean);
  return Array.from(new Set(allKeys));
}

function maskKey(apiKey: string): string {
  if (apiKey.length <= 8) return "****";
  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
}

function getAvailableApiKeys(apiKeys: string[]): Array<{ key: string; index: number }> {
  const now = Date.now();
  const uniqueKeys = Array.from(new Set(apiKeys.filter(Boolean)));
  const available = uniqueKeys
    .map((key, index) => ({ key, index }))
    .filter(({ key }) => (keyCooldownUntil.get(key) || 0) <= now);

  return available;
}

function getSoonestKeyRetryAfterMs(apiKeys: string[]): number {
  const now = Date.now();
  const retryAfterMs = apiKeys
    .map(key => (keyCooldownUntil.get(key) || 0) - now)
    .filter(ms => ms > 0);

  return retryAfterMs.length ? Math.min(...retryAfterMs) : 60_000;
}


function getMaxOutputTokens(responseMode: GeminiResponseMode): number {
  const configured = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || "");
  if (Number.isFinite(configured) && configured > 0) return configured;
  if (responseMode === "catalog") return 8192;
  if (responseMode === "audit") return 2048;
  if (responseMode === "classify") return 256;
  return 4096;
}

function buildParts(payload: GeminiProxyPayload): any[] {
  if (payload.textOnly || !payload.fileBase64) {
    return [{ text: payload.prompt }];
  }

  if (!payload.mimeType) {
    throw new Error("mimeType e obrigatorio para envio de arquivo.");
  }

  return [
    { inlineData: { mimeType: payload.mimeType, data: payload.fileBase64 } },
    { text: payload.prompt },
  ];
}

async function readError(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch {
    return { error: { message: `Erro HTTP ${response.status}` } };
  }
}

function parseJsonFromText(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (!match) return {};
    return JSON.parse(match[1]);
  }
}

function normalizeSuccessfulBody(text: string, responseMode: GeminiResponseMode): Record<string, unknown> {
  if (responseMode === "classify" || responseMode === "audit") {
    // Return the raw text so callAIRawText can parse it freely
    return { text };
  }

  const parsed = parseJsonFromText(text);

  if (responseMode === "catalog") {
    const products = Array.isArray(parsed) ? parsed : (parsed.products || []);
    return { products: Array.isArray(products) ? products : [] };
  }

  const items = Array.isArray(parsed) ? parsed : (parsed.items || []);
  return { items: Array.isArray(items) ? items : [] };
}

function extractQuotaMessage(errorData: any): string | null {
  const violations = errorData?.error?.details
    ?.flatMap((detail: any) => detail?.violations || [])
    ?.map((violation: any) => {
      const metric = violation.quotaMetric || violation.quotaId;
      const model = violation.quotaDimensions?.model;
      return [metric, model].filter(Boolean).join(" / ");
    })
    ?.filter(Boolean);

  return violations?.length ? `Detalhe de cota: ${violations.join("; ")}` : null;
}

function extractRetryAfterMs(errorData: any): number {
  const retryInfo = errorData?.error?.details?.find((detail: any) =>
    typeof detail?.retryDelay === "string"
  );
  const retryDelay = retryInfo?.retryDelay;
  if (retryDelay) {
    const seconds = Number.parseFloat(String(retryDelay).replace("s", ""));
    if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds * 1000);
  }

  const message = errorData?.error?.message || errorData?.message || "";
  const match = String(message).match(/retry in ([\d.]+)s/i);
  if (match) {
    const seconds = Number.parseFloat(match[1]);
    if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds * 1000);
  }

  return 60_000;
}

export async function generateWithGemini({
  apiKey,
  apiKeys,
  payload,
  unavailableModels,
}: GeminiProxyOptions): Promise<GeminiProxyResult> {
  const responseMode = payload.responseMode || "ocr";
  const modelsToTry = getModelList().filter(model => !unavailableModels.has(model));
  const configuredKeys = Array.from(new Set([...(apiKeys || []), apiKey || ""].filter(Boolean)));
  const keysToTry = getAvailableApiKeys(configuredKeys);

  if (!configuredKeys.length) {
    return {
      status: 503,
      body: { error: "Nenhuma chave Gemini configurada." },
    };
  }

  if (!keysToTry.length) {
    const retryAfterMs = getSoonestKeyRetryAfterMs(configuredKeys);
    return {
      status: 200,
      body: {
        retry: true,
        error: "Todas as chaves Gemini estao em cooldown de cota. A fila sera retomada automaticamente.",
        retryAfterMs,
        retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
      },
    };
  }

  if (!modelsToTry.length) {
    return {
      status: 503,
      body: { error: "Nenhum modelo Gemini disponivel para tentativa nesta execucao." },
    };
  }

  const startTime = Date.now();
  const getTimeoutDuration = (): number => {
    // Vercel maxDuration is 60s — cap to 50s to leave buffer for cold start and response sending.
    const VERCEL_SAFE_MAX = 50_000;
    if (process.env.GEMINI_TIMEOUT_MS) {
      const val = Number(process.env.GEMINI_TIMEOUT_MS);
      if (Number.isFinite(val) && val > 0) {
        return process.env.VERCEL ? Math.min(val, VERCEL_SAFE_MAX) : val;
      }
    }
    return process.env.VERCEL ? VERCEL_SAFE_MAX : 120_000;
  };
  const maxAllowedDuration = getTimeoutDuration();
  let lastError: any = null;
  let lastHttpStatus: number | null = null;
  let minQuotaRetryAfterMs = 0;
  const failedModelsThisCall = new Set<string>();

  for (const { key: currentApiKey, index: keyIndex } of keysToTry) {
    for (const model of modelsToTry) {
      if (failedModelsThisCall.has(`${currentApiKey}:${model}`)) {
        lastHttpStatus = 429;
        continue;
      }

      const timeElapsed = Date.now() - startTime;
      const timeRemaining = maxAllowedDuration - timeElapsed;
      if (timeRemaining < 2000) {
        console.warn(`[Gemini Proxy] Tempo restante insuficiente (${timeRemaining}ms). Interrompendo tentativas.`);
        break;
      }

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${currentApiKey}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeRemaining);

      try {
        const geminiResponse = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ role: "user", parts: buildParts(payload) }],
            generationConfig: {
              // classify mode returns free text JSON — no forced schema
              ...(responseMode !== "classify" && responseMode !== "audit" && {
                responseMimeType: "application/json",
                responseSchema: responseMode === "catalog" ? CATALOG_RESPONSE_SCHEMA : OCR_RESPONSE_SCHEMA,
              }),
              temperature: responseMode === "classify" || responseMode === "audit" ? 0.1 : 0,
              maxOutputTokens: getMaxOutputTokens(responseMode),
            },
          }),
        });

        if (!geminiResponse.ok) {
          const errorData = await readError(geminiResponse);
          lastError = errorData;
          lastHttpStatus = geminiResponse.status;
          console.warn(`[Gemini] chave ${keyIndex + 1}/${configuredKeys.length} (${maskKey(currentApiKey)}) modelo ${model} falhou com status ${geminiResponse.status}`);

          if (geminiResponse.status === 404) {
            unavailableModels.add(model);
            continue;
          }

          if (geminiResponse.status === 429) {
            const errorMsg = errorData.error?.message || errorData.message || "";
            if (errorMsg.includes("limit: 0") || JSON.stringify(errorData).includes("limit: 0")) {
              unavailableModels.add(model);
              console.warn(`[Gemini] modelo ${model} tem limite 0 (desativado para esta chave/projeto). Tentando proximo modelo.`);
              continue;
            }
            const retryAfterMs = extractRetryAfterMs(errorData);
            keyCooldownUntil.set(currentApiKey, Date.now() + retryAfterMs);
            failedModelsThisCall.add(`${currentApiKey}:${model}`);
            if (minQuotaRetryAfterMs === 0 || retryAfterMs < minQuotaRetryAfterMs) minQuotaRetryAfterMs = retryAfterMs;
            console.warn(`[Gemini] modelo ${model} cota esgotada (retry em ${Math.ceil(retryAfterMs / 1000)}s). Tentando proximo modelo.`);
            continue;
          }

          if (geminiResponse.status === 503) {
            keyCooldownUntil.set(currentApiKey, Date.now() + 10_000);
            console.warn(`[Gemini] modelo ${model} indisponivel temporariamente. Tentando proximo modelo.`);
            continue;
          }

          // 401/403: falha de nivel de CHAVE (projeto bloqueado/banido, chave revogada
          // ou invalida). Nao adianta tentar outros modelos com a mesma chave — pula a
          // chave inteira e tenta a proxima configurada. Cooldown longo porque um projeto
          // "denied access" nao se recupera sozinho em segundos.
          if (geminiResponse.status === 401 || geminiResponse.status === 403) {
            keyCooldownUntil.set(currentApiKey, Date.now() + 60 * 60 * 1000); // 1h
            console.warn(`[Gemini] chave ${keyIndex + 1}/${configuredKeys.length} (${maskKey(currentApiKey)}) sem permissao (status ${geminiResponse.status}: ${errorData.error?.status || errorData.error?.message || ""}). Pulando para a proxima chave.`);
            break; // sai do loop de modelos -> proxima chave
          }

          return {
            status: geminiResponse.status,
            body: {
              error: errorData.error?.message || `Erro ao processar com ${model}.`,
            },
          };
        }

        const data = await geminiResponse.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error("A IA retornou uma resposta vazia.");

        return {
          status: 200,
          body: {
            ...normalizeSuccessfulBody(text, responseMode),
            model,
            keyIndex,
            keyCount: configuredKeys.length,
          },
        };
      } catch (err: any) {
        lastError = err;
        lastHttpStatus = null;
        console.error(`[Gemini] Erro com chave ${keyIndex + 1}/${configuredKeys.length}, modelo ${model}:`, err.message);
      } finally {
        clearTimeout(timeoutId);
      }
    }

    if (Date.now() - startTime >= maxAllowedDuration - 2000) {
      break;
    }
  }

  // Todas as chaves falharam por permissao (401/403): erro terminal, NAO adianta repetir.
  if (lastHttpStatus === 401 || lastHttpStatus === 403) {
    return {
      status: lastHttpStatus,
      body: {
        error:
          lastError?.error?.message ||
          "Todas as chaves Gemini configuradas estao sem acesso (projeto bloqueado ou chave invalida). Substitua GEMINI_API_KEY/GEMINI_API_KEYS na Vercel.",
      },
    };
  }

  const quotaDetail = extractQuotaMessage(lastError);
  const providerMessage = lastError?.error?.message || lastError?.message || "Tempo limite excedido na requisição.";
  const isTimeout = (!lastError && lastHttpStatus !== 429 && lastHttpStatus !== 503) ||
    lastError?.name === "AbortError" ||
    String(lastError?.message || "").includes("abort");
  const isProviderUnavailable = lastHttpStatus === 503;
  const isModelQuotaUnavailable = lastHttpStatus === 429;
  const retryAfterMs = isTimeout ? 15_000 : isProviderUnavailable ? 10_000 : minQuotaRetryAfterMs || extractRetryAfterMs(lastError);

  return {
    status: 200,
    body: {
      retry: true,
      error: isTimeout 
        ? "Tempo limite do servidor atingido. A fila será retomada automaticamente."
        : isProviderUnavailable
          ? "Modelo Gemini temporariamente indisponivel. A fila sera retomada automaticamente."
          : isModelQuotaUnavailable
            ? "Cota do modelo Gemini temporariamente indisponivel. A fila sera retomada automaticamente."
            : "Cota temporariamente indisponivel. A fila sera retomada automaticamente.",
      providerError: providerMessage,
      quotaDetail,
      retryAfterMs,
      retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
    },
  };
}
