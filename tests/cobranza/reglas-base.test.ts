import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { cerrarConexion } from "../../src/nucleo/db.ts";
import { darDeAltaComoDuena } from "../../scripts/empresa-por-la-duena.ts";
import { configurarCobranza, darDeAltaCliente, type DependenciasCobranza } from "../../src/server/cobranza/servicio.ts";
import { nombrarCentro } from "../../src/server/personas/servicio.ts";
import { contextoDePersonal } from "../../src/server/plataforma/servicio.ts";
import { aplicarArchivo, conBaseDesechable, consultarJson, ejecutar, exigirBaseDesechable, urlDeAplicacion } from "../aislamiento/postgres.ts";
import { administrador, CLABE_EMPRESA, HOY, persona, sembrarPersonal } from "./siembra.ts";

/**
 * Las reglas clave de la 0031, una por una, con el error crudo de Postgres (r63-base-N6).
 * Cada regla corre en su transacción con `pg.Client` como `src/nucleo/db.ts` (rol, contexto con set_config local),
 * fuerza los diferidos con `set constraints all immediate` y revierte: ninguna deja rastro para la siguiente.
 * No usa `conContexto`, que traduce los errores: aquí se compara el código, la restricción o el mensaje que da la base.
 */

const urlAdmin = process.env.AISLAMIENTO_DATABASE_URL?.trim() ?? "";
const C = "plataforma_cliente";

type Cliente = InstanceType<typeof pg.Client>;
type Ids = {
  operador: string; alfa: string; beta: string; admin: string; adminB: string; contador: string;
  c1: string; k1: string; plan1: string; periodo1: number; kb: string;
};

