/**
 * documentProfiles.ts
 *
 * Registry of document reading profiles for the OCR pipeline.
 * Each profile contains a specialized prompt chain tailored to a specific
 * document layout, so changes to one profile never break another.
 *
 * Flow for visual documents (images / scanned PDFs):
 *   1. classifyDocument() → quick AI probe returns a profile key + difficulty
 *   2. getProfileChain()  → ordered list of prompts to try in sequence
 *   3. Caller tries each prompt; stops on first non-empty result.
 */

// ── Profile Keys ─────────────────────────────────────────────────────────────

export type DocumentProfileKey =
  | "HANDWRITTEN_COLON"   // Caderno: "TMG 015 : 1"  or  "P 270 : 4"
  | "HANDWRITTEN_DASH"    // Caderno: "06-LG047-01"
  | "HANDWRITTEN_EQUALS"  // Caderno: "SU-093 = B(4)"
  | "BUDGET_TABLE"        // Impressa: Codigo/Descricao/Estoque/UN/Qtde
  | "METAPERFIL_PAINTING_TABLE" // Impressa: Metaperfil Servicos de Pintura (Descricao do Produto/Barras)
  | "PRODUCT_VARIANT_TABLE" // Impressa: Produto/Variante/Linha/Especificacao/Qtde Comercial
  | "DESCRIPTION_CODE_TABLE" // Impressa: Codigo interno + descricao com codigo de perfil + quantidade final
  | "PROFILE_TABLE"       // Impressa: Perfil/Qtde/Tamanho/Peso
  | "MATERIALS_RELATION_TABLE" // Impressa: Relacao de Materiais (Codigo/Descricao/Barra/Qtde/Peso Bruto)
  | "SMARTCEM_BAR_SUMMARY" // Impressa: SmartCEM Relacao de Barras em blocos Codigo/Numero de Barras/Comprimento
  | "BAR_LIST"            // Impressa: Perfil/Tratamento/Qtde/Barra (ALUMICOM)
  | "CUT_ORIENTATION_TABLE" // Impressa: Orientacao de Cortes da Obra
  | "QUOTE_DELIVERY_TABLE" // Impressa: Cotacao/Entrega com Tratamento-Cor/Comp/Qtde/Pesos
  | "COTACAO_OBRA_TABLE"  // Impressa: Cotacao com COR|DESCRICAO|QTDE|OBRA (sem comprimento, agrupado por obra)
  | "EXPORTED_PROFILE_CSV" // CSV/Excel exportado: PRODUTO/ACABAMENTO/QTDE/PRECO/COMPRIMENTO
  | "DFC_QUOTE_SHEET"     // Excel: Cod/Quantidade/Cor/Descricao
  | "SIMPLE_LIST"         // Lista simples impressa ou digital
  | "COLOR_MATRIX_TABLE"  // Tabela matricial com colunas por cor (ex: PRETO, NATURAL)
  | "QUANTITY_FIRST_LIST" // Lista onde a quantidade vem antes do código
  | "BAR_CALCULATION"     // Impressa: Tabela de cálculo de barras (Barra antes de Qtde)
  | "SUJVIDROS_COTACAO_BARRAS" // Impressa: SUJVIDROS Relatório de Cotação de Barras (Código/Descrição/UM/Qtde/Comprimento)
  | "ALUMINORTE_RELACAO_BARRAS" // Impressa: SmartCEM-Esquadgroup Relação de Barras (Perfil/Trat.Cor/Qtde/Barra/Peso/Sobra com grupos CM/SBRUTO)
  | "ACECAMP_PURCHASE_ORDER" // Impressa: Pedido de Compra SASTEC (Código interno | REFERENCIA | Descrição | QTDE | Custo | KG BR | KG Total | Vlr Total)
  | "NEOCA_SIMULACAO_COMPRAS" // Impressa: NEOCA "Relatório de Itens da Simulação de Compras" (Código | Descrição | Cor | UN | Qtde.Comprar)
  | "ECG_PRODUCT_RELATION" // Impressa: ECG Glass "Relação dos Produtos" (Código | Descrição | Qtd(barras), sem comprimento/cor)
  | "CEMONE_ROMANEIO_PERFIS" // Impressa: "Romaneio de Perfis" do CEM ONE - Alumisoft Sistemas (Perfil | Trat./Cor | Qtde (N BR) | Medida | Peso | Total)
  | "GENERIC";            // Fallback genérico

export interface ClassificationResult {
  profile: DocumentProfileKey;
  /** 1 = muito fácil, 5 = muito difícil */
  difficulty: 1 | 2 | 3 | 4 | 5;
  notes?: string;
}

// ── Classification Prompt ────────────────────────────────────────────────────

/**
 * Lightweight prompt sent BEFORE the main OCR call.
 * We ask for JSON only — no data extraction, just document type.
 */
export const CLASSIFY_PROMPT = `
Observe esta imagem brevemente. Não extraia dados de produtos agora.
Apenas identifique o tipo do documento e responda SOMENTE com JSON válido, sem markdown:

{
  "profile": "<TIPO>",
  "difficulty": <1-5>,
  "notes": "<observação curta opcional>"
}

Tipos disponíveis (escolha EXATAMENTE um):
- "HANDWRITTEN_COLON"  → caderno/lista manuscrita onde cada linha usa ":" ou "=" para separar código de quantidade. Ex: "TMG 015 : 1", "P 270 : 4", "SU 007 = 2".
- "HANDWRITTEN_DASH"   → caderno manuscrito com formato "item-código-qtde" usando hífens. Ex: "06-LG047-01", "13-LG061-25".
- "HANDWRITTEN_COLON" tambem cobre listas manuscritas como "SU.057 - 2" e "MP 347 - 1".
- "HANDWRITTEN_EQUALS" → caderno manuscrito com "CODIGO = B(QUANTIDADE)" onde B significa barras. Ex: "SU-093 = B(4)".
- "BUDGET_TABLE"       → tabela impressa com colunas: Codigo, Descricao, UN, Quantidade Orcamento (e opcionalmente Estoque Disp, Peso).
- "METAPERFIL_PAINTING_TABLE" -> relatorio "METAPERFIL SERVICOS DE PINTURA" com colunas Cod., Imagem, Barras, Descricao do Produto, Tipo, Nao Conformidade. O produto fica em Descricao do Produto.
- "PRODUCT_VARIANT_TABLE" → tabela impressa com colunas: Produto, Variante do Produto, Linha, Especificacao, Qtde Comercial, Unidade Comercial.
- "DESCRIPTION_CODE_TABLE" -> tabela impressa sem cabecalho claro onde a primeira coluna pode ser codigo interno (ex: 30-023) e a descricao contem o perfil real (ex: P-273 / MARCO). A quantidade fica na ultima coluna.
- "PROFILE_TABLE"      → tabela impressa com colunas: Perfil, Qtde, Tamanho, Peso(KG), Sobra.
- "MATERIALS_RELATION_TABLE" -> relatorio "Relacao de Materiais" / "PERFIS" com colunas: Codigo, Descricao, Tratamento/Cor, Barra, Qtde, Peso Bruto. Neste layout Barra vem antes de Qtde.
- "SMARTCEM_BAR_SUMMARY" -> relatorio SmartCEM "Relacao de Barras" onde cada item aparece em bloco com "Codigo:", "Tratamento:", "Numero de Barras:" e "Comprimento da barra:".
- "BAR_LIST"           → tabela impressa (ex: Alumicom) com colunas: Perfil, Tratamento, Qtde, Barra, Peso. SEM grupos como "CM CONTRAMARCO" ou "SBRUTO SÓLIDO BRUTO".
- "ALUMINORTE_RELACAO_BARRAS" → "Relação de Barras" do sistema SmartCEM-Esquadgroup (Aluminorte/Norte Lumi). Coluna chama-se "Trat./Cor" (não "Tratamento"). Possui cabeçalhos de grupo como "CM CONTRAMARCO", "SBRUTO SÓLIDO BRUTO", "AZ-P-RAL9003B Arremate-..." e "SA-P-RAL9003B Solido-...". Códigos podem ser puramente numéricos (3046, 42014, 42006) ou alfanuméricos (RM005, FA-259, CL006). Rodapé: "SmartCEM - Esquadgroup".
- "QUOTE_DELIVERY_TABLE" → cotacao/entrega impressa com colunas: CODIGO/DESCRICAO, REFERENCIA, TRATAMENTO/COR, COMP., QTDE., BARRA(KG), TOTAL(KG).
- "COTACAO_OBRA_TABLE"  → cotacao impressa com APENAS 4 colunas: COR | DESCRICAO | QTDE | OBRA. Sem coluna de comprimento. A cor fica em celula mesclada. Os itens sao agrupados por OBRA (ex: ANA, RENATA, GUITA). Dificuldade tipica: 2.
- "EXPORTED_PROFILE_CSV" → CSV/Excel estruturado com colunas: PRODUTO, ACABAMENTO, QTDE, PREÇO, COMPRIMENTO.
- "DFC_QUOTE_SHEET"    → Excel estruturado com cabecalho: Cód, Quantidade, Cor, Descrição.
- "COLOR_MATRIX_TABLE" → tabela impressa onde as cores (ex: PRETO, NATURAL) são COLUNAS e as quantidades estão abaixo delas.
- "SIMPLE_LIST"        → lista simples impressa ou digital com código e quantidade em cada linha.
- "QUANTITY_FIRST_LIST" → lista simples onde a QUANTIDADE vem ANTES do código em cada linha. Ex: "09 CM-060", "02 TUB-4054".
- "BAR_CALCULATION"     → tabela de cálculo de barras/resumo. Colunas típicas: Seção, Material, Descrição, Barra, Qtde, Peso, Tipo. Barra (comprimento) vem antes de Qtde.

- "CUT_ORIENTATION_TABLE" -> relatorio "Orientacao de Cortes da Obra" com grupos por tratamento/cor e colunas Perfil, Tratamento, Qtde, Barra, Peso Bruto e Peso Sobra.

- "SUJVIDROS_COTACAO_BARRAS" → relatório "Relatório de Cotação de Barras" do sistema SUJVIDROS. Tem cabeçalho com CLIENTE e OBRA, grupos por "Tratamento: BRANCO/NATURAL" e colunas Código | Descrição | UM (PER/TA/SA) | Qtde | Comprimento (6000). Códigos como 20SP-F01, 20SP-M21, MONT-6,5, TBR1".
- "ACECAMP_PURCHASE_ORDER" → "Pedido de Compra" do sistema SASTEC (www.sastec.com.br). Título contém "PEDIDO DE COMPRA - XXXX - ENTREGA:". Colunas: CÓDIGO (interno, ex: 90-016-NAT) | REFERENCIA (produto real, ex: LG-016) | DESCRIÇÃO | QTDE | CUSTO | KG BR | KG TOTAL | VLR. TOTAL. O produto a importar é a coluna REFERENCIA, não CÓDIGO. Comprimento sempre 6000. Acabamento derivado do sufixo do CÓDIGO (NAT→NT, EBCO→EBCO).
- "NEOCA_SIMULACAO_COMPRAS" → "RELATÓRIO DE ITENS DA SIMULAÇÃO DE COMPRAS" da NEOCA VIDRAÇARIA. Cabeçalho contém "SIMULAÇÃO DE COMPRAS" e "SIMULAÇÃO NRO.". Colunas: Código | Descrição | Cor | UN | Qtde.Comprar. O produto é a coluna Código (ex: MP347, SU001, VZ051, 25-548). A quantidade está em "Qtde.Comprar" no formato "N,000" (decimal de 3 casas representando inteiro: "2,000"=2, "18,000"=18). Cor (PRETO/BRANCO/NATURAL) é o acabamento; UN (BR) é ignorado. Comprimento sempre 6000.
- "ECG_PRODUCT_RELATION" → "RELAÇÃO DOS PRODUTOS" do sistema ECG Glass (ecgsistemas.com), ex: ATACADÃO DOS BOX. Cabeçalho "RELAÇÃO DOS PRODUTOS" + seção "PERFIL". Colunas: Código | Descrição | Qtd (barras). SEM coluna de comprimento e SEM coluna de cor/tratamento. O produto é a coluna Código (ex: 25540, BG057, SU001, TB38X76, LB-061). A quantidade é a ÚLTIMA coluna "Qtd (barras)" (último número inteiro da linha). Comprimento sempre 6000; acabamento "NT".
- "CEMONE_ROMANEIO_PERFIS" → "Romaneio de Perfis" do sistema CEM ONE - Alumisoft Sistemas (rodapé "CEM ONE - Alumisoft Sistemas"). Colunas: Perfil | Tratamento/Cor | Qtde. | Medida | % IPI | Peso (kg) | $ Total. A quantidade aparece como "N BR" (ex: "2 BR", "11 BR", "59 BR"). O comprimento = coluna Medida (6000 mm ou 3000 mm). Acabamento: NATURAL→NT, ANODIZADO FOSCO→FOS, PINTURA CINZA NEGRO/RAL7021→EPPF.

Dificuldade:
- 1 = impresso claro e organizado
- 2 = impresso com alguma variação
- 3 = manuscrito claro (letras garrafais)
- 4 = manuscrito com abreviações ou caligrafia difícil
- 5 = manuscrito muito difícil, rabisco, colado, rasurado

Responda APENAS o JSON.
`;

