/**
 * Medición del runway: la tarea de alertas con 1,000 empresas y /consola/flujo con volumen.
 *
 *   MEDICION_ADMIN_URL=postgres://<dueño>@127.0.0.1:5583/postgres \
 *   npx tsx scripts/evidencia/runway-medicion.ts (salida literal en docs/evidencia/runway/rendimiento.md)
 *
 * Crea una base desechable y aplica db/migrations.
 *
 * 1. Tarea: 1,000 empresas reales dadas de alta por el servicio. Su administradora,
 *    saldo, renta y colchón se siembran como dueño con session_replication_role =
 *    replica (son datos de carga, no un recorrido). Corre la tarea real
 *    (correrAlertasDeCaja: plataforma_tarea, RLS por empresa, candado, fotos,
 *    avisos, correo con ritmo) con un proveedor simulado que tarda lo que una
 *    llamada HTTP, y la vuelve a correr 15 minutos después, sin cambios.
 * 2. Página: una empresa con nómina de 200 personas, 1,000 cuentas por pagar y
 *    1,000 cargos de cobranza (50 planes), más otra empresa con 20,000 cuentas
 *    por pagar que RLS deja fuera. Mide las lecturas de la página en el proceso
 *    y la página completa por HTTP con `next start` (el build de .next) en el
 *    puerto 3183, con la cookie de sesión de producción. Imprime el EXPLAIN de la
 *    sentencia del runway.
 *
 * Solo acepta un Postgres local y no imprime URL, correos ni ids.
 */
import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { cerrarConexion, conContexto } from "../../src/nucleo/db";
import { baseCliente, type ContextoConEmpresa } from "../../src/nucleo/contexto";
import { darDeAltaEmpresa } from "../../src/server/company/servicio";
import { correrAlertasDeCaja, PRESUPUESTO_MS } from "../../src/server/flujo/alertas-caja";
import { CONCURRENCIA, RITMO_MS } from "../../src/server/flujo/correo-semanal";
import { leerVistaRunway, SQL_RUNWAY } from "../../src/server/flujo/runway";
import { leerVistaSaldo } from "../../src/server/flujo/servicio";
import { aceptarInvitacion } from "../../src/server/invitaciones/servicio";
import { contextoDePersonal, invitarAdministrador } from "../../src/server/plataforma/servicio";
import { leerSesion } from "../../src/server/session/servicio";
import { resolverContexto } from "../../src/server/tenencia/resolver";
import { hoyEnMexico } from "../../src/dominio/personas";
import { desplazar, lunesDe } from "../../src/dominio/flujo/fechas";
import { horizonteDe } from "../../src/dominio/flujo/runway";
import { aplicarArchivo, conBaseDesechable, consultarJson, ejecutar, urlDeAplicacion } from "../../tests/aislamiento/postgres";

const ADMIN = process.env.MEDICION_ADMIN_URL ?? "";
const EMPRESAS = 1000;
const PERSONAS = 200;
const CXP = 1000;
const PLANES = 50;
const PERIODOS = 20;
const VUELTAS = 100;
const CALENTAR = 10;
const PUERTO = 3183;
/** Lo que tarda una llamada a la API del proveedor desde la función (estimación; la real se ve en sus registros). */
const LATENCIA_PROVEEDOR_MS = 150;
const CLAVE = "clave-medicion-12";
const HASH = `$2b$12$${"a".repeat(53)}`;

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
      const hoy = hoyEnMexico(new Date());
      ejecutar(url, `
        insert into users (id, nombre, correo, password_hash)
          values ('99999999-9999-4999-8999-999999999999', 'Personal', 'personal-medicion@ejemplo.mx', '${HASH}');
        insert into platform_staff (operator_id, user_id, estado)
          values ((select id from operators order by alta_en limit 1), '99999999-9999-4999-8999-999999999999', 'activo');
        insert into platform_staff_roles (operator_id, user_id, rol)
          values ((select id from operators order by alta_en limit 1), '99999999-9999-4999-8999-999999999999', 'administracion_plataforma');
      `);
      console.log(`Fecha de la corrida (México): ${hoy}. Postgres 17 local en Apple Silicon: la base no tiene la latencia de red de Neon, así que el tiempo de base es un piso.`);
      console.log("");
      await medirTarea(url, hoy);
      await medirPagina(url, hoy);
    } finally {
      await cerrarConexion();
    }
  });
}

