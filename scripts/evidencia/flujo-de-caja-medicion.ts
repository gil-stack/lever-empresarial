/**
 * Medición del flujo de caja con 1,000 cuentas por pagar y 200 personas en nómina.
 *
 *   MEDICION_ADMIN_URL=postgres://<dueño>@127.0.0.1:5541/postgres \
 *   npx tsx scripts/evidencia/flujo-de-caja-medicion.ts (salida literal en docs/evidencia/flujo-de-caja/rendimiento.md)
 *
 * Crea una base desechable, aplica db/migrations, siembra el volumen y mide las
 * lecturas reales de la aplicación (servicio + RLS + dominio) como plataforma_app.
 * El volumen se siembra como dueño con session_replication_role = replica: son
 * datos de carga, no un recorrido, y así no hace falta un evento de bitácora por
 * fila. La empresa, su administradora y las áreas sí pasan por los servicios.
 * Solo acepta un Postgres local y no imprime ninguna URL.
 */
import { createHash, randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { cerrarConexion, conContexto } from "../../src/nucleo/db";
import { baseCliente, type ContextoConEmpresa } from "../../src/nucleo/contexto";
import { darDeAltaComoDuena } from "../empresa-por-la-duena";
import { leerFlujoInicio, leerVistaCalendario, leerVistaCobros, leerVistaPresupuestos } from "../../src/server/flujo/servicio";
import { SQL_FUENTES, SQL_PRESUPUESTOS } from "../../src/server/flujo/repositorio";
import { aceptarInvitacion } from "../../src/server/invitaciones/servicio";
import { nombrarCentro } from "../../src/server/personas/servicio";
import { contextoDePersonal, invitarAdministrador } from "../../src/server/plataforma/servicio";
import { leerSesion } from "../../src/server/session/servicio";
import { resolverContexto } from "../../src/server/tenencia/resolver";
import { hoyEnMexico } from "../../src/dominio/personas";
import { desplazar, lunesDe, primeroDelMes, ultimoDelMes } from "../../src/dominio/flujo/fechas";
import { ventanaDe } from "../../src/dominio/flujo/proyeccion";
import { aplicarArchivo, conBaseDesechable, ejecutar, urlDeAplicacion } from "../../tests/aislamiento/postgres";

const ADMIN = process.env.MEDICION_ADMIN_URL ?? "";
const CXP = 1000;
const PERSONAS = 200;
const VUELTAS = 100;
const CALENTAR = 10;
const CLAVE = "clave-medicion-12";

if (!/^postgres(ql)?:\/\/[^@]+@(127\.0\.0\.1|localhost)(:\d+)?\/postgres$/.test(ADMIN)) {
  throw new Error("MEDICION_ADMIN_URL tiene que ser la base postgres de un servidor local (127.0.0.1 o localhost).");
}

async function principal(): Promise<void> {
  await conBaseDesechable(ADMIN, async (url) => {
    const dir = join(process.cwd(), "db/migrations");
    for (const archivo of readdirSync(dir).sort()) if (archivo.endsWith(".sql")) aplicarArchivo(url, join(dir, archivo));
    ejecutar(url, `do $$ begin execute format('alter database %I set timezone to %L', current_database(), 'UTC'); end $$;`);
    process.env.DATABASE_URL = urlDeAplicacion(url);
    try {
      await medir(url);
    } finally {
      await cerrarConexion();
    }
  });
}

async function medir(url: string): Promise<void> {
  const hoy = hoyEnMexico(new Date());
  ejecutar(url, `
    insert into users (id, nombre, correo, password_hash)
      values ('99999999-9999-4999-8999-999999999999', 'Personal', 'personal-medicion@ejemplo.mx', '$2b$12$${"a".repeat(53)}');
    insert into platform_staff (operator_id, user_id, estado)
      values ((select id from operators order by alta_en limit 1), '99999999-9999-4999-8999-999999999999', 'activo');
    insert into platform_staff_roles (operator_id, user_id, rol)
      values ((select id from operators order by alta_en limit 1), '99999999-9999-4999-8999-999999999999', 'administracion_plataforma');
  `);
  const personal = await contextoDePersonal("personal-medicion@ejemplo.mx");
  const empresa = await darDeAltaComoDuena(url, personal, {
    rfc: "TCM010101AB1", razonSocial: "Carga Medición", codigoPostal: "06600", regimen: "601", usoCfdi: "G03",
  }, { demostracion: false, corridoPor: "evidencia@ejemplo.mx" });
  // Otra empresa con 20,000 cuentas por pagar: el volumen ajeno que RLS y los índices tienen que dejar fuera.
  const ruido = await darDeAltaComoDuena(url, personal, {
    rfc: "CABL840215RF4", razonSocial: "Otra Empresa Carga", codigoPostal: "44100", regimen: "612", usoCfdi: "G03",
  }, { demostracion: false, corridoPor: "evidencia@ejemplo.mx" });
  const invitado = await invitarAdministrador(personal, { companyId: empresa.id, razonSocial: empresa.razonSocial, nombre: "Admin Medición", correo: "admin-medicion@ejemplo.mx" });
  await aceptarInvitacion({ token: invitado.emitida.token, contrasena: CLAVE, confirmacion: CLAVE });
  const ctx = (await resolverContexto({ sesion: await sesion(url, invitado.emitida.userId), empresaPedida: empresa.id, peticionId: null, superficie: "cliente" })).ctx as ContextoConEmpresa;
  const areas: string[] = [];
  for (const nombre of ["Operación", "Ventas", "Administración", "Logística"]) {
    areas.push((await nombrarCentro(ctx, { nombre, presupuesto: "500000.00" })).id);
  }

  const lista = areas.map((a) => `'${a}'::uuid`).join(", ");
  ejecutar(url, `
    set session_replication_role = replica;
    insert into employees (id, company_id, cost_center_id, nombre, alta_en, clabe, clabe_digito_valido, presupuesto_mensual_centavos)
      select gen_random_uuid(), '${empresa.id}', (array[${lista}])[1 + (n % 4)], 'Persona ' || n, date '2026-01-01', '002180701150123452', true,
             case when n % 5 = 0 then 2000000 else null end
        from generate_series(1, ${PERSONAS}) n;
    insert into employee_payroll_profiles (employee_id, company_id, neto_centavos, frecuencia, proximo_pago_en, ancla_dia, destino)
      select e.id, e.company_id, 1500000 + (row_number() over (order by e.id)) * 100,
             (array['quincenal','quincenal','quincenal','mensual','semanal'])[1 + (row_number() over (order by e.id))::int % 5],
             date '${desplazar(lunesDe(hoy), 4)}', 30, 'tarjeta'
        from employees e where e.company_id = '${empresa.id}';
    insert into documents (id, company_id, clave_blob, hash_sha256, tipo, nombre_original, creado_en)
      select md5('doc' || n)::uuid, '${empresa.id}', 'carga/constancia-' || n, repeat('a', 64), 'application/pdf', 'c.pdf', now() from generate_series(1, 50) n;
    insert into suppliers (id, company_id, document_id, rfc, razon_social, lista_leida_en, boton_pago, alta_en, nombre_comercial, dias_credito, cost_center_id)
      select md5('prov' || n)::uuid, '${empresa.id}', md5('doc' || n)::uuid, 'A' || chr(65 + n % 26) || chr(65 + n / 26) || '010101AA1', 'Proveedor ' || n,
             now(), false, now(), 'Proveedor ' || n, 30, (array[${lista}])[1 + (n % 4)]
        from generate_series(1, 50) n;
    insert into supplier_clabes (id, company_id, supplier_id, clabe, digito_valido, vigente_desde)
      select md5('clabe' || n)::uuid, '${empresa.id}', md5('prov' || n)::uuid, '002180701150123452', true, now() from generate_series(1, 50) n;
    insert into supplier_payables (id, company_id, supplier_id, origen, cfdi_uuid, serie, folio, referencia, total_centavos, emitida_el, vence_el, programada_el, creado_por, creado_en, actualizado_en)
      select md5('cxp' || n)::uuid, '${empresa.id}', md5('prov' || (1 + n % 50))::uuid, 'cfdi',
             upper(md5('uuid' || n)::uuid::text), 'A', n::text, 'A-' || n, 100000 + n * 37,
             date '${hoy}' - 40, date '${hoy}' - 40 + (n % 130), date '${hoy}' - 30 + (n % 130),
             '${invitado.emitida.userId}', now(), now()
        from generate_series(1, ${CXP}) n;
    insert into supplier_payment_requests (id, company_id, payable_id, supplier_clabe_id, clabe, total_centavos, programada_el, estado, solicitado_por, solicitado_en, resuelto_por, resuelto_en, motivo_resolucion, creado_en)
      select md5('sol' || n)::uuid, p.company_id, p.id, md5('clabe' || (1 + n % 50))::uuid, '002180701150123452', p.total_centavos, p.programada_el,
             (array['por_autorizar','listo_para_pagar','rechazado','cancelado'])[1 + n % 4],
             '${invitado.emitida.userId}', now(),
             case when n % 4 = 0 then null else '99999999-9999-4999-8999-999999999999'::uuid end,
             case when n % 4 = 0 then null else now() end,
             case when n % 4 in (2, 3) then 'Motivo de carga' else null end, now()
        from generate_series(1, 700) n join supplier_payables p on p.id = md5('cxp' || n)::uuid;
    insert into expected_collections (id, company_id, origen, cliente_nombre, concepto, monto_centavos, fecha_probable, estado, creado_por)
      select gen_random_uuid(), '${empresa.id}', 'manual', 'Cliente ' || n, 'Cobro ' || n, 500000 + n, date '${hoy}' - 10 + n, 'esperado', '${invitado.emitida.userId}'
        from generate_series(1, 100) n;
    insert into recurring_obligations (id, company_id, concepto, monto_centavos, frecuencia, proxima_fecha, ancla_dia, cost_center_id, creado_por, actualizado_por)
      select gen_random_uuid(), '${empresa.id}', 'Obligación ' || n, 1000000 + n, (array['semanal','mensual','bimestral','trimestral','anual'])[1 + n % 5],
             date '${hoy}' + n, extract(day from date '${hoy}' + n)::int, (array[${lista}])[1 + (n % 4)], '${invitado.emitida.userId}', '${invitado.emitida.userId}'
        from generate_series(1, 12) n;
    insert into cash_balance_declarations (id, company_id, saldo_centavos, al_dia, declarado_por)
      values (gen_random_uuid(), '${empresa.id}', 500000000, date '${hoy}' - 1, '${invitado.emitida.userId}');
    insert into documents (id, company_id, clave_blob, hash_sha256, tipo, nombre_original, creado_en)
      select md5('rdoc' || n)::uuid, '${ruido.id}', 'carga/ruido-' || n, repeat('b', 64), 'application/pdf', 'c.pdf', now() from generate_series(1, 20) n;
    insert into suppliers (id, company_id, document_id, rfc, razon_social, lista_leida_en, boton_pago, alta_en, nombre_comercial, dias_credito)
      select md5('rprov' || n)::uuid, '${ruido.id}', md5('rdoc' || n)::uuid, 'B' || chr(65 + n % 26) || chr(65 + n / 26) || '010101AA1', 'Ajeno ' || n,
             now(), false, now(), 'Ajeno ' || n, 30
        from generate_series(1, 20) n;
    insert into supplier_payables (id, company_id, supplier_id, origen, cfdi_uuid, serie, folio, referencia, total_centavos, emitida_el, vence_el, programada_el, creado_por, creado_en, actualizado_en)
      select md5('rcxp' || n)::uuid, '${ruido.id}', md5('rprov' || (1 + n % 20))::uuid, 'cfdi',
             upper(md5('ruuid' || n)::uuid::text), 'B', n::text, 'B-' || n, 100000 + n,
             date '${hoy}' - 400, date '${hoy}' - 400 + (n % 500), date '${hoy}' - 390 + (n % 500),
             '${invitado.emitida.userId}', now(), now()
        from generate_series(1, 20000) n;
    set session_replication_role = origin;
    analyze;
  `);

  const conteo = await conContexto(baseCliente(ctx), async (consulta) => (await consulta.query(`
    select (select count(*) from supplier_payables)::int as cxp,
           (select count(*) from supplier_payment_requests)::int as solicitudes,
           (select count(*) from employees)::int as personas,
           (select count(*) from employee_payroll_profiles)::int as nomina,
           (select count(*) from expected_collections)::int as cobros,
           (select count(*) from recurring_obligations)::int as obligaciones`)).rows[0]);
  console.log(`Fecha de la corrida (México): ${hoy}`);
  console.log(`Volumen visible para la empresa (RLS, plataforma_cliente): ${JSON.stringify(conteo)}`);
  console.log("Volumen ajeno en la misma base: otra empresa con 20,000 cuentas por pagar (RLS las deja fuera).");
  console.log(`Vueltas por lectura: ${VUELTAS} medidas tras ${CALENTAR} de calentamiento, en serie, contra Postgres 17 local.`);
  console.log("");

  const lecturas: [string, () => Promise<unknown>][] = [
    ["Inicio (leerFlujoInicio: proyección 13 semanas + presupuestos + cobros)", () => leerFlujoInicio(ctx)],
    ["Inicio con escenario (mover un pago)", () => leerFlujoInicio(ctx, { mover: `cxp:${uuidDe("cxp", 900)}`, fecha: desplazar(hoy, 21) })],
    ["Calendario del mes (leerVistaCalendario)", () => leerVistaCalendario(ctx, hoy.slice(0, 7))],
    ["Presupuestos (leerVistaPresupuestos)", () => leerVistaPresupuestos(ctx)],
    ["Cobros (leerVistaCobros)", () => leerVistaCobros(ctx)],
  ];
  console.log("| Lectura | p50 ms | p95 ms | p99 ms | máx ms |");
  console.log("| --- | ---: | ---: | ---: | ---: |");
  for (const [nombre, leer] of lecturas) {
    for (let i = 0; i < CALENTAR; i += 1) await leer();
    const tiempos: number[] = [];
    for (let i = 0; i < VUELTAS; i += 1) {
      const inicio = performance.now();
      await leer();
      tiempos.push(performance.now() - inicio);
    }
    tiempos.sort((a, b) => a - b);
    const p = (q: number) => tiempos[Math.min(tiempos.length - 1, Math.ceil(q * tiempos.length) - 1)]!.toFixed(1);
    console.log(`| ${nombre} | ${p(0.5)} | ${p(0.95)} | ${p(0.99)} | ${tiempos.at(-1)!.toFixed(1)} |`);
  }

  const { inicio: desde, fin } = ventanaDe(hoy);
  for (const [titulo, sql, params] of [
    // Los mismos parámetros que usa la aplicación: desde el día siguiente al saldo declarado (ayer) hasta el fin de la ventana.
    [`EXPLAIN (ANALYZE, BUFFERS) de las fuentes de la proyección, como plataforma_cliente con RLS (ventana ${desde} a ${fin}, movimientos desde ${hoy})`, SQL_FUENTES, [empresa.id, hoy, fin]],
    [`EXPLAIN (ANALYZE, BUFFERS) de las fuentes de presupuestos, como plataforma_cliente con RLS (mes ${primeroDelMes(hoy)} a ${ultimoDelMes(hoy)})`, SQL_PRESUPUESTOS, [empresa.id, primeroDelMes(hoy), ultimoDelMes(hoy)]],
  ] as const) {
    const plan = await conContexto(baseCliente(ctx), async (consulta) =>
      (await consulta.query(`explain (analyze, buffers, costs off) ${sql}`, [...params])).rows.map((fila) => String((fila as Record<string, unknown>)["QUERY PLAN"])));
    console.log("");
    console.log(`${titulo}:`);
    console.log("```");
    for (const linea of plan) console.log(linea);
    console.log("```");
  }
}

function uuidDe(prefijo: string, n: number): string {
  const h = createHash("md5").update(`${prefijo}${n}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

async function sesion(url: string, userId: string) {
  const token = `S${randomUUID().replace(/-/g, "")}AAAAAAAAAA`.slice(0, 43);
  const entradaId = randomUUID();
  ejecutar(url, `
    insert into auth_entradas (id, user_id, token_hash, creada_en, vence_en, verificada_con, verificada_en, consumida_en)
      values ('${entradaId}', '${userId}', '${createHash("sha256").update(entradaId).digest("hex")}', now(), now() + interval '10 minutes', 'totp', now(), now());
    insert into sessions (id, user_id, token_hash, expires_at, segundo_factor, entrada_id)
      values ('${randomUUID()}', '${userId}', '${createHash("sha256").update(token).digest("hex")}', now() + interval '12 hours', 'totp', '${entradaId}');
  `);
  const leida = await leerSesion(`sesion=${token}`);
  if (!leida?.segundoFactor) throw new Error("La sesión de medición no quedó abierta.");
  return leida;
}

principal().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "La medición falló.");
  process.exitCode = 1;
});