// ── Specialized Prompts ──────────────────────────────────────────────────────

export const HANDWRITTEN_COLON_PROMPT = `
Você está lendo um CADERNO MANUSCRITO de pedido de perfis de alumínio.

FORMATO PRINCIPAL — DOIS-PONTOS OU IGUAL:
Cada linha segue um dos padrões:
  CÓDIGO : QUANTIDADE   →  "TMG 015 : 1"   produto "TMG015", qtde 1
  CÓDIGO = QUANTIDADE   →  "P 270 = 4"     produto "P270",   qtde 4
  CÓDIGO - QUANTIDADE   →  "SU.057 - 2"     produto "SU057",  qtde 2
  CÓDIGO : QUANTIDADE   →  "SU 007 : 2"    produto "SU007",  qtde 2

REGRAS DE NORMALIZAÇÃO DO CÓDIGO:
- Remova espaços internos do código: "TMG 015" → "TMG015", "SU 007" → "SU007", "L 332" → "L332".
- Remova pontos usados como separador entre prefixo e numeros: "SU.057" → "SU057".
- Remova hífens simples entre letras e números: "SU-007" → "SU007".
- EXCEÇÃO: preserve "C-NÚMERO" no final do código (ex: "Z201CFC-5600" permanece assim).
- Se o código contiver "CF" seguido de número sem hífen (ex: "Z201CF13"), formate como "Z201CFC-13".

SEPARADORES ACEITOS: ":" (dois-pontos), "=" (igual), "-" (traço), ou espaço antes do número final.
A quantidade é SEMPRE o último número da linha após o separador. Nunca tem decimais.

REGRA PARA ITENS COM DESCRIÇÃO (sem código alfanumérico):
Se a linha contiver apenas uma descrição como "LAMBRIL DUPLO = 5" ou "FECHADURA = 2",
extraia a descrição como produto e o número como quantidade.

ATENÇÃO — DUAS COLUNAS:
Muitas folhas de caderno têm DUAS COLUNAS verticais. Leia cada coluna de cima a baixo,
depois passe para a próxima. Mantenha a ordem: coluna esquerda primeiro, depois direita.

ATENÇÃO — LEITURA DE CALIGRAFIA:
- "6" pode ser "G", "0" pode ser "O", "1" pode ser "I" ou "L", "8" pode ser "B".
- Prefixos comuns: TMG, TMN, SU, MN, LG, P, L, V, Z, BG, CM, J, SL, TG, TUB, MP, US, UZ, VZ, GS, CG, FC, ME, SK, PR, CT.
- Se uma letra parecer ambígua mas o código fizer sentido com prefixo conhecido, use-o.

LOCALIZAÇÃO: Para cada item, retorne "box_2d" com coordenadas [ymin, xmin, ymax, xmax] (0-1000).

Retorne JSON com a chave 'items'. Não retorne items vazio se o documento estiver legível.
`;

export const HANDWRITTEN_DASH_PROMPT = `
Você está lendo um CADERNO MANUSCRITO de pedido de perfis de alumínio.

FORMATO PRINCIPAL — ITEM-CÓDIGO-QUANTIDADE COM HÍFENS:
  "06-LG047-01" → produto "LG047", qtde 1
  "07-LG002-02" → produto "LG002", qtde 2
  "13-LG061-25" → produto "LG061", qtde 25

O primeiro número é o número do item (ignore).
O trecho do meio é o CÓDIGO DO PRODUTO.
O último número é a QUANTIDADE.

NUNCA junte o número final ao código: "LG047-01" está ERRADO como produto.

ATENÇÃO — CALIGRAFIA:
- "6" pode ser "G", "0" pode ser "O", "8" pode ser "B".
- Prefixos comuns: LG, SU, MN, BG, P, Z, TG, SL.

LOCALIZAÇÃO: Retorne "box_2d" com [ymin, xmin, ymax, xmax] (0-1000) para cada item.

Retorne JSON com a chave 'items'.
`;

export const HANDWRITTEN_EQUALS_PROMPT = `
Você está lendo um CADERNO MANUSCRITO de pedido de perfis de alumínio.

FORMATO PRINCIPAL — CÓDIGO = B(QUANTIDADE):
  "SU-093 = B(4)"   → produto "SU093",  qtde 4
  "SU-100 = B(10)"  → produto "SU100",  qtde 10
  "LG028 = B 5"     → produto "LG028",  qtde 5

A letra "B" significa barras e deve ser ignorada. Extraia apenas o número após "B".
A quantidade é o número entre parênteses ou logo após "B".

NORMALIZAÇÃO DO CÓDIGO:
- Remova hífens simples: "SU-093" → "SU093".
- Remova espaços internos: "SU 093" → "SU093".

LOCALIZAÇÃO: Retorne "box_2d" com [ymin, xmin, ymax, xmax] (0-1000) para cada item.

Retorne JSON com a chave 'items'.
`;

export const BUDGET_TABLE_PROMPT = `
Você está lendo uma TABELA DE ORÇAMENTO impressa de perfis de alumínio.

ESTRUTURA DA TABELA:
Colunas: Codigo | Descricao | [Estoque Disp] | UN | Quantidade Orcamento | Peso Unitario | Peso Total

NAO CONFUNDIR COM COTACAO/ENTREGA:
- Se o cabecalho tiver "CODIGO/DESCRICAO", "TRATAMENTO/COR", "COMP.", "QTDE.", "BARRA(KG)" e "TOTAL(KG)", trate "TRATAMENTO/COR" como acabamento/cor e use somente "QTDE." como quantidade.
- Nesse layout, "COMP." e o comprimento e "BARRA(KG)" / "TOTAL(KG)" sao pesos.

REGRA PRINCIPAL:
- O "Codigo" numérico (ex: 8014, 8006) é apenas um identificador interno. IGNORE-O como produto.
- O produto verdadeiro está na coluna "Descricao", logo após a palavra "PERFIL".
  Ex: "PERFIL SU 111 CR - PERFIL MONTANTE..." → produto "SU111"
  Ex: "PERFIL PC 004 CR - TUBO 2X1..."       → produto "PC004"
  Ex: "PERFIL ALCG 72 CR - GUARDA CORPO..."  → produto "ALG72"
  Ex: "PERFIL J SLIM CR..."                  → produto "JSLIM"
  Ex: "PERFIL TG 072 CR - TUBO..."           → produto "TG072"

EXTRAÇÃO DA QUANTIDADE:
- Se houver coluna "Estoque Disp", o número antes de "UN" é o ESTOQUE — IGNORE-O.
- A quantidade correta é o PRIMEIRO INTEIRO APÓS "UN" (coluna Quantidade Orcamento).
  Ex: "... 0 UN 37 3,0000 111,0000" → qtde 37  (0 é estoque, 37 é quantidade)
  Ex: "... UN 75 3,6960 277,2000"   → qtde 75

NORMALIZAÇÃO DO CÓDIGO:
- Remova espaços internos: "SU 111" → "SU111", "PC 004" → "PC004", "J SLIM" → "JSLIM".
- Preencha "produtoOriginal" com a linha/descrição de onde o perfil foi lido.

Retorne JSON com a chave 'items'.
`;

export const METAPERFIL_PAINTING_TABLE_PROMPT = `
Voce esta lendo um relatorio impresso "METAPERFIL SERVICOS DE PINTURA".

ESTRUTURA DA TABELA:
Cabecalho superior com dados do pedido e acabamento, depois colunas:
Cod. | Imagem | Barras | Descricao do Produto | Tipo | Nao Conformidade

REGRA PRINCIPAL:
- O produto correto fica na coluna "Descricao do Produto". NUNCA use a coluna "Cod." como produto, pois ela e codigo interno/ordem da Metaperfil.
- A quantidade correta fica na coluna "Barras".
- O acabamento deve vir do cabecalho "Acabamento:" (ex: "ANODIZADO BRONZE 1001"). Se nao conseguir ler, use "NT".
- Use comprimento 6000 quando nao houver comprimento explicito.
- Ignore as colunas Imagem, Tipo e Nao Conformidade.

EXEMPLOS:
"Cod. 468 | Barras 1 | Descricao do Produto 80041 | Tipo DN | Amassada"
-> produto "80041", qtde 1, acabamento do cabecalho, comprimento 6000

"Cod. 3205 | Barras 1 | Descricao do Produto MP347 | Tipo DN | Amassada"
-> produto "MP347", qtde 1, acabamento do cabecalho, comprimento 6000

Retorne somente JSON com a chave 'items'. Nao retorne items vazio se houver linhas legiveis.
`;

