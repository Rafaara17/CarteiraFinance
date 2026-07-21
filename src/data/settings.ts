// Configurações locais do usuário (token, identidade, coordenadas do repo).
// Guardadas SOMENTE no localStorage — nunca commitadas.

export interface Settings {
  owner: string;
  repo: string;
  branch: string;
  membro: string;
  token: string;
}

const CHAVE = "carteirafinance.settings";

export const SETTINGS_PADRAO: Settings = {
  owner: "Rafaara17",
  repo: "CarteiraFinance",
  branch: "main",
  membro: "",
  token: "",
};

export function carregarSettings(): Settings {
  try {
    const raw = localStorage.getItem(CHAVE);
    if (!raw) return { ...SETTINGS_PADRAO };
    return { ...SETTINGS_PADRAO, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...SETTINGS_PADRAO };
  }
}

export function salvarSettings(s: Settings): void {
  localStorage.setItem(CHAVE, JSON.stringify(s));
}

export function settingsCompletas(s: Settings): boolean {
  return Boolean(s.owner && s.repo && s.branch && s.membro.trim() && s.token.trim());
}
