import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { cerrarConexion } from "../../src/nucleo/db.ts";
import { registrarProspecto } from "../../src/server/operacion/clientes.ts";
import { calificarRiesgoEmpresa, dictaminarVersion, enviarVersion } from "../../src/server/operacion/expediente.ts";
import { aplicarArchivo, conBaseDesechable, exigirBaseDesechable, urlDeAplicacion } from "../aislamiento/postgres.ts";
import { almacenEnMemoria, armarBorrador, personal, SESION_SOFIPO } from "../operacion/apoyo-alta-regulada.ts";

const urlAdmin = process.env.AISLAMIENTO_DATABASE_URL?.trim() ?? "";
const MIGRACIONES = join(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");
const ORI = "e1000000-0000-4000-8000-000000000002";
const CUM = "e1000000-0000-4000-8000-000000000004";
const CLABE = "002180701150123452";
const OTRA_CLABE = "012180001234567897";

// Parámetros iniciales de la 0030: k 3, historial 10, N 3, ventana 7 días,
// umbral $100,000.00 (10,000,000 centavos), 25 % de personas y factor 0.80 con grado alto.
// La Ciudad de México está en UTC−06:00 todo el año (sin horario de verano desde 2022).
describe("reglas de PLD (0030): cada frontera y su costo", { skip: urlAdmin.length === 0 }, () => {
  it("en el umbral no alertan, un centavo arriba sí; el mes es el de la Ciudad de México; p95 ≤ 25 ms con 10,000 instrucciones", async (t) => {
    exigirBaseDesechable();
    await conBaseDesechable(urlAdmin, async (urlDuena) => {
      for (const archivo of readdirSync(MIGRACIONES).sort()) if (archivo.endsWith(".sql")) aplicarArchivo(urlDuena, join(MIGRACIONES, archivo));
      const dueno = new pg.Client({ connectionString: urlDuena });
      await dueno.connect();
      const operador = String((await dueno.query("select id from operators order by alta_en limit 1")).rows[0].id);
      for (const [id, nombre, rol] of [[ORI, "Óscar Originación", "originacion"], [CUM, "Carmen Cumplimiento", "cumplimiento"]] as const) {
        await dueno.query("insert into users (id, nombre, correo) values ($1, $2, $3)", [id, nombre, `${id}@ejemplo.mx`]);
        await dueno.query("insert into platform_staff (operator_id, user_id, estado) values ($1, $2, 'activo')", [operador, id]);
        await dueno.query("insert into platform_staff_roles (operator_id, user_id, rol) values ($1, $2, $3)", [operador, id, rol]);
      }
      process.env.DATABASE_URL = urlDeAplicacion(urlDuena);
      await cerrarConexion();
      const ori = personal(operador, ORI, ["originacion"]);
      const cum = personal(operador, CUM, ["cumplimiento"]);

      let siguiente = 0;
      const perfil = async (companyId: string, pagos: number, nomina: number) => {
        await dueno.query(
          `insert into pld_perfiles (id, operator_id, company_id, origen, pagos_monto_mensual_centavos, pagos_operaciones_mensuales,
             nomina_monto_mensual_centavos, nomina_operaciones_mensuales, registrado_por) values ($1, $2, $3, 'declaracion', $4, 10, $5, 2, $6)`,
          [randomUUID(), operador, companyId, pagos, nomina, ORI],
        );
      };
      /** Una empresa nueva (la dueña la da de alta) con su perfil si se pide: cada caso empieza sin historia. */
      const empresa = async (montos?: { pagos: number; nomina: number }) => {
        const id = randomUUID();
        const letra = (n: number) => String.fromCharCode(65 + (n % 26));
        const rfc = `R${letra(Math.floor(siguiente / 26))}${letra(siguiente)}150301AB1`;
        siguiente += 1;
        await dueno.query("begin");
        await dueno.query(
          `insert into companies (id, rfc, razon_social, codigo_postal, regimen, uso_cfdi, operator_id, estado, demostracion)
           values ($1, $2, $3, '06600', '601', 'G03', $4, 'activa', false)`,
          [id, rfc, `Empresa de prueba ${siguiente}`, operador],
        );
        await dueno.query(
          "insert into audit_log (operator_id, company_id, actor_tipo, superficie, accion, entidad, identificador) values ($1, $2, 'sistema', 'sistema', 'alta_empresa', 'companies', $2)",
          [operador, id],
        );
        if (montos) await perfil(id, montos.pagos, montos.nomina);
        await dueno.query("commit");
        return id;
      };
      /** Registra una operación como lo hacen los disparadores de pagos y nómina y devuelve las reglas que alertaron con ella. */
      const operacion = async (
        companyId: string, tipo: "pago_proveedor" | "nomina", centavos: number, en: string, extra: { clabe?: string; personas?: number } = {},
      ): Promise<string[]> => {
        const fila = (await dueno.query(
          `insert into pld_operaciones (operator_id, company_id, tipo, origen_tabla, origen_id, monto_centavos, clabe, personas, ocurrida_en)
           values ($1, $2, $3, $4, gen_random_uuid(), $5, $6, $7, $8::timestamptz) returning id`,
          [operador, companyId, tipo, tipo === "nomina" ? "payroll_batches" : "supplier_payment_requests", centavos,
            tipo === "pago_proveedor" ? extra.clabe ?? CLABE : null, tipo === "nomina" ? extra.personas ?? 1 : null, en],
        )).rows[0] as { id: string };
        return (await dueno.query("select regla from pld_alertas where operacion_id = $1 order by regla", [fila.id])).rows.map((r) => String(r.regla));
      };
      const pago = (companyId: string, centavos: number, en: string, clabe = CLABE) => operacion(companyId, "pago_proveedor", centavos, en, { clabe });
      const observado = async (companyId: string, regla: string) =>
        (await dueno.query("select observado from pld_alertas where company_id = $1 and regla = $2 order by creada_en desc limit 1", [companyId, regla])).rows[0]?.observado as Record<string, unknown>;

      try {
        await t.test("excede el perfil (27ª): la suma del mes en el perfil no alerta; un centavo arriba, sí, una vez por mes", async () => {
          const e = await empresa({ pagos: 1_000_000, nomina: 500_000 });
          assert.deepEqual(await pago(e, 600_000, "2026-10-10 12:00:00-06"), []);
          assert.deepEqual(await pago(e, 400_000, "2026-10-11 12:00:00-06"), []);
          assert.deepEqual(await pago(e, 1, "2026-10-12 12:00:00-06"), ["excede_perfil"]);
          assert.deepEqual(await observado(e, "excede_perfil"), {
            operacion: "pago_proveedor", monto_centavos: 1, grado: "sin_calificar", factor_grado: 1, parametros_numero: 0,
            mes: "2026-10", suma_mes_centavos: 1_000_001, declarado_centavos: 1_000_000, limite_centavos: 1_000_000, perfil_numero: 1,
            incluye_canceladas: true,
          });
          assert.deepEqual(await pago(e, 1, "2026-10-13 12:00:00-06"), []);
          // El mes siguiente vuelve a empezar.
          assert.deepEqual(await pago(e, 1_000_000, "2026-11-02 12:00:00-06"), []);
          assert.deepEqual(await pago(e, 1, "2026-11-03 12:00:00-06"), ["excede_perfil"]);
          // Sin perfil no hay contra qué comparar.
          const sinPerfil = await empresa();
          assert.deepEqual(await pago(sinPerfil, 9_000_000, "2026-10-10 12:00:00-06"), []);
        });

        await t.test("excede el perfil (r2-base-N7): si el límite baja a mitad de mes con la suma ya arriba, la siguiente alerta; una por mes", async () => {
          // Un perfil nuevo más bajo con la suma ya arriba.
          const z = await empresa({ pagos: 10_000_000, nomina: 500_000 });
          assert.deepEqual(await pago(z, 9_000_000, "2026-10-05 12:00:00-06"), []);
          await dueno.query(
            `insert into pld_perfiles (id, operator_id, company_id, origen, pagos_monto_mensual_centavos, pagos_operaciones_mensuales,
               nomina_monto_mensual_centavos, nomina_operaciones_mensuales, motivo, registrado_por) values ($1, $2, $3, 'declaracion', 5000000, 10, 500000, 2, $4, $5)`,
            [randomUUID(), operador, z, "El cliente estima menos pagos este semestre", ORI],
          );
          assert.deepEqual(await pago(z, 100_000, "2026-10-06 12:00:00-06"), ["excede_perfil"]);
          assert.equal(Number((await observado(z, "excede_perfil")).suma_mes_centavos), 9_100_000);
          assert.deepEqual(await pago(z, 100_000, "2026-10-07 12:00:00-06"), []);
          // El grado alto (× 0.80) con la suma ya arriba: 9,000,000 > 8,000,000. Calificar exige expediente dictaminado.
          const y = await registrarProspecto(ori, { rfc: "YOT150301AB1", razonSocial: "Yota Comercio SA de CV", codigoPostal: "06600", regimen: "601", usoCfdi: "G03" });
          const borrador = await armarBorrador(ori, { companyId: y, razonSocial: "Yota Comercio SA de CV", rfc: "YOT150301AB1", almacen: almacenEnMemoria() });
          await enviarVersion(ori, borrador.versionId);
          await dictaminarVersion(cum, SESION_SOFIPO, { versionId: borrador.versionId, formId: randomUUID(), resultado: "aprobado", motivo: "" });
          await perfil(y, 10_000_000, 500_000);
          assert.deepEqual(await pago(y, 9_000_000, "2026-10-05 12:00:00-06"), []);
          assert.equal((await calificarRiesgoEmpresa(cum, { companyId: y, formId: randomUUID(), actividad: "alta", zona: "alta" })).grado, "alto");
          assert.deepEqual(await pago(y, 100_000, "2026-10-06 12:00:00-06"), ["excede_perfil"]);
          assert.equal(Number((await observado(y, "excede_perfil")).limite_centavos), 8_000_000);
        });

        await t.test("carrera de reloj (r2-base-N8): la liberación que empezó antes y llega después al candado sí ve a la otra", async () => {
          // Tres instrucciones de $40,000.00 a la misma CLABE (umbral $100,000.00, N = 3). B empieza primero y A después;
          // A toma el candado de la empresa y confirma; B espera y se evalúa después. Con la hora de inicio de la
          // transacción (now()), B quedaba antes que A y ninguna veía a la otra: sin alerta.
          const company = await empresa();
          const CLABE_C = "012180001234567891";
          const esperar = (ms: number) => new Promise((listo) => setTimeout(listo, ms));
          const insertar = (c: pg.Client) => c.query(
            `insert into pld_operaciones (operator_id, company_id, tipo, origen_tabla, origen_id, monto_centavos, clabe)
             values ($1, $2, 'pago_proveedor', 'supplier_payment_requests', gen_random_uuid(), 4000000, $3)`,
            [operador, company, CLABE_C],
          );
          await insertar(dueno);
          const a = new pg.Client({ connectionString: urlDuena });
          const b = new pg.Client({ connectionString: urlDuena });
          await a.connect();
          await b.connect();
          try {
            await b.query("begin");
            await b.query("select now()");
            await esperar(30);
            await a.query("begin");
            await insertar(a);
            const pendiente = insertar(b);
            await esperar(200);
            await a.query("commit");
            await pendiente;
            await b.query("commit");
          } finally {
            await a.end();
            await b.end();
          }
          assert.deepEqual((await dueno.query("select regla from pld_alertas where company_id = $1", [company])).rows.map((r) => r.regla), ["fraccionamiento"]);
          assert.equal(Number((await observado(company, "fraccionamiento")).instrucciones), 3);
        });

        await t.test("el mes es el de la Ciudad de México: 23:59:59 del 31 de octubre contra las 00:00 del 1 de noviembre", async () => {
          const c = await empresa({ pagos: 1_000_000, nomina: 500_000 });
          assert.deepEqual(await pago(c, 1_000_000, "2026-10-31 23:59:59-06"), []);
          // En UTC las dos caen en noviembre (05:59:59Z y 06:00:00Z) y esta alertaría.
          assert.deepEqual(await pago(c, 1, "2026-11-01 00:00:00-06"), []);
          assert.deepEqual((await dueno.query("select mes::text from pld_operaciones where company_id = $1 order by ocurrida_en", [c])).rows.map((r) => r.mes), ["2026-10-01", "2026-11-01"]);
          assert.deepEqual(await pago(c, 1, "2026-10-31 23:00:00-06"), ["excede_perfil"]);
          assert.deepEqual(await dueno.query("select pld_fecha_mx('2026-11-01 05:59:59+00')::text as a, pld_fecha_mx('2026-11-01 06:00:00+00')::text as b").then((r) => r.rows[0]),
            { a: "2026-10-31", b: "2026-11-01" });
        });

        await t.test("monto atípico (41ª fr. III): k veces la mediana de 6 meses, sin contarse; con historial de 10 o más", async () => {
          // Historial par: cinco de 1,000.00 y cinco de 2,000.00. Mediana 1,500.00; k = 3 → límite 4,500.00.
          const historial = async (companyId: string, desde = "2026-05-04") => {
            for (let i = 0; i < 10; i++) {
              const dia = new Date(Date.parse(`${desde}T18:00:00Z`) + i * 14 * 86_400_000).toISOString().slice(0, 10);
              assert.deepEqual(await pago(companyId, i % 2 === 0 ? 100_000 : 200_000, `${dia} 12:00:00-06`, i % 2 === 0 ? CLABE : OTRA_CLABE), []);
            }
          };
          const enElUmbral = await empresa();
          await historial(enElUmbral);
          assert.deepEqual(await pago(enElUmbral, 450_000, "2026-10-01 12:00:00-06"), []);
          const arriba = await empresa();
          await historial(arriba);
          assert.deepEqual(await pago(arriba, 450_001, "2026-10-01 12:00:00-06"), ["monto_atipico"]);
          const visto = await observado(arriba, "monto_atipico");
          assert.equal(Number(visto.mediana_centavos), 150_000);
          assert.equal(Number(visto.limite_centavos), 450_000);
          assert.equal(visto.historial_operaciones, 10);
          // Con 9 operaciones previas no hay mediana que valga.
          const corto = await empresa();
          for (let i = 0; i < 9; i++) await pago(corto, 100_000, `2026-0${5 + Math.floor(i / 3)}-${String(5 + (i % 3) * 9).padStart(2, "0")} 12:00:00-06`, i % 2 ? CLABE : OTRA_CLABE);
          assert.deepEqual(await pago(corto, 5_000_000, "2026-10-01 12:00:00-06"), []);
          // Lo de hace más de 6 meses no cuenta.
          const viejo = await empresa();
          await historial(viejo, "2025-11-03");
          assert.deepEqual(await pago(viejo, 5_000_000, "2026-10-20 12:00:00-06"), []);
        });

        await t.test("fraccionamiento (41ª fr. VIII): N o más bajo el umbral a la misma CLABE en 7 días que juntas lo superan", async () => {
          // $30,000 + $30,000 + $40,000 = $100,000.00: igual al umbral, no alerta. Un centavo más, sí.
          const f = await empresa();
          assert.deepEqual(await pago(f, 3_000_000, "2026-10-05 10:00:00-06"), []);
          assert.deepEqual(await pago(f, 3_000_000, "2026-10-06 10:00:00-06"), []);
          assert.deepEqual(await pago(f, 4_000_000, "2026-10-07 10:00:00-06"), []);
          assert.deepEqual(await pago(f, 1, "2026-10-08 10:00:00-06"), ["fraccionamiento"]);
          assert.deepEqual(await observado(f, "fraccionamiento"), {
            operacion: "pago_proveedor", monto_centavos: 1, grado: "sin_calificar", factor_grado: 1, parametros_numero: 0,
            clabe: CLABE, instrucciones: 4, suma_centavos: 10_000_001, umbral_centavos: 10_000_000, n: 3, ventana_dias: 7,
          });
          // Ya era cierto: la siguiente no repite la alerta.
          assert.deepEqual(await pago(f, 1, "2026-10-08 11:00:00-06"), []);

          // Una instrucción en el umbral no es «por debajo»: no cuenta para N.
          const enUmbral = await empresa();
          assert.deepEqual(await pago(enUmbral, 10_000_000, "2026-10-05 10:00:00-06"), []);
          assert.deepEqual(await pago(enUmbral, 5_000_000, "2026-10-05 11:00:00-06"), []);
          assert.deepEqual(await pago(enUmbral, 5_000_001, "2026-10-05 12:00:00-06"), []);
          assert.deepEqual(await pago(enUmbral, 1, "2026-10-05 13:00:00-06"), ["fraccionamiento"]);

          // La ventana: lo de hace exactamente 7 días queda fuera; un segundo después, dentro.
          const fuera = await empresa();
          await pago(fuera, 5_000_000, "2026-10-01 10:00:00-06");
          await pago(fuera, 5_000_000, "2026-10-08 10:00:00-06");
          assert.deepEqual(await pago(fuera, 1, "2026-10-08 10:00:00-06"), []);
          const dentro = await empresa();
          await pago(dentro, 5_000_000, "2026-10-01 10:00:01-06");
          await pago(dentro, 5_000_000, "2026-10-08 10:00:00-06");
          assert.deepEqual(await pago(dentro, 1, "2026-10-08 10:00:00-06"), ["fraccionamiento"]);

          // A otra CLABE no se suma.
          const dos = await empresa();
          await pago(dos, 4_000_000, "2026-10-05 10:00:00-06", CLABE);
          await pago(dos, 4_000_000, "2026-10-05 11:00:00-06", OTRA_CLABE);
          await pago(dos, 4_000_000, "2026-10-05 12:00:00-06", CLABE);
          assert.deepEqual(await pago(dos, 4_000_000, "2026-10-05 13:00:00-06", OTRA_CLABE), []);
        });

        await t.test("nómina atípica (41ª fr. II y III): el lote contra el perfil y las personas contra el promedio + 25 %", async () => {
          const lote = (companyId: string, centavos: number, personas: number, en: string) => operacion(companyId, "nomina", centavos, en, { personas });
          // El lote en el perfil (5,000.00) no alerta; un centavo arriba, sí (y con él la suma del mes cruza el perfil).
          const n = await empresa({ pagos: 1_000_000, nomina: 500_000 });
          assert.deepEqual(await lote(n, 500_000, 4, "2026-09-01 12:00:00-06"), []);
          assert.deepEqual(await lote(n, 500_001, 4, "2026-10-01 12:00:00-06"), ["excede_perfil", "nomina_atipica"]);
          assert.equal((await observado(n, "nomina_atipica")).lote_sobre_perfil, true);
          // Personas: dos lotes de 4 → tope 4 × 1.25 = 5. Con 5 no alerta; con 6, sí.
          const personasEnTope = await empresa({ pagos: 1_000_000, nomina: 500_000 });
          await lote(personasEnTope, 100_000, 4, "2026-08-01 12:00:00-06");
          await lote(personasEnTope, 100_000, 4, "2026-09-01 12:00:00-06");
          assert.deepEqual(await lote(personasEnTope, 100_000, 5, "2026-10-01 12:00:00-06"), []);
          const personasArriba = await empresa({ pagos: 1_000_000, nomina: 500_000 });
          await lote(personasArriba, 100_000, 4, "2026-08-01 12:00:00-06");
          await lote(personasArriba, 100_000, 4, "2026-09-01 12:00:00-06");
          assert.deepEqual(await lote(personasArriba, 100_000, 6, "2026-10-01 12:00:00-06"), ["nomina_atipica"]);
          const visto = await observado(personasArriba, "nomina_atipica");
          assert.equal(visto.personas_sobre_promedio, true);
          assert.equal(visto.lote_sobre_perfil, false);
          assert.equal(Number(visto.tope_personas), 5);
          // El primer lote no tiene contra qué compararse en personas.
          const primero = await empresa({ pagos: 1_000_000, nomina: 500_000 });
          assert.deepEqual(await lote(primero, 100_000, 300, "2026-10-01 12:00:00-06"), []);
        });

        await t.test("grado alto (27ª): cada umbral se multiplica por 0.80", async () => {
          const companyId = await registrarProspecto(ori, { rfc: "ALT150301AB1", razonSocial: "Alto Riesgo SA de CV", codigoPostal: "06600", regimen: "601", usoCfdi: "G03" });
          const { versionId } = await armarBorrador(ori, { companyId, razonSocial: "Alto Riesgo SA de CV", rfc: "ALT150301AB1", almacen: almacenEnMemoria() });
          await enviarVersion(ori, versionId);
          await dictaminarVersion(cum, SESION_SOFIPO, { versionId, formId: randomUUID(), resultado: "aprobado", motivo: "" });
          assert.equal((await calificarRiesgoEmpresa(cum, { companyId, formId: randomUUID(), actividad: "alta", zona: "alta" })).grado, "alto");
          await perfil(companyId, 1_000_000, 500_000);
          // Perfil de 10,000.00 × 0.80 = 8,000.00.
          assert.deepEqual(await pago(companyId, 800_000, "2026-10-05 12:00:00-06"), []);
          assert.deepEqual(await pago(companyId, 1, "2026-10-05 13:00:00-06"), ["excede_perfil"]);
          const visto = await observado(companyId, "excede_perfil");
          assert.equal(visto.grado, "alto");
          assert.equal(Number(visto.factor_grado), 0.8);
          assert.equal(Number(visto.limite_centavos), 800_000);
          // Umbral de fraccionamiento: $100,000.00 × 0.80 = $80,000.00.
          assert.deepEqual(await pago(companyId, 3_000_000, "2026-09-07 10:00:00-06", OTRA_CLABE), ["excede_perfil"]);
          assert.deepEqual(await pago(companyId, 3_000_000, "2026-09-08 10:00:00-06", OTRA_CLABE), []);
          assert.deepEqual(await pago(companyId, 2_000_000, "2026-09-09 10:00:00-06", OTRA_CLABE), []);
          assert.deepEqual(await pago(companyId, 1, "2026-09-10 10:00:00-06", OTRA_CLABE), ["fraccionamiento"]);
          assert.equal(Number((await observado(companyId, "fraccionamiento")).umbral_centavos), 8_000_000);
        });

        await t.test("costo: con 10,000 instrucciones en el mes de una empresa, registrar una más tarda p95 ≤ 25 ms (EXPLAIN ANALYZE)", async () => {
          const p = await empresa({ pagos: 9_000_000_000, nomina: 9_000_000_000 });
          // El escenario del brief (r2-base-N11): 10,000 instrucciones en el mes (del 1 al 25 de noviembre) y 2,000 en
          // los 6 meses anteriores, a 50 CLABEs, sin el disparador de las reglas (la carga no es lo que se mide).
          await dueno.query("alter table pld_operaciones disable trigger pld_operaciones_evaluar");
          await dueno.query(
            `insert into pld_operaciones (operator_id, company_id, tipo, origen_tabla, origen_id, monto_centavos, clabe, ocurrida_en)
             select $1, $2, 'pago_proveedor', 'supplier_payment_requests', gen_random_uuid(), 10000 + (g * 7919) % 4990000,
                    '0021807011501' || lpad((g % 50)::text, 5, '0'),
                    case when g <= 10000 then timestamptz '2026-11-01 00:00:00-06' + (g * interval '216 seconds')
                         else timestamptz '2026-11-01 00:00:00-06' - ((g - 10000) * interval '7776 seconds') end
             from generate_series(1, 12000) as g`,
            [operador, p],
          );
          // La tabla es de todas las empresas: otras 20 con 2,500 operaciones cada una, para que los planes sean los de
          // una base con muchos clientes y no los de una tabla de una sola empresa.
          for (let n = 0; n < 20; n++) {
            const otra = await empresa();
            await dueno.query(
              `insert into pld_operaciones (operator_id, company_id, tipo, origen_tabla, origen_id, monto_centavos, clabe, ocurrida_en)
               select $1, $2, 'pago_proveedor', 'supplier_payment_requests', gen_random_uuid(), 10000 + (g * 104729) % 4990000,
                      '0021807011502' || lpad((g % 50)::text, 5, '0'), timestamptz '2026-11-26 00:00:00-06' - (g * interval '6221 seconds')
               from generate_series(1, 2500) as g`,
              [operador, otra],
            );
          }
          await dueno.query("alter table pld_operaciones enable trigger pld_operaciones_evaluar");
          await dueno.query("vacuum analyze pld_operaciones");
          assert.equal(Number((await dueno.query("select count(*)::int as n from pld_operaciones where company_id = $1 and mes = date '2026-11-01'", [p])).rows[0].n), 10_000);
          assert.equal(Number((await dueno.query("select count(*)::int as n from pld_operaciones where company_id = $1", [p])).rows[0].n), 12_000);

          const tiempos: number[] = [];
          for (let i = 0; i < 200; i++) {
            const plan = (await dueno.query(
              `explain (analyze, format json) insert into pld_operaciones (operator_id, company_id, tipo, origen_tabla, origen_id, monto_centavos, clabe, ocurrida_en)
               values ($1, $2, 'pago_proveedor', 'supplier_payment_requests', gen_random_uuid(), $3, $4, timestamptz '2026-11-26 00:00:00-06' + $5 * interval '1 minute')`,
              [operador, p, 50_000 + i * 997, `0021807011501${String(i % 50).padStart(5, "0")}`, i],
            )).rows[0]["QUERY PLAN"][0] as { "Execution Time": number; Triggers?: Array<{ "Trigger Name": string; Time: number }> };
            assert.ok(plan.Triggers?.some((d) => d["Trigger Name"] === "pld_operaciones_evaluar"));
            tiempos.push(plan["Execution Time"]);
          }
          tiempos.sort((a, b) => a - b);
          const percentil = (q: number) => tiempos[Math.min(tiempos.length - 1, Math.ceil(q * tiempos.length) - 1)]!;
          const resumen = { muestras: tiempos.length, p50: percentil(0.5), p95: percentil(0.95), p99: percentil(0.99), max: tiempos.at(-1) };

          // Los planes de las tres consultas de las reglas, con los datos cargados, para la evidencia.
          const explicar = async (sql: string, params: unknown[]) =>
            (await dueno.query(`explain (analyze, buffers, costs off, timing off, summary on) ${sql}`, params)).rows.map((r) => String(r["QUERY PLAN"])).join("\n");
          // Las mismas condiciones que pld_evaluar_operacion: sin la propia (id) y sin las reemplazadas.
          const momento = "2026-11-26 12:00:00-06";
          const propia = "00000000-0000-4000-8000-000000000000";
          const vigentes = "and not exists (select 1 from pld_operaciones r where r.reemplaza = o.id)";
          const planes = {
            excede_perfil: await explicar(
              `select coalesce(sum(o.monto_centavos), 0) from pld_operaciones o where o.company_id = $1 and o.tipo = 'pago_proveedor' and o.mes = date '2026-11-01' ${vigentes}`, [p]),
            monto_atipico: await explicar(
              `select avg(x.monto) from (select o.monto_centavos::numeric as monto from pld_operaciones o
                 where o.company_id = $1 and o.tipo = 'pago_proveedor' and o.id <> $3::uuid
                   and o.ocurrida_en > $2::timestamptz - interval '6 months' and o.ocurrida_en <= $2::timestamptz ${vigentes}
                 order by o.monto_centavos limit 2 offset 6099) as x`, [p, momento, propia]),
            fraccionamiento: await explicar(
              `select count(*), coalesce(sum(o.monto_centavos), 0) from pld_operaciones o
                 where o.company_id = $1 and o.tipo = 'pago_proveedor' and o.clabe = $2
                   and o.ocurrida_en > $3::timestamptz - interval '7 days' and o.ocurrida_en <= $3::timestamptz and o.monto_centavos < 10000000 ${vigentes}`,
              [p, "002180701150100007", momento]),
          };
          console.log(`EXPLAIN_PLD ${JSON.stringify({ resumen, planes })}`);
          assert.ok(resumen.p95 <= 25, `p95 = ${resumen.p95.toFixed(2)} ms`);
          assert.match(planes.fraccionamiento, /pld_operaciones_clabe_idx/);
          // r2-base-N11: la suma del mes y la mediana se leen solo del índice, sin ir a la tabla.
          assert.match(planes.excede_perfil, /Index Only Scan using pld_operaciones_mes_idx/);
          assert.match(planes.monto_atipico, /Index Only Scan using pld_operaciones_tiempo_idx/);
        });
      } finally {
        await cerrarConexion();
        await dueno.end();
      }
    });
  });
});