export const PRODUCT_VARIANT_TABLE_PROMPT = `
Voce esta lendo uma TABELA COMERCIAL impressa de perfis de aluminio.

ESTRUTURA DA TABELA:
Colunas: Produto | Variante do Produto | Linha | Especificacao | Qtde Comercial | Unidade Comercial

REGRA PRINCIPAL:
- Crie um item para cada linha real de produto.
- Use SOMENTE a coluna "Produto" para extrair o produto.
- Quando a celula "Produto" tiver "CODIGO - descricao", o produto e apenas o CODIGO antes do primeiro " - ".
  Ex: "CT209 - CANTONEIRA DE ABAS DESIGUAIS" -> produto "CT209"
  Ex: "MP347 - Arremate" -> produto "MP347"
  Ex: "US285 - VENEZIANA VENTILADA" -> produto "US285"
- Preencha "produtoOriginal" com a celula inteira da coluna Produto.
- Nao crie item separado para a descricao depois do hifen.

EXTRACAO DA QUANTIDADE:
- A quantidade correta esta exclusivamente na coluna "Qtde Comercial".
- Valores como "2,00000", "1,00000" e "14,00000" significam qtde 2, 1 e 14.
- Ignore numeros manuscritos no topo da foto, como "41,40" e "35,50".
- Ignore medidas e numeros das descricoes, como "32 X 16,2", "1,2 MM", "2 PLANOS", "6000 MM" e "RAL9005F".
- Ignore a coluna "Unidade Comercial" (ex: "BR").

COMPRIMENTO E ACABAMENTO:
- Se "Variante do Produto" contiver "6000 MM", use comprimento 6000. Se nao encontrar, use 6000.
- Se "Especificacao" contiver RAL9005, RAL9003 ou RAL9010, use esse valor como acabamento.
- Se nao houver RAL e a variante contiver NATURAL, use acabamento "NT".
- O acabamento deve vir da mesma linha do produto. Nao copie RAL de linhas acima ou abaixo.
- Se a celula "Especificacao" estiver vazia ou ilegivel, use "NT" quando a variante for NATURAL.

EXEMPLOS:
"CT209 - CANTONEIRA DE ABAS DESIGUAIS | NATURAL / 6000 MM | CANTONEIRA-B. CHATA | | 2,00000 | BR"
-> produto "CT209", produtoOriginal "CT209 - CANTONEIRA DE ABAS DESIGUAIS", acabamento "NT", qtde 2, comprimento 6000, identificado true

"MP347 - Arremate | NATURAL / 6000 MM | ARREMATES | RAL9005F | 2,00000 | BR"
-> produto "MP347", produtoOriginal "MP347 - Arremate", acabamento "RAL9005F", qtde 2, comprimento 6000, identificado true

"SK001 - MARCO SUPERIOR 2 PLANOS | NATURAL / 6000 MM | AGLO 2.5 | RAL9005F | 1,00000 | BR"
-> produto "SK001", produtoOriginal "SK001 - MARCO SUPERIOR 2 PLANOS", acabamento "RAL9005F", qtde 1, comprimento 6000, identificado true

"US285 - VENEZIANA VENTILADA | NATURAL / 6000 MM | LINHA SUPREMA | RAL9005F | 14,00000 | BR"
-> produto "US285", produtoOriginal "US285 - VENEZIANA VENTILADA", acabamento "RAL9005F", qtde 14, comprimento 6000, identificado true

LOCALIZACAO: Para cada item, retorne "box_2d" com [ymin, xmin, ymax, xmax] (0-1000) quando possivel.

Retorne JSON com a chave 'items'. Nao retorne items vazio se a tabela estiver legivel.
`;

export const DESCRIPTION_CODE_TABLE_PROMPT = `
Voce esta lendo uma tabela impressa de pedido com linhas de produto e quantidade final.

ESTRUTURA COMUM:
Primeira coluna: pode ser codigo interno do fornecedor (ex: 30-023, 30-377, 30-034).
Segunda coluna / descricao: pode conter o codigo real do perfil antes de "/" ou antes da descricao (ex: "P-273 / MARCO PORTA DE GIRO").
Colunas intermediarias: acabamento/tratamento (ex: METAL 01, METAL).
Ultima coluna: quantidade inteira.

REGRA PRINCIPAL:
- Se a primeira coluna for codigo interno no formato NN-NNN e a descricao tiver um codigo de perfil (P-273, L-519 etc), use o codigo da descricao como produto.
- Se a primeira coluna ja for um perfil claro (MP347, PR-001, TUB-4501, US285, 50X50), use a primeira coluna como produto.
- Se a linha nao tiver codigo de perfil, mas tiver descricao de material e quantidade, use a descricao principal como produto e marque identificado false.
- A quantidade correta e sempre o inteiro da ultima coluna da linha. Ignore numeros dentro da descricao, como 100 MM, 165 X 21,5, 25,4 X 12,7.
- Use acabamento da coluna de tratamento/cor quando legivel; se nao houver, use "NT".
- Use comprimento 6000 quando nao houver comprimento explicito.
- Ignore totais no rodape.

EXEMPLOS:
"30-023 | P-273 / MARCO PORTA DE GIRO | METAL 01 | METAL | 4"
-> produto "P273", qtde 4, acabamento "METAL 01", comprimento 6000

"MP347 | ARREMATE / FACE INTERNA | METAL 01 | METAL | 5"
-> produto "MP347", qtde 5, acabamento "METAL 01", comprimento 6000

"TUB-4501 | TUBO RETANGULAR 25,4 X 12,7 X 1,59MM | METAL 01 | METAL | 6"
-> produto "TUB4501", qtde 6, acabamento "METAL 01", comprimento 6000

Retorne somente JSON com a chave 'items'. Nao retorne items vazio se houver linhas legiveis.
`;

export const PROFILE_TABLE_PROMPT = `
Você está lendo uma TABELA DE PRODUÇÃO/CORTE de perfis de alumínio (ex: Relação de Barras).

ESTRUTURA DA TABELA:
Colunas comuns: Perfil | [Tratamento] | Qtde | [Tamanho / Barra] | Peso(KG) | Sobra(KG)

NAO CONFUNDIR COM COTACAO/ENTREGA:
- Se o cabecalho tiver "CODIGO/DESCRICAO", "TRATAMENTO/COR", "COMP.", "QTDE.", "BARRA(KG)" e "TOTAL(KG)", trate "TRATAMENTO/COR" como acabamento/cor e use somente "QTDE." como quantidade.
- Nesse layout, "COMP." e o comprimento e "BARRA(KG)" / "TOTAL(KG)" sao pesos.

REGRA PRINCIPAL:
- Use o valor da coluna "Perfil" como produto. Atenção: o código pode ser puramente numérico (ex: 25548) ou alfanumérico (ex: FC-225). Extraia EXATAMENTE como escrito.
- Use o valor da coluna "Qtde" como quantidade.
- Use o valor da coluna "Tamanho" ou "Barra" como comprimento (em mm, ex: 6000).
- IGNORE completamente as colunas de Peso e Sobra.

Ex: "CM200  5054  6000  6004.152  278.639" → produto "CM200", qtde 5054, comprimento 6000.
Ex: "25548  3  6000  5,058  1,352" → produto "25548", qtde 3, comprimento 6000.

COMPARAÇÃO COM CATÁLOGO:
Ignore hífens e espaços ao comparar: "SU010" equivale a "SU-010".

Retorne JSON com a chave 'items'.
`;

export const SMARTCEM_BAR_SUMMARY_PROMPT = `
Voce esta lendo um relatorio SmartCEM "Relacao de Barras" de perfis de aluminio.

ESTRUTURA DO DOCUMENTO:
Cada produto ocupa um bloco de varias linhas:
Codigo: <CODIGO> Tratamento: <TRATAMENTO>
Serie: <SERIE> Descricao: <DESCRICAO>
Numero de Barras: <QTDE> Peso Bruto Total: <PESO>
Comprimento da barra: <COMPRIMENTO> Comprimento Total: <TOTAL>

REGRA PRINCIPAL:
- Crie UM item para cada bloco iniciado por "Codigo:".
- O produto e exatamente o valor apos "Codigo:" e antes de "Tratamento:".
- O codigo pode ter letras, numeros, hifens, underline e pontos. Preserve codigos compostos como "DP-PR003", "CANTO_15.0X15.0MM" e "UCAVALAO_10MM_12MM".
- A quantidade correta e "Numero de Barras". Nunca use Peso Bruto Total.
- O comprimento correto e "Comprimento da barra". Nunca use Comprimento Total como quantidade.
- Use o tratamento como acabamento/cor. Mapeie PRETO/RAL9005 para EPPF, BRANCO/RAL9003/RAL9010 para EBCO, NATURAL para NT e FOSCO para FOS.
- Ignore cabecalhos, obra, cliente, observacoes, peso total, rodape e numero de pagina.
- Leia todas as paginas e todos os blocos antes de responder.

EXEMPLO:
"Codigo: BG057 Tratamento: PINTURA PRETO FOSCO - RAL9005F"
"Numero de Barras: 15 Peso Bruto Total: 15,300"
"Comprimento da barra: 6000 Comprimento Total: 90000"
-> produto "BG057", acabamento "EPPF", qtde 15, comprimento 6000

Retorne somente JSON com a chave 'items'. Nao retorne items vazio se houver blocos legiveis.
`;

