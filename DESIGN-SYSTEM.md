# OCRaccess — Design System

> Guia completo para replicar a identidade visual e os padrões de UX desta aplicação em outros projetos.
> Stack de referência: **React + Tailwind CSS 4 + shadcn/ui + Geist (fonte) + lucide-react (ícones)** — mas os tokens e princípios valem para qualquer stack.

---

## 1. Princípio central

**Neutro por padrão, cor apenas onde há ação.**

A interface é construída em tons de cinza (slate) sobre fundo claro. A cor da marca (laranja) aparece **somente** em: ação primária da tela (1 por tela), estado de foco, indicador de progresso e momentos de interação (arrastar arquivo). Cores semânticas (verde/âmbar/vermelho/índigo/ciano) são reservadas para **status**, sempre em versão suave (fundo `-50`, texto `-700`).

Personalidade: **robusta porém moderna** — grafite industrial + laranja vibrante, cantos generosos, sombras discretas, tipografia técnica (mono para códigos/dados).

---

## 2. Design Tokens

### 2.1 Cores (CSS custom properties, formato oklch)

```css
:root {
    /* Marca — laranja #F47920 */
    --primary: oklch(0.68 0.19 46);
    --primary-foreground: oklch(1 0 0);

    /* Grafite industrial (elementos "robustos": ícones-bloco, chips de dado) */
    --secondary: oklch(0.25 0.02 250);          /* ≈ slate-900 */
    --secondary-foreground: oklch(1 0 0);

    /* Neutros com leve temperatura quente (matiz 46 = mesma do laranja) */
    --background: oklch(0.985 0.004 46);
    --foreground: oklch(0.18 0.03 46);
    --card: oklch(1 0 0);
    --card-foreground: oklch(0.18 0.03 46);
    --muted: oklch(0.97 0.005 46);
    --muted-foreground: oklch(0.42 0.04 46);
    --border: oklch(0.91 0.01 46);
    --input: oklch(0.91 0.01 46);

    /* Foco/anel sempre na cor da marca */
    --ring: oklch(0.68 0.19 46);

    --destructive: oklch(0.577 0.245 27.325);

    /* Gráficos */
    --chart-1: oklch(0.68 0.19 46);   /* laranja (marca) */
    --chart-2: oklch(0.62 0.17 145);  /* verde */
    --chart-3: oklch(0.75 0.15 85);   /* âmbar */
    --chart-4: oklch(0.55 0.18 260);  /* azul */
    --chart-5: oklch(0.45 0.03 250);  /* grafite */

    --radius: 0.75rem; /* raio base generoso = "moderno" */
}
```

### 2.2 Cores semânticas de status (classes Tailwind)

| Significado | Fundo | Texto | Borda | Uso |
|---|---|---|---|---|
| Sucesso / no catálogo | `bg-green-50` | `text-green-600/700` | `border-green-200` | item confirmado |
| Atenção / ação do usuário | `bg-amber-50` | `text-amber-700` | `border-amber-200` | sem referência, escolher opção |
| Conversão automática | `bg-indigo-50` | `text-indigo-600` | `border-indigo-200` | "X → Y convertido" |
| Sugestão (1 clique) | `bg-cyan-50` | `text-cyan-700` | `border-cyan-200` | fuzzy match pendente |
| Pergunta / ambiguidade | `bg-violet-50` | `text-violet-700` | `border-violet-200` | desambiguação |
| Erro / destrutivo | `bg-red-50` | `text-red-600` | `border-red-200` | excluir, negativar |
| Informação / agrupamento | `bg-blue-50` | `text-blue-700` | `border-blue-200` | cabeçalho de documento |
| Neutro / dado | `bg-slate-50/100` | `text-slate-700` | `border-slate-200` | chips de valor (ex.: acabamento) |

Regra: status **nunca** usa cor saturada cheia — sempre o par suave `-50/-700`.

### 2.3 Tipografia

```css
--font-sans: 'Geist Variable', sans-serif;  /* @fontsource-variable/geist */
html { @apply font-sans antialiased; }
```

