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
import { anularPago, configurarCobranza, darDeAltaCliente, registrarPagoManual, type DependenciasCobranza } from "../../src/server/cobranza/servicio.ts";
import { correrCobranza } from "../../src/server/cobranza/tarea.ts";
import { leerBandejaCumplimiento } from "../../src/server/operacion/cumplimiento.ts";
import { decidirCambioDeSuspension, solicitarCambioDeSuspension } from "../../src/server/operacion/suspensiones.ts";
import { contextoDePersonal } from "../../src/server/plataforma/servicio.ts";
import { personal, SESION_SOFIPO } from "../operacion/apoyo-alta-regulada.ts";
import { administrador, CLABE_EMPRESA, contar, HOY, persona, reloj, sembrarPersonal } from "./siembra.ts";
import { nombrarCentro } from "../../src/server/personas/servicio.ts";
import type { MensajeCorreo } from "../../src/server/correo/tipos.ts";
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
  /**
   * El cuerpo firmado de un abono a la cuenta de la empresa, con la referencia de su cargo (o la que se pida), o de su
   * devolución (`transfer.inbound.returned`, la misma transferencia con `status: returned`).
   */
  const abono = (e: { cuenta: string; cargo: { referencia: string } }, monto = 100_000, otro: { tr?: string; devolucion?: boolean; referencia?: string | null } = {}) => JSON.stringify({
    id: `evt_${randomUUID().replace(/-/g, "")}`, type: otro.devolucion ? "transfer.inbound.returned" : "transfer.inbound.succeeded", object: "event", mode: "test", created_at: new Date().toISOString(),
    data: {
      id: otro.tr ?? `tr_${randomUUID().replace(/-/g, "")}`, object: "transfer", direction: "inbound", status: otro.devolucion ? "returned" : "succeeded", amount: monto, currency: "MXN", mode: "test",
      transaction_date: "2026-11-10T17:00:00.000Z", reference_id: otro.referencia === undefined ? e.cargo.referencia : otro.referencia, tracking_key: null,
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
  assert.deepEqual(bandeja.abonosRetenidos.map((r) => [r.razonSocial, r.montoCentavos, r.devolucion, r.estadoEmpresa, r.fallido, r.recibidoEl]),
    [["Escuela Alfa Retenidos", 100_000, false, "suspendida", null, "2026-11-10"]]);
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
    const esperarBloqueo = async (cuantos = 1) => {
      for (let i = 0; i < 200; i += 1) {
        const r = await duena.query("select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database()");
        if (r.rows[0].n >= cuantos) return;
        await new Promise((listo) => setTimeout(listo, 25));
      }
      throw new Error("El aviso no llegó a esperar el candado.");
    };

    // a) El aviso llega y confirma antes de que se apruebe la suspensión: queda aplicado, sin retener.
    assert.deepEqual(await avisar(abono(beta, 40_000)), { estado: 200, cuerpo: { ok: true, efecto: "registrado" } });
    await cambiar(beta.id, "suspension");
    assert.deepEqual([pagos(beta.id), retenidos(beta.id)], [1, 0]);
    await cambiar(beta.id, "reactivacion");

    // b) La suspensión y el aviso piden el candado de la empresa a la vez (r63j-N2: la suspensión ahora lo toma): uno
    //    ve el estado de antes y el otro el de después. Sea cual sea el orden, el abono queda aplicado o retenido, nunca
    //    perdido ni las dos cosas.
    await duena.query("begin");
    await duena.query("select pg_advisory_xact_lock(hashtextextended($1::text, 814272))", [beta.id]);
    const enEspera = avisar(abono(beta, 30_000));
    await esperarBloqueo();
    const suspension = cambiar(beta.id, "suspension");
    await esperarBloqueo(2);
    await duena.query("commit");
    const [b1] = await Promise.all([enEspera, suspension]);
    assert.ok(["retenido", "registrado"].includes(String(b1.cuerpo.efecto)), JSON.stringify(b1));
    assert.equal(pagos(beta.id) + retenidos(beta.id), 2);
    await cambiar(beta.id, "reactivacion");
    await procesarRetenidos(beta.id, operador, { auditar });
    assert.deepEqual([pagos(beta.id), retenidos(beta.id)], [2, 0]);

    // c) Una suspensión que no toma el candado (la de la lista de personas bloqueadas, dentro de la base) confirma con
    //    el aviso a medio escribir (ya revisó el estado y espera el cargo): la base lo frena con empresa_suspendida y la
    //    segunda vuelta lo retiene, con 200.
    await duena.query("begin");
    await duena.query("select id from collection_charges where id = $1 for update", [beta.cargo.id]);
    const aMedias = avisar(abono(beta, 20_000));
    await esperarBloqueo();
    ejecutar(url, `set session_replication_role = replica; update companies set estado = 'suspendida' where id = '${beta.id}'; set session_replication_role = origin;`);
    await duena.query("commit");
    assert.deepEqual(await aMedias, { estado: 200, cuerpo: { ok: true, efecto: "retenido" } });
    assert.equal(pagos(beta.id), 2, "el abono frenado no dejó pago");
    assert.equal(retenidos(beta.id), 1);
    ejecutar(url, `set session_replication_role = replica; update companies set estado = 'activa' where id = '${beta.id}'; set session_replication_role = origin;`);
    assert.equal(await procesarRetenidos(beta.id, operador, { auditar }), 1);
    assert.equal(pagos(beta.id), 3);
    assert.equal(cuenta(`select count(*) from collection_provider_events where company_id = '${beta.id}'`), 3);

    // r63j ------------------------------------------------------------------------------------------------------------
    const clienteDe = (empresaId: string) => consultarJson<{ id: string }[]>(url,
      `select json_agg(x) from (select id from collection_customers where company_id = '${empresaId}' limit 1) x`)[0]!.id;
    const retenidoFallido = (empresaId: string, evento: string, tipo: "ilegible" | "fecha" = "ilegible") => {
      // Un retenido que el camino normal no puede aplicar: lo inserta la dueña, como si hubiera llegado así (la base lo
      // acepta: el aviso es jsonb). «ilegible» no trae ni abono ni devolución: falla igual siempre y queda fallido al
      // primer intento. «fecha» trae un día que no existe: la base lo rechaza con un error de datos, que llega a la
      // aplicación como base_no_disponible (pasajero): se reintenta y queda fallido al quinto (r63k-N2).
      const aviso = tipo === "ilegible"
        ? { eventoId: evento, tipo: "transfer.inbound.succeeded", modo: "test", devolucion: null, abono: null }
        : { eventoId: evento, tipo: "transfer.inbound.succeeded", modo: "test", devolucion: null,
          abono: { idExterno: `fintoc:tr_${evento.slice(4)}`, montoCentavos: 7_700, recibidoEl: "2026-13-45", claveRastreo: null, referencia: null,
            clabeOrdenante: null, nombreOrdenante: null, cuentaId: alfa.cuenta, cuentaNumeroId: `acno_Principal${alfa.cuenta.slice(4)}` } };
      ejecutar(url, `insert into collection_held_events (id, company_id, proveedor, evento_id, tipo, monto_centavos, recibido_el, aviso, retenido_en)
        values ('${randomUUID()}', '${empresaId}', 'fintoc', '${evento}', 'transfer.inbound.succeeded', 7700, '2026-11-10', '${JSON.stringify(aviso)}'::jsonb, now() - interval '1 hour')`);
    };

    // r63j-N1 a) La devolución de un pago que la empresa ya descartó como duplicado (anulado) queda resuelta, con su
    //    evento y 200. Antes lanzaba pago_anulado: 500 y Fintoc reintentaba hasta rendirse.
    const clienteAlfa = clienteDe(alfa.id);
    await registrarPagoManual(alfa.admin, { altaId: randomUUID(), monto: "250.00", recibidoEl: "2026-11-10", clienteId: clienteAlfa }, null, deps());
    const trDuplicado = `tr_${randomUUID().replace(/-/g, "")}`;
    assert.deepEqual(await avisar(abono(alfa, 25_000, { tr: trDuplicado, referencia: null })), { estado: 200, cuerpo: { ok: true, efecto: "registrado" } });
    const duplicado = consultarJson<{ id: string; posible_duplicado: boolean }[]>(url,
      `select json_agg(x) from (select id, posible_duplicado from collection_payments where id_externo = 'fintoc:${trDuplicado}') x`)[0]!;
    assert.equal(duplicado.posible_duplicado, true);
    await anularPago(alfa.admin, { pagoId: duplicado.id, motivo: "Es el mismo depósito que el pago a mano." }, deps());
    assert.deepEqual(await avisar(abono(alfa, 25_000, { tr: trDuplicado, devolucion: true, referencia: null })), { estado: 200, cuerpo: { ok: true, efecto: "anulado" } });
    assert.equal(cuenta(`select count(*) from collection_provider_events p join collection_payments x on x.id = p.payment_id where x.id = '${duplicado.id}'`), 2);
    assert.equal(cuenta(`select count(*) from collection_payments where id = '${duplicado.id}' and estado = 'anulado'`), 1);

    // r63j-N1 b) Un retenido envenenado seguido de uno legítimo: el primero queda «fallido» con su motivo, a la vista de
    //    Cumplimiento, y el segundo se aplica. Antes el primero lanzaba y el segundo no se aplicaba nunca.
    //    Decisión de Gil (2026-11-11): el fallido se avisa por correo a administración y finanzas de la empresa, y a
    //    nadie más (ni a la contadora de Alfa, ni a Beta, ni al personal de Lever).
    const centroAlfa = await nombrarCentro(alfa.admin, { nombre: "Administración" }, { ahora: HOY });
    await persona(url, alfa.admin, centroAlfa.id, "Fina Finanzas", "finanzas-alfa-retenidos@ejemplo.mx", ["tarjetahabiente", "finanzas"]);
    await persona(url, alfa.admin, centroAlfa.id, "Cora Contadora", "contadora-alfa-retenidos@ejemplo.mx", ["contador"]);
    const buzon: MensajeCorreo[] = [];
    const alBuzon = () => async (m: MensajeCorreo) => { buzon.push(m); return { id: randomUUID() }; };
    await cambiar(alfa.id, "suspension");
    retenidoFallido(alfa.id, "evt_Envenenado01");
    assert.deepEqual(await avisar(abono(alfa, 55_500, { referencia: null })), { estado: 200, cuerpo: { ok: true, efecto: "retenido" } });
    await cambiar(alfa.id, "reactivacion");
    assert.equal(await procesarRetenidos(alfa.id, operador, { auditar, enviador: alBuzon, urlPublica: () => "https://lever.ejemplo.mx" }), 2);
    assert.equal(cuenta(`select count(*) from collection_held_events where company_id = '${alfa.id}' and estado = 'fallido' and motivo = 'aviso_ilegible'`), 1);
    const avisos = buzon.filter((m) => m.asunto.startsWith("Un depósito de $77.00 no se registró solo"));
    assert.deepEqual(avisos.map((m) => m.para).sort(), ["admin-tcm010101ab1@ejemplo.mx", "finanzas-alfa-retenidos@ejemplo.mx"]);
    assert.equal(buzon.length, 2, "nadie más recibe el aviso");
    const correo = avisos[0]!;
    assert.match(correo.texto, /\$77\.00/);
    assert.match(correo.texto, /10 de noviembre de 2026/);
    assert.match(correo.texto, /El dinero sí está en tu cuenta/);
    assert.match(correo.texto, /Regístralo a mano/);
    assert.doesNotMatch(correo.texto + correo.html, /aviso_ilegible|Ordenante|base_no_disponible/);
    assert.equal(cuenta(`select count(*) from audit_log where company_id = '${alfa.id}' and accion = 'aviso_retenido_fallido_cobranza' and cambio->>'enviados' = '2'`), 1);
    // Una segunda corrida no lo reenvía: el fallido ya no se procesa.
    assert.equal(await procesarRetenidos(alfa.id, operador, { auditar, enviador: alBuzon }), 0);
    assert.equal(buzon.length, 2);
    assert.equal(cuenta(`select count(*) from collection_held_events where company_id = '${alfa.id}' and estado = 'procesado' and monto_centavos = 55500`), 1);
    assert.equal(cuenta(`select count(*) from collection_payments where company_id = '${alfa.id}' and monto_centavos = 55500`), 1);
    assert.equal(cuenta(`select count(*) from audit_log where company_id = '${alfa.id}' and accion = 'retenido_fallido_cobranza'`), 1);
    const fallidos = (await leerBandejaCumplimiento(cum)).abonosRetenidos.filter((r) => r.fallido);
    assert.deepEqual(fallidos.map((r) => [r.razonSocial, r.montoCentavos, r.fallido]), [["Escuela Alfa Retenidos", 7_700, "aviso_ilegible"]]);

    // r63j-N1 c) La tarea diaria con un retenido envenenado sigue generando cargos y mandando recordatorios: el paso de
    //    los retenidos tiene su propio try. Antes la empresa contaba como fallida y no se generaba nada.
    retenidoFallido(beta.id, "evt_Envenenado02");
    const cargosAntes = cuenta(`select count(*) from collection_charges where company_id = '${beta.id}'`);
    const tarea = await correrCobranza({ ahora: reloj("2027-01-10T18:00:00.000Z"), auditar, enviador: deps().enviador, urlPublica: () => "https://lever.ejemplo.mx", fintoc: null, registrar: () => {} });
    assert.equal(tarea.fallidas, 0, JSON.stringify(tarea));
    assert.ok(cuenta(`select count(*) from collection_charges where company_id = '${beta.id}'`) > cargosAntes, "la tarea generó los cargos de beta");
    assert.equal(cuenta(`select count(*) from collection_held_events where company_id = '${beta.id}' and estado = 'fallido'`), 1);
    // Si el envío del aviso falla, el retenido sigue fallido y la bitácora dice que salieron 0 correos.
    retenidoFallido(beta.id, "evt_Envenenado03");
    const intentadas: string[] = [];
    const caido = () => async (m: MensajeCorreo) => { intentadas.push(m.idempotencia); throw new Error("el proveedor de correo no respondió"); };
    assert.equal(await procesarRetenidos(beta.id, operador, { auditar, enviador: caido, urlPublica: () => "https://lever.ejemplo.mx" }), 1);
    assert.equal(cuenta(`select count(*) from collection_held_events where evento_id = 'evt_Envenenado03' and estado = 'fallido'`), 1);
    const avisosDe03 = (enviados: string) => cuenta(`select count(*) from audit_log a join collection_held_events h on h.id = a.identificador
      where h.evento_id = 'evt_Envenenado03' and a.accion = 'aviso_retenido_fallido_cobranza' and a.cambio->>'enviados' ${enviados}`);
    assert.equal(avisosDe03("= '0'"), 1);
    // r63m: con el proveedor todavía caído, la tarea lo intenta de nuevo y sigue en 0 (un evento por intento); con el
    //    proveedor de vuelta, la siguiente corrida lo manda una vez, con la misma llave, y la tercera ya no lo reenvía.
    const id03 = consultarJson<{ id: string }[]>(url, "select json_agg(x) from (select id from collection_held_events where evento_id = 'evt_Envenenado03') x")[0]!.id;
    const del03 = (m: MensajeCorreo) => m.idempotencia.startsWith(`cobranza-retenido-fallido/${id03}/`);
    assert.ok(intentadas.length > 0 && intentadas.every((l) => l.startsWith(`cobranza-retenido-fallido/${id03}/`)));
    const buzonBeta: MensajeCorreo[] = [];
    const alBuzonBeta = () => async (m: MensajeCorreo) => { buzonBeta.push(m); return { id: randomUUID() }; };
    const corrida = (enviador: typeof alBuzonBeta | typeof caido) =>
      correrCobranza({ ahora: reloj("2027-01-10T18:00:00.000Z"), auditar, enviador, urlPublica: () => "https://lever.ejemplo.mx", fintoc: null, registrar: () => {} });
    await corrida(caido);
    assert.equal(avisosDe03("= '0'"), 2);
    assert.equal(avisosDe03("<> '0'"), 0);
    await corrida(alBuzonBeta);
    const reenviados = buzonBeta.filter(del03);
    assert.deepEqual(reenviados.map((m) => m.idempotencia).sort(), [...new Set(intentadas.filter((l) => l.startsWith(`cobranza-retenido-fallido/${id03}/`)))].sort(), "la misma llave que el intento caído");
    assert.ok(reenviados.every((m) => m.asunto.startsWith("Un depósito de $77.00 no se registró solo")));
    assert.equal(avisosDe03(`= '${reenviados.length}'`), 1);
    await corrida(alBuzonBeta);
    assert.equal(buzonBeta.filter(del03).length, reenviados.length, "la tercera corrida no lo reenvía");
    assert.equal(avisosDe03("is not null"), 3);
    // r63n (decisión del líder): si la empresa no tiene a nadie activo de administración o finanzas, queda un solo
    //    evento con el motivo sin_destinatarios y la tarea no lo reintenta cada día (el de arriba, que falló por el
    //    proveedor, sí se reintentó).
    const delta = await empresa("DEL150301AB4", "601", "Delta Sin Equipo Retenidos", "acc_RetenidosDelta01");
    ejecutar(url, `set session_replication_role = replica; update memberships set estado = 'suspendida' where company_id = '${delta.id}'; set session_replication_role = origin;`);
    retenidoFallido(delta.id, "evt_SinEquipo01");
    assert.equal(await procesarRetenidos(delta.id, operador, { auditar, enviador: alBuzonBeta, urlPublica: () => "https://lever.ejemplo.mx" }), 1);
    await corrida(alBuzonBeta);
    await corrida(alBuzonBeta);
    const eventosSinEquipo = consultarJson<{ enviados: string; motivo: string | null }[]>(url, `select json_agg(x) from (
      select a.cambio->>'enviados' as enviados, a.cambio->>'motivo' as motivo from audit_log a join collection_held_events h on h.id = a.identificador
       where h.evento_id = 'evt_SinEquipo01' and a.accion = 'aviso_retenido_fallido_cobranza') x`);
    assert.deepEqual(eventosSinEquipo, [{ enviados: "0", motivo: "sin_destinatarios" }], "un solo evento, sin reintento diario");
    assert.equal(buzonBeta.filter((m) => m.idempotencia.startsWith("cobranza-retenido-fallido/") && !del03(m)).length, 0);

    // r63j-N2 a) El aviso toma el candado y retiene (la empresa sigue suspendida) mientras la reactivación espera ese
    //    mismo candado: al reactivar, el retenido ya está ahí y se aplica. Antes el aviso revisaba en una transacción y
    //    guardaba en otra: el retenido confirmaba después de la reactivación y de su procesado, y quedaba varado.
    await cambiar(beta.id, "suspension");
    const pagosBeta = pagos(beta.id);
    await duena.query("begin");
    await duena.query("lock table collection_held_events in exclusive mode");
    const avisoPrimero = avisar(abono(beta, 11_100, { referencia: null }));
    await esperarBloqueo();
    const reactivar = cambiar(beta.id, "reactivacion").then(() => procesarRetenidos(beta.id, operador, { auditar }));
    let reactivada = false;
    void reactivar.then(() => { reactivada = true; }, () => undefined);
    await esperarBloqueo(2).catch(() => undefined);
    await duena.query("commit");
    assert.deepEqual(await avisoPrimero, { estado: 200, cuerpo: { ok: true, efecto: "retenido" } });
    await reactivar;
    assert.equal(reactivada, true);
    assert.equal(retenidos(beta.id), 0, "ningún retenido varado con la empresa activa");
    assert.equal(pagos(beta.id), pagosBeta + 1);

    // r63j-N2 b) La reactivación toma el candado primero y el aviso espera: el aviso ve la empresa activa y se aplica
    //    por el camino normal, sin retener.
    await cambiar(beta.id, "suspension");
    await duena.query("begin");
    await duena.query("select pg_advisory_xact_lock(hashtextextended($1::text, 814272))", [beta.id]);
    const reactivarPrimero = cambiar(beta.id, "reactivacion");
    await esperarBloqueo();
    const avisoDespues = avisar(abono(beta, 12_200, { referencia: null }));
    await esperarBloqueo(2);
    await duena.query("commit");
    await reactivarPrimero;
    assert.deepEqual(await avisoDespues, { estado: 200, cuerpo: { ok: true, efecto: "registrado" } });
    assert.equal(cuenta(`select count(*) from collection_held_events where company_id = '${beta.id}' and monto_centavos = 12200`), 0);
    assert.equal(pagos(beta.id), pagosBeta + 2);

    // r63j-N2 c) Un abono retenido que la reactivación no alcanzó a aplicar y, después, su devolución: la devolución
    //    procesa antes los retenidos de la empresa, así que encuentra su pago y lo revierte. El cargo no queda pagado con
    //    dinero devuelto. Antes la devolución iba a «sin destino» y la tarea aplicaba después el abono.
    await cambiar(beta.id, "suspension");
    const k = consultarJson<{ id: string; referencia: string }[]>(url, `select json_agg(x) from (select id, referencia from collection_charges
      where company_id = '${beta.id}' and estado = 'emitido' order by vencimiento limit 1) x`)[0]!;
    const saldo = cuenta(`select (monto_centavos - pagado_centavos)::int from collection_charges where id = '${k.id}'`);
    const trHueco = `tr_${randomUUID().replace(/-/g, "")}`;
    assert.deepEqual(await avisar(abono(beta, saldo, { tr: trHueco, referencia: k.referencia })), { estado: 200, cuerpo: { ok: true, efecto: "retenido" } });
    await cambiar(beta.id, "reactivacion");
    assert.deepEqual(await avisar(abono(beta, saldo, { tr: trHueco, devolucion: true, referencia: k.referencia })), { estado: 200, cuerpo: { ok: true, efecto: "devuelto" } });
    await correrCobranza({ ahora: reloj("2027-01-10T18:00:00.000Z"), auditar, enviador: deps().enviador, urlPublica: () => "https://lever.ejemplo.mx", fintoc: null, registrar: () => {} });
    assert.equal(cuenta(`select count(*) from collection_charges where id = '${k.id}' and estado = 'emitido'`), 1, "el cargo no quedó pagado con dinero devuelto");
    assert.equal(cuenta(`select count(*) from collection_payments where id_externo = 'fintoc:${trHueco}' and estado = 'devuelto'`), 1);
    assert.equal(cuenta(`select count(*) from collection_unrouted_events where transferencia_id = '${trHueco}'`), 0);

    // r63j-P3: con tope, la reactivación procesa a lo más ese número y el resto espera a la tarea; la bandeja lo dice.
    await cambiar(beta.id, "suspension");
    assert.equal((await avisar(abono(beta, 1_300, { referencia: null }))).cuerpo.efecto, "retenido");
    assert.equal((await avisar(abono(beta, 1_400, { referencia: null }))).cuerpo.efecto, "retenido");
    await cambiar(beta.id, "reactivacion");
    assert.equal(await procesarRetenidos(beta.id, operador, { auditar }, 1), 1);
    assert.equal(retenidos(beta.id), 1);
    const espera = (await leerBandejaCumplimiento(cum)).abonosRetenidos.filter((r) => r.companyId === beta.id && !r.fallido);
    assert.deepEqual(espera.map((r) => [r.montoCentavos, r.estadoEmpresa]), [[1_400, "activa"]]);
    await correrCobranza({ ahora: reloj("2027-01-10T18:00:00.000Z"), auditar, enviador: deps().enviador, urlPublica: () => "https://lever.ejemplo.mx", fintoc: null, registrar: () => {} });
    assert.equal(retenidos(beta.id), 0);

    // r63k-N2 a) Un error pasajero (la bitácora no respondió) deja el retenido pendiente, con un intento más, y detiene la
    //    corrida; la siguiente lo aplica. Antes quedaba «fallido» para siempre y el abono no se aplicaba nunca.
    await cambiar(beta.id, "suspension");
    assert.equal((await avisar(abono(beta, 1_500, { referencia: null }))).cuerpo.efecto, "retenido");
    await cambiar(beta.id, "reactivacion");
    let caida = true;
    const bitacoraCaida: typeof auditar = async (...args) => {
      if (caida) { caida = false; throw new ErrorDeDominio("auditoria_no_disponible"); }
      return auditar(...args);
    };
    await assert.rejects(() => procesarRetenidos(beta.id, operador, { auditar: bitacoraCaida }), codigo("auditoria_no_disponible"));
    assert.equal(cuenta(`select count(*) from collection_held_events where company_id = '${beta.id}' and estado = 'retenido' and intentos = 1`), 1);
    assert.equal(await procesarRetenidos(beta.id, operador, { auditar }), 1);
    assert.equal(cuenta(`select count(*) from collection_payments where company_id = '${beta.id}' and monto_centavos = 1500`), 1);
    assert.equal(retenidos(beta.id), 0);

    // r63k-N2 b) Un error de datos de la base también llega como base_no_disponible: se reintenta y al quinto intento
    //    queda fallido, así que no frena para siempre a los que vienen detrás.
    // Con un reloj que avanza una hora en cada intento (r63l-N1: se cuenta uno por hora), solo en esta base desechable.
    ejecutar(url, `create sequence reloj_retenidos; create or replace function cobranza_retenidos_ahora() returns timestamptz
      language sql volatile set search_path = public, pg_temp as $f$ select now() + nextval('reloj_retenidos') * interval '1 hour' $f$;`);
    retenidoFallido(beta.id, "evt_FechaImposible01", "fecha");
    for (let i = 1; i <= 4; i += 1) {
      await assert.rejects(() => procesarRetenidos(beta.id, operador, { auditar }), codigo("base_no_disponible"));
      assert.equal(cuenta(`select intentos from collection_held_events where evento_id = 'evt_FechaImposible01' and estado = 'retenido'`), i);
    }
    assert.equal(await procesarRetenidos(beta.id, operador, { auditar }), 1);
    assert.equal(cuenta(`select count(*) from collection_held_events where evento_id = 'evt_FechaImposible01' and estado = 'fallido' and motivo = 'base_no_disponible' and intentos = 5`), 1);
    ejecutar(url, `create or replace function cobranza_retenidos_ahora() returns timestamptz
      language sql stable set search_path = public, pg_temp as $f$ select now() $f$; drop sequence reloj_retenidos;`);

    // r63l-N1: una contención breve no quema los cinco intentos. Cinco avisos nuevos de la empresa en menos de un
    //    minuto, con la bitácora sin responder (como la fila del cargo tomada más que el statement_timeout): cada uno
    //    responde 500 para que Fintoc reintente, y el retenido sigue pendiente con un solo intento. Cuando la falla pasa,
    //    el siguiente aviso lo aplica primero. Antes quedaba fallido al quinto aviso, con un abono que no tenía nada malo.
    await cambiar(beta.id, "suspension");
    assert.equal((await avisar(abono(beta, 1_600, { referencia: null }))).cuerpo.efecto, "retenido");
    await cambiar(beta.id, "reactivacion");
    const sinBitacora = { ...depsAviso, auditar: (async () => { throw new ErrorDeDominio("auditoria_no_disponible"); }) as typeof auditar };
    for (let i = 0; i < 5; i += 1) {
      const cuerpoNuevo = abono(beta, 1_700 + i, { referencia: null });
      await assert.rejects(() => atenderAviso(new TextEncoder().encode(cuerpoNuevo), firmar(cuerpoNuevo, configFintoc.secretoWebhook, ahoraSeg), sinBitacora), codigo("auditoria_no_disponible"));
    }
    assert.equal(cuenta(`select count(*) from collection_held_events where company_id = '${beta.id}' and estado = 'retenido' and monto_centavos = 1600 and intentos = 1`), 1);
    assert.equal((await avisar(abono(beta, 1_800, { referencia: null }))).cuerpo.efecto, "registrado");
    assert.equal(cuenta(`select count(*) from collection_held_events where company_id = '${beta.id}' and monto_centavos = 1600 and estado = 'procesado' and efecto = 'registrado'`), 1);
    assert.equal(cuenta(`select count(*) from collection_payments where company_id = '${beta.id}' and monto_centavos = 1600`), 1);

    // r63k-N1: la decisión de suspender contra el alta de un proveedor de la misma empresa con una coincidencia abierta
    //    (candado de la empresa → lpb_cotejar_empresa, que escribe la fila de companies), en los dos órdenes, con dos
    //    conexiones. La decisión toma el candado antes de escribir; antes lo tomaba después y se interbloqueaban.
    const gamma = await empresa("EKU9003173C9", "601", "Grupo Gamma Retenidos", "acc_RetenidosGama01");
    ejecutar(url, `begin; set local session_replication_role = replica;
      insert into lpb_coincidencias (operator_id, company_id, sujeto_tipo, sujeto_clave, sujeto_nombre, sujeto_rfc, lista, snapshot_69b_id, tipo, coincide_por, valor_coincidente, estado, detectada_en, plazo_reporte_hasta)
      values ('${operador}', '${gamma.id}', 'contraparte', gen_random_uuid(), 'Proveedor en lista', 'XAXX010101000', '69b', gen_random_uuid(), 'exacta', 'rfc', 'XAXX010101000', 'pendiente', now(), now() + interval '24 hours');
      commit;`);
    for (const primero of ["proveedor", "decision"] as const) {
      ejecutar(url, `set session_replication_role = replica; update companies set estado = 'activa' where id = '${gamma.id}';
        update company_suspensions set estado = 'rechazada' where company_id = '${gamma.id}' and estado = 'pendiente'; set session_replication_role = origin;`);
      await solicitarCambioDeSuspension(ori, { companyId: gamma.id, formId: randomUUID(), tipo: "suspension", motivo: "Revisión de Cumplimiento por operaciones" });
      const solicitud = consultarJson<{ id: string }[]>(url, `select json_agg(x) from (select id from company_suspensions where company_id = '${gamma.id}' and estado = 'pendiente') x`)[0]!.id;
      await duena.query("begin");
      let decision: Promise<unknown>;
      if (primero === "proveedor") {
        await duena.query("select pg_advisory_xact_lock(hashtextextended($1::text, 814272))", [gamma.id]);
        decision = decidirCambioDeSuspension(apr, SESION_SOFIPO, { id: solicitud, aprobada: true, motivo: "" }).then(() => "ok", (e) => e);
        await esperarBloqueo();
      } else {
        decision = decidirCambioDeSuspension(apr, SESION_SOFIPO, { id: solicitud, aprobada: true, motivo: "" }).then(() => "ok", (e) => e);
        await new Promise((listo) => setTimeout(listo, 300));
        await duena.query("select pg_advisory_xact_lock(hashtextextended($1::text, 814272))", [gamma.id]);
      }
      const proveedor = await duena.query("select lpb_cotejar_empresa($1)", [gamma.id]).then(() => "ok", (e: Error) => e.message);
      await duena.query(proveedor === "ok" ? "commit" : "rollback");
      assert.equal(proveedor, "ok", `${primero}: el lado del proveedor`);
      assert.equal(await decision, "ok", `${primero}: la decisión (antes: deadlock → base_no_disponible)`);
    }
  } finally {
    await duena.query("rollback").catch(() => undefined);
    await duena.end();
  }
}
