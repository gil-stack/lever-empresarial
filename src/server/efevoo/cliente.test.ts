import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { clienteHttpEfevoo, codigoDeEstado, type Fetch } from "./cliente";
import { leerConfigEfevoo, type ConfigEfevoo } from "./config";
import { esErrorEfevoo, ErrorEfevoo } from "./errores";

const AQUI = dirname(fileURLToPath(import.meta.url));
const CONTRATO = join(AQUI, "../../../tests/efevoo/contrato");
/** El cuerpo real (redactado) que dio el sandbox para ese caso. */
function contrato(nombre: string): unknown {
  return (JSON.parse(readFileSync(join(CONTRATO, `${nombre}.json`), "utf8")) as { cuerpo: unknown }).cuerpo;
}

const CONFIG: ConfigEfevoo = { url: "https://efevoo.prueba/v1/apiservice", usuario: "usuario-de-prueba", llave: "llave-de-prueba-123", ambiente: "sandbox" };

type Llamada = { url: string; cuerpo: string; encabezados: Record<string, string> };
function falso(respuestas: (() => Response | Promise<Response>)[]): { fetch: Fetch; llamadas: Llamada[] } {
  const llamadas: Llamada[] = [];
  const fetch: Fetch = async (url, init) => {
    llamadas.push({ url, cuerpo: String(init.body), encabezados: init.headers as Record<string, string> });
    const siguiente = respuestas.shift();
    if (!siguiente) throw new Error("sin respuesta preparada");
    return siguiente();
  };
  return { fetch, llamadas };
}
const json = (cuerpo: unknown, estado = 200) => () => new Response(JSON.stringify(cuerpo), { status: estado });
async function rechazo(p: Promise<unknown>): Promise<ErrorEfevoo> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof ErrorEfevoo, String(e));
    return e;
  }
  assert.fail("debía fallar");
}

describe("Efevoo: status.code", () => {
  it("se normaliza: número y texto son lo mismo", () => {
    assert.equal(codigoDeEstado({ status: { code: 0 } }), "0");
    assert.equal(codigoDeEstado({ status: { code: "0" } }), "0");
    assert.equal(codigoDeEstado({ status: { code: " 901 " } }), "901");
    assert.equal(codigoDeEstado({ status: { code: 1 } }), "1");
    assert.equal(codigoDeEstado({ status: {} }), null);
    assert.equal(codigoDeEstado({ status: { code: "OK" } }), null);
  });
});

