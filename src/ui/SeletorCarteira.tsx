import { useCallback, useState } from "react";

/** Qual carteira o app inteiro está mostrando e operando. */
export type EscopoCarteira = "liga" | "pessoal";

const CHAVE = "esalq:escopo";

/**
 * Escopo ativo, lembrado entre sessões — quem trabalha na própria carteira volta
 * nela. O que impede confusão não é abrir sempre na liga, e sim o app inteiro
 * dizer o tempo todo qual carteira está em uso (seletor, faixa e rótulo no topo).
 */
export function useEscopo(): [EscopoCarteira, (e: EscopoCarteira) => void] {
  const [escopo, setEscopo] = useState<EscopoCarteira>(() =>
    localStorage.getItem(CHAVE) === "pessoal" ? "pessoal" : "liga",
  );
  const trocar = useCallback((e: EscopoCarteira) => {
    localStorage.setItem(CHAVE, e);
    setEscopo(e);
  }, []);
  return [escopo, trocar];
}

interface Props {
  escopo: EscopoCarteira;
  onTrocar: (e: EscopoCarteira) => void;
  /** false enquanto o membro não criou a carteira pessoal. */
  ativada: boolean;
  className?: string;
}

export function SeletorCarteira({ escopo, onTrocar, ativada, className }: Props) {
  return (
    <div
      className={`segmented segmented--escopo ${className ?? ""}`}
      role="group"
      aria-label="Carteira em uso"
    >
      <button
        className={escopo === "liga" ? "ativo" : ""}
        onClick={() => onTrocar("liga")}
        aria-pressed={escopo === "liga"}
      >
        Liga
      </button>
      <button
        className={escopo === "pessoal" ? "ativo" : ""}
        onClick={() => onTrocar("pessoal")}
        aria-pressed={escopo === "pessoal"}
      >
        {ativada ? "Individual" : "Individual · ativar"}
      </button>
    </div>
  );
}
