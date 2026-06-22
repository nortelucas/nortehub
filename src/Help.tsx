import React from "react";
import { ArrowLeft, Upload, Edit, Trash2, Download, Table, Cog, FileText, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { motion } from "motion/react";

export function Help({ onBack }: { onBack: () => void }) {
  const topics = [
    {
      icon: <Upload className="w-4 h-4" />,
      title: "Upload e Processamento",
      description: "Você pode subir documentos PDF ou Imagem dos pedidos. O sistema fará a leitura via IA e montará a tabela estruturada automaticamente."
    },
    {
      icon: <Camera className="w-4 h-4" />,
      title: "Câmera (Mobile)",
      description: "Se estiver no celular, você pode tirar uma foto do documento diretamente. O app iniciará o processamento em tempo real."
    },
    {
      icon: <FileText className="w-4 h-4" />,
      title: "Inserir Texto Manualmente",
      description: "Se você tem um pedido no WhatsApp ou E-mail, apenas copie o texto bruto, cole nesta função e a Inteligência Artificial o organizará em tabela para você."
    },
    {
      icon: <Edit className="w-4 h-4" />,
      title: "Editar em Massa (Cor, Preço, Dimensões)",
      description: "Selecione vários itens na tabela e aplique Cor (Acabamento), Preço Customizado e Comprimento a todos de uma só vez, poupando tempo."
    },
    {
      icon: <Trash2 className="w-4 h-4" />,
      title: "Localizar, Apagar e Substituir",
      description: "Ideal para limpar lixo nos nomes dos perfis. Selecione os itens e configure um texto para remover, ou use Localizar/Substituir para corrigir códigos (ex: 'LG-' para 'LG0')."
    },
    {
      icon: <Table className="w-4 h-4" />,
      title: "Prévia de Tabela In-line",
      description: "Você tem total liberdade para editar uma linha de forma independente clicando no ícone de lápis. Pode configurar acabamento, qtde, preço e barra especificamente."
    },
    {
      icon: <Download className="w-4 h-4" />,
      title: "Exportação (.XLSX e .CSV)",
      description: "Exporte a lista finalizada. Há uma regra de blindagem: quaisquer acabamentos não reconhecidos ou registrados como (Natural, Bruto) exportarão forçadamente a tag 'NT'."
    },
    {
      icon: <Cog className="w-4 h-4" />,
      title: "Configuração do Catálogo e API (Admin)",
      description: "O sistema armazena a estrutura do seu catálogo (KB) remotamente. Pode gerenciar perfis aprendidos clicando na versão."
    }
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <div className="flex items-center gap-4">
        <Button variant="ghost" onClick={onBack} className="text-slate-500 hover:text-primary">
          <ArrowLeft className="w-4 h-4 mr-2" /> Voltar
        </Button>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">
          Central de Ajuda e Guia Rápido
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {topics.map((item, idx) => (
          <Card key={idx} className="bg-white border-none ring-1 ring-slate-900/5 shadow-lg shadow-slate-900/5 rounded-2xl hover:shadow-xl transition-shadow">
            <CardHeader className="pb-2 flex flex-row items-center gap-3 space-y-0">
              <span className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0">{item.icon}</span>
              <CardTitle className="text-sm md:text-base font-bold tracking-tight text-slate-900 leading-tight">{item.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-sm text-slate-500">
                {item.description}
              </CardDescription>
            </CardContent>
          </Card>
        ))}
      </div>
      
      <Card className="bg-white border-none ring-1 ring-slate-900/5 shadow-lg shadow-slate-900/5 rounded-2xl border-l-4 border-l-primary mt-8 overflow-hidden relative">
        <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-bl-full -z-0"></div>
        <CardHeader>
          <CardTitle className="font-bold tracking-tight text-slate-900">Dica de Uso dos Balões Guias</CardTitle>
          <CardDescription className="text-sm text-slate-500">
            Experimente passar ou repousar o mouse (ou segurar em telas touch) sobre os ícones e botões por todo o sistema. A maioria possui balões (Tooltips) contendo dicas rápidas explicativas que facilitam a compreensão do que cada ação na plataforma realiza.
          </CardDescription>
        </CardHeader>
      </Card>
    </motion.div>
  );
}
