// Autenticação: login por e-mail/senha (acesso "correto e específico").
// O cadastro público fica DESLIGADO no Supabase — os membros são convidados pelo
// admin. Aqui só tratamos login, logout e a identidade do membro logado.
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export async function signIn(email: string, senha: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha });
  if (error) throw new Error(traduzErro(error.message));
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/** Observa mudanças de sessão (login/logout/refresh). Retorna a função de unsubscribe. */
export function onAuthChange(cb: (session: Session | null) => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((_evt, session) => cb(session));
  return () => data.subscription.unsubscribe();
}

/** Nome de exibição do membro logado — usado como rótulo no ledger. */
export function membroAtual(session: Session | null): string {
  const u = session?.user;
  if (!u) return "—";
  const meta = u.user_metadata as { name?: string; full_name?: string } | undefined;
  return meta?.name?.trim() || meta?.full_name?.trim() || u.email || u.id;
}

function traduzErro(msg: string): string {
  if (/invalid login credentials/i.test(msg)) return "E-mail ou senha inválidos.";
  if (/email not confirmed/i.test(msg)) return "E-mail ainda não confirmado. Verifique sua caixa de entrada.";
  return msg;
}