describe("Cobranza: reglas de la base (0031)", { skip: urlAdmin.length === 0 }, () => {
  it("cada regla clave rechaza con su propio error y las válidas pasan", async () => {
    exigirBaseDesechable();
    await conBaseDesechable(urlAdmin, async (url) => {
      const dir = join(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");
      for (const archivo of readdirSync(dir).sort()) {
        if (archivo.endsWith(".sql")) aplicarArchivo(url, join(dir, archivo));
      }
      ejecutar(url, `do $$ begin execute format('alter database %I set timezone to %L', current_database(), 'UTC'); end $$;`);
      // Las dos llaves de idempotencia, antes de sembrar: los servicios usan ON CONFLICT sobre ellas y sin ellas
      // la siembra cae con «base_no_disponible», que no dice qué regla faltó (MU4 y MU13 del revisor).
      const llave = (nombre: string) => consultarJson<{ d: string }[]>(url,
        `select coalesce(json_agg(json_build_object('d', pg_get_constraintdef(oid))), '[]') from pg_constraint where conname = '${nombre}'`)[0]?.d;
      assert.equal(llave("collection_charges_periodo_unico"), "UNIQUE (plan_id, periodo)", "falta la llave del cron (plan, periodo)");
      assert.equal(llave("collection_emails_unico"), "UNIQUE (charge_id, tipo, secuencia)", "falta la llave del correo (cargo, tipo, secuencia)");
      await cerrarConexion();
      const previo = process.env.DATABASE_URL;
      const app = urlDeAplicacion(url);
      process.env.DATABASE_URL = app;
      try {
        const ids = await sembrar(url);
        await reglas(app, ids);
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

/** Alfa y Beta con su admin, una contadora en Alfa, la cobranza configurada y un cliente fijo en cada una (k1 y kb). */
async function sembrar(url: string): Promise<Ids> {
  sembrarPersonal(url);
  const personal = await contextoDePersonal("personal-cobranza@ejemplo.mx");
  const alfa = await darDeAltaComoDuena(url, personal, { rfc: "TCM010101AB1", razonSocial: "Escuela Alfa Reglas", codigoPostal: "06600", regimen: "601", usoCfdi: "G03" }, { demostracion: false, corridoPor: "pruebas@ejemplo.mx" });
  const beta = await darDeAltaComoDuena(url, personal, { rfc: "CABL840215RF4", razonSocial: "Taller Beta Reglas", codigoPostal: "44100", regimen: "612", usoCfdi: "G03" }, { demostracion: false, corridoPor: "pruebas@ejemplo.mx" });
  const [admin, sesionAdmin] = await administrador(url, personal, alfa, "admin-alfa-reglas@ejemplo.mx");
  const [adminBeta, sesionBeta] = await administrador(url, personal, beta, "admin-beta-reglas@ejemplo.mx");
  const centro = await nombrarCentro(admin, { nombre: "Operación" }, { ahora: HOY });
  await persona(url, admin, centro.id, "Contadora Reglas", "contadora-reglas@ejemplo.mx", ["contador"]);
  const config = {
    clabe: CLABE_EMPRESA, beneficiario: "Escuela Alfa Reglas SA de CV", correoContacto: "cobranza-alfa-reglas@ejemplo.mx",
    emitirDiasAntes: "7", antesDias: "3", avisoElDia: "si", despuesCadaDias: "7", despuesTope: "3", envioAutomatico: "si",
  };
  await configurarCobranza(admin, config, sesionAdmin, deps());
  await configurarCobranza(adminBeta, { ...config, correoContacto: "cobranza-beta-reglas@ejemplo.mx" }, sesionBeta, deps());
  const alta = {
    nombre: "Colegio Uno", rfc: "", correos: "pagos-uno-reglas@ejemplo.mx", concepto: "Renta de bodega",
    tipo: "fijo", monto: "1000.00", periodicidad: "mensual", primerVencimiento: "2026-11-15", fin: "",
  };
  const c1 = await darDeAltaCliente(admin, { ...alta, altaId: randomUUID() }, deps());
  const cb = await darDeAltaCliente(adminBeta, { ...alta, nombre: "Cliente Beta", correos: "pagos-beta-reglas@ejemplo.mx", altaId: randomUUID() }, deps());
  const uno = <T>(sql: string) => consultarJson<T[]>(url, `select json_agg(x) from (${sql}) x`)[0]!;
  const k1 = uno<{ id: string; plan_id: string; periodo: number }>(`select id, plan_id, periodo from collection_charges where customer_id = '${c1.clienteId}'`);
  const kb = uno<{ id: string }>(`select id from collection_charges where customer_id = '${cb.clienteId}'`);
  const usuario = (correo: string) => uno<{ id: string }>(`select id from users where correo = '${correo}'`).id;
  return {
    operador: uno<{ id: string }>("select id from operators order by alta_en limit 1").id,
    alfa: alfa.id, beta: beta.id,
    admin: usuario("admin-alfa-reglas@ejemplo.mx"), adminB: usuario("admin-beta-reglas@ejemplo.mx"), contador: usuario("contadora-reglas@ejemplo.mx"),
    c1: c1.clienteId, k1: k1.id, plan1: k1.plan_id, periodo1: k1.periodo, kb: kb.id,
  };
}

type Resultado = { ok: true; valor: unknown } | { ok: false; code?: string; constraint?: string; message: string };

async function reglas(app: string, ids: Ids): Promise<void> {
  const A = ids.admin;
  const E = ids.alfa;
  let n = 600_000;
  const luhn = (s: string) => {
    let t = 0;
    for (let i = 1; i <= 6; i++) {
      const d = Number(s[i - 1]);
      t += i % 2 === 0 ? (d * 2 > 9 ? d * 2 - 9 : d * 2) : d;
    }
    return (10 - (t % 10)) % 10;
  };
  const ref = () => { const s = String(++n); return `${s}${luhn(s)}`; };

  /** Una transacción como la abre la aplicación; siempre revierte. Devuelve el valor o el error crudo. */
  async function como(pasos: (c: Cliente) => Promise<unknown>, rol = C, usuario: string = A, empresa: string = E): Promise<Resultado> {
    const c = new pg.Client({ connectionString: app });
    await c.connect();
    try {
      await c.query("begin");
      await c.query(`set local role ${rol}`);
      await c.query("select set_config('app.company_id', $1, true), set_config('app.user_id', $2, true), set_config('app.operator_id', $3, true)",
        [empresa, usuario, ids.operador]);
      const valor = await pasos(c);
      await c.query("set constraints all immediate");
      return { ok: true, valor };
    } catch (e) {
      const x = e as { code?: string; constraint?: string; message?: string };
      return { ok: false, code: x.code, constraint: x.constraint, message: x.message ?? String(e) };
    } finally {
      await c.query("rollback").catch(() => undefined);
      await c.end();
    }
  }

  /** La regla da exactamente ese error: el código SQLSTATE, la restricción o el mensaje de RAISE (o uno de varios). */
  async function rechaza(regla: string, esperado: string | string[], pasos: (c: Cliente) => Promise<unknown>, rol = C, usuario: string = A, empresa: string = E) {
    const esperados = typeof esperado === "string" ? [esperado] : esperado;
    const r = await como(pasos, rol, usuario, empresa);
    assert.equal(r.ok, false, `${regla}: la base lo aceptó (esperado ${esperados.join(" o ")})`);
    if (r.ok) return;
    assert.ok([r.code, r.constraint, r.message].some((x) => x !== undefined && esperados.includes(x)),
      `${regla}: esperado ${esperados.join(" o ")}, dio ${r.code} [${r.constraint ?? ""}] ${r.message}`);
  }

  async function acepta<T>(regla: string, pasos: (c: Cliente) => Promise<T>, rol = C, usuario: string = A, empresa: string = E): Promise<T> {
    const r = await como(pasos, rol, usuario, empresa);
    assert.ok(r.ok, `${regla}: la base lo rechazó: ${r.ok ? "" : `${r.code} [${r.constraint ?? ""}] ${r.message}`}`);
    return (r as { valor: T }).valor;
  }

  const evento = (c: Cliente, empresa: string, actor: string | null, accion: string, entidad: string, fila: string) => c.query(
    `insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, origen)
     values ($1, $2, $3, $4, 'cliente', $5, $6, $7, 'consola')`, [ids.operador, empresa, actor ? "miembro" : "sistema", actor, accion, entidad, fila]);
  const cargo = async (c: Cliente, monto = 100_000, referencia = ref(), emitidoEn = "now()") => {
    const id = randomUUID();
    await evento(c, E, A, "emitir_cargo", "collection_charges", id);
    await c.query(`insert into collection_charges (id, company_id, customer_id, concepto, monto_centavos, vencimiento, referencia, estado, emitido_en, emitido_por, creado_por)
      values ($1, $2, $3, 'Regla', $4, '2026-12-01', $5, 'emitido', ${emitidoEn}, $6, $6)`, [id, E, ids.c1, monto, referencia, A]);
    return id;
  };
  const pago = async (c: Cliente, monto = 100_000, externo: string = randomUUID(), autor = A, conEvento = true) => {
    const id = randomUUID();
    if (conEvento) await evento(c, E, autor, "registrar_pago_cobranza", "collection_payments", id);
    await c.query(`insert into collection_payments (id, company_id, fuente, id_externo, monto_centavos, recibido_el, registrado_por)
      values ($1, $2, 'manual', $3, $4, '2026-11-10', $5)`, [id, E, externo, monto, autor]);
    return id;
  };
  const aplicar = async (c: Cliente, p: string, k: string, monto: number) => {
    const id = randomUUID();
    await evento(c, E, A, "aplicacion_cobranza", "collection_applications", id);
    await c.query(`insert into collection_applications (id, company_id, payment_id, charge_id, monto_centavos, regla, aplicado_por)
      values ($1, $2, $3, $4, $5, 'manual', $6)`, [id, E, p, k, monto, A]);
    await c.query(`update collection_charges set pagado_centavos = pagado_centavos + $2,
      estado = case when pagado_centavos + $2 >= monto_centavos then 'pagado' else 'emitido' end,
      pagado_el = case when pagado_centavos + $2 >= monto_centavos then current_date end where id = $1`, [k, monto]);
    await c.query(`update collection_payments set aplicado_centavos = aplicado_centavos + $2,
      estado = case when aplicado_centavos + $2 >= monto_centavos then 'aplicado' else 'abierto' end where id = $1`, [p, monto]);
    return id;
  };
  const correo = async (c: Cliente, cargoId: string, tipo: string, secuencia: number) => {
    await c.query(`insert into collection_emails (id, company_id, charge_id, tipo, secuencia, estado, enlace_hash, enlace_vence, solicitado_por)
      values ($1, $2, $3, $4, $5, 'enviando', $6, '2026-12-31', $7)`,
    [randomUUID(), E, cargoId, tipo, secuencia, createHash("sha256").update(randomUUID()).digest("hex"), A]);
  };

  // El camino válido pasa: si no, cualquier rechazo de abajo podría venir de otra cosa.
  await acepta("control: cargo, pago y aplicación completa", async (c) => { const k = await cargo(c); await aplicar(c, await pago(c), k, 100_000); });

  // X1-X17: la sonda de mutantes del revisor (revision-63-base-scripts/sonda-mutantes.mts), una aserción por regla.
  await rechaza("X1 cargo cancelado → emitido", "cargo_ya_resuelto", async (c) => {
    const k = await cargo(c);
    await c.query("update collection_charges set estado = 'cancelado', motivo = 'Cancelado por la prueba', resuelto_por = $2, resuelto_en = now() where id = $1", [k, A]);
    await c.query("update collection_charges set estado = 'emitido', motivo = null, resuelto_por = null, resuelto_en = null where id = $1", [k]);
  });
  await rechaza("X2 cambiar la referencia de un cargo emitido", "cobranza_inmutable", async (c) => {
    const k = await cargo(c);
    await c.query("update collection_charges set referencia = $2 where id = $1", [k, ref()]);
  });
  await rechaza("X3 cambiar el monto de un cargo emitido", "cobranza_inmutable", async (c) => {
    const k = await cargo(c);
    await c.query("update collection_charges set monto_centavos = 1 where id = $1", [k]);
  });
  await rechaza("X4 dos cargos de la empresa con la misma referencia", "collection_charges_referencia_unica", async (c) => {
    const r = ref();
    await cargo(c, 100_000, r);
    await cargo(c, 100_000, r);
  });
  await rechaza("X5 cargo a pagado sin aplicaciones", "cobranza_pagado_no_cuadra", async (c) => {
    const k = await cargo(c);
    await c.query("update collection_charges set estado = 'pagado', pagado_centavos = monto_centavos, pagado_el = current_date where id = $1", [k]);
  });
  await rechaza("X6 pago a aplicado sin aplicaciones", "cobranza_aplicado_no_cuadra", async (c) => {
    const p = await pago(c);
    await c.query("update collection_payments set estado = 'aplicado', aplicado_centavos = monto_centavos where id = $1", [p]);
  });
  await rechaza("X7 pago sin evento en la bitácora", "auditoria_de_cobranza_ausente", async (c) => { await pago(c, 100_000, randomUUID(), A, false); });
  const cargosDeAlfaVistosPorBeta = await acepta("X8 Beta cuenta los cargos de Alfa", async (c) =>
    (await c.query<{ n: number }>("select count(*)::int n from collection_charges where company_id = $1", [E])).rows[0]!.n, C, ids.adminB, ids.beta);
  assert.equal(cargosDeAlfaVistosPorBeta, 0, "X8: Beta ve cargos de Alfa");
  assert.equal(await acepta("X8 control: Alfa ve su cargo", async (c) =>
    (await c.query<{ n: number }>("select count(*)::int n from collection_charges where id = $1", [ids.k1])).rows[0]!.n), 1);
  await rechaza("X9 Beta aplica su pago al cargo de Alfa", "23503", async (c) => {
    const p = randomUUID();
    await evento(c, ids.beta, ids.adminB, "registrar_pago_cobranza", "collection_payments", p);
    await c.query(`insert into collection_payments (id, company_id, fuente, id_externo, monto_centavos, recibido_el, registrado_por)
      values ($1, $2, 'manual', $3, 100, '2026-11-10', $4)`, [p, ids.beta, p, ids.adminB]);
    const a = randomUUID();
    await evento(c, ids.beta, ids.adminB, "aplicacion_cobranza", "collection_applications", a);
    await c.query(`insert into collection_applications (id, company_id, payment_id, charge_id, monto_centavos, regla, aplicado_por)
      values ($1, $2, $3, $4, 100, 'manual', $5)`, [a, ids.beta, p, ids.k1, ids.adminB]);
  }, C, ids.adminB, ids.beta);
  await rechaza("X10 referencia que no cierra por Luhn", "collection_charges_referencia", async (c) => {
    const s = String(++n);
    await cargo(c, 100_000, `${s}${(luhn(s) + 1) % 10}`);
  });
  await rechaza("X11 el mismo evento de Fintoc dos veces", "collection_provider_events_unico", async (c) => {
    const evt = `evt_regla${randomUUID().slice(0, 8)}`;
    for (let i = 0; i < 2; i++) {
      const id = randomUUID();
      await evento(c, E, null, "aviso_fintoc", "collection_provider_events", id);
      await c.query("insert into collection_provider_events (id, company_id, proveedor, evento_id) values ($1, $2, 'fintoc', $3)", [id, E, evt]);
    }
  }, C, "", E);
  await rechaza("X12 dos renglones del estado de cuenta con la misma huella", "collection_statement_rows_huella_unica", async (c) => {
    const imp = randomUUID();
    await evento(c, E, A, "importar_estado_cuenta", "collection_statement_imports", imp);
    await c.query(`insert into collection_statement_imports (id, company_id, banco, nombre_archivo, huella_archivo, renglones, abonos, nuevos, subido_por)
      values ($1, $2, 'banorte', 'm.csv', $3, 2, 2, 2, $4)`, [imp, E, "f".repeat(64), A]);
    const h = randomUUID().replace(/-/g, "").padEnd(64, "0");
    for (let i = 0; i < 2; i++) {
      const id = randomUUID();
      await evento(c, E, A, "renglon_estado_cuenta", "collection_statement_rows", id);
      await c.query("insert into collection_statement_rows (id, company_id, import_id, huella, fecha, monto_centavos) values ($1, $2, $3, $4, '2026-11-09', 2500)", [id, E, imp, h]);
    }
  });
  await rechaza("X13 dos pagos manuales con el mismo id_externo", "collection_payments_externo_unico", async (c) => {
    const x = randomUUID();
    await pago(c, 100_000, x);
    await pago(c, 100_000, x);
  });
  await rechaza("X14 reversión por la mitad de la aplicación", "aplicacion_no_valida", async (c) => {
    const k = await cargo(c);
    const p = await pago(c);
    const a = await aplicar(c, p, k, 100_000);
    const r = randomUUID();
    await evento(c, E, A, "aplicacion_cobranza", "collection_applications", r);
    await c.query(`insert into collection_applications (id, company_id, payment_id, charge_id, monto_centavos, regla, revierte_a, aplicado_por)
      values ($1, $2, $3, $4, -50000, 'reversion', $5, $6)`, [r, E, p, k, a, A]);
    await c.query("update collection_charges set pagado_centavos = 50000, estado = 'emitido', pagado_el = null where id = $1", [k]);
    await c.query("update collection_payments set aplicado_centavos = 50000, estado = 'abierto' where id = $1", [p]);
  });
  // Las dos restricciones dicen lo mismo (aplicado ≤ monto); quitar una sola no cambia la regla (MU17 es equivalente).
  await rechaza("X15 un pago de 1,000 aplicado 1,600", ["collection_payments_aplicado", "collection_payments_estado"], async (c) => {
    const k = await cargo(c, 200_000);
    const p = await pago(c, 100_000);
    await aplicar(c, p, k, 80_000);
    await aplicar(c, p, k, 80_000);
  });
  await rechaza("X16 la contadora registra un pago", "sin_permiso_para_cobranza", async (c) => { await pago(c, 100_000, randomUUID(), ids.contador); },
    C, ids.contador, E);
  await rechaza("X17 reescribir el monto de una aplicación", "42501", async (c) => {
    const k = await cargo(c);
    const p = await pago(c);
    const a = await aplicar(c, p, k, 50_000);
    await c.query("update collection_applications set monto_centavos = 40000 where id = $1", [a]);
  });

  // La llave del cron: el mismo (plan, periodo) no se emite dos veces.
  await rechaza("llave del cron (plan, periodo)", "collection_charges_periodo_unico", async (c) => {
    const id = randomUUID();
    await evento(c, E, A, "emitir_cargo", "collection_charges", id);
    await c.query(`insert into collection_charges (id, company_id, customer_id, plan_id, periodo, concepto, monto_centavos, vencimiento, referencia, estado, emitido_en, emitido_por, creado_por)
      values ($1, $2, $3, $4, $5, 'Repetido', 100000, '2026-11-15', $6, 'emitido', now(), $7, $7)`, [id, E, ids.c1, ids.plan1, ids.periodo1, ref(), A]);
  });

  // La llave del correo: el mismo (cargo, tipo, secuencia) no se manda dos veces.
  await rechaza("llave del correo (cargo, tipo, secuencia)", "collection_emails_unico", async (c) => {
    await correo(c, ids.k1, "reenvio", 3);
    await correo(c, ids.k1, "reenvio", 3);
  });

  // Reenvío: hasta 5 (RFC), no 6.
  await acepta("reenvío 5", async (c) => { await correo(c, ids.k1, "reenvio", 5); });
  await rechaza("reenvío 6", "collection_emails_tipo", async (c) => { await correo(c, ids.k1, "reenvio", 6); });

  // base-N1: pagado_el no se reescribe mientras siga pagado; emitido_en y resuelto_en los sella la base.
  await rechaza("base-N1 pagado_el de un cargo pagado", "cobranza_inmutable", async (c) => {
    const k = await cargo(c);
    await aplicar(c, await pago(c), k, 100_000);
    await c.query("update collection_charges set pagado_el = '2020-01-01' where id = $1", [k]);
  });
  const sellos = await acepta("base-N1 emitido_en y resuelto_en mandados como 2020-01-01", async (c) => {
    const emitido = await cargo(c, 100_000, ref(), "'2020-01-01T00:00:00Z'");
    const cancelado = await cargo(c);
    await c.query("update collection_charges set estado = 'cancelado', motivo = 'Cancelado por la prueba', resuelto_por = $2, resuelto_en = '2020-01-01T00:00:00Z' where id = $1", [cancelado, A]);
    return (await c.query<{ emitido: boolean; resuelto: boolean }>(`select
        (select emitido_en = now() from collection_charges where id = $1) emitido,
        (select resuelto_en = now() from collection_charges where id = $2) resuelto`, [emitido, cancelado])).rows[0];
  });
  assert.deepEqual(sellos, { emitido: true, resuelto: true }, "base-N1: la base no selló las fechas");

  // base-N4: con `public, pg_temp` las definers no leen las tablas temporales del que llama.
  const sombraDestino = await acepta("base-N4 cobranza_destino_fintoc con collection_provider_accounts temporal", async (c) => {
    await c.query("create temp table collection_provider_accounts (company_id uuid, proveedor text, cuenta_id text)");
    await c.query("insert into collection_provider_accounts values ($1, 'fintoc', 'acc_Sombra1')", [ids.beta]);
    return (await c.query("select company_id from cobranza_destino_fintoc('acc_Sombra1', 'acno_sombra1')")).rows;
  }, C, "", "");
  assert.deepEqual(sombraDestino, [], "base-N4: cobranza_destino_fintoc leyó la tabla temporal y devolvió Beta");
  const falso = createHash("sha256").update(randomUUID()).digest("hex");
  const sombraEnlace = await acepta("base-N4 cobranza_por_enlace con collection_emails temporal", async (c) => {
    await c.query("create temp table collection_emails (company_id uuid, charge_id uuid, enlace_hash text, enlace_vence date)");
    await c.query("insert into collection_emails values ($1, $2, $3, '2099-01-01')", [ids.beta, ids.kb, falso]);
    return (await c.query("select referencia from cobranza_por_enlace($1)", [falso])).rows;
  }, C, "", E);
  assert.deepEqual(sombraEnlace, [], "base-N4: cobranza_por_enlace leyó la tabla temporal y devolvió el cargo de Beta");

  // r63-N2: una referencia con 0 inicial no existe (el consecutivo empieza en 100000).
  await rechaza("referencia con 0 inicial", "collection_charges_referencia", async (c) => {
    const s = "012345";
    await cargo(c, 100_000, `${s}${luhn(s)}`);
  });

  // Una persona no marca un pago como devuelto: eso solo lo hace el aviso del proveedor.
  await rechaza("pago manual a devuelto", "sin_permiso_para_cobranza", async (c) => {
    const p = await pago(c);
    await c.query("update collection_payments set estado = 'devuelto' where id = $1", [p]);
  });
}