// ---------------------------------------------------------------- 1. Tarea

async function medirTarea(url: string, hoy: string): Promise<void> {
  const personal = await contextoDePersonal("personal-medicion@ejemplo.mx");
  const letra = (n: number) => String.fromCharCode(65 + n);
  const ids: string[] = [];
  const inicioAltas = performance.now();
  for (let i = 0; i < EMPRESAS; i += 1) {
    const dia = String(1 + Math.floor(i / 676)).padStart(2, "0");
    const empresa = await darDeAltaEmpresa(personal, {
      rfc: `E${letra(i % 26)}${letra(Math.floor(i / 26) % 26)}0101${dia}AB1`,
      razonSocial: `Empresa Runway ${i + 1}`,
      codigoPostal: "06600",
      regimen: "601",
      usoCfdi: "G03",
    }, { demostracion: false });
    ids.push(empresa.id);
  }
  const altasMs = performance.now() - inicioAltas;
  const valores = ids.map((id, n) => `(${n}, '${id}'::uuid, '${randomUUID()}'::uuid)`).join(",\n");
  // n % 4 = 0: $100,000 y renta de $60,000 (cruza el colchón y el mínimo de meses).
  // n % 4 = 1: $500,000, renta de $60,000 y colchón de $450,000 (cruza solo el colchón).
  // n % 4 ≥ 2: $2,000,000 y renta de $30,000 (holgada, sin aviso).
  ejecutar(url, `
    set session_replication_role = replica;
    create temp table m (n int, company_id uuid, user_id uuid);
    insert into m values ${valores};
    insert into users (id, nombre, correo, password_hash) select user_id, 'Admin ' || n, 'admin-' || n || '@medicion.test', '${HASH}' from m;
    insert into memberships (user_id, company_id, estado) select user_id, company_id, 'activa' from m;
    insert into membership_roles (user_id, company_id, rol) select user_id, company_id, 'administrador' from m;
    insert into cash_balance_declarations (id, company_id, saldo_centavos, al_dia, declarado_por)
      select gen_random_uuid(), company_id, case n % 4 when 0 then 10000000 when 1 then 50000000 else 200000000 end, date '${desplazar(hoy, -1)}', user_id from m;
    insert into recurring_obligations (id, company_id, concepto, monto_centavos, frecuencia, proxima_fecha, ancla_dia, creado_por, actualizado_por)
      select gen_random_uuid(), company_id, 'Renta', case when n % 4 < 2 then 6000000 else 3000000 end, 'mensual',
             date '${desplazar(hoy, 3)}', extract(day from date '${desplazar(hoy, 3)}')::int, user_id, user_id from m;
    insert into cash_flow_settings (company_id, colchon_centavos, actualizado_por) select company_id, 45000000, user_id from m where n % 4 = 1;
    set session_replication_role = origin;
    analyze;
  `);

  console.log("## 1. Tarea de alertas de caja con 1,000 empresas");
  console.log("");
  console.log(`Empresas reales dadas de alta por el servicio: ${EMPRESAS}, en ${(altasMs / 1000).toFixed(1)} s. Cada una con administradora, saldo declarado ayer y una renta mensual que vence en 3 días:`);
  console.log("- 250 con $100,000 y renta de $60,000: cruzan el colchón (el saldo queda negativo) y el mínimo de 3 meses; un aviso con las dos.");
  console.log("- 250 con $500,000, renta de $60,000 y colchón de $450,000: cruzan solo el colchón.");
  console.log("- 500 con $2,000,000 y renta de $30,000: sin aviso.");
  console.log("");
  console.log("La mitad de las empresas cruzando a la vez es el peor caso, no el día normal: sirve para ver el tope del ritmo de correo.");
  console.log(`Tarea: concurrencia ${CONCURRENCIA} (tope del pool), presupuesto ${PRESUPUESTO_MS / 1000} s de los 300 s de maxDuration, ritmo de correo ${RITMO_MS} ms. Proveedor simulado: ${LATENCIA_PROVEEDOR_MS} ms por llamada.`);
  console.log("");
  console.log("| Corrida | Empresas | Evaluadas | Fotos | Avisos | Enviados | Fallidos | Pendientes | Fallidas | Filas nuevas en la bitácora | Total s | ms por empresa |");
  console.log("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");

  const lineas: string[] = [];
  const enviar = async () => {
    await new Promise((listo) => setTimeout(listo, LATENCIA_PROVEEDOR_MS));
    return { id: randomUUID() };
  };
  const base = Date.now();
  for (const [nombre, desfaseMin] of [
    ["Primera de la semana", 0],
    ["15 minutos después, sin cambios", 15],
  ] as const) {
    const bitacoraAntes = contar(url, "select count(*) from audit_log");
    const inicio = performance.now();
    const r = await correrAlertasDeCaja({
      ahora: () => new Date(base + desfaseMin * 60_000),
      enviador: () => enviar,
      urlPublica: () => "https://lever.test",
      registrar: (campos) => {
        if (campos.evento === "alertas_caja_corrida") lineas.push(JSON.stringify(campos));
      },
    });
    const totalMs = performance.now() - inicio;
    const bitacora = contar(url, "select count(*) from audit_log") - bitacoraAntes;
    console.log(
      `| ${nombre} | ${r.empresas} | ${r.evaluadas} | ${r.fotos} | ${r.avisos} | ${r.correos.enviados} | ${r.correos.fallidos} | ${r.pendientes} | ${r.fallidas} | ${bitacora} | ${(totalMs / 1000).toFixed(1)} | ${(totalMs / r.empresas).toFixed(0)} |`,
    );
  }
  const base1 = consultarJson<unknown>(url, `
    select json_build_object(
      'fotos', (select count(*) from cash_runway_snapshots),
      'fotos_semana', (select count(*) from cash_runway_snapshots where semana = date '${lunesDe(hoy)}'),
      'avisos_por_estado', (select json_object_agg(estado, n) from (select estado, count(*) n from cash_alerts group by estado) x),
      'avisos_colchon_y_runway', (select count(*) from cash_alerts where colchon and runway),
      'avisos_solo_colchon', (select count(*) from cash_alerts where colchon and not runway),
      'estados_bajo_colchon', (select count(*) from cash_alert_states where bajo_colchon),
      'estados_runway_bajo', (select count(*) from cash_alert_states where runway_bajo),
      'entregas', (select count(*) from cash_alert_deliveries))`);
  console.log("");
  console.log(`En la base después de las dos corridas: ${JSON.stringify(base1)}`);
  console.log("");
  console.log("Línea de registro de cada corrida (lo único que la tarea escribe en los registros):");
  console.log("```");
  for (const linea of lineas) console.log(linea);
  console.log("```");
  console.log("");
}

