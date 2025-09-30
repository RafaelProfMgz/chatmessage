const dotenv = require("dotenv");

// Carrega as variáveis de ambiente (garantindo que o db.js também possa acessá-las)
dotenv.config();

// db.js
const { createClient } = require("@supabase/supabase-js");

// Certifique-se de configurar suas variáveis de ambiente
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

const connectDB = async () => {
  try {
    const { error } = await supabase.from("users").select("*").limit(0);
    if (error) throw error;
    console.log("Supabase Conectado.");
  } catch (error) {
    console.error(`Erro ao conectar com Supabase: ${error.message}`);
    process.exit(1);
  }
};

module.exports = { supabase, connectDB };
