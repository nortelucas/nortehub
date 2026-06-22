import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Upload, Save, ChevronLeft, Loader2, CheckCircle2, FileText } from 'lucide-react';
import { generateCatalogFromPDF } from './services/ocrService';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface AdminProps {
  onBack: () => void;
}

export const Admin: React.FC<AdminProps> = ({ onBack }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, message: '' });
  const [discoveredProducts, setDiscoveredProducts] = useState<string[]>([]);
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [status, setStatus] = useState<'idle' | 'processing' | 'done'>('idle');
  const [isDragging, setIsDragging] = useState(false);

  const fetchCatalog = async () => {
    try {
      const response = await fetch(`/api/catalog?_t=${Date.now()}`);
      const data = await response.json();
      setHistory(data.history || []);
    } catch (err) {
      console.error("Erro ao carregar catálogo:", err);
    }
  };

  useEffect(() => {
    fetchCatalog();
  }, []);

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve(base64);
      };
      reader.onerror = error => reject(error);
    });
  };

  const processFile = async (file: File) => {
    setIsProcessing(true);
    setStatus('processing');
    setCurrentFile(file);
    try {
      const base64 = await fileToBase64(file);
      const codes = await generateCatalogFromPDF(base64, (current, total, message) => {
        setProgress({ current, total, message: message || '' });
      });

      if (codes.length === 0) {
        alert("Nenhum código de perfil foi encontrado neste documento. Verifique se ele contém uma tabela de códigos.");
        setStatus('idle');
      } else {
        setDiscoveredProducts(codes);
        setStatus('done');
      }
    } catch (err) {
      console.error(err);
      alert("Erro ao processar catálogo. O arquivo pode ser grande demais ou estar protegido.");
      setStatus('idle');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    await processFile(e.target.files[0]);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await processFile(e.dataTransfer.files[0]);
    }
  };

  const handleSave = async () => {
    if (discoveredProducts.length === 0 || !currentFile) return;

    setIsSaving(true);
    try {
      const historyItem = {
        fileName: currentFile.name,
        newItems: discoveredProducts.length
      };

      const response = await fetch('/api/save-catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          products: discoveredProducts,
          historyItem
        }),
      });

      if (response.ok) {
        setDiscoveredProducts([]);
        setCurrentFile(null);
        setStatus('idle');
        await fetchCatalog(); // Refresh history list
        alert("Fonte de conhecimento salva com sucesso!");
      } else {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || "Falha ao salvar catálogo.");
      }
    } catch (err: any) {
      console.error(err);
      alert("Erro ao salvar: " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-50 p-4 md:p-8 font-sans">
      <div className="max-w-5xl mx-auto space-y-8">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={onBack} aria-label="Voltar" className="text-slate-500 hover:text-primary">
              <ChevronLeft className="w-6 h-6" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">Fontes de Conhecimento</h1>
              <p className="text-sm text-slate-500">Gerencie os catálogos que alimentam a inteligência do sistema.</p>
            </div>
          </div>
          <Badge variant="outline" className="px-3 py-1 bg-amber-50 text-amber-700 border-amber-200">
            Modo Admin
          </Badge>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Adicionar Nova Fonte */}
          <div className="lg:col-span-1 space-y-6">
            <Card
              className={`p-6 border-dashed border-2 rounded-3xl flex flex-col items-center text-center gap-4 transition-all ${isDragging ? 'border-primary bg-primary/5' : 'border-slate-300 bg-white hover:border-slate-400 hover:shadow-sm'}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${isDragging ? 'bg-primary text-white scale-110 rotate-3' : 'bg-slate-900 text-white'}`}>
                {isProcessing ? (
                  <Loader2 className="w-6 h-6 animate-spin" />
                ) : (
                  <Upload className="w-6 h-6" />
                )}
              </div>
              <div className="space-y-1">
                <h3 className="font-bold tracking-tight text-slate-900">Nova Fonte</h3>
                <p className="text-xs text-slate-500">Adicione um novo PDF de catálogo.</p>
              </div>
              <input
                type="file"
                accept=".pdf,image/*"
                onChange={handleUpload}
                disabled={isProcessing}
                className="hidden"
                id="catalog-upload"
              />
              <label
                htmlFor="catalog-upload"
                className={cn(
                  buttonVariants({ variant: "outline" }),
                  "w-full cursor-pointer bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-semibold rounded-lg",
                  isProcessing && "pointer-events-none opacity-50"
                )}
              >
                {isProcessing ? (
                  progress.message || "Analisando..."
                ) : "Selecionar Documento"}
              </label>
            </Card>

            {discoveredProducts.length > 0 && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-white rounded-2xl ring-1 ring-slate-900/5 shadow-lg shadow-slate-900/5 border-l-4 border-l-primary p-4 space-y-4"
              >
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">Pronto para salvar</Badge>
                  <span className="text-[10px] text-slate-400 font-mono">{currentFile?.name}</span>
                </div>
                <p className="text-sm text-slate-600">
                  Encontramos <strong>{discoveredProducts.length}</strong> códigos de perfil neste documento.
                </p>
                <Button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="w-full bg-primary hover:bg-primary/90 text-white font-bold shadow-sm shadow-primary/30"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Salvando...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4 mr-2" />
                      Salvar Fonte
                    </>
                  )}
                </Button>
              </motion.div>
            )}
          </div>

          {/* Histórico de Fontes (NotebookLM Style) */}
          <div className="lg:col-span-2 space-y-6">
            <h3 className="font-bold tracking-tight text-slate-900 flex items-center gap-3 px-2">
              <span className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-4 h-4" />
              </span>
              Fontes Aprendidas
            </h3>

            <div className="grid grid-cols-1 gap-4">
              {history.length === 0 ? (
                <div className="text-center p-12 bg-white rounded-2xl border-none ring-1 ring-slate-900/5 shadow-lg shadow-slate-900/5">
                  <p className="text-slate-400">Nenhuma fonte de conhecimento adicionada ainda.</p>
                </div>
              ) : (
                history.map((item, idx) => (
                  <motion.div
                    key={item.id || idx}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    className="bg-white p-5 rounded-2xl border-none ring-1 ring-slate-900/5 shadow-lg shadow-slate-900/5 hover:shadow-xl transition-all flex items-center justify-between group"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center group-hover:bg-primary/5 transition-colors">
                        <FileText className="w-5 h-5 text-slate-400 group-hover:text-primary transition-colors" />
                      </div>
                      <div>
                        <h4 className="font-semibold tracking-tight text-slate-900">{item.fileName}</h4>
                        <p className="text-[11px] text-slate-400 flex items-center gap-2">
                          Aprendido em: {new Date(item.date).toLocaleDateString()}
                          <span className="w-1 h-1 bg-slate-200 rounded-full" />
                          {item.newItems} produtos extraídos
                        </p>
                      </div>
                    </div>
                    <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                      Ativo
                    </Badge>
                  </motion.div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
