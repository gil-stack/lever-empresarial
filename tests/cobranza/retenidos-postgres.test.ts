import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { cerrarConexion } from "../../src/nucleo/db.ts";
import { ErrorDeDominio } from "../../src/nucleo/error-de-dominio.ts";
import { darDeAltaComoDuena } from "../../scripts/empresa-por-la-duena.ts";
import { auditar } from "../../src/server/bitacora/auditar.ts";
import { atenderAviso, firmar, procesarRetenidos, registrarCuentaFintoc, type ConfigFintoc } from "../../src/server/cobranza/fintoc.ts";
import { prepararEstadoDeCuenta } from "../../src/server/cobranza/estado-cuenta.ts";
import { configurarCobranza, darDeAltaCliente, registrarPagoManual, type DependenciasCobranza } from "../../src/server/cobranza/servicio.ts";
import { correrCobranza } from "../../src/server/cobranza/tarea.ts";
import { leerBandejaCumplimiento } from "../../src/server/operacion/cumplimiento.ts";
import { decidirCambioDeSuspension, solicitarCambioDeSuspension } from "../../src/server/operacion/suspensiones.ts";
import { contextoDePersonal } from "../../src/server/plataforma/servicio.ts";
import { personal, SESION_SOFIPO } from "../operacion/apoyo-alta-regulada.ts";
import { administrador, CLABE_EMPRESA, contar, HOY, sembrarPersonal } from "./siembra.ts";
import { aplicarArchivo, conBaseDesechable, consultarJson, ejecutar, exigirBaseDesechable, urlDeAplicacion } from "../aislamiento/postgres.ts";

/**
 * r63i-N1 (decisión de Gil): un aviso de Fintoc a una empresa suspendida se retiene sin aplicarse, con 200, su evento
 * en la bitácora y su renglón en la bandeja de Cumplimiento; el reintento no lo duplica; al reactivar se aplica una
 * sola vez por el camino normal; y la carrera con la suspensión no lo pierde en ningún orden. Antes del arreglo el
 * aviso lanzaba `empresa_suspendida` (la ruta respondía 500) y no quedaba nada.
 */

const urlAdmin = process.env.AISLAMIENTO_DATABASE_URL?.trim() ?? "";
const ORI = "11111111-1111-4111-8111-11111111aaa1";
const APR = "11111111-1111-4111-8111-11111111aaa2";
const CUM = "11111111-1111-4111-8111-11111111aaa3";
const AUD = "11111111-1111-4111-8111-11111111aaa4";

