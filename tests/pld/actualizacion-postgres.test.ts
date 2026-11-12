import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import pg from "pg";

import { hoyEnMexico } from "../../src/dominio/operacion/comisiones.ts";
import { sumarMeses } from "../../src/dominio/operacion/riesgo.ts";
import { capacidadesDe, type RolCliente } from "../../src/nucleo/capacidades.ts";
import type { ContextoDeTenant } from "../../src/nucleo/contexto.ts";
import { cerrarConexion } from "../../src/nucleo/db.ts";
import { crearPagoProveedor, editarYReenviarPago, resolverPagoProveedor } from "../../src/server/pagos-proveedores/servicio.ts";
import { cambiarClabeProveedor } from "../../src/server/proveedores/servicio-clabes.ts";
import { aplicarArchivoEnTransaccion, conBaseDesechable, exigirBaseDesechable, urlDeAplicacion } from "../aislamiento/postgres.ts";
import { almacenEnMemoria, PDF } from "../operacion/apoyo-alta-regulada.ts";

const urlAdmin = process.env.AISLAMIENTO_DATABASE_URL?.trim() ?? "";
const MIGRACIONES = join(import.meta.dirname, "../../db/migrations");
const HISTORICA = join(import.meta.dirname, "fixtures/0030_7ba925ea.sql");
const LA_0030 = "0030_pld_alertas_reportes.sql";
const LA_0037 = "0037_pld_instrucciones.sql";
const LUIS = "f0000000-0000-4000-8000-000000000001";
const ROSA = "f0000000-0000-4000-8000-000000000002";
const PROVEEDOR = "f1000000-0000-4000-8000-000000000001";
const COPIA_69B = "f2000000-0000-4000-8000-000000000001";
const CLABE = "002180701150123452";

/** Mismo protocolo que db/migrate.sh: transacción, candado y omisión por nombre registrado.
 * Se conecta a la base aleatoria del arnés; no necesita una base llamada plataforma.
 */
async function pendientes(c: pg.Client): Promise<string[]> {
  const aplicadas: string[] = [];
  await c.query("begin; set local lock_timeout = '15s'; select pg_advisory_xact_lock(814271)");
  try {
    for (const archivo of readdirSync(MIGRACIONES).filter((f) => f.endsWith(".sql")).sort()) {
      const version = archivo.slice(0, -4);
      if ((await c.query("select 1 from schema_migrations where version = $1", [version])).rowCount) continue;
      await c.query(readFileSync(join(MIGRACIONES, archivo), "utf8"));
      await c.query("insert into schema_migrations (version) values ($1)", [version]);
      aplicadas.push(archivo);
    }
    await c.query("commit");
    return aplicadas;
  } catch (error) {
    await c.query("rollback");
    throw error;
  }
}

async function contrato(c: pg.Client) {
  const columnas = (await c.query(`select column_name, data_type, is_nullable, column_default, generation_expression
    from information_schema.columns where table_schema = 'public' and table_name = 'pld_operaciones' order by column_name`)).rows;
  const restricciones = (await c.query(`select conname, pg_get_constraintdef(oid) as definicion from pg_constraint
    where conrelid = 'pld_operaciones'::regclass order by conname`)).rows;
  const indices = (await c.query(`select indexname, indexdef from pg_indexes where schemaname = 'public'
    and (tablename = 'pld_operaciones' or indexname = 'pld_alertas_excede_mes') order by indexname`)).rows;
  const funciones = (await c.query(`select proname, pg_get_functiondef(oid) as definicion,
    coalesce(proacl::text, '') as permisos from pg_proc where pronamespace = 'public'::regnamespace
    and proname = any($1) order by proname`, [["pld_operaciones_antes", "pld_evaluar_operacion", "pld_registrar_pago", "pld_registrar_nomina"]])).rows;
  const disparadores = (await c.query(`select tgname, pg_get_triggerdef(oid) as definicion, tgenabled from pg_trigger
    where not tgisinternal and tgname = any($1) order by tgname`,
  [["pld_operaciones_antes", "pld_operaciones_evaluar", "pld_registra_pago", "pld_registra_nomina"]])).rows;
  return { columnas, restricciones, indices, funciones, disparadores };
}

