import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { atenderAviso, clienteHttpFintoc, firmar, leerAviso, leerClabe, leerConfigFintoc, verificarFirma, type ConfigFintoc } from "./fintoc";

// Payloads copiados de la documentación oficial; su origen está en tests/cobranza/fixtures/fintoc/LEEME.md.
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../tests/cobranza/fixtures/fintoc");
const aviso = readFileSync(join(FIXTURES, "transfer-inbound-succeeded-mx.json"), "utf8");
const creada = JSON.parse(readFileSync(join(FIXTURES, "account-number-create-response.json"), "utf8")) as unknown;
const lista = JSON.parse(readFileSync(join(FIXTURES, "account-numbers-list-response.json"), "utf8")) as unknown[];

/** Llaves generadas al vuelo: nunca las de la documentación. */
function config(modo: "test" | "live" = "test"): ConfigFintoc {
  return { llaveSecreta: `sk_${modo}_${randomBytes(20).toString("hex")}`, secretoWebhook: randomBytes(32).toString("hex"), modo };
}
const bytes = (s: string) => new TextEncoder().encode(s);
const AHORA = 1_790_000_000;

describe("Fintoc: configuración", () => {
  it("sin las dos llaves queda apagado", () => {
    assert.deepEqual(leerConfigFintoc({}), { config: null, motivo: "sin_llaves" });
    assert.deepEqual(leerConfigFintoc({ FINTOC_SECRET_KEY: config().llaveSecreta }), { config: null, motivo: "sin_llaves" });
  });

  it("rechaza las llaves y secretos de ejemplo de la documentación", () => {
    const secreto = randomBytes(32).toString("hex");
    for (const llave of ["sk_test_0000000000000000", "sk_test_9c8d8CeyBTx1VcJzuDgpm4H", "sk_test_jKaHdEa3mfmP0D105H", "your_api_key", "sk_test_", "pk_live_abc123"]) {
      assert.equal(leerConfigFintoc({ FINTOC_SECRET_KEY: llave, FINTOC_WEBHOOK_SECRET: secreto }).config, null, llave);
    }
    for (const s of ["YOUR_WEBHOOK_SECRET", "...", "corto", "con espacio por enmedio"]) {
      assert.deepEqual(leerConfigFintoc({ FINTOC_SECRET_KEY: config().llaveSecreta, FINTOC_WEBHOOK_SECRET: s }), { config: null, motivo: "secreto_no_valido" });
    }
  });

  it("producción solo con sk_live_; preview y local solo con sk_test_", () => {
    const vivo = config("live");
    const prueba = config("test");
    const leer = (c: ConfigFintoc, VERCEL_ENV: string | undefined) =>
      leerConfigFintoc({ FINTOC_SECRET_KEY: c.llaveSecreta, FINTOC_WEBHOOK_SECRET: c.secretoWebhook, VERCEL_ENV });
    assert.deepEqual(leer(vivo, "production"), { config: vivo });
    assert.deepEqual(leer(prueba, "production"), { config: null, motivo: "llave_de_prueba_en_produccion" });
    for (const ambiente of ["preview", "development", undefined]) {
      assert.deepEqual(leer(prueba, ambiente), { config: prueba }, String(ambiente));
      assert.deepEqual(leer(vivo, ambiente), { config: null, motivo: "llave_real_fuera_de_produccion" }, String(ambiente));
    }
  });

  it("la llave literal de la documentación se rechaza en cualquier ambiente", () => {
    const secreto = randomBytes(32).toString("hex");
    for (const VERCEL_ENV of ["production", "preview", undefined]) {
      assert.deepEqual(
        leerConfigFintoc({ FINTOC_SECRET_KEY: "sk_test_jKaHdEa3mfmP0D105H", FINTOC_WEBHOOK_SECRET: secreto, VERCEL_ENV }),
        { config: null, motivo: "llave_no_valida" },
      );
    }
  });
});