// ---------------------------------------------------------------- 2. Página

async function medirPagina(url: string, hoy: string): Promise<void> {
  const personal = await contextoDePersonal("personal-medicion@ejemplo.mx");
  const empresa = await darDeAltaEmpresa(personal, {
    rfc: "TCM010101AB1", razonSocial: "Carga Runway", codigoPostal: "06600", regimen: "601", usoCfdi: "G03",
  }, { demostracion: false });
  const ruido = await darDeAltaEmpresa(personal, {
    rfc: "CABL840215RF4", razonSocial: "Otra Empresa Carga", codigoPostal: "44100", regimen: "612", usoCfdi: "G03",
  }, { demostracion: false });
  const invitado = await invitarAdministrador(personal, { companyId: empresa.id, razonSocial: empresa.razonSocial, nombre: "Admin Carga", correo: "admin-carga@ejemplo.mx" });
  await aceptarInvitacion({ token: invitado.emitida.token, contrasena: CLAVE, confirmacion: CLAVE });
  const yo = invitado.emitida.userId;
  const { token, sesion } = await abrirSesion(url, yo);
  const ctx = (await resolverContexto({ sesion, empresaPedida: empresa.id, peticionId: null, superficie: "cliente" })).ctx as ContextoConEmpresa;
  const e = empresa.id;
  const primer = desplazar(hoy, -455); // 15 meses atrás: periodos 0-14 pagados, uno emitido y los siguientes por emitir.

  ejecutar(url, `
    set session_replication_role = replica;
    insert into cost_centers (id, company_id, nombre) select gen_random_uuid(), '${e}', 'Área ' || n from generate_series(1, 4) n;
    insert into employees (id, company_id, cost_center_id, nombre, alta_en, clabe, clabe_digito_valido)
      select gen_random_uuid(), '${e}', (select id from cost_centers where company_id = '${e}' order by id offset (n % 4) limit 1),
             'Persona ' || n, date '2026-01-01', '002180701150123452', true
        from generate_series(1, ${PERSONAS}) n;
    insert into employee_payroll_profiles (employee_id, company_id, neto_centavos, frecuencia, proximo_pago_en, ancla_dia, destino)
      select e.id, e.company_id, 1500000 + (row_number() over (order by e.id)) * 100,
             (array['quincenal','quincenal','quincenal','mensual','semanal'])[1 + (row_number() over (order by e.id))::int % 5],
             date '${desplazar(lunesDe(hoy), 4)}', 30, 'tarjeta'
        from employees e where e.company_id = '${e}';
    insert into documents (id, company_id, clave_blob, hash_sha256, tipo, nombre_original, creado_en)
      select md5('doc' || n)::uuid, '${e}', 'carga/constancia-' || n, repeat('a', 64), 'application/pdf', 'c.pdf', now() from generate_series(1, 50) n;
    insert into suppliers (id, company_id, document_id, rfc, razon_social, lista_leida_en, boton_pago, alta_en, nombre_comercial, dias_credito)
      select md5('prov' || n)::uuid, '${e}', md5('doc' || n)::uuid, 'A' || chr(65 + n % 26) || chr(65 + n / 26) || '010101AA1', 'Proveedor ' || n,
             now(), false, now(), 'Proveedor ' || n, 30
        from generate_series(1, 50) n;
    insert into supplier_clabes (id, company_id, supplier_id, clabe, digito_valido, vigente_desde)
      select md5('clabe' || n)::uuid, '${e}', md5('prov' || n)::uuid, '002180701150123452', true, now() from generate_series(1, 50) n;
    insert into supplier_payables (id, company_id, supplier_id, origen, cfdi_uuid, serie, folio, referencia, total_centavos, emitida_el, vence_el, programada_el, creado_por, creado_en, actualizado_en)
      select md5('cxp' || n)::uuid, '${e}', md5('prov' || (1 + n % 50))::uuid, 'cfdi',
             upper(md5('uuid' || n)::uuid::text), 'A', n::text, 'A-' || n, 100000 + n * 37,
             date '${hoy}' - 40, date '${hoy}' - 40 + (n % 400), date '${hoy}' - 30 + (n % 400), '${yo}', now(), now()
        from generate_series(1, ${CXP}) n;
    insert into supplier_payment_requests (id, company_id, payable_id, supplier_clabe_id, clabe, total_centavos, programada_el, estado, solicitado_por, solicitado_en, resuelto_por, resuelto_en, motivo_resolucion, creado_en)
      select md5('sol' || n)::uuid, p.company_id, p.id, md5('clabe' || (1 + n % 50))::uuid, '002180701150123452', p.total_centavos, p.programada_el,
             (array['por_autorizar','listo_para_pagar','rechazado','cancelado'])[1 + n % 4], '${yo}', now(),
             case when n % 4 = 0 then null else '99999999-9999-4999-8999-999999999999'::uuid end,
             case when n % 4 = 0 then null else now() end,
             case when n % 4 in (2, 3) then 'Motivo de carga' else null end, now()
        from generate_series(1, 700) n join supplier_payables p on p.id = md5('cxp' || n)::uuid;
    insert into expected_collections (id, company_id, origen, cliente_nombre, concepto, monto_centavos, fecha_probable, estado, creado_por)
      select gen_random_uuid(), '${e}', 'manual', 'Cliente ' || n, 'Cobro ' || n, 500000 + n, date '${hoy}' - 10 + n * 3, 'esperado', '${yo}'
        from generate_series(1, 100) n;
    insert into recurring_obligations (id, company_id, concepto, monto_centavos, frecuencia, proxima_fecha, ancla_dia, creado_por, actualizado_por)
      select gen_random_uuid(), '${e}', 'Obligación ' || n, 1000000 + n, (array['semanal','mensual','bimestral','trimestral','anual'])[1 + n % 5],
             date '${hoy}' + n, extract(day from date '${hoy}' + n)::int, '${yo}', '${yo}'
        from generate_series(1, 12) n;
    insert into cash_balance_declarations (id, company_id, saldo_centavos, al_dia, declarado_por)
      values (gen_random_uuid(), '${e}', 500000000, date '${desplazar(hoy, -1)}', '${yo}');
    insert into collection_customers (id, company_id, nombre, correos, creado_por, actualizado_por)
      select md5('cli' || n)::uuid, '${e}', 'Cliente Plan ' || n, array['cliente-' || n || '@medicion.test'], '${yo}', '${yo}' from generate_series(1, ${PLANES}) n;
    insert into collection_plans (id, company_id, customer_id, concepto, tipo, monto_centavos, periodicidad, primer_vencimiento, creado_por, actualizado_por)
      select md5('plan' || n)::uuid, '${e}', md5('cli' || n)::uuid, 'Servicio ' || n,
             case when n % 10 < 7 then 'fijo' else 'variable' end, case when n % 10 < 7 then 2000000 + n * 100 else null end,
             'mensual', date '${primer}', '${yo}', '${yo}'
        from generate_series(1, ${PLANES}) n;
    insert into collection_charges (id, company_id, customer_id, plan_id, periodo, concepto, monto_centavos, vencimiento, referencia, estado,
                                    pagado_centavos, pagado_el, emitido_en)
      select gen_random_uuid(), '${e}', md5('cli' || n)::uuid, md5('plan' || n)::uuid, p, 'Servicio ' || n,
             case when p > 15 then null else coalesce(pl.monto_centavos, 1500000 + ((n * 7 + p * 13) % 10) * 100000) end,
             (date '${primer}' + make_interval(months => p))::date,
             (select b || d from (select lpad((n * ${PERIODOS} + p)::text, 6, '0') b) x, generate_series(0, 9) d where cobranza_referencia_valida(b || d) limit 1),
             case when p < 15 then 'pagado' when p = 15 then 'emitido' else 'por_emitir' end,
             case when p < 15 then coalesce(pl.monto_centavos, 1500000 + ((n * 7 + p * 13) % 10) * 100000) else 0 end,
             case when p < 15 then (date '${primer}' + make_interval(months => p))::date else null end,
             case when p > 15 then null else now() end
        from generate_series(1, ${PLANES}) n cross join generate_series(0, ${PERIODOS - 1}) p
        join collection_plans pl on pl.id = md5('plan' || n)::uuid;
    insert into documents (id, company_id, clave_blob, hash_sha256, tipo, nombre_original, creado_en)
      select md5('rdoc' || n)::uuid, '${ruido.id}', 'carga/ruido-' || n, repeat('b', 64), 'application/pdf', 'c.pdf', now() from generate_series(1, 20) n;
    insert into suppliers (id, company_id, document_id, rfc, razon_social, lista_leida_en, boton_pago, alta_en, nombre_comercial, dias_credito)
      select md5('rprov' || n)::uuid, '${ruido.id}', md5('rdoc' || n)::uuid, 'B' || chr(65 + n % 26) || chr(65 + n / 26) || '010101AA1', 'Ajeno ' || n,
             now(), false, now(), 'Ajeno ' || n, 30
        from generate_series(1, 20) n;
    insert into supplier_payables (id, company_id, supplier_id, origen, cfdi_uuid, serie, folio, referencia, total_centavos, emitida_el, vence_el, programada_el, creado_por, creado_en, actualizado_en)
      select md5('rcxp' || n)::uuid, '${ruido.id}', md5('rprov' || (1 + n % 20))::uuid, 'cfdi',
             upper(md5('ruuid' || n)::uuid::text), 'B', n::text, 'B-' || n, 100000 + n,
             date '${hoy}' - 400, date '${hoy}' - 400 + (n % 500), date '${hoy}' - 390 + (n % 500), '${yo}', now(), now()
        from generate_series(1, 20000) n;
    set session_replication_role = origin;
    analyze;
  `);
  // Doce fotos semanales para que la tendencia se dibuje completa, como la deja la tarea.
  ejecutar(url, `
    set session_replication_role = replica;
    insert into cash_runway_snapshots (id, company_id, semana, semanas_conservador, semanas_esperado, horizonte_semanas, saldo_centavos, saldo_al_dia, colchon_centavos, meses_minimos)
      select gen_random_uuid(), '${e}', date '${lunesDe(hoy)}' - 7 * k, 20 + k, 30 + k, 53, 500000000, date '${desplazar(hoy, -1)}' - 7 * k, 0, 3
        from generate_series(0, 11) k;
    set session_replication_role = origin;
  `);

  const conteo = await conContexto(baseCliente(ctx), async (consulta) => (await consulta.query(`
    select (select count(*) from supplier_payables)::int as cuentas_por_pagar,
           (select count(*) from supplier_payment_requests)::int as solicitudes,
           (select count(*) from employee_payroll_profiles)::int as nomina,
           (select count(*) from expected_collections)::int as cobros_esperados,
           (select count(*) from recurring_obligations)::int as obligaciones,
           (select count(*) from collection_plans)::int as planes,
           (select count(*) from collection_charges)::int as cargos_de_cobranza,
           (select count(*) from cash_runway_snapshots)::int as fotos`)).rows[0]);

  console.log("## 2. /consola/flujo con volumen");
  console.log("");
  console.log(`Volumen visible para la empresa (RLS, plataforma_cliente): ${JSON.stringify(conteo)}`);
  console.log("Volumen ajeno en la misma base: otra empresa con 20,000 cuentas por pagar y las 1,000 empresas de la tarea (RLS las deja fuera).");
  console.log(`Vueltas por medición: ${VUELTAS} tras ${CALENTAR} de calentamiento, en serie.`);
  console.log("");

  const servidor = await levantarNext();
  try {
    const ruta = `http://localhost:${PUERTO}/c/${e}/consola/flujo`;
    const cookie = `__Host-sesion=${token}`;
    const pagina = async () => {
      const respuesta = await fetch(ruta, { headers: { cookie }, redirect: "manual" });
      const html = await respuesta.text();
      if (respuesta.status !== 200 || !html.includes('data-tabla="runway-meses"') || !html.includes('data-tendencia="real"')) {
        throw new Error(`La página no respondió con el runway (estado ${respuesta.status}).`);
      }
    };
    const mediciones: [string, () => Promise<unknown>][] = [
      ["leerVistaRunway (fuentes + planes en 1 sentencia, N, estado, fotos, aviso)", () => leerVistaRunway(ctx)],
      ["leerVistaSaldo (lo que ya leía la página)", () => leerVistaSaldo(ctx)],
      ["Las dos en paralelo, como la página", () => Promise.allSettled([leerVistaSaldo(ctx), leerVistaRunway(ctx)])],
      [`GET /consola/flujo por HTTP con next start (HTML completo, ${PUERTO})`, pagina],
    ];
    console.log("| Medición | p50 ms | p95 ms | p99 ms | máx ms |");
    console.log("| --- | ---: | ---: | ---: | ---: |");
    for (const [nombre, medir] of mediciones) {
      for (let i = 0; i < CALENTAR; i += 1) await medir();
      const tiempos: number[] = [];
      for (let i = 0; i < VUELTAS; i += 1) {
        const inicio = performance.now();
        await medir();
        tiempos.push(performance.now() - inicio);
      }
      tiempos.sort((a, b) => a - b);
      const p = (q: number) => tiempos[Math.min(tiempos.length - 1, Math.ceil(q * tiempos.length) - 1)]!.toFixed(1);
      console.log(`| ${nombre} | ${p(0.5)} | ${p(0.95)} | ${p(0.99)} | ${tiempos.at(-1)!.toFixed(1)} |`);
    }
  } finally {
    await detenerNext(servidor);
  }

  const fin = horizonteDe(hoy).fin;
  const plan = await conContexto(baseCliente(ctx), async (consulta) =>
    (await consulta.query(`explain (analyze, buffers, costs off) ${SQL_RUNWAY}`, [e, hoy, fin])).rows.map((fila) =>
      String((fila as Record<string, unknown>)["QUERY PLAN"])));
  console.log("");
  console.log(`EXPLAIN (ANALYZE, BUFFERS) de la sentencia del runway (fuentes + planes), como plataforma_cliente con RLS (movimientos desde ${hoy} hasta ${fin}):`);
  console.log("```");
  for (const linea of plan) console.log(linea);
  console.log("```");
}

