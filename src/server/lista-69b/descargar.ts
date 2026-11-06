import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

import { PAGINA_LISTADO_69B, urlPublica } from "../../dominio/lista-69b";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";

const TOPE_PAGINA = 1_000_000;
const TOPE_ARCHIVO = 20_000_000;
/** Redirecciones que se siguen, una por una y validando cada destino, antes de rendirse. */
export const TOPE_SALTOS = 5;

type Fetch = (url: string, init: RequestInit) => Promise<Response>;
/** Direcciones IP a las que resuelve un host. */
export type ResolverDns = (host: string) => Promise<string[]>;

const resolverDelSistema: ResolverDns = async (host) => (await lookup(host, { all: true })).map((d) => d.address);

/**
 * Lo que no es internet público: privadas, loopback, link-local, CGNAT, ULA,
 * sin especificar, multicast y reservadas, en v4 y v6 (las v4 dentro de v6
 * también caen aquí).
 */
const NO_PUBLICAS = new BlockList();
for (const [red, prefijo] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  NO_PUBLICAS.addSubnet(red, prefijo, "ipv4");
}
for (const [red, prefijo] of [
  ["::", 128],
  ["::1", 128],
  ["fe80::", 10],
  ["fc00::", 7],
  ["ff00::", 8],
] as const) {
  NO_PUBLICAS.addSubnet(red, prefijo, "ipv6");
}

export function esDireccionPublica(ip: string): boolean {
  const mapeada = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/iu.exec(ip)?.[1];
  const direccion = mapeada ?? ip;
  const familia = isIP(direccion);
  if (familia === 0) return false;
  return !NO_PUBLICAS.check(direccion, familia === 4 ? "ipv4" : "ipv6");
}

export type OrigenListado = {
  leerPagina: () => Promise<string>;
  leerArchivo: (url: string) => Promise<Uint8Array>;
};

/**
 * Solo hosts del SAT, por https al puerto de siempre, sin credenciales ni IP.
 * Cada salto de una redirección se valida aquí ANTES de pedirlo: el servidor
 * nunca toca una dirección interna aunque el SAT (o quien se haga pasar por
 * él) redirija.
 */
export function direccionDelSat(href: string): string | null {
  const publica = urlPublica(href, PAGINA_LISTADO_69B);
  if (!publica) return null;
  const url = new URL(publica);
  // URL ya quita «:443» en https: cualquier puerto que quede es otro.
  if (url.port !== "") return null;
  const host = url.hostname.toLowerCase().replace(/\.$/u, "");
  return host === "sat.gob.mx" || host.endsWith(".sat.gob.mx") ? publica : null;
}

export function origenSat(hacerFetch: Fetch = fetch, resolver: ResolverDns = resolverDelSistema): OrigenListado {
  const citada = new URL(PAGINA_LISTADO_69B);
  return {
    async leerPagina() {
      const bytes = await leerBytes(PAGINA_LISTADO_69B, TOPE_PAGINA, hacerFetch, resolver, (final) => {
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
      return leerBytes(url, TOPE_ARCHIVO, hacerFetch, resolver, () => true);
    },
  };
}

/**
 * Un host del SAT que resuelve a una dirección interna no se pide. Queda la
 * ventana entre esta resolución y la de fetch; para usarla haría falta
 * controlar el DNS de sat.gob.mx.
 */
async function exigirResolucionPublica(href: string, resolver: ResolverDns): Promise<void> {
  let direcciones: string[];
  try {
    direcciones = await resolver(new URL(href).hostname);
  } catch {
    throw new ErrorDeDominio("sat_no_disponible");
  }
  if (direcciones.length === 0 || !direcciones.every(esDireccionPublica)) throw new ErrorDeDominio("sat_no_disponible");
}

async function leerBytes(
  url: string,
  tope: number,
  hacerFetch: Fetch,
  resolver: ResolverDns,
  aceptarFinal: (url: string) => boolean,
): Promise<Uint8Array> {
  let actual = url;
  let respuesta: Response | null = null;
  for (let saltos = 0; respuesta === null; saltos += 1) {
    const permitida = direccionDelSat(actual);
    if (!permitida) throw new ErrorDeDominio("sat_no_disponible");
    await exigirResolucionPublica(permitida, resolver);
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
