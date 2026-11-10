import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { cerrarConexion } from "../../src/nucleo/db.ts";
import { emitirAviso, LEER_ALERTAS_SIN_CASO, listarAlertasPld } from "../../src/server/pld/index.ts";
import { registrarProspecto } from "../../src/server/operacion/clientes.ts";
import { calificarRiesgoEmpresa, dictaminarVersion, enviarVersion } from "../../src/server/operacion/expediente.ts";
import { aplicarArchivo, conBaseDesechable, exigirBaseDesechable, urlDeAplicacion } from "../aislamiento/postgres.ts";
import { almacenEnMemoria, armarBorrador, personal, SESION_SOFIPO } from "../operacion/apoyo-alta-regulada.ts";

const urlAdmin = process.env.AISLAMIENTO_DATABASE_URL?.trim() ?? "";
const MIGRACIONES = join(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");
const ORI = "e1000000-0000-4000-8000-000000000002";
const CUM = "e1000000-0000-4000-8000-000000000004";
const CUM2 = "e1000000-0000-4000-8000-000000000005";
const CLABE = "002180701150123452";
const OTRA_CLABE = "012180001234567897";

// Parámetros iniciales de la 0030: k 3, historial 10, N 3, ventana 7 días,
// umbral $100,000.00 (10,000,000 centavos), 25 % de personas y factor 0.80 con grado alto.
// La Ciudad de México está en UTC−06:00 todo el año (sin horario de verano desde 2022).
describe("reglas de PLD (0030): cada frontera y su costo", { skip: urlAdmin.length === 0 }, () => {
  it("en el umbral no alertan, un centavo arriba sí; el mes es el de la Ciudad de México; cada consulta con su índice y p50 ≤ 25 ms, p95 ≤ 40 ms con 10,000 instrucciones", async (t) => {
    exigirBaseDesechable();
    await conBaseDesechable(urlAdmin, async (urlDuena) => {
      for (const archivo of readdirSync(MIGRACIONES).sort()) if (archivo.endsWith(".sql")) aplicarArchivo(urlDuena, join(MIGRACIONES, archivo));
      const dueno = new pg.Client({ connectionString: urlDuena });
      await dueno.connect();
      const operador = String((await dueno.query("select id from operators order by alta_en limit 1")).rows[0].id);
      for (const [id, nombre, rol] of [
        [ORI, "Óscar Originación", "originacion"], [CUM, "Carmen Cumplimiento", "cumplimiento"], [CUM2, "Ciro Cumplimiento", "cumplimiento"],
      ] as const) {
        await dueno.query("insert into users (id, nombre, correo) values ($1, $2, $3)", [id, nombre, `${id}@ejemplo.mx`]);
        await dueno.query("insert into platform_staff (operator_id, user_id, estado) values ($1, $2, 'activo')", [operador, id]);
        await dueno.query("insert into platform_staff_roles (operator_id, user_id, rol) values ($1, $2, $3)", [operador, id, rol]);
      }
      process.env.DATABASE_URL = urlDeAplicacion(urlDuena);
      await cerrarConexion();
      const ori = personal(operador, ORI, ["originacion"]);
      const cum = personal(operador, CUM, ["cumplimiento"]);
      const cum2 = personal(operador, CUM2, ["cumplimiento"]);
      const urlApp = process.env.DATABASE_URL;

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

        await t.test("costo: cada consulta de las reglas usa su índice (plan genérico, sin Seq Scan en tablas que crecen) y registrar una más tarda p50 ≤ 25 ms y p95 ≤ 40 ms con 10,000 instrucciones", async () => {
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

          // 1) Guarda determinista: el plan de cada consulta de pld_evaluar_operacion (las mismas, con sus parámetros), en
          // plan genérico como las ejecuta PL/pgSQL. Atrapa un índice que falta o una consulta mal escrita sin depender de
          // la velocidad de la máquina.
          const CRECEN = new Set(["pld_operaciones", "pld_alertas", "pld_perfiles", "kyb_calificaciones_riesgo", "audit_log"]);
          const vigente = "AND NOT EXISTS (SELECT 1 FROM pld_operaciones r WHERE r.reemplaza = o.id)";
          const consultasDeLasReglas: Array<{ nombre: string; sql: string; tipos: string; indices: string[] }> = [
            { nombre: "perfil vigente", tipos: "uuid", indices: ["pld_perfiles_vigente_idx"],
              sql: "SELECT * FROM pld_perfiles x WHERE x.company_id = $1 ORDER BY x.numero DESC LIMIT 1" },
            { nombre: "excede_perfil: suma del mes", tipos: "uuid, text, date", indices: ["pld_operaciones_mes_idx", "pld_operaciones_reemplazada"],
              sql: `SELECT coalesce(sum(o.monto_centavos), 0) FROM pld_operaciones o WHERE o.company_id = $1 AND o.tipo = $2 AND o.mes = $3 ${vigente}` },
            { nombre: "excede_perfil: alerta del mes", tipos: "uuid, text, date", indices: ["pld_alertas_excede_mes"],
              sql: `SELECT 1 FROM pld_alertas a WHERE a.company_id = $1 AND a.regla = 'excede_perfil' AND a.observado ->> 'operacion' = $2 AND a.observado ->> 'mes' = to_char($3, 'YYYY-MM')` },
            { nombre: "monto_atipico: historial", tipos: "uuid, text, uuid, timestamptz", indices: ["pld_operaciones_tiempo_idx", "pld_operaciones_reemplazada"],
              sql: `SELECT count(*) FROM pld_operaciones o WHERE o.company_id = $1 AND o.tipo = $2 AND o.id <> $3 AND o.ocurrida_en > $4 - interval '6 months' AND o.ocurrida_en <= $4 ${vigente}` },
            { nombre: "monto_atipico: mediana", tipos: "uuid, text, uuid, timestamptz, bigint", indices: ["pld_operaciones_tiempo_idx", "pld_operaciones_reemplazada"],
              sql: `SELECT avg(x.monto) FROM (SELECT o.monto_centavos::numeric AS monto FROM pld_operaciones o WHERE o.company_id = $1 AND o.tipo = $2 AND o.id <> $3
                      AND o.ocurrida_en > $4 - interval '6 months' AND o.ocurrida_en <= $4 ${vigente} ORDER BY o.monto_centavos LIMIT 2 - $5 % 2 OFFSET ($5 - 1) / 2) AS x` },
            { nombre: "fraccionamiento", tipos: "uuid, text, timestamptz, integer, bigint", indices: ["pld_operaciones_clabe_idx", "pld_operaciones_reemplazada"],
              sql: `SELECT count(*), coalesce(sum(o.monto_centavos), 0) FROM pld_operaciones o WHERE o.company_id = $1 AND o.tipo = 'pago_proveedor' AND o.clabe = $2
                      AND o.ocurrida_en > $3 - make_interval(days => $4) AND o.ocurrida_en <= $3 AND o.monto_centavos < $5 ${vigente}` },
            { nombre: "nomina_atipica", tipos: "uuid, uuid, timestamptz", indices: ["pld_operaciones_tiempo_idx"],
              sql: `SELECT count(*), avg(o.personas) FROM pld_operaciones o WHERE o.company_id = $1 AND o.tipo = 'nomina' AND o.id <> $2
                      AND o.ocurrida_en > $3 - interval '6 months' AND o.ocurrida_en <= $3` },
            { nombre: "grado de riesgo", tipos: "uuid", indices: [],
              sql: "SELECT r.grado FROM kyb_calificaciones_riesgo r WHERE r.company_id = $1 ORDER BY r.calificada_en DESC, r.id DESC LIMIT 1" },
          ];
          // Las consultas son las de la función que corre de verdad: si alguien la cambia, esta lista se revisa con ella.
          const cuerpo = String((await dueno.query("select prosrc from pg_proc where proname = 'pld_evaluar_operacion'")).rows[0].prosrc).replace(/\s+/g, " ");
          for (const trozo of ["WHERE o.company_id = NEW.company_id AND o.tipo = NEW.tipo AND o.mes = NEW.mes", "a.regla = 'excede_perfil'",
            "AND o.clabe = NEW.clabe", "o.tipo = 'nomina' AND o.id <> NEW.id", "FROM pld_perfiles x WHERE x.company_id = NEW.company_id ORDER BY x.numero DESC LIMIT 1",
            "ORDER BY r.calificada_en DESC, r.id DESC LIMIT 1", "LIMIT 2 - historial % 2 OFFSET (historial - 1) / 2"]) {
            assert.ok(cuerpo.includes(trozo), `pld_evaluar_operacion ya no tiene «${trozo}»: revisa consultasDeLasReglas`);
          }
          type Nodo = { "Node Type": string; "Relation Name"?: string; "Index Name"?: string; Plans?: Nodo[] };
          const nodos = (n: Nodo): Nodo[] => [n, ...(n.Plans ?? []).flatMap(nodos)];
          const guarda: Record<string, { indices: string[]; secuenciales: string[] }> = {};
          await dueno.query("set plan_cache_mode = force_generic_plan");
          try {
            for (const [i, consulta] of consultasDeLasReglas.entries()) {
              await dueno.query(`prepare regla_${i} (${consulta.tipos}) as ${consulta.sql}`);
              const parametros = consulta.tipos.split(",").map(() => "null").join(", ");
              const plan = (await dueno.query(`explain (format json, costs off) execute regla_${i} (${parametros})`)).rows[0]["QUERY PLAN"][0].Plan as Nodo;
              await dueno.query(`deallocate regla_${i}`);
              const todos = nodos(plan);
              const secuenciales = todos.filter((n) => n["Node Type"] === "Seq Scan" && CRECEN.has(n["Relation Name"] ?? "")).map((n) => n["Relation Name"]!);
              const indices = [...new Set(todos.map((n) => n["Index Name"]).filter((x): x is string => Boolean(x)))];
              guarda[consulta.nombre] = { indices, secuenciales };
            }
          } finally {
            await dueno.query("reset plan_cache_mode");
          }
          console.log(`GUARDA_PLD ${JSON.stringify(guarda)}`);
          for (const consulta of consultasDeLasReglas) {
            const { indices, secuenciales } = guarda[consulta.nombre]!;
            assert.deepEqual(secuenciales, [], `${consulta.nombre}: Seq Scan sobre ${secuenciales.join(", ")}`);
            for (const indice of consulta.indices) assert.ok(indices.includes(indice), `${consulta.nombre}: no usa ${indice} (usa ${indices.join(", ") || "ninguno"})`);
          }

          // 2) Tiempo de registrar una más, con el disparador de las reglas: calentamiento y 300 muestras. Los topes son
          // los del CI, cuya máquina es unas 3 veces más lenta que la local (p50 de 20.4 a 21.3 ms contra 6.3; p95 de 21.0
          // a 30.7 en cuatro corridas). El presupuesto de producto (p95 ≤ 25 ms) se mide en local: ver el README.
          const registrar = async (i: number) => (await dueno.query(
            `explain (analyze, format json) insert into pld_operaciones (operator_id, company_id, tipo, origen_tabla, origen_id, monto_centavos, clabe, ocurrida_en)
             values ($1, $2, 'pago_proveedor', 'supplier_payment_requests', gen_random_uuid(), $3, $4, timestamptz '2026-11-26 00:00:00-06' + $5 * interval '1 minute')`,
            [operador, p, 50_000 + i * 997, `0021807011501${String(i % 50).padStart(5, "0")}`, i],
          )).rows[0]["QUERY PLAN"][0] as { "Execution Time": number; Triggers?: Array<{ "Trigger Name": string; Time: number }> };
          for (let i = 0; i < 20; i++) await registrar(1000 + i);
          const tiempos: number[] = [];
          for (let i = 0; i < 300; i++) {
            const plan = await registrar(i);
            assert.ok(plan.Triggers?.some((d) => d["Trigger Name"] === "pld_operaciones_evaluar"));
            tiempos.push(plan["Execution Time"]);
          }
          tiempos.sort((a, b) => a - b);
          const percentil = (q: number) => tiempos[Math.min(tiempos.length - 1, Math.ceil(q * tiempos.length) - 1)]!;
          const resumen = { muestras: tiempos.length, p50: percentil(0.5), p95: percentil(0.95), p99: percentil(0.99), max: tiempos.at(-1) };

          // Los planes de las tres consultas principales con los datos cargados, para la evidencia.
          const explicar = async (sql: string, params: unknown[]) =>
            (await dueno.query(`explain (analyze, buffers, costs off, timing off, summary on) ${sql}`, params)).rows.map((r) => String(r["QUERY PLAN"])).join("\n");
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
          t.diagnostic(`registrar una más: p50 ${resumen.p50.toFixed(2)} ms, p95 ${resumen.p95.toFixed(2)} ms, p99 ${resumen.p99.toFixed(2)} ms (${resumen.muestras} muestras)`);
          assert.ok(resumen.p50 <= 25, `p50 = ${resumen.p50.toFixed(2)} ms`);
          assert.ok(resumen.p95 <= 40, `p95 = ${resumen.p95.toFixed(2)} ms`);
          // r2-base-N11: la suma del mes y la mediana se leen solo del índice, sin ir a la tabla.
          assert.match(planes.fraccionamiento, /pld_operaciones_clabe_idx/);
          assert.match(planes.excede_perfil, /Index Only Scan using pld_operaciones_mes_idx/);
          assert.match(planes.monto_atipico, /Index Only Scan using pld_operaciones_tiempo_idx/);
        });

        await t.test("bandeja con 20,000 alertas (r2-base-N10): elige las 500 primero con su índice y después une (plan); p50 ≤ 120 ms y p95 ≤ 200 ms", async () => {
          // El escenario de la revisión: unas 500 empresas (con la unión primero, Postgres recorría companies por cada alerta).
          for (let n = 0; n < 480; n++) await empresa();
          // 20,000 alertas sin caso sobre las operaciones ya cargadas (unas 62,000 de 21 empresas), en los últimos 59 días.
          await dueno.query(
            `insert into pld_alertas (operator_id, company_id, regla, disposicion, operacion_id, observado, creada_en)
             select o.operator_id, o.company_id, 'monto_atipico', '41ª fr. III', o.id, '{}'::jsonb,
                    now() - ((o.n % 59) * interval '1 day') - (o.n * interval '1 second')
             from (select x.*, row_number() over (order by x.id) as n from pld_operaciones x
                   where not exists (select 1 from pld_alertas a where a.operacion_id = x.id and a.regla = 'monto_atipico')) as o
             where o.n <= 20000`,
          );
          // Una persona de Cumplimiento con una exclusión: un aviso que la menciona.
          const empresaDelAviso = String((await dueno.query("select company_id from pld_alertas where company_id is not null limit 1")).rows[0].company_id);
          await emitirAviso(ori, { formId: randomUUID(), tipo: "posible_interna_preocupante", companyId: empresaDelAviso, mencionada: CUM2, superior: "", descripcion: "La analista pidió no revisar este cliente." });
          await dueno.query("vacuum analyze pld_alertas, companies");
          assert.ok(Number((await dueno.query("select count(*)::int as n from pld_alertas")).rows[0].n) >= 20_000);
          assert.ok(Number((await dueno.query("select count(*)::int as n from companies")).rows[0].n) >= 500);

          // Tiempo de la bandeja completa (servicio, RLS y conexión): calentamiento y 200 muestras. Los topes son los del
          // CI, con margen: ahí da p95 de 74 a 76 ms con 19,000 alertas en casos, y en local con la Mac cargada llegó a
          // 110. El presupuesto de producto (p95 ≤ 100 ms) se mide en local sin carga: ver el README.
          const medir = async (ctx: typeof cum) => {
            for (let i = 0; i < 10; i++) await listarAlertasPld(ctx, { soloSinCaso: true });
            const tiempos: number[] = [];
            for (let i = 0; i < 200; i++) {
              const inicio = performance.now();
              const lista = await listarAlertasPld(ctx, { soloSinCaso: true });
              tiempos.push(performance.now() - inicio);
              assert.equal(lista.length, 500);
            }
            tiempos.sort((a, b) => a - b);
            const percentil = (q: number) => tiempos[Math.min(tiempos.length - 1, Math.ceil(q * tiempos.length) - 1)]!;
            return { muestras: tiempos.length, p50: percentil(0.5), p95: percentil(0.95), p99: percentil(0.99) };
          };
          // Guarda determinista del plan, como lo ve la aplicación (rol y RLS): las 500 se eligen con el índice del
          // operador y la unión con companies y pld_operaciones va después del Limit, sin Seq Scan en lo que crece.
          type Nodo = { "Node Type": string; "Relation Name"?: string; "Index Name"?: string; Plans?: Nodo[] };
          const nodos = (n: Nodo): Nodo[] => [n, ...(n.Plans ?? []).flatMap(nodos)];
          const revisarPlan = (plan: Nodo, conCasosCargados: boolean, etiqueta: string) => {
            const todos = nodos(plan);
            const crecen = new Set(["pld_alertas", "companies", "pld_operaciones", "pld_casos", ...(conCasosCargados ? ["pld_caso_alertas"] : [])]);
            const secuenciales = todos.filter((n) => n["Node Type"] === "Seq Scan" && crecen.has(n["Relation Name"] ?? "")).map((n) => n["Relation Name"]);
            assert.deepEqual(secuenciales, [], `${etiqueta}: Seq Scan sobre ${secuenciales.join(", ")}`);
            const limite = todos.find((n) => n["Node Type"] === "Limit");
            assert.ok(limite, `${etiqueta}: sin Limit`);
            const dentro = nodos(limite);
            assert.ok(dentro.some((n) => n["Index Name"] === "pld_alertas_operador_idx"), `${etiqueta}: las 500 no se eligen con pld_alertas_operador_idx`);
            for (const tabla of ["companies", "pld_operaciones"]) {
              assert.ok(!dentro.some((n) => n["Relation Name"] === tabla), `${etiqueta}: une ${tabla} antes de elegir las 500`);
              assert.ok(todos.some((n) => n["Relation Name"] === tabla && n["Index Name"]), `${etiqueta}: ${tabla} sin índice`);
            }
            if (conCasosCargados) assert.ok(dentro.some((n) => n["Index Name"] === "pld_caso_alertas_una_vez"), `${etiqueta}: el anti-join sin pld_caso_alertas_una_vez`);
          };
          const explicar = async (userId: string) => {
            const c = new pg.Client({ connectionString: urlApp });
            await c.connect();
            try {
              await c.query("begin");
              await c.query("set local role plataforma_sofipo");
              await c.query("select set_config('app.user_id', $1, true), set_config('app.operator_id', $2, true)", [userId, operador]);
              const plan = (await c.query(`explain (analyze, format json) ${LEER_ALERTAS_SIN_CASO}`)).rows[0]["QUERY PLAN"][0] as { "Execution Time": number; Plan: Nodo };
              const texto = (await c.query(`explain (analyze, costs off, timing off, summary on) ${LEER_ALERTAS_SIN_CASO}`)).rows.map((r) => String(r["QUERY PLAN"])).join("\n");
              await c.query("rollback");
              return { ms: plan["Execution Time"], texto, plan: plan.Plan };
            } finally {
              await c.end();
            }
          };
          const sinExclusiones = { ...(await medir(cum)), explain: await explicar(CUM) };
          const conExclusion = { ...(await medir(cum2)), explain: await explicar(CUM2) };
          const sinPlan = <T extends { explain: { plan: Nodo } }>(x: T) => ({ ...x, explain: { ...x.explain, plan: undefined } });
          console.log(`BANDEJA_PLD ${JSON.stringify({ sinExclusiones: sinPlan(sinExclusiones), conExclusion: sinPlan(conExclusion) })}`);
          // Con la unión primero tardaba 40-47 ms en esta base (2.4 s en la de la revisión); eligiendo primero, 2-3 ms. Lo
          // que lo asegura es la forma del plan, no el reloj.
          revisarPlan(sinExclusiones.explain.plan, false, "sin exclusiones");
          revisarPlan(conExclusion.explain.plan, false, "con exclusión");
          for (const [etiqueta, r] of [["sin exclusiones", sinExclusiones], ["con exclusión", conExclusion]] as const) {
            t.diagnostic(`bandeja ${etiqueta}: p50 ${r.p50.toFixed(1)} ms, p95 ${r.p95.toFixed(1)} ms, p99 ${r.p99.toFixed(1)} ms (${r.muestras} muestras)`);
            assert.ok(r.p50 <= 120 && r.p95 <= 200, `bandeja ${etiqueta}: p50 ${r.p50.toFixed(1)} ms, p95 ${r.p95.toFixed(1)} ms`);
          }

          // Lo que pasa con los años (61ª: nada se borra): casi todas las alertas viejas ya están analizadas en un caso.
          // Las 19,000 más antiguas van a un caso por empresa; la bandeja sigue leyendo las 500 sin caso más antiguas.
          await dueno.query("begin");
          await dueno.query(
            `create temporary table analizadas on commit drop as
             select x.id, x.company_id from pld_alertas x
             where x.aviso_id is null and not exists (select 1 from pld_caso_alertas y where y.alerta_id = x.id)
             order by x.creada_en, x.id limit 19000`,
          );
          await dueno.query(
            `insert into pld_casos (id, operator_id, company_id, registrado_por)
             select gen_random_uuid(), $1, e.company_id, $2 from (select distinct company_id from analizadas) e`,
            [operador, CUM],
          );
          await dueno.query(
            `insert into pld_caso_alertas (caso_id, alerta_id, operator_id, registrado_por)
             select k.id, a.id, $1, $2 from analizadas a
             join pld_casos k on k.company_id = a.company_id and k.registrado_en = now()`,
            [operador, CUM],
          );
          await dueno.query("commit");
          await dueno.query("vacuum analyze pld_alertas, pld_caso_alertas, pld_casos");
          const conCasos = { cum: { ...(await medir(cum)), explain: await explicar(CUM) }, cum2: { ...(await medir(cum2)), explain: await explicar(CUM2) } };
          console.log(`BANDEJA_PLD_CON_CASOS ${JSON.stringify({ cum: sinPlan(conCasos.cum), cum2: sinPlan(conCasos.cum2) })}`);
          revisarPlan(conCasos.cum.explain.plan, true, "con 19,000 en casos");
          revisarPlan(conCasos.cum2.explain.plan, true, "con 19,000 en casos y una exclusión");
          for (const [etiqueta, r] of [["con 19,000 en casos", conCasos.cum], ["con 19,000 en casos y una exclusión", conCasos.cum2]] as const) {
            t.diagnostic(`bandeja ${etiqueta}: p50 ${r.p50.toFixed(1)} ms, p95 ${r.p95.toFixed(1)} ms, p99 ${r.p99.toFixed(1)} ms (${r.muestras} muestras)`);
            assert.ok(r.p50 <= 120 && r.p95 <= 200, `bandeja ${etiqueta}: p50 ${r.p50.toFixed(1)} ms, p95 ${r.p95.toFixed(1)} ms`);
          }
        });
      } finally {
        await cerrarConexion();
        await dueno.end();
      }
    });
  });
});
