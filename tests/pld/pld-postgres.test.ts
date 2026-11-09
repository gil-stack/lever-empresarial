import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { INVISIBLE } from "../../src/dominio/control.ts";
import { hoyEnMexico } from "../../src/dominio/operacion/comisiones.ts";
import { sumarMeses } from "../../src/dominio/operacion/riesgo.ts";
import { COLUMNAS } from "../../src/dominio/pld/layout41.ts";
import { capacidadesDe, type RolCliente } from "../../src/nucleo/capacidades.ts";
import type { ContextoDePersonal, ContextoDeTenant } from "../../src/nucleo/contexto.ts";
import { cerrarConexion } from "../../src/nucleo/db.ts";
import { decidirActivacion, solicitarActivacion } from "../../src/server/operacion/activaciones.ts";
import { leerCliente, registrarProspecto } from "../../src/server/operacion/clientes.ts";
import { calificarRiesgoEmpresa, dictaminarVersion, enviarVersion } from "../../src/server/operacion/expediente.ts";
import { cambiarRolPersonal } from "../../src/server/operacion/personal.ts";
import { decidirCambioDeSuspension, solicitarCambioDeSuspension } from "../../src/server/operacion/suspensiones.ts";
import { cancelarPagoProveedor, crearPagoProveedor, editarYReenviarPago, resolverPagoProveedor } from "../../src/server/pagos-proveedores/servicio.ts";
import { cambiarClabeProveedor } from "../../src/server/proveedores/servicio-clabes.ts";
import {
  abrirCaso,
  actaEnPdf,
  agregarNota,
  archivoRelevantes,
  cambiarModoDictamen,
  cambiarParametros,
  cargarActaFirmada,
  cargarDocumentoPld,
  contenidoParaSiti,
  constanciaInternacionales,
  declararPerfil,
  descargarActa,
  descargarDocumentoPld,
  dictaminarCaso,
  emitirAviso,
  type EntradaIntegrante,
  ErrorDeIntegrante,
  leerCaso,
  leerBandejaPld,
  leerComite,
  leerEvaluacionesPendientes,
  leerParametros,
  leerPerfiles,
  leerPeriodicos,
  leerPropuestasDePerfil,
  listarAlertasPld,
  manifiestoDeConservacion,
  marcarVeinticuatroHoras,
  misAcuses,
  registrarAuditor,
  registrarComunicacion,
  registrarEntidad,
  registrarEvaluacion,
  registrarIntegrantes,
  registrarPeriodico,
  registrarPropuesta,
  registrarReportePld,
  registrarSesion,
  propuestasPorVotar,
  registrarVoto,
  resolverPropuestaDePerfil,
  sumarAlertaAlCaso,
  TIPOS_DE_OPERACION,
  TIPOS_EN_EFECTIVO,
  TIPOS_INTERNACIONALES,
} from "../../src/server/pld/index.ts";
import { aplicarArchivo, conBaseDesechable, exigirBaseDesechable, urlDeAplicacion } from "../aislamiento/postgres.ts";
import { almacenEnMemoria, armarBorrador, PDF, personal, SESION_SOFIPO } from "../operacion/apoyo-alta-regulada.ts";