describe("Fintoc: firma del aviso", () => {
  const { secretoWebhook } = config();

  it("acepta la firma válida dentro de los cinco minutos", () => {
    assert.equal(verificarFirma(bytes(aviso), firmar(aviso, secretoWebhook, AHORA), secretoWebhook, AHORA), "valida");
    assert.equal(verificarFirma(bytes(aviso), firmar(aviso, secretoWebhook, AHORA - 299), secretoWebhook, AHORA), "valida");
  });

  it("rechaza firma con otro secreto, v1 alterado, cuerpo cambiado o encabezado roto", () => {
    const buena = firmar(aviso, secretoWebhook, AHORA);
    assert.equal(verificarFirma(bytes(aviso), firmar(aviso, randomBytes(32).toString("hex"), AHORA), secretoWebhook, AHORA), "invalida");
    const alterada = buena.replace(/v1=(.)/, (_m, c: string) => `v1=${c === "0" ? "1" : "0"}`);
    assert.equal(verificarFirma(bytes(aviso), alterada, secretoWebhook, AHORA), "invalida");
    assert.equal(verificarFirma(bytes(aviso.replace("2864", "9864")), buena, secretoWebhook, AHORA), "invalida");
    for (const roto of [null, "", "t=abc,v1=00", `v1=${"0".repeat(64)}`, `t=${AHORA}`, "x".repeat(2000)]) {
      assert.equal(verificarFirma(bytes(aviso), roto, secretoWebhook, AHORA), "invalida");
    }
  });

  it("una firma válida de hace más de cinco minutos (o del futuro) es vieja", () => {
    assert.equal(verificarFirma(bytes(aviso), firmar(aviso, secretoWebhook, AHORA - 301), secretoWebhook, AHORA), "vieja");
    assert.equal(verificarFirma(bytes(aviso), firmar(aviso, secretoWebhook, AHORA + 301), secretoWebhook, AHORA), "vieja");
  });
});

describe("Fintoc: lectura del aviso (payload oficial)", () => {
  it("traduce transfer.inbound.succeeded al abono", () => {
    assert.deepEqual(leerAviso(JSON.parse(aviso)), {
      eventoId: "evt_a4xK32BanKWYn",
      tipo: "transfer.inbound.succeeded",
      modo: "test",
      abono: {
        idExterno: "fintoc:tr_jKaHD105H",
        montoCentavos: 2864,
        // 2020-04-17T05:12:41Z es la madrugada del 17 en el centro de México.
        recibidoEl: "2020-04-17",
        claveRastreo: "s2123423423324334",
        referencia: "130824",
        clabeOrdenante: "000000000000000000",
        nombreOrdenante: "Test Customer 1",
        cuentaId: "acc_Lq7dP901xZgA2B",
        cuentaNumeroId: "acno_Kasf91034gj1AD",
      },
    });
  });

  it("otro tipo de evento se acusa sin abono; uno que no cuadra no se lee", () => {
    const evento = JSON.parse(aviso) as Record<string, unknown>;
    assert.equal(leerAviso({ ...evento, type: "transfer.outbound.succeeded" })?.abono, null);
    const data = evento.data as Record<string, unknown>;
    assert.equal(leerAviso({ ...evento, data: { ...data, currency: "USD" } }), null);
    assert.equal(leerAviso({ ...evento, data: { ...data, amount: 28.64 } }), null);
    assert.equal(leerAviso({ ...evento, data: { ...data, direction: "outbound" } }), null);
    assert.equal(leerAviso({ ...evento, id: "no-es-evento" }), null);
    assert.equal(leerAviso([]), null);
  });

  it("descarta referencia, rastreo y CLABE ordenante que no tienen forma", () => {
    const evento = JSON.parse(aviso) as { data: Record<string, unknown> };
    const raro = { ...evento, data: { ...evento.data, reference_id: "ABC-1", tracking_key: "con espacio", counterparty: { account_number: "111111111111111111", account_type: "clabe", holder_name: "  Nombre   con  espacios " } } };
    const abono = leerAviso(raro)?.abono;
    assert.equal(abono?.referencia, null);
    assert.equal(abono?.claveRastreo, null);
    assert.equal(abono?.clabeOrdenante, null);
    assert.equal(abono?.nombreOrdenante, "Nombre con espacios");
  });
});

