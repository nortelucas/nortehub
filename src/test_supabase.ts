import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

async function testConnection() {
  console.log("--- Testando Conexão Supabase ---");
  
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("❌ ERRO: SUPABASE_URL ou SUPABASE_ANON_KEY não encontradas no arquivo .env");
    process.exit(1);
  }

  console.log(`URL: ${supabaseUrl}`);
  console.log(`Key: ${supabaseAnonKey.substring(0, 10)}...`);

  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  try {
    const { data, error } = await supabase
      .from('knowledge_base')
      .select('count', { count: 'exact', head: true });

    if (error) {
      console.error("❌ Erro na resposta do Supabase:", error.message);
      if (error.code === 'PGRST116') {
        console.log("ℹ️ Dica: A tabela existe mas pode estar vazia ou sem o ID=1.");
      } else if (error.code === '42P01') {
        console.log("ℹ️ Dica: A tabela 'knowledge_base' não foi encontrada. Você rodou o script SQL?");
      }
    } else {
      console.log("✅ Conexão estabelecida com sucesso!");
      console.log("Conseguimos acessar a tabela 'knowledge_base'.");
    }
  } catch (err: any) {
    console.error("❌ Erro inesperado:", err.message);
  }
}

testConnection();
