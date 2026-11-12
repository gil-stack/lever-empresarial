import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { cerrarConexion } from "../../src/nucleo/db.ts";
import { darDeAltaComoDuena } from "../../scripts/empresa-por-la-duena.ts";
import { nombrarCentro } from "../../src/server/personas/servicio.ts";
import { contextoDePersonal } from "../../src/server/plataforma/servicio.ts";
import { aplicarArchivo, conBaseDesechable, consultarJson, ejecutar, exigirBaseDesechable, urlDeAplicacion } from "../aislamiento/postgres.ts";
import { administrador, persona, sembrarPersonal } from "../cobranza/siembra.ts";

/**
 * Las reglas de la 0033 (Efevoo), una por una, con el error crudo de Postgres.
 * Cada regla corre en su transacción como la abre la aplicación (rol y
 * contexto con set_config local), fuerza los diferidos y revierte. La siembra
 * (vínculo y dos tarjetas activas de Alfa) sí se confirma.
 */

const urlAdmin = process.env.AISLAMIENTO_DATABASE_URL?.trim() ?? "";
const C = "plataforma_cliente";
const S = "plataforma_sofipo";

type Cliente = InstanceType<typeof pg.Client>;
type Ids = {
  operador: string; alfa: string; beta: string; demo: string;
  personal: string; cumplimiento: string;
  admin: string; liberador: string; titular: string; contador: string; solicitante: string; adminBeta: string;
  empleadoTitular: string; empleadoOtro: string;
  tarjetaTitular: string; tarjetaOtra: string;
};
type Resultado = { ok: true; valor: unknown } | { ok: false; code?: string; constraint?: string; message: string };

