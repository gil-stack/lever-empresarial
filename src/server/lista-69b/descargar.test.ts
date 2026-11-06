import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PAGINA_LISTADO_69B } from "../../dominio/lista-69b.ts";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio.ts";
import { direccionDelSat, esDireccionPublica, origenSat, TOPE_SALTOS } from "./descargar.ts";

const ARCHIVO = "https://omawww.sat.gob.mx/cifras_sat/Documents/Listado_Completo_69-B.csv";

/** DNS de mentira: todo resuelve a una dirección pública. */
const dnsPublico = async () => ["200.57.3.10"];

/** fetch de mentira: responde por URL y anota cada dirección que el servidor pidió. */
function redSimulada(respuestas: Record<string, () => Response>) {
  const pedidas: string[] = [];
  const opciones: RequestInit[] = [];
  const hacerFetch = async (url: string, init: RequestInit) => {
    pedidas.push(url);
    opciones.push(init);
    const responder = respuestas[url];
    if (!responder) throw new Error(`pidió una dirección no prevista: ${url}`);
    return responder();
  };
  return { hacerFetch, pedidas, opciones };
}

function redirige(destino: string, estado = 302): () => Response {
  return () => new Response(null, { status: estado, headers: { location: destino } });
}

function contenido(texto: string): () => Response {
  return () => new Response(texto, { status: 200, headers: { "content-type": "text/csv" } });
}

async function codigoDe(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
  } catch (error) {
    if (error instanceof ErrorDeDominio) return error.codigo;
    throw error;
  }
  return "ok";
}