export const BAR_LIST_PROMPT = `
REGRA ABSOLUTA - DOCUMENTO COMPLETO:
- O OCR deve percorrer todas as paginas do documento antes de liberar o preview.
- Nao considere a leitura concluida se alguma pagina ainda nao foi processada.
- Quando receber uma pagina especifica, extraia tudo que estiver visivel nela; o sistema acumulara as paginas em ordem.

Você está lendo um documento de "RELAÇÃO DE BARRAS" (ex: Alumicom).

ESTRUTURA DA TABELA:
As colunas principais são: Perfil | Tratamento | Qtde | Barra | Peso Bruto | Peso Sobra

NAO CONFUNDIR COM COTACAO/ENTREGA:
- Se o cabecalho tiver "CODIGO/DESCRICAO", "TRATAMENTO/COR", "COMP.", "QTDE.", "BARRA(KG)" e "TOTAL(KG)", trate "TRATAMENTO/COR" como acabamento/cor e use somente "QTDE." como quantidade.
- Nesse layout, "COMP." e o comprimento e "BARRA(KG)" / "TOTAL(KG)" sao pesos; nao use "BARRA(KG)" como comprimento.

REGRA DE EXTRAÇÃO:
- "Perfil": Este é o CÓDIGO DO PRODUTO. Pode ser numérico (ex: 25548) ou alfanumérico (ex: FC-225). Extraia EXATAMENTE como escrito.
- A primeira coluna pode ter um desenho pequeno do perfil. IGNORE o desenho e leia o código textual ao lado/debaixo dele.
- "Tratamento": Esta é a cor/acabamento.
- "Qtde": Esta é a quantidade de barras (número inteiro).
- "Barra": Este é o comprimento em mm (ex: 6000).

ATENÇÃO:
- IGNORE as linhas de cabeçalho de grupo (ex: "SA-P-RAL9005 Solido-RAL9005-PRETO").
- Extraia cada linha de produto individualmente.
- Use fidelidade absoluta aos códigos.
- NÃO retorne items vazio se houver linhas legíveis na tabela. Se conseguir ler apenas parte, retorne os itens que conseguiu ler.

Para cada item, retorne:
- produto: código da coluna Perfil
- produtoOriginal: linha/código original lido
- acabamento: EPPF quando tratamento tiver RAL9005 ou PRETO; EBCO para branco; NT para natural/bruto
- qtde: número inteiro da coluna Qtde
- comprimento: número da coluna Barra
- identificado: true

Exemplo:
{
  "items": [
    {
      "produto": "25548",
      "produtoOriginal": "25548 RAL9005 - PINTURA PRETO 3 6000",
      "acabamento": "EPPF",
      "qtde": 3,
      "comprimento": 6000,
      "identificado": true
    },
    {
      "produto": "FC-225",
      "produtoOriginal": "FC-225 RAL9005 - PINTURA PRETO 4 6000",
      "acabamento": "EPPF",
      "qtde": 4,
      "comprimento": 6000,
      "identificado": true
    }
  ]
}

Retorne somente JSON com a chave 'items'.
`;

export const MATERIALS_RELATION_TABLE_PROMPT = `
Voce esta lendo um relatorio impresso de "RELACAO DE MATERIAIS" com secao "PERFIS".

ESTRUTURA DA TABELA:
Cabecalho tipico:
Codigo | Descricao | Tratamento / Cor | Barra | Qtde | Peso Bruto

REGRA CRITICA DE COLUNAS:
- Neste layout, a coluna "Barra" vem ANTES da coluna "Qtde".
- "Barra" e o comprimento em mm, normalmente 3000 ou 6000.
- "Qtde" e o primeiro numero inteiro depois da coluna Barra.
- "Peso Bruto" vem depois de Qtde e deve ser ignorado, mesmo quando parece um numero grande ou decimal.

REGRA PRINCIPAL:
- Use a coluna "Codigo" como produto.
- Use a coluna "Descricao" apenas em produtoOriginal.
- A descricao pode conter numeros, como "CORRER 2", "CORRER 3", "2 PLANOS", "A 40,00" ou "E 3,00". Esses numeros NUNCA sao quantidade.
- A quantidade correta vem somente depois do comprimento/Barra.
- O acabamento deve ser "NT" quando o titulo ou tratamento indicar ALUMINIO NATURAL, NATURAL, BRUTO ou quando a coluna Tratamento/Cor estiver vazia.
- Se Tratamento/Cor indicar RAL9005 ou PRETO, use "EPPF"; se indicar BRANCO, RAL9003 ou RAL9010, use "EBCO".

LINHAS SEM CODIGO:
- Se uma linha nao tiver codigo alfanumerico, mas tiver uma descricao clara de produto e as colunas Barra e Qtde, extraia a descricao principal como produto.
- Exemplo: "PERFIL MUXARABI - POR FAVOR INFORMAR A LARGURA ... 6000 40" -> produto "PERFIL MUXARABI", comprimento 6000, qtde 40, identificado false.

EXEMPLOS CORRETOS:
"CM200 CONTRA MARCO 6000 41 48,708" -> produto "CM200", qtde 41, comprimento 6000
"LG044 MARCO SUPERIOR - 2 PLANOS 6000 2 14,928" -> produto "LG044", qtde 2, comprimento 6000
"SU001 MARCO SUPERIOR / CORRER 2 6000 6 27,432" -> produto "SU001", qtde 6, comprimento 6000
"TQ510 TUBO QUADRADO COM RAIOS - A 40,00 - E 3,00 - 6000 1 6,924" -> produto "TQ510", qtde 1, comprimento 6000

Retorne somente JSON com a chave 'items'. Nao retorne items vazio se houver linhas legiveis.
`;

export const CUT_ORIENTATION_TABLE_PROMPT = `
Voce esta lendo um relatorio impresso de "ORIENTACAO DE CORTES DA OBRA" para perfis de aluminio.

ATENCAO - ESTE PDF PODE TER FONTE CUSTOMIZADA:
- O texto interno do PDF pode parecer codificado ou ilegivel quando extraido automaticamente.
- Use a imagem visual da pagina como fonte da verdade. Leia os glifos visiveis, nao o texto interno codificado.

ESTRUTURA DA TABELA:
Colunas tipicas: Perfil | Tratamento | Qtde | Barra | Peso Bruto | Peso Sobra
O documento pode ter grupos por acabamento/tratamento, por exemplo linhas de grupo contendo RAL9005, PRETO, SOLIDO, ARREMATE, TUBULAR ou descricoes semelhantes.

REGRA PRINCIPAL:
- Extraia uma linha de item para cada linha real de produto.
- Use somente a coluna "Perfil" como produto.
- Use a coluna "Tratamento" como acabamento/cor.
- Use somente a coluna "Qtde" como quantidade.
- Use somente a coluna "Barra" como comprimento em mm, normalmente 6000 ou 6500.
- Ignore completamente "Peso Bruto", "Peso Sobra", totais, subtotais e cabecalhos de grupo.

COMO DIFERENCIAR NUMEROS:
- "Qtde" e um inteiro pequeno/medio antes da coluna "Barra".
- "Barra" e o comprimento da barra, normalmente 6000, 6500 ou outro valor em milimetros.
- Pesos usam virgula decimal ou aparecem apos a coluna Barra. Nao use pesos como quantidade.
- Linhas como "Subtotal", "Sub total" ou "Total" nao sao produtos.

NORMALIZACAO:
- Preserve o codigo do perfil como esta visualmente, removendo apenas espacos e hifens internos simples quando forem separadores de OCR. Ex: "BX 001" -> "BX001", "AE-011" -> "AE011".
- Se o tratamento indicar RAL9005 ou PRETO, retorne acabamento "EPPF".
- Se indicar BRANCO, RAL9003 ou RAL9010, retorne "EBCO".
- Se indicar NATURAL, BRUTO ou SEM PINTURA, retorne "NT".
- Caso contrario, retorne o tratamento lido.
- Use "identificado": true para cada linha legivel.

EXEMPLO:
"BX001 | RAL9005 - PINTURA PRETO | 3 | 6000 | 4,250 | 0,120"
-> produto "BX001", acabamento "EPPF", qtde 3, comprimento 6000

Retorne somente JSON com a chave 'items'. Nao retorne items vazio se houver linhas legiveis na tabela.
`;

export const QUOTE_DELIVERY_TABLE_PROMPT = `
Voce esta lendo uma COTACAO/ENTREGA impressa de perfis de aluminio.

ESTRUTURA DA TABELA:
Cabecalho tipico:
CODIGO/DESCRICAO | REFERENCIA | TRATAMENTO/COR | COMP. | QTDE. | BARRA (KG) | TOTAL (KG)

REGRA ABSOLUTA:
- "TRATAMENTO/COR" e cor/acabamento. NUNCA use essa coluna como quantidade.
- A coluna "TRATAMENTO/COR" pode conter numeros e codigos de cor/tratamento, como "TST-0320 LINHEIRO", "RAL9005", "PRETO", "BRANCO" ou "NATURAL". Esses numeros continuam sendo cor/acabamento.
- A unica quantidade correta esta na coluna "QTDE.", normalmente logo depois de "COMP.".
- "COMP." e comprimento: "6.000" significa 6000 mm.
- "BARRA (KG)" e "TOTAL (KG)" sao pesos. Ignore completamente esses valores, mesmo quando parecerem numeros proximos da quantidade.

REGRA DE EXTRACAO:
- Use a coluna "CODIGO/DESCRICAO" como produto, pegando apenas o codigo da linha (ex: BG057, LG002, LG003, LG007).
- A descricao pode ficar na linha de baixo (ex: BAGUETE, MARCO, FOLHA). Ela deve ir apenas em produtoOriginal quando ajudar, nunca em produto.
- Use a coluna "TRATAMENTO/COR" como acabamento. Se o tratamento for "TST-0320 LINHEIRO", retorne acabamento "TST-0320 LINHEIRO" e nao "NT".
- Use a coluna "QTDE." como qtde inteira.
- Use a coluna "COMP." como comprimento.
- Retorne um item para cada codigo listado, mantendo a ordem de cima para baixo.

EXEMPLOS CORRETOS:
"BG057 | BAGUETE | TST-0320 LINHEIRO | 6.000 | 10 | 1,02 | 10,20"
-> produto "BG057", acabamento "TST-0320 LINHEIRO", comprimento 6000, qtde 10

"LG002 | MARCO LATERAL 02 PLANOS (102MM) - GOLD | TST-0320 LINHEIRO | 6.000 | 2 | 3,83 | 7,67"
-> produto "LG002", acabamento "TST-0320 LINHEIRO", comprimento 6000, qtde 2

Retorne somente JSON com a chave 'items'. Nao retorne items vazio se houver linhas legiveis.
`;