describe("Efevoo: cliente HTTP", () => {
  it("manda method y payload al endpoint con X-API-USER y X-API-KEY", async () => {
    const f = falso([json(contrato("createClient"))]);
    const r = await clienteHttpEfevoo(CONFIG, f.fetch).crearCliente({ correo: "empresa@lever.test", razonSocial: "Empresa de prueba" });
    assert.deepEqual(r, { idepCliente: 206 });
    assert.equal(f.llamadas[0]!.url, CONFIG.url);
    assert.equal(f.llamadas[0]!.encabezados["X-API-USER"], CONFIG.usuario);
    assert.equal(f.llamadas[0]!.encabezados["X-API-KEY"], CONFIG.llave);
    const cuerpo = JSON.parse(f.llamadas[0]!.cuerpo) as { method: string; payload: { email: string; comercio: { email: string; razonSocial: string } } };
    assert.equal(cuerpo.method, "createClient");
    assert.equal(cuerpo.payload.email, "empresa@lever.test");
    assert.equal(cuerpo.payload.comercio.email, "empresa@lever.test");
  });

  it("el monto viaja como el número exacto de los centavos", async () => {
    const f = falso([json(contrato("fundCard-560"))]);
    await clienteHttpEfevoo(CONFIG, f.fetch).cargarTarjeta(560, "t@lever.test", 123456789, "9100002", "carga");
    assert.match(f.llamadas[0]!.cuerpo, /"amount":1234567\.89[,}]/);
    const f2 = falso([json(contrato("fundCard-560"))]);
    await clienteHttpEfevoo(CONFIG, f2.fetch).cargarTarjeta(560, "t@lever.test", 100, "9100002", "carga");
    assert.match(f2.llamadas[0]!.cuerpo, /"amount":1\.00[,}]/);
  });

  it("código distinto de 0 es un rechazo con el código de Efevoo (901, 101, texto «1»)", async () => {
    for (const [caso, codigo] of [["getCompanyBalance", "901"], ["assignCard-4dig", "101"], ["createClient-duplicado", "1"], ["cardBlocker-inexistente", "115"]] as const) {
      const f = falso([json(contrato(caso))]);
      const e = await rechazo(clienteHttpEfevoo(CONFIG, f.fetch).bloquearTarjeta(1, "t@lever.test", "block"));
      assert.equal(e.codigo, "efevoo_rechazo", caso);
      assert.equal(e.codigoEfevoo, codigo, caso);
    }
  });

  it("una validación sin status (la referencia mal formada) es un rechazo", async () => {
    const f = falso([json(contrato("fundCard-inexistente"))]);
    const e = await rechazo(clienteHttpEfevoo(CONFIG, f.fetch).retirarTarjeta(1, "t@lever.test", 1, "9100001", "x"));
    assert.equal(e.codigo, "efevoo_rechazo");
    assert.equal(e.codigoEfevoo, "validacion");
  });

  it("«Operación realizada correctamente» con id 0 es un rechazo, no un éxito", async () => {
    const f = falso([json(contrato("fundCard-correo-malo"))]);
    const e = await rechazo(clienteHttpEfevoo(CONFIG, f.fetch).cargarTarjeta(560, "otro@lever.test", 1, "9100006", "x"));
    assert.equal(e.codigo, "efevoo_rechazo");
    assert.equal(e.codigoEfevoo, "id_cero");
  });

  it("HTTP 401 es efevoo_no_autorizado", async () => {
    const f = falso([json(contrato("activateCard-invalida"), 401)]);
    const e = await rechazo(clienteHttpEfevoo(CONFIG, f.fetch).activarTarjeta(1, "t@lever.test"));
    assert.equal(e.codigo, "efevoo_no_autorizado");
  });

  it("5xx, respuesta ilegible y sin respuesta son efevoo_incierto", async () => {
    for (const [respuesta, codigo] of [
      [() => new Response("<html>bad gateway</html>", { status: 502 }), "http_502"],
      [() => new Response("<html>ok</html>", { status: 200 }), "ilegible"],
      [() => new Response("[1,2]", { status: 200 }), "ilegible"],
      [() => Promise.reject(new TypeError("fetch failed")), "sin_respuesta"],
    ] as const) {
      const f = falso([respuesta]);
      const e = await rechazo(clienteHttpEfevoo(CONFIG, f.fetch).cargarTarjeta(1, "t@lever.test", 100, "9100007", "x"));
      assert.equal(e.codigo, "efevoo_incierto", codigo);
      assert.equal(e.codigoEfevoo, codigo);
    }
  });

  it("un timeout deja la operación incierta y no reintenta", async () => {
    const llamadas: number[] = [];
    const colgado: Fetch = (_url, init) => {
      llamadas.push(1);
      return new Promise((_ok, mal) => init.signal?.addEventListener("abort", () => mal(new DOMException("abortada", "AbortError"))));
    };
    const e = await rechazo(clienteHttpEfevoo(CONFIG, colgado, 30).retirarTarjeta(1, "t@lever.test", 100, "9100008", "x"));
    assert.equal(e.codigo, "efevoo_incierto");
    assert.equal(e.codigoEfevoo, "timeout");
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(llamadas.length, 1, "sin reintento automático");
  });

  it("la referencia es de exactamente 7 dígitos: otra forma ni se manda", async () => {
    for (const ref of ["123456", "12345678", "E1T0001", "123 456", ""]) {
      const f = falso([]);
      await assert.rejects(clienteHttpEfevoo(CONFIG, f.fetch).cargarTarjeta(1, "t@lever.test", 100, ref, "x"), /referencia_invalida/);
      assert.equal(f.llamadas.length, 0, ref);
    }
  });

  it("lee el inventario real: 5 en inStock, terminación de 4, sin datos personales", async () => {
    const f = falso([json(contrato("getCardsList-vacio"))]);
    const lista = await clienteHttpEfevoo(CONFIG, f.fetch).listarTarjetas({ estados: "todas", pagina: 1, tamano: 50 });
    assert.equal(lista.total, 15);
    assert.equal(lista.tarjetas.length, 15);
    assert.deepEqual(lista.tarjetas.filter((t) => t.estado === "inStock").map((t) => t.id), [557, 563, 564, 567, 568]);
    const t560 = lista.tarjetas.find((t) => t.id === 560)!;
    assert.deepEqual(t560, { id: 560, terminacion: "6509", estado: "active", saldoCentavos: 50000, idepCliente: 19, producto: 16, subproducto: 19, conTitular: true });
    for (const t of lista.tarjetas) {
      assert.deepEqual(Object.keys(t).sort(), ["conTitular", "estado", "id", "idepCliente", "producto", "saldoCentavos", "subproducto", "terminacion"]);
    }
    assert.deepEqual(JSON.parse(f.llamadas[0]!.cuerpo).payload.status, []);
  });

  it("acepta «inactive» (asignada sin activar), que el sandbox devuelve con status vacío", async () => {
    const crudo = contrato("getCardsList-vacio") as { response: { cards: { id: number; status: string }[] } };
    for (const c of crudo.response.cards) if (c.id === 556 || c.id === 557) c.status = "inactive";
    const lista = await clienteHttpEfevoo(CONFIG, falso([json(crudo)]).fetch).listarTarjetas({ estados: "todas", pagina: 1, tamano: 50 });
    assert.deepEqual(lista.tarjetas.filter((t) => t.estado === "inactive").map((t) => t.id), [556, 557]);
  });

  it("lee los movimientos de una tarjeta con su referencia y montos en texto o número", async () => {
    const f = falso([json(contrato("getTransactionsCard-560-b"))]);
    const m = await clienteHttpEfevoo(CONFIG, f.fetch).movimientosDeTarjeta(560, "t@lever.test");
    assert.deepEqual(m.map((x) => [x.referencia, x.centavos]), [["9100002", 1], ["9100002", 101], ["1234567", 50000]]);
  });

  it("lee el tipo del movimiento real: Abono es carga y Cargo es retiro, importe sin signo en texto (lectura de -03)", async () => {
    const f = falso([json(contrato("getTransactionsCard-560-tras-retiros"))]);
    const m = await clienteHttpEfevoo(CONFIG, f.fetch).movimientosDeTarjeta(560, "t@lever.test");
    const porRef = (r: string) => m.filter((x) => x.referencia === r).map((x) => [x.idMovimiento, x.tipo, x.centavos, x.concepto, x.fechaHora]);
    assert.deepEqual(porRef("9100003"), [["4528", "cargo", 102, "DEVOLUCIÓN PAGO A TARJETA", "2026-11-11 22:37:22"]]);
    assert.deepEqual(porRef("9100005"), [["4530", "abono", 99_999_900, "PAGO A TARJETA", "2026-11-11 22:37:28"]]);
    assert.equal(m.find((x) => x.referencia === "9100004")?.saldoDespuesCentavos, -99_949_900);
  });

  it("recién hecho, sin TipoMovimientoCargoAbono: el tipo sale del concepto (captura -b de -06, E1-10)", async () => {
    const f = falso([json(contrato("getTransactionsCard-560-b"))]);
    const m = await clienteHttpEfevoo(CONFIG, f.fetch).movimientosDeTarjeta(560, "t@lever.test");
    assert.deepEqual(m.filter((x) => x.referencia === "9100002").map((x) => [x.idMovimiento, x.tipo, x.centavos]), [["4527", "abono", 1], ["4526", "abono", 101]]);
  });

  it("unas observaciones iguales a cualquier texto no mueven el monto de lugar", async () => {
    for (const obs of ["__monto_lever__", "\"amount\":1", "}}"]) {
      const f = falso([json(contrato("fundCard-560"))]);
      await clienteHttpEfevoo(CONFIG, f.fetch).cargarTarjeta(560, "t@lever.test", 1234, "9100002", obs);
      const cuerpo = JSON.parse(f.llamadas[0]!.cuerpo) as { payload: { amount: unknown; observations: unknown } };
      assert.equal(cuerpo.payload.amount, 12.34, obs);
      assert.equal(cuerpo.payload.observations, obs);
      assert.match(f.llamadas[0]!.cuerpo, /"amount":12\.34\}\}$/);
    }
  });

  it("lee los movimientos del saldo de la empresa", async () => {
    const f = falso([json(contrato("balanceMovements-19"))]);
    const m = await clienteHttpEfevoo(CONFIG, f.fetch).movimientosCliente(19, 1, 5);
    assert.equal(m[0]!.centavos, 40000);
    assert.equal(m[0]!.operacion, "deposit");
    assert.equal(m[0]!.saldoPrevioCentavos, 444043);
  });
});