async function conservados(c: pg.Client) {
  return (await c.query(`select
    (select coalesce(jsonb_agg(to_jsonb(o) - 'instruccion' - 'reemplaza' order by id), '[]') from pld_operaciones o) as operaciones,
    (select coalesce(jsonb_agg(to_jsonb(a) order by id), '[]') from pld_alertas a) as alertas,
    (select coalesce(jsonb_agg(to_jsonb(a) order by id), '[]') from audit_log a) as bitacora,
    (select jsonb_agg(to_jsonb(m) order by version) from schema_migrations m where version < '0037') as migraciones`)).rows[0];
}

describe("0037: actualización de PLD ya instalada", { skip: urlAdmin.length === 0 }, () => {
  it("conserva registros y equipara instrucciones, reglas, reloj y permisos con una instalación nueva", async (t) => {
    exigirBaseDesechable();
    // Copia íntegra e inmutable de 0030 en 7ba925eacc6c7fbaac7e801e6608d37419605c07,
    // padre de a293abfd (la edición in-place que introdujo instrucciones y reloj).
    assert.equal(createHash("sha256").update(readFileSync(HISTORICA)).digest("hex"),
      "196172f977d029d95df7ccf8bc1c2928c0282417d2aa785b26cc927f9dd5ed4d");
    let esperado: Awaited<ReturnType<typeof contrato>> | undefined;
    for (const historica of [false, true]) {
      await t.test(historica ? "upgrade desde 0030 histórica" : "instalación nueva", async () => {
        await conBaseDesechable(urlAdmin, async (urlDuena) => {
          for (const archivo of readdirSync(MIGRACIONES).filter((f) => f.endsWith(".sql") && f < LA_0037).sort()) {
            aplicarArchivoEnTransaccion(urlDuena, historica && archivo === LA_0030 ? HISTORICA : join(MIGRACIONES, archivo));
          }
          const c = new pg.Client({ connectionString: urlDuena });
          await c.connect();
          try {
            await c.query("create table schema_migrations (version text primary key, applied_at timestamptz not null default now())");
            for (const archivo of readdirSync(MIGRACIONES).filter((f) => f.endsWith(".sql") && f < LA_0037).sort()) {
              await c.query("insert into schema_migrations (version) values ($1)", [archivo.slice(0, -4)]);
            }
            const operador = String((await c.query("select id from operators order by alta_en limit 1")).rows[0].id);
            const empresa = randomUUID();
            await sembrar(c, empresa, operador);
            process.env.DATABASE_URL = urlDeAplicacion(urlDuena);
            await cerrarConexion();
            const luis = cliente(LUIS, ["administrador", "liberador"], empresa, operador);
            const rosa = cliente(ROSA, ["liberador"], empresa, operador);
            const deps = { almacen: almacenEnMemoria(), ahora: () => new Date() };
            const sesion = { superficie: "cliente" as const, segundoFactor: { metodo: "totp" as const, en: new Date(Date.now() - 1000) } };
            const hoy = hoyEnMexico(new Date());
            const entrada = { supplierId: PROVEEDOR, origen: "excepcion" as const, emitidaEl: hoy, venceEl: sumarMeses(hoy, 1),
              programadaEl: sumarMeses(hoy, 1), motivoExcepcion: "Servicio urgente autorizado por dirección" };
            const pago = await crearPagoProveedor(luis, { ...entrada, clientRequestId: randomUUID(),
              pdf: { nombre: "soporte.pdf", bytes: PDF }, monto: "1,000.00", referencia: "Servicio menor" }, deps);
            await resolverPagoProveedor(rosa, sesion, { requestId: pago.requestId, decision: "autorizar", version: 1, totalCentavos: 100000 }, deps);
            // Una alerta real y su bitácora deben sobrevivir byte por byte a la migración.
            await c.query(`insert into pld_operaciones (operator_id, company_id, tipo, origen_tabla, origen_id, monto_centavos, clabe, ocurrida_en)
              values ($1, $2, 'pago_proveedor', 'supplier_payment_requests', $3, 11000000, $4, '2020-01-01Z')`,
            [operador, empresa, randomUUID(), CLABE]);
            const antes = await conservados(c);
            assert.ok(antes.alertas.length > 0);
            assert.equal((await c.query(`select count(*)::int as n from information_schema.columns
              where table_name = 'pld_operaciones' and column_name = 'instruccion'`)).rows[0].n, historica ? 0 : 1);
            if (!historica) esperado = await contrato(c);

            if (historica) {
              const lector = new pg.Client({ connectionString: urlDuena });
              await lector.connect();
              const contratoAnterior = await contrato(c);
              try {
                await lector.query("begin; select id from pld_operaciones limit 1");
                await assert.rejects(pendientes(c), /lock timeout/, "la migración no bloquea indefinidamente una base en uso");
                assert.deepEqual(await contrato(c), contratoAnterior, "la espera fallida revierte todo el DDL");
                assert.deepEqual(await conservados(c), antes);
              } finally {
                await lector.query("rollback");
                await lector.end();
              }
            }
            assert.deepEqual(await pendientes(c), [LA_0037], "0030 registrada se omite; el arreglo debe entrar por 0037");
            assert.deepEqual(await conservados(c), antes, "sin reescribir operaciones, alertas, bitácora ni marcas de migraciones anteriores");
            assert.equal((await c.query("select count(*)::int as n from pld_operaciones where instruccion <> 1 or reemplaza is not null")).rows[0].n, 0);
            const actual = await contrato(c);
            assert.deepEqual(actual, esperado, "mismo contrato que la 0030 actual sin modificar, incluidas ACL, índices y triggers");
            assert.deepEqual(await pendientes(c), [], "repetir el despliegue no vuelve a ejecutar ni duplicar nada");
            assert.deepEqual(await conservados(c), antes);

            const cambio = await cambiarClabeProveedor(luis, { supplierId: PROVEEDOR, clabe: "002180701150990025" }, sesion, { avisar: async () => 0 } as never);
            assert.equal((cambio as { pagosRegresados?: number }).pagosRegresados, 1);
            await resolverPagoProveedor(rosa, sesion, { requestId: pago.requestId, decision: "rechazar", motivo: "Corregir el importe", version: 2, totalCentavos: 100000 }, deps);
            await editarYReenviarPago(luis, pago.requestId, { ...entrada, pdf: { nombre: "nuevo.pdf", bytes: PDF }, monto: "900,000.00", referencia: "Servicio mayor" } as never, deps);
            await resolverPagoProveedor(rosa, sesion, { requestId: pago.requestId, decision: "autorizar", version: 3, totalCentavos: 90000000 }, deps);
            const ops = (await c.query(`select id, instruccion, reemplaza, monto_centavos::text as monto, clabe
              from pld_operaciones where origen_id = $1 order by instruccion`, [pago.requestId])).rows;
            assert.deepEqual(ops.map(({ instruccion, reemplaza, monto, clabe }) => ({ instruccion, reemplaza, monto, clabe })), [
              { instruccion: 1, reemplaza: null, monto: "100000", clabe: CLABE },
              { instruccion: 3, reemplaza: ops[0].id, monto: "90000000", clabe: "002180701150990025" },
            ]);
            const alerta = (await c.query("select observado from pld_alertas where operacion_id = $1 and regla = 'excede_perfil'", [ops[1].id])).rows[0]?.observado;
            assert.equal(alerta?.suma_mes_centavos, 90000000, "solo la instrucción vigente cuenta en el mes");
            assert.equal(alerta?.reemplaza_monto_centavos, 100000);
            assert.equal(alerta?.reemplaza_clabe, CLABE);
            await reloj(c, urlDuena, empresa, operador);
          } finally {
            await cerrarConexion();
            delete process.env.DATABASE_URL;
            await c.end();
          }
        });
      });
    }
  });
});