| Papel | Classes | Exemplo |
|---|---|---|
| Título de página (hero) | `text-2xl md:text-3xl font-bold tracking-tight text-slate-900` | "Leia um pedido em segundos" |
| Título de seção/card | `text-base md:text-lg font-bold tracking-tight text-slate-900` | "Prévia dos Dados" |
| Subtítulo/descrição | `text-sm text-slate-500` | abaixo do título |
| Rótulo de coluna (tabela) | `text-[11px] font-semibold uppercase tracking-wider text-slate-400` | PRODUTO, STATUS |
| Rótulo de campo | `text-xs text-slate-500 font-semibold` | "Acabamento:" |
| **Código/dado técnico** | `font-mono text-[13px] font-bold text-slate-800 tracking-tight` | CALC00929 |
| Texto auxiliar | `text-[11px] text-slate-400` | descrição sob o código |
| Métrica de destaque | `font-extrabold text-lg tabular-nums tracking-tight` + cor semântica | "87%" |

Regra: **todo código de produto, SKU ou valor técnico usa fonte mono** — diferencia dado de prosa.

### 2.4 Raio de borda

| Token | Valor | Uso |
|---|---|---|
| `rounded-lg` | ~0.6rem | botões pequenos, inputs, chips |
| `rounded-xl` | ~0.84rem | ícones-bloco, itens de lista |
| `rounded-2xl` | ~1.35rem | cards, header, barras |
| `rounded-3xl` | ~1.65rem | zona de drop (hero) |

### 2.5 Elevação (sombras + ring)

Cards **não usam borda** — usam `ring` sutil + sombra colorida pelo grafite:

```
Card padrão:    border-none ring-1 ring-slate-900/5 shadow-lg shadow-slate-900/5
Card destaque:  + border-l-4 border-l-primary        (filete lateral laranja)
CTA primário:   shadow-md shadow-primary/30           (sombra colorida pela marca)
Header fixo:    bg-white/80 backdrop-blur shadow-sm ring-1 ring-slate-900/5
```

### 2.6 Movimento

```css
/* Acessibilidade: animações desligadas SÓ para quem pediu */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
```

- Transições: `transition-all` / `transition-colors`, duração padrão do Tailwind (150ms).
- Spinner: `<Loader2 className="animate-spin" />` (lucide) — **sempre** com `animate-spin`.
- Microinterações charmosas: ícone da zona de drop faz `scale-110 rotate-3` ao arrastar; chevron do split-button faz `rotate-180` quando aberto.

### 2.7 Detalhes globais (charme)

```css
/* Seleção de texto na cor da marca */
::selection { background: oklch(0.68 0.19 46 / 0.25); }

/* Scrollbar fina que acende em laranja no hover */
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background: oklch(0.75 0.02 46 / 0.45);
  border-radius: 9999px;
  border: 2px solid transparent;
  background-clip: content-box;
}
::-webkit-scrollbar-thumb:hover { background: oklch(0.68 0.19 46 / 0.6); }
```

Fundo da página: `bg-gradient-to-b from-slate-100 to-slate-50` (gradiente quase imperceptível — profundidade sem ruído).

---

## 3. Componentes

### 3.1 Botões

| Variante | Classes | Quando usar |
|---|---|---|
| **CTA primário** (1 por tela) | `bg-gradient-to-r from-primary to-orange-600 text-white font-bold shadow-md shadow-primary/30 hover:from-primary/90 hover:to-orange-600/90` | BAIXAR, ação principal |
| Primário simples | `bg-primary hover:bg-primary/90 text-white font-bold shadow-sm shadow-primary/30` | Aplicar em massa |
| Secundário | `bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-semibold` | Apagar, Substituir, Adicionar |
| Destrutivo suave | `bg-red-50 hover:bg-red-100 border border-red-200 text-red-600` | Negativar, ações de risco |
| Ghost discreto | `text-slate-500 hover:text-red-600 hover:bg-red-50` | Recomeçar, remover |
| Ícone (linha de tabela) | `variant="ghost" h-8 w-8 text-slate-400` + hover semântico (`hover:text-red-600 hover:bg-red-50`) | ações por linha |

**Split-button (exportar com opções):**
```jsx
<div className="flex">
  <Button className="<CTA primário> rounded-r-none">BAIXAR</Button>
  <Button className="<CTA primário> rounded-l-none border-l border-white/20 px-2.5"
          aria-label="Escolher tipo" aria-expanded={open} aria-haspopup="menu">
    <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
  </Button>
</div>
{/* Menu: rounded-lg border border-slate-200 bg-white shadow-xl py-1, role="menu",
    itens com hover/focus-visible por cor semântica e fecha com Escape + clique fora */}
```

Regras: rótulos de CTA em CAPS curtos (BAIXAR, INCLUIR); altura mínima de toque `h-7`+ para ações inline; ícones de ação são **cinza por padrão e ganham cor só no hover**.