describe("Cobranza: avisos de Fintoc a una empresa suspendida (r63i-N1)", { skip: urlAdmin.length === 0 }, () => {
  it("se retienen con 200, no se duplican, Cumplimiento los ve y al reactivar se aplican una vez", async () => {
    exigirBaseDesechable();
    await conBaseDesechable(urlAdmin, async (url) => {
      const dir = join(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");
      for (const archivo of readdirSync(dir).sort()) {
        if (archivo.endsWith(".sql")) aplicarArchivo(url, join(dir, archivo));
      }
      ejecutar(url, `do $$ begin execute format('alter database %I set timezone to %L', current_database(), 'UTC'); end $$;`);
      await cerrarConexion();
      const previo = process.env.DATABASE_URL;
      process.env.DATABASE_URL = urlDeAplicacion(url);
      try {
        await escenario(url);
      } finally {
        await cerrarConexion();
        if (previo === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = previo;
      }
    });
  });
});

function deps(): DependenciasCobranza {
  return {
    ahora: HOY,
    urlPublica: () => "https://lever.ejemplo.mx",
    enviador: () => async (m) => {
      assert.match(m.para, /@ejemplo\.mx$/);
      return { id: randomUUID() };
    },
    fintoc: null,
    registrar: () => {},
  };
}

const codigo = (esperado: string) => (e: unknown) => e instanceof ErrorDeDominio && e.codigo === esperado;

async function escenario(url: string): Promise<void> {
  sembrarPersonal(url);
  const operador = consultarJson<{ id: string }[]>(url, "select json_agg(x) from (select id from operators order by alta_en limit 1) x")[0]!.id;
  for (const [id, rol] of [[ORI, "originacion"], [APR, "aprobacion"], [CUM, "cumplimiento"], [AUD, "auditoria"]] as const) {
    ejecutar(url, `
      insert into users (id, nombre, correo) values ('${id}', '${rol}', '${rol}-retenidos@ejemplo.mx');
      insert into platform_staff (operator_id, user_id, estado) values ('${operador}', '${id}', 'activo');
      insert into platform_staff_roles (operator_id, user_id, rol) values ('${operador}', '${id}', '${rol}');`);
  }
  const ori = personal(operador, ORI, ["originacion"]);
  const apr = personal(operador, APR, ["aprobacion"]);
  const cum = personal(operador, CUM, ["cumplimiento"]);
  const aud = personal(operador, AUD, ["auditoria"]);
  const plataforma = await contextoDePersonal("personal-cobranza@ejemplo.mx");

  /** Una empresa con cobranza, un cliente con su cargo de $1,000.00 y su cuenta en Fintoc. */
  const empresa = async (rfc: string, regimen: string, nombre: string, cuenta: string) => {
    const alta = await darDeAltaComoDuena(url, plataforma, { rfc, razonSocial: nombre, codigoPostal: "06600", regimen, usoCfdi: "G03" }, { demostracion: false, corridoPor: "pruebas@ejemplo.mx" });
    const correo = `admin-${rfc.toLowerCase()}@ejemplo.mx`;
    const [admin, sesion] = await administrador(url, plataforma, alta, correo);
    await configurarCobranza(admin, {
      clabe: CLABE_EMPRESA, beneficiario: `${nombre} SA de CV`, correoContacto: `cobranza-${rfc.toLowerCase()}@ejemplo.mx`,
      emitirDiasAntes: "7", antesDias: "3", avisoElDia: "si", despuesCadaDias: "7", despuesTope: "3", envioAutomatico: "si",
    }, sesion, deps());
    const cliente = await darDeAltaCliente(admin, {
      nombre: "Colegio Retenido", rfc: "", correos: `pagos-${rfc.toLowerCase()}@ejemplo.mx`, concepto: "Renta de bodega",
      tipo: "fijo", monto: "1000.00", periodicidad: "mensual", primerVencimiento: "2026-11-15", fin: "", altaId: randomUUID(),
    }, deps());
    const cargo = consultarJson<{ id: string; referencia: string }[]>(url,
      `select json_agg(x) from (select id, referencia from collection_charges where customer_id = '${cliente.clienteId}') x`)[0]!;
    await registrarCuentaFintoc(plataforma, { empresaId: alta.id, cuentaId: cuenta });
    return { id: alta.id, admin, cargo, cuenta };
  };
  const alfa = await empresa("TCM010101AB1", "601", "Escuela Alfa Retenidos", "acc_RetenidosAlfa01");
  const beta = await empresa("CABL840215RF4", "612", "Taller Beta Retenidos", "acc_RetenidosBeta01");

  const cambiar = async (empresaId: string, tipo: "suspension" | "reactivacion") => {
    const formId = randomUUID();
    await solicitarCambioDeSuspension(tipo === "suspension" ? ori : cum, { companyId: empresaId, formId, tipo, motivo: "Revisión de Cumplimiento por operaciones" });
    const id = consultarJson<{ id: string }[]>(url, `select json_agg(x) from (select id from company_suspensions where company_id = '${empresaId}' and estado = 'pendiente') x`)[0]!.id;
    return decidirCambioDeSuspension(apr, SESION_SOFIPO, { id, aprobada: true, motivo: "" });
  };

  const configFintoc: ConfigFintoc = { llaveSecreta: `sk_test_${randomUUID().replace(/-/g, "")}`, secretoWebhook: createHash("sha256").update(randomUUID()).digest("hex"), modo: "test" };
  const ahoraSeg = Math.floor(Date.now() / 1000);
  const depsAviso = { config: configFintoc, ahora: () => new Date(ahoraSeg * 1000), auditar, enviador: deps().enviador, urlPublica: () => "https://lever.ejemplo.mx", registrar: () => {} };
  /** El cuerpo firmado de un abono a la cuenta de la empresa, con la referencia de su cargo. */
  const abono = (e: { cuenta: string; cargo: { referencia: string } }, monto = 100_000) => JSON.stringify({
    id: `evt_${randomUUID().replace(/-/g, "")}`, type: "transfer.inbound.succeeded", object: "event", mode: "test", created_at: new Date().toISOString(),
    data: {
      id: `tr_${randomUUID().replace(/-/g, "")}`, object: "transfer", direction: "inbound", status: "succeeded", amount: monto, currency: "MXN", mode: "test",
      transaction_date: "2026-11-10T17:00:00.000Z", reference_id: e.cargo.referencia, tracking_key: null,
      account_number: { id: `acno_Principal${e.cuenta.slice(4)}`, account_id: e.cuenta },
      counterparty: { holder_name: "Ordenante de prueba", account_number: null, account_type: "clabe" },
    },
  });
  const avisar = (cuerpo: string) => atenderAviso(new TextEncoder().encode(cuerpo), firmar(cuerpo, configFintoc.secretoWebhook, ahoraSeg), depsAviso);
  const cuenta = (sql: string) => contar(url, sql);
  const pagos = (empresaId: string) => cuenta(`select count(*) from collection_payments where company_id = '${empresaId}' and fuente = 'fintoc'`);
  const retenidos = (empresaId: string, estado = "retenido") => cuenta(`select count(*) from collection_held_events where company_id = '${empresaId}' and estado = '${estado}'`);

  // 1. Suspendida: el aviso queda retenido con 200, sin pago ni evento del proveedor, con su evento en la bitácora.
  await cambiar(alfa.id, "suspension");
  const cuerpo = abono(alfa);
  assert.deepEqual(await avisar(cuerpo), { estado: 200, cuerpo: { ok: true, efecto: "retenido" } });
  assert.equal(pagos(alfa.id), 0);
  assert.equal(retenidos(alfa.id), 1);
  assert.equal(cuenta(`select count(*) from collection_provider_events where company_id = '${alfa.id}'`), 0);
  const bitacora = consultarJson<{ cambio: Record<string, unknown>; actor_tipo: string }[]>(url,
    `select json_agg(x) from (select cambio, actor_tipo from audit_log where company_id = '${alfa.id}' and accion = 'retener_aviso_cobranza') x`);
  assert.deepEqual(bitacora, [{ cambio: { proveedor: "fintoc", tipo: "abono", monto_centavos: 100_000 }, actor_tipo: "sistema" }]);
  assert.doesNotMatch(JSON.stringify(bitacora), /Ordenante/, "la bitácora no lleva datos del ordenante");

  // 2. El reintento idéntico de Fintoc no duplica.
  assert.deepEqual(await avisar(cuerpo), { estado: 200, cuerpo: { ok: true, efecto: "repetido" } });
  assert.equal(retenidos(alfa.id), 1);
  assert.equal(cuenta(`select count(*) from audit_log where company_id = '${alfa.id}' and accion = 'retener_aviso_cobranza'`), 1);

  // 3. Cumplimiento lo ve en su bandeja; Auditoría también (solo lee); Originación no.
  const bandeja = await leerBandejaCumplimiento(cum);
  assert.deepEqual(bandeja.abonosRetenidos.map((r) => [r.razonSocial, r.montoCentavos, r.devolucion, r.empresaDeBaja, r.recibidoEl]),
    [["Escuela Alfa Retenidos", 100_000, false, false, "2026-11-10"]]);
  assert.equal((await leerBandejaCumplimiento(aud)).abonosRetenidos.length, 1);
  await assert.rejects(() => leerBandejaCumplimiento(ori), codigo("sin_permiso_operacion"));

  // 4. La propia empresa suspendida no escribe: ni pago a mano ni estado de cuenta.
  await assert.rejects(() => registrarPagoManual(alfa.admin, { altaId: randomUUID(), cargoId: alfa.cargo.id, monto: "1000.00", recibidoEl: "2026-11-10", claveRastreo: "RETENIDO01" }, null, deps()), codigo("empresa_suspendida"));
  const csv = ["Fecha,Concepto,Referencia,Cargo,Abono,Saldo", `10/11/2026,SPEI RECIBIDO,${alfa.cargo.referencia},,"1,000.00","1,000.00"`].join("\r\n");
  const empate = { banco: "banorte", empatar: "si", filaEncabezado: "0", columnaFecha: "0", columnaConcepto: "1", columnaReferencia: "2", columnaAbono: "4", columnaRastreo: "" };
  await assert.rejects(() => prepararEstadoDeCuenta(alfa.admin, empate, { nombre: "banorte.csv", bytes: new TextEncoder().encode(csv) }, deps()), codigo("empresa_suspendida"));
  assert.equal(cuenta(`select count(*) from collection_payments where company_id = '${alfa.id}'`), 0);

  // 5. La tarea diaria no toca a la suspendida: el retenido sigue ahí.
  await correrCobranza({ ahora: HOY, auditar, enviador: deps().enviador, urlPublica: () => "https://lever.ejemplo.mx", fintoc: null, registrar: () => {} });
  assert.equal(retenidos(alfa.id), 1);
  assert.equal(await procesarRetenidos(alfa.id, operador, { auditar }), 0, "suspendida: no procesa nada");

  // 6. Al reactivar se aplica una vez, por el camino normal (la referencia lleva al cargo).
  const reactivada = await cambiar(alfa.id, "reactivacion");
  assert.deepEqual(reactivada, { companyId: alfa.id, reactivada: true });
  const [uno, otro] = await Promise.all([procesarRetenidos(alfa.id, operador, { auditar }), procesarRetenidos(alfa.id, operador, { auditar })]);
  assert.equal(uno + otro, 1, "dos corridas a la vez procesan el retenido una sola vez");
  assert.equal(pagos(alfa.id), 1);
  assert.equal(cuenta(`select count(*) from collection_charges where id = '${alfa.cargo.id}' and estado = 'pagado'`), 1);
  assert.equal(retenidos(alfa.id), 0);
  assert.equal(cuenta(`select count(*) from collection_held_events where company_id = '${alfa.id}' and estado = 'procesado' and efecto = 'registrado'`), 1);
  assert.equal(cuenta(`select count(*) from audit_log where company_id = '${alfa.id}' and accion = 'procesar_retenido_cobranza'`), 1);
  // Y nada se aplica dos veces: otra corrida, la tarea diaria y el reintento de Fintoc después de reactivar.
  assert.equal(await procesarRetenidos(alfa.id, operador, { auditar }), 0);
  await correrCobranza({ ahora: HOY, auditar, enviador: deps().enviador, urlPublica: () => "https://lever.ejemplo.mx", fintoc: null, registrar: () => {} });
  assert.deepEqual(await avisar(cuerpo), { estado: 200, cuerpo: { ok: true, efecto: "repetido" } });
  assert.equal(pagos(alfa.id), 1);
  assert.equal(cuenta(`select count(*) from collection_applications where company_id = '${alfa.id}'`), 1);
  assert.equal((await leerBandejaCumplimiento(cum)).abonosRetenidos.length, 0, "la bandeja se vacía al aplicarlo");

  // 7. La carrera, en sus órdenes. Una conexión de la dueña detiene el aviso donde se necesita.
  const duena = new pg.Client({ connectionString: url });
  await duena.connect();
  try {
    const esperarBloqueo = async () => {
      for (let i = 0; i < 200; i += 1) {
        const r = await duena.query("select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database()");
        if (r.rows[0].n > 0) return;
        await new Promise((listo) => setTimeout(listo, 25));
      }
      throw new Error("El aviso no llegó a esperar el candado.");
    };

    // a) El aviso llega y confirma antes de que se apruebe la suspensión: queda aplicado, sin retener.
    assert.deepEqual(await avisar(abono(beta, 40_000)), { estado: 200, cuerpo: { ok: true, efecto: "registrado" } });
    await cambiar(beta.id, "suspension");
    assert.deepEqual([pagos(beta.id), retenidos(beta.id)], [1, 0]);
    await cambiar(beta.id, "reactivacion");

    // b) La suspensión confirma mientras el aviso espera el candado de la empresa: el aviso la ve y retiene.
    await duena.query("begin");
    await duena.query("select pg_advisory_xact_lock(hashtextextended($1::text, 814272))", [beta.id]);
    const enEspera = avisar(abono(beta, 30_000));
    await esperarBloqueo();
    await cambiar(beta.id, "suspension");
    await duena.query("commit");
    assert.deepEqual(await enEspera, { estado: 200, cuerpo: { ok: true, efecto: "retenido" } });
    assert.deepEqual([pagos(beta.id), retenidos(beta.id)], [1, 1]);
    await cambiar(beta.id, "reactivacion");
    assert.equal(await procesarRetenidos(beta.id, operador, { auditar }), 1);

    // c) La suspensión confirma con el aviso a medio escribir (ya revisó el estado y espera el cargo): la base lo
    //    frena con empresa_suspendida y el aviso se retiene en su propia transacción, con 200.
    await duena.query("begin");
    await duena.query("select id from collection_charges where id = $1 for update", [beta.cargo.id]);
    const aMedias = avisar(abono(beta, 20_000));
    await esperarBloqueo();
    await cambiar(beta.id, "suspension");
    await duena.query("commit");
    assert.deepEqual(await aMedias, { estado: 200, cuerpo: { ok: true, efecto: "retenido" } });
    assert.equal(pagos(beta.id), 2, "el abono frenado no dejó pago");
    assert.equal(retenidos(beta.id), 1);
    await cambiar(beta.id, "reactivacion");
    assert.equal(await procesarRetenidos(beta.id, operador, { auditar }), 1);
    assert.equal(pagos(beta.id), 3);
    assert.equal(cuenta(`select count(*) from collection_provider_events where company_id = '${beta.id}'`), 3);
  } finally {
    await duena.query("rollback").catch(() => undefined);
    await duena.end();
  }
}
