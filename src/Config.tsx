import React, { useState } from "react";
import { motion } from "motion/react";
import {
  Settings,
  Plus,
  Trash2,
  Edit2,
  Save,
  ArrowLeft,
  GripVertical,
  Link,
  Lock,
  Eye,
  EyeOff
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { generateId } from "../lib/utils";

export interface HubLinkData {
  id: string;
  iconName: string;
  title: string;
  subtitle: string;
  description: string;
  url: string;
  isExternal: boolean;
  isActive: boolean;
  themeColor: string;
}

interface ConfigProps {
  hubLinks: HubLinkData[];
  setHubLinks: React.Dispatch<React.SetStateAction<HubLinkData[]>>;
  navigateTo: (view: 'hub' | 'ocr-perfis' | 'admin' | 'help' | 'users' | 'substitutions' | 'config') => void;
}

const AVAILABLE_ICONS = [
  "FileText", "Lock", "RefreshCw", "Link", "Settings", "Box", "Star", "Wrench", "Shield", "Users", "Info", "AlertCircle"
];

const AVAILABLE_COLORS = [
  { value: "primary", label: "Laranja (Primary)" },
  { value: "blue", label: "Azul" },
  { value: "green", label: "Verde" },
  { value: "slate", label: "Cinza" },
  { value: "purple", label: "Roxo" },
];

export function Config({ hubLinks, setHubLinks, navigateTo }: ConfigProps) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    return sessionStorage.getItem("nortehub_config_auth") === "true";
  });
  const [passwordInput, setPasswordInput] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const handleAuthSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordInput === "Norte@321") {
      setIsAuthenticated(true);
      sessionStorage.setItem("nortehub_config_auth", "true");
      setAuthError(null);
    } else {
      setAuthError("Senha incorreta. Tente novamente.");
    }
  };

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<HubLinkData>>({});
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!draggedId) return;
    
    const draggedIndex = hubLinks.findIndex(l => l.id === draggedId);
    if (draggedIndex === index) return;

    setHubLinks(prev => {
      const newLinks = [...prev];
      const [draggedItem] = newLinks.splice(draggedIndex, 1);
      newLinks.splice(index, 0, draggedItem);
      return newLinks;
    });
  };

  const handleDragEnd = () => {
    setDraggedId(null);
  };

  const handleEdit = (link: HubLinkData) => {
    setEditingId(link.id);
    setEditForm(link);
  };

  const handleSave = () => {
    if (!editForm.title || !editForm.url) return;
    
    setHubLinks(prev => prev.map(link => 
      link.id === editingId ? { ...link, ...editForm } as HubLinkData : link
    ));
    setEditingId(null);
  };

  const handleCancel = () => {
    // If it was a newly created empty link being cancelled, we could remove it, 
    // but we'll just keep it or the user can delete it. 
    setEditingId(null);
    setEditForm({});
  };

  const handleDelete = (id: string) => {
    if (confirm("Tem certeza que deseja remover este link?")) {
      setHubLinks(prev => prev.filter(link => link.id !== id));
    }
  };

  const handleAdd = () => {
    const newLink: HubLinkData = {
      id: generateId(),
      iconName: "Link",
      title: "Novo Link",
      subtitle: "Subtítulo",
      description: "Breve descrição do link...",
      url: "https://",
      isExternal: true,
      isActive: true,
      themeColor: "primary"
    };
    setHubLinks(prev => [...prev, newLink]);
    setEditingId(newLink.id);
    setEditForm(newLink);
  };

  const handleToggleActive = (id: string, active: boolean) => {
    setHubLinks(prev => prev.map(link => 
      link.id === id ? { ...link, isActive: active } : link
    ));
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center overflow-x-hidden relative font-sans p-4">
        {/* Decorative Glowing Orbs */}
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-orange-500/10 blur-[120px] pointer-events-none" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-orange-600/5 blur-[150px] pointer-events-none" />

        {/* Grid Pattern Background */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff03_1px,transparent_1px),linear-gradient(to_bottom,#ffffff03_1px,transparent_1px)] bg-[size:4rem_4rem] pointer-events-none" />

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, type: "spring", stiffness: 100, damping: 15 }}
          className="w-full max-w-md bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-2xl p-6 md:p-8 shadow-2xl relative z-10"
        >
          <div className="flex flex-col items-center text-center space-y-4 mb-6">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary border border-primary/20 shadow-inner">
              <Lock className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Área Restrita</h2>
              <p className="text-slate-400 text-xs md:text-sm mt-1">
                Insira a senha de administrador para acessar as configurações do portal.
              </p>
            </div>
          </div>

          <form onSubmit={handleAuthSubmit} className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label htmlFor="password-gate" className="text-slate-300 text-xs font-semibold">Senha</Label>
              </div>
              <div className="relative">
                <Input
                  id="password-gate"
                  type={showPassword ? "text" : "password"}
                  value={passwordInput}
                  onChange={(e) => {
                    setPasswordInput(e.target.value);
                    setAuthError(null);
                  }}
                  className="bg-slate-950/80 border-slate-800 text-white placeholder-slate-600 focus-visible:ring-primary focus-visible:border-primary pr-10 rounded-xl animate-none"
                  placeholder="••••••••"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors focus:outline-none"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {authError && (
              <motion.div
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-xl border border-red-500/20 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-400 font-medium"
              >
                {authError}
              </motion.div>
            )}

            <div className="flex flex-col gap-2 pt-2">
              <Button type="submit" className="w-full bg-primary hover:bg-primary/95 text-white font-bold h-11 rounded-xl shadow-lg shadow-primary/20 transition-all flex items-center justify-center gap-2 cursor-pointer text-sm">
                Confirmar
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => navigateTo('hub')}
                className="w-full text-slate-400 hover:text-white hover:bg-slate-800 h-11 rounded-xl transition-all flex items-center justify-center gap-2 text-sm"
              >
                <ArrowLeft className="w-4 h-4" />
                Voltar ao Menu
              </Button>
            </div>
          </form>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigateTo('hub')} className="text-slate-500 hover:text-slate-900">
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                <Settings className="w-5 h-5 text-primary" />
                Configuração do Portal
              </h1>
              <p className="text-sm text-slate-500 hidden md:block">Gerencie os links exibidos no Menu Principal</p>
            </div>
          </div>
          <Button onClick={handleAdd} className="bg-primary hover:bg-primary/90 text-white gap-2">
            <Plus className="w-4 h-4" /> <span className="hidden md:inline">Novo Link</span>
          </Button>
        </div>

        {/* Links List */}
        <div className="space-y-4">
          {hubLinks.map((link, index) => (
            <motion.div 
              key={link.id} 
              draggable={editingId !== link.id}
              onDragStart={(e: React.DragEvent) => handleDragStart(e, link.id)}
              onDragOver={(e: React.DragEvent) => handleDragOver(e, index)}
              onDragEnd={handleDragEnd}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className={`relative ${draggedId === link.id ? 'opacity-50 scale-[0.98]' : ''}`}
            >
              <Card className={`overflow-hidden transition-all border-slate-200 ${editingId === link.id ? 'ring-2 ring-primary/50 shadow-md' : 'hover:shadow-md hover:border-slate-300'}`}>
                {editingId === link.id ? (
                  <CardContent className="p-6 space-y-4 bg-slate-50/50">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      <div className="space-y-2">
                        <Label>Título do Link</Label>
                        <Input 
                          value={editForm.title || ""} 
                          onChange={e => setEditForm({...editForm, title: e.target.value})}
                          placeholder="Ex: OCR de Perfis"
                          className="bg-white"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Subtítulo (Badge)</Label>
                        <Input 
                          value={editForm.subtitle || ""} 
                          onChange={e => setEditForm({...editForm, subtitle: e.target.value})}
                          placeholder="Ex: Em breve"
                          className="bg-white"
                        />
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <Label>Descrição Breve</Label>
                        <Textarea 
                          value={editForm.description || ""} 
                          onChange={e => setEditForm({...editForm, description: e.target.value})}
                          className="resize-none h-20 bg-white"
                          placeholder="Digite os detalhes..."
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>URL ou Rota Interna</Label>
                        <Input 
                          value={editForm.url || ""} 
                          onChange={e => setEditForm({...editForm, url: e.target.value})}
                          placeholder="https://... ou ocr-perfis"
                          className="bg-white"
                        />
                      </div>
                      <div className="space-y-2 flex flex-col justify-end">
                        <div className="flex items-center space-x-2 h-10 border rounded-md px-3 bg-white">
                          <input 
                            type="checkbox"
                            className="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary"
                            checked={editForm.isExternal || false} 
                            onChange={e => setEditForm({...editForm, isExternal: e.target.checked})}
                            id="external-toggle"
                          />
                          <Label htmlFor="external-toggle" className="cursor-pointer font-medium text-slate-700">Abrir em nova aba (Link Externo)</Label>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Ícone</Label>
                        <select 
                          className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:border-primary/50"
                          value={editForm.iconName || "Link"}
                          onChange={e => setEditForm({...editForm, iconName: e.target.value})}
                        >
                          {AVAILABLE_ICONS.map(i => <option key={i} value={i}>{i}</option>)}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <Label>Cor Temática</Label>
                        <select 
                          className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:border-primary/50"
                          value={editForm.themeColor || "primary"}
                          onChange={e => setEditForm({...editForm, themeColor: e.target.value})}
                        >
                          {AVAILABLE_COLORS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                        </select>
                      </div>
                    </div>
                    
                    <div className="flex justify-end gap-3 pt-4 mt-4 border-t border-slate-200">
                      <Button variant="ghost" onClick={handleCancel} className="text-slate-600 hover:text-slate-900">Cancelar</Button>
                      <Button className="bg-primary hover:bg-primary/90 text-white shadow-sm shadow-primary/20" onClick={handleSave}>
                        <Save className="w-4 h-4 mr-2" /> Salvar Link
                      </Button>
                    </div>
                  </CardContent>
                ) : (
                  <CardContent className="p-4 flex flex-col md:flex-row items-center gap-4 bg-white group">
                    <div className="cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500">
                      <GripVertical className="w-5 h-5" />
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-bold text-slate-900 truncate">{link.title}</h3>
                        <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-bold border border-slate-200">
                          {link.subtitle}
                        </span>
                      </div>
                      <p className="text-sm text-slate-500 truncate">{link.url}</p>
                    </div>

                    <div className="flex items-center gap-4 md:gap-6 mt-4 md:mt-0 w-full md:w-auto justify-between md:justify-end">
                      <div className="flex items-center space-x-2">
                        <input 
                          type="checkbox"
                          className="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary"
                          checked={link.isActive} 
                          onChange={e => handleToggleActive(link.id, e.target.checked)}
                          id={`active-toggle-${link.id}`}
                        />
                        <Label htmlFor={`active-toggle-${link.id}`} className={`text-xs font-semibold cursor-pointer ${link.isActive ? 'text-primary' : 'text-slate-400'}`}>
                          {link.isActive ? 'ATIVO' : 'INATIVO'}
                        </Label>
                      </div>
                      
                      <div className="flex items-center gap-1 md:border-l md:pl-6 border-slate-200">
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(link)} className="text-slate-400 hover:text-blue-600 hover:bg-blue-50">
                          <Edit2 className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(link.id)} className="text-slate-400 hover:text-red-600 hover:bg-red-50">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                )}
              </Card>
            </motion.div>
          ))}

          {hubLinks.length === 0 && (
            <div className="text-center py-12 text-slate-500 bg-white rounded-xl border border-dashed border-slate-300">
              <Link className="w-12 h-12 mx-auto text-slate-300 mb-4" />
              <p>Nenhum link configurado.</p>
              <Button variant="link" onClick={handleAdd} className="text-primary mt-2">
                Adicionar primeiro link
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
