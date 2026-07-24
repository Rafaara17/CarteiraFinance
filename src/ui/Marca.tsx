import { useState } from "react";

// Marca da liga. Tenta carregar o logo do repositório (public/logo.svg|png|webp);
// se não houver arquivo, cai no monograma "EF" nas cores da marca.
// Para usar o logo real: adicione o arquivo em `public/` com o nome `logo.svg`
// (ou logo.png / logo.webp).
const CANDIDATOS = ["logo.svg", "logo.png", "logo.webp"];

export function Marca() {
  const [i, setI] = useState(0);
  const base = import.meta.env.BASE_URL;

  if (i >= CANDIDATOS.length) {
    return <div className="marca__mono">EF</div>;
  }
  return (
    <img
      className="marca__img"
      src={base + CANDIDATOS[i]}
      alt="ESALQ Finance"
      onError={() => setI((n) => n + 1)}
    />
  );
}