describe("Efevoo: getCardData no existe", () => {
  it("el cliente no tiene un método que lo llame", () => {
    const cliente = clienteHttpEfevoo(CONFIG, falso([]).fetch) as unknown as Record<string, unknown>;
    for (const nombre of Object.keys(cliente)) assert.doesNotMatch(nombre, /carddata|datosdetarjeta|numero/i, nombre);
  });

  it("ningún archivo de src manda el método getCardData, depositCard ni withdrawalCard", () => {
    const prohibido = /["'`](getCardData|depositCard|withdrawalCard)["'`]/;
    const revisar = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const ruta = join(dir, n);
        if (statSync(ruta).isDirectory()) return revisar(ruta);
        return /\.(ts|tsx|mjs|js)$/.test(n) && !n.endsWith(".test.ts") && prohibido.test(readFileSync(ruta, "utf8")) ? [ruta] : [];
      });
    assert.deepEqual(revisar(join(AQUI, "../..")), []);
  });
});

describe("Efevoo: configuración", () => {
  const base = { EFEVOO_URL: "https://test-intgapi.efevoopay.com", EFEVOO_API_USER: "usuario", EFEVOO_API_KEY: "llave-larga-1", EFEVOO_AMBIENTE: "sandbox" };

  it("sin configuración queda apagado: Tarjetas sigue como antes", () => {
    assert.deepEqual(leerConfigEfevoo({}), { config: null, motivo: "sin_configuracion" });
    assert.deepEqual(leerConfigEfevoo({ ...base, EFEVOO_API_KEY: "" }), { config: null, motivo: "sin_configuracion" });
  });

  it("completa la ruta del servicio", () => {
    assert.equal(leerConfigEfevoo(base).config?.url, "https://test-intgapi.efevoopay.com/v1/apiservice");
    assert.equal(leerConfigEfevoo({ ...base, EFEVOO_URL: "https://test-intgapi.efevoopay.com/v1/apiservice/" }).config?.url, "https://test-intgapi.efevoopay.com/v1/apiservice");
  });

  it("producción solo con produccion; fuera de producción solo sandbox", () => {
    assert.equal(leerConfigEfevoo({ ...base, VERCEL_ENV: "production" }).config, null);
    assert.equal(leerConfigEfevoo({ ...base, EFEVOO_AMBIENTE: "produccion" }).config, null);
    assert.equal(leerConfigEfevoo({ ...base, EFEVOO_AMBIENTE: "produccion", VERCEL_ENV: "production" }).config?.ambiente, "produccion");
    assert.equal(leerConfigEfevoo({ ...base, EFEVOO_AMBIENTE: "pruebas" }).config, null);
  });

  it("http solo hacia el Efevoo falso local y solo en sandbox", () => {
    assert.equal(leerConfigEfevoo({ ...base, EFEVOO_URL: "http://127.0.0.1:4897" }).config?.url, "http://127.0.0.1:4897/v1/apiservice");
    assert.equal(leerConfigEfevoo({ ...base, EFEVOO_URL: "http://efevoo.com" }).config, null);
    assert.equal(leerConfigEfevoo({ ...base, EFEVOO_URL: "http://127.0.0.1:4897", EFEVOO_AMBIENTE: "produccion", VERCEL_ENV: "production" }).config, null);
  });

  it("rechaza los valores de ejemplo de la colección", () => {
    assert.equal(leerConfigEfevoo({ ...base, EFEVOO_API_USER: "Efevoo Pay" }).config, null);
    assert.equal(leerConfigEfevoo({ ...base, EFEVOO_API_KEY: "User Key" }).config, null);
  });

  it("el error de dominio se reconoce por su código", () => {
    assert.equal(esErrorEfevoo(new ErrorEfevoo("efevoo_incierto", "timeout"), "efevoo_incierto"), true);
    assert.equal(esErrorEfevoo(new Error("x")), false);
  });
});
