import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import pg from "pg";

import { aplicarArchivo, conBaseDesechable, ejecutar, exigirBaseDesechable } from "../aislamiento/postgres.ts";

const RAIZ = join(import.meta.dirname, "../..");
const MIGRACIONES = join(RAIZ, "db/migrations");
const ORIGINAL = join(import.meta.dirname, "fixtures/0022_original.sql");
const INTERMEDIA = join(import.meta.dirname, "fixtures/0022_idempotencia.sql");
const VERSION = "0034_pagos_proveedores_hardening";
const CLABE = "002180701150123452";
const urlAdmin = process.env.AISLAMIENTO_DATABASE_URL?.trim() ?? "";

// Genera el SQL con el runner real. Un psql de captura evita que su validación
// de nombre «plataforma» apunte jamás a una base real. Luego el cliente habitual
// ejecuta ese SQL por stdin contra conBaseDesechable (también dentro del Docker
// de CI, donde los archivos del repo se montan en /work).
function migrar(url: string): string {
  const captura = mkdtempSync(join(tmpdir(), "runner-pagos-"));
  try {
    const shim = join(captura, "psql");
    writeFileSync(shim, '#!/bin/sh\nfor arg do ultimo="$arg"; done\ncat "$ultimo"\n');
    chmodSync(shim, 0o755);
    const destinoDeCaptura = new URL("postgres://captura.invalid/plataforma");
    const generado = spawnSync("bash", [join(RAIZ, "db/migrate.sh")], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${captura}:${process.env.PATH}`, DATABASE_URL_UNPOOLED: destinoDeCaptura.href },
    });
    assert.equal(generado.status, 0, generado.stderr);
    const sql = generado.stdout.slice(0, generado.stdout.lastIndexOf("COMMIT;") + "COMMIT;".length)
      .replaceAll(`${RAIZ}/db/migrations/`, "db/migrations/");
    const destino = new URL(url);
    const env = { ...process.env, PGPASSWORD: decodeURIComponent(destino.password) };
    delete env.DATABASE_URL;
    delete env.DATABASE_URL_UNPOOLED;
    destino.password = "";
    const resultado = spawnSync("psql", [destino.toString(), "-X", "-q", "-v", "ON_ERROR_STOP=1"], {
      encoding: "utf8", env, cwd: RAIZ, input: sql, timeout: 120_000,
    });
    assert.equal(resultado.status, 0, resultado.stderr.replaceAll(url, "***"));
    return resultado.stdout;
  } finally {
    rmSync(captura, { recursive: true, force: true });
  }
}

async function cliente(url: string): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  return c;
}

async function preparar(url: string, archivo22: string, limite = "0030"): Promise<void> {
  for (const archivo of readdirSync(MIGRACIONES).filter((a) => a.endsWith(".sql") && a < limite).sort()) {
    aplicarArchivo(url, archivo.startsWith("0022_") ? archivo22 : join(MIGRACIONES, archivo));
    ejecutar(url, `create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now());
      insert into schema_migrations (version, applied_at) values ('${archivo.slice(0, -4)}', '2026-01-01Z');`);
  }
}

async function sembrar(c: pg.Client) {
  const empresa = randomUUID(), solicitante = randomUUID(), liberador = randomUUID(), otro = randomUUID();
  const snapshot = randomUUID();
  await c.query("begin; set local timezone = 'UTC'; set local session_replication_role = replica");
  try {
    const operador = (await c.query("select id from operators limit 1")).rows[0].id;
    await c.query(`insert into companies (id,rfc,razon_social,codigo_postal,regimen,uso_cfdi,operator_id,estado,demostracion)
      values ($1,'EKU9003173C9','Empresa histórica','06600','601','G03',$2,'activa',true)`, [empresa, operador]);
    for (const [id, nombre, rol] of [[solicitante, "Solicitud", "solicitante"], [liberador, "Liberación", "liberador"], [otro, "Otro", "liberador"]]) {
      await c.query("insert into users (id,nombre,correo) values ($1,$2,$3)", [id, nombre, `${id}@example.test`]);
      await c.query("insert into memberships (user_id,company_id,estado) values ($1,$2,'activa')", [id, empresa]);
      await c.query("insert into membership_roles (user_id,company_id,rol) values ($1,$2,$3)", [id, empresa, rol]);
    }
    await c.query(`insert into lista_69b_snapshots (id,operator_id,fecha_archivo,cargado_en) values ($1,$2,'2026-01-01',now())`, [snapshot, operador]);
    const pagos: Record<string, { id: string; cargo: string; proveedor: string; clabe: string }> = {};
    for (const [i, estado] of ["clabe_cerrada", "inactivo", "bloqueado", "cancelado", "valido", "rechazado", "pendiente"].entries()) {
      const documento = randomUUID(), proveedor = randomUUID(), clabe = randomUUID(), cargo = randomUUID(), id = randomUUID();
      pagos[estado] = { id, cargo, proveedor, clabe };
      await c.query(`insert into documents (id,company_id,clave_blob,hash_sha256,tipo,nombre_original,creado_en)
        values ($1,$2,$3,$4,'application/pdf','constancia.pdf',now())`, [documento, empresa, documento, "a".repeat(64)]);
      await c.query(`insert into suppliers (id,company_id,document_id,snapshot_id,rfc,razon_social,lista_fecha,lista_leida_en,boton_pago,alta_en,activo)
        values ($1,$2,$3,$4,$5,'Proveedor histórico','2026-01-01',now(),$6,now(),$7)`,
        [proveedor, empresa, documento, snapshot, `AAA01010${i + 1}AB1`, estado !== "bloqueado", estado !== "inactivo"]);
      await c.query(`insert into supplier_clabes (id,company_id,supplier_id,clabe,digito_valido,vigente_desde,vigente_hasta)
        values ($1,$2,$3,$4,true,'2026-01-01',$5)`, [clabe, empresa, proveedor, CLABE, estado === "clabe_cerrada" ? "2026-02-01" : null]);
      const cfdi = randomUUID().toUpperCase();
      await c.query(`insert into supplier_payables (id,company_id,supplier_id,origen,cfdi_uuid,referencia,total_centavos,emitida_el,vence_el,programada_el,creado_por,creado_en,actualizado_en)
        values ($1,$2,$3,'cfdi',$4,'Factura histórica',12300,'2026-01-01','2026-02-01','2026-02-01',$5,'2026-01-01','2026-01-01')`,
        [cargo, empresa, proveedor, cfdi, solicitante]);
      const resuelto = estado !== "pendiente";
      await c.query(`insert into supplier_payment_requests (id,company_id,payable_id,supplier_clabe_id,clabe,total_centavos,programada_el,estado,solicitado_por,solicitado_en,resuelto_por,resuelto_en,motivo_resolucion,creado_en)
        values ($1,$2,$3,$4,$5,12300,'2026-02-01',$6,$7,'2026-01-01',$8,$9,$10,'2026-01-01')`,
        [id, empresa, cargo, clabe, CLABE, estado === "cancelado" ? "cancelado" : estado === "rechazado" ? "rechazado" : estado === "pendiente" ? "por_autorizar" : "listo_para_pagar",
          solicitante, resuelto ? liberador : null, resuelto ? "2026-01-02" : null, ["cancelado", "rechazado"].includes(estado) ? "Motivo histórico conservado" : null]);
    }
    if ((await c.query("select to_regclass('public.supplier_payment_request_history') is not null as existe")).rows[0].existe) {
      await c.query(`insert into supplier_payment_request_history
        (company_id,request_id,version,estado,estado_nuevo,supplier_clabe_id,clabe,total_centavos,programada_el,solicitado_por,solicitado_en)
        values ($1,$2,1,'por_autorizar','rechazado',$3,$4,12300,'2026-02-01',$5,'2026-01-01')`,
        [empresa, pagos.rechazado!.id, pagos.rechazado!.clabe, CLABE, solicitante]);
    }
    await c.query("commit");
    return { empresa, solicitante, liberador, otro, pagos };
  } catch (error) {
    await c.query("rollback");
    throw error;
  }
}

type Datos = Awaited<ReturnType<typeof sembrar>>;

async function comoCliente(c: pg.Client, datos: Datos, usuario: string, sql: string, parametros: unknown[] = [], empresa = datos.empresa) {
  await c.query("begin; set local role plataforma_cliente");
  try {
    await c.query("select set_config('app.company_id',$1,true),set_config('app.user_id',$2,true)", [empresa, usuario]);
    const resultado = await c.query(sql, parametros);
    await c.query("commit");
    return resultado;
  } catch (error) {
    await c.query("rollback");
    throw error;
  }
}

async function comprobarCandadosYRetiro(c: pg.Client, url: string, datos: Datos) {
  const autoriza = await cliente(url);
  const pago = datos.pagos.pendiente!;
  try {
    await autoriza.query("begin; set local role plataforma_cliente");
    await autoriza.query("select set_config('app.company_id',$1,true),set_config('app.user_id',$2,true)", [datos.empresa, datos.liberador]);
    await autoriza.query("update supplier_payment_requests set estado='listo_para_pagar',resuelto_por=$2,resuelto_en=now() where id=$1", [pago.id, datos.liberador]);
    await autoriza.query(`insert into audit_log (operator_id,company_id,actor_tipo,actor_id,superficie,accion,entidad,identificador)
      select operator_id,id,'miembro',$2,'cliente','autorizar_pago_proveedor','supplier_payment_requests',$3 from companies where id=$1`,
      [datos.empresa, datos.liberador, pago.id]);
    // NOWAIT comprueba los candados reales de validación sin depender de tiempos
    // ni del bloqueo que el trigger de retiro tomaría después sobre la solicitud.
    for (const [tabla, id] of [["supplier_payables", pago.cargo], ["suppliers", pago.proveedor], ["supplier_clabes", pago.clabe]]) {
      await assert.rejects(c.query(`select id from ${tabla} where id=$1 for no key update nowait`, [id]), { code: "55P03" });
    }
    await autoriza.query("commit");
  } finally {
    await autoriza.query("rollback");
    await autoriza.end();
  }
  // Cambios posteriores a la migración siguen retirando autorizaciones y
  // registran la versión cerrada, además del saneamiento inicial.
  await c.query("update suppliers set activo=false where id=$1", [pago.proveedor]);
  assert.deepEqual((await c.query("select estado,version from supplier_payment_requests where id=$1", [pago.id])).rows[0], { estado: "por_autorizar", version: 2 });
  assert.equal((await c.query("select count(*)::int as n from supplier_payment_request_history where request_id=$1", [pago.id])).rows[0].n, 2);

  const valido = datos.pagos.valido!;
  const nuevaClabe = randomUUID();
  await c.query("begin");
  try {
    await c.query("update supplier_clabes set vigente_hasta=now() where id=$1", [valido.clabe]);
    await c.query(`insert into supplier_clabes (id,company_id,supplier_id,clabe,digito_valido,vigente_desde)
      values ($1,$2,$3,$4,true,now())`, [nuevaClabe, datos.empresa, valido.proveedor, CLABE]);
    await c.query(`insert into audit_log (operator_id,company_id,actor_tipo,superficie,accion,entidad,identificador)
      select operator_id,id,'sistema','sistema','clabe_proveedor','supplier_clabes',$2 from companies where id=$1`, [datos.empresa, nuevaClabe]);
    await c.query("commit");
  } catch (error) {
    await c.query("rollback");
    throw error;
  }
  assert.deepEqual((await c.query("select estado,version from supplier_payment_requests where id=$1", [valido.id])).rows[0], { estado: "por_autorizar", version: 2 });
  assert.equal((await c.query("select count(*)::int as n from audit_log where identificador=$1 and accion='regresar_pago_proveedor'", [valido.id])).rows[0].n, 1);
}

async function catalogo(c: pg.Client) {
  // Se comparan definiciones y permisos, no OID ni posición física de columnas.
  return (await c.query(`select tipo, nombre, definicion from (
    select 'columna' as tipo, table_name || '.' || column_name as nombre,
      data_type || ':' || is_nullable || ':' || coalesce(column_default,'') as definicion
      from information_schema.columns where table_schema='public' and table_name like 'supplier_%'
    union all select 'constraint', conrelid::regclass::text || '.' || conname, pg_get_constraintdef(oid)
      from pg_constraint where connamespace='public'::regnamespace and conrelid::regclass::text like 'supplier_%'
    union all select 'indice', indexname, indexdef from pg_indexes where schemaname='public' and tablename like 'supplier_%'
    union all select 'trigger', tgrelid::regclass::text || '.' || tgname, pg_get_triggerdef(oid)
      from pg_trigger where not tgisinternal and tgrelid::regclass::text like 'supplier_%'
    union all select 'funcion', oid::regprocedure::text, pg_get_functiondef(oid)
      from pg_proc where pronamespace='public'::regnamespace and (proname like 'supplier_%' or proname in ('cliente_tiene_rol_operativo','cliente_liberadores_operativos','pagos_listos_regresan_a_revision','historial_pago_append_only','pagos_proveedores_exige_auditoria'))
    union all select 'rls', relname, relrowsecurity || ':' || relforcerowsecurity || ':' || coalesce(relacl::text,'')
      from pg_class where relnamespace='public'::regnamespace and relkind='r' and relname like 'supplier_%'
    union all select 'politica', tablename || '.' || policyname, cmd || ':' || coalesce(qual,'') || ':' || coalesce(with_check,'')
      from pg_policies where schemaname='public' and tablename like 'supplier_%'
    ) c order by tipo,nombre`)).rows;
}

const casos = [
  { nombre: "0022 original", archivo: ORIGINAL },
  { nombre: "0022 con idempotencia", archivo: INTERMEDIA },
  { nombre: "0022 endurecida", archivo: join(MIGRACIONES, "0022_pagos_proveedores.sql") },
  { nombre: "base actual con 0033 aplicada", archivo: join(MIGRACIONES, "0022_pagos_proveedores.sql"), limite: "0034" },
];

test("0034 actualiza las tres 0022 sin repetirlas y conserva las garantías de una instalación nueva", { skip: !urlAdmin }, async (t) => {
  const admin = exigirBaseDesechable();
  await conBaseDesechable(admin, async (urlNueva) => {
    migrar(urlNueva);
    const nueva = await cliente(urlNueva);
    try {
      const esperado = await catalogo(nueva);
      for (const caso of casos) await t.test(caso.nombre, async () => {
        await conBaseDesechable(admin, async (url) => {
          await preparar(url, caso.archivo, caso.limite);
          const c = await cliente(url);
          try {
            const datos = await sembrar(c);
            const marcas = (await c.query("select * from schema_migrations order by version")).rows;
            const originales = (await c.query("select id,company_id,payable_id,clabe,total_centavos,solicitado_por,solicitado_en,creado_en from supplier_payment_requests order by id")).rows;
            const documentos = (await c.query("select * from documents order by id")).rows;
            const historialExiste = (await c.query("select to_regclass('public.supplier_payment_request_history') is not null as existe")).rows[0].existe;
            const historialPrevio = historialExiste ? (await c.query("select * from supplier_payment_request_history order by id")).rows : [];
            const salida = migrar(url);
            assert.ok(salida.includes(`Aplicando ${VERSION}`));
            assert.ok(!salida.includes("Aplicando 0022_"));
            assert.deepEqual((await c.query("select * from schema_migrations where version = any($1) order by version", [marcas.map((m) => m.version)])).rows, marcas);
            assert.deepEqual((await c.query("select id,company_id,payable_id,clabe,total_centavos,solicitado_por,solicitado_en,creado_en from supplier_payment_requests order by id")).rows, originales);
            assert.deepEqual((await c.query("select * from documents order by id")).rows, documentos);
            assert.deepEqual((await c.query("select * from supplier_payment_request_history where id = any($1) order by id", [historialPrevio.map((h) => h.id)])).rows, historialPrevio);
            assert.deepEqual(await catalogo(c), esperado);
            assert.equal((await c.query("select count(*)::int as n from supplier_payables")).rows[0].n, 7);
            for (const nombre of ["clabe_cerrada", "inactivo", "bloqueado"]) {
              const id = datos.pagos[nombre]!.id;
              assert.deepEqual((await c.query("select estado,version,resuelto_por from supplier_payment_requests where id=$1", [id])).rows[0], { estado: "por_autorizar", version: 2, resuelto_por: null });
              assert.equal((await c.query("select count(*)::int as n from supplier_payment_request_history where request_id=$1 and estado='listo_para_pagar' and estado_nuevo='por_autorizar' and resuelto_por=$2", [id, datos.liberador])).rows[0].n, 1);
              assert.equal((await c.query("select count(*)::int as n from audit_log where identificador=$1 and accion='regresar_pago_proveedor'", [id])).rows[0].n, 1);
            }
            assert.equal((await c.query("select anulado_en from supplier_payables where id=$1", [datos.pagos.cancelado!.cargo])).rows[0].anulado_en.toISOString(), "2026-01-02T00:00:00.000Z");
            assert.equal((await c.query("select estado from supplier_payment_requests where id=$1", [datos.pagos.valido!.id])).rows[0].estado, "listo_para_pagar");
            // El segundo pase no reescribe datos ni duplica historial/bitácora.
            const antes = (await c.query("select (select count(*) from supplier_payment_request_history) as historia,(select count(*) from audit_log) as eventos")).rows;
            assert.ok(!migrar(url).includes("Aplicando "));
            assert.deepEqual((await c.query("select (select count(*) from supplier_payment_request_history) as historia,(select count(*) from audit_log) as eventos")).rows, antes);
            await assert.rejects(comoCliente(c, datos, datos.otro, "update supplier_payment_requests set client_request_id=$2 where id=$1", [datos.pagos.rechazado!.id, randomUUID()]), /pago_proveedor_inmutable/);
            await assert.rejects(comoCliente(c, datos, datos.otro, "update supplier_payables set total_centavos=1 where id=$1", [datos.pagos.rechazado!.cargo]), /cargo_proveedor_no_editable/);
            await assert.rejects(c.query("update supplier_payment_request_history set version=999"), /historial_pago_inmutable/);
            await assert.rejects(comoCliente(c, datos, datos.otro, "update supplier_payment_requests set estado='listo_para_pagar',resuelto_por=$2,resuelto_en=now() where id=$1", [datos.pagos.pendiente!.id, datos.otro]), /auditoria_pago_proveedor_ausente/);
            await assert.rejects(comoCliente(c, datos, datos.otro, "update supplier_payment_requests set estado='listo_para_pagar',resuelto_por=$2,resuelto_en=now() where id=$1", [datos.pagos.inactivo!.id, datos.otro]), /pago_proveedor_no_autorizable/);
            const rolesAjenos = await comoCliente(c, datos, datos.otro,
              "select cliente_tiene_rol_operativo($1,$2,array['liberador']) as rol, cliente_liberadores_operativos($1) as liberadores",
              [datos.empresa, datos.liberador], randomUUID());
            assert.deepEqual(rolesAjenos.rows, [{ rol: false, liberadores: 0 }]);
            await comprobarCandadosYRetiro(c, url, datos);
          } finally { await c.end(); }
        });
      });
    } finally { await nueva.end(); }
  });
});

// Fixtures inmutables: se guardan completas para que CI no dependa de git ni
// de un clon con historia. Los hashes son los blobs SQL del historial real.
test("las fixtures de 0022 son las versiones históricas originales", () => {
  assert.equal(createHash("sha256").update(readFileSync(ORIGINAL)).digest("hex"), "4b4b800dbb2cf3ef587ae38715eb88a6fdcda986f1c1bfee92ad742a13772ab0");
  assert.equal(createHash("sha256").update(readFileSync(INTERMEDIA)).digest("hex"), "a3ae1363fd744bb8825f4ce1c8c482b4a81403c69f9f898ad190beeba1feac1d");
});
