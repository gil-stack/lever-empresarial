import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { hoyEnMexico } from "../../src/dominio/personas.ts";
import type { ContextoConEmpresa } from "../../src/nucleo/contexto.ts";
import { cerrarConexion } from "../../src/nucleo/db.ts";
import { auditar } from "../../src/server/bitacora/auditar.ts";
import { darDeAltaComoDuena } from "../../scripts/empresa-por-la-duena.ts";
import type { MensajeCorreo } from "../../src/server/correo/tipos.ts";
import { correrAlertasDeCaja } from "../../src/server/flujo/alertas-caja.ts";
import { configurarMesesMinimos } from "../../src/server/flujo/runway.ts";
import { cancelarCobro, declararSaldo, registrarCobro, registrarObligacion } from "../../src/server/flujo/servicio.ts";
import { nombrarCentro } from "../../src/server/personas/servicio.ts";
import { contextoDePersonal } from "../../src/server/plataforma/servicio.ts";
import { aplicarArchivo, conBaseDesechable, consultarJson, ejecutar, exigirBaseDesechable, urlDeAplicacion } from "../aislamiento/postgres.ts";
import { administrador, HOY, persona, sembrarPersonal } from "../cobranza/siembra.ts";

/**
 * Las reglas clave de la 0032, una por una, con el error crudo de Postgres (r64-base-N5): la sonda Y1-Y19 del
 * revisor, las fechas que pone la base (N2) y el contador de cruces (N3). Cada regla corre en su transacción con
 * `pg.Client` como `src/nucleo/db.ts`, fuerza los diferidos y revierte. Sin `conContexto`, que traduce los errores.
 */

const urlAdmin = process.env.AISLAMIENTO_DATABASE_URL?.trim() ?? "";
const C = "plataforma_cliente";
/** La semana de la prueba: HOY (martes 10 de noviembre de 2026) cae en la del lunes 9. */
const HOY_FIJO = "2026-11-10";
const LUNES = "2026-11-09";

type Cliente = InstanceType<typeof pg.Client>;
type Ids = { operador: string; alfa: string; beta: string; admin: string; adminB: string; contador: string; finanzas: string; alertaAlfa: string };
type Resultado = { ok: true; valor: unknown } | { ok: false; code?: string; constraint?: string; message: string };