export const COTACAO_OBRA_TABLE_PROMPT = `
Voce esta lendo uma COTACAO DE PERFIS DE ALUMINIO com tabela agrupada por obra/cliente.

ESTRUTURA DA TABELA:
Colunas: COR | DESCRICAO | QTDE | OBRA

REGRA DO CAMPO COR (celula mesclada):
- A coluna "COR" representa o acabamento/pintura e pode ter celula mesclada — o valor aparece
  apenas na primeira linha do grupo e se aplica a todas as linhas seguintes ate a proxima ocorrencia de COR.
- Exemplo: "BRANCO" aparece uma vez e vale para as 30+ linhas abaixo ate o proximo COR diferente.
- Mapeamento de acabamento:
  BRANCO, RAL9003, RAL9010 → "EBCO"
  PRETO, RAL9005           → "EPPF"
  NATURAL, BRUTO, INCOLOR  → "NT"
  Outro valor              → use o valor lido como acabamento.

REGRA DA COLUNA DESCRICAO:
- Esta coluna contem o CODIGO DO PRODUTO (ex: "LG 070", "MN 001", "VZ 051 C/ FURO").
- Remova espacos entre prefixo alfabetico e numero: "LG 070" → "LG070", "MN 001" → "MN001".
- Preserve prefixos compostos: "TUB 4530" → "TUB4530", "DS 238" → "DS238".
- REGRA CF (FURO): Se o codigo tiver sufixo "C/ FURO", "C/FURO", "COM FURO", "C/F", "VENTILADO" ou "V",
  adicione "CF" ao final do codigo e remova o sufixo.
  Ex: "VZ 051 C/ FURO" → "VZ051CF". "LG 059 V" → "LG059CF".
- REGRA S/FURO: Se o sufixo for "S/ FURO" ou "S/FURO" (sem furo), ignore o sufixo completamente.
  Ex: "VZ 051 S/ FURO" → "VZ051".

REGRA DA COLUNA QTDE:
- Sempre numero inteiro. Nunca decimal.
- Extraia somente desta coluna.

COLUNA OBRA:
- Identifica o projeto/cliente (ex: ANA, RENATA, GUITA).
- Pode aparecer apenas na primeira linha do grupo; as linhas seguintes sem valor de OBRA pertencem ao mesmo grupo anterior.
- NAO inclua o nome da obra no campo produto.

COMPRIMENTO:
- Nao ha coluna de comprimento neste documento.
- Use sempre 6000 como padrao.

REGRA DE EXTRACAO:
- Extraia TODOS os itens de TODOS os grupos de obra.
- Cada linha da tabela com um codigo na coluna DESCRICAO e um item separado.
- Ignore linhas vazias e linhas que sejam cabecalhos ou separadores de grupo.
- Use "identificado": true para cada linha legivel.

Retorne somente JSON com a chave 'items'. Nao retorne items vazio se houver linhas legiveis na tabela.
`;

export const SIMPLE_LIST_PROMPT = `
Você está lendo uma LISTA SIMPLES de pedido de perfis de alumínio.

REGRA PRINCIPAL:
Cada linha contém um código de produto e uma quantidade.
Formatos aceitos:
  "SU001 - 5"      → produto "SU001", qtde 5
  "SU.057 - 2"     -> produto "SU057", qtde 2
  "MP 347 - 1"     -> produto "MP347", qtde 1
  "LG028 10"       → produto "LG028", qtde 10
  "BG057: 19"      → produto "BG057", qtde 19
  "04- BG057 - 19" → produto "BG057", qtde 19 (primeiro número é item, ignore)

REGRA ABSOLUTA — FIDELIDADE AO CÓDIGO:
Copie o código EXATAMENTE como está escrito. Não invente nem corrija prefixos.
Remova apenas separadores internos comuns do codigo: ponto, espaco e hifen entre letras e numeros.

A quantidade é SEMPRE inteiro, nunca decimal.

Retorne JSON com a chave 'items'.
`;

export const QUANTITY_FIRST_LIST_PROMPT = `
Você está lendo uma lista de pedido de perfis de alumínio onde a QUANTIDADE VEM ANTES DO CÓDIGO.

ESTRUTURA DA LISTA:
Geralmente o cabeçalho é "QUANTIDADE CODIGO" ou similar.
Cada linha tem um número (quantidade) seguido de um código alfanumérico ou numérico.

Exemplos:
  "09  CM-060"   → qtde 9, produto "CM-060"
  "02  TUB-4054" → qtde 2, produto "TUB-4054"
  "18  RP-020"   → qtde 18, produto "RP-020"

REGRA PRINCIPAL:
- O PRIMEIRO NÚMERO da linha é a QUANTIDADE.
- O TEXTO QUE VEM DEPOIS (ignorando espaços ou hífens separadores desnecessários) é o CÓDIGO DO PRODUTO.
- Copie o código do produto EXATAMENTE como escrito.
- A quantidade é sempre um número inteiro.
- Retorne um item para cada linha válida com "identificado": true.

Retorne JSON com a chave 'items'.
`;

export const EXPORTED_PROFILE_CSV_PROMPT = `
Voce esta lendo uma planilha/CSV exportada pela aplicacao.

ESTRUTURA:
Colunas: PRODUTO | ACABAMENTO | QTDE | PRECO | COMPRIMENTO

REGRA PRINCIPAL:
- Use a coluna PRODUTO como produto.
- Use a coluna ACABAMENTO como acabamento.
- Use a coluna QTDE como quantidade. Nunca use PRECO como quantidade.
- Use a coluna COMPRIMENTO como comprimento.
- Cada linha da planilha deve virar um item separado, mesmo quando o produto se repete.

Retorne JSON com a chave 'items'.
`;

export const DFC_QUOTE_SHEET_PROMPT = `
Voce esta lendo uma planilha de solicitacao de orcamento DFC.

ESTRUTURA:
A tabela de itens pode comecar depois de linhas de cabecalho/metadados.
O cabecalho dos itens tem colunas: Cod | Quantidade | Cor | Descricao

REGRA PRINCIPAL:
- Use a coluna Cod como produto.
- Use a coluna Quantidade como qtde.
- Use a coluna Cor como acabamento.
- Ignore numeros dentro da descricao; eles nao sao quantidade.
- Use comprimento 6000 quando nao houver coluna de comprimento.

Retorne JSON com a chave 'items'.
`;

export const COLOR_MATRIX_TABLE_PROMPT = `
Você está lendo uma TABELA MATRICIAL DE CORES impressa.

ESTRUTURA DA TABELA:
As primeiras colunas geralmente são: CODIGO, DESCRIÇÃO (e P/METRO, etc).
Depois, existem COLUNAS DE CORES, como "PRETO", "NATURAL", "BRANCO", "BRONZE", "FOSCO", etc.
Embaixo dessas colunas de cores estão as QUANTIDADES.

REGRA PRINCIPAL PARA CRIAÇÃO DOS ITENS:
- Leia cada linha da tabela.
- Para CADA COR que tiver uma quantidade MAIOR QUE ZERO, você DEVE CRIAR UM ITEM SEPARADO.
- Use a coluna "CODIGO" como o produto. Se estiver vazia, tente extrair do início da Descrição.
- A "qtde" é o número na coluna da cor correspondente.
- O "acabamento" deve ser preenchido com o nome da cor (ex: "PRETO", "NATURAL", "FOSCO").

ATENÇÃO:
- Colunas como "Peso total" ou "Peso" devem ser IGNORADAS. NÃO as confunda com quantidades (elas geralmente têm vírgula, e quantidades de orçamento costumam ser inteiros ou apenas inteiros).
- Exemplo: 
  "US-285 | 0,3210 | PALETA | PRETO: 60 | Peso: 115,56 | NATURAL: 100"
  Isso DEVE gerar DOIS itens:
  1) produto: "US285", qtde: 60, acabamento: "PRETO"
  2) produto: "US285", qtde: 100, acabamento: "NATURAL"

NORMALIZAÇÃO DO CÓDIGO:
- Remova hífens e espaços: "SU- 102" → "SU102", "US-285" → "US285", "MG25- 247" → "MG25247".

Retorne JSON com a chave 'items'.
`;

export const BAR_CALCULATION_PROMPT = `
Você está lendo um documento de "Resumo do Cálculo de Barras" ou "Cálculo de Esquadria".

ESTRUTURA DA TABELA:
As colunas principais são: Seção | Material | Descrição | Barra | Qtde | Peso | Tipo
Atenção especial à ordem de Barra e Qtde nesta tabela:
- "Material" é o CÓDIGO DO PRODUTO (ex: BG057, LG006, MN007).
- "Barra" é o COMPRIMENTO em mm (geralmente 6000 ou 5800) e vem ANTES de Qtde.
- "Qtde" é a QUANTIDADE e vem DEPOIS de Barra.
- "Peso" é o peso em kg (geralmente um número decimal como 14.637) e vem DEPOIS de Qtde. Ignore o peso completamente.

REGRA DE EXTRAÇÃO:
- produto: Código da coluna Material (ex: "BG057").
- acabamento: EPPF se o cabeçalho/grupo de beneficiamento indicar RAL9005 ou PRETO; caso contrário, use NT.
- qtde: Número inteiro da coluna Qtde.
- comprimento: Número inteiro da coluna Barra (ex: 6000).
- identificado: true

Exemplo:
"BG057 BAGUETE 6000 14 14.637 Sólido" -> produto "BG057", qtde 14, comprimento 6000, acabamento "NT".

Retorne somente JSON com a chave 'items'.
`;