const urlAdmin = process.env.AISLAMIENTO_DATABASE_URL?.trim() ?? "";
const MIGRACIONES = join(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");

// Personal SOFIPO del operador. CUM2 también es de Cumplimiento: es la persona que un aviso excluye (60ª).
const ADM = "e0000000-0000-4000-8000-000000000001";
const ORI = "e0000000-0000-4000-8000-000000000002";
const APR = "e0000000-0000-4000-8000-000000000003";
const CUM = "e0000000-0000-4000-8000-000000000004";
const CUM2 = "e0000000-0000-4000-8000-000000000005";
const AUD = "e0000000-0000-4000-8000-000000000006";
// Tercera persona de Cumplimiento: llega en las pruebas de r2-fix-N2.
const CUM3 = "e0000000-0000-4000-8000-000000000007";
// Cumplimiento de otro operador: no ve nada del primero.
const AJENA = "e0000000-0000-4000-8000-000000000009";
// Personas del portal de Beta.
const LUIS = "f0000000-0000-4000-8000-000000000001";
const ROSA = "f0000000-0000-4000-8000-000000000002";
const PROVEEDOR = "f1000000-0000-4000-8000-000000000001";
const COPIA_69B = "f2000000-0000-4000-8000-000000000001";
const CLABE = "002180701150123452";

describe("PLD (0030) en Postgres desechable", { skip: urlAdmin.length === 0 }, () => {
  it("candado, perfil, reglas en vivo, avisos confidenciales, Comité, dictamen, reportes, conservación y RLS", async (t) => {
    exigirBaseDesechable();
    await conBaseDesechable(urlAdmin, async (urlDuena) => {
      for (const archivo of readdirSync(MIGRACIONES).sort()) if (archivo.endsWith(".sql")) aplicarArchivo(urlDuena, join(MIGRACIONES, archivo));
      const dueno = new pg.Client({ connectionString: urlDuena });
      await dueno.connect();
      const operador = String((await dueno.query("select id from operators order by alta_en limit 1")).rows[0].id);
      const otroOperador = randomUUID();
      await dueno.query("insert into operators (id, nombre) values ($1, 'Otro operador')", [otroOperador]);
      const personas: Array<[string, string, string | null, string[]]> = [
        [ADM, "Adriana Admin", operador, ["administracion_plataforma"]],
        [ORI, "Óscar Originación", operador, ["originacion"]],
        [APR, "Paula Aprobación", operador, ["aprobacion"]],
        [CUM, "Carmen Cumplimiento", operador, ["cumplimiento"]],
        [CUM2, "Ciro Cumplimiento", operador, ["cumplimiento"]],
        [AUD, "Aurelio Auditoría", operador, ["auditoria"]],
        [AJENA, "Alma Ajena", otroOperador, ["cumplimiento"]],
        [LUIS, "Luis Portal", null, []],
        [ROSA, "Rosa Portal", null, []],
      ];
      for (const [id, nombre, op, roles] of personas) {
        await dueno.query("insert into users (id, nombre, correo) values ($1, $2, $3)", [id, nombre, `${id}@ejemplo.mx`]);
        if (!op) continue;
        await dueno.query("insert into platform_staff (operator_id, user_id, estado) values ($1, $2, 'activo')", [op, id]);
        for (const rol of roles) await dueno.query("insert into platform_staff_roles (operator_id, user_id, rol) values ($1, $2, $3)", [op, id, rol]);
      }

      process.env.DATABASE_URL = urlDeAplicacion(urlDuena);
      const urlApp = process.env.DATABASE_URL;
      await cerrarConexion();
      const adm = personal(operador, ADM, ["administracion_plataforma"]);
      const ori = personal(operador, ORI, ["originacion"]);
      const apr = personal(operador, APR, ["aprobacion"]);
      const cum = personal(operador, CUM, ["cumplimiento"]);
      const cum2 = personal(operador, CUM2, ["cumplimiento"]);
      const aud = personal(operador, AUD, ["auditoria"]);
      const ajena = personal(otroOperador, AJENA, ["cumplimiento"]);
      const almacen = almacenEnMemoria();
      const leerDelAlmacen = async (clave: string) => new Response(almacen.guardados.get(clave)).body!;
      const hoy = hoyEnMexico(new Date());
      const sofipo = <T>(userId: string, fn: (c: pg.Client) => Promise<T>, op = operador) =>
        como(urlApp, "plataforma_sofipo", { userId, operadorId: op }, fn);
      const uno = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await dueno.query(sql, params)).rows[0] as T;
      const contar = async (sql: string, params: unknown[] = []) => Number((await uno<{ n: number }>(sql, params)).n);
      const eventoPersonal = (c: pg.Client, userId: string, accion: string, entidad: string, identificador: string, companyId: string | null = null) =>
        c.query(
          `insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, origen)
           values ($1, $2, 'personal', $3, 'sofipo', $4, $5, $6, 'operacion')`,
          [operador, companyId, userId, accion, entidad, identificador],
        );
      const prospecto = (rfc: string, razonSocial: string) =>
        registrarProspecto(ori, { rfc, razonSocial, codigoPostal: "06600", regimen: "601", usoCfdi: "G03" });

      let alfa = "";
      let beta = "";
      try {
        await t.test("candado: sin perfil transaccional no se activa; con perfil, sí; la reactivación no cambia", async () => {
          // La función de la 0030 es la de la 0028 más un bloque al final de en_alta → activa.
          const cuerpo = (archivo: string) => {
            const texto = readFileSync(join(MIGRACIONES, archivo), "utf8");
            const inicio = texto.search(/CREATE (OR REPLACE )?FUNCTION companies_candado_regulado\(\)/);
            const fin = texto.indexOf("$$;", texto.indexOf("AS $$", inicio)) + 3;
            return texto.slice(inicio, fin).replace("CREATE OR REPLACE FUNCTION", "CREATE FUNCTION");
          };
          const bloque0030 = [
            "    -- 0030 (25ª): perfil transaccional declarado.",
            "    IF NOT EXISTS (SELECT 1 FROM pld_perfiles p WHERE p.company_id = NEW.id) THEN",
            "      RAISE EXCEPTION 'activacion_sin_perfil_transaccional';",
            "    END IF;",
            "",
          ].join("\n");
          const de0030 = cuerpo("0030_pld_alertas_reportes.sql");
          assert.ok(de0030.includes(bloque0030));
          assert.equal(de0030.replace(bloque0030, ""), cuerpo("0028_alta_regulada.sql"));

          alfa = await prospecto("ALF150301AB1", "Alfa Comercial SA de CV");
          const { versionId } = await armarBorrador(ori, { companyId: alfa, razonSocial: "Alfa Comercial SA de CV", rfc: "ALF150301AB1", almacen });
          await enviarVersion(ori, versionId);
          await dictaminarVersion(cum, SESION_SOFIPO, { versionId, formId: randomUUID(), resultado: "aprobado", motivo: "" });
          await calificarRiesgoEmpresa(cum, { companyId: alfa, formId: randomUUID(), actividad: "baja", zona: "baja" });
          const solicitud = await solicitarActivacion(ori, alfa);
          await assert.rejects(decidirActivacion(apr, SESION_SOFIPO, { id: solicitud, aprobada: true }), /activacion_sin_perfil_transaccional/);
          await assert.rejects(dueno.query("update companies set estado = 'activa' where id = $1", [alfa]), /activacion_sin_perfil_transaccional/);
          assert.equal((await leerCliente(ori, alfa))?.estado, "en_alta");

          // Lo declara Originación (25ª); Aprobación y Cumplimiento no lo capturan.
          const montos = { pagosMonto: "500,000.00", pagosOperaciones: "40", nominaMonto: "300,000.00", nominaOperaciones: "2" };
          await assert.rejects(declararPerfil(apr, { companyId: alfa, formId: randomUUID(), ...montos, motivo: "" }), /sin_permiso_operacion/);
          await assert.rejects(declararPerfil(cum, { companyId: alfa, formId: randomUUID(), ...montos, motivo: "" }), /sin_permiso_operacion/);
          const formPerfil = randomUUID();
          await declararPerfil(ori, { companyId: alfa, formId: formPerfil, ...montos, motivo: "" });
          await declararPerfil(ori, { companyId: alfa, formId: formPerfil, ...montos, motivo: "" });
          assert.equal(await contar("select count(*)::int as n from pld_perfiles where company_id = $1", [alfa]), 1);
          assert.deepEqual(await uno("select numero, origen, pagos_monto_mensual_centavos::text as pagos, nomina_operaciones_mensuales as nomina from pld_perfiles where company_id = $1", [alfa]),
            { numero: 1, origen: "declaracion", pagos: "50000000", nomina: 2 });
          // Cambiar el perfil se explica; la base lo exige aunque alguien se salte el servicio.
          await assert.rejects(declararPerfil(ori, { companyId: alfa, formId: randomUUID(), ...montos, motivo: "" }), /motivo_corto|motivo_invalido/);
          await assert.rejects(dueno.query(
            `insert into pld_perfiles (id, operator_id, company_id, origen, pagos_monto_mensual_centavos, pagos_operaciones_mensuales,
               nomina_monto_mensual_centavos, nomina_operaciones_mensuales, registrado_por) values ($1, $2, $3, 'declaracion', 1, 1, 1, 1, $4)`,
            [randomUUID(), operador, alfa, ORI],
          ), /motivo_invalido/);
          // Por SQL directo: rol exacto y bitácora en la misma transacción.
          const perfilSql = (userId: string, origen: string) => sofipo(userId, async (c) => {
            const id = randomUUID();
            await eventoPersonal(c, userId, "expediente_perfil_declarado", "pld_perfiles", id, alfa);
            await c.query(
              `insert into pld_perfiles (id, operator_id, company_id, origen, pagos_monto_mensual_centavos, pagos_operaciones_mensuales,
                 nomina_monto_mensual_centavos, nomina_operaciones_mensuales, motivo, registrado_por)
               values ($1, $2, $3, $4, 1, 1, 1, 1, 'Cambio de prueba por SQL', $5)`,
              [id, operador, alfa, origen, userId],
            );
          });
          await assert.rejects(perfilSql(CUM, "declaracion"), /sin_rol_para_perfil/);
          await assert.rejects(perfilSql(ORI, "evaluacion"), /sin_rol_para_evaluar|row-level security/);
          // El disparador corre antes que la política: Aprobación ni siquiera llega a la RLS.
          await assert.rejects(perfilSql(APR, "declaracion"), /sin_rol_para_perfil/);
          await assert.rejects(sofipo(ORI, (c) => c.query(
            `insert into pld_perfiles (id, operator_id, company_id, origen, pagos_monto_mensual_centavos, pagos_operaciones_mensuales,
               nomina_monto_mensual_centavos, nomina_operaciones_mensuales, motivo, registrado_por)
             values ($1, $2, $3, 'declaracion', 1, 1, 1, 1, 'Cambio sin bitácora', $4)`,
            [randomUUID(), operador, alfa, ORI],
          )), /pld_sin_auditoria/);
          assert.equal(await contar("select count(*)::int as n from pld_perfiles where company_id = $1", [alfa]), 1);

          // Con perfil, otra persona aprueba; la celebración del contrato es esa primera activación (27ª).
          await decidirActivacion(apr, SESION_SOFIPO, { id: solicitud, aprobada: true });
          assert.equal((await leerCliente(ori, alfa))?.estado, "activa");
          assert.equal((await uno<{ dia: string }>("select pld_celebracion_contrato($1)::text as dia", [alfa])).dia, hoy);

          // Beta se activó antes de la 0030 (sin perfil): suspenderla y reactivarla sigue igual que en la 0028.
          beta = randomUUID();
          await dueno.query("begin");
          await dueno.query(
            `insert into companies (id, rfc, razon_social, codigo_postal, regimen, uso_cfdi, operator_id, estado, demostracion)
             values ($1, 'BET150301AB2', 'Beta Logística SA de CV', '06600', '601', 'G03', $2, 'activa', false)`,
            [beta, operador],
          );
          await dueno.query(
            "insert into audit_log (operator_id, company_id, actor_tipo, superficie, accion, entidad, identificador) values ($1, $2, 'sistema', 'sistema', 'alta_empresa', 'companies', $2)",
            [operador, beta],
          );
          await dueno.query("commit");
          for (const tipo of ["suspension", "reactivacion"] as const) {
            const pedida = randomUUID();
            await solicitarCambioDeSuspension(ori, { companyId: beta, formId: pedida, tipo, motivo: "Revisión de prueba del candado" });
            await decidirCambioDeSuspension(apr, SESION_SOFIPO, { id: pedida, aprobada: true, motivo: "" });
          }
          assert.equal((await leerCliente(ori, beta))?.estado, "activa");
          assert.equal(await contar("select count(*)::int as n from pld_perfiles where company_id = $1", [beta]), 0);
        });

        await t.test("perfil versionado y evaluaciones semestrales (27ª)", async () => {
          // r2-base-N18: Beta ya opera. Originación no escribe el perfil vigente: propone, y Cumplimiento aprueba.
          // Ni por SQL directo como el personal (con su evento en la bitácora) se cuela una declaración.
          await assert.rejects(sofipo(ORI, async (c) => {
            const id = randomUUID();
            await eventoPersonal(c, ORI, "expediente_perfil_declarado", "pld_perfiles", id, beta);
            await c.query(
              `insert into pld_perfiles (id, operator_id, company_id, origen, pagos_monto_mensual_centavos, pagos_operaciones_mensuales,
                 nomina_monto_mensual_centavos, nomina_operaciones_mensuales, registrado_por)
               values ($1, $2, $3, 'declaracion', 99900000, 1, 1, 1, $4)`,
              [id, operador, beta, ORI],
            );
          }), /perfil_requiere_aprobacion/);
          assert.equal(await contar("select count(*)::int as n from pld_perfiles where company_id = $1", [beta]), 0);
          const pesos = { pagosMonto: "10,000.00", pagosOperaciones: "10", nominaMonto: "5,000.00", nominaOperaciones: "2" };
          await assert.rejects(declararPerfil(ori, { companyId: beta, formId: randomUUID(), ...pesos, motivo: "" }), /motivo_invalido/);
          const propuesta = randomUUID();
          const motivoPropuesta = "Perfil del cliente que operaba antes del registro de perfiles";
          assert.equal(await declararPerfil(ori, { companyId: beta, formId: propuesta, ...pesos, motivo: motivoPropuesta }), "propuesto");
          assert.equal(await declararPerfil(ori, { companyId: beta, formId: propuesta, ...pesos, motivo: motivoPropuesta }), "propuesto");
          assert.equal(await contar("select count(*)::int as n from pld_perfil_propuestas where company_id = $1", [beta]), 1);
          assert.equal(await contar("select count(*)::int as n from audit_log where accion = 'expediente_perfil_propuesto' and identificador = $1", [propuesta]), 1);
          assert.equal((await leerPerfiles(apr, beta)).length, 0, "la propuesta no es el perfil vigente");
          assert.deepEqual((await leerBandejaPld(cum)).propuestasDePerfil.map((x) => x.propuestaId), [propuesta]);
          // Una a la vez, y sólo Cumplimiento resuelve.
          await assert.rejects(declararPerfil(ori, { companyId: beta, formId: randomUUID(), ...pesos, pagosMonto: "90,000.00", motivo: "Otra propuesta encima" }), /propuesta_de_perfil_pendiente/);
          const resolver = (ctx: ContextoDePersonal, decision: string, propuestaId = propuesta) =>
            resolverPropuestaDePerfil(ctx, { companyId: beta, propuestaId, decision, motivo: "Corresponde al giro y a lo que ya mueve" });
          await assert.rejects(resolver(ori, "aprobada"), /sin_permiso_operacion/);
          await assert.rejects(resolver(apr, "aprobada"), /sin_permiso_operacion/);
          await assert.rejects(resolver(cum, "quizas"), /dato_invalido_decision/);
          // Aprobada: la versión vigente lleva los montos de la propuesta, aunque por SQL se manden otros.
          assert.equal(await resolver(cum, "aprobada"), "aprobada");
          assert.equal(await resolver(cum, "aprobada"), "aprobada", "doble clic de la misma decisión");
          await assert.rejects(resolver(cum, "rechazada"), /propuesta_de_perfil_no_pendiente/);
          assert.deepEqual(await uno(
            `select p.numero, p.origen, p.pagos_monto_mensual_centavos::text as pagos, p.nomina_monto_mensual_centavos::text as nomina, p.motivo, r.decision
             from pld_perfiles p join pld_perfil_resoluciones r on r.perfil_id = p.id where p.company_id = $1`, [beta]),
            { numero: 1, origen: "aprobacion", pagos: "1000000", nomina: "500000", motivo: motivoPropuesta, decision: "aprobada" });
          for (const accion of ["expediente_perfil_aprobado", "pld_perfil_actualizado"]) {
            assert.equal(await contar("select count(*)::int as n from audit_log where accion = $1 and company_id = $2", [accion, beta]), 1, accion);
          }
          assert.equal((await leerPerfiles(apr, beta)).length, 1);
          // Rechazada: el vigente no cambia; la regla «Excede el perfil» (abajo) sigue con los 10,000.00 aprobados.
          const segunda = randomUUID();
          await declararPerfil(ori, { companyId: beta, formId: segunda, ...pesos, pagosMonto: "500,000.00", motivo: "La empresa dice que crecerá mucho" });
          await assert.rejects(sofipo(CUM, async (c) => {
            const id = randomUUID();
            await eventoPersonal(c, CUM, "pld_perfil_actualizado", "pld_perfiles", id, beta);
            await c.query(
              `insert into pld_perfiles (id, operator_id, company_id, origen, propuesta_id, pagos_monto_mensual_centavos, pagos_operaciones_mensuales,
                 nomina_monto_mensual_centavos, nomina_operaciones_mensuales, registrado_por)
               values ($1, $2, $3, 'aprobacion', $4, 1, 1, 1, 1, $5)`,
              [id, operador, beta, segunda, CUM],
            );
          }), /propuesta_de_perfil_no_pendiente/, "una versión aprobada sin la resolución en la misma transacción no queda");
          assert.equal(await resolver(cum, "rechazada", segunda), "rechazada");
          assert.equal(await contar("select count(*)::int as n from pld_perfiles where company_id = $1", [beta]), 1);
          const [ultima, primera] = await leerPropuestasDePerfil(apr, beta);
          assert.equal(ultima?.resolucion?.decision, "rechazada");
          assert.equal(primera?.resolucion?.decision, "aprobada");
          assert.deepEqual((await leerBandejaPld(cum)).propuestasDePerfil, []);
          await assert.rejects(leerPerfiles(adm, beta), /sin_permiso_operacion/);

          // Elegible a los seis meses de la celebración; antes, no hay pendiente.
          const ahora = new Date();
          assert.equal((await leerEvaluacionesPendientes(cum, { ahora })).some((p) => p.companyId === alfa), false);
          const enSieteMeses = new Date(`${sumarMeses(hoy, 7)}T18:00:00Z`);
          const pendiente = (await leerEvaluacionesPendientes(cum, { ahora: enSieteMeses })).find((p) => p.companyId === alfa);
          assert.ok(pendiente);

          // Mantiene: una evaluación, ligada al perfil y a la calificación vigentes.
          const mantiene = randomUUID();
          await assert.rejects(registrarEvaluacion(ori, { companyId: alfa, formId: randomUUID(), perfil: "mantiene", justificacion: "Sin cambios en la operación" }), /sin_permiso_operacion/);
          await registrarEvaluacion(cum, { companyId: alfa, formId: mantiene, perfil: "mantiene", justificacion: "Sin cambios en la operación" });
          await registrarEvaluacion(cum, { companyId: alfa, formId: mantiene, perfil: "mantiene", justificacion: "Sin cambios en la operación" });
          assert.equal(await contar("select count(*)::int as n from pld_evaluaciones where company_id = $1", [alfa]), 1);
          const evaluacion = await uno<{ anio: number; semestre: number; grado: string }>("select anio, semestre, grado from pld_evaluaciones where id = $1", [mantiene]);
          assert.deepEqual(evaluacion, { anio: Number(hoy.slice(0, 4)), semestre: Number(hoy.slice(5, 7)) <= 6 ? 1 : 2, grado: "bajo" });
          // Cambia: el perfil nuevo es una versión de la misma transacción, con origen evaluación.
          await registrarEvaluacion(cum, {
            companyId: alfa, formId: randomUUID(), perfil: "cambia", pagosMonto: "800,000.00", pagosOperaciones: "60",
            nominaMonto: "300,000.00", nominaOperaciones: "2", justificacion: "Creció la operación con proveedores",
          });
          assert.deepEqual(await uno("select numero, origen from pld_perfiles where company_id = $1 order by numero desc limit 1", [alfa]), { numero: 2, origen: "evaluacion" });
          // Por SQL: sobre un perfil viejo, «cambia» sin perfil nuevo y sin bitácora, la base dice que no.
          const evaluarSql = (perfilId: string, perfil: string, conEvento = true) => sofipo(CUM, async (c) => {
            const id = randomUUID();
            if (conEvento) await eventoPersonal(c, CUM, "pld_evaluacion_registrada", "pld_evaluaciones", id, alfa);
            const calificacion = (await c.query("select id from kyb_calificaciones_riesgo where company_id = $1 order by calificada_en desc, id desc limit 1", [alfa])).rows[0].id;
            await c.query(
              `insert into pld_evaluaciones (id, operator_id, company_id, perfil, perfil_id, calificacion_id, justificacion, registrado_por)
               values ($1, $2, $3, $4, $5, $6, 'Evaluación por SQL directo', $7)`,
              [id, operador, alfa, perfil, perfilId, calificacion, CUM],
            );
          });
          const perfiles = (await dueno.query("select id from pld_perfiles where company_id = $1 order by numero", [alfa])).rows.map((r) => String(r.id));
          await assert.rejects(evaluarSql(perfiles[0]!, "mantiene"), /evaluacion_sobre_perfil_viejo/);
          await assert.rejects(evaluarSql(perfiles[1]!, "cambia"), /evaluacion_sin_perfil_nuevo/);
          await assert.rejects(evaluarSql(perfiles[1]!, "mantiene", false), /pld_sin_auditoria/);
          assert.equal((await leerEvaluacionesPendientes(cum, { ahora })).some((p) => p.companyId === alfa), false);
        });

        let alertaBeta = "";
        await t.test("reglas en vivo: el pago liberado y el lote preparado entran una vez y alertan sin bloquear", async () => {
          await sembrarPortal(dueno, beta, operador);
          const deps = { almacen: almacenEnMemoria(), ahora: () => new Date() };
          const luis = cliente(LUIS, ["administrador", "liberador"], beta, operador);
          const rosa = cliente(ROSA, ["liberador"], beta, operador);
          const sesionCliente = { superficie: "cliente" as const, segundoFactor: { metodo: "totp" as const, en: new Date() } };
          const pago = (monto: string) => crearPagoProveedor(luis, {
            clientRequestId: randomUUID(), supplierId: PROVEEDOR, origen: "excepcion", pdf: { nombre: "soporte.pdf", bytes: PDF },
            monto, referencia: "Servicio de prueba", emitidaEl: hoy, venceEl: sumarMeses(hoy, 1), programadaEl: sumarMeses(hoy, 1),
            motivoExcepcion: "Servicio urgente autorizado por dirección",
          }, deps);
          // Pedido y sin liberar: todavía no es una operación.
          const primero = await pago("6,000.00");
          assert.equal(await contar("select count(*)::int as n from pld_operaciones where company_id = $1", [beta]), 0);
          await resolverPagoProveedor(rosa, sesionCliente, { requestId: primero.requestId, decision: "autorizar", version: 1, totalCentavos: 600000 }, deps);
          // Liberado: una operación, sin alerta (6,000.00 de 10,000.00 declarados).
          assert.deepEqual(await uno("select tipo, monto_centavos::text as monto, clabe from pld_operaciones where origen_id = $1", [primero.requestId]),
            { tipo: "pago_proveedor", monto: "600000", clabe: CLABE });
          // Cancelado después: la operación se queda y sigue contando (2ª fr. XXIX: «pretenda realizar»).
          await cancelarPagoProveedor(luis, { requestId: primero.requestId, motivo: "El proveedor pidió reprogramar" }, deps);
          assert.equal((await uno<{ estado: string }>("select estado from supplier_payment_requests where id = $1", [primero.requestId])).estado, "cancelado");
          assert.equal(await contar("select count(*)::int as n from pld_operaciones where company_id = $1", [beta]), 1);
          assert.equal(await contar("select count(*)::int as n from pld_alertas where company_id = $1", [beta]), 0);
          // El segundo de 6,000.00 cruza el perfil solo porque el cancelado cuenta: alerta y el pago sigue listo para pagar.
          const segundo = await pago("6,000.00");
          await resolverPagoProveedor(rosa, sesionCliente, { requestId: segundo.requestId, decision: "autorizar", version: 1, totalCentavos: 600000 }, deps);
          assert.equal((await uno<{ estado: string }>("select estado from supplier_payment_requests where id = $1", [segundo.requestId])).estado, "listo_para_pagar");
          const alertas = await listarAlertasPld(cum);
          const excede = alertas.find((a) => a.companyId === beta && a.regla === "excede_perfil");
          assert.ok(excede);
          alertaBeta = excede.id;
          assert.equal(excede.observado.incluye_canceladas, true);
          assert.equal(excede.observado.declarado_centavos, 1000000);
          assert.equal(excede.observado.suma_mes_centavos, 1200000);
          assert.equal(excede.venceEl > hoy, true);
          assert.equal((await uno<{ origen_id: string }>("select o.origen_id from pld_alertas a join pld_operaciones o on o.id = a.operacion_id where a.id = $1", [alertaBeta])).origen_id, segundo.requestId);
          // Repetir la autorización no duplica la operación ni la alerta.
          await assert.rejects(resolverPagoProveedor(rosa, sesionCliente, { requestId: segundo.requestId, decision: "autorizar", version: 1, totalCentavos: 600000 }, deps));
          assert.equal(await contar("select count(*)::int as n from pld_operaciones where company_id = $1", [beta]), 2);
          assert.equal(await contar("select count(*)::int as n from pld_alertas where company_id = $1 and regla = 'excede_perfil'", [beta]), 1);
          assert.equal(await contar("select count(*)::int as n from audit_log where accion = 'pld_alerta_generada' and identificador = $1 and actor_tipo = 'sistema'", [alertaBeta]), 1);

          // Nómina: el lote entra al cerrar la transacción con sus personas; 6,000.00 supera los 5,000.00 declarados.
          const lote = await sembrarLoteNomina(dueno, beta, operador, 600000);
          assert.deepEqual(await uno("select tipo, monto_centavos::text as monto, personas from pld_operaciones where origen_id = $1", [lote]),
            { tipo: "nomina", monto: "600000", personas: 1 });
          const nomina = (await listarAlertasPld(cum)).find((a) => a.companyId === beta && a.regla === "nomina_atipica");
          assert.equal(nomina?.observado.lote_sobre_perfil, true);

          // 55ª: la empresa no ve nada de PLD, ni en sus tablas ni en su bitácora.
          const delCliente = await como(urlApp, "plataforma_cliente", { userId: LUIS, companyId: beta }, async (c) => ({
            pld: Number((await c.query("select count(*)::int as n from audit_log where accion like 'pld%' or entidad like 'pld%'")).rows[0].n),
            todos: Number((await c.query("select count(*)::int as n from audit_log")).rows[0].n),
          }));
          assert.equal(delCliente.pld, 0);
          assert.ok(delCliente.todos > 0);
          assert.ok(await contar("select count(*)::int as n from audit_log where company_id = $1 and accion like 'pld%'", [beta]) > 0);
          await assert.rejects(como(urlApp, "plataforma_cliente", { userId: LUIS, companyId: beta }, (c) => c.query("select count(*) from pld_alertas")), /permission denied/);
          await assert.rejects(como(urlApp, "plataforma_cliente", { userId: LUIS, companyId: beta }, (c) => c.query("select count(*) from pld_perfiles")), /permission denied/);
        });

        await t.test("reenvío (r2-base-N1): un pago corregido y liberado otra vez se evalúa con su instrucción y cuenta una vez", async () => {
          // La secuencia del revisor, con los servicios del portal: liberar $1,000.00, el cliente cambia la CLABE (el pago
          // regresa), se rechaza, se corrige a $900,000.00 a la CLABE nueva y se libera otra vez. Perfil: $100,000.00 al mes.
          const gamma = randomUUID();
          const ids = { proveedor: "f1000000-0000-4000-8000-000000000002", copia: "f2000000-0000-4000-8000-000000000002" };
          const CLABE_NUEVA = "002180701150990025";
          await dueno.query("begin");
          await dueno.query(
            `insert into companies (id, rfc, razon_social, codigo_postal, regimen, uso_cfdi, operator_id, estado, demostracion)
             values ($1, 'GAM150301AB3', 'Gamma Servicios SA de CV', '06600', '601', 'G03', $2, 'en_alta', false)`,
            [gamma, operador],
          );
          await dueno.query(
            "insert into audit_log (operator_id, company_id, actor_tipo, superficie, accion, entidad, identificador) values ($1, $2, 'sistema', 'sistema', 'alta_empresa', 'companies', $2)",
            [operador, gamma],
          );
          await dueno.query("commit");
          await declararPerfil(ori, { companyId: gamma, formId: randomUUID(), pagosMonto: "100,000.00", pagosOperaciones: "10", nominaMonto: "5,000.00", nominaOperaciones: "2", motivo: "" });
          await dueno.query("begin; set local session_replication_role = replica; update companies set estado = 'activa' where id = $1; commit;".replace("$1", `'${gamma}'`));
          await sembrarPortal(dueno, gamma, operador, ids);
          const deps = { almacen: almacenEnMemoria(), ahora: () => new Date() };
          const luis = cliente(LUIS, ["administrador", "liberador"], gamma, operador);
          const rosa = cliente(ROSA, ["liberador"], gamma, operador);
          const sesionCliente = { superficie: "cliente" as const, segundoFactor: { metodo: "totp" as const, en: new Date() } };
          const instruccion = { supplierId: ids.proveedor, origen: "excepcion" as const, emitidaEl: hoy, venceEl: sumarMeses(hoy, 1), programadaEl: sumarMeses(hoy, 1),
            motivoExcepcion: "Servicio urgente autorizado por dirección" };
          const operaciones = async (requestId: string) => (await dueno.query(
            "select * , monto_centavos::text as monto from pld_operaciones where origen_id = $1 order by ocurrida_en", [requestId])).rows;
          const pago = await crearPagoProveedor(luis, { ...instruccion, clientRequestId: randomUUID(), pdf: { nombre: "soporte.pdf", bytes: PDF }, monto: "1,000.00", referencia: "Servicio menor" }, deps);
          await resolverPagoProveedor(rosa, sesionCliente, { requestId: pago.requestId, decision: "autorizar", version: 1, totalCentavos: 100000 }, deps);
          const cambio = await cambiarClabeProveedor(luis, { supplierId: ids.proveedor, clabe: CLABE_NUEVA }, sesionCliente, { avisar: async () => 0 } as never);
          assert.equal((cambio as { pagosRegresados?: number }).pagosRegresados, 1);
          // Regresar con la misma instrucción no la registra otra vez.
          assert.equal((await operaciones(pago.requestId)).length, 1);
          await resolverPagoProveedor(rosa, sesionCliente, { requestId: pago.requestId, decision: "rechazar", motivo: "Corregir el importe", version: 2, totalCentavos: 100000 }, deps);
          await editarYReenviarPago(luis, pago.requestId, { ...instruccion, pdf: { nombre: "evidencia-nueva.pdf", bytes: PDF }, monto: "900,000.00", referencia: "Servicio mayor" } as never, deps);
          await resolverPagoProveedor(rosa, sesionCliente, { requestId: pago.requestId, decision: "autorizar", version: 3, totalCentavos: 90000000 }, deps);
          // La instrucción nueva se evaluó y el pago cuenta una vez: 900,000.00, no 901,000.00.
          const excede = (await listarAlertasPld(cum)).find((a) => a.companyId === gamma && a.regla === "excede_perfil");
          assert.ok(excede, "la instrucción corregida alerta");
          assert.equal(excede.observado.suma_mes_centavos, 90000000);
          const ops = await operaciones(pago.requestId);
          assert.deepEqual(ops.map(({ instruccion: n, monto, clabe, reemplaza }) => ({ n, monto, clabe, reemplaza })), [
            { n: 1, monto: "100000", clabe: CLABE, reemplaza: null },
            { n: 3, monto: "90000000", clabe: CLABE_NUEVA, reemplaza: ops[0]!.id },
          ]);
          assert.equal(excede.observado.instruccion, 3);
          assert.equal(excede.observado.reemplaza_monto_centavos, 100000);
          assert.equal(excede.observado.reemplaza_clabe, CLABE);
        });

        let casoConfidencial = "";
        await t.test("aviso del personal: acuse para quien avisa y nada para la persona mencionada (60ª)", async () => {
          const formAviso = randomUUID();
          const entrada = {
            formId: formAviso, tipo: "posible_interna_preocupante", companyId: beta, mencionada: CUM2, superior: APR,
            descripcion: "La persona de Cumplimiento pidió borrar un expediente de un cliente.",
          };
          const acuse = await emitirAviso(ori, entrada);
          const otraVez = await emitirAviso(ori, entrada);
          assert.deepEqual(otraVez, acuse);
          assert.equal(acuse.folio, formAviso.slice(0, 8).toUpperCase());
          assert.equal(await contar("select count(*)::int as n from pld_avisos where id = $1", [formAviso]), 1);
          assert.equal(await contar("select count(*)::int as n from pld_aviso_excluidos where aviso_id = $1", [formAviso]), 2);
          assert.deepEqual((await misAcuses(ori)).map((a) => a.folio), [acuse.folio]);
          // El evento no lleva el texto ni a quién excluye.
          const evento = await uno<{ cambio: Record<string, unknown> }>("select cambio from audit_log where accion = 'pld_aviso_emitido' and identificador = $1", [formAviso]);
          assert.deepEqual(evento.cambio, { tipo: "posible_interna_preocupante" });

          const alertaAviso = (await listarAlertasPld(cum)).find((a) => a.avisoId === formAviso);
          assert.equal(alertaAviso?.regla, "aviso_manual");
          assert.equal((await listarAlertasPld(cum2)).some((a) => a.avisoId === formAviso), false);
          await assert.rejects(listarAlertasPld(ori), /sin_permiso_operacion/);
          casoConfidencial = await abrirCaso(cum, { formId: randomUUID(), alertaId: alertaAviso!.id });
          assert.ok(await leerCaso(cum, casoConfidencial));
          assert.equal(await leerCaso(cum2, casoConfidencial), null);
          await assert.rejects(agregarNota(cum2, { casoId: casoConfidencial, formId: randomUUID(), texto: "Intento de nota" }), /caso_no_existe|sin_permiso_operacion/);

          // La bitácora: Cumplimiento y Auditoría ven los eventos de PLD; la persona excluida y Administración, no.
          const eventosPld = (userId: string, op = operador) => sofipo(userId, async (c) => (await c.query(
            "select count(*)::int as n from audit_log where accion like 'pld%' and (identificador = $1 or identificador = $2 or identificador = $3)",
            [formAviso, alertaAviso!.id, casoConfidencial],
          )).rows[0].n as number, op);
          assert.ok((await eventosPld(CUM)) >= 3);
          assert.ok((await eventosPld(AUD)) >= 3);
          assert.equal(await eventosPld(CUM2), 0);
          assert.equal(await eventosPld(ADM), 0);
          assert.equal(await eventosPld(ORI), 0);
          assert.equal(await eventosPld(AJENA, otroOperador), 0);
          assert.equal(await sofipo(ADM, async (c) => (await c.query("select count(*)::int as n from audit_log where accion like 'pld%'")).rows[0].n as number), 0);
          // La persona excluida no lee el aviso ni su caso por SQL.
          assert.deepEqual(await sofipo(CUM2, async (c) => ({
            avisos: (await c.query("select count(*)::int as n from pld_avisos where id = $1", [formAviso])).rows[0].n,
            casos: (await c.query("select count(*)::int as n from pld_casos where id = $1", [casoConfidencial])).rows[0].n,
            alertas: (await c.query("select count(*)::int as n from pld_alertas where aviso_id = $1", [formAviso])).rows[0].n,
          })), { avisos: 0, casos: 0, alertas: 0 });

          // r2-base-N3: una alerta hermana del caso confidencial tampoco se ve. Verla «sin caso» y que abrirle
          // uno responda «ya está en un caso» delataba el caso oculto; lo mismo el texto de su aviso.
          const hermano = await emitirAviso(apr, { formId: randomUUID(), tipo: "posible_inusual", companyId: beta, mencionada: "", superior: "", descripcion: "Proveedor nuevo con pagos del mismo monto." });
          const alertaHermana = String((await uno("select id from pld_alertas where aviso_id = $1", [hermano.id])).id);
          assert.ok((await listarAlertasPld(cum2)).some((a) => a.id === alertaHermana), "antes de sumarse al caso, la ve");
          await sumarAlertaAlCaso(cum, { casoId: casoConfidencial, alertaId: alertaHermana });
          assert.equal((await listarAlertasPld(cum2)).some((a) => a.id === alertaHermana), false);
          await assert.rejects(abrirCaso(cum2, { formId: randomUUID(), alertaId: alertaHermana }), /alerta_no_existe/);
          const verHermana = (userId: string) => sofipo(userId, async (c) => ({
            alertas: (await c.query("select count(*)::int as n from pld_alertas where id = $1", [alertaHermana])).rows[0].n,
            avisos: (await c.query("select count(*)::int as n from pld_avisos where id = $1", [hermano.id])).rows[0].n,
            eventos: (await c.query("select count(*)::int as n from audit_log where identificador = $1 or identificador = $2", [alertaHermana, hermano.id])).rows[0].n,
          }));
          assert.deepEqual(await verHermana(CUM2), { alertas: 0, avisos: 0, eventos: 0 });
          const deCumplimiento = await verHermana(CUM);
          assert.equal(deCumplimiento.alertas, 1);
          assert.equal(deCumplimiento.avisos, 1);
          assert.ok(deCumplimiento.eventos >= 2);

          // r2-base-N3: el caso en que ya trabajó CUM2 no recibe un aviso que la excluye: le desaparecería a media
          // análisis. El aviso abre su propio caso.
          const propio = await emitirAviso(apr, { formId: randomUUID(), tipo: "posible_inusual", companyId: beta, mencionada: "", superior: "", descripcion: "Cambio de domicilio fiscal sin aviso." });
          const casoDeCum2 = await abrirCaso(cum2, { formId: randomUUID(), alertaId: String((await uno("select id from pld_alertas where aviso_id = $1", [propio.id])).id) });
          await agregarNota(cum2, { casoId: casoDeCum2, formId: randomUUID(), texto: "Revisando el domicilio con el SAT." });
          const contraCum2 = await emitirAviso(apr, { formId: randomUUID(), tipo: "posible_interna_preocupante", companyId: beta, mencionada: CUM2, superior: "", descripcion: "La analista pidió no revisar este cliente." });
          const alertaContraCum2 = String((await uno("select id from pld_alertas where aviso_id = $1", [contraCum2.id])).id);
          await assert.rejects(sumarAlertaAlCaso(cum, { casoId: casoDeCum2, alertaId: alertaContraCum2 }), /serie_con_persona_excluida/);
          assert.ok(await leerCaso(cum2, casoDeCum2));
          await agregarNota(cum2, { casoId: casoDeCum2, formId: randomUUID(), texto: "Sigue el análisis." });
          await abrirCaso(cum, { formId: randomUUID(), alertaId: alertaContraCum2 });

          // Las exclusiones las marca quien avisa, en la misma transacción, y solo a otras personas del personal.
          await assert.rejects(emitirAviso(apr, { ...entrada, formId: randomUUID(), mencionada: APR, superior: "" }), /exclusion_propia/);
          await assert.rejects(emitirAviso(apr, { ...entrada, formId: randomUUID(), mencionada: LUIS, superior: "" }), /exclusion_fuera_del_personal/);
          await assert.rejects(sofipo(CUM, (c) => c.query(
            "insert into pld_aviso_excluidos (aviso_id, user_id, operator_id, motivo) values ($1, $2, $3, 'mencionada')", [formAviso, AUD, operador],
          )), /exclusion_fuera_del_aviso/);
          await assert.rejects(emitirAviso(adm, { ...entrada, formId: randomUUID(), descripcion: "corto" }), /dato_invalido_descripcion/);
          await assert.rejects(emitirAviso(ajena, { ...entrada, formId: randomUUID(), mencionada: "", superior: "" }), /dato_invalido_companyId/);
          // r2-base-N4: excluir a las dos personas de Cumplimiento dejaría el aviso sin quien lo analice; no se guarda nada.
          const sinCumplimiento = randomUUID();
          await assert.rejects(emitirAviso(apr, { ...entrada, formId: sinCumplimiento, mencionada: CUM, superior: CUM2 }), /aviso_sin_cumplimiento/);
          assert.equal(await contar("select count(*)::int as n from pld_avisos where id = $1", [sinCumplimiento]), 0);
          assert.equal(await contar("select count(*)::int as n from pld_aviso_excluidos where aviso_id = $1", [sinCumplimiento]), 0);
          // r2-base-N17: con el rol del personal y sin persona en el contexto, nadie agrega una exclusión a un aviso viejo.
          await assert.rejects(como(urlApp, "plataforma_sofipo", { userId: "", operadorId: operador }, (c) => c.query(
            "insert into pld_aviso_excluidos (aviso_id, user_id, operator_id, motivo) values ($1, $2, $3, 'superior')", [formAviso, AUD, operador],
          )), /exclusion_fuera_del_aviso/);
          assert.equal(await contar("select count(*)::int as n from pld_aviso_excluidos where aviso_id = $1", [formAviso]), 2);
        });

        let casoX = "";
        await t.test("análisis: caso, serie de la misma empresa, notas, documento con doble envío y propuesta", async () => {
          const formCaso = randomUUID();
          casoX = await abrirCaso(cum, { formId: formCaso, alertaId: alertaBeta });
          assert.equal(await abrirCaso(cum, { formId: formCaso, alertaId: alertaBeta }), casoX);
          assert.equal(await abrirCaso(cum, { formId: randomUUID(), alertaId: alertaBeta }), casoX);
          assert.equal(await contar("select count(*)::int as n from pld_caso_alertas where alerta_id = $1", [alertaBeta]), 1);
          await assert.rejects(abrirCaso(aud, { formId: randomUUID(), alertaId: alertaBeta }), /sin_permiso_operacion/);

          // La serie: otra alerta de Beta se suma; una de Alfa no (40ª: un reporte por cliente).
          const avisoBeta = await emitirAviso(apr, { formId: randomUUID(), tipo: "posible_inusual", companyId: beta, mencionada: "", superior: "", descripcion: "Pagos repetidos al mismo proveedor en pocos días." });
          const alertaAvisoBeta = String((await uno("select id from pld_alertas where aviso_id = $1", [avisoBeta.id])).id);
          await sumarAlertaAlCaso(cum, { casoId: casoX, alertaId: alertaAvisoBeta });
          await sumarAlertaAlCaso(cum, { casoId: casoX, alertaId: alertaAvisoBeta });
          const avisoAlfa = await emitirAviso(apr, { formId: randomUUID(), tipo: "posible_inusual", companyId: alfa, mencionada: "", superior: "", descripcion: "Movimientos fuera de lo habitual en Alfa." });
          const alertaAlfa = String((await uno("select id from pld_alertas where aviso_id = $1", [avisoAlfa.id])).id);
          await assert.rejects(sumarAlertaAlCaso(cum, { casoId: casoX, alertaId: alertaAlfa }), /serie_de_otra_empresa/);
          await assert.rejects(sumarAlertaAlCaso(cum, { casoId: casoConfidencial, alertaId: alertaAvisoBeta }), /alerta_ya_en_caso/);
          assert.equal(await contar("select count(*)::int as n from pld_caso_alertas where caso_id = $1", [casoX]), 2);
          // Un caso sin alertas no se guarda.
          await assert.rejects(sofipo(CUM, async (c) => {
            const id = randomUUID();
            await eventoPersonal(c, CUM, "pld_caso_abierto", "pld_casos", id, beta);
            await c.query("insert into pld_casos (id, operator_id, company_id, registrado_por) values ($1, $2, $3, $4)", [id, operador, beta, CUM]);
          }), /caso_sin_alertas/);

          const nota = randomUUID();
          await agregarNota(cum, { casoId: casoX, formId: nota, texto: "Se pidió la factura al cliente." });
          await agregarNota(cum, { casoId: casoX, formId: nota, texto: "Se pidió la factura al cliente." });
          const documento = randomUUID();
          const archivo = { nombre: "estado-de-cuenta.pdf", bytes: PDF };
          await Promise.all([
            cargarDocumentoPld(cum, { casoId: casoX, formId: documento, archivo }, { almacen }),
            cargarDocumentoPld(cum, { casoId: casoX, formId: documento, archivo }, { almacen }),
          ]);
          assert.equal(await contar("select count(*)::int as n from pld_notas where caso_id = $1", [casoX]), 1);
          assert.equal(await contar("select count(*)::int as n from pld_documentos where caso_id = $1", [casoX]), 1);
          // El personal no lee la ruta: la entrega la descarga auditada, que compara la huella.
          await assert.rejects(sofipo(CUM, (c) => c.query("select clave_blob from pld_documentos")), /permission denied/);
          const descargado = await descargarDocumentoPld(aud, documento, { leer: leerDelAlmacen });
          assert.equal(createHash("sha256").update(descargado.bytes).digest("hex"), createHash("sha256").update(PDF).digest("hex"));
          assert.equal(await contar("select count(*)::int as n from audit_log where accion = 'pld_documento_descargado' and identificador = $1 and actor_id = $2", [documento, AUD]), 1);
          // Un documento del caso confidencial no se descarga por la persona excluida aunque conozca su id (60ª).
          const confidencial = randomUUID();
          await cargarDocumentoPld(cum, { casoId: casoConfidencial, formId: confidencial, archivo }, { almacen });
          await assert.rejects(descargarDocumentoPld(cum2, confidencial, { leer: leerDelAlmacen }), /documento_no_existe/);
          await descargarDocumentoPld(cum, confidencial, { leer: leerDelAlmacen });

          await registrarPropuesta(cum, { casoId: casoX, formId: randomUUID(), propuesta: "no_reportar", justificacion: "Primera lectura sin indicios" });
          await registrarPropuesta(cum, { casoId: casoX, formId: randomUUID(), propuesta: "reportar_inusual", justificacion: "Monto fuera del perfil y sin soporte" });
          const caso = await leerCaso(cum, casoX);
          assert.equal(caso?.propuestas.length, 2);
          assert.equal(await contar("select count(*)::int as n from audit_log where accion = 'pld_caso_consultado' and identificador = $1", [casoX]), 1);
        });

        // datetime-local de la Ciudad de México, como lo manda el formulario.
        const enMexico = (fecha: Date) => fecha.toLocaleString("sv-SE", { timeZone: "America/Mexico_City" }).slice(0, 16).replace(" ", "T");
        const haceMinutos = (minutos: number) => enMexico(new Date(Date.now() - minutos * 60_000));
        const sumarDias = (dia: string, dias: number) => new Date(Date.parse(`${dia}T12:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
        const designado = sumarDias(hoy, -30);
        // Cada persona con su RFC y su CURP: una misma persona ocupa un solo lugar (r2-base-N5).
        let personasDelComite = 0;
        const integrante = (id: string, cargo: string, titularidad: string, nombres: string, extra: Partial<EntradaIntegrante> = {}): EntradaIntegrante => {
          const n = String(++personasDelComite).padStart(2, "0");
          return {
            id, area: "Dirección General", cargo, titularidad, suplenteDe: "", nombres, primerApellido: "Núñez", segundoApellido: "Peña",
            rfc: `NUPJ7001${n}AB1`, curp: `NUPJ7001${n}HDFRXXA1`, cargoEntidad: "Director", esOficial: false, designadoEl: designado, certificado: "", ...extra,
          };
        };
        const AUDITOR = { rfc: "AUIN690101AB1", curp: "AUIN690101HDFRXXA1" };
        const P = randomUUID();
        const S = randomUUID();
        const I1 = randomUUID();
        const I2 = randomUUID();
        const PS = randomUUID();
        const S2 = randomUUID();
        let propuestaX = "";
        await t.test("Comité: integración (47ª), quórum, empate con voto de calidad, suplentes, acta y dictamen", async () => {
          const presidente = integrante(P, "PRESIDENTE", "TITULAR", "José María");
          const secretario = integrante(S, "SECRETARIO", "TITULAR", "Sara");
          const oficial = integrante(I1, "INTEGRANTE", "TITULAR", "Ivonne", { esOficial: true });
          const vocal = integrante(I2, "INTEGRANTE", "TITULAR", "Iván");
          await assert.rejects(registrarIntegrantes(cum, { integrantes: [presidente, { ...secretario, esOficial: true }] }), /comite_minimo_tres_titulares/);
          await assert.rejects(registrarIntegrantes(cum, { integrantes: [presidente, secretario, vocal] }), /comite_sin_oficial/);
          await assert.rejects(registrarIntegrantes(cum, { integrantes: [presidente, { ...secretario, cargo: "PRESIDENTE" }, oficial] }), /comite_presidente_unico/);
          await assert.rejects(registrarIntegrantes(cum, { integrantes: [presidente, secretario, oficial, integrante(PS, "PRESIDENTE", "SUPLENTE", "Pablo", { suplenteDe: randomUUID() })] }), /comite_suplente_sin_titular/);
          await assert.rejects(registrarIntegrantes(aud, { integrantes: [presidente, secretario, oficial] }), /sin_permiso_operacion/);
          // base-N23: los nombres son identidad; con un carácter invisible (control o de formato) se rechazan, no se vuelven espacio.
          await assert.rejects(registrarIntegrantes(cum, { integrantes: [{ ...presidente, nombres: "Pedro\u200bPablo" }, secretario, oficial] }), /invisible_nombres/);
          // r2-serv-N1: el rechazo de un renglón dice cuál fue (la pantalla marca ese campo, no el del primero).
          const delRenglon = (codigo: string, renglon: number) => (error: unknown) =>
            error instanceof ErrorDeIntegrante && error.codigo === codigo && error.renglon === renglon;
          await assert.rejects(registrarIntegrantes(cum, { integrantes: [presidente, { ...secretario, nombres: "Sara\u200b" }, oficial] }), delRenglon("invisible_nombres", 1));
          await assert.rejects(registrarIntegrantes(cum, { integrantes: [presidente, secretario, { ...oficial, rfc: "MAL" }] }), delRenglon("dato_invalido_rfc", 2));
          await assert.rejects(registrarIntegrantes(cum, { integrantes: [presidente, { ...secretario, designadoEl: sumarDias(hoy, 1) }, oficial] }), delRenglon("dato_invalido_designadoEl", 1));
          await assert.rejects(registrarIntegrantes(cum, { integrantes: [{ ...presidente, primerApellido: "Ruiz\tSoto" }, secretario, oficial] }), /invisible_primerApellido/);
          // Área y cargo van tal cual en el aviso de la 49ª: también rechazan.
          await assert.rejects(registrarIntegrantes(cum, { integrantes: [{ ...presidente, area: "Dirección\u00adGeneral" }, secretario, oficial] }), /invisible_area/);
          await assert.rejects(registrarIntegrantes(cum, { integrantes: [{ ...presidente, cargoEntidad: "Director\u000bGeneral" }, secretario, oficial] }), /invisible_cargoEntidad/);
          // Default_Ignorable_Code_Point (novena revisión del #59): relleno hangul y selectores de variación.
          await assert.rejects(registrarIntegrantes(cum, { integrantes: [{ ...presidente, nombres: "Rodr\u3164iguez" }, secretario, oficial] }), /invisible_nombres/);
          await assert.rejects(registrarIntegrantes(cum, { integrantes: [{ ...presidente, segundoApellido: "Pe\ufe0fna" }, secretario, oficial] }), /invisible_segundoApellido/);
          await assert.rejects(registrarIntegrantes(cum, { integrantes: [{ ...presidente, area: "Direcci\u180bon General" }, secretario, oficial] }), /invisible_area/);
          await assert.rejects(registrarIntegrantes(cum, { integrantes: [{ ...presidente, primerApellido: "Ruiz\u{E0100}" }, secretario, oficial] }), /invisible_primerApellido/);
          // r2-base-N5: la misma persona (RFC o CURP) no ocupa dos lugares; valdría por varios titulares.
          await assert.rejects(registrarIntegrantes(cum, { integrantes: [presidente, { ...secretario, rfc: presidente.rfc }, oficial] }), /comite_persona_repetida/);
          await assert.rejects(registrarIntegrantes(cum, { integrantes: [presidente, secretario, { ...oficial, curp: presidente.curp }] }), /comite_persona_repetida/);
          assert.equal(await contar("select count(*)::int as n from pld_comite_integrantes"), 0);
          await registrarIntegrantes(cum, { integrantes: [presidente, secretario, oficial, vocal, integrante(PS, "PRESIDENTE", "SUPLENTE", "Pablo", { suplenteDe: P })] });
          assert.deepEqual(await uno("select nombres, primer_apellido, segundo_apellido, area from pld_comite_integrantes where id = $1", [P]),
            { nombres: "JOSE MARIA", primer_apellido: "NUÑEZ", segundo_apellido: "PEÑA", area: "DIRECCIÓN GENERAL" });
          await assert.rejects(registrarIntegrantes(cum, { integrantes: [integrante(randomUUID(), "PRESIDENTE", "SUPLENTE", "Pedro", { suplenteDe: P })] }), /comite_un_suplente_por_titular/);
          // r2-base-N15: en pantalla, área y cargo con acentos; en lo que se captura en el SITI, sin ellos (la Ñ se queda).
          const paraSiti = contenidoParaSiti((await leerComite(cum)).integrantes);
          assert.match(paraSiti, /\nDIRECCION GENERAL\|PRESIDENTE\|TITULAR\|JOSE MARIA\|NUÑEZ\|PEÑA\|/);
          assert.doesNotMatch(paraSiti, /[ÁÉÍÓÚÜáéíóúü]/);
          assert.equal((await leerComite(cum)).integrantes.find((i) => i.id === P)?.area, "DIRECCIÓN GENERAL");
          await assert.rejects(registrarIntegrantes(cum, { integrantes: [], sustituye: { integranteId: I2, sustituidoEl: sumarDias(designado, -1), motivo: "Sustitución de prueba" } }), /comite_sustitucion_antes_de_designacion/);
          await assert.rejects(registrarAuditor(cum, { formId: randomUUID(), nombre: "Auditor\u2060Interno", cargoEntidad: "Auditor", ...AUDITOR, designadoEl: designado }), /invisible_nombre/);
          await assert.rejects(registrarAuditor(cum, { formId: randomUUID(), nombre: "Auditor Interno", cargoEntidad: "Auditor\u0085interno", ...AUDITOR, designadoEl: designado }), /invisible_cargoEntidad/);
          await assert.rejects(registrarAuditor(cum, { formId: randomUUID(), nombre: "Auditor\ufe0fInterno", cargoEntidad: "Auditor", ...AUDITOR, designadoEl: designado }), /invisible_nombre/);
          await assert.rejects(registrarAuditor(cum, { formId: randomUUID(), nombre: "Auditor Interno", cargoEntidad: "Auditor", rfc: "AUIN69", curp: AUDITOR.curp, designadoEl: designado }), /dato_invalido_rfc/);
          // r2-base-N5 (47ª): el auditor no forma parte del Comité, ni con el RFC ni con la CURP de un integrante vigente.
          await assert.rejects(registrarAuditor(cum, { formId: randomUUID(), nombre: "Auditor Interno", cargoEntidad: "Auditor", rfc: vocal.rfc, curp: AUDITOR.curp, designadoEl: designado }), /comite_auditor_integrante/);
          await assert.rejects(registrarAuditor(cum, { formId: randomUUID(), nombre: "Auditor Interno", cargoEntidad: "Auditor", rfc: AUDITOR.rfc, curp: vocal.curp, designadoEl: designado }), /comite_auditor_integrante/);
          // r2-serv-N2: ni con el nombre de un integrante vigente, aunque cambien acentos, mayúsculas u orden de las palabras.
          for (const nombre of ["Iván Núñez Peña", "IVAN NUNEZ PENA", "Peña Núñez, Iván"]) {
            await assert.rejects(registrarAuditor(cum, { formId: randomUUID(), nombre, cargoEntidad: "Auditor", ...AUDITOR, designadoEl: designado }), /comite_auditor_integrante/, nombre);
          }
          assert.equal(await contar("select count(*)::int as n from pld_comite_auditores"), 0);
          await registrarAuditor(cum, { formId: randomUUID(), nombre: "Auditor Interno", cargoEntidad: "Auditor", ...AUDITOR, designadoEl: designado });
          // r2-base-N14: la base rechaza en folios, área, cargo y auditor los mismos invisibles que el servidor (INVISIBLE),
          // aunque el dato llegue sin pasar por él. La clase explícita de pld_sin_invisibles es la de INVISIBLE en todo Unicode.
          const deJs: number[] = [];
          for (let n = 1; n <= 0x10ffff; n++) if ((n < 0xd800 || n > 0xdfff) && INVISIBLE.test(String.fromCodePoint(n))) deJs.push(n);
          const deLaBase = (await dueno.query("select n from (select generate_series(1, 55295) union all select generate_series(57344, 1114111)) as g (n) where not pld_sin_invisibles(chr(n)) order by n"))
            .rows.map((r) => Number(r.n));
          assert.deepEqual(deLaBase, deJs);
          for (const invisible of ["\u00ad", "\u200b", "\u2060", "\ufeff", "\u202e", "\u3164", "\ufe0f", "\u180b", "\u{E0100}"]) {
            await assert.rejects(dueno.query(
              "insert into pld_comite_auditores (id, operator_id, nombre, cargo_entidad, rfc, curp, designado_el, registrado_por) values ($1, $2, $3, 'Auditor', $4, $5, $6, $7)",
              [randomUUID(), operador, `Auditor${invisible}Interno`, "AUIX690101AB1", "AUIX690101HDFRXXA1", designado, CUM],
            ), /pld_comite_auditores_textos/, JSON.stringify(invisible));
            await assert.rejects(dueno.query(
              "insert into pld_comite_comunicaciones (id, operator_id, folio, recibido_en, integrantes, bajas, registrado_por) values ($1, $2, $3, now(), $4, '{}', $5)",
              [randomUUID(), operador, `SITI${invisible}0009`, [P], CUM],
            ), /pld_comite_comunicaciones_folio/, JSON.stringify(invisible));
          }
          // Y al revés: el auditor vigente no se registra como integrante.
          await assert.rejects(registrarIntegrantes(cum, { integrantes: [integrante(randomUUID(), "INTEGRANTE", "TITULAR", "Aurelio", { ...AUDITOR })] }), /comite_auditor_integrante/);
          await assert.rejects(registrarIntegrantes(cum, {
            integrantes: [integrante(randomUUID(), "INTEGRANTE", "TITULAR", "Interno", { primerApellido: "Auditor", segundoApellido: "" })],
          }), /comite_auditor_integrante/, "con el nombre del auditor y otro RFC");

          // 49ª: comunicación al SITI con su folio; repetido o ajeno, no.
          const ayer = `${sumarDias(hoy, -1)}T10:00`;
          await registrarComunicacion(cum, { formId: randomUUID(), folio: "SITI-0001", recibidoEn: ayer, integrantes: [P, S, I1, I2, PS], bajas: [] });
          await assert.rejects(registrarComunicacion(cum, { formId: randomUUID(), folio: "SITI-0001", recibidoEn: ayer, integrantes: [P], bajas: [] }), /folio_repetido/);
          await assert.rejects(registrarComunicacion(cum, { formId: randomUUID(), folio: "SITI\t0009", recibidoEn: ayer, integrantes: [P], bajas: [] }), /invisible_folio/);
          await assert.rejects(registrarComunicacion(cum, { formId: randomUUID(), folio: "SITI\u31640009", recibidoEn: ayer, integrantes: [P], bajas: [] }), /invisible_folio/);
          await assert.rejects(registrarComunicacion(cum, { formId: randomUUID(), folio: "SITI-0002", recibidoEn: ayer, integrantes: [randomUUID()], bajas: [] }), /comunicacion_cubre_ajenos/);
          await assert.rejects(registrarComunicacion(cum, { formId: randomUUID(), folio: "SITI-0003", recibidoEn: `${sumarDias(hoy, 2)}T10:00`, integrantes: [P], bajas: [] }), /acuse_fecha_futura|dato_invalido/);

          propuestaX = String((await uno("select id from pld_propuestas where caso_id = $1 order by registrado_en desc, id desc limit 1", [casoX])).id);
          const propuestaVieja = String((await uno("select id from pld_propuestas where caso_id = $1 and id <> $2", [casoX, propuestaX])).id);
          // Sin quórum: dos de cuatro titulares. Queda registrada y no admite votos.
          const S1 = randomUUID();
          assert.deepEqual(await registrarSesion(cum, { formId: S1, celebradaEl: hoy, presentes: [P, S], auditorPresente: true }), { quorum: false });
          await assert.rejects(registrarVoto(cum, { formId: randomUUID(), sesionId: S1, propuestaId: propuestaX, integranteId: P, voto: "a_favor" }), /sesion_sin_quorum/);
          // Con quórum: los cuatro titulares. Empate completo: decide el presidente.
          assert.deepEqual(await registrarSesion(cum, { formId: S2, celebradaEl: hoy, presentes: [P, S, I1, I2], auditorPresente: false }), { quorum: true });
          await assert.rejects(registrarVoto(cum, { formId: randomUUID(), sesionId: S2, propuestaId: propuestaVieja, integranteId: P, voto: "a_favor" }), /propuesta_no_vigente/);
          // Una sesión de ayer no vota la propuesta registrada hoy: el dictamen tomaría una fecha anterior a ella (40ª).
          const ayerSesion = randomUUID();
          assert.deepEqual(await registrarSesion(cum, { formId: ayerSesion, celebradaEl: sumarDias(hoy, -1), presentes: [P, S, I1, I2], auditorPresente: false }), { quorum: true });
          await assert.rejects(registrarVoto(cum, { formId: randomUUID(), sesionId: ayerSesion, propuestaId: propuestaX, integranteId: P, voto: "a_favor" }), /propuesta_posterior_a_la_sesion/);
          // La pantalla de la sesión filtra con la fecha de registro en la Ciudad de México.
          assert.equal((await propuestasPorVotar(cum)).find((p) => p.propuestaId === propuestaX)?.registradaEl, hoy);
          const votar = (integranteId: string, voto: string, sesionId = S2, propuestaId = propuestaX) =>
            registrarVoto(cum, { formId: randomUUID(), sesionId, propuestaId, integranteId, voto });
          await votar(S, "a_favor");
          await votar(I1, "en_contra");
          await votar(I2, "en_contra");
          assert.equal((await uno<{ r: string | null }>("select pld_resultado_votacion($1, $2) as r", [S2, propuestaX])).r, null);
          await assert.rejects(votar(I2, "a_favor"), /voto_ya_registrado/);
          await assert.rejects(votar(PS, "a_favor"), /voto_de_ausente/);
          await votar(P, "a_favor");
          assert.equal((await uno<{ r: string }>("select pld_resultado_votacion($1, $2) as r", [S2, propuestaX])).r, "aprobada");

          // El suplente representa a su titular solo cuando éste falta.
          const S3 = randomUUID();
          await registrarSesion(cum, { formId: S3, celebradaEl: hoy, presentes: [PS, S, I1], auditorPresente: false });
          assert.deepEqual(await uno("select quorum, representados, presidente_id from pld_sesiones where id = $1", [S3]), { quorum: true, representados: 3, presidente_id: PS });
          const S4 = randomUUID();
          await registrarSesion(cum, { formId: S4, celebradaEl: hoy, presentes: [P, PS, S, I1], auditorPresente: false });
          await assert.rejects(votar(PS, "a_favor", S4), /suplente_con_titular_presente/);
          await assert.rejects(registrarSesion(cum, { formId: randomUUID(), celebradaEl: hoy, presentes: [P, randomUUID()], auditorPresente: false }), /sesion_presentes_invalidos/);

          // Acta: Lever la genera; la firmada se carga una vez y su descarga deja evento.
          const pdf = await actaEnPdf(cum, S2);
          assert.equal(new TextDecoder().decode(pdf.bytes.slice(0, 5)), "%PDF-");
          const acta = randomUUID();
          await cargarActaFirmada(cum, { formId: acta, sesionId: S2, archivo: { nombre: "acta-firmada.pdf", bytes: PDF } }, { almacen });
          await cargarActaFirmada(cum, { formId: acta, sesionId: S2, archivo: { nombre: "acta-firmada.pdf", bytes: PDF } }, { almacen });
          await assert.rejects(cargarActaFirmada(cum, { formId: randomUUID(), sesionId: S2, archivo: { nombre: "otra.pdf", bytes: PDF } }, { almacen }), /acta_ya_cargada/);
          await descargarActa(aud, acta, { leer: leerDelAlmacen });
          assert.equal(await contar("select count(*)::int as n from audit_log where accion = 'pld_acta_descargada' and identificador = $1", [acta]), 1);
          // r2-serv-N5: la etiqueta dice «PDF, JPG o PNG»: un escaneo en imagen se acepta y guarda el tipo de sus bytes.
          const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
          const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
          await assert.rejects(cargarActaFirmada(cum, { formId: randomUUID(), sesionId: S4, archivo: { nombre: "acta.gif", bytes: Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]) } }, { almacen }), /archivo_no_admitido/);
          for (const [sesion, nombre, bytes, tipo] of [[S4, "acta-escaneada.png", PNG, "image/png"], [S1, "acta-escaneada.jpg", JPG, "image/jpeg"]] as const) {
            const id = randomUUID();
            await cargarActaFirmada(cum, { formId: id, sesionId: sesion, archivo: { nombre, bytes } }, { almacen });
            assert.equal((await uno<{ tipo: string }>("select tipo_contenido as tipo from pld_actas where id = $1", [id])).tipo, tipo);
            const bajada = await descargarActa(aud, id, { leer: leerDelAlmacen });
            assert.deepEqual({ tipo: bajada.tipo, nombre: bajada.nombre, bytes: [...bajada.bytes] }, { tipo, nombre, bytes: [...bytes] });
          }
          // r2-base-N2 (60ª): el acta nombra cada caso votado, su empresa y los votos. Si la sesión votó el caso
          // confidencial, la persona excluida no la descarga ni ve su renglón, su huella o su evento.
          await registrarPropuesta(cum, { casoId: casoConfidencial, formId: randomUUID(), propuesta: "reportar_interna", justificacion: "Instrucción de borrar un expediente" });
          const propuestaConfidencial = String((await uno("select id from pld_propuestas where caso_id = $1", [casoConfidencial])).id);
          for (const quien of [PS, S, I1]) await votar(quien, "a_favor", S3, propuestaConfidencial);
          // r2-fix-N1 (60ª): para CUM2 la sesión que votó el caso oculto no existe. No genera su acta (saldría «No se
          // votaron casos») ni la sube como firmada antes que Cumplimiento: recibe lo mismo que con una sesión inexistente.
          const actaDeCum2 = (sesionId: string) =>
            cargarActaFirmada(cum2, { formId: randomUUID(), sesionId, archivo: { nombre: "acta-sin-el-caso.pdf", bytes: PDF } }, { almacen });
          for (const sesion of [S3, randomUUID()]) {
            await assert.rejects(actaEnPdf(cum2, sesion), /sesion_no_existe/);
            await assert.rejects(actaDeCum2(sesion), /sesion_no_existe/);
          }
          await assert.rejects(sofipo(CUM2, (c) => c.query(
            "insert into pld_actas (id, sesion_id, operator_id, nombre_archivo, tipo_contenido, tamano_bytes, sha256, clave_blob, registrado_por) values ($1, $2, $3, 'a.pdf', 'application/pdf', 1, $4, 'x', $5)",
            [randomUUID(), S3, operador, "0".repeat(64), CUM2],
          )), /sesion_no_existe/);
          assert.equal(await contar("select count(*)::int as n from pld_actas where sesion_id = $1", [S3]), 0);
          // Cumplimiento sí la ve: el acta que genera menciona el caso y la sube completa.
          assert.match(Buffer.from((await actaEnPdf(cum, S3)).bytes).toString("latin1"), /interna preocupante/);
          const actaConfidencial = randomUUID();
          await cargarActaFirmada(cum, { formId: actaConfidencial, sesionId: S3, archivo: { nombre: "acta-firmada.pdf", bytes: PDF } }, { almacen });
          // Con el acta ya cargada, CUM2 tampoco lo sabe: sesion_no_existe, no acta_ya_cargada.
          await assert.rejects(actaDeCum2(S3), /sesion_no_existe/);
          // No vota en ella; y el acta firmada cierra la sesión (48ª): lo que falte va en una sesión nueva.
          await assert.rejects(registrarVoto(cum2, { formId: randomUUID(), sesionId: S3, propuestaId: propuestaX, integranteId: S, voto: "a_favor" }), /sesion_no_existe/);
          await assert.rejects(votar(PS, "en_contra", S3), /sesion_con_acta/);
          await assert.rejects(descargarActa(cum2, actaConfidencial, { leer: leerDelAlmacen }), /documento_no_existe/);
          await descargarActa(cum, actaConfidencial, { leer: leerDelAlmacen });
          await descargarActa(cum2, acta, { leer: leerDelAlmacen });
          const verActa = (userId: string) => sofipo(userId, async (c) => ({
            acta: Number((await c.query("select count(*)::int as n from pld_actas where id = $1", [actaConfidencial])).rows[0].n),
            eventos: Number((await c.query("select count(*)::int as n from audit_log where entidad = 'pld_actas' and identificador = $1", [actaConfidencial])).rows[0].n),
          }));
          assert.deepEqual(await verActa(CUM2), { acta: 0, eventos: 0 });
          assert.deepEqual(await verActa(CUM), { acta: 1, eventos: 2 });
          // r2-fix-N1: ni la sesión ni su evento.
          assert.equal((await leerComite(cum2)).sesiones.find((s) => s.id === S3), undefined);
          assert.ok((await leerComite(cum)).sesiones.find((s) => s.id === S3));
          const eventosDeLaSesion = (userId: string) => sofipo(userId, async (c) =>
            Number((await c.query("select count(*)::int as n from audit_log where identificador = $1", [S3])).rows[0].n));
          assert.equal(await eventosDeLaSesion(CUM2), 0);
          assert.ok((await eventosDeLaSesion(CUM)) >= 1);
          assert.equal((await leerComite(cum)).sesiones.find((s) => s.id === S3)?.acta?.id, actaConfidencial);
          // Tampoco por la función del plazo: ni la persona excluida ni otro operador lo obtienen con el id.
          const plazo = (userId: string, op = operador) => sofipo(userId, async (c) => (await c.query("select pld_caso_vence($1)::text as d", [casoConfidencial])).rows[0].d as string | null, op);
          assert.ok(await plazo(CUM));
          assert.equal(await plazo(CUM2), null);
          assert.equal(await plazo(AJENA, otroOperador), null);

          // Dictamen por Comité: el resultado es la propuesta aprobada y la fecha la de la sesión (40ª).
          await assert.rejects(dictaminarCaso(cum, { superficie: "sofipo", segundoFactor: { metodo: "totp", en: new Date(Date.now() - 3_600_000) } }, {
            formId: randomUUID(), casoId: casoX, via: "comite", sesionId: S2, propuestaId: propuestaX, resultado: "", justificacion: "Votación del Comité",
          }), /reautenticacion_requerida/);
          await assert.rejects(dictaminarCaso(cum, SESION_SOFIPO, {
            formId: randomUUID(), casoId: casoX, via: "comite", sesionId: S1, propuestaId: propuestaX, resultado: "", justificacion: "Votación del Comité",
          }), /sesion_sin_quorum/);
          const dictamenX = randomUUID();
          assert.deepEqual(await dictaminarCaso(cum, SESION_SOFIPO, {
            formId: dictamenX, casoId: casoX, via: "comite", sesionId: S2, propuestaId: propuestaX, resultado: "", justificacion: "Votación del Comité",
          }), { fueraDePlazo: false });
          const esperado = (await uno<{ d: string }>("select pld_sumar_dias_habiles($1::date, 3)::text as d", [hoy])).d;
          assert.deepEqual(await uno("select resultado, dictaminado_el::text as el, reporte_vence_el::text as reporte, fuera_de_plazo from pld_dictamenes where id = $1", [dictamenX]),
            { resultado: "reportar_inusual", el: hoy, reporte: esperado, fuera_de_plazo: false });
          // Dictaminado, el caso ya no cambia.
          await assert.rejects(registrarPropuesta(cum, { casoId: casoX, formId: randomUUID(), propuesta: "no_reportar", justificacion: "Cambio tardío de opinión" }), /caso_ya_dictaminado/);
          await assert.rejects(votar(I1, "a_favor", ayerSesion), /caso_ya_dictaminado/);

          // Reporte: el acuse del SITI, inmutable y uno por caso; tipo 2 = Inusual.
          const recibido = haceMinutos(5);
          // El acuse no puede ser anterior al dictamen (la sesión de hoy).
          await assert.rejects(registrarReportePld(cum, { formId: randomUUID(), casoId: casoX, folio: "UIF-2026-0000", periodo: hoy.replaceAll("-", ""), recibidoEn: `${sumarDias(hoy, -1)}T10:00`, registros: "1" }), /acuse_antes_del_dictamen/);
          await assert.rejects(registrarReportePld(cum, { formId: randomUUID(), casoId: casoX, folio: "UIF-2026\ufeff0001", periodo: hoy.replaceAll("-", ""), recibidoEn: recibido, registros: "1" }), /invisible_folio/);
          assert.deepEqual(await registrarReportePld(cum, { formId: randomUUID(), casoId: casoX, folio: "UIF-2026-0001", periodo: hoy.replaceAll("-", ""), recibidoEn: recibido, registros: "1" }), { fueraDePlazo: false });
          await assert.rejects(registrarReportePld(cum, { formId: randomUUID(), casoId: casoX, folio: "UIF-2026-0002", periodo: hoy.replaceAll("-", ""), recibidoEn: recibido, registros: "1" }), /reporte_pld_ya_registrado/);
          assert.equal((await uno<{ tipo_reporte: string }>("select tipo_reporte from pld_reportes where caso_id = $1", [casoX])).tipo_reporte, "2");

          // Sustitución: la baja y el alta van juntas y se comunican en la 49ª; el sustituido deja de contar para el quórum.
          const I3 = randomUUID();
          await registrarIntegrantes(cum, { integrantes: [integrante(I3, "INTEGRANTE", "TITULAR", "Inés", { designadoEl: hoy })], sustituye: { integranteId: I2, sustituidoEl: hoy, motivo: "Renuncia del integrante" } });
          assert.deepEqual((await dueno.query("select id from pld_comite_vigentes($1, $2::date) where titularidad = 'TITULAR' order by id", [operador, hoy])).rows.map((r) => String(r.id)).sort(), [P, S, I1, I3].sort());
          await registrarComunicacion(cum, { formId: randomUUID(), folio: "SITI-0004", recibidoEn: haceMinutos(1), integrantes: [I3], bajas: [I2] });
          await assert.rejects(registrarSesion(cum, { formId: randomUUID(), celebradaEl: hoy, presentes: [P, S, I2], auditorPresente: false }), /sesion_presentes_invalidos/);
        });

        await t.test("modo Oficial (47ª, último párrafo), dictamen fuera de plazo y reporte de 24 horas (44ª)", async () => {
          const aviso = async (descripcion: string) => {
            const acuse = await emitirAviso(apr, { formId: randomUUID(), tipo: "posible_inusual", companyId: beta, mencionada: "", superior: "", descripcion });
            const alerta = String((await uno("select id from pld_alertas where aviso_id = $1", [acuse.id])).id);
            return abrirCaso(cum, { formId: randomUUID(), alertaId: alerta });
          };
          const casoY = await aviso("Cambio de proveedor principal sin explicación.");
          const casoZ = await aviso("Alerta que se atendió tarde, fuera de los sesenta días.");
          const casoW = await aviso("Información de recursos posiblemente ilícitos.");

          // Cambiar quién dictamina es una decisión: con el factor de hace 31 minutos, la base ni se toca.
          const factorViejo = { superficie: "sofipo" as const, segundoFactor: { metodo: "totp" as const, en: new Date(Date.now() - 31 * 60_000) } };
          await assert.rejects(cambiarModoDictamen(cum, factorViejo, { formId: randomUUID(), modo: "oficial", oficialId: CUM, motivo: "Menos de 25 personas al servicio" }), /reautenticacion_requerida/);
          await assert.rejects(cambiarModoDictamen(cum, SESION_SOFIPO, { formId: randomUUID(), modo: "oficial", oficialId: AUD, motivo: "Menos de 25 personas al servicio" }), /oficial_sin_rol_de_cumplimiento/);
          await cambiarModoDictamen(cum, SESION_SOFIPO, { formId: randomUUID(), modo: "oficial", oficialId: CUM, motivo: "Menos de 25 personas al servicio" });
          await assert.rejects(registrarSesion(cum, { formId: randomUUID(), celebradaEl: hoy, presentes: [P, S, I1], auditorPresente: false }), /modo_oficial_sin_sesiones/);
          await registrarPropuesta(cum, { casoId: casoY, formId: randomUUID(), propuesta: "no_reportar", justificacion: "El cliente explicó el cambio con contrato" });
          const propuestaY = String((await uno("select id from pld_propuestas where caso_id = $1", [casoY])).id);
          await assert.rejects(dictaminarCaso(cum, SESION_SOFIPO, {
            formId: randomUUID(), casoId: casoY, via: "comite", sesionId: S2, propuestaId: propuestaY, resultado: "", justificacion: "Votación del Comité",
          }), /dictamen_en_otro_modo/);
          const oficial = (caso: string, resultado: string, quien: ContextoDePersonal = cum) =>
            dictaminarCaso(quien, SESION_SOFIPO, { formId: randomUUID(), casoId: caso, via: "oficial", sesionId: "", propuestaId: "", resultado, justificacion: "Dictamen del Oficial de Cumplimiento" });
          await assert.rejects(oficial(casoY, "no_reportar", cum2), /solo_el_oficial_dictamina/);
          assert.deepEqual(await oficial(casoY, "no_reportar"), { fueraDePlazo: false });
          await assert.rejects(registrarReportePld(cum, { formId: randomUUID(), casoId: casoY, folio: "UIF-X", periodo: "20261108", recibidoEn: `${sumarDias(hoy, -1)}T10:00`, registros: "1" }), /reporte_sin_dictamen_de_reportar/);
          assert.equal((await uno<{ reporte_vence_el: string | null }>("select reporte_vence_el from pld_dictamenes where caso_id = $1", [casoY])).reporte_vence_el, null);

          // 40ª: la alerta tiene 61 días (se simula el paso del tiempo). El dictamen se registra marcado.
          await dueno.query("alter table pld_alertas disable trigger pld_alertas_inmutable");
          await dueno.query("update pld_alertas set creada_en = now() - interval '61 days' where id in (select alerta_id from pld_caso_alertas where caso_id = $1)", [casoZ]);
          await dueno.query("alter table pld_alertas enable trigger pld_alertas_inmutable");
          const leidoZ = await leerCaso(cum, casoZ);
          assert.equal(leidoZ?.fueraDePlazo, true);
          assert.deepEqual(await oficial(casoZ, "reportar_interna"), { fueraDePlazo: true });
          const ayer = `${sumarDias(hoy, -1)}T10:00`;
          // El acuse de ayer es anterior al dictamen de hoy: la base lo rechaza. El de hoy a las 00:00 entra a tiempo.
          await assert.rejects(registrarReportePld(cum, { formId: randomUUID(), casoId: casoZ, folio: "UIF-Z", periodo: hoy.replaceAll("-", ""), recibidoEn: ayer, registros: "1" }), /acuse_antes_del_dictamen/);
          assert.deepEqual(await registrarReportePld(cum, { formId: randomUUID(), casoId: casoZ, folio: "UIF-Z", periodo: hoy.replaceAll("-", ""), recibidoEn: `${hoy}T00:00`, registros: "1" }), { fueraDePlazo: false });
          assert.equal((await uno<{ tipo_reporte: string }>("select tipo_reporte from pld_reportes where caso_id = $1", [casoZ])).tipo_reporte, "3");

          // 44ª: con la marca de 24 horas, el plazo es de 24 horas desde que se conoce; se simulan 30 (venció hace 6).
          await marcarVeinticuatroHoras(cum, { casoId: casoW, motivo: "Hay información de recursos ilícitos" });
          await marcarVeinticuatroHoras(cum, { casoId: casoW, motivo: "Hay información de recursos ilícitos" });
          await dueno.query("alter table pld_casos_24h disable trigger pld_casos_24h_inmutable");
          await dueno.query("update pld_casos_24h set registrado_en = now() - interval '30 hours' where caso_id = $1", [casoW]);
          await dueno.query("alter table pld_casos_24h enable trigger pld_casos_24h_inmutable");
          assert.deepEqual(await oficial(casoW, "reportar_inusual"), { fueraDePlazo: true });
          const w = await uno<{ vence_en: Date; reporte_vence_en: Date; reporte_vence_el: string | null }>("select vence_en, reporte_vence_en, reporte_vence_el from pld_dictamenes where caso_id = $1", [casoW]);
          assert.equal(w.reporte_vence_en.getTime(), w.vence_en.getTime());
          assert.equal(w.reporte_vence_el, null);
          assert.deepEqual(await registrarReportePld(cum, { formId: randomUUID(), casoId: casoW, folio: "UIF-W", periodo: hoy.replaceAll("-", ""), recibidoEn: haceMinutos(60), registros: "1" }), { fueraDePlazo: true });
          await assert.rejects(marcarVeinticuatroHoras(cum, { casoId: casoY, motivo: "Marca después del dictamen" }), /caso_ya_dictaminado/);
          // De vuelta al Comité.
          await cambiarModoDictamen(cum, SESION_SOFIPO, { formId: randomUUID(), modo: "comite", oficialId: "", motivo: "Ya son más de 25 personas" });
        });

        await t.test("sesión con fecha atrasada (r2-base-N6): el dictamen registrado tarde queda marcado; los meses sin sesión se listan", async () => {
          const acuse = await emitirAviso(apr, { formId: randomUUID(), tipo: "posible_inusual", companyId: beta, mencionada: "", superior: "", descripcion: "Depósitos fraccionados al cierre del mes." });
          const alerta = String((await uno("select id from pld_alertas where aviso_id = $1", [acuse.id])).id);
          const casoV = await abrirCaso(cum, { formId: randomUUID(), alertaId: alerta });
          await registrarPropuesta(cum, { casoId: casoV, formId: randomUUID(), propuesta: "reportar_inusual", justificacion: "Depósitos sin soporte documental" });
          const propuestaV = String((await uno("select id from pld_propuestas where caso_id = $1", [casoV])).id);
          // La alerta tiene 61 días (venció ayer) y la propuesta 30; se simula el paso del tiempo como en el README.
          await dueno.query("alter table pld_alertas disable trigger pld_alertas_inmutable");
          await dueno.query("update pld_alertas set creada_en = now() - interval '61 days' where id = $1", [alerta]);
          await dueno.query("alter table pld_alertas enable trigger pld_alertas_inmutable");
          await dueno.query("alter table pld_propuestas disable trigger pld_propuestas_inmutable");
          await dueno.query("update pld_propuestas set registrado_en = now() - interval '30 days' where id = $1", [propuestaV]);
          await dueno.query("alter table pld_propuestas enable trigger pld_propuestas_inmutable");
          // Hoy se registra una sesión «celebrada» hace 18 días, antes del vencimiento, y sus votos.
          const atrasada = randomUUID();
          assert.deepEqual(await registrarSesion(cum, { formId: atrasada, celebradaEl: sumarDias(hoy, -18), presentes: [P, S, I1], auditorPresente: false }), { quorum: true });
          for (const quien of [P, S, I1]) await registrarVoto(cum, { formId: randomUUID(), sesionId: atrasada, propuestaId: propuestaV, integranteId: quien, voto: "a_favor" });
          assert.deepEqual(await dictaminarCaso(cum, SESION_SOFIPO, {
            formId: randomUUID(), casoId: casoV, via: "comite", sesionId: atrasada, propuestaId: propuestaV, resultado: "", justificacion: "Votación del Comité",
          }), { fueraDePlazo: true });
          // La fecha de la sesión sigue mandando para el dictamen y los 3 días hábiles del reporte.
          const d = await uno<{ el: string; vence: string; fuera: boolean; reporte: string }>(
            "select dictaminado_el::text as el, vence_el::text as vence, fuera_de_plazo as fuera, reporte_vence_el::text as reporte from pld_dictamenes where caso_id = $1", [casoV],
          );
          assert.equal(d.el, sumarDias(hoy, -18));
          assert.ok(d.el <= d.vence, "la fecha de la sesión es anterior al vencimiento");
          assert.equal(d.fuera, true);
          assert.equal(d.reporte, (await uno<{ r: string }>("select pld_sumar_dias_habiles($1::date, 3)::text as r", [d.el])).r);

          // Nota del N6: un mes cerrado sin sesión con quórum queda a la vista, en el Comité y en la bandeja.
          const [anio, mes] = hoy.split("-").map(Number) as [number, number];
          const mesMas = (k: number) => new Date(Date.UTC(anio, mes - 1 + k, 15, 18)).toISOString().slice(0, 7);
          const enDosMeses = new Date(`${mesMas(2)}-15T18:00:00Z`);
          assert.deepEqual((await leerComite(cum, { ahora: enDosMeses })).mesesSinSesion, [mesMas(1)]);
          assert.deepEqual((await leerBandejaPld(cum, { ahora: enDosMeses })).mesesSinSesion, [mesMas(1)]);
          assert.deepEqual((await leerComite(cum)).mesesSinSesion, []);
        });

        await t.test("carrera (r2-base-N9): lo que llega a un caso mientras se dictamina espera y ve el dictamen", async () => {
          const casoDe = async (descripcion: string) => {
            const acuse = await emitirAviso(apr, { formId: randomUUID(), tipo: "posible_inusual", companyId: beta, mencionada: "", superior: "", descripcion });
            const alerta = String((await uno("select id from pld_alertas where aviso_id = $1", [acuse.id])).id);
            return { alerta, caso: await abrirCaso(cum, { formId: randomUUID(), alertaId: alerta }) };
          };
          const { caso } = await casoDe("Transferencias a un tercero sin relación aparente.");
          const acuseB = await emitirAviso(apr, { formId: randomUUID(), tipo: "posible_inusual", companyId: beta, mencionada: "", superior: "", descripcion: "El mismo tercero recibe pagos de otra cuenta." });
          const alertaB = String((await uno("select id from pld_alertas where aviso_id = $1", [acuseB.id])).id);
          await registrarPropuesta(cum, { casoId: caso, formId: randomUUID(), propuesta: "no_reportar", justificacion: "El cliente acreditó la relación comercial" });
          const propuesta = String((await uno("select id from pld_propuestas where caso_id = $1", [caso])).id);
          const sesion = randomUUID();
          await registrarSesion(cum, { formId: sesion, celebradaEl: hoy, presentes: [P, S, I1], auditorPresente: false });
          for (const quien of [P, S]) await registrarVoto(cum, { formId: randomUUID(), sesionId: sesion, propuestaId: propuesta, integranteId: quien, voto: "a_favor" });

          const a = new pg.Client({ connectionString: urlDuena });
          const b = [0, 1, 2].map(() => new pg.Client({ connectionString: urlDuena }));
          await a.connect();
          for (const c of b) await c.connect();
          const esperar = (ms: number) => new Promise((listo) => setTimeout(listo, ms));
          const resultado = (promesa: Promise<unknown>) => promesa.then(() => "aceptado", (error: Error) => error.message);
          try {
            // A dictamina y no confirma todavía; mientras, llegan una alerta de la serie, una propuesta nueva y un voto.
            await a.query("begin");
            await a.query(
              `insert into pld_dictamenes (id, caso_id, operator_id, resultado, justificacion, via, sesion_id, propuesta_id, registrado_por)
               values ($1, $2, $3, 'no_reportar', 'Votación del Comité', 'comite', $4, $5, $6)`,
              [randomUUID(), caso, operador, sesion, propuesta, CUM],
            );
            for (const c of b) await c.query("begin");
            const pendientes = [
              resultado(b[0]!.query("insert into pld_caso_alertas (caso_id, alerta_id, operator_id, registrado_por) values ($1, $2, $3, $4)", [caso, alertaB, operador, CUM2])),
              resultado(b[1]!.query(
                "insert into pld_propuestas (id, caso_id, operator_id, propuesta, justificacion, registrado_por) values ($1, $2, $3, 'reportar_inusual', 'Cambio de opinión tardío', $4)",
                [randomUUID(), caso, operador, CUM2],
              )),
              resultado(b[2]!.query(
                "insert into pld_votos (id, sesion_id, caso_id, propuesta_id, integrante_id, voto, operator_id, registrado_por) values ($1, $2, $3, $4, $5, 'en_contra', $6, $7)",
                [randomUUID(), sesion, caso, propuesta, I1, operador, CUM2],
              )),
            ];
            await esperar(300);
            await a.query("commit");
            assert.deepEqual(await Promise.all(pendientes), ["caso_ya_dictaminado", "caso_ya_dictaminado", "caso_ya_dictaminado"]);
          } finally {
            for (const c of b) await c.query("rollback").catch(() => undefined);
            await a.end();
            for (const c of b) await c.end();
          }
          // La alerta B sigue sin caso: la bandeja la muestra para analizarla.
          assert.equal(await contar("select count(*)::int as n from pld_caso_alertas where alerta_id = $1", [alertaB]), 0);
          assert.ok((await listarAlertasPld(cum)).some((x) => x.id === alertaB));
        });

        await t.test("días hábiles: los dos instrumentos de 2026 con criterio conservador y «falta el calendario» en 2027", async () => {
          assert.deepEqual(await uno(`select
              pld_sumar_dias_habiles('2026-10-30', 3)::text as tras_30_oct,
              pld_sumar_dias_habiles('2026-11-13', 3)::text as tras_13_nov,
              pld_dia_habil_del_mes('2026-01-01', 10)::text as enero,
              pld_dia_habil_del_mes('2026-10-01', 10)::text as octubre,
              pld_sumar_dias_habiles(pld_ultimo_dia_habil('2026-10-01'), 15)::text as la_38_de_octubre,
              pld_dia_inhabil('2026-11-16') as revolucion, pld_dia_inhabil('2026-12-25') as navidad, pld_dia_inhabil('2026-05-05') as cinco_de_mayo,
              pld_dias_habiles_entre('2026-11-09', '2026-11-18') as entre,
              pld_calendario_cargado(2026) as c2026, pld_calendario_cargado(2027) as c2027`),
          {
            tras_30_oct: "2026-11-05", tras_13_nov: "2026-11-19", enero: "2026-01-15", octubre: "2026-10-14", la_38_de_octubre: "2026-11-24",
            revolucion: true, navidad: false, cinco_de_mayo: false, entre: 6, c2026: true, c2027: false,
          });
          // r2-base-N13: el conteo no depende del huso de la sesión (con fechas por timestamptz, Santiago daba 251 y 20).
          for (const huso of ["UTC", "America/Mexico_City", "America/Santiago", "America/Havana", "Pacific/Apia", "Asia/Singapore"]) {
            await dueno.query(`set timezone to '${huso}'`);
            assert.deepEqual(await uno("select pld_dias_habiles_entre('2025-12-31', '2026-12-31') as anio, pld_dias_habiles_entre('2026-08-31', '2026-09-30') as septiembre"),
              { anio: 252, septiembre: 21 }, huso);
          }
          await dueno.query("reset timezone");
          // r2-base-N12: con un tope, como pld_sumar_dias_habiles; y solo el personal las ejecuta.
          await assert.rejects(dueno.query("select pld_dias_habiles_entre('2026-01-01', '3026-01-01')"), /pld_dias_habiles_invalidos/);
          for (const funcion of [
            "pld_dia_inhabil('2026-11-02')", "pld_calendario_cargado(2026)", "pld_sumar_dias_habiles('2026-11-02', 3)",
            "pld_dia_habil_del_mes('2026-11-01', 3)", "pld_ultimo_dia_habil('2026-11-01')", "pld_dias_habiles_entre('2026-11-01', '2026-11-30')",
          ]) {
            await assert.rejects(como(urlApp, "plataforma_cliente", { userId: LUIS, companyId: beta }, (c) => c.query(`select ${funcion}`)), /permission denied for function/, funcion);
          }
          const enero2027 = await leerPeriodicos(cum, { ahora: new Date("2027-01-20T18:00:00Z") });
          assert.ok(enero2027.some((p) => p.faltaCalendario === 2027));
          const hoyMismo = await leerPeriodicos(cum);
          assert.equal(hoyMismo.length, 4);
        });

        await t.test("periódicos: 36ª de 41 columnas con clave CASFIM, 38ª en ceros y el catálogo de tipos de operación", async () => {
          // Si alguien agrega un tipo de operación (efectivo o internacional) esta prueba truena: hay que revisar la 36ª, 37ª y 38ª.
          assert.deepEqual([...TIPOS_DE_OPERACION], ["pago_proveedor", "nomina"]);
          assert.deepEqual([...TIPOS_EN_EFECTIVO], []);
          assert.deepEqual([...TIPOS_INTERNACIONALES], []);
          assert.equal((await uno<{ d: string }>("select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'pld_operaciones_tipo'")).d,
            "CHECK ((tipo = ANY (ARRAY['pago_proveedor'::text, 'nomina'::text])))");

          await assert.rejects(archivoRelevantes(cum, "202609"), /falta_clave_entidad/);
          await assert.rejects(registrarEntidad(cum, { formId: randomUUID(), claveCasfim: "12-345", claveOrganoSupervisor: "001002" }), /dato_invalido/);
          await registrarEntidad(cum, { formId: randomUUID(), claveCasfim: "012345", claveOrganoSupervisor: "001002" });
          const archivo = await archivoRelevantes(cum, "202609");
          assert.ok(archivo.texto.endsWith("\r\n"));
          assert.equal(archivo.texto.slice(0, -2).split(";").length - 1, COLUMNAS);
          assert.equal(archivo.texto, archivo.texto.toUpperCase());
          await assert.rejects(archivoRelevantes(cum, "202610"), /periodo_invalido/);
          const recibido = `${sumarDias(hoy, -1)}T09:30`;
          await assert.rejects(registrarPeriodico(cum, { formId: randomUUID(), reporte: "36", periodo: "202609", folio: "SITI-R\u200e0001", recibidoEn: recibido, registros: "1" }), /invisible_folio/);
          // Un periodo se reporta ya cerrado, y su acuse es posterior al cierre.
          await assert.rejects(registrarPeriodico(cum, { formId: randomUUID(), reporte: "38", periodo: hoy.slice(0, 7).replace("-", ""), folio: "", recibidoEn: "", registros: "" }), /periodo_sin_cerrar/);
          await assert.rejects(registrarPeriodico(cum, { formId: randomUUID(), reporte: "36", periodo: "202606", folio: "SITI-R-0000", recibidoEn: "2026-06-30T10:00", registros: "1" }), /acuse_antes_del_cierre/);
          await registrarPeriodico(cum, { formId: randomUUID(), reporte: "36", periodo: "202609", folio: "SITI-R-0001", recibidoEn: recibido, registros: "1" });
          await assert.rejects(registrarPeriodico(cum, { formId: randomUUID(), reporte: "36", periodo: "202609", folio: "SITI-R-0002", recibidoEn: recibido, registros: "1" }), /periodico_ya_registrado/);
          assert.equal((await uno<{ archivo_sha256: string }>("select archivo_sha256 from pld_periodicos where reporte = '36' and periodo = '202609'")).archivo_sha256, archivo.sha256);
          const constancia = await constanciaInternacionales(cum, "202610");
          assert.match(constancia.texto, /CONSTANCIA INTERNA/);
          await registrarPeriodico(cum, { formId: randomUUID(), reporte: "38", periodo: "202610", folio: "", recibidoEn: "", registros: "" });
          assert.deepEqual(await uno("select folio, recibido_en, registros from pld_periodicos where reporte = '38' and periodo = '202610'"), { folio: null, recibido_en: null, registros: 0 });
          await assert.rejects(registrarPeriodico(ori, { formId: randomUUID(), reporte: "38", periodo: "202609", folio: "", recibidoEn: "", registros: "" }), /sin_permiso_operacion/);
          // La base repite las reglas: la 36ª solo cierra trimestre y la 38ª no lleva folio.
          const periodicoSql = (reporte: string, periodo: string, folio: string | null) => sofipo(CUM, async (c) => {
            const id = randomUUID();
            await eventoPersonal(c, CUM, "pld_periodico_registrado", "pld_periodicos", id);
            await c.query(
              `insert into pld_periodicos (id, operator_id, reporte, periodo, archivo_sha256, registros, folio, recibido_en, registrado_por)
               values ($1, $2, $3, $4, repeat('a', 64), 0, $5, case when $5::text is null then null else now() - interval '1 hour' end, $6)`,
              [id, operador, reporte, periodo, folio, CUM],
            );
          });
          await assert.rejects(periodicoSql("36", "202610", "F-1"), /pld_periodicos_periodo/);
          await assert.rejects(periodicoSql("38", "202608", "F-1"), /pld_periodicos_acuse/);
          // 72ª-1: la clave de acceso al SITI no tiene dónde guardarse.
          assert.equal(await contar("select count(*)::int as n from information_schema.columns where table_name like 'pld\\_%' and (column_name like '%contrasena%' or column_name like '%password%' or column_name like '%clave_acceso%' or column_name like '%siti%')"), 0);
        });

        await t.test("parámetros versionados: los cambia Cumplimiento con motivo; la fila inicial queda", async () => {
          const iniciales = await leerParametros(aud);
          assert.equal(iniciales.numero, 0);
          await assert.rejects(cambiarParametros(aud, SESION_SOFIPO, {
            formId: randomUUID(), atipicoK: "4", atipicoHistorialMinimo: "10", fraccionN: "3", fraccionVentanaDias: "7", fraccionUmbral: "100,000.00",
            nominaPersonasPct: "25", factorGradoAlto: "0.8", motivo: "Ajuste del Manual de Cumplimiento",
          }), /sin_permiso_operacion/);
          // Cambiar los parámetros es una decisión: con el factor de hace 31 minutos se rechaza.
          await assert.rejects(cambiarParametros(cum, { superficie: "sofipo", segundoFactor: { metodo: "totp", en: new Date(Date.now() - 31 * 60_000) } }, {
            formId: randomUUID(), atipicoK: "4", atipicoHistorialMinimo: "10", fraccionN: "3", fraccionVentanaDias: "7", fraccionUmbral: "100,000.00",
            nominaPersonasPct: "25", factorGradoAlto: "0.8", motivo: "Ajuste del Manual de Cumplimiento",
          }), /reautenticacion_requerida/);
          await cambiarParametros(cum, SESION_SOFIPO, {
            formId: randomUUID(), atipicoK: "4", atipicoHistorialMinimo: "10", fraccionN: "3", fraccionVentanaDias: "7", fraccionUmbral: "100,000.00",
            nominaPersonasPct: "25", factorGradoAlto: "0.8", motivo: "Ajuste del Manual de Cumplimiento",
          });
          assert.deepEqual(await uno("select numero, atipico_k::text as k from pld_parametros_vigentes($1)", [operador]), { numero: 1, k: "4.00" });
          assert.deepEqual(await uno("select numero, atipico_k::text as k from pld_parametros_vigentes($1)", [otroOperador]), { numero: 0, k: "3.00" });
          await assert.rejects(dueno.query("update pld_parametros set atipico_k = 9 where operator_id is null"), /pld_registro_inmutable/);
        });

        await t.test("conservación (61ª): ni la app ni la dueña borran ni truncan operaciones ni nada de PLD", async () => {
          const operaciones = ["supplier_payment_requests", "supplier_payment_request_history", "payroll_batches", "payroll_batch_items", "postings", "expected_collections"];
          for (const tabla of operaciones) {
            const disparadores = (await dueno.query(
              `select t.tgname from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgrelid = $1::regclass and p.proname = 'conservacion_no_se_borra' order by 1`,
              [tabla],
            )).rows.map((r) => String(r.tgname));
            assert.deepEqual(disparadores, [`${tabla}_conservacion`, `${tabla}_conservacion_truncate`]);
            await assert.rejects(dueno.query(`truncate ${tabla} cascade`), /conservacion_no_se_borra/);
            const filas = await contar(`select count(*)::int as n from ${tabla}`);
            if (filas > 0) await assert.rejects(dueno.query(`delete from ${tabla}`), /conservacion_no_se_borra|pago_proveedor_no_se_borra/);
            for (const rol of ["plataforma_sofipo", "plataforma_cliente"] as const) {
              await assert.rejects(como(urlApp, rol, { userId: rol === "plataforma_sofipo" ? CUM : LUIS, operadorId: operador, companyId: beta }, (c) => c.query(`delete from ${tabla}`)), /permission denied/);
            }
          }
          assert.ok(await contar("select count(*)::int as n from supplier_payment_requests") > 0);
          assert.ok(await contar("select count(*)::int as n from payroll_batch_items") > 0);

          const tablasPld = (await dueno.query("select tablename from pg_tables where schemaname = 'public' and tablename like 'pld\\_%' order by 1")).rows.map((r) => String(r.tablename));
          assert.equal(tablasPld.length, 29);
          for (const tabla of tablasPld) {
            await assert.rejects(dueno.query(`truncate ${tabla} cascade`), /conservacion_no_se_borra/);
            if (await contar(`select count(*)::int as n from ${tabla}`) > 0) {
              await assert.rejects(dueno.query(`delete from ${tabla}`), /conservacion_no_se_borra/);
              const columna = (await uno<{ c: string }>("select column_name as c from information_schema.columns where table_name = $1 and is_generated = 'NEVER' order by ordinal_position limit 1", [tabla])).c;
              await assert.rejects(dueno.query(`update ${tabla} set ${columna} = ${columna}`), /pld_registro_inmutable/);
            }
            const seguridad = await uno<{ rls: boolean; forzada: boolean }>("select relrowsecurity as rls, relforcerowsecurity as forzada from pg_class where oid = $1::regclass", [tabla]);
            assert.deepEqual(seguridad, { rls: true, forzada: true }, tabla);
          }
        });

        await t.test("RLS cruzada: cada rol y cada operador leen solo lo suyo", async () => {
          const conteos = (userId: string, op = operador) => sofipo(userId, async (c) => {
            const n = async (tabla: string) => Number((await c.query(`select count(*)::int as n from ${tabla}`)).rows[0].n);
            return { perfiles: await n("pld_perfiles"), alertas: await n("pld_alertas"), avisos: await n("pld_avisos"), casos: await n("pld_casos"), comite: await n("pld_comite_integrantes"), operaciones: await n("pld_operaciones") };
          }, op);
          const cumplimiento = await conteos(CUM);
          assert.ok(cumplimiento.perfiles > 0 && cumplimiento.alertas > 0 && cumplimiento.avisos > 0 && cumplimiento.casos > 0 && cumplimiento.comite > 0 && cumplimiento.operaciones > 0);
          assert.deepEqual(await conteos(AUD), cumplimiento);
          const excluida = await conteos(CUM2);
          // El confidencial, su aviso hermano y el aviso contra CUM2 (r2-base-N3), con sus dos casos.
          assert.equal(excluida.avisos, cumplimiento.avisos - 3);
          assert.equal(excluida.casos, cumplimiento.casos - 2);
          assert.equal(excluida.alertas, cumplimiento.alertas - 3);
          assert.deepEqual(await conteos(ORI), { perfiles: cumplimiento.perfiles, alertas: 0, avisos: 1, casos: 0, comite: 0, operaciones: 0 });
          assert.deepEqual(await conteos(APR), { perfiles: cumplimiento.perfiles, alertas: 0, avisos: await contar("select count(*)::int as n from pld_avisos where registrado_por = $1", [APR]), casos: 0, comite: 0, operaciones: 0 });
          assert.deepEqual(await conteos(ADM), { perfiles: 0, alertas: 0, avisos: 0, casos: 0, comite: 0, operaciones: 0 });
          assert.deepEqual(await conteos(AJENA, otroOperador), { perfiles: 0, alertas: 0, avisos: 0, casos: 0, comite: 0, operaciones: 0 });
          // El portal no tiene permiso sobre ninguna tabla de PLD.
          for (const tabla of ["pld_operaciones", "pld_avisos", "pld_casos", "pld_dictamenes", "pld_reportes", "pld_parametros"]) {
            await assert.rejects(como(urlApp, "plataforma_cliente", { userId: LUIS, companyId: beta }, (c) => c.query(`select 1 from ${tabla} limit 1`)), /permission denied/);
          }
          // Otro operador no escribe en el primero aunque conozca los ids.
          await assert.rejects(sofipo(AJENA, async (c) => {
            const id = randomUUID();
            await eventoPersonal(c, AJENA, "pld_nota_agregada", "pld_notas", id, beta);
            await c.query("insert into pld_notas (id, caso_id, operator_id, texto, registrado_por) values ($1, $2, $3, 'Nota ajena', $4)", [id, casoX, otroOperador, AJENA]);
          }, otroOperador), /row-level security|sin_rol_para_analizar/);
        });

        await t.test("manifiesto de conservación: conteos y huellas en streaming, con su evento por página", async () => {
          const desde = sumarDias(hoy, -365);
          const lineas: Array<Record<string, unknown>> = [];
          for await (const linea of manifiestoDeConservacion(aud, { companyId: beta, desde, hasta: hoy, pagina: 1, cursor: null })) {
            assert.ok(linea.endsWith("\n"));
            lineas.push(JSON.parse(linea) as Record<string, unknown>);
          }
          assert.equal(lineas[0]?.manifiesto, "conservacion-61a");
          const conteos = new Map(lineas.filter((l) => "tabla" in l).map((l) => [String(l.tabla), Number(l.filas)]));
          assert.equal(conteos.get("pld_operaciones"), 3);
          assert.ok((conteos.get("supplier_payment_requests") ?? 0) >= 1);
          assert.ok(lineas.some((l) => l.origen === "pld_documentos" && l.sha256 === createHash("sha256").update(PDF).digest("hex")));
          assert.deepEqual(lineas.at(-1), { fin_de_pagina: 1, documentos: lineas.filter((l) => "documento" in l).length, siguiente: null });
          assert.equal(await contar("select count(*)::int as n from audit_log where accion = 'pld_manifiesto_descargado' and company_id = $1 and actor_id = $2", [beta, AUD]), 1);
          // r2-base-N3: cada conteo de la persona excluida es el que su RLS le deja ver; no deduce el caso por la diferencia.
          const conteosDe = async (ctx: ContextoDePersonal) => {
            const mapa = new Map<string, number>();
            for await (const linea of manifiestoDeConservacion(ctx, { companyId: beta, desde, hasta: hoy, pagina: 1, cursor: null })) {
              const l = JSON.parse(linea) as Record<string, unknown>;
              if ("tabla" in l) mapa.set(String(l.tabla), Number(l.filas));
            }
            return mapa;
          };
          // r2-base-N16: el nombre de un archivo es texto libre; en el manifiesto no abre como fórmula.
          await cargarDocumentoPld(cum, { casoId: casoX, formId: randomUUID(), archivo: { nombre: "=HIPERVINCULO(1).pdf", bytes: PDF } }, { almacen });
          const nombres: string[] = [];
          for await (const linea of manifiestoDeConservacion(cum, { companyId: beta, desde, hasta: hoy, pagina: 1, cursor: null })) {
            const l = JSON.parse(linea) as Record<string, unknown>;
            if (typeof l.nombre === "string") nombres.push(l.nombre);
          }
          assert.ok(nombres.includes(" =HIPERVINCULO(1).pdf"), JSON.stringify(nombres));
          const deCum2 = await conteosDe(cum2);
          const tablasConExclusion = ["pld_alertas", "pld_avisos", "pld_casos", "pld_notas", "pld_documentos", "pld_propuestas", "pld_dictamenes", "pld_reportes", "audit_log"];
          for (const tabla of tablasConExclusion.filter((t) => deCum2.has(t))) {
            const visibles = await sofipo(CUM2, async (c) => Number((await c.query(`select count(*)::int as n from ${tabla} where company_id = $1`, [beta])).rows[0].n));
            assert.equal(deCum2.get(tabla), visibles, tabla);
          }
          const deCum = await conteosDe(cum);
          assert.ok(deCum2.get("pld_alertas")! < deCum.get("pld_alertas")!);
          assert.ok(deCum2.get("pld_casos")! < deCum.get("pld_casos")!);
          // r2-serv-N3: igual para Auditoría, que sí descarga el manifiesto. Un aviso la menciona, Cumplimiento abre su
          // caso y le agrega una nota: el manifiesto de AUD no cambia (es lo que su RLS le deja ver) y el de Cumplimiento sí.
          const audAntes = await conteosDe(aud);
          const contraAud = await emitirAviso(ori, {
            formId: randomUUID(), tipo: "posible_interna_preocupante", companyId: beta, mencionada: AUD, superior: "",
            descripcion: "El auditor pidió copia del expediente sin una revisión programada.",
          });
          const casoContraAud = await abrirCaso(cum, { formId: randomUUID(), alertaId: String((await uno("select id from pld_alertas where aviso_id = $1", [contraAud.id])).id) });
          await agregarNota(cum, { casoId: casoContraAud, formId: randomUUID(), texto: "Se revisan los accesos del auditor al expediente." });
          const audDespues = await conteosDe(aud);
          for (const tabla of tablasConExclusion.filter((t) => audDespues.has(t))) {
            const visibles = await sofipo(AUD, async (c) => Number((await c.query(`select count(*)::int as n from ${tabla} where company_id = $1`, [beta])).rows[0].n));
            assert.equal(audDespues.get(tabla), visibles, `AUD ${tabla}`);
            // audit_log sí sube: la descarga del manifiesto de AUD es su propio evento.
            if (tabla !== "audit_log") assert.equal(audDespues.get(tabla), audAntes.get(tabla), `AUD no ve el caso nuevo en ${tabla}`);
          }
          assert.equal(audDespues.get("audit_log"), audAntes.get("audit_log")! + 1, "AUD solo ve su propia descarga");
          const deCumDespues = await conteosDe(cum);
          assert.equal(deCumDespues.get("pld_alertas"), deCum.get("pld_alertas")! + 1);
          assert.equal(deCumDespues.get("pld_casos"), deCum.get("pld_casos")! + 1);
          assert.equal(deCumDespues.get("pld_notas"), deCum.get("pld_notas")! + 1);
          await assert.rejects(async () => {
            for await (const _ of manifiestoDeConservacion(ori, { companyId: beta, desde, hasta: hoy, pagina: 1, cursor: null })) void _;
          }, /sin_permiso_operacion/);
          await assert.rejects(async () => {
            for await (const _ of manifiestoDeConservacion(ajena, { companyId: beta, desde, hasta: hoy, pagina: 1, cursor: null })) void _;
          }, /cliente_ausente/);
        });

        await t.test("sesión oculta (r2-fix-N1): la regla mensual (47ª) la cuenta aunque la persona excluida no la vea", async () => {
          const acuse = await emitirAviso(apr, { formId: randomUUID(), tipo: "posible_interna_preocupante", companyId: beta, mencionada: CUM2, superior: "", descripcion: "La analista pidió adelantar una sesión sin motivo." });
          const casoOculto = await abrirCaso(cum, { formId: randomUUID(), alertaId: String((await uno("select id from pld_alertas where aviso_id = $1", [acuse.id])).id) });
          await registrarPropuesta(cum, { casoId: casoOculto, formId: randomUUID(), propuesta: "no_reportar", justificacion: "Sin elementos para reportar" });
          const propuesta = String((await uno("select id from pld_propuestas where caso_id = $1", [casoOculto])).id);
          // La única sesión del mes siguiente vota el caso oculto. La registra la dueña: la aplicación no acepta fechas futuras.
          const [anio, mes] = hoy.split("-").map(Number) as [number, number];
          const mesMas = (k: number) => new Date(Date.UTC(anio, mes - 1 + k, 15, 18)).toISOString().slice(0, 7);
          const oculta = randomUUID();
          await dueno.query("insert into pld_sesiones (id, operator_id, celebrada_el, presentes, registrado_por) values ($1, $2, $3, $4::uuid[], $5)", [
            oculta, operador, `${mesMas(1)}-15`, [P, S, I1], CUM,
          ]);
          for (const quien of [P, S, I1]) {
            await dueno.query(
              "insert into pld_votos (id, operator_id, sesion_id, caso_id, propuesta_id, integrante_id, voto, registrado_por) values ($1, $2, $3, $4, $5, $6, 'a_favor', $7)",
              [randomUUID(), operador, oculta, casoOculto, propuesta, quien, CUM],
            );
          }
          assert.equal((await uno<{ q: boolean }>("select quorum as q from pld_sesiones where id = $1", [oculta])).q, true);
          assert.equal((await leerComite(cum2)).sesiones.some((s) => s.id === oculta), false);
          assert.equal((await leerComite(cum)).sesiones.some((s) => s.id === oculta), true);
          const enElMes = { ahora: new Date(`${mesMas(1)}-20T18:00:00Z`) };
          const enDosMeses = { ahora: new Date(`${mesMas(2)}-15T18:00:00Z`) };
          for (const [quien, ctx] of [["CUM", cum], ["CUM2", cum2]] as const) {
            assert.equal((await leerComite(ctx, enElMes)).sesionDelMes, true, quien);
            assert.equal((await leerBandejaPld(ctx, enElMes)).sesionDelMesPendiente, false, quien);
            assert.deepEqual((await leerComite(ctx, enDosMeses)).mesesSinSesion, [], quien);
            assert.deepEqual((await leerBandejaPld(ctx, enDosMeses)).mesesSinSesion, [], quien);
          }
        });

        await t.test("personal (r2-fix-N2): ningún cambio deja un aviso abierto sin quien lo analice; con candado común contra el aviso", async () => {
          const sinAnalista = /aviso_sin_analista/;
          const tieneRol = async (userId: string) =>
            contar("select count(*)::int as n from platform_staff_roles where operator_id = $1 and user_id = $2 and rol = 'cumplimiento'", [operador, userId]);
          const estado = async (userId: string) =>
            (await uno<{ e: string }>("select estado as e from platform_staff where operator_id = $1 and user_id = $2", [operador, userId])).e;
          const quitarRol = (userId: string) => cambiarRolPersonal(adm, SESION_SOFIPO, { userId, rol: "cumplimiento", quitar: true });
          const darRol = (userId: string) => cambiarRolPersonal(adm, SESION_SOFIPO, { userId, rol: "cumplimiento", quitar: false });
          const alertaDe = async (avisoId: string) => String((await uno("select id from pld_alertas where aviso_id = $1", [avisoId])).id);
          const enTransaccion = async (sentencias: Array<[string, unknown[]]>) => {
            const c = new pg.Client({ connectionString: urlDuena });
            await c.connect();
            try {
              await c.query("begin");
              for (const [sql, params] of sentencias) await c.query(sql, params);
              await c.query("commit");
            } catch (error) {
              await c.query("rollback").catch(() => undefined);
              throw error;
            } finally {
              await c.end();
            }
          };

          // Los avisos que excluyen a CUM2 siguen abiertos (sin dictamen): solo CUM los analiza. Ni Administración desde
          // la pantalla de Personal ni la dueña le quitan el rol, la suspenden o la dan de baja; nada cambia.
          await assert.rejects(quitarRol(CUM), sinAnalista);
          await assert.rejects(dueno.query("update platform_staff set estado = 'suspendido' where operator_id = $1 and user_id = $2", [operador, CUM]), sinAnalista);
          await assert.rejects(enTransaccion([
            ["delete from platform_staff_roles where operator_id = $1 and user_id = $2", [operador, CUM]],
            ["delete from platform_staff where operator_id = $1 and user_id = $2", [operador, CUM]],
          ]), sinAnalista);
          assert.equal(await tieneRol(CUM), 1);
          assert.equal(await estado(CUM), "activo");
          assert.equal(await contar("select count(*)::int as n from audit_log where accion = 'rol_personal_retirado' and identificador = $1", [CUM]), 0);

          // Abierto hasta el acuse: un aviso que excluye a CUM depende de CUM2 mientras su caso no tiene dictamen y
          // mientras el dictamen «reportar» no tiene acuse del SITI.
          const contraCum = await emitirAviso(apr, { formId: randomUUID(), tipo: "posible_interna_preocupante", companyId: beta, mencionada: CUM, superior: "", descripcion: "La oficial pidió no reportar a un cliente." });
          await assert.rejects(quitarRol(CUM2), sinAnalista);
          const casoContraCum = await abrirCaso(cum2, { formId: randomUUID(), alertaId: await alertaDe(contraCum.id) });
          await registrarPropuesta(cum2, { casoId: casoContraCum, formId: randomUUID(), propuesta: "reportar_inusual", justificacion: "Instrucción de no reportar sin motivo" });
          const propuesta = String((await uno("select id from pld_propuestas where caso_id = $1", [casoContraCum])).id);
          const sesion = randomUUID();
          await registrarSesion(cum2, { formId: sesion, celebradaEl: hoy, presentes: [P, S, I1], auditorPresente: false });
          for (const quien of [P, S, I1]) await registrarVoto(cum2, { formId: randomUUID(), sesionId: sesion, propuestaId: propuesta, integranteId: quien, voto: "a_favor" });
          await dictaminarCaso(cum2, SESION_SOFIPO, { formId: randomUUID(), casoId: casoContraCum, via: "comite", sesionId: sesion, propuestaId: propuesta, resultado: "", justificacion: "Votación del Comité" });
          await assert.rejects(quitarRol(CUM2), sinAnalista);
          await registrarReportePld(cum2, { formId: randomUUID(), casoId: casoContraCum, folio: "UIF-2026-0101", periodo: hoy.replaceAll("-", ""), recibidoEn: haceMinutos(2), registros: "1" });
          await quitarRol(CUM2);
          assert.equal(await tieneRol(CUM2), 0);
          await darRol(CUM2);

          // Carrera 1: la suspensión de CUM2 sin confirmar y un aviso que excluye a CUM. El aviso confirma primero (CUM2
          // seguía activa); al confirmar, la suspensión toma el candado, ve el aviso y se rechaza.
          const a = new pg.Client({ connectionString: urlDuena });
          await a.connect();
          try {
            await a.query("begin");
            await a.query("update platform_staff set estado = 'suspendido' where operator_id = $1 and user_id = $2", [operador, CUM2]);
            await emitirAviso(apr, { formId: randomUUID(), tipo: "posible_interna_preocupante", companyId: beta, mencionada: CUM, superior: "", descripcion: "La oficial pidió borrar una alerta." });
            await assert.rejects(a.query("commit"), sinAnalista);
          } finally {
            await a.end();
          }
          assert.equal(await estado(CUM2), "activo");

          // Quien da de alta a otra persona de Cumplimiento y le quita el rol a la anterior en la misma transacción, sí.
          await enTransaccion([
            ["insert into users (id, nombre, correo) values ($1, 'Celia Cumplimiento', $2)", [CUM3, `${CUM3}@ejemplo.mx`]],
            ["insert into platform_staff (operator_id, user_id, estado) values ($1, $2, 'activo')", [operador, CUM3]],
            ["insert into platform_staff_roles (operator_id, user_id, rol) values ($1, $2, 'cumplimiento')", [operador, CUM3]],
            ["delete from platform_staff_roles where operator_id = $1 and user_id = $2 and rol = 'cumplimiento'", [operador, CUM]],
          ]);
          assert.equal(await tieneRol(CUM), 0);
          await darRol(CUM);
          const cum3 = personal(operador, CUM3, ["cumplimiento"]);

          // Las otras dos carreras: la suspensión ya revisó y tiene el candado (SET CONSTRAINTS … IMMEDIATE); lo que
          // llega después espera, ve la suspensión al confirmarse y se rechaza.
          const esperaElCandado = async (pendiente: Promise<unknown>) => {
            let termino = false;
            pendiente.then(() => (termino = true), () => (termino = true));
            for (let i = 0; i < 100 && !termino; i++) {
              if ((await contar("select count(*)::int as n from pg_locks where locktype = 'advisory' and not granted")) > 0) return true;
              await new Promise((listo) => setTimeout(listo, 50));
            }
            return false;
          };
          const suspendidaConCandado = async (userId: string, despues: () => Promise<unknown>, rechazo: RegExp) => {
            const b = new pg.Client({ connectionString: urlDuena });
            await b.connect();
            try {
              await b.query("begin");
              await b.query("update platform_staff set estado = 'suspendido' where operator_id = $1 and user_id = $2", [operador, userId]);
              await b.query("set constraints pld_personal_suspendido_deja_analista immediate");
              const pendiente = despues();
              const espero = await esperaElCandado(pendiente);
              await b.query("commit");
              await assert.rejects(pendiente, rechazo);
              assert.equal(espero, true, "lo que llega después espera el candado");
            } finally {
              await b.end();
            }
          };
          // Carrera 2: CUM2 suspendida contra un aviso que excluye a CUM y a CUM3.
          const avisoTarde = randomUUID();
          await suspendidaConCandado(CUM2, () => emitirAviso(apr, {
            formId: avisoTarde, tipo: "posible_interna_preocupante", companyId: beta, mencionada: CUM, superior: CUM3, descripcion: "La oficial y su jefa pidieron borrar una alerta.",
          }), /aviso_sin_cumplimiento/);
          assert.equal(await contar("select count(*)::int as n from pld_avisos where id = $1", [avisoTarde]), 0);
          await dueno.query("update platform_staff set estado = 'activo' where operator_id = $1 and user_id = $2", [operador, CUM2]);

          // Carrera 3: sumar a un caso la alerta de otro aviso junta sus exclusiones. El caso de un aviso que excluye a
          // CUM2 más la alerta de uno que excluye a CUM solo lo analiza CUM3; si la suspenden mientras suma, no se suma.
          const contraCum2 = await emitirAviso(apr, { formId: randomUUID(), tipo: "posible_interna_preocupante", companyId: beta, mencionada: CUM2, superior: "", descripcion: "La analista pidió cerrar un caso sin revisar." });
          const casoDeCum3 = await abrirCaso(cum3, { formId: randomUUID(), alertaId: await alertaDe(contraCum2.id) });
          const otroContraCum = await emitirAviso(apr, { formId: randomUUID(), tipo: "posible_interna_preocupante", companyId: beta, mencionada: CUM, superior: "", descripcion: "La oficial pidió cambiar un dictamen." });
          const alertaContraCum = await alertaDe(otroContraCum.id);
          await suspendidaConCandado(CUM3, () => sumarAlertaAlCaso(cum3, { casoId: casoDeCum3, alertaId: alertaContraCum }), sinAnalista);
          assert.equal(await contar("select count(*)::int as n from pld_caso_alertas where alerta_id = $1", [alertaContraCum]), 0);
          assert.equal(await estado(CUM3), "suspendido");
        });
      } finally {
        await cerrarConexion();
        await dueno.end();
      }
    });
  });
});

/** Una transacción con el rol de la aplicación y su contexto, como la abre src/nucleo/db.ts, sin traducir errores. */
async function como<T>(
  url: string,
  rol: "plataforma_sofipo" | "plataforma_cliente",
  ids: { userId: string; operadorId?: string; companyId?: string },
  fn: (c: pg.Client) => Promise<T>,
): Promise<T> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query("begin");
    await c.query(`set local role ${rol}`);
    await c.query(
      "select set_config('app.company_id', $1, true), set_config('app.user_id', $2, true), set_config('app.operator_id', $3, true)",
      [ids.companyId ?? "", ids.userId, rol === "plataforma_sofipo" ? ids.operadorId ?? "" : ""],
    );
    const resultado = await fn(c);
    await c.query("commit");
    return resultado;
  } catch (error) {
    await c.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await c.end();
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

/** El portal de Beta: Luis pide y Rosa autoriza (la base pide dos liberadores), con un proveedor y su CLABE. */
async function sembrarPortal(
  dueno: pg.Client, companyId: string, operadorId: string,
  ids: { proveedor: string; copia: string } = { proveedor: PROVEEDOR, copia: COPIA_69B },
): Promise<void> {
  await dueno.query("begin");
  try {
    for (const [id, roles] of [[LUIS, ["administrador", "liberador"]], [ROSA, ["liberador"]]] as const) {
      await dueno.query("insert into memberships (user_id, company_id, estado) values ($1, $2, 'activa')", [id, companyId]);
      for (const rol of roles) {
        await dueno.query(
          `insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, cambio)
           values ($1, $2, 'miembro', $3, 'cliente', 'asignar_rol', 'membership_roles', $4, $5)`,
          [operadorId, companyId, LUIS, id, JSON.stringify({ rol })],
        );
        await dueno.query("insert into membership_roles (user_id, company_id, rol) values ($1, $2, $3)", [id, companyId, rol]);
      }
    }
    await dueno.query("insert into lista_69b_snapshots (id, operator_id, fecha_archivo, cargado_en) values ($1, $2, current_date - 1, now())", [ids.copia, operadorId]);
    await dueno.query(
      "insert into audit_log (operator_id, actor_tipo, superficie, accion, entidad, identificador) values ($1, 'sistema', 'sistema', 'cargar_lista_69b', 'lista_69b_snapshots', $2)",
      [operadorId, ids.copia],
    );
    await dueno.query("insert into lista_69b_rows (snapshot_id, rfc, situacion) values ($1, 'PAL7202161U0', 'Presunto')", [ids.copia]);
    const documento = randomUUID();
    const clabeId = randomUUID();
    await dueno.query(
      "insert into documents (id, company_id, clave_blob, hash_sha256, tipo, nombre_original, creado_en) values ($1, $2, $3, $4, 'application/pdf', 'constancia.pdf', now())",
      [documento, companyId, `constancias/${ids.proveedor}`, "a".repeat(64)],
    );
    await dueno.query(
      `insert into suppliers (id, company_id, document_id, snapshot_id, rfc, razon_social, lista_fecha, lista_leida_en, boton_pago, alta_en)
       values ($1, $2, $3, $4, 'LIM101010AB2', 'Proveedor Limpio SA', current_date - 1, now(), true, now())`,
      [ids.proveedor, companyId, documento, ids.copia],
    );
    await dueno.query(
      "insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador) values ($1, $2, 'miembro', $3, 'cliente', 'alta_proveedor', 'suppliers', $4)",
      [operadorId, companyId, LUIS, ids.proveedor],
    );
    await dueno.query(
      "insert into supplier_clabes (id, company_id, supplier_id, clabe, digito_valido, vigente_desde) values ($1, $2, $3, $4, true, now() - interval '1 day')",
      [clabeId, companyId, ids.proveedor, CLABE],
    );
    await dueno.query(
      "insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador) values ($1, $2, 'miembro', $3, 'cliente', 'clabe_proveedor', 'supplier_clabes', $4)",
      [operadorId, companyId, LUIS, clabeId],
    );
    await dueno.query("commit");
  } catch (error) {
    await dueno.query("rollback");
    throw error;
  }
}

/** Un lote de nómina de una persona preparado por Luis, con su evento: el registro de PLD corre al cerrar la transacción. */
async function sembrarLoteNomina(dueno: pg.Client, companyId: string, operadorId: string, centavos: number): Promise<string> {
  const centro = randomUUID();
  const persona = randomUUID();
  const lote = randomUUID();
  await dueno.query("begin");
  try {
    await dueno.query("select set_config('app.user_id', $1, true), set_config('app.company_id', $2, true)", [LUIS, companyId]);
    await dueno.query(
      `insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador)
       values ($1, $2, 'miembro', $3, 'cliente', 'alta_centro_costo', 'cost_centers', $4),
              ($1, $2, 'miembro', $3, 'cliente', 'alta_persona', 'employees', $5),
              ($1, $2, 'miembro', $3, 'cliente', 'preparar_nomina', 'payroll_batches', $6)`,
      [operadorId, companyId, LUIS, centro, persona, lote],
    );
    await dueno.query("insert into cost_centers (id, company_id, nombre) values ($1, $2, 'Operación')", [centro, companyId]);
    await dueno.query(
      "insert into employees (id, company_id, cost_center_id, nombre, alta_en, clabe, clabe_digito_valido) values ($1, $2, $3, 'Marta Ruiz', current_date - 60, $4, true)",
      [persona, companyId, centro, CLABE],
    );
    await dueno.query(
      "insert into employee_payroll_clabes (id, company_id, employee_id, clabe, digito_valido, vigente_desde, registrada_por) values ($1, $2, $3, $4, true, now() - interval '60 days', $5)",
      [randomUUID(), companyId, persona, CLABE, LUIS],
    );
    await dueno.query(
      "insert into payroll_batches (id, company_id, fecha_pago, total_centavos, preparada_por) values ($1, $2, current_date + 3, $3, $4)",
      [lote, companyId, centavos, LUIS],
    );
    await dueno.query(
      `insert into payroll_batch_items (id, company_id, batch_id, employee_id, nombre_snapshot, neto_centavos, destino, clabe_snapshot, destino_estado)
       values ($1, $2, $3, $4, 'Marta Ruiz', $5, 'clabe', $6, 'listo')`,
      [randomUUID(), companyId, lote, persona, centavos, CLABE],
    );
    // Antes de cerrar la transacción el lote todavía no es una operación.
    assert.equal(Number((await dueno.query("select count(*)::int as n from pld_operaciones where origen_id = $1", [lote])).rows[0].n), 0);
    await dueno.query("commit");
    return lote;
  } catch (error) {
    await dueno.query("rollback");
    throw error;
  }
}
