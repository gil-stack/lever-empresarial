/**
 * Medición del correo semanal con 200 empresas reales simuladas.
 *
 *   MEDICION_ADMIN_URL=postgres://<dueño>@127.0.0.1:5541/postgres \
 *   npx tsx scripts/evidencia/flujo-de-caja-correo-200.ts (salida literal en docs/evidencia/flujo-de-caja/correo-200.md)
 *
 * Crea una base desechable, aplica db/migrations y da de alta 200 empresas por
 * los servicios (empresa, administradora, saldo, un cobro y una obligación).
 * Después corre la tarea real (enviarCorreosSemanales: plataforma_tarea, RLS,
 * proyección, plantilla, registro por persona) con un proveedor simulado que
 * tarda lo que tarda una llamada HTTP y mide tiempo total, ritmo de envío y
 * cuántas empresas caben en el tiempo de la ruta. Solo acepta un Postgres local
 * y no imprime URL, correos ni ids.
 */
import { createHash, randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { cerrarConexion } from "../../src/nucleo/db";
import type { ContextoConEmpresa } from "../../src/nucleo/contexto";
import { darDeAltaEmpresa } from "../../src/server/company/servicio";
import { CONCURRENCIA, enviarCorreosSemanales, PRESUPUESTO_MS, RITMO_MS } from "../../src/server/flujo/correo-semanal";
import { declararSaldo, registrarCobro, registrarObligacion } from "../../src/server/flujo/servicio";
import { aceptarInvitacion } from "../../src/server/invitaciones/servicio";
import { contextoDePersonal, invitarAdministrador } from "../../src/server/plataforma/servicio";
import { leerSesion } from "../../src/server/session/servicio";
import { resolverContexto } from "../../src/server/tenencia/resolver";
import { aplicarArchivo, conBaseDesechable, consultarJson, ejecutar, urlDeAplicacion } from "../../tests/aislamiento/postgres";

const ADMIN = process.env.MEDICION_ADMIN_URL ?? "";
const EMPRESAS = 200;
/** Lo que tarda una llamada a la API del proveedor desde la función (estimación; la real se ve en sus registros). */
const LATENCIA_PROVEEDOR_MS = 150;
const CLAVE = "clave-medicion-12";
const VIERNES = new Date("2026-11-06T18:00:00.000Z");
const AHORA = { ahora: () => VIERNES };

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
  ejecutar(url, `
    insert into users (id, nombre, correo, password_hash)
      values ('99999999-9999-4999-8999-999999999999', 'Personal', 'personal-medicion@ejemplo.mx', '$2b$12$${"a".repeat(53)}');
    insert into platform_staff (operator_id, user_id, estado)
      values ((select id from operators order by alta_en limit 1), '99999999-9999-4999-8999-999999999999', 'activo');
    insert into platform_staff_roles (operator_id, user_id, rol)
      values ((select id from operators order by alta_en limit 1), '99999999-9999-4999-8999-999999999999', 'administracion_plataforma');
  `);
  const personal = await contextoDePersonal("personal-medicion@ejemplo.mx");
  const letra = (n: number) => String.fromCharCode(65 + n);
  const inicioAltas = performance.now();
  for (let i = 0; i < EMPRESAS; i += 1) {
    const empresa = await darDeAltaEmpresa(personal, {
      rfc: `E${letra(i % 26)}${letra(Math.floor(i / 26))}010101AB${i % 10}`,
      razonSocial: `Empresa Medición ${i + 1}`,
      codigoPostal: "06600",
      regimen: "601",
      usoCfdi: "G03",
    }, { demostracion: false });
    const invitado = await invitarAdministrador(personal, {
      companyId: empresa.id, razonSocial: empresa.razonSocial, nombre: `Admin ${i + 1}`, correo: `admin-${i + 1}@medicion.test`,
    });
    await aceptarInvitacion({ token: invitado.emitida.token, contrasena: CLAVE, confirmacion: CLAVE });
    const ctx = (await resolverContexto({ sesion: await sesion(url, invitado.emitida.userId), empresaPedida: empresa.id, peticionId: null, superficie: "cliente" }))
      .ctx as ContextoConEmpresa;
    await declararSaldo(ctx, { saldo: `${100_000 + i}.00`, alDia: "2026-11-05", altaId: randomUUID() }, AHORA);
    await registrarCobro(ctx, { clienteNombre: "Cliente", clienteRfc: "", concepto: "Colegiaturas", monto: "25000.00", fechaProbable: "2026-11-20", referencia: "", altaId: randomUUID() }, AHORA);
    await registrarObligacion(ctx, { concepto: "Renta", monto: "30000.00", frecuencia: "mensual", proximaFecha: "2026-11-15", areaId: "", altaId: randomUUID() }, AHORA);
  }
  const altasMs = performance.now() - inicioAltas;

  console.log(`Empresas reales dadas de alta por los servicios: ${EMPRESAS} (cada una con administradora, saldo, un cobro y una obligación), en ${(altasMs / 1000).toFixed(1)} s.`);
  console.log(`Tarea: concurrencia ${CONCURRENCIA} (tope del pool), presupuesto ${PRESUPUESTO_MS / 1000} s de los 300 s de maxDuration.`);
  console.log(`Proveedor simulado: ${LATENCIA_PROVEEDOR_MS} ms por llamada. Límite de Resend: 10 peticiones por segundo por equipo, sin ráfaga.`);
  console.log("Postgres 17 local; la base no tiene la latencia de red de Neon, así que el tiempo de base es un piso.");
  console.log("");
  console.log("| Corrida | Ritmo | Empresas | Correos | Pendientes | Total s | ms por empresa | Máx. envíos en 1 s | Separación mínima ms | Empresas que caben en 240 s |");
  console.log("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");

  for (const [nombre, lunes, ritmoMs] of [
    ["Con ritmo (producción)", "2026-11-09", RITMO_MS],
    ["Sin ritmo (para comparar)", "2026-11-16", 0],
  ] as const) {
    const envios: number[] = [];
    const enviador = async () => {
      envios.push(performance.now());
      await new Promise((listo) => setTimeout(listo, LATENCIA_PROVEEDOR_MS));
      return { id: randomUUID() };
    };
    const ahora = new Date(`${lunes}T14:00:00.000Z`);
    const inicio = performance.now();
    const resultado = await enviarCorreosSemanales({ ahora: () => ahora, enviador, urlPublica: "https://lever.test", ritmoMs, registrar: () => {} });
    const totalMs = performance.now() - inicio;
    let maximo = 0;
    for (let a = 0, b = 0; b < envios.length; b += 1) {
      while (envios[b]! - envios[a]! >= 1000) a += 1;
      maximo = Math.max(maximo, b - a + 1);
    }
    let separacion = Number.POSITIVE_INFINITY;
    for (let k = 1; k < envios.length; k += 1) separacion = Math.min(separacion, envios[k]! - envios[k - 1]!);
    const porEmpresa = totalMs / resultado.empresas;
    console.log(
      `| ${nombre} | ${ritmoMs} ms | ${resultado.empresas} | ${envios.length} | ${resultado.pendientes} | ${(totalMs / 1000).toFixed(1)} | ${porEmpresa.toFixed(0)} | ${maximo} | ${separacion.toFixed(1)} | ${Math.floor(PRESUPUESTO_MS / porEmpresa)} |`,
    );
  }
  const filas = consultarJson<{ semana: string; enviados: number; entregas: number }[]>(url, `
    select jsonb_agg(x order by x.semana) from (
      select to_char(s.semana, 'YYYY-MM-DD') as semana, count(*) filter (where s.estado = 'enviado') as enviados,
             (select count(*) from weekly_digest_deliveries d where d.semana = s.semana) as entregas
        from weekly_digest_sends s group by s.semana) x`);
  console.log("");
  console.log(`En la base, por semana (envíos cerrados como «enviado» y entregas por persona): ${JSON.stringify(filas)}`);
}

async function sesion(url: string, userId: string) {
  const token = `S${randomUUID().replace(/-/g, "")}AAAAAAAAAA`.slice(0, 43);
  const entradaId = randomUUID();
  const sesionId = randomUUID();
  ejecutar(url, `
    insert into auth_entradas (id, user_id, token_hash, creada_en, vence_en, verificada_con, verificada_en, consumida_en)
      values ('${entradaId}', '${userId}', '${createHash("sha256").update(entradaId).digest("hex")}', now(), now() + interval '10 minutes', 'totp', now(), now());
    insert into sessions (id, user_id, token_hash, expires_at, segundo_factor, entrada_id)
      values ('${sesionId}', '${userId}', '${createHash("sha256").update(token).digest("hex")}', now() + interval '12 hours', 'totp', '${entradaId}');
  `);
  const leida = await leerSesion(`sesion=${token}`);
  if (!leida?.segundoFactor) throw new Error("La sesión de medición no quedó abierta.");
  return leida;
}

principal().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "La medición falló.");
  process.exitCode = 1;
});