export const ALUMINORTE_RELACAO_BARRAS_PROMPT = `
Você está lendo UMA PÁGINA de um "Relação de Barras" do SmartCEM-Esquadgroup (Aluminorte/Norte Lumi).
Extraia TODOS os itens de produto visíveis NESTA PÁGINA.

ESTRUTURA DA TABELA:
Colunas: Perfil | Trat./Cor | Qtde | Barra | Peso (kg) | Sobra (kg) | (%)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REGRA PRINCIPAL — USE A COLUNA "Qtde" COMO ÁRBITRO:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Uma linha é de PRODUTO se e somente se a coluna Qtde contém um NÚMERO INTEIRO SEM VÍRGULA/PONTO DECIMAL.
Exemplos de Qtde inteiro (produto): 1  2  4  6  7  8  23  29  45  83  96  294  503
Exemplos de Qtde decimal (subtotal): 7,272  22,974  4.695,528  → IGNORE

Quando Qtde for inteiro → a linha é produto → leia o CÓDIGO DE PRODUTO da coluna Perfil.
NÃO questione se o código parece número, peso ou outra coisa — se Qtde é inteiro, é produto.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COLUNA "PERFIL" — COMO LER O CÓDIGO:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Cada linha de produto mostra um pequeno ícone gráfico (desenho do corte do perfil) à esquerda.
IGNORE o ícone. O CÓDIGO é o texto/número imediatamente após o ícone.
O código pode ser:
- Puramente numérico: 3046, 3047, 42006, 42007, 42012, 42014, 42032
- Alfanumérico:       RM005, CL006, CL011, CM200, BG037, FA-255, FA-256, FA-258, FA-259, FA-260

ATENÇÃO CRÍTICA: 42006, 42007, 42012, 42014, 42032 SÃO CÓDIGOS DE PRODUTO.
Eles aparecem na coluna Perfil e têm Qtde inteira. NÃO são pesos, dimensões nem subtotais.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LINHAS A IGNORAR (mesmo que pareçam ter código):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Cabeçalhos de grupo: "AZ-P-RAL9003B Arremate-...", "SA-P-RAL9003B Solido-...", "TA-P-RAL9003B Tubular-..."
- "CM  CONTRAMARCO" e "SBRUTO  SÓLIDO BRUTO"
- Subtotais (Qtde tem vírgula/decimal)
- "TOTAL: ..." e cabeçalho da tabela
- Rodapé "SmartCEM - Esquadgroup NORTE LUMI ..."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXTRAÇÃO DO ACABAMENTO (coluna Trat./Cor):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Contém "RAL9003" ou "BRANCO" → "EBCO"
Contém "RAL9005" ou "PRETO"  → "EPPF"
Vazia ou ausente              → "NT"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXEMPLOS — aplicando a regra Qtde inteiro → produto:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[ícone] 42006  PINTURA BRANCO BRILHANTE - RAL9003B  2  6000  18,924  8,140  43,02
Qtde=2 (inteiro ✓) → PRODUTO. Código=42006, Trat.→EBCO, Barra=6000
→ { produto:"42006", acabamento:"EBCO", qtde:2, comprimento:6000 }

[ícone] 42014  PINTURA BRANCO BRILHANTE - RAL9003B  4  6000  8,856  3,155  35,63
Qtde=4 (inteiro ✓) → PRODUTO. Código=42014, Trat.→EBCO, Barra=6000
→ { produto:"42014", acabamento:"EBCO", qtde:4, comprimento:6000 }

[ícone] 42032  PINTURA BRANCO BRILHANTE - RAL9003B  7  6000  58,170  4,296  7,39
Qtde=7 (inteiro ✓) → PRODUTO. Código=42032, Trat.→EBCO, Barra=6000
→ { produto:"42032", acabamento:"EBCO", qtde:7, comprimento:6000 }

[ícone] FA-258  PINTURA BRANCO BRILHANTE - RAL9003B  294  6000  1.040,760  64,697  6,22
Qtde=294 (inteiro ✓) → PRODUTO. Código=FA-258, Trat.→EBCO, Barra=6000
→ { produto:"FA-258", acabamento:"EBCO", qtde:294, comprimento:6000 }

[ícone] 3046  [vazio]  23  6000  219,420  44,177  20,13
Qtde=23 (inteiro ✓) → PRODUTO. Código=3046, Trat.vazio→NT, Barra=6000
→ { produto:"3046", acabamento:"NT", qtde:23, comprimento:6000 }

[ícone] CM200  [vazio]  6  6000  7,128  1,851  25,98
Qtde=6 (inteiro ✓) → PRODUTO. Código=CM200, Trat.vazio→NT, Barra=6000
→ { produto:"CM200", acabamento:"NT", qtde:6, comprimento:6000 }

7,272  1,857   → Qtde=7,272 (decimal) → SUBTOTAL → IGNORE
22,974  11,975  52,12  → decimal → IGNORE
TA-P-RAL9003B  Tubular-RAL9003-BRANCO BRILH.  → cabeçalho de grupo → IGNORE

Retorne somente JSON com a chave 'items'. Se há linhas com Qtde inteira visíveis na página, NUNCA retorne items vazio.
`;

export const ACECAMP_PURCHASE_ORDER_PROMPT = `
Você está lendo um "Pedido de Compra" do sistema SASTEC (www.sastec.com.br).

ESTRUTURA DO DOCUMENTO:
Colunas: CÓDIGO | REFERENCIA | DESCRIÇÃO | QTDE | CUSTO | KG BR | KG TOTAL | VLR. TOTAL

ATENÇÃO CRÍTICA — QUAL COLUNA É O PRODUTO:
- Coluna REFERENCIA (segunda coluna) = CÓDIGO DO PRODUTO a extrair. Ex: LG-016, BAR-013, M-29, TUB-003, PR-32507.
- Coluna CÓDIGO (primeira coluna) = código interno do sistema. NÃO extraia este valor. Ex: 90-016-NAT, BAR-013-NAT, E-364-NAT.

REGRAS DE EXTRAÇÃO:
- produto = coluna REFERENCIA (ex: LG-016, BAR-027, CM-169, SU-191, PR-32507)
- qtde = coluna QTDE (inteiro — número de barras)
- comprimento = 6000 mm (padrão para barras de alumínio; não aparece explicitamente no documento)
- acabamento: determinado pelo sufixo do CÓDIGO interno (primeira coluna):
  Sufixo NAT ou -NAT → "NT"
  Sufixo EBCO → "EBCO"
  Sufixo EPPF → "EPPF"
  Sem sufixo reconhecido → "NT"

IGNORE: linha de totais (380  972,4  34.035,23), "AUTORIZADO", "FORMA DE PAGAMENTO", cabeçalho da tabela, rodapé.

EXEMPLOS CORRETOS:
"90-016-NAT  LG-016  PERFIL ALUMINIO SOLIDO NATURAL  15  35,00  1,9200  28,80  1.008,00"
→ { produto:"LG-016", acabamento:"NT", qtde:15, comprimento:6000 }

"BAR-013-NAT  BAR-013  BARRA CHATA 5/8 POL X 1/8 POL NATURAL  30  35,00  0,8200  24,60  861,00"
→ { produto:"BAR-013", acabamento:"NT", qtde:30, comprimento:6000 }

"E-364-NAT  M-29  PERFIL ALUMINIO SOLIDO NATURAL  16  35,00  2,9950  47,92  1.677,20"
→ { produto:"M-29", acabamento:"NT", qtde:16, comprimento:6000 }

"TUB-003-NAT  TUB-003  TUBO REDONDO 3/8 POL X 1,59 MM NATURAL  40  35,00  0,6500  26,00  910,00"
→ { produto:"TUB-003", acabamento:"NT", qtde:40, comprimento:6000 }

"90-007E-NAT  PR-32507  PERFIL ALUMINIO TUBULAR NATURAL  20  35,00  7,3750  147,50  5.162,50"
→ { produto:"PR-32507", acabamento:"NT", qtde:20, comprimento:6000 }

"L-519 NAT  L-519  PERFIL ALUMINIO SOLIDO NATURAL  15  35,00  1,8000  27,00  945,00"
→ { produto:"L-519", acabamento:"NT", qtde:15, comprimento:6000 }

Retorne somente JSON com a chave 'items'.
`;

export const NEOCA_SIMULACAO_COMPRAS_PROMPT = `
Você está lendo um "RELATÓRIO DE ITENS DA SIMULAÇÃO DE COMPRAS" da NEOCA VIDRAÇARIA.

ESTRUTURA DO DOCUMENTO:
Colunas: Código | Descrição | Cor | UN | Qtde.Comprar

ATENÇÃO CRÍTICA — QUAL COLUNA É O PRODUTO E QUAL É A QUANTIDADE:
- O PRODUTO é a coluna "Código" (primeira coluna). Ex: MP347, SU001, SU102, VZ051, 25-548.
  Quando o código tiver uma referência alternativa entre parênteses, ex: "25-548 (L-715)", use "25-548".
- A QUANTIDADE é exclusivamente a coluna "Qtde.Comprar" (última coluna), escrita no formato "N,NNN"
  com 3 casas decimais que representam um INTEIRO: "2,000" = 2, "4,000" = 4, "18,000" = 18, "1,000" = 1.
  NUNCA leia "2,000" como 2000. NUNCA use números da Descrição (ex: "12,3 X 74", "60MM", "45º", "2 PLANOS") como quantidade.

REGRAS DE EXTRAÇÃO:
- produto = coluna Código (preserve hífens do código, ex: "25-548")
- qtde = parte inteira de Qtde.Comprar (o número antes da vírgula)
- comprimento = 6000 mm (padrão; não aparece no documento)
- acabamento: da coluna Cor → PRETO/RAL9005 → "EPPF"; BRANCO/RAL9003/RAL9010 → "EBCO"; NATURAL/BRUTO → "NT". Vazio → "NT".
- A coluna UN (ex: "BR") deve ser IGNORADA — não é quantidade.

IGNORE: cabeçalho (NEOCA VIDRAÇARIA, RELATÓRIO DE ITENS, SIMULAÇÃO NRO., DESCRIÇÃO:, Emitido Por), a linha de cabeçalho de colunas e o rodapé/paginação.

EXEMPLOS CORRETOS:
"25-548 (L-715) COMPLEMENTO FOLHA PRETO BR 2,000"
→ { produto:"25-548", acabamento:"EPPF", qtde:2, comprimento:6000 }

"MP347 ARREMATE / FACE INTERNA PRETO BR 4,000"
→ { produto:"MP347", acabamento:"EPPF", qtde:4, comprimento:6000 }

"SU102 BAGUETE PRETO BR 8,000"
→ { produto:"SU102", acabamento:"EPPF", qtde:8, comprimento:6000 }

"VZ051 VENEZIANA 12,3 X 74 - PASSO 60MM PRETO BR 18,000"
→ { produto:"VZ051", acabamento:"EPPF", qtde:18, comprimento:6000 }

Retorne somente JSON com a chave 'items'. Não retorne items vazio se houver linhas legíveis.
`;