describe("descarga de la 69-B sin SSRF", () => {
  it("solo acepta hosts del SAT por https, sin credenciales ni IP", () => {
    assert.equal(direccionDelSat(ARCHIVO), ARCHIVO);
    assert.equal(direccionDelSat("https://sat.gob.mx/x.csv"), "https://sat.gob.mx/x.csv");
    for (const ajena of [
      "http://omawww.sat.gob.mx/x.csv",
      "https://sat.gob.mx.atacante.com/x.csv",
      "https://atacantesat.gob.mx/x.csv",
      "https://169.254.169.254/latest/meta-data/",
      "https://localhost/x.csv",
      "https://usuario:clave@omawww.sat.gob.mx/x.csv",
      "https://ejemplo.com/x.csv",
    ]) {
      assert.equal(direccionDelSat(ajena), null, ajena);
    }
  });

  it("no sigue una redirección fuera del SAT: la valida antes de pedirla", async () => {
    const red = redSimulada({ [ARCHIVO]: redirige("http://169.254.169.254/latest/meta-data/") });
    assert.equal(await codigoDe(origenSat(red.hacerFetch, dnsPublico).leerArchivo(ARCHIVO)), "sat_no_disponible");
    assert.deepEqual(red.pedidas, [ARCHIVO]);
    assert.equal(red.opciones[0]?.redirect, "manual");

    const interna = redSimulada({ [ARCHIVO]: redirige("https://intranet.local/secreto") });
    assert.equal(await codigoDe(origenSat(interna.hacerFetch, dnsPublico).leerArchivo(ARCHIVO)), "sat_no_disponible");
    assert.deepEqual(interna.pedidas, [ARCHIVO]);
  });

  it("sigue saltos dentro del SAT, relativos incluidos, y lee el archivo final", async () => {
    const segundo = "https://wwwmat.sat.gob.mx/descargas/69b.csv";
    const red = redSimulada({
      [ARCHIVO]: redirige(segundo, 301),
      [segundo]: redirige("/descargas/69b-final.csv", 307),
      "https://wwwmat.sat.gob.mx/descargas/69b-final.csv": contenido("RFC,Situación\n"),
    });
    const bytes = await origenSat(red.hacerFetch, dnsPublico).leerArchivo(ARCHIVO);
    assert.equal(new TextDecoder().decode(bytes), "RFC,Situación\n");
    assert.equal(red.pedidas.length, 3);
    assert.ok(red.opciones.every((opcion) => opcion.redirect === "manual"));
  });

  it("se rinde después del tope de saltos", async () => {
    const respuestas: Record<string, () => Response> = {};
    for (let i = 0; i <= TOPE_SALTOS + 1; i += 1) {
      const actual = i === 0 ? ARCHIVO : `https://omawww.sat.gob.mx/salto-${i}.csv`;
      respuestas[actual] = redirige(`https://omawww.sat.gob.mx/salto-${i + 1}.csv`);
    }
    const red = redSimulada(respuestas);
    assert.equal(await codigoDe(origenSat(red.hacerFetch, dnsPublico).leerArchivo(ARCHIVO)), "sat_no_disponible");
    assert.equal(red.pedidas.length, TOPE_SALTOS + 1);
  });

  it("un enlace del archivo fuera del SAT no se pide; la página debe terminar en la página citada", async () => {
    const red = redSimulada({});
    assert.equal(await codigoDe(origenSat(red.hacerFetch, dnsPublico).leerArchivo("https://ejemplo.com/69b.csv")), "url_fuera_del_sat");
    assert.equal(await codigoDe(origenSat(red.hacerFetch, dnsPublico).leerArchivo("https://10.0.0.1/69b.csv")), "url_no_publica");
    assert.deepEqual(red.pedidas, []);

    const otraPagina = redSimulada({ [PAGINA_LISTADO_69B]: redirige("https://www.sat.gob.mx/portal/otra.html") , "https://www.sat.gob.mx/portal/otra.html": contenido("<html></html>") });
    assert.equal(await codigoDe(origenSat(otraPagina.hacerFetch, dnsPublico).leerPagina()), "sat_no_disponible");
  });

  it("solo el puerto de siempre: otro puerto explícito no es del SAT", () => {
    assert.equal(direccionDelSat("https://omawww.sat.gob.mx:443/x.csv"), "https://omawww.sat.gob.mx/x.csv");
    for (const otro of ["https://omawww.sat.gob.mx:8443/x.csv", "https://omawww.sat.gob.mx:22/x.csv", "https://sat.gob.mx:80/x.csv"]) {
      assert.equal(direccionDelSat(otro), null, otro);
    }
  });

  it("no pide un host del SAT que resuelve a una dirección interna, ni en un salto", async () => {
    for (const interna of [
      "10.0.0.5",
      "172.20.1.1",
      "192.168.1.10",
      "127.0.0.1",
      "0.0.0.0",
      "169.254.169.254",
      "100.64.0.1",
      "::1",
      "::",
      "fe80::1",
      "fd12:3456::1",
      "fc00::1",
      "::ffff:10.0.0.5",
      "::ffff:127.0.0.1",
    ]) {
      assert.equal(esDireccionPublica(interna), false, interna);
      const red = redSimulada({ [ARCHIVO]: contenido("RFC\n") });
      assert.equal(await codigoDe(origenSat(red.hacerFetch, async () => [interna]).leerArchivo(ARCHIVO)), "sat_no_disponible", interna);
      assert.deepEqual(red.pedidas, [], interna);
    }
    // Una sola dirección interna entre varias basta para no pedir.
    const mezcla = redSimulada({ [ARCHIVO]: contenido("RFC\n") });
    assert.equal(await codigoDe(origenSat(mezcla.hacerFetch, async () => ["200.57.3.10", "10.0.0.5"]).leerArchivo(ARCHIVO)), "sat_no_disponible");
    assert.deepEqual(mezcla.pedidas, []);

    // El primer salto resuelve bien; el segundo host apunta adentro y no se pide.
    const segundo = "https://interno.sat.gob.mx/69b.csv";
    const red = redSimulada({ [ARCHIVO]: redirige(segundo), [segundo]: contenido("RFC\n") });
    const dns = async (host: string) => (host === "interno.sat.gob.mx" ? ["192.168.0.7"] : ["200.57.3.10"]);
    assert.equal(await codigoDe(origenSat(red.hacerFetch, dns).leerArchivo(ARCHIVO)), "sat_no_disponible");
    assert.deepEqual(red.pedidas, [ARCHIVO]);

    for (const publica of ["200.57.3.10", "8.8.8.8", "2001:4860:4860::8888"]) assert.equal(esDireccionPublica(publica), true, publica);
    assert.equal(esDireccionPublica("no-es-ip"), false);
  });

  it("si el DNS falla o no devuelve nada, no se pide", async () => {
    const red = redSimulada({ [ARCHIVO]: contenido("RFC\n") });
    assert.equal(await codigoDe(origenSat(red.hacerFetch, async () => []).leerArchivo(ARCHIVO)), "sat_no_disponible");
    assert.equal(
      await codigoDe(origenSat(red.hacerFetch, async () => Promise.reject(new Error("ENOTFOUND"))).leerArchivo(ARCHIVO)),
      "sat_no_disponible",
    );
    assert.deepEqual(red.pedidas, []);
  });
});
