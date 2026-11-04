import { PAGINA_LISTADO_69B, urlPublica } from "../../dominio/lista-69b";
import { ErrorDeDominio } from "../session/error-de-dominio";

const TOPE_PAGINA = 1_000_000;
const TOPE_ARCHIVO = 20_000_000;

export type OrigenListado = {
  leerPagina: () => Promise<string>;
  leerArchivo: (url: string) => Promise<Uint8Array>;
};

export function origenSat(): OrigenListado {
  const citada = new URL(PAGINA_LISTADO_69B);
  return {
    async leerPagina() {
      const bytes = await leerBytes(PAGINA_LISTADO_69B, TOPE_PAGINA, (final) => {
        try {
          const url = new URL(final);
          return url.protocol === "https:" && url.hostname === citada.hostname && url.pathname === citada.pathname;
        } catch {
          return false;
        }
      });
      try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw new ErrorDeDominio("pagina_irreconocible");
      }
    },
    async leerArchivo(url) {
      if (!urlPublica(url, PAGINA_LISTADO_69B)) throw new ErrorDeDominio("url_no_publica");
      return leerBytes(url, TOPE_ARCHIVO, (final) => urlPublica(final, PAGINA_LISTADO_69B) !== null);
    },
  };
}

async function leerBytes(
  url: string,
  tope: number,
  aceptarFinal: (url: string) => boolean,
): Promise<Uint8Array> {
  let respuesta: Response;
  try {
    respuesta = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(25_000),
      headers: { accept: "text/html,text/csv,text/plain,*/*" },
    });
  } catch {
    throw new ErrorDeDominio("sat_no_disponible");
  }
  if (!respuesta.ok || !aceptarFinal(respuesta.url)) throw new ErrorDeDominio("sat_no_disponible");
  const anunciado = Number(respuesta.headers.get("content-length") ?? "");
  if (Number.isFinite(anunciado) && anunciado > tope) throw new ErrorDeDominio("listado_demasiado_grande");
  const cuerpo = respuesta.body;
  if (!cuerpo) throw new ErrorDeDominio("sat_no_disponible");
  const lector = cuerpo.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const paso = await lector.read();
      if (paso.done) break;
      total += paso.value.byteLength;
      if (total > tope) {
        await lector.cancel();
        throw new ErrorDeDominio("listado_demasiado_grande");
      }
      partes.push(paso.value);
    }
  } catch (error) {
    if (error instanceof ErrorDeDominio) throw error;
    throw new ErrorDeDominio("sat_no_disponible");
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const parte of partes) {
    bytes.set(parte, offset);
    offset += parte.byteLength;
  }
  return bytes;
}