/** La transacción más antigua llega después al candado: su hora debe ser posterior y ver la ventana completa. */
async function reloj(c: pg.Client, url: string, empresa: string, operador: string) {
  const temprana = new pg.Client({ connectionString: url });
  const tardia = new pg.Client({ connectionString: url });
  await temprana.connect();
  await tardia.connect();
  const insertar = (conexion: pg.Client) => conexion.query(`insert into pld_operaciones
    (operator_id, company_id, tipo, origen_tabla, origen_id, monto_centavos, clabe)
    values ($1, $2, 'pago_proveedor', 'supplier_payment_requests', $3, 4000000, '012180001234567897') returning id`,
  [operador, empresa, randomUUID()]);
  try {
    await insertar(c);
    await temprana.query("begin");
    await tardia.query("begin");
    const primera = (await insertar(tardia)).rows[0].id;
    const siguiente = insertar(temprana);
    // Espera observable al candado de la empresa, sin suponer un tiempo de ejecución.
    let espera = false;
    for (let intento = 0; intento < 200; intento++) {
      espera = (await c.query("select exists(select 1 from pg_stat_activity where pid = $1 and wait_event = 'advisory') as espera", [temprana.processID])).rows[0].espera;
      if (espera) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(espera, "la transacción antigua espera a la que llegó antes al candado");
    await tardia.query("commit");
    const segunda = (await siguiente).rows[0].id;
    await temprana.query("commit");
    assert.equal((await c.query(`select a.ocurrida_en < b.ocurrida_en as orden from pld_operaciones a,
      pld_operaciones b where a.id = $1 and b.id = $2`, [primera, segunda])).rows[0].orden, true);
    const alerta = (await c.query("select observado from pld_alertas where operacion_id = $1 and regla = 'fraccionamiento'", [segunda])).rows[0]?.observado;
    assert.equal(alerta?.instrucciones, 3);
    assert.equal(alerta?.suma_centavos, 12000000);
  } finally {
    await Promise.all([temprana.query("rollback"), tardia.query("rollback")]);
    await Promise.all([temprana.end(), tardia.end()]);
  }
}

function cliente(userId: string, roles: RolCliente[], companyId: string, operadorId: string): ContextoDeTenant {
  return {
    sesionId: randomUUID(), peticionId: null, superficie: "cliente",
    persona: { id: userId, nombre: userId, correo: `${userId.slice(-4)}@ejemplo.mx` }, segundoFactor: "totp",
    empresa: { id: companyId, rfc: "BET150301AB2", razonSocial: "Beta Logística SA de CV", operadorId, estado: "activa", demostracion: false },
    roles, personal: null, empresas: [], capacidades: capacidadesDe({ rolesCliente: roles, rolesPlataforma: [] }),
  };
}

/** Solo datos iniciales; el pago, sus correcciones, autorizaciones y las reglas sí usan servicios/triggers reales. */
async function sembrar(c: pg.Client, empresa: string, operador: string) {
  await c.query("begin; set local session_replication_role = replica");
  try {
    await c.query(`insert into companies (id, rfc, razon_social, codigo_postal, regimen, uso_cfdi, operator_id, estado, demostracion)
      values ($1, 'BET150301AB2', 'Beta Logística SA de CV', '06600', '601', 'G03', $2, 'activa', false)`, [empresa, operador]);
    for (const [id, roles] of [[LUIS, ["administrador", "liberador"]], [ROSA, ["liberador"]]] as const) {
      await c.query("insert into users (id, nombre, correo) values ($1, 'Persona de prueba', $2)", [id, `${id}@ejemplo.mx`]);
      await c.query("insert into memberships (user_id, company_id, estado) values ($1, $2, 'activa')", [id, empresa]);
      for (const rol of roles) await c.query("insert into membership_roles (user_id, company_id, rol) values ($1, $2, $3)", [id, empresa, rol]);
    }
    await c.query(`insert into pld_perfiles (id, operator_id, company_id, numero, origen, pagos_monto_mensual_centavos,
      pagos_operaciones_mensuales, nomina_monto_mensual_centavos, nomina_operaciones_mensuales, registrado_por)
      values ($1, $2, $3, 1, 'declaracion', 10000000, 10, 500000, 2, $4)`, [randomUUID(), operador, empresa, LUIS]);
    await c.query("insert into lista_69b_snapshots (id, operator_id, fecha_archivo, cargado_en) values ($1, $2, current_date - 1, now())", [COPIA_69B, operador]);
    const documento = randomUUID();
    await c.query(`insert into documents (id, company_id, clave_blob, hash_sha256, tipo, nombre_original, creado_en)
      values ($1, $2, 'constancias/prueba', $3, 'application/pdf', 'constancia.pdf', now())`, [documento, empresa, "a".repeat(64)]);
    await c.query(`insert into suppliers (id, company_id, document_id, snapshot_id, rfc, razon_social, lista_fecha, lista_leida_en, boton_pago, alta_en)
      values ($1, $2, $3, $4, 'LIM101010AB2', 'Proveedor Limpio SA', current_date - 1, now(), true, now())`, [PROVEEDOR, empresa, documento, COPIA_69B]);
    await c.query(`insert into supplier_clabes (id, company_id, supplier_id, clabe, digito_valido, vigente_desde)
      values ($1, $2, $3, $4, true, now() - interval '1 day')`, [randomUUID(), empresa, PROVEEDOR, CLABE]);
    await c.query("commit");
  } catch (error) {
    await c.query("rollback");
    throw error;
  }
}
