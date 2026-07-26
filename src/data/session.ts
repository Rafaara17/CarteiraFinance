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

/**
 * Palpite de nome para pré-preencher o cadastro no primeiro acesso: o que o
 * admin tiver posto em `user_metadata` ao convidar. Vazio é o normal — o nome
 * que vale é o que a própria pessoa cadastra (tabela `membros`).
 */
export function nomeSugerido(session: Session | null): string {
  const meta = session?.user?.user_metadata as { name?: string; full_name?: string } | undefined;
  return meta?.name?.trim() || meta?.full_name?.trim() || "";
}

/** Id (uuid) do usuário logado — chave em membros/wallets. */
export function usuarioId(session: Session | null): string | null {
  return session?.user?.id ?? null;
}

function traduzErro(msg: string): string {
  if (/invalid login credentials/i.test(msg)) return "E-mail ou senha inválidos.";
  if (/email not confirmed/i.test(msg)) return "E-mail ainda não confirmado. Verifique sua caixa de entrada.";
  return msg;
}
