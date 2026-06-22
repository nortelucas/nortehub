import React, { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Database, Loader2, Plus, RefreshCw, Save, Search, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

interface SubstitutionRule {
  row?: number;
  itemPedido: string;
  conversaoAluminorte: string;
  sugestao: string;
  comentarios: string;
}

interface SubstitutionsProps {
  onBack: () => void;
}

const emptyRule = (): SubstitutionRule => ({
  itemPedido: "",
  conversaoAluminorte: "",
  sugestao: "",
  comentarios: "",
});

const normalizeRule = (rule: SubstitutionRule, index: number): SubstitutionRule => ({
  row: Number.isFinite(Number(rule.row)) ? Number(rule.row) : index + 1,
  itemPedido: rule.itemPedido || "",
  conversaoAluminorte: rule.conversaoAluminorte || "",
  sugestao: rule.sugestao || "",
  comentarios: rule.comentarios || "",
});

export function Substitutions({ onBack }: SubstitutionsProps) {
  const [rules, setRules] = useState<SubstitutionRule[]>([]);
  const [source, setSource] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadRules = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/substitutions?_t=${Date.now()}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao carregar substituições.");

      const loadedRules = Array.isArray(data.substitutionRules)
        ? data.substitutionRules.map(normalizeRule)
        : [];
      setRules(loadedRules);
      setSource(data.source || "");
      setDirty(false);
    } catch (err: any) {
      setError(err.message || "Erro ao carregar substituições.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRules();
  }, []);

  const filteredRules = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return rules.map((rule, index) => ({ rule, index }));

    return rules
      .map((rule, index) => ({ rule, index }))
      .filter(({ rule }) =>
        [rule.itemPedido, rule.conversaoAluminorte, rule.sugestao, rule.comentarios]
          .some(value => value.toLowerCase().includes(term))
      );
  }, [rules, query]);

  const updateRule = (index: number, updates: Partial<SubstitutionRule>) => {
    setRules(prev => prev.map((rule, ruleIndex) => (
      ruleIndex === index ? { ...rule, ...updates } : rule
    )));
    setDirty(true);
  };

  const addRule = () => {
    setRules(prev => [emptyRule(), ...prev]);
    setQuery("");
    setDirty(true);
  };

  const deleteRule = (index: number) => {
    setRules(prev => prev.filter((_, ruleIndex) => ruleIndex !== index));
    setDirty(true);
  };

  const saveRules = async () => {
    const missingItem = rules.some(rule => !rule.itemPedido.trim());
    if (missingItem) {
      setError("Preencha o Item Pedido de todas as linhas antes de salvar.");
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const substitutionRules = rules.map((rule, index) => ({
        row: Number.isFinite(Number(rule.row)) ? Number(rule.row) : index + 1,
        itemPedido: rule.itemPedido.trim(),
        conversaoAluminorte: rule.conversaoAluminorte.trim(),
        sugestao: rule.sugestao.trim(),
        comentarios: rule.comentarios.trim(),
      }));

      const response = await fetch("/api/substitutions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ substitutionRules }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao salvar substituições.");

      setRules(substitutionRules);
      setDirty(false);
      setMessage(`Lista salva com ${data.count ?? substitutionRules.length} itens em ${data.persisted || "banco/local"}.`);
    } catch (err: any) {
      setError(err.message || "Erro ao salvar substituições.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-50 p-4 md:p-8 font-sans">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={onBack} aria-label="Voltar" className="text-slate-500 hover:text-primary">
              <ChevronLeft className="w-6 h-6" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">Itens de Substituição</h1>
              <p className="text-sm text-slate-500">Cadastro de conversões automáticas e sugestões de troca.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="bg-slate-50 text-slate-700 border-slate-200 font-mono text-[11px] font-semibold">
              <Database className="w-3 h-3 mr-1" />
              {source || "carregando"}
            </Badge>
            <Button variant="outline" onClick={loadRules} disabled={loading || saving} className="bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-semibold">
              <RefreshCw className="w-4 h-4 mr-2" />
              Recarregar
            </Button>
            <Button onClick={saveRules} disabled={loading || saving || !dirty} className="bg-primary hover:bg-primary/90 text-white font-bold shadow-sm shadow-primary/30">
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              Salvar no Banco
            </Button>
          </div>
        </header>

        <Card className="bg-white border-none ring-1 ring-slate-900/5 shadow-lg shadow-slate-900/5 rounded-2xl overflow-hidden">
          <CardHeader className="border-b border-slate-100 bg-white">
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0">
                  <Database className="w-4 h-4" />
                </span>
                <div>
                  <CardTitle className="text-base font-bold tracking-tight text-slate-900">Lista de Regras</CardTitle>
                  <CardDescription className="text-sm text-slate-500">
                    {rules.length} itens cadastrados. {dirty ? "Alterações pendentes." : "Sem alterações pendentes."}
                  </CardDescription>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
                <div className="space-y-1">
                  <Label className="text-xs text-slate-500 font-semibold">Buscar</Label>
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <Input
                      className="pl-8 w-full sm:w-72 h-8 bg-slate-50 text-slate-900 placeholder:text-slate-400 text-xs border border-slate-200 rounded-lg focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:border-primary/50"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Código, sugestão ou comentário"
                    />
                  </div>
                </div>
                <Button variant="secondary" onClick={addRule} disabled={loading || saving} className="bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-semibold">
                  <Plus className="w-4 h-4 mr-2" />
                  Novo Item
                </Button>
              </div>
            </div>
            {(error || message) && (
              <div className={`mt-4 rounded-lg border px-3 py-2 text-sm ${error ? "border-red-200 bg-red-50 text-red-600" : "border-green-200 bg-green-50 text-green-700"}`}>
                {error || message}
              </div>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="h-96 flex items-center justify-center text-slate-400 text-sm">
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Carregando itens...
              </div>
            ) : (
              <div className="max-h-[70vh] overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-white/95 backdrop-blur-sm z-10 shadow-sm">
                    <TableRow>
                      <TableHead className="w-[170px] text-[11px] font-semibold uppercase tracking-wider text-slate-400">Item Pedido</TableHead>
                      <TableHead className="w-[210px] text-[11px] font-semibold uppercase tracking-wider text-slate-400">Conversão Aluminorte</TableHead>
                      <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Sugestão de Substituição</TableHead>
                      <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Comentários</TableHead>
                      <TableHead className="w-[70px] text-right text-[11px] font-semibold uppercase tracking-wider text-slate-400">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRules.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="h-40 text-center text-slate-400">
                          Nenhum item encontrado.
                        </TableCell>
                      </TableRow>
                    ) : filteredRules.map(({ rule, index }) => (
                      <TableRow key={`${index}-${rule.row ?? "new"}`} className={!rule.itemPedido.trim() ? "bg-red-50/40 hover:bg-red-50/60" : "hover:bg-slate-50/70"}>
                        <TableCell className="align-top">
                          <Input
                            className="h-8 bg-slate-50 text-slate-900 placeholder:text-slate-400 border border-slate-200 rounded-lg focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:border-primary/50 font-mono text-xs font-bold tracking-tight uppercase"
                            value={rule.itemPedido}
                            onChange={(event) => updateRule(index, { itemPedido: event.target.value.toUpperCase() })}
                            placeholder="Ex: B413"
                          />
                        </TableCell>
                        <TableCell className="align-top">
                          <Input
                            className="h-8 bg-slate-50 text-slate-900 placeholder:text-slate-400 border border-slate-200 rounded-lg focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:border-primary/50 font-mono text-xs font-bold tracking-tight"
                            value={rule.conversaoAluminorte}
                            onChange={(event) => updateRule(index, { conversaoAluminorte: event.target.value })}
                            placeholder="Ex: I105 ou NÃO TEMOS"
                          />
                        </TableCell>
                        <TableCell className="align-top whitespace-normal min-w-[280px]">
                          <Textarea
                            className="min-h-[42px] text-xs resize-y bg-slate-50 text-slate-900 placeholder:text-slate-400 border border-slate-200 rounded-lg focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:border-primary/50"
                            value={rule.sugestao}
                            onChange={(event) => updateRule(index, { sugestao: event.target.value })}
                            placeholder="Ex: BAR027 (50,8 mm com 3,18)"
                          />
                        </TableCell>
                        <TableCell className="align-top whitespace-normal min-w-[260px]">
                          <Textarea
                            className="min-h-[42px] text-xs resize-y bg-slate-50 text-slate-900 placeholder:text-slate-400 border border-slate-200 rounded-lg focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:border-primary/50"
                            value={rule.comentarios}
                            onChange={(event) => updateRule(index, { comentarios: event.target.value })}
                            placeholder="Observações"
                          />
                        </TableCell>
                        <TableCell className="align-top text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-slate-400 hover:text-red-600 hover:bg-red-50"
                            onClick={() => deleteRule(index)}
                            title="Excluir item"
                            aria-label={`Excluir item ${rule.itemPedido || "novo"}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
