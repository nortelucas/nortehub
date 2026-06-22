---
name: ocr-profile
description: Adiciona ou refina, de forma segura e aditiva, um perfil de leitura de documento no pipeline OCR (src/services/ocrService.ts + documentProfiles.ts). Use quando um documento for lido errado (itens/quantidades incorretos), aparecer um layout/fornecedor novo, o relatório acusar "lido pelo perfil genérico", ou o usuário pedir para a aplicação "aprender" a ler um tipo de documento. NUNCA altera a semântica de perfis existentes — só faz mudanças pontuais e isoladas.
---

# Skill: ocr-profile — aprender/refinar um perfil de leitura OCR

Esta skill é o "agente interno" que faz o sistema **melhorar sozinho** de forma controlada:
a partir de um documento (PDF/imagem/texto) que está sendo lido errado, você adiciona um
perfil dedicado novo **ou** refina a detecção de um existente — sempre por **adição pura**,
seguindo o padrão já validado nos perfis atuais (SUJVIDROS, ALUMINORTE, ACECAMP, NEOCA, ECG…).

## Regra de ouro (restrição inviolável)

> **Nunca modifique o corpo, o prompt ou a semântica de um perfil/parser existente.**
> Só é permitido **ADICIONAR**: um perfil novo, um ramo `OR` num detector, ou um fallback
> numa cadeia de prompts. Um layout = um perfil isolado. Mudança num perfil não pode afetar outro.
> Mantenha as edições **pontuais** — não refatore o código ao redor.

## Quando esta skill é acionada

- O usuário diz que um documento está com **itens ou quantidades errados**.
- Chega um **fornecedor/sistema novo** (cabeçalho/rodapé/colunas diferentes).
- O `validationReport.selfImprovementHint.suggestNewProfile` é `true`, ou aparece a
  discrepância **"Documento lido pelo perfil genérico…"** / **"Quantidade suspeita…"**
  (sinalizador de runtime — ver seção "Sinalizador").

## Arquitetura (ler antes de editar)

Dois caminhos de leitura, ambos passando por **perfis**:

1. **Parser local estrito** (texto digital): `processTextWithStrictCatalog()` em `ocrService.ts`.
   Um detector `isXxxDocumentText()` escolhe qual `parseXxxLine()` roda. Se o parser local
   acha itens, **a IA é pulada** (rápido e barato).
2. **Leitura por IA** (imagem/PDF escaneado, ou texto sem parser): usa o **prompt** do perfil,
   selecionado por `getProfilePromptChain(<KEY>)`.

A classificação visual e o registry vivem em `documentProfiles.ts`.

### Os pontos de despacho (onde o perfil é "ligado")

Existem **3** lugares em `ocrService.ts` que escolhem o perfil por documento. Um perfil novo
precisa ser ligado nos 3 (siga um perfil existente, ex. `ACECAMP_PURCHASE_ORDER`, como molde):

1. `processTextWithStrictCatalog`: declarar `const isXxxDocument = isXxxDocumentText(text)`
   junto dos outros, e adicionar o ramo `: isXxxDocument ? parseXxxLine(line)` na cadeia ternária.