// ---------------------------------------------------------------- Apoyo

function contar(url: string, sql: string): number {
  return Number(consultarJson<number[]>(url, `select json_build_array((${sql}))`)[0]);
}

async function abrirSesion(url: string, userId: string) {
  const token = `S${randomUUID().replace(/-/g, "")}AAAAAAAAAA`.slice(0, 43);
  const entradaId = randomUUID();
  ejecutar(url, `
    insert into auth_entradas (id, user_id, token_hash, creada_en, vence_en, verificada_con, verificada_en, consumida_en)
      values ('${entradaId}', '${userId}', '${createHash("sha256").update(entradaId).digest("hex")}', now(), now() + interval '10 minutes', 'totp', now(), now());
    insert into sessions (id, user_id, token_hash, expires_at, segundo_factor, entrada_id)
      values ('${randomUUID()}', '${userId}', '${createHash("sha256").update(token).digest("hex")}', now() + interval '12 hours', 'totp', '${entradaId}');
  `);
  const sesion = await leerSesion(`sesion=${token}`);
  if (!sesion?.segundoFactor) throw new Error("La sesión de medición no quedó abierta.");
  return { token, sesion };
}

type Servidor = { pid: number; salida: string[]; terminado: () => boolean };

async function levantarNext(): Promise<Servidor> {
  const salida: string[] = [];
  const hijo = spawn(join(process.cwd(), "node_modules/.bin/next"), ["start", "-p", String(PUERTO)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "production",
      URL_APLICACION: `http://localhost:${PUERTO}`,
      AUTENTICACION_LLAVE_TOTP: randomBytes(32).toString("base64url"),
    },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  hijo.stdout?.on("data", (d: Buffer) => salida.push(d.toString()));
  hijo.stderr?.on("data", (d: Buffer) => salida.push(d.toString()));
  if (!hijo.pid) throw new Error("No se pudo arrancar next start.");
  const servidor = { pid: hijo.pid, salida, terminado: () => hijo.exitCode !== null };
  for (let intento = 0; intento < 120; intento += 1) {
    if (servidor.terminado()) throw new Error(`next start terminó antes de abrir el puerto: ${salida.join("").slice(-2000)}`);
    try {
      if ((await fetch(`http://localhost:${PUERTO}/salud`)).ok) return servidor;
    } catch {
      // Todavía arranca.
    }
    await new Promise((listo) => setTimeout(listo, 500));
  }
  await detenerNext(servidor);
  throw new Error(`next start no abrió el puerto ${PUERTO} en 60 segundos.`);
}

async function detenerNext(servidor: Servidor): Promise<void> {
  try {
    process.kill(-servidor.pid, "SIGTERM");
  } catch {
    return;
  }
  for (let intento = 0; intento < 40 && !servidor.terminado(); intento += 1) await new Promise((listo) => setTimeout(listo, 250));
  if (!servidor.terminado()) {
    try {
      process.kill(-servidor.pid, "SIGKILL");
    } catch {
      // Ya terminó.
    }
  }
}

principal().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "La medición falló.");
  process.exitCode = 1;
});
