import { PAGINA_LISTADO_69B, urlPublica } from "../../dominio/lista-69b";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";

const TOPE_PAGINA = 1_000_000;
const TOPE_ARCHIVO = 20_000_000;
/** Redirecciones que se siguen, una por una y validando cada destino, antes de rendirse. */
export const TOPE_SALTOS = 5;

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export type OrigenListado = {
  leerPagina: () => Promise<string>;
  leerArchivo: (url: string) => Promise<Uint8Array>;
};

/**
 * Solo hosts del SAT, por https, sin credenciales ni IP. Cada salto de una
 * redirección se valida aquí ANTES de pedirlo: el servidor nunca toca una
 * dirección interna aunque el SAT (o quien se haga pasar por él) redirija.
 */
export function direccionDelSat(href: string): string | null {
  const publica = urlPublica(href, PAGINA_LISTADO_69B);
  if (!publica) return null;
  const host = new URL(publica).hostname.toLowerCase().replace(/\.$/u, "");
  return host === "sat.gob.mx" || host.endsWith(".sat.gob.mx") ? publica : null;
}

export function origenSat(hacerFetch: Fetch = fetch): OrigenListado {
  const citada = new URL(PAGINA_LISTADO_69B);
  return {
    async leerPagina() {
      const bytes = await leerBytes(PAGINA_LISTADO_69B, TOPE_PAGINA, hacerFetch, (final) => {
        const url = new URL(final);
        return url.hostname === citada.hostname && url.pathname === citada.pathname;
      });
      try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw new ErrorDeDominio("pagina_irreconocible");
      }
    },
    async leerArchivo(url) {
      if (!urlPublica(url, PAGINA_LISTADO_69B)) throw new ErrorDeDominio("url_no_publica");
      if (!direccionDelSat(url)) throw new ErrorDeDominio("url_fuera_del_sat");
      return leerBytes(url, TOPE_ARCHIVO, hacerFetch, () => true);
    },
  };
}

async function leerBytes(
  url: string,
  tope: number,
  hacerFetch: Fetch,
  aceptarFinal: (url: string) => boolean,
): Promise<Uint8Array> {
  let actual = url;
  let respuesta: Response | null = null;
  for (let saltos = 0; respuesta === null; saltos += 1) {
    const permitida = direccionDelSat(actual);
    if (!permitida) throw new ErrorDeDominio("sat_no_disponible");
    let recibida: Response;
    try {
      recibida = await hacerFetch(permitida, {
        redirect: "manual",
        signal: AbortSignal.timeout(25_000),
        headers: { accept: "text/html,text/csv,text/plain,*/*" },
      });
    } catch {
      throw new ErrorDeDominio("sat_no_disponible");
    }
    if (recibida.status < 300 || recibida.status > 399) {
      respuesta = recibida;
      actual = permitida;
      break;
    }
    const destino = recibida.headers.get("location");
    await recibida.body?.cancel().catch(() => undefined);
    if (!destino || saltos >= TOPE_SALTOS) throw new ErrorDeDominio("sat_no_disponible");
    try {
      actual = new URL(destino, permitida).toString();
    } catch {
      throw new ErrorDeDominio("sat_no_disponible");
    }
  }
  if (!respuesta.ok || !aceptarFinal(actual)) throw new ErrorDeDominio("sat_no_disponible");
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