export const ECG_PRODUCT_RELATION_PROMPT = `
Você está lendo uma "RELAÇÃO DOS PRODUTOS" do sistema ECG Glass (ex: ATACADÃO DOS BOX E ESQUADRIAS).

ESTRUTURA DO DOCUMENTO:
Seção "PERFIL" com colunas: Código | Descrição | Qtd (barras)
NÃO há coluna de comprimento nem de cor/tratamento.

ATENÇÃO CRÍTICA — QUAL É A QUANTIDADE:
- A QUANTIDADE é exclusivamente a ÚLTIMA coluna "Qtd (barras)" — o ÚLTIMO número inteiro da linha.
- NUNCA use números que estão dentro da Descrição como quantidade. Ex: "3 À 6 MM", "4 A 6 MM",
  "38 X 76", "LINHA 25", "2"x2"" são parte da descrição e devem ser IGNORADOS.

REGRAS DE EXTRAÇÃO:
- produto = coluna Código (primeira coluna). Pode ser numérico (25540, 25548) ou alfanumérico (BG057, SU001, TB38X76, LB-061, VZ006F).
- qtde = último número inteiro da linha (coluna Qtd).
- comprimento = 6000 mm (padrão; não aparece no documento).
- acabamento = "NT" (não há coluna de cor).

IGNORE: cabeçalho (ECG Glass, ATACADÃO, CNPJ, endereço, Cliente, Orçamento, Data, RELAÇÃO DOS PRODUTOS, PERFIL), a linha de cabeçalho de colunas e o rodapé.

EXEMPLOS CORRETOS:
"25540 MARCO PORTA DE ABRIR LINHA 25 3" → { produto:"25540", acabamento:"NT", qtde:3, comprimento:6000 }
"BG057 BAGUETE HORIZONTAL P/ VIDRO 3 À 6 MM 9" → { produto:"BG057", acabamento:"NT", qtde:9, comprimento:6000 }
"SU102 BAGUETE HORIZONTAL VIDRO 4 A 6 MM 18" → { produto:"SU102", acabamento:"NT", qtde:18, comprimento:6000 }
"TB38X76 TUBO RETANGULAR 38 X 76 2" → { produto:"TB38X76", acabamento:"NT", qtde:2, comprimento:6000 }
"VZ006F US285 VENEZIANA COM VENTILAÇÃO 3" → { produto:"VZ006F", acabamento:"NT", qtde:3, comprimento:6000 }

Retorne somente JSON com a chave 'items'. Não retorne items vazio se houver linhas legíveis.
`;

export const CEMONE_ROMANEIO_PERFIS_PROMPT = `
Você está lendo um "Romaneio de Perfis" do sistema CEM ONE - Alumisoft Sistemas (rodapé "CEM ONE - Alumisoft Sistemas").

ESTRUTURA DO DOCUMENTO:
Colunas: Perfil | Tratamento / Cor | Qtde. | Medida | % IPI | Peso (kg) | $ Total
Abaixo do código do perfil aparece uma linha de descrição em itálico (ex: PINGADEIRA, FOLHA). IGNORE-A para extração.

REGRA CRÍTICA — QUANTIDADE:
A quantidade está na coluna "Qtde." e SEMPRE aparece no formato "N BR" (inteiro + espaço + "BR").
Ex: "2 BR" = 2 barras, "11 BR" = 11 barras, "59 BR" = 59 barras.
NUNCA use o Peso (kg), o $ Total ou o % IPI como quantidade.

REGRA — COMPRIMENTO (coluna "Medida"):
O comprimento é a coluna Medida, em mm. Valor típico: 6000. Alguns itens usam 3000.
Se não aparecer explicitamente, use 6000.

REGRA — ACABAMENTO (coluna "Tratamento / Cor"):
- "NATURAL" → "NT"
- "ANODIZADO FOSCO" (qualquer variação, ex: "ANODIZADO FOSCO-1000 (A13)") → "FOS"
- "PINTURA CINZA NEGRO - RAL7021" ou qualquer tratamento com NEGRO / RAL7021 → "EPPF"
- "PINTURA BRANCO" / "BRANCO" / RAL9003 / RAL9010 → "EBCO"
- Outros tratamentos não identificados → "NT"

IGNORE: cabeçalho (Romaneio de Perfis, Emitido por, Data de Envio), linha de colunas (Perfil, Tratamento/Cor, Qtde., Medida...), descrições de perfil (PINGADEIRA, MARCO, FOLHA, VENEZIANA etc.), rodapé (CEM ONE, Atenção), e a linha de totais (apenas números decimais).

EXEMPLOS CORRETOS:
"45EC-209 PINTURA CINZA NEGRO - RAL7021 2 BR 6000 ..." → { produto:"45EC-209", acabamento:"EPPF", qtde:2, comprimento:6000 }
"45EC-226 ANODIZADO FOSCO-1000 (A13) 8 BR 6000 ..." → { produto:"45EC-226", acabamento:"FOS", qtde:8, comprimento:6000 }
"45EC-239 NATURAL 13 BR 6000 ..." → { produto:"45EC-239", acabamento:"NT", qtde:13, comprimento:6000 }
"CL009 NATURAL 1 BR 3000 ..." → { produto:"CL009", acabamento:"NT", qtde:1, comprimento:3000 }
"DV113 PINTURA CINZA NEGRO - RAL7021 59 BR 6000 ..." → { produto:"DV113", acabamento:"EPPF", qtde:59, comprimento:6000 }
"TUB-4526 PINTURA CINZA NEGRO - RAL7021 2 BR 6000 ..." → { produto:"TUB-4526", acabamento:"EPPF", qtde:2, comprimento:6000 }
"ECBG-214 PINTURA CINZA NEGRO - RAL7021 25 BR 6000 ..." → { produto:"ECBG-214", acabamento:"EPPF", qtde:25, comprimento:6000 }

Retorne somente JSON com a chave 'items'. Não retorne items vazio se houver linhas legíveis.
`;

export const SUJVIDROS_COTACAO_BARRAS_PROMPT = `
Você está lendo um "Relatório de Cotação de Barras" do sistema SUJVIDROS.

ESTRUTURA DO DOCUMENTO:
Cabeçalho com CLIENTE e OBRA, seguido de grupos de produtos separados por linha "Tratamento: <COR>".
Colunas por linha de item: Código | Descrição | UM | Qtde | Comprimento

REGRA DO CAMPO TRATAMENTO (acabamento do grupo):
- "Tratamento: BRANCO" → acabamento "EBCO" para todos os itens abaixo até o próximo Tratamento.
- "Tratamento: NATURAL" → acabamento "NT".
- "Tratamento: PRETO" ou que mencionar RAL9005 → acabamento "EPPF".
- O valor do tratamento se aplica a TODOS os itens do grupo abaixo dele.

REGRA DE EXTRAÇÃO POR LINHA:
- A primeira coluna é o CÓDIGO DO PRODUTO. Preserve hífens e vírgulas que fazem parte do código.
  Ex: "20SP-F01" → produto "20SP-F01"; "MONT-6,5" → produto "MONT-6,5"; "TBR1\"" → produto "TBR1\"".
- O traço longo "–" (em dash) entre partes do código deve ser tratado como hífen normal.
  Ex: "20SP – M21" → produto "20SP-M21".
- A coluna UM (valores como PER, TA, SA) deve ser IGNORADA completamente — não é quantidade.
- A QTDE é o número inteiro que aparece após a descrição e a coluna UM.
- O COMPRIMENTO é o último número da linha (normalmente 6000 mm).
- Use comprimento 6000 quando não indicado explicitamente.
- Ignore linhas separadoras (---), cabeçalhos, notas de rodapé e a linha de levantamento de material.

EXEMPLOS CORRETOS:
Quando "Tratamento: BRANCO" for o grupo:
"20SP-F01 MONTANTE DA FOLHA PER 415 6000" → produto "20SP-F01", acabamento "EBCO", qtde 415, comprimento 6000
"20SP – M21 FOLHA MAXIM-AR PER 54 6000" → produto "20SP-M21", acabamento "EBCO", qtde 54, comprimento 6000
"MONT-6,5 BUZIO MONTANTE PORTÃO 6,5 (PC027) 98 6000" → produto "MONT-6,5", acabamento "EBCO", qtde 98, comprimento 6000
"TBR1\" TUBO REDONDO 1\" TA 855 6000" → produto "TBR1\"", acabamento "EBCO", qtde 855, comprimento 6000

Quando "Tratamento: NATURAL" for o grupo:
"CT026 CANTONEIRA 1.1/2'' X 1/8'' SA 4 6000" → produto "CT026", acabamento "NT", qtde 4, comprimento 6000

Retorne somente JSON com a chave 'items'. Não retorne items vazio se houver linhas legíveis.
`;

// ── Fallback Prompt ──────────────────────────────────────────────────────────
// Used when classification fails or profile returns empty.

export const GENERIC_FALLBACK_PROMPT = `
Você é um especialista em extração de dados de pedidos de perfis de alumínio.
Leia este documento e extraia todos os itens.

Para cada item encontrado, extraia:
- produto: código do perfil EXATAMENTE como escrito
- qtde: quantidade inteira (nunca decimal)
- comprimento: tamanho em mm (padrão 6000 se não encontrar)
- acabamento: NT (padrão)
- identificado: true/false

Se o documento tiver colunas "CODIGO/DESCRICAO", "TRATAMENTO/COR", "COMP.", "QTDE.", "BARRA(KG)" e "TOTAL(KG)", use "TRATAMENTO/COR" como acabamento/cor, use somente "QTDE." como quantidade, use "COMP." como comprimento e ignore "BARRA(KG)" / "TOTAL(KG)".

Se o documento for uma tabela de orçamento com coluna "Codigo" numérica e "Descricao" com "PERFIL",
use o código dentro da descrição (ex: "PERFIL SU111" → produto "SU111") e a quantidade após "UN".

Se o documento for "METAPERFIL SERVICOS DE PINTURA", use "Descricao do Produto" como produto e "Barras" como quantidade; nunca use a coluna "Cod." como produto.

Se o documento for SmartCEM "Relacao de Barras" em blocos com "Codigo:", "Numero de Barras:" e "Comprimento da barra:",
use o valor de "Codigo:" como produto, "Numero de Barras" como qtde e "Comprimento da barra" como comprimento.

Se uma tabela tiver primeira coluna com codigo interno como "30-023" e uma descricao com perfil como "P-273 / MARCO", use o perfil da descricao ("P273") como produto e a ultima coluna como quantidade.

Retorne JSON com a chave 'items'.
`;

// ── Profile Registry ─────────────────────────────────────────────────────────

export interface ReadingProfile {
  key: DocumentProfileKey;
  label: string;
  /** Ordered list of prompts to try. First non-empty result wins. */
  promptChain: string[];
}

