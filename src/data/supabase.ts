// Cliente único do Supabase para o frontend.
// A URL do projeto NÃO é segredo (é só um endereço público), então tem um
// padrão embutido — assim o site nunca depende de um secret pra achar o backend.
// A chave ANON/publishable é pública por design (vai no bundle); a segurança
// real é a RLS do banco (ver supabase/schema.sql). Ambas podem ser sobrescritas
// pelo ambiente (ex.: dev local com .env.local, ou outro projeto Supabase).
// A service_role key NUNCA entra aqui — só no server (Action de preços).
import { createClient } from "@supabase/supabase-js";

const URL_PADRAO = "https://xunrylqbpflfhscfowvj.supabase.co";
const ANON_PADRAO = "sb_publishable_1yuR0E5BkeZSf7fxp3mukA_LYaw3T4a";

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || URL_PADRAO;
const anon = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || ANON_PADRAO;

if (!anon) {
  throw new Error(
    "Configuração ausente: defina VITE_SUPABASE_ANON_KEY (secret SUPABASE_ANON_KEY na Action, ou .env.local no dev).",
  );
}

export const supabase = createClient(url, anon, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