describe("Runway: reglas de la base (0032)", { skip: urlAdmin.length === 0 }, () => {
  it("cada regla clave rechaza con su propio error, la base pone fechas y cruces, y un cruce da un solo aviso", async () => {
    exigirBaseDesechable();
    await conBaseDesechable(urlAdmin, async (url) => {
      const dir = join(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");
      for (const archivo of readdirSync(dir).sort()) {
        if (archivo.endsWith(".sql")) aplicarArchivo(url, join(dir, archivo));
      }
      ejecutar(url, `do $$ begin execute format('alter database %I set timezone to %L', current_database(), 'UTC'); end $$;`);
      // caja_hoy() de producción es la fecha real de México; después la prueba la fija en su semana.
      const hoyReal = consultarJson<{ d: string }[]>(url, "select json_agg(json_build_object('d', caja_hoy()::text))")[0]!.d;
      assert.ok([hoyEnMexico(new Date(Date.now() - 60_000)), hoyEnMexico(new Date())].includes(hoyReal), `caja_hoy() = ${hoyReal}`);
      ejecutar(url, `create or replace function caja_hoy() returns date language sql stable set search_path = public, pg_temp as $$ select date '${HOY_FIJO}' $$`);
      await cerrarConexion();
      const previo = process.env.DATABASE_URL;
      const app = urlDeAplicacion(url);
      process.env.DATABASE_URL = app;
      try {
        const { ids, admin } = await sembrar(url);
        await reglas(url, app, ids);
        await tareaReal(url, ids, admin);
      } finally {
        await cerrarConexion();
        if (previo === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = previo;
      }
    });
  });
});

const enviador = () => async (m: MensajeCorreo) => {
  assert.match(m.para, /@ejemplo\.mx$/);
  return { id: randomUUID() };
};
const tarea = () => correrAlertasDeCaja({ ahora: HOY, auditar, enviador, urlPublica: () => "https://lever.ejemplo.mx", registrar: () => {}, ritmoMs: 0 });
const uno = <T>(url: string, sql: string) => consultarJson<T[]>(url, `select json_agg(x) from (${sql}) x`)[0]!;
const contar = (url: string, sql: string) => uno<{ n: number }>(url, `select count(*)::int as n from (${sql}) y`).n;

/** Alfa con saldo de $300,000 y renta de $100,000 (runway bajo): una corrida deja su estado, su aviso y su foto. Beta, sin nada. */
async function sembrar(url: string): Promise<{ ids: Ids; admin: ContextoConEmpresa }> {
  sembrarPersonal(url);
  const personal = await contextoDePersonal("personal-cobranza@ejemplo.mx");
  const alfa = await darDeAltaComoDuena(url, personal, { rfc: "TCM010101AB1", razonSocial: "Alfa Reglas Runway", codigoPostal: "06600", regimen: "601", usoCfdi: "G03" }, { demostracion: false, corridoPor: "pruebas@ejemplo.mx" });
  const beta = await darDeAltaComoDuena(url, personal, { rfc: "CABL840215RF4", razonSocial: "Beta Reglas Runway", codigoPostal: "44100", regimen: "612", usoCfdi: "G03" }, { demostracion: false, corridoPor: "pruebas@ejemplo.mx" });
  const [admin] = await administrador(url, personal, alfa, "admin-alfa-reglas-runway@ejemplo.mx");
  await administrador(url, personal, beta, "admin-beta-reglas-runway@ejemplo.mx");
  const centro = await nombrarCentro(admin, { nombre: "Operación" }, { ahora: HOY });
  await persona(url, admin, centro.id, "Contadora", "contadora-reglas-runway@ejemplo.mx", ["contador"]);
  await persona(url, admin, centro.id, "Finanzas", "finanzas-reglas-runway@ejemplo.mx", ["tarjetahabiente", "finanzas"]);
  const D = { ahora: HOY };
  await declararSaldo(admin, { saldo: "300000.00", alDia: "2026-11-09", altaId: randomUUID() }, D);
  await registrarObligacion(admin, { concepto: "Renta", monto: "100000.00", frecuencia: "mensual", proximaFecha: "2026-11-20", altaId: randomUUID() }, D);
  await configurarMesesMinimos(admin, { meses: "4" }, D);
  const r = await tarea();
  assert.deepEqual([r.avisos, r.fotos], [1, 1]);
  const usuario = (correo: string) => uno<{ id: string }>(url, `select id from users where correo = '${correo}'`).id;
  const ids = {
    operador: uno<{ id: string }>(url, "select id from operators order by alta_en limit 1").id,
    alfa: alfa.id, beta: beta.id,
    admin: usuario("admin-alfa-reglas-runway@ejemplo.mx"), adminB: usuario("admin-beta-reglas-runway@ejemplo.mx"),
    contador: usuario("contadora-reglas-runway@ejemplo.mx"), finanzas: usuario("finanzas-reglas-runway@ejemplo.mx"),
    alertaAlfa: uno<{ id: string }>(url, `select id from cash_alerts where company_id = '${alfa.id}'`).id,
  };
  return { ids, admin };
}

async function reglas(url: string, app: string, ids: Ids): Promise<void> {
  const A = ids.alfa;

  async function abrir(usuario: string, empresa: string, rol = C): Promise<Cliente> {
    const c = new pg.Client({ connectionString: app });
    await c.connect();
    await c.query("begin");
    await c.query(`set local role ${rol}`);
    await c.query("select set_config('app.company_id', $1, true), set_config('app.user_id', $2, true), set_config('app.operator_id', $3, true)",
      [empresa, usuario, ids.operador]);
    return c;
  }
  /** Una transacción como la abre la aplicación; siempre revierte. Sin persona en el contexto: es la tarea. */
  async function como(pasos: (c: Cliente) => Promise<unknown>, usuario = "", empresa = A, rol = C): Promise<Resultado> {
    const c = await abrir(usuario, empresa, rol);
    try {
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
  async function rechaza(regla: string, esperado: string, pasos: (c: Cliente) => Promise<unknown>, usuario = "", empresa = A, rol = C) {
    const r = await como(pasos, usuario, empresa, rol);
    assert.equal(r.ok, false, `${regla}: la base lo aceptó (esperado ${esperado})`);
    if (r.ok) return;
    assert.ok([r.code, r.constraint, r.message].includes(esperado), `${regla}: esperado ${esperado}, dio ${r.code} [${r.constraint ?? ""}] ${r.message}`);
  }
  async function acepta<T>(regla: string, pasos: (c: Cliente) => Promise<T>, usuario = "", empresa = A, rol = C): Promise<T> {
    const r = await como(pasos, usuario, empresa, rol);
    assert.ok(r.ok, `${regla}: la base lo rechazó: ${r.ok ? "" : `${r.code} [${r.constraint ?? ""}] ${r.message}`}`);
    return (r as { valor: T }).valor;
  }

  const evento = (c: Cliente, empresa: string, actor: string | null, accion: string, entidad: string, fila: string) => c.query(
    `insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, origen)
     values ($1, $2, $3, $4, 'cliente', $5, $6, $7, 'tarea')`, [ids.operador, empresa, actor ? "miembro" : "sistema", actor, accion, entidad, fila]);
  /** El runway de Alfa se apaga y se vuelve a prender: un cruce nuevo. */
  const cruzar = async (c: Cliente) => {
    await evento(c, A, null, "estado_alerta_caja", "cash_alert_states", A);
    await c.query("update cash_alert_states set runway_bajo = false where company_id = $1", [A]);
    await c.query("update cash_alert_states set runway_bajo = true where company_id = $1", [A]);
  };
  /** Un aviso de runway apartado; `columnas` y `valores` agregan lo que manda quien escribe (para ver que la base lo ignora). */
  const nuevoAviso = async (c: Cliente, columnas = "", valores = "") => {
    const id = randomUUID();
    await c.query(`insert into cash_alerts (id, company_id, colchon, runway, colchon_centavos, runway_semanas, horizonte_semanas, meses_minimos, estado${columnas})
      values ($1, $2, false, true, 0, 13, 52, 4, 'enviando'${valores})`, [id, A]);
    return id;
  };
  const aviso = async (c: Cliente) => { await cruzar(c); return nuevoAviso(c); };
  const cerrar = async (c: Cliente, id: string, estado: string, accion = "alerta_caja", extra = "") => {
    if (accion) await evento(c, A, null, accion, "cash_alerts", id);
    await c.query(`update cash_alerts set estado = $2${extra ? `, ${extra}` : ""} where id = $1`, [id, estado]);
  };
  const foto = async (c: Cliente, semana: string, tomadaEn = "now()") => {
    const id = randomUUID();
    await evento(c, A, null, "foto_runway", "cash_runway_snapshots", id);
    await c.query(`insert into cash_runway_snapshots (id, company_id, semana, semanas_conservador, semanas_esperado, horizonte_semanas, saldo_centavos, saldo_al_dia, colchon_centavos, meses_minimos, tomada_en)
      values ($1, $2, $3, 10, 10, 52, 1, '2026-10-26', 0, 4, ${tomadaEn})`, [id, A, semana]);
    return id;
  };
  const entrega = async (c: Cliente, alerta: string, quien: string, empresa = A) => {
    const id = randomUUID();
    await evento(c, empresa, null, "alerta_caja_entregada", "cash_alert_deliveries", id);
    await c.query("insert into cash_alert_deliveries (id, company_id, alert_id, user_id) values ($1, $2, $3, $4)", [id, empresa, alerta, quien]);
  };
  const ajuste = async (c: Cliente, quien: string, meses: number, firma = quien) => {
    await evento(c, A, quien, "configurar_runway", "cash_runway_settings", A);
    await c.query(`insert into cash_runway_settings (company_id, meses_minimos, actualizado_por) values ($1, $2, $3)
      on conflict (company_id) do update set meses_minimos = excluded.meses_minimos, actualizado_por = excluded.actualizado_por`, [A, meses, firma]);
  };

  // El camino válido pasa.
  await acepta("control: cruce, aviso, cierre, entrega y foto de la semana", async (c) => {
    const id = await aviso(c);
    await cerrar(c, id, "enviado");
    await entrega(c, id, ids.admin);
    await foto(c, "2026-11-02");
  });

  // Y1-Y19: la sonda del revisor (revision-64-base-scripts/sonda-64-mutantes.mts).
  await rechaza("Y1 una persona escribe el estado", "alerta_solo_del_sistema",
    (c) => c.query("update cash_alert_states set runway_bajo = false where company_id = $1", [A]), ids.admin);
  await rechaza("Y2 alta de un aviso ya enviado", "alerta_no_valida", async (c) => {
    await cruzar(c);
    const id = randomUUID();
    await evento(c, A, null, "alerta_caja", "cash_alerts", id);
    await c.query(`insert into cash_alerts (id, company_id, colchon, runway, colchon_centavos, runway_semanas, horizonte_semanas, meses_minimos, estado, terminado_en)
      values ($1, $2, false, true, 0, 13, 52, 4, 'enviado', now())`, [id, A]);
  });
  await rechaza("Y3 enviado → enviando", "alerta_ya_cerrada", async (c) => {
    const id = await aviso(c);
    await cerrar(c, id, "enviado");
    await c.query("update cash_alerts set estado = 'enviando', intentos = intentos + 1 where id = $1", [id]);
  });
  await rechaza("Y4 cambiar runway_semanas al cerrar", "alerta_inmutable", async (c) => { await cerrar(c, await aviso(c), "enviado", "alerta_caja", "runway_semanas = 1"); });
  await rechaza("Y5 fallido → enviando sin contar el intento", "alerta_ya_cerrada", async (c) => {
    const id = await aviso(c);
    await cerrar(c, id, "fallido");
    await c.query("update cash_alerts set estado = 'enviando' where id = $1", [id]);
  });
  await rechaza("Y6 dos entregas del mismo aviso a la misma persona", "cash_alert_deliveries_unica", async (c) => {
    const id = await aviso(c);
    await entrega(c, id, ids.admin);
    await entrega(c, id, ids.admin);
  });
  await rechaza("Y7 dos fotos de la misma semana", "cash_runway_snapshots_pkey", async (c) => { await foto(c, "2026-11-02"); await foto(c, "2026-11-02"); });
  await rechaza("Y8 foto en martes", "foto_fuera_de_semana", (c) => foto(c, HOY_FIJO));
  await rechaza("Y9 cerrar un aviso sin evento", "auditoria_de_flujo_ausente", async (c) => { await cerrar(c, await aviso(c), "enviado", ""); });
  await rechaza("Y10 cerrar un aviso con el evento de otra acción", "auditoria_de_flujo_ausente", async (c) => { await cerrar(c, await aviso(c), "enviado", "foto_runway"); });
  assert.equal(await acepta("Y11 Beta cuenta los avisos de Alfa", async (c) => (await c.query<{ n: number }>("select count(*)::int n from cash_alerts where company_id = $1", [A])).rows[0]!.n, "", ids.beta), 0);
  assert.equal(await acepta("Y11 control: Alfa ve su aviso", async (c) => (await c.query<{ n: number }>("select count(*)::int n from cash_alerts")).rows[0]!.n), 1);
  await rechaza("Y12 Beta registra una entrega con el aviso de Alfa", "23503", (c) => entrega(c, ids.alertaAlfa, ids.adminB, ids.beta), "", ids.beta);
  await rechaza("Y13 el contador cambia el mínimo", "sin_permiso_para_flujo", (c) => ajuste(c, ids.contador, 2), ids.contador);
  await rechaza("Y14 finanzas cambia el mínimo firmando como el admin", "sin_permiso_para_flujo", (c) => ajuste(c, ids.finanzas, 2, ids.admin), ids.finanzas);
  await rechaza("Y15 mínimo de 13 meses", "cash_runway_meses", (c) => ajuste(c, ids.admin, 13), ids.admin);
  await rechaza("Y16 reescribir una entrega (sin grant de UPDATE)", "42501", (c) => c.query("update cash_alert_deliveries set entregado_en = now() where company_id = $1", [A]));
  await rechaza("Y17 plataforma_cliente pide la puerta de la tarea", "42501", (c) => c.query("select * from empresas_para_alertas_de_caja()"));
  // Y18: un aviso cerrado siempre tiene su hora de cierre; ahora la pone la base aunque quien escribe mande nula (N2).
  assert.equal(await acepta("Y18 cerrar un aviso mandando terminado_en nulo", async (c) => {
    const id = await aviso(c);
    await cerrar(c, id, "enviado", "alerta_caja", "terminado_en = null");
    return (await c.query<{ ok: boolean }>("select terminado_en is not null as ok from cash_alerts where id = $1", [id])).rows[0]!.ok;
  }), true);
  {
    // Y19: la puerta de la tarea no entrega una empresa suspendida (dentro de una transacción que se revierte).
    const d = new pg.Client({ connectionString: url });
    await d.connect();
    try {
      await d.query("begin");
      await d.query("set local session_replication_role = replica");
      await d.query("update companies set estado = 'suspendida' where id = $1", [ids.alfa]);
      await d.query("set local role plataforma_tarea");
      const n = (await d.query<{ n: number }>("select count(*)::int n from empresas_para_alertas_de_caja() where company_id = $1", [ids.alfa])).rows[0]!.n;
      assert.equal(n, 0, "Y19: la tarea evalúa una empresa suspendida");
    } finally {
      await d.query("rollback");
      await d.end();
    }
  }

  // r65-N1 en la 0032: con `public, pg_temp` la puerta de la tarea no lee una tabla temporal de quien la llama.
  // Desde la 0029 (#65) la tarea ya no crea tablas temporales; se le presta el permiso solo para esta sonda
  // (como en tests/esquema/definer-search-path.test.ts), para que el search_path de la 0032 se pruebe por sí solo.
  const temporal = (accion: "grant" | "revoke") => ejecutar(url,
    `do $$ begin execute format('${accion} temporary on database %I ${accion === "grant" ? "to" : "from"} plataforma_tarea', current_database()); end $$;`);
  const sinTemporal = (cuando: string) => rechaza(`${cuando}: sin el permiso de la 0029 no hay tablas temporales`, "42501",
    (c) => c.query("create temp table cash_balance_declarations (company_id uuid)"), "", "", "plataforma_tarea");
  // r63c-N1: el préstamo va con psql en autocommit (plataforma_app no puede darlo), fuera de la transacción de la sonda.
  // Se devuelve en un finally aunque la sonda falle, y después se vuelve a exigir el 42501.
  async function conTemporalPrestado<T>(sonda: () => Promise<T>): Promise<T> {
    temporal("grant");
    try {
      return await sonda();
    } finally {
      temporal("revoke");
      await sinTemporal("después del préstamo");
    }
  }
  await sinTemporal("antes del préstamo");
  // Una sonda que falla no deja el permiso prestado.
  await assert.rejects(() => conTemporalPrestado(async () => { throw new Error("sonda forzada a fallar"); }), /sonda forzada a fallar/);
  const sombra = await conTemporalPrestado(() => acepta("pg_temp: la puerta de la tarea con una tabla temporal cash_balance_declarations", async (c) => {
    await c.query("create temp table cash_balance_declarations (company_id uuid)");
    await c.query("insert into cash_balance_declarations values ($1)", [ids.beta]);
    return (await c.query("select company_id from empresas_para_alertas_de_caja() where company_id = $1", [ids.beta])).rows;
  }, "", "", "plataforma_tarea"));
  assert.deepEqual(sombra, [], "pg_temp: la puerta de la tarea leyó la tabla temporal");

  // r64-base-N2: la base pone las horas y la semana de la foto; lo que mande quien escribe se ignora.
  const viejo = "'2020-01-01T00:00:00Z'";
  assert.deepEqual(await acepta("N2 fechas de un aviso, de su cierre, del estado y de la foto", async (c) => {
    await cruzar(c);
    await c.query(`update cash_alert_states set actualizado_en = ${viejo} where company_id = $1`, [A]);
    const id = await nuevoAviso(c, ", detectado_en, intentado_en", `, ${viejo}, ${viejo}`);
    await cerrar(c, id, "enviado", "alerta_caja", `terminado_en = ${viejo}`);
    const f = await foto(c, "2026-11-02", `'2001-01-01T00:00:00Z'`);
    return (await c.query(`select
        (select detectado_en > '2026-01-01' and intentado_en = detectado_en and terminado_en > '2026-01-01' from cash_alerts where id = $1) as aviso,
        (select actualizado_en = now() from cash_alert_states where company_id = $2) as estado,
        (select tomada_en = now() from cash_runway_snapshots where id = $3) as foto`, [id, A, f])).rows[0];
  }), { aviso: true, estado: true, foto: true });
  assert.equal(await acepta("N2 actualizado_en del mínimo", async (c) => {
    await evento(c, A, ids.admin, "configurar_runway", "cash_runway_settings", A);
    await c.query(`insert into cash_runway_settings (company_id, meses_minimos, actualizado_por, actualizado_en) values ($1, 5, $2, ${viejo})
      on conflict (company_id) do update set meses_minimos = 5, actualizado_por = $2, actualizado_en = ${viejo}`, [A, ids.admin]);
    return (await c.query<{ ok: boolean }>("select actualizado_en = now() as ok from cash_runway_settings where company_id = $1", [A])).rows[0]!.ok;
  }, ids.admin), true);
  assert.equal(await acepta("N2 reintento: fallido → enviando cuenta desde ahora", async (c) => {
    const id = await aviso(c);
    await cerrar(c, id, "fallido");
    await c.query(`update cash_alerts set estado = 'enviando', intentos = intentos + 1, intentado_en = ${viejo}, terminado_en = ${viejo} where id = $1`, [id]);
    return (await c.query<{ ok: boolean }>("select intentado_en > '2026-01-01' and terminado_en is null as ok from cash_alerts where id = $1", [id])).rows[0]!.ok;
  }), true);
  // La de esta semana ya la tomó la tarea al sembrar; la anterior también cabe.
  assert.equal(contar(url, `select 1 from cash_runway_snapshots where company_id = '${A}' and semana = '${LUNES}'`), 1);
  await acepta("N2 foto de la semana anterior", (c) => foto(c, "2026-11-02"));
  await rechaza("N2 foto de una semana futura", "foto_fuera_de_semana", (c) => foto(c, "2026-11-16"));
  await rechaza("N2 foto de hace dos semanas", "foto_fuera_de_semana", (c) => foto(c, "2026-10-26"));
  await rechaza("N2 foto de 2001", "foto_fuera_de_semana", (c) => foto(c, "2001-01-01"));

  // r64-base-N3: el contador de cruces lo lleva la base y cada cruce admite un solo aviso.
  assert.deepEqual(await acepta("N3 los contadores ignoran lo que manda quien escribe", async (c) => {
    await evento(c, A, null, "estado_alerta_caja", "cash_alert_states", A);
    const antes = (await c.query<{ n: number }>("select cruces_runway as n from cash_alert_states where company_id = $1", [A])).rows[0]!.n;
    await c.query("update cash_alert_states set cruces_runway = 99, cruces_colchon = 99 where company_id = $1", [A]);
    await c.query("update cash_alert_states set runway_bajo = false where company_id = $1", [A]);
    await c.query("update cash_alert_states set runway_bajo = true, cruces_runway = 0 where company_id = $1", [A]);
    const despues = (await c.query<{ r: number; k: number }>("select cruces_runway as r, cruces_colchon as k from cash_alert_states where company_id = $1", [A])).rows[0]!;
    return [antes, despues.r, despues.k];
  }), [1, 2, 0]);
  assert.deepEqual(await acepta("N3 el aviso lleva el número de su cruce, no el que mande quien escribe", async (c) => {
    await cruzar(c);
    const id = randomUUID();
    await c.query(`insert into cash_alerts (id, company_id, colchon, runway, colchon_centavos, runway_semanas, horizonte_semanas, meses_minimos, estado, cruce_runway, cruce_colchon)
      values ($1, $2, false, true, 0, 13, 52, 4, 'enviando', 50, 7)`, [id, A]);
    return (await c.query("select cruce_runway, cruce_colchon from cash_alerts where id = $1", [id])).rows[0];
  }), { cruce_runway: 2, cruce_colchon: null });
  await rechaza("N3 un segundo aviso del mismo cruce", "cash_alerts_un_aviso_por_cruce_runway", async (c) => { await nuevoAviso(c); });
  // r64b-N1: la misma llave para el colchón. El índice existe y dos avisos del mismo cruce de colchón chocan con él.
  assert.equal(contar(url, "select 1 from pg_indexes where indexname = 'cash_alerts_un_aviso_por_cruce_colchon' and indexdef like '%UNIQUE%(company_id, cruce_colchon) WHERE colchon'"), 1,
    "falta el índice único del cruce de colchón");
  const avisoDeColchon = (c: Cliente) => c.query(`insert into cash_alerts (id, company_id, colchon, runway, faltante_inicio, faltante_saldo_centavos, faltante_motivo, colchon_centavos, horizonte_semanas, meses_minimos, estado)
    values ($1, $2, true, false, '2027-01-18', 0, 'colchon', 0, 52, 4, 'enviando')`, [randomUUID(), A]);
  const cruzarColchon = async (c: Cliente) => {
    await evento(c, A, null, "estado_alerta_caja", "cash_alert_states", A);
    await c.query("update cash_alert_states set bajo_colchon = false where company_id = $1", [A]);
    await c.query("update cash_alert_states set bajo_colchon = true where company_id = $1", [A]);
  };
  await acepta("r64b-N1 control: un aviso por el cruce de colchón", async (c) => { await cruzarColchon(c); await avisoDeColchon(c); });
  await rechaza("r64b-N1 un segundo aviso del mismo cruce de colchón", "cash_alerts_un_aviso_por_cruce_colchon", async (c) => {
    await cruzarColchon(c);
    await avisoDeColchon(c);
    await avisoDeColchon(c);
  });
  await rechaza("N3 un aviso sin cruce (la bandera apagada)", "alerta_sin_cruce", async (c) => {
    await evento(c, A, null, "estado_alerta_caja", "cash_alert_states", A);
    await c.query("update cash_alert_states set runway_bajo = false where company_id = $1", [A]);
    await nuevoAviso(c);
  });
  await rechaza("N3 un aviso de colchón con el colchón apagado", "alerta_sin_cruce", async (c) => {
    await cruzar(c);
    await c.query(`insert into cash_alerts (id, company_id, colchon, runway, faltante_inicio, faltante_saldo_centavos, faltante_motivo, colchon_centavos, horizonte_semanas, meses_minimos, estado)
      values ($1, $2, true, false, '2027-01-18', 0, 'colchon', 0, 52, 4, 'enviando')`, [randomUUID(), A]);
  });
  await rechaza("N3 el cruce de un aviso no se reescribe", "alerta_inmutable", async (c) => {
    const id = await aviso(c);
    await cerrar(c, id, "enviado", "alerta_caja", "cruce_runway = 1");
  });
  await rechaza("N3 la fila del estado no se borra", "42501", (c) => c.query("delete from cash_alert_states where company_id = $1", [A]));

  // N3, sin el candado del servidor: dos conexiones avisan el mismo cruce a la vez; la segunda espera y choca.
  const preparar = await abrir("", A);
  await cruzar(preparar);
  await preparar.query("set constraints all immediate");
  await preparar.query("commit");
  await preparar.end();
  const avisosAntes = contar(url, `select 1 from cash_alerts where company_id = '${A}'`);
  const [uno1, dos] = [await abrir("", A), await abrir("", A)];
  try {
    await nuevoAviso(uno1);
    const segunda = nuevoAviso(dos).then(() => null, (e: { constraint?: string }) => e.constraint ?? "otro");
    await new Promise((r) => setTimeout(r, 300));
    await uno1.query("commit");
    assert.equal(await segunda, "cash_alerts_un_aviso_por_cruce_runway", "la segunda conexión debía chocar con la llave del cruce");
  } finally {
    await dos.query("rollback").catch(() => undefined);
    await uno1.end();
    await dos.end();
  }
  assert.equal(contar(url, `select 1 from cash_alerts where company_id = '${A}'`), avisosAntes + 1);
}

/** N3 con la tarea real: apagar, cruzar, dos corridas a la vez y otra más dan un solo aviso. */
async function tareaReal(url: string, ids: Ids, admin: ContextoConEmpresa): Promise<void> {
  const D = { ahora: HOY };
  const cobro = await registrarCobro(admin, { clienteNombre: "Cliente Grande", concepto: "Proyecto", monto: "500000.00", fechaProbable: "2026-11-25", altaId: randomUUID() }, D);
  await tarea();
  assert.deepEqual(uno<{ r: boolean }>(url, `select runway_bajo as r from cash_alert_states where company_id = '${ids.alfa}'`), { r: false });
  await cancelarCobro(admin, { id: cobro.id, motivo: "El cliente canceló el proyecto" }, D);
  const antes = contar(url, `select 1 from cash_alerts where company_id = '${ids.alfa}'`);
  const [a, b] = await Promise.all([tarea(), tarea()]);
  const c = await tarea();
  assert.equal(a.avisos + b.avisos + c.avisos, 1, "un cruce, un aviso");
  assert.equal(contar(url, `select 1 from cash_alerts where company_id = '${ids.alfa}'`), antes + 1);
}