### 3.2 Ícone-bloco (assinatura visual)

Quadrado arredondado que precede títulos e identifica seções — o elemento mais reconhecível do sistema:

```jsx
/* Neutro/robusto (dado, resumo) */
<span className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center">
  <FileText className="w-4 h-4" />
</span>

/* Marca (seção de destaque, métricas) */
<span className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
  <Target className="w-4 h-4" />
</span>

/* CTA hero (zona de drop) — grafite que vira laranja na interação */
<div className={isDragging
  ? "w-16 h-16 rounded-2xl bg-primary text-white scale-110 rotate-3"
  : "w-16 h-16 rounded-2xl bg-slate-900 text-white group-hover:scale-105"}>
  <Upload className="w-7 h-7" />
</div>
```

### 3.3 Badges / chips de status

```jsx
/* Status: sempre par suave -50/-700, altura h-5, texto 10px */
<Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-[10px] h-5 px-1.5 w-fit">
  ⚠ Sem referência
</Badge>

/* Chip de dado (valor técnico): neutro + mono */
<Badge variant="outline" className="bg-slate-50 text-slate-700 border-slate-200 font-mono text-[11px] font-semibold">
  FOS
</Badge>
```

### 3.4 Inputs

```
h-8 bg-slate-50 text-slate-900 placeholder:text-slate-400 text-xs
border border-slate-200 rounded-lg
focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:border-primary/50
```

Foco **sempre** com anel laranja translúcido — identidade da marca no momento de interação.

### 3.5 Card

```
Estrutura: bg-white border-none ring-1 ring-slate-900/5 shadow-lg shadow-slate-900/5 rounded-2xl overflow-hidden
Header:    bg-white border-b border-slate-100 p-4 md:p-6
Destaque:  adicionar border-l-4 border-l-primary (filete lateral)
```

### 3.6 Zona de drop (hero)

```jsx
<div role="button" tabIndex={0}
  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrirSeletor(); } }}
  className={`group relative border-2 border-dashed rounded-3xl px-6 py-12 md:py-16 text-center
    transition-all cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary/40
    ${isDragging ? "border-primary bg-primary/5" : "border-slate-300 bg-white hover:border-slate-400 hover:shadow-sm"}`}>
  {/* ícone-bloco grafite→laranja + título que muda ao arrastar + linha de formatos */}
  <p>{isDragging ? "Solte o arquivo aqui" : "Arraste o documento ou clique para selecionar"}</p>
  <p className="text-sm text-slate-400">PDF · Imagem · Excel · Word · CSV — aceita vários arquivos de uma vez</p>
</div>
```

Neutra em repouso; laranja **somente** durante o drag.

### 3.7 Tabela de dados

- Cabeçalho: sticky, `bg-white/95 backdrop-blur-sm shadow-sm`, rótulos em caps pequenas (`text-[11px] uppercase tracking-wider text-slate-400`).
- Linhas: `hover:bg-slate-50/70`; selecionada `bg-primary/5 hover:bg-primary/10`.
- Linha com problema: célula com `bg-amber-50/30` (lavagem suave, não berrante).
- Código em mono bold; descrição em `text-[11px] text-slate-400` abaixo.
- Mobile: cada linha vira card (`md:hidden` / `hidden md:table-cell`).
- Agrupamento por documento: linha-cabeçalho `bg-blue-50/70` com nome do arquivo e contagem.

### 3.8 Barra de seleção (ações em massa)

Card branco com filete laranja, **não** um bloco colorido:

```
Card: bg-white ring-1 ring-slate-900/5 shadow-lg border-l-4 border-l-primary rounded-2xl
Header: ícone-bloco primary/10 + "N itens selecionados" (slate-900 bold)
        + hint "— as ações abaixo afetam apenas a seleção" (text-slate-400)
Grupos de campos separados por divisores verticais (h-6 w-px bg-slate-200, só ≥xl)
1 botão laranja (ação principal), demais em outline neutro, destrutivo em red-50
```

### 3.9 Barra de métricas

```
Card com border-l-4 border-l-primary
[ícone-bloco] "Conversão automática:" [87% — extrabold text-lg, verde≥80 / âmbar≥50 / vermelho]
[barra segmentada h-2.5 rounded-full: verde=auto, âmbar=sugerido, azul=manual]
[legenda com pontos coloridos w-2 h-2 rounded-full + contagens] [· média histórica]
```

