// Base64 seguro para UTF-8 no navegador (btoa/atob sozinhos quebram acentos).

export function encodeBase64(texto: string): string {
  const bytes = new TextEncoder().encode(texto);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function decodeBase64(b64: string): string {
  // A API do GitHub devolve base64 quebrado em linhas — remove espaços/quebras.
  const limpo = b64.replace(/\s/g, "");
  const bin = atob(limpo);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
