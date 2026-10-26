import { useState } from "react";

// Marca da liga. Tenta carregar o logo do repositório (public/); se não houver
// arquivo, cai no monograma "EF" nas cores da marca.
// - "colorida" (logo.png): para fundo claro.
// - "branca" (logo-branca.png): para a lateral e o login, sobre o marinho.
const CANDIDATOS = {
  colorida: ["logo.svg", "logo.png", "logo.webp"],
  branca: ["logo-branca.svg", "logo-branca.png", "logo-branca.webp"],
} as const;

interface Props {
  variante?: keyof typeof CANDIDATOS;
  className?: string;
}

export function Marca({ variante = "colorida", className = "marca__img" }: Props) {
  const [i, setI] = useState(0);
  const base = import.meta.env.BASE_URL;
  const lista = CANDIDATOS[variante];

  if (i >= lista.length) {
    return <div className="marca__mono">EF</div>;
  }
  return (
    <img
      className={className}
      src={base + lista[i]}
      alt="ESALQ Finance"
      onError={() => setI((n) => n + 1)}
    />
  );
}