---

## 4. Padrões de página

### 4.1 Fluxo em duas etapas (padrão mais importante)

A tela tem **um estado por vez** — nunca mostre entrada e resultado disputando atenção:

1. **Etapa de entrada (hero central)** — `max-w-3xl mx-auto`, título centralizado, uma única grande zona de ação, ação secundária como link discreto abaixo (`— ou cole o texto do pedido —` entre fios `h-px bg-slate-200`).
2. **Etapa de trabalho** — o hero **desaparece** (`hidden`) e entra uma **barra compacta** no topo com: resumo (`N itens · M documentos`), indicador de processamento e ações enxutas (`Adicionar`, `Colar texto`, `Recomeçar`). O resto da tela é da área de trabalho.

### 4.2 Header de página

```
bg-white/80 backdrop-blur p-4 md:p-5 rounded-2xl shadow-sm ring-1 ring-slate-900/5
[logo] | [separador slate-200] | título tracking-tight + subtítulo text-sm slate-500
direita: badges de contexto + ações ghost (slate-500 → hover primary)
```

Claro e discreto — o header não compete com o conteúdo.

### 4.3 Footer

```jsx
<footer className="text-center text-slate-400 text-sm pb-8">
  © {ano} NomeDoProduto. Desenvolvido para precisão e agilidade.
</footer>
```

### 4.4 Confirmações e proteção de dados

- Ação que descarta trabalho → `confirm()` com **contagem específica** ("Descartar 61 itens identificados e recomeçar?").
- Duplicidade ao salvar → nunca bloquear com erro; oferecer mesclar/atualizar.
- Sugestões do sistema → aceite de **1 clique** (SIM/NÃO) com aprendizado.

---

## 5. Acessibilidade (não negociável)

1. `prefers-reduced-motion` respeitado via media query — nunca matar animações globalmente.
2. Todo botão-ícone tem `aria-label` descritivo (incluindo o que muda: "Selecionar item X").
3. Dropdowns: `aria-expanded`, `aria-haspopup="menu"`, `role="menu"/"menuitem"`, fecham com **Escape** e clique fora, itens com `focus-visible` visível.
4. Zonas clicáveis customizadas: `role="button"`, `tabIndex={0}`, Enter/Espaço ativam, `focus-visible:ring-2 ring-primary/40`.
5. Alvos de toque ≥ 28px (h-7) para ações inline; ≥ 44px para ações principais mobile (h-12).
6. Contraste: texto de status sempre `-700` sobre fundo `-50`; texto auxiliar mínimo `slate-400` sobre branco.

---

## 6. Do's & Don'ts

| ✅ Faça | ❌ Não faça |
|---|---|
| 1 ação laranja por tela (o CTA) | Blocos/toolbars inteiros em cor saturada |
| Status no par suave `-50/-700` | Chips pretos ou cores cheias para dados |
| Fonte mono para códigos e valores técnicos | Misturar dado e prosa na mesma tipografia |
| Cards com `ring-1 ring-slate-900/5`, sem borda | Bordas cinza duras + sombras fortes juntas |
| Ícones de ação cinza com cor só no hover | Fileira de ícones coloridos permanentes |
| Esconder a etapa anterior quando a próxima abre | Empilhar entrada + resultado na mesma tela |
| Ação secundária como link discreto ("ou ...") | Dois painéis de entrada lado a lado |
| Filete `border-l-4 border-l-primary` para destacar | Fundo colorido para destacar card |
| Gradiente de fundo quase imperceptível | Fundos com tinte de marca visível |
| `confirm()` com contagem antes de descartar | Descartar trabalho silenciosamente |

---

## 7. Checklist de replicação rápida

1. Instalar: `tailwindcss@4`, `shadcn` (Button, Card, Badge, Input, Table, Dialog, Label, Separator, Alert), `@fontsource-variable/geist`, `lucide-react`.
2. Copiar o bloco `:root` (§2.1) e os estilos globais (§2.6, §2.7) para o CSS principal.
3. Trocar a matiz da marca se necessário: ajustar `--primary`, `--ring`, `::selection`, scrollbar hover e `--chart-1` (mesma matiz nos neutros: substituir o `46` dos oklch).
4. Aplicar §4 (página): fundo gradiente, header claro, fluxo em duas etapas, footer.
5. Construir componentes com as receitas da §3.
6. Validar contra §5 (acessibilidade) e §6 (do's & don'ts).