export const READING_PROFILES: Record<DocumentProfileKey, ReadingProfile> = {
  HANDWRITTEN_COLON: {
    key: "HANDWRITTEN_COLON",
    label: "Caderno manuscrito (separador ':')",
    promptChain: [HANDWRITTEN_COLON_PROMPT, GENERIC_FALLBACK_PROMPT],
  },
  HANDWRITTEN_DASH: {
    key: "HANDWRITTEN_DASH",
    label: "Caderno manuscrito (item-código-qtde com hífens)",
    promptChain: [HANDWRITTEN_DASH_PROMPT, HANDWRITTEN_COLON_PROMPT, GENERIC_FALLBACK_PROMPT],
  },
  HANDWRITTEN_EQUALS: {
    key: "HANDWRITTEN_EQUALS",
    label: "Caderno manuscrito (CODIGO = B(QUANTIDADE))",
    promptChain: [HANDWRITTEN_EQUALS_PROMPT, HANDWRITTEN_COLON_PROMPT, GENERIC_FALLBACK_PROMPT],
  },
  BUDGET_TABLE: {
    key: "BUDGET_TABLE",
    label: "Orçamento impresso (Codigo/Descricao/UN/Qtde)",
    promptChain: [BUDGET_TABLE_PROMPT, GENERIC_FALLBACK_PROMPT],
  },
  METAPERFIL_PAINTING_TABLE: {
    key: "METAPERFIL_PAINTING_TABLE",
    label: "Metaperfil Servicos de Pintura (Descricao/Barras)",
    promptChain: [METAPERFIL_PAINTING_TABLE_PROMPT, GENERIC_FALLBACK_PROMPT],
  },
  PRODUCT_VARIANT_TABLE: {
    key: "PRODUCT_VARIANT_TABLE",
    label: "Tabela comercial (Produto/Variante/Qtde Comercial)",
    promptChain: [PRODUCT_VARIANT_TABLE_PROMPT, GENERIC_FALLBACK_PROMPT],
  },
  DESCRIPTION_CODE_TABLE: {
    key: "DESCRIPTION_CODE_TABLE",
    label: "Tabela com codigo interno e codigo na descricao",
    promptChain: [DESCRIPTION_CODE_TABLE_PROMPT, GENERIC_FALLBACK_PROMPT],
  },
  PROFILE_TABLE: {
    key: "PROFILE_TABLE",
    label: "Tabela de perfis (Perfil/Qtde/Tamanho)",
    promptChain: [PROFILE_TABLE_PROMPT, GENERIC_FALLBACK_PROMPT],
  },
  MATERIALS_RELATION_TABLE: {
    key: "MATERIALS_RELATION_TABLE",
    label: "Relacao de Materiais (Codigo/Descricao/Barra/Qtde)",
    promptChain: [MATERIALS_RELATION_TABLE_PROMPT, GENERIC_FALLBACK_PROMPT],
  },
  SMARTCEM_BAR_SUMMARY: {
    key: "SMARTCEM_BAR_SUMMARY",
    label: "SmartCEM Relacao de Barras (Codigo/Numero de Barras/Comprimento)",
    promptChain: [SMARTCEM_BAR_SUMMARY_PROMPT, BAR_LIST_PROMPT, GENERIC_FALLBACK_PROMPT],
  },
  BAR_LIST: {
    key: "BAR_LIST",
    label: "Relação de Barras (Perfil/Tratamento/Qtde/Barra)",
    promptChain: [BAR_LIST_PROMPT, PROFILE_TABLE_PROMPT, GENERIC_FALLBACK_PROMPT],
  },
  CUT_ORIENTATION_TABLE: {
    key: "CUT_ORIENTATION_TABLE",
    label: "Orientacao de Cortes da Obra (Perfil/Tratamento/Qtde/Barra)",
    promptChain: [CUT_ORIENTATION_TABLE_PROMPT, BAR_LIST_PROMPT, PROFILE_TABLE_PROMPT, GENERIC_FALLBACK_PROMPT],
  },
  QUOTE_DELIVERY_TABLE: {
    key: "QUOTE_DELIVERY_TABLE",
    label: "Cotacao/Entrega (Codigo/Tratamento-Cor/Comp/Qtde)",
    promptChain: [QUOTE_DELIVERY_TABLE_PROMPT, GENERIC_FALLBACK_PROMPT],
  },
  COTACAO_OBRA_TABLE: {
    key: "COTACAO_OBRA_TABLE",
    label: "Cotacao por Obra (COR/Descricao/Qtde/Obra, sem comprimento)",
    promptChain: [COTACAO_OBRA_TABLE_PROMPT, DFC_QUOTE_SHEET_PROMPT, GENERIC_FALLBACK_PROMPT],
  },
  EXPORTED_PROFILE_CSV: {
    key: "EXPORTED_PROFILE_CSV",
    label: "CSV exportado (Produto/Acabamento/Qtde/Comprimento)",
    promptChain: [EXPORTED_PROFILE_CSV_PROMPT, GENERIC_FALLBACK_PROMPT],
  },
  DFC_QUOTE_SHEET: {
    key: "DFC_QUOTE_SHEET",
    label: "Planilha DFC (Cod/Quantidade/Cor)",
    promptChain: [DFC_QUOTE_SHEET_PROMPT, GENERIC_FALLBACK_PROMPT],
  },
  SIMPLE_LIST: {
    key: "SIMPLE_LIST",
    label: "Lista simples impressa",
    promptChain: [SIMPLE_LIST_PROMPT, GENERIC_FALLBACK_PROMPT],
  },
  QUANTITY_FIRST_LIST: {
    key: "QUANTITY_FIRST_LIST",
    label: "Lista simples (Quantidade antes do Código)",
    promptChain: [QUANTITY_FIRST_LIST_PROMPT, SIMPLE_LIST_PROMPT, GENERIC_FALLBACK_PROMPT],
  },
  COLOR_MATRIX_TABLE: {
    key: "COLOR_MATRIX_TABLE",
    label: "Tabela de cores matricial (PRETO, NATURAL, etc)",
    promptChain: [COLOR_MATRIX_TABLE_PROMPT, GENERIC_FALLBACK_PROMPT],
  },
  BAR_CALCULATION: {
    key: "BAR_CALCULATION",
    label: "Resumo do Cálculo de Barras (Barra antes de Qtde)",
    promptChain: [BAR_CALCULATION_PROMPT, PROFILE_TABLE_PROMPT, GENERIC_FALLBACK_PROMPT],
  },
  SUJVIDROS_COTACAO_BARRAS: {
    key: "SUJVIDROS_COTACAO_BARRAS",
    label: "SUJVIDROS Relatório de Cotação de Barras (Código/Descrição/UM/Qtde/Comprimento)",
    promptChain: [SUJVIDROS_COTACAO_BARRAS_PROMPT, GENERIC_FALLBACK_PROMPT],
  },
  ALUMINORTE_RELACAO_BARRAS: {
    key: "ALUMINORTE_RELACAO_BARRAS",
    label: "SmartCEM-Esquadgroup Relação de Barras (Perfil/Trat.Cor/Qtde/Barra/Peso/Sobra com grupos CM/SBRUTO)",
    promptChain: [ALUMINORTE_RELACAO_BARRAS_PROMPT, BAR_LIST_PROMPT, GENERIC_FALLBACK_PROMPT],
  },
  ACECAMP_PURCHASE_ORDER: {
    key: "ACECAMP_PURCHASE_ORDER",
    label: "Pedido de Compra SASTEC (REFERENCIA=produto, CÓDIGO=interno, QTDE, KG BR, KG TOTAL)",
    promptChain: [ACECAMP_PURCHASE_ORDER_PROMPT, GENERIC_FALLBACK_PROMPT],
  },
  NEOCA_SIMULACAO_COMPRAS: {
    key: "NEOCA_SIMULACAO_COMPRAS",
    label: "Simulação de Compras NEOCA (Código=produto, Cor, Qtde.Comprar)",
    promptChain: [NEOCA_SIMULACAO_COMPRAS_PROMPT, GENERIC_FALLBACK_PROMPT],
  },
  ECG_PRODUCT_RELATION: {
    key: "ECG_PRODUCT_RELATION",
    label: "Relação dos Produtos ECG Glass (Código=produto, Qtd=última coluna)",
    promptChain: [ECG_PRODUCT_RELATION_PROMPT, GENERIC_FALLBACK_PROMPT],
  },
  CEMONE_ROMANEIO_PERFIS: {
    key: "CEMONE_ROMANEIO_PERFIS",
    label: "CEM ONE – Romaneio de Perfis (Perfil | Trat./Cor | Qtde N BR | Medida)",
    promptChain: [CEMONE_ROMANEIO_PERFIS_PROMPT, GENERIC_FALLBACK_PROMPT],
  },
  GENERIC: {
    key: "GENERIC",
    label: "Genérico (fallback)",
    promptChain: [
      GENERIC_FALLBACK_PROMPT,
      DESCRIPTION_CODE_TABLE_PROMPT,
      PRODUCT_VARIANT_TABLE_PROMPT,
      COTACAO_OBRA_TABLE_PROMPT,
      SIMPLE_LIST_PROMPT,
      HANDWRITTEN_COLON_PROMPT,
    ],
  },
};

/**
 * Returns the ordered prompt chain for a given profile key.
 * Injects an optional dynamic blacklist suffix into each prompt.
 */
export function getProfilePromptChain(
  profileKey: DocumentProfileKey,
  dynamicBlacklist: string = ""
): string[] {
  const profile = READING_PROFILES[profileKey] ?? READING_PROFILES["GENERIC"];
  return profile.promptChain.map(p => p + dynamicBlacklist);
}

/**
 * Parses the raw JSON string returned by the classification call.
 * Falls back to GENERIC if the response is malformed.
 */
export function parseClassificationResult(raw: string): ClassificationResult {
  const validKeys = new Set<DocumentProfileKey>([
    "HANDWRITTEN_COLON", "HANDWRITTEN_DASH", "HANDWRITTEN_EQUALS",
    "BUDGET_TABLE", "METAPERFIL_PAINTING_TABLE", "PRODUCT_VARIANT_TABLE", "DESCRIPTION_CODE_TABLE", "PROFILE_TABLE", "MATERIALS_RELATION_TABLE", "SMARTCEM_BAR_SUMMARY", "BAR_LIST", "CUT_ORIENTATION_TABLE", "QUOTE_DELIVERY_TABLE", "COTACAO_OBRA_TABLE", "EXPORTED_PROFILE_CSV", "DFC_QUOTE_SHEET", "SIMPLE_LIST", "QUANTITY_FIRST_LIST", "COLOR_MATRIX_TABLE", "BAR_CALCULATION", "SUJVIDROS_COTACAO_BARRAS", "ALUMINORTE_RELACAO_BARRAS", "ACECAMP_PURCHASE_ORDER", "NEOCA_SIMULACAO_COMPRAS", "ECG_PRODUCT_RELATION", "CEMONE_ROMANEIO_PERFIS", "GENERIC",
  ]);

  try {
    // Strip markdown code fences if present
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    const profile = validKeys.has(parsed.profile) ? parsed.profile as DocumentProfileKey : "GENERIC";
    const difficulty = [1, 2, 3, 4, 5].includes(Number(parsed.difficulty))
      ? Number(parsed.difficulty) as 1 | 2 | 3 | 4 | 5
      : 3;

    return { profile, difficulty, notes: parsed.notes ?? "" };
  } catch {
    return { profile: "GENERIC", difficulty: 3 };
  }
}