describe("Efevoo: reglas de la base (0033)", { skip: urlAdmin.length === 0 }, () => {
  it("cada regla rechaza con su propio error y las válidas pasan", async () => {
    exigirBaseDesechable();
    await conBaseDesechable(urlAdmin, async (url) => {
      const dir = join(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");
      for (const archivo of readdirSync(dir).sort()) {
        if (archivo.endsWith(".sql")) aplicarArchivo(url, join(dir, archivo));
      }
      await cerrarConexion();
      const previo = process.env.DATABASE_URL;
      const app = urlDeAplicacion(url);
      process.env.DATABASE_URL = app;
      try {
        const ids = await sembrar(url);
        await reglas(app, ids, url);
      } finally {
        await cerrarConexion();
        if (previo === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = previo;
      }
    });
  });
});

async function sembrar(url: string): Promise<Omit<Ids, "tarjetaTitular" | "tarjetaOtra">> {
  sembrarPersonal(url);
  const operador = consultarJson<{ id: string }[]>(url, "select json_agg(x) from (select id from operators order by alta_en limit 1) x")[0]!.id;
  // Personal vigente sin administración de la plataforma.
  ejecutar(url, `
    insert into users (id, nombre, correo, password_hash)
      values ('99999999-9999-4999-8999-999999999997', 'Cumplimiento', 'cumplimiento-efevoo@ejemplo.mx', '$2b$12$${"a".repeat(53)}');
    insert into platform_staff (operator_id, user_id, estado) values ('${operador}', '99999999-9999-4999-8999-999999999997', 'activo');
    insert into platform_staff_roles (operator_id, user_id, rol) values ('${operador}', '99999999-9999-4999-8999-999999999997', 'cumplimiento');
  `);
  const personal = await contextoDePersonal("personal-cobranza@ejemplo.mx");
  const alta = (rfc: string, razonSocial: string, demostracion: boolean) =>
    darDeAltaComoDuena(url, personal, { rfc, razonSocial, codigoPostal: "06600", regimen: rfc.length === 13 ? "612" : "601", usoCfdi: "G03" }, { demostracion, corridoPor: "pruebas@ejemplo.mx" });
  const alfa = await alta("TCM010101AB1", "Escuela Alfa Efevoo", false);
  const beta = await alta("CABL840215RF4", "Taller Beta Efevoo", false);
  const demo = await alta("DEM010101AB1", "Demostración Efevoo", true);
  const [admin] = await administrador(url, personal, alfa, "admin-alfa-efevoo@ejemplo.mx");
  await administrador(url, personal, beta, "admin-beta-efevoo@ejemplo.mx");
  const centro = await nombrarCentro(admin, { nombre: "Operación" }, { ahora: () => new Date("2026-11-10T18:00:00.000Z") });
  await persona(url, admin, centro.id, "Liberadora Efevoo", "liberadora-efevoo@ejemplo.mx", ["liberador"]);
  await persona(url, admin, centro.id, "Titular Efevoo", "titular-efevoo@ejemplo.mx", ["tarjetahabiente"]);
  await persona(url, admin, centro.id, "Otra Persona Efevoo", "otra-efevoo@ejemplo.mx", ["tarjetahabiente"]);
  await persona(url, admin, centro.id, "Contadora Efevoo", "contadora-efevoo@ejemplo.mx", ["contador"]);
  // Solicitante es un rol histórico que el alta ya no ofrece: se siembra como contador y la dueña le cambia el rol.
  await persona(url, admin, centro.id, "Solicitante Efevoo", "solicitante-efevoo@ejemplo.mx", ["contador"]);
  ejecutar(url, `set session_replication_role = replica;
    update membership_roles set rol = 'solicitante' where user_id = (select id from users where correo = 'solicitante-efevoo@ejemplo.mx');
    set session_replication_role = origin;`);
  const uno = <T>(sql: string) => consultarJson<T[]>(url, `select json_agg(x) from (${sql}) x`)[0]!;
  const usuario = (correo: string) => uno<{ id: string }>(`select id from users where correo = '${correo}'`).id;
  const empleado = (correo: string) => uno<{ id: string }>(`select e.id from employees e join users u on u.id = e.user_id where u.correo = '${correo}'`).id;
  return {
    operador, alfa: alfa.id, beta: beta.id, demo: demo.id,
    personal: usuario("personal-cobranza@ejemplo.mx"), cumplimiento: "99999999-9999-4999-8999-999999999997",
    admin: usuario("admin-alfa-efevoo@ejemplo.mx"), liberador: usuario("liberadora-efevoo@ejemplo.mx"),
    titular: usuario("titular-efevoo@ejemplo.mx"), contador: usuario("contadora-efevoo@ejemplo.mx"), solicitante: usuario("solicitante-efevoo@ejemplo.mx"),
    adminBeta: usuario("admin-beta-efevoo@ejemplo.mx"),
    empleadoTitular: empleado("titular-efevoo@ejemplo.mx"), empleadoOtro: empleado("otra-efevoo@ejemplo.mx"),
  };
}

type Op = {
  tipo: string; empresa?: string; tarjeta?: string | null; inventario?: number | null; terminacion?: string | null;
  empleado?: string | null; nombre?: string | null; monto?: number | null; motivo?: string | null;
  llave?: string; reintento?: string | null; referencia?: string; ambiente?: string; evento?: boolean;
};

async function reglas(app: string, base: Omit<Ids, "tarjetaTitular" | "tarjetaOtra">, duena: string): Promise<void> {
  const E = base.alfa;

  /** Una transacción como la abre la aplicación. Revierte salvo con `confirmar`. */
  async function como(pasos: (c: Cliente) => Promise<unknown>, rol: string, usuario: string, empresa: string | null = E, confirmar = false): Promise<Resultado> {
    const c = new pg.Client({ connectionString: app });
    await c.connect();
    try {
      await c.query("begin");
      await c.query(`set local role ${rol}`);
      await c.query("select set_config('app.company_id', $1, true), set_config('app.user_id', $2, true), set_config('app.operator_id', $3, true)",
        [empresa ?? "", usuario, rol === S ? base.operador : ""]);
      const valor = await pasos(c);
      await c.query("set constraints all immediate");
      await c.query(confirmar ? "commit" : "rollback");
      return { ok: true, valor };
    } catch (e) {
      const x = e as { code?: string; constraint?: string; message?: string };
      await c.query("rollback").catch(() => undefined);
      return { ok: false, code: x.code, constraint: x.constraint, message: x.message ?? String(e) };
    } finally {
      await c.end();
    }
  }
  async function rechaza(regla: string, esperado: string | string[], pasos: (c: Cliente) => Promise<unknown>, rol: string, usuario: string, empresa: string | null = E) {
    const esperados = typeof esperado === "string" ? [esperado] : esperado;
    const r = await como(pasos, rol, usuario, empresa);
    assert.equal(r.ok, false, `${regla}: la base lo aceptó (esperado ${esperados.join(" o ")})`);
    if (r.ok) return;
    assert.ok([r.code, r.constraint, r.message].some((x) => x !== undefined && esperados.includes(x)),
      `${regla}: esperado ${esperados.join(" o ")}, dio ${r.code} [${r.constraint ?? ""}] ${r.message}`);
  }
  async function acepta<T>(regla: string, pasos: (c: Cliente) => Promise<T>, rol: string, usuario: string, empresa: string | null = E, confirmar = false): Promise<T> {
    const r = await como(pasos, rol, usuario, empresa, confirmar);
    assert.ok(r.ok, `${regla}: la base lo rechazó: ${r.ok ? "" : `${r.code} [${r.constraint ?? ""}] ${r.message}`}`);
    return (r as { valor: T }).valor;
  }

  const evento = (c: Cliente, rol: string, actor: string, empresa: string, accion: string, fila: string) => c.query(
    `insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, origen)
     values ($1, $2, $3, $4, $5, $6, 'efevoo_operaciones', $7, 'consola')`,
    [base.operador, empresa, rol === S ? "personal" : "miembro", actor, rol === S ? "sofipo" : "cliente", accion, fila]);

  /** Asienta una operación con su evento. Devuelve el id insertado (nulo si la base no insertó otra). */
  async function asentar(c: Cliente, rol: string, actor: string, op: Op): Promise<string | null> {
    const id = randomUUID();
    const empresa = op.empresa ?? E;
    if (op.evento !== false) await evento(c, rol, actor, empresa, `efevoo_${op.tipo}`, id);
    const r = await c.query(
      `insert into efevoo_operaciones (id, company_id, operator_id, ambiente, tipo, tarjeta_id, tarjeta_inventario, terminacion, employee_id,
         nombre_tarjeta, monto_centavos, motivo, llave_intento, reintento_de, actor_tipo, creada_por${op.referencia ? ", referencia" : ""})
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16${op.referencia ? ", $17" : ""}) returning id`,
      [id, empresa, base.operador, op.ambiente ?? "sandbox", op.tipo, op.tarjeta ?? null, op.inventario ?? null, op.terminacion ?? null,
        op.empleado ?? null, op.nombre ?? null, op.monto ?? null, op.motivo ?? null, op.llave ?? randomUUID(), op.reintento ?? null,
        rol === S ? "personal" : "miembro", actor, ...(op.referencia ? [op.referencia] : [])]);
    return (r.rows[0]?.id as string | undefined) ?? null;
  }
  async function resolver(c: Cliente, rol: string, actor: string, id: string, estado: string, idEfevoo: string | null = null, codigo: string | null = null) {
    await evento(c, rol, actor, E, `efevoo_${estado}`, id);
    await c.query("select efevoo_resolver_operacion($1, $2, $3, $4)", [id, estado, idEfevoo, codigo]);
  }
  const P = base.personal;
  /** Un rechazo dentro de una transacción que sigue: con savepoint, para no abortarla. */
  async function falla(c: Cliente, paso: () => Promise<unknown>, esperado: RegExp) {
    await c.query("savepoint efevoo_prueba");
    await assert.rejects(paso(), esperado);
    await c.query("rollback to savepoint efevoo_prueba");
  }
  const leer = <T>(sql: string) => consultarJson<T[]>(duena, `select coalesce(jsonb_agg(x), '[]'::jsonb) from (${sql}) x`);

  // Siembra confirmada: alta de Alfa (idepCliente 206) y dos tarjetas activas, una del titular.
  await acepta("el personal da de alta a la empresa", async (c) => {
    const id = await asentar(c, S, P, { tipo: "alta_cliente" });
    await resolver(c, S, P, id!, "confirmada", "206");
  }, S, P, E, true);
  const tarjeta = async (inventario: number, terminacion: string, empleado: string | null, idEfevoo: string) => {
    await acepta(`asignar ${terminacion}`, async (c) => {
      const id = await asentar(c, S, P, { tipo: "asignacion", inventario, terminacion, empleado, nombre: "PRUEBA LEVER" });
      await resolver(c, S, P, id!, "confirmada", idEfevoo);
    }, S, P, E, true);
    const t = leer<{ id: string }>(`select id from efevoo_tarjetas where id_efevoo = ${idEfevoo}`)[0]!.id;
    await acepta(`activar ${terminacion}`, async (c) => {
      const id = await asentar(c, S, P, { tipo: "activacion", tarjeta: t });
      await resolver(c, S, P, id!, "confirmada");
    }, S, P, E, true);
    return t;
  };
  const ids: Ids = { ...base, tarjetaTitular: await tarjeta(557, "1363", base.empleadoTitular, "9001"), tarjetaOtra: await tarjeta(563, "0168", base.empleadoOtro, "9002") };
  assert.deepEqual(leer<{ estado: string }>("select estado from efevoo_tarjetas order by id_efevoo").map((x) => x.estado), ["activa", "activa"]);
  assert.equal(leer<{ idep_cliente: number }>(`select idep_cliente from efevoo_clientes where company_id = '${E}'`)[0]?.idep_cliente, 206);
  const T = ids.tarjetaTitular;

  // El camino válido de la empresa: la liberadora carga.
  await acepta("la liberadora carga una tarjeta activa", (c) => asentar(c, C, ids.liberador, { tipo: "carga", tarjeta: T, monto: 100 }), C, ids.liberador);

  // Doble clic: la misma llave con los mismos datos deja una sola operación; con otros datos es un error.
  await acepta("doble clic en la carga deja una sola operación", async (c) => {
    const llave = randomUUID();
    const primera = await asentar(c, C, ids.liberador, { tipo: "carga", tarjeta: T, monto: 100, llave });
    const segunda = await asentar(c, C, ids.liberador, { tipo: "carga", tarjeta: T, monto: 100, llave, evento: false });
    assert.ok(primera);
    assert.equal(segunda, null);
    const n = await c.query("select count(*)::int as n from efevoo_operaciones where llave_intento = $1", [llave]);
    assert.equal(n.rows[0]!.n, 1);
  }, C, ids.liberador);
  await acepta("doble clic en el depósito de prueba deja una sola operación", async (c) => {
    const llave = randomUUID();
    await asentar(c, S, P, { tipo: "deposito_prueba", monto: 10_000, llave });
    assert.equal(await asentar(c, S, P, { tipo: "deposito_prueba", monto: 10_000, llave, evento: false }), null);
  }, S, P);
  await rechaza("la misma llave con otro monto", "intento_con_otros_datos", async (c) => {
    const llave = randomUUID();
    await asentar(c, C, ids.liberador, { tipo: "carga", tarjeta: T, monto: 100, llave });
    await asentar(c, C, ids.liberador, { tipo: "carga", tarjeta: T, monto: 200, llave, evento: false });
  }, C, ids.liberador);
  await rechaza("la misma llave con otra tarjeta", "intento_con_otros_datos", async (c) => {
    const llave = randomUUID();
    await asentar(c, C, ids.liberador, { tipo: "bloqueo", tarjeta: T, llave });
    await asentar(c, C, ids.liberador, { tipo: "bloqueo", tarjeta: ids.tarjetaOtra, llave, evento: false });
  }, C, ids.liberador);

  // Una sola operación abierta por tarjeta: otro intento espera a que se resuelva o se concilie.
  await rechaza("dos cargas abiertas en la misma tarjeta", "efevoo_operaciones_abierta_dinero", async (c) => {
    await asentar(c, C, ids.liberador, { tipo: "carga", tarjeta: T, monto: 100 });
    await asentar(c, C, ids.liberador, { tipo: "retiro", tarjeta: T, monto: 100 });
  }, C, ids.liberador);

  // Referencia: 7 dígitos del consecutivo; nadie la escoge.
  const ref = await acepta("la referencia sale del consecutivo", async (c) => {
    const id = await asentar(c, C, ids.liberador, { tipo: "carga", tarjeta: T, monto: 1 });
    return (await c.query("select referencia from efevoo_operaciones where id = $1", [id])).rows[0]!.referencia as string;
  }, C, ids.liberador);
  assert.match(ref, /^[1-9][0-9]{6}$/);
  await rechaza("quien escribe no escoge la referencia", ["efevoo_operacion_no_valida", "55000"], (c) =>
    asentar(c, C, ids.liberador, { tipo: "carga", tarjeta: T, monto: 1, referencia: "1234567" }), C, ids.liberador);

  // Bitácora en la misma transacción.
  await rechaza("una operación sin evento", "auditoria_de_efevoo_ausente", (c) =>
    asentar(c, C, ids.liberador, { tipo: "carga", tarjeta: T, monto: 1, evento: false }), C, ids.liberador);

  // Permisos.
  await rechaza("la empresa no da de alta en Efevoo", "sin_permiso_para_efevoo", (c) => asentar(c, C, ids.admin, { tipo: "deposito_prueba", monto: 100 }), C, ids.admin);
  await rechaza("el contador no carga", "sin_permiso_para_efevoo", (c) => asentar(c, C, ids.contador, { tipo: "carga", tarjeta: T, monto: 100 }), C, ids.contador);
  await rechaza("el titular no carga ni su propia tarjeta", "sin_permiso_para_efevoo", (c) => asentar(c, C, ids.titular, { tipo: "carga", tarjeta: T, monto: 100 }), C, ids.titular);
  await rechaza("la liberadora no cancela", "sin_permiso_para_efevoo", (c) =>
    asentar(c, C, ids.liberador, { tipo: "cancelacion", tarjeta: T, motivo: "Robo de la tarjeta" }), C, ids.liberador);
  await acepta("el administrador cancela", (c) => asentar(c, C, ids.admin, { tipo: "cancelacion", tarjeta: T, motivo: "Robo de la tarjeta" }), C, ids.admin);
  await rechaza("personal sin administración de la plataforma", "sin_permiso_para_efevoo", (c) =>
    asentar(c, S, ids.cumplimiento, { tipo: "deposito_prueba", monto: 100 }), S, ids.cumplimiento);
  await rechaza("el personal no carga tarjetas de la empresa", "sin_permiso_para_efevoo", (c) => asentar(c, S, P, { tipo: "carga", tarjeta: T, monto: 1 }), S, P);
  await rechaza("la empresa no asienta en otra empresa", ["sin_permiso_para_efevoo", "42501"], (c) =>
    asentar(c, C, ids.adminBeta, { tipo: "carga", tarjeta: T, monto: 1 }), C, ids.adminBeta, ids.beta);
  await rechaza("una empresa de demostración no va a Efevoo", "solo_empresas_reales", (c) =>
    asentar(c, S, P, { tipo: "alta_cliente", empresa: ids.demo }), S, P, ids.demo);
  await rechaza("no se da de alta dos veces", "empresa_ya_vinculada", (c) => asentar(c, S, P, { tipo: "alta_cliente" }), S, P);
  await rechaza("sin vínculo no hay depósito", "empresa_sin_vinculo", (c) => asentar(c, S, P, { tipo: "deposito_prueba", empresa: ids.beta, monto: 1 }), S, P, ids.beta);

  // Estado de la tarjeta.
  await rechaza("desbloquear una tarjeta activa", "tarjeta_en_otro_estado", (c) => asentar(c, C, ids.liberador, { tipo: "desbloqueo", tarjeta: T }), C, ids.liberador);
  await rechaza("asignar un plástico ya asignado", "tarjeta_ya_asignada", (c) =>
    asentar(c, S, P, { tipo: "asignacion", inventario: 9001, terminacion: "1363", nombre: "PRUEBA LEVER" }), S, P);

  // Solo inserción: la transición es de efevoo_resolver_operacion.
  await rechaza("la empresa no cambia una operación", ["42501", "efevoo_operacion_inmutable"], async (c) => {
    await c.query("update efevoo_operaciones set estado = 'confirmada' where tarjeta_id = $1", [T]);
  }, C, ids.liberador);
  await rechaza("el personal no cambia una operación", ["42501", "efevoo_operacion_inmutable"], async (c) => {
    await c.query("update efevoo_operaciones set codigo_efevoo = 'x'");
  }, S, P);
  await rechaza("nada se borra", ["42501", "efevoo_no_se_borra"], (c) => c.query("delete from efevoo_operaciones"), S, P);
  for (const tabla of ["efevoo_operaciones", "efevoo_tarjetas", "efevoo_clientes"]) {
    assert.throws(() => ejecutar(duena, `delete from ${tabla}`), /efevoo_no_se_borra/, `ni como dueña se borra ${tabla}`);
  }
  assert.ok(leer<{ n: number }>("select count(*)::int as n from efevoo_operaciones")[0]!.n > 0);

  // Timeout: la operación queda incierta y no se puede repetir hasta conciliarla.
  await acepta("incierta, sin reintento hasta conciliar", async (c) => {
    const id = await asentar(c, C, ids.liberador, { tipo: "carga", tarjeta: T, monto: 500 });
    await resolver(c, C, ids.liberador, id!, "incierta", null, "timeout");
    await falla(c, () => asentar(c, C, ids.liberador, { tipo: "carga", tarjeta: T, monto: 500, reintento: id }), /reintento_no_valido/);
  }, C, ids.liberador);
  await acepta("conciliada: si aparece en Efevoo queda confirmada", async (c) => {
    const id = await asentar(c, C, ids.liberador, { tipo: "carga", tarjeta: T, monto: 500 });
    await resolver(c, C, ids.liberador, id!, "incierta", null, "timeout");
    await resolver(c, C, ids.liberador, id!, "confirmada", "3060");
    const r = await c.query("select estado, id_efevoo from efevoo_operaciones where id = $1", [id]);
    assert.deepEqual(r.rows[0], { estado: "confirmada", id_efevoo: "3060" });
  }, C, ids.liberador);
  // «No apareció» solo 10 minutos después de asentarla: antes, Efevoo podría estar procesándola todavía.
  await rechaza("no apareció antes de 10 minutos", "conciliacion_prematura", async (c) => {
    const id = await asentar(c, C, ids.liberador, { tipo: "carga", tarjeta: T, monto: 500 });
    await resolver(c, C, ids.liberador, id!, "incierta", null, "timeout");
    await resolver(c, C, ids.liberador, id!, "fallida", null, "no_aparecio");
  }, C, ids.liberador);
  await rechaza("una incierta no falla por otra razón que no aparecer", "transicion_no_valida", async (c) => {
    const id = await asentar(c, C, ids.liberador, { tipo: "carga", tarjeta: T, monto: 500 });
    await resolver(c, C, ids.liberador, id!, "incierta", null, "timeout");
    await resolver(c, C, ids.liberador, id!, "fallida", null, "901");
  }, C, ids.liberador);
  // Una incierta confirmada en la base y asentada hace 11 minutos (la dueña mueve la hora, sin disparadores).
  const vieja = await acepta("incierta de hace 11 minutos", async (c) => {
    const id = await asentar(c, C, ids.liberador, { tipo: "carga", tarjeta: T, monto: 500 });
    await resolver(c, C, ids.liberador, id!, "incierta", null, "timeout");
    return id!;
  }, C, ids.liberador, E, true);
  ejecutar(duena, `set session_replication_role = replica; update efevoo_operaciones set creada_en = now() - interval '11 minutes' where id = '${vieja}'; set session_replication_role = origin;`);
  await acepta("conciliada: si no aparece, el reintento lleva referencia nueva ligada", async (c) => {
    const id = vieja;
    await resolver(c, C, ids.liberador, id, "fallida", null, "no_aparecio");
    const nueva = await asentar(c, C, ids.liberador, { tipo: "carga", tarjeta: T, monto: 500, reintento: id });
    const r = await c.query("select o.referencia as nueva, a.referencia as anterior, o.reintento_de from efevoo_operaciones o join efevoo_operaciones a on a.id = o.reintento_de where o.id = $1", [nueva]);
    assert.equal(r.rows[0]!.reintento_de, id);
    assert.notEqual(r.rows[0]!.nueva, r.rows[0]!.anterior);
    await falla(c, () => asentar(c, C, ids.liberador, { tipo: "carga", tarjeta: T, monto: 500, reintento: id }), /efevoo_operaciones_reintento_unico|efevoo_operaciones_abierta_tarjeta/);
  }, C, ids.liberador);
  // Se cierra la vieja para que no deje la tarjeta con una operación abierta.
  await acepta("cerrar la incierta vieja", (c) => resolver(c, C, ids.liberador, vieja, "fallida", null, "no_aparecio"), C, ids.liberador, E, true);
  await rechaza("un reintento con otro monto", "reintento_no_valido", async (c) => {
    const id = await asentar(c, C, ids.liberador, { tipo: "carga", tarjeta: T, monto: 500 });
    await resolver(c, C, ids.liberador, id!, "fallida", null, "1");
    await asentar(c, C, ids.liberador, { tipo: "carga", tarjeta: T, monto: 600, reintento: id });
  }, C, ids.liberador);
  await rechaza("una confirmada no vuelve a cambiar", "transicion_no_valida", async (c) => {
    const id = await asentar(c, C, ids.liberador, { tipo: "carga", tarjeta: T, monto: 500 });
    await resolver(c, C, ids.liberador, id!, "confirmada", "1");
    await resolver(c, C, ids.liberador, id!, "fallida");
  }, C, ids.liberador);
  const pendienteDeOtro = await acepta("una carga pendiente de la liberadora", (c) =>
    asentar(c, C, ids.liberador, { tipo: "carga", tarjeta: ids.tarjetaOtra, monto: 7 }), C, ids.liberador, E, true);
  await rechaza("el contador no resuelve la operación de otro", "sin_permiso_para_efevoo", (c) =>
    resolver(c, C, ids.contador, pendienteDeOtro!, "fallida", null, "1"), C, ids.contador);
  await acepta("cerrar la pendiente", (c) => resolver(c, C, ids.liberador, pendienteDeOtro!, "fallida", null, "1"), C, ids.liberador, E, true);

  // Bloquear cambia el estado de la tarjeta al confirmarse.
  await acepta("bloqueo confirmado deja la tarjeta bloqueada", async (c) => {
    const id = await asentar(c, C, ids.liberador, { tipo: "bloqueo", tarjeta: T });
    await resolver(c, C, ids.liberador, id!, "confirmada");
    const r = await c.query("select estado from efevoo_tarjetas where id = $1", [T]);
    assert.equal(r.rows[0]!.estado, "bloqueada");
    await falla(c, () => asentar(c, C, ids.liberador, { tipo: "carga", tarjeta: T, monto: 1 }), /tarjeta_en_otro_estado/);
  }, C, ids.liberador);

  // RLS: el titular ve solo su tarjeta y sus operaciones; la liberadora ve todas; otra empresa no ve nada.
  const vistas = async (usuario: string, empresa = E) => acepta(`lo que ve ${usuario}`, async (c) => {
    const t = await c.query("select id from efevoo_tarjetas order by id_efevoo");
    const o = await c.query("select distinct tarjeta_id from efevoo_operaciones where tarjeta_id is not null");
    const v = await c.query("select count(*)::int as n from efevoo_clientes");
    return { tarjetas: t.rows.map((r) => r.id as string), opsTarjetas: o.rows.map((r) => r.tarjeta_id as string).sort(), vinculo: v.rows[0]!.n as number };
  }, C, usuario, empresa);
  const delTitular = await vistas(ids.titular);
  assert.deepEqual(delTitular.tarjetas, [T]);
  assert.deepEqual(delTitular.opsTarjetas, [T]);
  const deLaLiberadora = await vistas(ids.liberador);
  assert.deepEqual(deLaLiberadora.tarjetas, [T, ids.tarjetaOtra]);
  // El contador y el solicitante no abren Tarjetas: no leen ninguna tarjeta ni operación de tarjeta.
  assert.deepEqual((await vistas(ids.contador)).tarjetas, [], "el contador no lee efevoo_tarjetas");
  assert.deepEqual((await vistas(ids.contador)).opsTarjetas, []);
  assert.deepEqual((await vistas(ids.solicitante)).tarjetas, [], "el solicitante no lee efevoo_tarjetas");
  const deBeta = await vistas(ids.adminBeta, ids.beta);
  assert.deepEqual(deBeta, { tarjetas: [], opsTarjetas: [], vinculo: 0 });
  const delOtroTitular = await acepta("el otro titular", async (c) => (await c.query("select id from efevoo_tarjetas")).rows.map((r) => r.id as string), C,
    leer<{ id: string }>("select id from users where correo = 'otra-efevoo@ejemplo.mx'")[0]!.id);
  assert.deepEqual(delOtroTitular, [ids.tarjetaOtra]);

  // E1-2: una carga abierta (Efevoo no respondió) no impide bloquear ni cancelar una tarjeta robada.
  // Z3 de -03: una carga incierta confirmada en la base, y el personal cancela la tarjeta.
  const cargaAbierta = await acepta("una carga incierta", async (c) => {
    const carga = await asentar(c, C, ids.liberador, { tipo: "carga", tarjeta: ids.tarjetaOtra, monto: 900 });
    await resolver(c, C, ids.liberador, carga!, "incierta", null, "timeout");
    return carga!;
  }, C, ids.liberador, E, true);
  await acepta("el personal cancela con una carga incierta abierta", (c) =>
    asentar(c, S, P, { tipo: "cancelacion", tarjeta: ids.tarjetaOtra, motivo: "Robo de la tarjeta" }), S, P);
  await acepta("la liberadora bloquea con una carga incierta abierta", (c) => asentar(c, C, ids.liberador, { tipo: "bloqueo", tarjeta: ids.tarjetaOtra }), C, ids.liberador);
  ejecutar(duena, `set session_replication_role = replica; update efevoo_operaciones set creada_en = now() - interval '11 minutes' where id = '${cargaAbierta}'; set session_replication_role = origin;`);
  await acepta("cerrar la carga incierta", (c) => resolver(c, C, ids.liberador, cargaAbierta, "fallida", null, "no_aparecio"), C, ids.liberador, E, true);
  await acepta("el administrador cancela con una carga y un bloqueo abiertos", async (c) => {
    const carga = await asentar(c, C, ids.admin, { tipo: "carga", tarjeta: ids.tarjetaOtra, monto: 900 });
    await resolver(c, C, ids.admin, carga!, "incierta", null, "timeout");
    await asentar(c, C, ids.admin, { tipo: "bloqueo", tarjeta: ids.tarjetaOtra });
    await asentar(c, C, ids.admin, { tipo: "cancelacion", tarjeta: ids.tarjetaOtra, motivo: "Robo de la tarjeta" });
  }, C, ids.admin);
  await rechaza("con una cancelación abierta no se carga", "tarjeta_en_cancelacion", async (c) => {
    await asentar(c, C, ids.admin, { tipo: "cancelacion", tarjeta: ids.tarjetaOtra, motivo: "Robo de la tarjeta" });
    await asentar(c, C, ids.admin, { tipo: "carga", tarjeta: ids.tarjetaOtra, monto: 1 });
  }, C, ids.admin);

  // E1-6: una carga confirmada lleva un id positivo; el id 0 (falso éxito) o vacío no se acepta.
  for (const idMalo of ["0", null]) {
    await rechaza(`carga confirmada con id ${idMalo}`, "efevoo_operacion_no_valida", async (c) => {
      const id = await asentar(c, C, ids.liberador, { tipo: "carga", tarjeta: ids.tarjetaOtra, monto: 1 });
      await resolver(c, C, ids.liberador, id!, "confirmada", idMalo);
    }, C, ids.liberador);
  }

  // E1-7: repetir la llave de otra persona no da «ok» a quien no puede asentar.
  const llaveAjena = randomUUID();
  const bloqueoAjeno = await acepta("bloqueo de la liberadora", (c) => asentar(c, C, ids.liberador, { tipo: "bloqueo", tarjeta: ids.tarjetaOtra, llave: llaveAjena }),
    C, ids.liberador, E, true);
  await rechaza("el contador repite la llave del bloqueo", "sin_permiso_para_efevoo", (c) =>
    asentar(c, C, ids.contador, { tipo: "bloqueo", tarjeta: ids.tarjetaOtra, llave: llaveAjena, evento: false }), C, ids.contador);
  await rechaza("el administrador repite la llave de otra persona", "intento_con_otros_datos", (c) =>
    asentar(c, C, ids.admin, { tipo: "bloqueo", tarjeta: ids.tarjetaOtra, llave: llaveAjena, evento: false }), C, ids.admin);
  await acepta("cerrar el bloqueo", (c) => resolver(c, C, ids.liberador, bloqueoAjeno!, "fallida", null, "1"), C, ids.liberador, E, true);

  // E1-4: doble clic simultáneo (dos funciones a la vez) con la misma llave: una operación y la segunda regresa la existente.
  {
    const llave = randomUUID();
    const abrir = async () => {
      const c = new pg.Client({ connectionString: app });
      await c.connect();
      await c.query("begin");
      await c.query(`set local role ${C}`);
      await c.query("select set_config('app.company_id', $1, true), set_config('app.user_id', $2, true), set_config('app.operator_id', '', true)", [E, ids.liberador]);
      return c;
    };
    const a = await abrir();
    const b = await abrir();
    try {
      const idA = await asentar(a, C, ids.liberador, { tipo: "carga", tarjeta: ids.tarjetaOtra, monto: 333, llave });
      let resultadoB: string | null | Error = "esperando";
      const pB = asentar(b, C, ids.liberador, { tipo: "carga", tarjeta: ids.tarjetaOtra, monto: 333, llave, evento: false })
        .then((x) => { resultadoB = x; }, (e: Error) => { resultadoB = e; });
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(resultadoB, "esperando", "el segundo envío espera al primero");
      await a.query("commit");
      await pB;
      assert.equal(resultadoB, null, `el segundo envío regresa sin insertar: ${String(resultadoB)}`);
      await b.query("commit");
      assert.equal(leer<{ n: number }>(`select count(*)::int as n from efevoo_operaciones where llave_intento = '${llave}'`)[0]!.n, 1);
      await acepta("cerrar la carga simultánea", (c) => resolver(c, C, ids.liberador, idA!, "fallida", null, "1"), C, ids.liberador, E, true);
    } finally {
      await a.query("rollback").catch(() => undefined);
      await b.query("rollback").catch(() => undefined);
      await a.end();
      await b.end();
    }
  }

  // E1-8: un titular con la membresía suspendida ya no ve su tarjeta.
  ejecutar(duena, `set session_replication_role = replica; update memberships set estado = 'suspendida' where user_id = '${ids.titular}'; set session_replication_role = origin;`);
  try {
    assert.deepEqual((await vistas(ids.titular)).tarjetas, [], "el titular suspendido no ve su tarjeta");
  } finally {
    ejecutar(duena, `set session_replication_role = replica; update memberships set estado = 'activa' where user_id = '${ids.titular}'; set session_replication_role = origin;`);
  }
  assert.deepEqual((await vistas(ids.titular)).tarjetas, [T]);

  // Empresa suspendida: la empresa no opera; el personal solo cancela.
  ejecutar(duena, `set session_replication_role = replica; update companies set estado = 'suspendida' where id = '${E}'; set session_replication_role = origin;`);
  try {
    await rechaza("la empresa suspendida no carga", "empresa_suspendida", (c) =>
      asentar(c, C, ids.liberador, { tipo: "carga", tarjeta: ids.tarjetaOtra, monto: 1 }), C, ids.liberador);
    await rechaza("al personal no le deja depositar a una suspendida", "empresa_suspendida", (c) => asentar(c, S, P, { tipo: "deposito_prueba", monto: 1 }), S, P);
    await acepta("el personal sí cancela la tarjeta de una suspendida", (c) =>
      asentar(c, S, P, { tipo: "cancelacion", tarjeta: ids.tarjetaOtra, motivo: "Empresa suspendida" }), S, P);
  } finally {
    ejecutar(duena, `set session_replication_role = replica; update companies set estado = 'activa' where id = '${E}'; set session_replication_role = origin;`);
  }
}