2. **Caminho PDF digital** dentro de `performOCR`: declarar `isXxxDoc`, adicionar o ramo no
   ternário que define `_aiRecheckProfileKey`, e os dois `else if` (um para "parser local
   resolveu → pular IA", outro para "usar o prompt do perfil").
3. **`performOCRFromText`** (recheck/colagem de texto): declarar `isXxxTextDocument`, adicionar
   ao ternário de `recheckProfileKey`, à condição grande `if (... || isXxxTextDocument) && strictCodes.length > 0`,
   e ao ternário de `promptBase`.

### Em `documentProfiles.ts` (5 edições)

1. Adicionar a chave ao union `DocumentProfileKey`.
2. Adicionar a descrição do tipo no `CLASSIFY_PROMPT` (uma linha `- "XXX" → …`).
3. `export const XXX_PROMPT = \`…\`;` — prompt dedicado (ver "Como escrever o prompt").
4. Entrada no registry `READING_PROFILES` com `promptChain: [XXX_PROMPT, GENERIC_FALLBACK_PROMPT]`.
5. Adicionar a chave ao `Set` `validKeys` em `parseClassificationResult`.

## Procedimento passo a passo

1. **Ler o documento** e mapear as colunas: qual é o **código do produto**, qual é a
   **quantidade**, se há **comprimento** e **cor/tratamento**. Anote a ordem das colunas.
2. **Decidir: novo perfil ou refino?**
   - Estrutura idêntica a um perfil existente (mesma ordem de colunas)? → **refine o detector**
     existente com um ramo `OR` e **reutilize o parser** (ex.: foi assim com o layout
     SmartCEM-Alumisoft, que reusa `parseMaterialsRelationLine` via um `OR` em
     `isMaterialsRelationDocumentText`). Menos código, menos risco.
   - Estrutura genuinamente nova? → **novo perfil** isolado.
3. **Escrever o detector** `isXxxDocumentText(text)`: específico, ancorado em tokens únicos do
   cabeçalho/rodapé (nome do sistema, título do relatório, nomes de coluna). Deve ser específico
   o bastante para **não roubar** documentos de outro perfil.
4. **Escrever/reusar o parser** `parseXxxLine(line)` (ver "Armadilhas").
5. **Ligar nos 3 pontos de despacho** + **5 edições em documentProfiles.ts**.
6. **Verificar** (ver "Verificação"). Só dê por concluído com `tsc` limpo e o teste do parser passando.

## Armadilhas comprovadas (regras rígidas)

- **Normalização**: detectores/parsers trabalham sobre `normalizeLineForStrictParsing()` —
  MAIÚSCULAS, sem acento, traços unicode → `-`, espaços colapsados. Escreva os regex assim.
- **`parseNumberToken` e o "N,NNN"**: um token tipo `2,000` ou `18.000` (3 casas decimais e
  inteiro ≤ 9) é tratado como **milhar** → vira `2000`/`18000`. Se o documento usa `N,NNN` para
  representar o **inteiro N** (ex.: NEOCA "Qtde.Comprar" `2,000` = 2), o parser PRECISA extrair a
  parte inteira antes da vírgula (faça como `parseNeocaSimulacaoComprasLine`).
- **Posição da quantidade vs. comprimento**:
  - `extractQuantityAndLengthFromLine` (usado por `parseLine` genérico e `parseBarListLine`)
    pega a qtde **ANTES** do comprimento.
  - `extractMaterialsRelationQuantityAndLength` pega a qtde **DEPOIS** do comprimento.
  - Coluna `Barra` antes de `Qtde` → use o helper de materiais. `Qtde` antes de `Barra` → o genérico.
- **Quantidade na última coluna, sem comprimento** (ex.: ECG): pegue o **último inteiro** da
  linha; números na descrição (`3 À 6 MM`, `38 X 76`, `LINHA 25`, `correr 2`) vêm antes e devem
  ser ignorados. Use `rest.matchAll(/(?<![,.\d])(\d{1,4})(?![,.\d])/g)` e fique com o último.
- **Códigos dimensionais**: `STRICT_PRODUCT_CODE_SOURCE` **NÃO** casa letra-dígito-letra-dígito
  (ex.: `TB38X76`). Em layout colunar limpo, leia o **primeiro token** da linha como código em
  vez de depender do regex compartilhado (com guarda: tem dígito, comprimento plausível).
- **`formatRecognizedCatalogCode`** remove hífens/pontos (exceto `C`+dígito). `LB-061` → `LB061`.
  Não lute contra isso: o casamento com catálogo também normaliza, então ainda casa.
- **Sobrevivência do item**: em `processTextWithStrictCatalog` (perto da linha que verifica
  `isCatalogCode || autoCatalogCandidate || preserveProductCode`), o item só é mantido se uma
  dessas for verdadeira. Coloque **`preserveProductCode: true`** no resultado do parser.
- **Acabamento**: use `mapTreatmentToAcabamento` — PRETO/RAL9005→`EPPF`, BRANCO/RAL9003/RAL9010→`EBCO`,
  NATURAL/BRUTO→`NT`. Sem coluna de cor → `NT`. Comprimento ausente → `6000`.
- **Ordem dos detectores**: cada cadeia testa os detectores numa ordem fixa. Um detector novo
  deve ser específico e posicionado de forma a **não sombrear** nem ser sombreado por outro.

## Como escrever o prompt do perfil

Espelhe um prompt existente (ex.: `ACECAMP_PURCHASE_ORDER_PROMPT`). Inclua: estrutura/colunas,
**qual coluna é o produto e qual é a quantidade** (em CAIXA ALTA quando for crítico), o que
IGNORAR (cabeçalho/rodapé/totais), o mapeamento de acabamento, comprimento padrão 6000, e
**2-5 exemplos reais** do documento no formato `"linha bruta" → { produto, acabamento, qtde, comprimento }`.
Termine com: `Retorne somente JSON com a chave 'items'.`

## Verificação (obrigatória)

1. `npx tsc --noEmit -p tsconfig.json` → **sem saída** (limpo).
2. Teste do parser fora do app: crie um `_dbg.mjs` temporário que replica `normalizeLineForStrictParsing`,
   `formatRecognizedCatalogCode` e o `parseXxxLine`, e rode `node _dbg.mjs` contra as **linhas reais**
   do documento — produtos **e** linhas de cabeçalho/ruído. Confirme: todos os produtos extraídos,
   todo ruído ignorado, e **quantidades corretas** (cheque as armadilhas de número na descrição).
   **Apague o `_dbg.mjs` no fim.**
3. Confirme que o detector novo **não** dispara para amostras de outros perfis.
4. Não toque em nenhum outro perfil; revise o `git diff` para garantir que as mudanças são aditivas.

## Sinalizador de runtime (entrada desta skill)

`buildSelfImprovementHint()` em `ocrService.ts` (read-only) preenche
`validationReport.selfImprovementHint` quando um documento parece mal lido:
- caiu no perfil **GENERIC** (layout novo provável);
- muitos itens **não identificados**;
- **quantidade suspeita** (um comprimento de barra ou um `N,000` redondo lido como qtde).
As razões também aparecem em `discrepancies` (já exibido na UI). Quando esse sinal aparecer
para um documento, **rode esta skill** sobre ele.

## Registro

Após adicionar/refinar um perfil, atualize a memória do projeto
(`memory/project_document_profiles.md` + `MEMORY.md`) com o nome do perfil, a estrutura de
colunas, e as armadilhas específicas — para manter o histórico curado consistente.
