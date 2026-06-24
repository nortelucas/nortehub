import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const defaultLinks = [
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

async function seed() {
  try {
    await pool.query(
      `INSERT INTO hub_links (id, links, updated_at) 
       VALUES (1, $1, CURRENT_TIMESTAMP) 
       ON CONFLICT (id) 
       DO UPDATE SET links = EXCLUDED.links, updated_at = CURRENT_TIMESTAMP;`,
      [JSON.stringify(defaultLinks)]
    );
    console.log("Database reset to UTF-8 default links successfully!");
  } catch (err) {
    console.error("Failed to seed database:", err);
  } finally {
    await pool.end();
  }
}

seed();