describe("Fintoc: CLABEs del proveedor", () => {
  it("la del ejemplo de lista se lee; la de la guía (dígito verificador inválido) no se guarda", () => {
    assert.deepEqual(leerClabe(lista[0]), { id: "acno_2daFu0zqqDtZGJaSi2TGI2Mm1nN", cuentaId: "acc_2hQ9vBmKpR7xLtZ3sWn1fJ4dGcA", numero: "646180111800000004", clienteId: null, borrada: false });
    assert.throws(() => leerClabe(creada), (e: unknown) => e instanceof ErrorDeDominio && e.codigo === "proveedor_no_disponible");
  });

  it("el cliente HTTP manda la llave tal cual, la llave de idempotencia y el id del cliente en metadata", async () => {
    const c = config();
    const vistas: { url: string; init: RequestInit }[] = [];
    const http = clienteHttpFintoc(c, async (url, init) => {
      vistas.push({ url, init });
      return Response.json(init.method === "GET" ? lista : { ...(lista[0] as object), metadata: { lever_cliente: "k1" } });
    });
    const nueva = await http.crearClabe("acc_2hQ9vBmKpR7xLtZ3sWn1fJ4dGcA", "e1", "k1", "lever-clabe-k1");
    assert.equal(nueva.clienteId, "k1");
    const crear = vistas[0]!;
    assert.equal(crear.url, "https://api.fintoc.com/v2/account_numbers");
    const encabezados = crear.init.headers as Record<string, string>;
    assert.equal(encabezados.Authorization, c.llaveSecreta);
    assert.equal(encabezados["Idempotency-Key"], "lever-clabe-k1");
    assert.deepEqual(JSON.parse(String(crear.init.body)), { account_id: "acc_2hQ9vBmKpR7xLtZ3sWn1fJ4dGcA", description: "Cobranza Lever", metadata: { lever_empresa: "e1", lever_cliente: "k1" } });
    await http.listarClabes("acc_2hQ9vBmKpR7xLtZ3sWn1fJ4dGcA", "acno_x1");
    assert.equal(vistas[1]!.url, "https://api.fintoc.com/v2/account_numbers?account_id=acc_2hQ9vBmKpR7xLtZ3sWn1fJ4dGcA&limit=300&starting_after=acno_x1");
  });

  it("un error del proveedor o la red caída es «proveedor no disponible»", async () => {
    const caido = clienteHttpFintoc(config(), async () => new Response("{}", { status: 500 }));
    await assert.rejects(caido.listarClabes("acc_a", null), (e: unknown) => e instanceof ErrorDeDominio && e.codigo === "proveedor_no_disponible");
    const sinRed = clienteHttpFintoc(config(), async () => { throw new TypeError("fetch failed"); });
    await assert.rejects(sinRed.crearClabe("acc_a", "e", "k", "l"), (e: unknown) => e instanceof ErrorDeDominio && e.codigo === "proveedor_no_disponible");
  });
});

describe("Fintoc: ruta del aviso sin base", () => {
  const deps = (c: ConfigFintoc | null) => ({ config: c, ahora: () => new Date(AHORA * 1000), auditar: async () => {} });

  it("apagado responde 404; muy grande 413; firma inválida o vieja 400", async () => {
    assert.equal((await atenderAviso(bytes(aviso), null, deps(null))).estado, 404);
    const c = config();
    assert.equal((await atenderAviso(new Uint8Array(64 * 1024 + 1), null, deps(c))).estado, 413);
    assert.equal((await atenderAviso(bytes(aviso), firmar(aviso, "otro-secreto-de-prueba", AHORA), deps(c))).estado, 400);
    assert.equal((await atenderAviso(bytes(aviso), firmar(aviso, c.secretoWebhook, AHORA - 600), deps(c))).estado, 400);
  });

  it("otro tipo de evento o de otro modo se acusa con 200 sin tocar la base", async () => {
    const c = config("live");
    const otro = aviso.replace("transfer.inbound.succeeded", "transfer.outbound.succeeded");
    assert.deepEqual(await atenderAviso(bytes(otro), firmar(otro, c.secretoWebhook, AHORA), deps(c)), { estado: 200, cuerpo: { ok: true, efecto: "ignorado" } });
    // El fixture es de modo test y la llave de live: no se procesa.
    assert.deepEqual(await atenderAviso(bytes(aviso), firmar(aviso, c.secretoWebhook, AHORA), deps(c)), { estado: 200, cuerpo: { ok: true, efecto: "ignorado" } });
  });
});
