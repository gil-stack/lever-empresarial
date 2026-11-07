import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { hoyEnMexico } from "../../src/dominio/operacion/comisiones.ts";
import { sumarMeses } from "../../src/dominio/operacion/riesgo.ts";
import { capacidadesDe, type RolCliente } from "../../src/nucleo/capacidades.ts";
import type { ContextoDeTenant } from "../../src/nucleo/contexto.ts";
import { cerrarConexion } from "../../src/nucleo/db.ts";
import { decidirActivacion, solicitarActivacion } from "../../src/server/operacion/activaciones.ts";
import { leerCliente, registrarProspecto } from "../../src/server/operacion/clientes.ts";
import { leerBandejaCumplimiento } from "../../src/server/operacion/cumplimiento.ts";
import {
  calificarRiesgoEmpresa,
  crearVersion,
  dictaminarVersion,
  enviarVersion,
  leerExpediente,
  prepararDescargaDocumento,
} from "../../src/server/operacion/expediente.ts";
import { invitarPrimerAdministrador } from "../../src/server/operacion/invitaciones.ts";
import { cargarListaBloqueadas, listarCoincidencias, registrarReporte, resolverCoincidencia } from "../../src/server/operacion/lpb.ts";
import { cambiarRolPersonal } from "../../src/server/operacion/personal.ts";
import { decidirCambioDeSuspension, solicitarCambioDeSuspension } from "../../src/server/operacion/suspensiones.ts";
import { crearPagoProveedor, resolverPagoProveedor } from "../../src/server/pagos-proveedores/servicio.ts";
import { nombrarCentro } from "../../src/server/personas/servicio.ts";
import { cambiarAccesoFinanzas } from "../../src/server/roles/finanzas.ts";
import { aplicarArchivo, conBaseDesechable, exigirBaseDesechable, urlDeAplicacion } from "../aislamiento/postgres.ts";
import {
  almacenEnMemoria,
  armarBorrador,
  DATOS_GENERALES,
  expedienteEnRegla,
  PDF,
  personal,
  SESION_SOFIPO,
  type SocioDePrueba,
} from "./apoyo-alta-regulada.ts";

const urlAdmin = process.env.AISLAMIENTO_DATABASE_URL?.trim() ?? "";

// Personal SOFIPO del operador de la prueba.
const ADM = "a0000000-0000-4000-8000-000000000001";
const ORI = "a0000000-0000-4000-8000-000000000002";
const APR = "a0000000-0000-4000-8000-000000000003";
const CUM = "a0000000-0000-4000-8000-000000000004";
const AUD = "a0000000-0000-4000-8000-000000000005";
const MIXTO = "a0000000-0000-4000-8000-000000000006";
const NUEVO = "a0000000-0000-4000-8000-000000000007";
// Personal de otro operador: no ve nada del primero.
const AJENA = "a0000000-0000-4000-8000-000000000009";
// Personas del portal de Beta.
const LUIS = "b0000000-0000-4000-8000-000000000001";
const ROSA = "b0000000-0000-4000-8000-000000000002";
const PROVEEDOR_LPB = "c0000000-0000-4000-8000-000000000001";
const PROVEEDOR_LIMPIO = "c0000000-0000-4000-8000-000000000002";
const COPIA_69B = "d0000000-0000-4000-8000-000000000001";
const CLABE = "002180701150123452";

const DOS_CAPAS: SocioDePrueba[] = [
  {
    nombre: "Holding Uno SA de CV", tipoPersona: "moral", rfc: "HUN100101AA1", capital: "60", votos: "60",
    hijos: [
      { nombre: "Mario López Paz", tipoPersona: "fisica", rfc: "LOPM700101AB1", curp: "LOPM700101HDFPZR01", capital: "50", votos: "50" },
      { nombre: "Ana Díaz Mora", tipoPersona: "fisica", rfc: "DIMA720202AB2", curp: "DIMA720202MDFZRN02", capital: "50", votos: "50" },
    ],
  },
  { nombre: "Pedro Ruiz Sol", tipoPersona: "fisica", rfc: "RUSP800303AB3", curp: "RUSP800303HDFZLD03", capital: "40", votos: "40" },
];

describe("alta regulada en Postgres desechable", { skip: urlAdmin.length === 0 }, () => {
  it("roles, expediente, riesgo, LPB, suspensión, candado, RLS y lecturas auditadas", async (t) => {
    exigirBaseDesechable();
    await conBaseDesechable(urlAdmin, async (urlDuena) => {
      const dir = join(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");
      for (const archivo of readdirSync(dir).sort()) if (archivo.endsWith(".sql")) aplicarArchivo(urlDuena, join(dir, archivo));
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
        [AUD, "Aurelio Auditoría", operador, []],
        [MIXTO, "Mario Mixto", operador, ["originacion", "aprobacion"]],
        [NUEVO, "Nora Nueva", operador, []],
        [AJENA, "Alma Ajena", otroOperador, ["auditoria"]],
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
      const aud = personal(operador, AUD, ["auditoria"]);
      const mixto = personal(operador, MIXTO, ["originacion", "aprobacion"]);
      const ajena = personal(otroOperador, AJENA, ["auditoria"]);
      const almacen = almacenEnMemoria();
      const hoy = hoyEnMexico(new Date());
      const sofipo = <T>(userId: string, fn: (c: pg.Client) => Promise<T>, op = operador) =>
        como(urlApp, "plataforma_sofipo", { userId, operadorId: op }, fn);
      const evento = (c: pg.Client, userId: string, accion: string, entidad: string, identificador: string, companyId: string | null = null) =>
        c.query(
          `insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, origen)
           values ($1, $2, 'personal', $3, 'sofipo', $4, $5, $6, 'operacion')`,
          [operador, companyId, userId, accion, entidad, identificador],
        );
      const contar = async (sql: string, params: unknown[] = []) => Number((await dueno.query(sql, params)).rows[0].n);
      const prospecto = (rfc: string, razonSocial: string) =>
        registrarProspecto(ori, { rfc, razonSocial, codigoPostal: "06600", regimen: "601", usoCfdi: "G03" });

      try {
        await t.test("50ª: el auditor no recibe cumplimiento, nadie se da roles y todo cambio deja evento", async () => {
          await cambiarRolPersonal(adm, SESION_SOFIPO, { userId: AUD, rol: "auditoria", quitar: false });
          // Repetir la asignación no duplica ni deja otro evento.
          await cambiarRolPersonal(adm, SESION_SOFIPO, { userId: AUD, rol: "auditoria", quitar: false });
          await assert.rejects(cambiarRolPersonal(adm, SESION_SOFIPO, { userId: AUD, rol: "cumplimiento", quitar: false }), /roles_incompatibles/);
          await assert.rejects(cambiarRolPersonal(adm, SESION_SOFIPO, { userId: ADM, rol: "auditoria", quitar: false }), /rol_propio/);
          await assert.rejects(cambiarRolPersonal(cum, SESION_SOFIPO, { userId: AUD, rol: "originacion", quitar: false }), /sin_permiso_operacion/);
          await assert.rejects(
            cambiarRolPersonal(adm, { superficie: "sofipo", segundoFactor: { metodo: "totp", en: new Date(Date.now() - 3_600_000) } }, {
              userId: NUEVO, rol: "originacion", quitar: false,
            }),
            /reautenticacion_requerida/,
          );
          assert.equal(await contar("select count(*)::int as n from platform_staff_roles where user_id = $1", [AUD]), 1);
          assert.equal(await contar("select count(*)::int as n from audit_log where accion = 'rol_personal_asignado' and identificador = $1", [AUD]), 1);

          // SQL directo: la base repite cada regla aunque alguien se salte el servicio.
          await assert.rejects(sofipo(CUM, async (c) => {
            await evento(c, CUM, "rol_personal_asignado", "platform_staff_roles", NUEVO);
            await c.query("insert into platform_staff_roles (operator_id, user_id, rol) values ($1, $2, 'originacion')", [operador, NUEVO]);
          }), /sin_permiso_roles/);
          await assert.rejects(sofipo(ADM, async (c) => {
            await evento(c, ADM, "rol_personal_asignado", "platform_staff_roles", ADM);
            await c.query("insert into platform_staff_roles (operator_id, user_id, rol) values ($1, $2, 'auditoria')", [operador, ADM]);
          }), /rol_propio/);
          // Sin su evento en la misma transacción, la asignación no se guarda (trigger diferido, corre con el rol del portal).
          await assert.rejects(sofipo(ADM, (c) =>
            c.query("insert into platform_staff_roles (operator_id, user_id, rol) values ($1, $2, 'aprobacion')", [operador, NUEVO]),
          ), /rol_personal_sin_auditoria/);
          await assert.rejects(dueno.query("update platform_staff_roles set rol = 'cumplimiento' where user_id = $1", [AUD]), /rol_personal_no_se_reescribe/);

          // Dos asignaciones incompatibles a la vez: el candado por persona deja pasar una sola.
          const dos = await Promise.allSettled(["cumplimiento", "auditoria"].map((rol) =>
            sofipo(ADM, async (c) => {
              await evento(c, ADM, "rol_personal_asignado", "platform_staff_roles", NUEVO);
              await c.query("insert into platform_staff_roles (operator_id, user_id, rol) values ($1, $2, $3)", [operador, NUEVO, rol]);
            }),
          ));
          assert.deepEqual(dos.map((r) => r.status).sort(), ["fulfilled", "rejected"]);
          assert.match(String((dos.find((r) => r.status === "rejected") as PromiseRejectedResult).reason), /roles_incompatibles/);
          assert.equal(await contar("select count(*)::int as n from platform_staff_roles where user_id = $1", [NUEVO]), 1);

          await cambiarRolPersonal(adm, SESION_SOFIPO, { userId: AUD, rol: "auditoria", quitar: true });
          assert.equal(await contar("select count(*)::int as n from audit_log where accion = 'rol_personal_retirado' and identificador = $1", [AUD]), 1);
          await cambiarRolPersonal(adm, SESION_SOFIPO, { userId: AUD, rol: "auditoria", quitar: false });
        });

        let alfa = "";
        let alfaV1 = "";
        let alfaV2 = "";
        await t.test("expediente: dos capas de socios, propietarios reales calculados, versión inmutable y dictamen", async () => {
          alfa = await prospecto("ALF150301AB1", "Alfa Comercial SA de CV");
          await assert.rejects(registrarProspecto(cum, { rfc: "XXX150301AB1", razonSocial: "X", codigoPostal: "06600", regimen: "601", usoCfdi: "G03" }), /sin_permiso_operacion/);

          // Un borrador incompleto no se envía: la base dice qué falta.
          const gamma = await prospecto("GAM150301AB3", "Gamma Servicios SA de CV");
          const gammaV1 = randomUUID();
          await crearVersion(ori, { companyId: gamma, formId: gammaV1 });
          await assert.rejects(enviarVersion(ori, gammaV1), /expediente_sin_representante/);

          ({ versionId: alfaV1 } = await armarBorrador(ori, { companyId: alfa, razonSocial: "Alfa Comercial SA de CV", rfc: "ALF150301AB1", socios: DOS_CAPAS, almacen }));
          // Cada dato general cae en su columna (la sentencia lista las columnas en el orden de la validación).
          const guardados = (await dueno.query(
            `select razon_social, giro, nacionalidad, rfc, serie_efirma, domicilio_calle, domicilio_exterior, domicilio_interior,
                    domicilio_colonia, domicilio_municipio, domicilio_entidad, domicilio_codigo_postal, domicilio_pais, telefono,
                    correo, fecha_constitucion::text as fecha_constitucion, volumen_mensual_centavos::text as volumen
             from kyb_versiones where id = $1`,
            [alfaV1],
          )).rows[0];
          assert.deepEqual(guardados, {
            razon_social: "Alfa Comercial SA de CV", giro: DATOS_GENERALES.giro, nacionalidad: DATOS_GENERALES.nacionalidad, rfc: "ALF150301AB1",
            serie_efirma: DATOS_GENERALES.serieEfirma, domicilio_calle: DATOS_GENERALES.domicilioCalle, domicilio_exterior: DATOS_GENERALES.domicilioExterior,
            domicilio_interior: null, domicilio_colonia: DATOS_GENERALES.domicilioColonia, domicilio_municipio: DATOS_GENERALES.domicilioMunicipio,
            domicilio_entidad: DATOS_GENERALES.domicilioEntidad, domicilio_codigo_postal: DATOS_GENERALES.domicilioCodigoPostal,
            domicilio_pais: DATOS_GENERALES.domicilioPais, telefono: DATOS_GENERALES.telefono, correo: DATOS_GENERALES.correo,
            fecha_constitucion: DATOS_GENERALES.fechaConstitucion, volumen: "10000000",
          });
          const previa = await leerExpediente(ori, alfa);
          assert.deepEqual(previa?.borrador?.accionistas.map((a) => [a.nombre, a.capa]), [
            ["Holding Uno SA de CV", 1], ["Mario López Paz", 2], ["Ana Díaz Mora", 2], ["Pedro Ruiz Sol", 1],
          ]);
          assert.equal(previa?.borrador?.estructuraCompleta, true);
          assert.equal(previa?.borrador?.documentos.length, 6);
          assert.ok(previa?.borrador?.documentos.every((d) => /^[0-9a-f]{64}$/.test(d.sha256)));

          await enviarVersion(ori, alfaV1);
          await enviarVersion(ori, alfaV1); // el segundo clic no hace nada
          const beneficiarios = (await dueno.query(
            "select nombre, motivo, capas, capital_pct::float8 as capital from kyb_beneficiarios where version_id = $1 order by capital desc, nombre",
            [alfaV1],
          )).rows as Array<{ nombre: string; motivo: string; capas: number; capital: number }>;
          // 25 % o más del capital, directo o a través de la holding (60 % × 50 % = 30 %).
          assert.deepEqual(beneficiarios.map((b) => [b.nombre, b.motivo, b.capas]), [
            ["Pedro Ruiz Sol", "capital", 1], ["Ana Díaz Mora", "capital", 2], ["Mario López Paz", "capital", 2],
          ]);

          await assert.rejects(sofipo(ORI, (c) => c.query("update kyb_versiones set giro = 'Otro giro' where id = $1", [alfaV1])), /expediente_enviado_inmutable/);
          await assert.rejects(sofipo(ORI, async (c) => {
            const id = randomUUID();
            await evento(c, ORI, "expediente_representante_agregado", "kyb_representantes", id, alfa);
            await c.query(
              `insert into kyb_representantes (id, version_id, company_id, operator_id, clave, nombre, cargo, es_administrador, creado_por, creado_en)
               values ($1, $2, $3, $4, $5, 'Otra persona', 'apoderado', false, $6, now())`,
              [id, alfaV1, alfa, operador, randomUUID(), ORI],
            );
          }), /expediente_enviado_inmutable/);
          await assert.rejects(dueno.query("delete from kyb_documentos where company_id = $1", [alfa]), /documento_expediente_inmutable/);
          await assert.rejects(dueno.query("delete from kyb_versiones where id = $1", [alfaV1]), /conservacion_no_se_borra/);
          await assert.rejects(sofipo(ORI, (c) => c.query("delete from kyb_documentos where company_id = $1", [alfa])), /permission denied/);
          await assert.rejects(sofipo(CUM, (c) => c.query("select clave_blob from kyb_documentos")), /permission denied/);

          // Quien envió no dictamina; Cumplimiento observa con motivo y el dictamen no se repite.
          await assert.rejects(dictaminarVersion(ori, SESION_SOFIPO, { versionId: alfaV1, formId: randomUUID(), resultado: "aprobado", motivo: "" }), /sin_permiso_operacion/);
          await assert.rejects(sofipo(ORI, async (c) => {
            const id = randomUUID();
            await evento(c, ORI, "expediente_dictaminado", "kyb_dictamenes", id, alfa);
            await c.query(
              `insert into kyb_dictamenes (id, version_id, company_id, operator_id, resultado, dictaminado_por, dictaminado_en)
               values ($1, $2, $3, $4, 'aprobado', $5, now())`,
              [id, alfaV1, alfa, operador, ORI],
            );
          }), /misma_persona_en_dictamen/);
          await assert.rejects(crearVersion(ori, { companyId: alfa, formId: randomUUID() }), /expediente_en_revision/);
          await assert.rejects(dictaminarVersion(cum, SESION_SOFIPO, { versionId: alfaV1, formId: randomUUID(), resultado: "observado", motivo: "" }), /motivo_invalido/);
          const observado = randomUUID();
          await dictaminarVersion(cum, SESION_SOFIPO, { versionId: alfaV1, formId: observado, resultado: "observado", motivo: "Falta el poder notarial del apoderado" });
          await dictaminarVersion(cum, SESION_SOFIPO, { versionId: alfaV1, formId: observado, resultado: "observado", motivo: "Falta el poder notarial del apoderado" });
          await assert.rejects(dictaminarVersion(cum, SESION_SOFIPO, { versionId: alfaV1, formId: randomUUID(), resultado: "aprobado", motivo: "" }), /dictamen_ya_registrado/);

          // La versión nueva hereda socios, representantes y documentos; se envía y se aprueba.
          alfaV2 = randomUUID();
          await crearVersion(ori, { companyId: alfa, formId: alfaV2 });
          const borrador = (await leerExpediente(ori, alfa))?.borrador;
          assert.equal(borrador?.numero, 2);
          assert.equal(borrador?.accionistas.length, 4);
          assert.equal(borrador?.representantes.length, 1);
          assert.equal(borrador?.documentos.length, 6);
          await enviarVersion(ori, alfaV2);
          await dictaminarVersion(cum, SESION_SOFIPO, { versionId: alfaV2, formId: randomUUID(), resultado: "aprobado", motivo: "" });
          const leido = await leerExpediente(aud, alfa);
          assert.equal(leido?.vigente?.numero, 2);
          assert.equal(leido?.vigente?.dictamen?.resultado, "aprobado");
          assert.deepEqual(leido?.versiones.map((v) => [v.numero, v.resultado]), [[2, "aprobado"], [1, "observado"]]);
          assert.equal(await contar("select count(*)::int as n from kyb_beneficiarios where version_id = $1", [alfaV2]), 3);
        });

        await t.test("grado de riesgo: seis meses de vigencia y revisión vencida calculada al leer", async () => {
          await assert.rejects(calificarRiesgoEmpresa(ori, { companyId: alfa, formId: randomUUID(), actividad: "baja", zona: "baja" }), /sin_permiso_operacion/);
          const calificacion = await calificarRiesgoEmpresa(cum, { companyId: alfa, formId: randomUUID(), actividad: "baja", zona: "baja" });
          // Dos capas de socios suman un punto: grado bajo.
          assert.deepEqual(calificacion, { grado: "bajo", puntaje: 1 });
          const fila = (await dueno.query(
            "select tipo, revisar_antes_de::text as revisar, version_id from kyb_calificaciones_riesgo where company_id = $1",
            [alfa],
          )).rows[0] as { tipo: string; revisar: string; version_id: string };
          assert.deepEqual(fila, { tipo: "alta", revisar: sumarMeses(hoy, 6), version_id: alfaV2 });

          const enBandeja = async (ahora: Date) =>
            (await leerBandejaCumplimiento(cum, { ahora })).revisiones.find((r) => r.companyId === alfa)?.vencida;
          assert.equal(await enBandeja(new Date()), false);
          const despues = new Date(`${sumarMeses(hoy, 6)}T18:00:00Z`);
          despues.setUTCDate(despues.getUTCDate() + 1);
          assert.equal(await enBandeja(despues), true);
          await assert.rejects(leerBandejaCumplimiento(ori), /sin_permiso_operacion/);
          assert.ok(await leerBandejaCumplimiento(aud));

          await assert.rejects(sofipo(CUM, async (c) => {
            const id = randomUUID();
            await evento(c, CUM, "riesgo_calificado", "kyb_calificaciones_riesgo", id, alfa);
            await c.query(
              `insert into kyb_calificaciones_riesgo (id, operator_id, company_id, version_id, tipo, factores, puntaje, grado,
                 pep_extranjera, coincidencia_exacta, calificada_por, calificada_el, calificada_en, revisar_antes_de)
               values ($1, $2, $3, $4, 'alta', '{}', 1, 'bajo', false, false, $5, $6::date - 1, now(), ($6::date - 1 + interval '6 months')::date)`,
              [id, operador, alfa, alfaV2, CUM, hoy],
            );
          }), /calificacion_fecha_invalida/);
          await assert.rejects(dueno.query("update kyb_calificaciones_riesgo set grado = 'medio' where company_id = $1", [alfa]), /calificacion_inmutable/);
        });

        await t.test("candado de activación: la base rechaza cada faltante", async () => {
          const gamma = String((await dueno.query("select id from companies where rfc = 'GAM150301AB3'")).rows[0].id);
          await assert.rejects(solicitarActivacion(cum, gamma), /sin_permiso_operacion/);
          const solicitudGamma = await solicitarActivacion(ori, gamma);
          await assert.rejects(decidirActivacion(apr, SESION_SOFIPO, { id: solicitudGamma, aprobada: true }), /activacion_sin_expediente_aprobado/);
          await assert.rejects(decidirActivacion(ori, SESION_SOFIPO, { id: solicitudGamma, aprobada: true }), /sin_permiso_operacion/);
          await assert.rejects(sofipo(APR, (c) => c.query("update companies set estado = 'activa' where id = $1", [gamma])), /activacion_sin_expediente_aprobado/);
          await assert.rejects(dueno.query("update companies set estado = 'activa' where id = $1", [gamma]), /activacion_sin_expediente_aprobado/);

          // Expediente aprobado sin grado de riesgo; luego grado medio sin estructura corporativa.
          const delta = await prospecto("DEL150301AB4", "Delta Industrial SA de CV");
          const { versionId: deltaV1 } = await armarBorrador(ori, { companyId: delta, razonSocial: "Delta Industrial SA de CV", rfc: "DEL150301AB4", almacen });
          await enviarVersion(ori, deltaV1);
          await dictaminarVersion(cum, SESION_SOFIPO, { versionId: deltaV1, formId: randomUUID(), resultado: "aprobado", motivo: "" });
          const solicitudDelta = await solicitarActivacion(ori, delta);
          await assert.rejects(decidirActivacion(apr, SESION_SOFIPO, { id: solicitudDelta, aprobada: true }), /activacion_sin_riesgo_vigente/);
          assert.deepEqual(await calificarRiesgoEmpresa(cum, { companyId: delta, formId: randomUUID(), actividad: "alta", zona: "media" }), { grado: "medio", puntaje: 6 });
          await assert.rejects(decidirActivacion(apr, SESION_SOFIPO, { id: solicitudDelta, aprobada: true }), /activacion_sin_estructura_corporativa/);

          // Un documento que vence después del dictamen también frena (se simula el paso del tiempo).
          const solicitudAlfa = await solicitarActivacion(ori, alfa);
          await dueno.query("alter table kyb_documentos disable trigger user");
          await dueno.query("update kyb_documentos set vigente_hasta = $2::date - 1 where company_id = $1 and tipo = 'identificacion_representante'", [alfa, hoy]);
          await dueno.query("alter table kyb_documentos enable trigger user");
          await assert.rejects(decidirActivacion(apr, SESION_SOFIPO, { id: solicitudAlfa, aprobada: true }), /activacion_con_documento_vencido/);
          await dueno.query("alter table kyb_documentos disable trigger user");
          await dueno.query("update kyb_documentos set vigente_hasta = '2031-12-31' where company_id = $1 and tipo = 'identificacion_representante'", [alfa]);
          await dueno.query("alter table kyb_documentos enable trigger user");

          await assert.rejects(decidirActivacion(ori, SESION_SOFIPO, { id: solicitudAlfa, aprobada: true }), /sin_permiso_operacion/);
          await decidirActivacion(apr, SESION_SOFIPO, { id: solicitudAlfa, aprobada: true });
          assert.equal((await leerCliente(ori, alfa))?.estado, "activa");
        });

        let marioId = "";
        await t.test("LPB: carga versionada, posible por nombre y propietario real exacto que suspende con plazo de 24 h", async () => {
          const csv = [
            "nombre,rfc,curp,tipo,fecha",
            "Mario López Paz,,LOPM700101HDFPZR01,fisica,2026-11-01",
            "PEDRO RUIZ SOL,,,fisica,2026-11-01",
            "Proveedor Bloqueado SA,PBL101010AB1,,moral,2026-11-01",
          ].join("\n");
          await assert.rejects(cargarListaBloqueadas(ori, { formId: randomUUID(), nombreArchivo: "lpb.csv", texto: csv }), /sin_permiso_operacion/);
          await assert.rejects(cargarListaBloqueadas(cum, { formId: randomUUID(), nombreArchivo: "lpb.csv", texto: "nombre;rfc\nx;y" }), /lpb_encabezado_invalido/);
          const formId = randomUUID();
          const carga = await cargarListaBloqueadas(cum, { formId, nombreArchivo: "lpb.csv", texto: csv });
          assert.equal(carga.filas, 3);
          assert.deepEqual(await cargarListaBloqueadas(cum, { formId, nombreArchivo: "lpb.csv", texto: csv }), carga);
          await assert.rejects(cargarListaBloqueadas(cum, { formId: randomUUID(), nombreArchivo: "otra.csv", texto: csv }), /lpb_ya_cargada/);
          await assert.rejects(dueno.query("delete from lpb_personas"), /lista_inmutable|conservacion_no_se_borra/);

          const coincidencias = await listarCoincidencias(cum, { companyId: alfa });
          const mario = coincidencias.find((k) => k.sujetoNombre === "Mario López Paz");
          const pedro = coincidencias.find((k) => k.sujetoNombre === "Pedro Ruiz Sol");
          assert.equal(mario?.tipo, "exacta");
          assert.equal(mario?.estado, "pendiente");
          assert.equal(pedro?.tipo, "posible");
          assert.ok(mario && pedro);
          marioId = mario.id;
          const plazo = (await dueno.query(
            "select extract(epoch from plazo_reporte_hasta - detectada_en)::int as s from lpb_coincidencias where id = $1",
            [mario.id],
          )).rows[0].s;
          assert.equal(plazo, 24 * 3600);

          // 75ª fr. I: suspensión inmediata, sin firma, con su evento de sistema.
          assert.equal((await leerCliente(ori, alfa))?.estado, "suspendida");
          const suspension = (await dueno.query(
            "select origen, estado, solicitada_por, coincidencia_id from company_suspensions where company_id = $1",
            [alfa],
          )).rows;
          assert.deepEqual(suspension, [{ origen: "lpb", estado: "aprobada", solicitada_por: null, coincidencia_id: mario.id }]);
          assert.equal(await contar(
            "select count(*)::int as n from audit_log where company_id = $1 and accion = 'empresa_suspendida_lpb' and actor_tipo = 'sistema' and actor_id is null",
            [alfa],
          ), 1);
          assert.equal(await contar(
            "select count(*)::int as n from company_state_history where company_id = $1 and estado_nuevo = 'suspendida' and actor_id is null",
            [alfa],
          ), 1);
          const bandeja = await leerBandejaCumplimiento(cum);
          assert.ok(bandeja.coincidencias.some((k) => k.id === mario.id && k.plazoReporteHasta !== null));
          // La bandeja dice por qué coincidió: Cumplimiento decide sin abrir otra pantalla.
          assert.equal(bandeja.coincidencias.find((k) => k.id === pedro.id)?.coincidePor, "nombre");
          assert.notEqual(bandeja.coincidencias.find((k) => k.id === mario.id)?.coincidePor, "nombre");
          assert.ok(bandeja.coincidencias.find((k) => k.id === pedro.id)?.nombreEnLista);

          // El nombre solo nunca se descarta solo: lo revisa Cumplimiento con motivo.
          await assert.rejects(resolverCoincidencia(ori, SESION_SOFIPO, { id: pedro.id, estado: "falso_positivo", motivo: "x" }), /sin_permiso_operacion/);
          await assert.rejects(sofipo(CUM, (c) => c.query("insert into lpb_coincidencias (operator_id, company_id, sujeto_tipo, sujeto_clave, sujeto_nombre, lista, tipo, coincide_por, valor_coincidente, detectada_en) values ($1, $2, 'empresa', $2, 'X', 'lpb', 'posible', 'nombre', 'X', now())", [operador, alfa])), /permission denied|coincidencia_solo_sistema/);
          await resolverCoincidencia(cum, SESION_SOFIPO, { id: pedro.id, estado: "falso_positivo", motivo: "Homónimo: la CURP del socio es distinta" });
          await assert.rejects(registrarReporte(cum, { id: pedro.id, folio: "UIF-1", presentadoEl: hoy, avisoClienteEl: hoy }), /reporte_sin_confirmar/);
          await resolverCoincidencia(cum, SESION_SOFIPO, { id: mario.id, estado: "confirmada", motivo: "Coincide la CURP del propietario real" });
          await registrarReporte(cum, { id: mario.id, folio: "UIF-2026-0001", presentadoEl: hoy, avisoClienteEl: hoy });
          await assert.rejects(registrarReporte(cum, { id: mario.id, folio: "UIF-2026-0002", presentadoEl: hoy, avisoClienteEl: hoy }), /reporte_ya_registrado/);

          // Con coincidencia exacta abierta el grado es alto, aunque alguien intente otro por SQL.
          await assert.rejects(sofipo(CUM, async (c) => {
            const id = randomUUID();
            await evento(c, CUM, "riesgo_calificado", "kyb_calificaciones_riesgo", id, alfa);
            await c.query(
              `insert into kyb_calificaciones_riesgo (id, operator_id, company_id, version_id, tipo, factores, puntaje, grado,
                 pep_extranjera, coincidencia_exacta, calificada_por, calificada_el, calificada_en, revisar_antes_de)
               values ($1, $2, $3, $4, 'periodica', '{}', 1, 'bajo', false, false, $5, $6, now(), ($6::date + interval '6 months')::date)`,
              [id, operador, alfa, alfaV2, CUM, hoy],
            );
          }), /riesgo_debe_ser_alto/);
          assert.equal((await calificarRiesgoEmpresa(cum, { companyId: alfa, formId: randomUUID(), actividad: "baja", zona: "baja" })).grado, "alto");
        });

        await t.test("reactivar tras la LPB exige cerrar la coincidencia y dos personas", async () => {
          // Con la coincidencia abierta ni siquiera se puede pedir (77ª): primero se cierra el caso.
          await assert.rejects(
            solicitarCambioDeSuspension(ori, { companyId: alfa, formId: randomUUID(), tipo: "reactivacion", motivo: "La persona salió de la lista" }),
            /reactivacion_con_coincidencia_lpb/,
          );
          // Mientras siga en la lista vigente, no se puede marcar como fuera de ella.
          await assert.rejects(resolverCoincidencia(cum, SESION_SOFIPO, { id: marioId, estado: "fuera_de_lista", motivo: "Ya no aparece" }), /coincidencia_sigue_en_lista/);
          const sinMario = ["nombre,rfc,curp,tipo,fecha", "PEDRO RUIZ SOL,,,fisica,2026-11-01", "Proveedor Bloqueado SA,PBL101010AB1,,moral,2026-11-01"].join("\n");
          await cargarListaBloqueadas(cum, { formId: randomUUID(), nombreArchivo: "lpb-2.csv", texto: sinMario });
          await resolverCoincidencia(cum, SESION_SOFIPO, { id: marioId, estado: "fuera_de_lista", motivo: "Ya no aparece en la lista del 6 de noviembre" });
          const pedida = randomUUID();
          await solicitarCambioDeSuspension(ori, { companyId: alfa, formId: pedida, tipo: "reactivacion", motivo: "La persona salió de la lista" });
          await assert.rejects(decidirCambioDeSuspension(ori, SESION_SOFIPO, { id: pedida, aprobada: true, motivo: "" }), /sin_permiso_operacion/);
          await decidirCambioDeSuspension(apr, SESION_SOFIPO, { id: pedida, aprobada: true, motivo: "" });
          assert.equal((await leerCliente(ori, alfa))?.estado, "activa");
        });

        let beta = "";
        await t.test("suspensión manual con doble firma: ni dinero ni consola ni invitaciones, tampoco por SQL", async () => {
          beta = await prospecto("BET150301AB2", "Beta Logística SA de CV");
          await expedienteEnRegla(ori, cum, { companyId: beta, razonSocial: "Beta Logística SA de CV", rfc: "BET150301AB2" });
          await decidirActivacion(apr, SESION_SOFIPO, { id: await solicitarActivacion(ori, beta), aprobada: true });
          await sembrarPortal(dueno, beta, operador);
          // Los pagos llevan su propio almacén: el de expedientes no debe registrar ningún borrado.
          const deps = { almacen: almacenEnMemoria(), ahora: () => new Date() };
          const luis = cliente(LUIS, ["administrador", "liberador"], beta, operador);
          const rosa = cliente(ROSA, ["liberador"], beta, operador);
          const sesionCliente = { superficie: "cliente" as const, segundoFactor: { metodo: "totp" as const, en: new Date() } };
          const pago = (supplierId: string, monto: string) => crearPagoProveedor(luis, {
            clientRequestId: randomUUID(), supplierId, origen: "excepcion", pdf: { nombre: "soporte.pdf", bytes: PDF },
            monto, referencia: "Servicio de prueba", emitidaEl: hoy, venceEl: sumarMeses(hoy, 1), programadaEl: sumarMeses(hoy, 1),
            motivoExcepcion: "Servicio urgente autorizado por dirección",
          }, deps);

          // Flujo 11: el proveedor en la LPB no se paga.
          const bloqueado = await pago(PROVEEDOR_LPB, "1,000.00");
          await assert.rejects(resolverPagoProveedor(rosa, sesionCliente, {
            requestId: bloqueado.requestId, decision: "autorizar", version: 1, totalCentavos: 100000,
          }, deps), /pago_bloqueado_lpb/);
          const limpio = await pago(PROVEEDOR_LIMPIO, "2,000.00");

          const pedida = randomUUID();
          await solicitarCambioDeSuspension(ori, { companyId: beta, formId: pedida, tipo: "suspension", motivo: "Operaciones inusuales en revisión" });
          await solicitarCambioDeSuspension(ori, { companyId: beta, formId: pedida, tipo: "suspension", motivo: "Operaciones inusuales en revisión" });
          await assert.rejects(solicitarCambioDeSuspension(cum, { companyId: beta, formId: randomUUID(), tipo: "suspension", motivo: "Otra" }), /suspension_pendiente/);
          await assert.rejects(decidirCambioDeSuspension(ori, SESION_SOFIPO, { id: pedida, aprobada: true, motivo: "" }), /sin_permiso_operacion/);
          await assert.rejects(sofipo(ORI, async (c) => {
            await evento(c, ORI, "suspension_aprobada", "company_suspensions", pedida, beta);
            await c.query("update company_suspensions set estado = 'aprobada', decidida_por = $2, decidida_en = now() where id = $1", [pedida, ORI]);
          }), /misma_persona_en_suspension|sin_rol_para_aprobar|company_suspensions_otra_persona/);
          await decidirCambioDeSuspension(apr, SESION_SOFIPO, { id: pedida, aprobada: true, motivo: "" });
          assert.equal((await leerCliente(ori, beta))?.estado, "suspendida");
          assert.equal(await contar(
            "select count(*)::int as n from company_state_history where company_id = $1 and suspension_id = $2 and actor_id = $3",
            [beta, pedida, APR],
          ), 1);

          // Efectos: la consola no libera el pago, ni por servicio ni por SQL directo.
          await assert.rejects(resolverPagoProveedor(rosa, sesionCliente, {
            requestId: limpio.requestId, decision: "autorizar", version: 1, totalCentavos: 200000,
          }, deps), /empresa_suspendida/);
          const portal = <T>(fn: (c: pg.Client) => Promise<T>) => como(urlApp, "plataforma_cliente", { userId: ROSA, companyId: beta }, fn);
          await assert.rejects(portal((c) => c.query(
            "update supplier_payment_requests set estado = 'listo_para_pagar', resuelto_por = $2, resuelto_en = now() where id = $1",
            [limpio.requestId, ROSA],
          )), /empresa_suspendida/);
          await assert.rejects(portal((c) => c.query("insert into payroll_batches (id, company_id) values ($1, $2)", [randomUUID(), beta])), /empresa_suspendida/);
          await assert.rejects(portal((c) => c.query("insert into cost_centers (id, company_id, nombre) values ($1, $2, 'Ventas')", [randomUUID(), beta])), /empresa_suspendida/);
          // La consola sigue ofreciendo cada acción (el contexto conserva las capacidades de los roles) y
          // la base la rechaza con su propio motivo, también por el servicio de Personas y de Finanzas.
          await assert.rejects(nombrarCentro(luis, { nombre: "Ventas", presupuesto: "1000.00" }), /empresa_suspendida/);
          assert.deepEqual(
            await cambiarAccesoFinanzas(luis, { userId: ROSA, verFinanzas: "si" }),
            { tipo: "rechazado", codigo: "empresa_suspendida", habilitado: false },
          );
          assert.equal(await contar("select count(*)::int as n from cost_centers where company_id = $1", [beta]), 0);
          assert.equal(await contar("select count(*)::int as n from membership_roles where company_id = $1 and rol = 'finanzas'", [beta]), 0);
          await assert.rejects(
            invitarPrimerAdministrador(adm, { companyId: beta, nombre: "Admin Beta", correo: "admin-beta@ejemplo.mx", vista: "" }, { produccion: false }),
            /cliente_no_activo/,
          );
          // Y si alguien se salta el servicio, la base tampoco emite la invitación.
          await assert.rejects(sofipo(ADM, (c) => c.query("insert into invitations (id, company_id) values ($1, $2)", [randomUUID(), beta])), /empresa_suspendida/);
          // Leer sí: la sesión viva queda en solo lectura.
          assert.equal(await contar("select count(*)::int as n from supplier_payment_requests where company_id = $1", [beta]), 2);
          assert.ok((await portal((c) => c.query("select id from supplier_payment_requests"))).rows.length >= 1);

          // Flujo 10: reactivar con doble firma.
          const reactivar = randomUUID();
          await solicitarCambioDeSuspension(cum, { companyId: beta, formId: reactivar, tipo: "reactivacion", motivo: "Revisión concluida sin hallazgos" });
          await assert.rejects(decidirCambioDeSuspension(apr, SESION_SOFIPO, { id: reactivar, aprobada: false, motivo: "" }), /motivo_invalido/);
          await decidirCambioDeSuspension(apr, SESION_SOFIPO, { id: reactivar, aprobada: true, motivo: "" });
          assert.equal((await leerCliente(ori, beta))?.estado, "activa");
          await resolverPagoProveedor(rosa, sesionCliente, { requestId: limpio.requestId, decision: "autorizar", version: 1, totalCentavos: 200000 }, deps);
          assert.equal(String((await dueno.query("select estado from supplier_payment_requests where id = $1", [limpio.requestId])).rows[0].estado), "listo_para_pagar");

          // Misma persona con los dos roles: la base tampoco la deja decidir lo que pidió.
          const propia = randomUUID();
          await solicitarCambioDeSuspension(mixto, { companyId: beta, formId: propia, tipo: "suspension", motivo: "Prueba de doble firma" });
          await assert.rejects(decidirCambioDeSuspension(mixto, SESION_SOFIPO, { id: propia, aprobada: true, motivo: "" }), /misma_persona_en_suspension/);
          await assert.rejects(sofipo(MIXTO, async (c) => {
            await evento(c, MIXTO, "suspension_rechazada", "company_suspensions", propia, beta);
            await c.query("update company_suspensions set estado = 'rechazada', decidida_por = $2, decidida_en = now(), motivo_decision = 'x' where id = $1", [propia, MIXTO]);
          }), /misma_persona_en_suspension/);
          await decidirCambioDeSuspension(apr, SESION_SOFIPO, { id: propia, aprobada: false, motivo: "Era una prueba" });
          assert.equal((await leerCliente(ori, beta))?.estado, "activa");
        });

        await t.test("RLS entre operadores, lecturas auditadas y Blob sin borrados", async () => {
          assert.equal(await leerExpediente(ajena, alfa), null);
          assert.deepEqual(await listarCoincidencias(ajena), []);
          const vistas = await sofipo(AJENA, (c) => c.query(
            `select (select count(*)::int from kyb_versiones) as versiones, (select count(*)::int from kyb_beneficiarios) as beneficiarios,
                    (select count(*)::int from lpb_cargas) as cargas, (select count(*)::int from lpb_coincidencias) as coincidencias,
                    (select count(*)::int from company_suspensions) as suspensiones, (select count(*)::int from kyb_calificaciones_riesgo) as riesgo`,
          ), otroOperador);
          assert.deepEqual(vistas.rows[0], { versiones: 0, beneficiarios: 0, cargas: 0, coincidencias: 0, suspensiones: 0, riesgo: 0 });
          await assert.rejects(
            como(urlApp, "plataforma_cliente", { userId: ROSA, companyId: beta }, (c) => c.query("select id from kyb_versiones")),
            /permission denied/,
          );

          const antes = await contar("select count(*)::int as n from audit_log where accion = 'expediente_consultado' and actor_id = $1", [AUD]);
          await leerExpediente(aud, alfa);
          assert.equal(await contar("select count(*)::int as n from audit_log where accion = 'expediente_consultado' and actor_id = $1", [AUD]), antes + 1);

          const documento = String((await dueno.query("select id from kyb_documentos where company_id = $1 and tipo = 'acta_constitutiva' limit 1", [alfa])).rows[0].id);
          const descarga = await prepararDescargaDocumento(aud, documento);
          assert.match(descarga.clave, new RegExp(`^expedientes/${alfa}/`));
          assert.ok(almacen.guardados.has(descarga.clave));
          assert.equal(await contar(
            "select count(*)::int as n from audit_log where accion = 'expediente_documento_descargado' and identificador = $1 and actor_id = $2",
            [documento, AUD],
          ), 1);
          await assert.rejects(prepararDescargaDocumento(adm, documento), /sin_permiso_operacion/);
          await assert.rejects(sofipo(ADM, (c) => c.query("select * from kyb_documento_para_descarga($1, null)", [documento])), /sin_permiso_expediente/);
          await assert.rejects(sofipo(AJENA, (c) => c.query("select * from kyb_documento_para_descarga($1, null)", [documento]), otroOperador), /documento_no_existe|sin_permiso_expediente/);

          assert.deepEqual(almacen.borrados, []);
        });

        await t.test("roles iniciales por comando: solo la dueña de la base, con evento y sin saltarse la 50ª", async () => {
          const comando = (...args: string[]) => {
            const salida = spawnSync(join(process.cwd(), "node_modules/.bin/tsx"), ["scripts/plataforma.ts", "personal:rol", ...args], {
              cwd: process.cwd(), encoding: "utf8", env: { ...process.env, DATABASE_URL: "", DATABASE_URL_UNPOOLED: urlDuena },
            });
            return { estado: salida.status, texto: `${salida.stdout}${salida.stderr}`.trim() };
          };
          const correoAdm = `${ADM}@ejemplo.mx`;
          const motivo = "Arranque de la 0028: acta del consejo del 10 de noviembre";
          const eventos = (accion: string) => contar(
            "select count(*)::int as n from audit_log where accion = $1 and identificador = $2 and actor_tipo = 'sistema' and origen = 'comando'",
            [accion, ADM],
          );

          // La aplicación no la ejecuta con ningún rol: ni el personal ni el portal ni la conexión de la app.
          for (const rol of ["plataforma_sofipo", "plataforma_cliente"] as const) {
            await assert.rejects(como(urlApp, rol, { userId: ADM, operadorId: operador }, (c) =>
              c.query("select personal_rol_por_comando($1, 'aprobacion', false, $2)", [correoAdm, motivo])), /permission denied/);
          }
          const app = new pg.Client({ connectionString: urlApp });
          await app.connect();
          await assert.rejects(app.query("select personal_rol_por_comando($1, 'aprobacion', false, $2)", [correoAdm, motivo]), /permission denied/);
          await app.end();

          // Adriana es la única que administra al personal: el comando le da Aprobación y deja un evento.
          const asignado = comando("--correo", correoAdm.toUpperCase(), "--rol", "aprobacion", "--motivo", motivo);
          assert.equal(asignado.estado, 0, asignado.texto);
          assert.match(asignado.texto, /Se asignó el rol aprobacion/);
          assert.doesNotMatch(asignado.texto, /postgres(ql)?:\/\//);
          assert.equal(await contar("select count(*)::int as n from platform_staff_roles where user_id = $1 and rol = 'aprobacion'", [ADM]), 1);
          assert.equal(await eventos("rol_personal_asignado"), 1);
          const fila = (await dueno.query(
            "select motivo, cambio, superficie, actor_id from audit_log where accion = 'rol_personal_asignado' and identificador = $1 and origen = 'comando'",
            [ADM],
          )).rows[0];
          assert.deepEqual(fila, { motivo, cambio: { rol: "aprobacion" }, superficie: "sistema", actor_id: null });

          // Repetirlo no duplica el rol ni el evento.
          const repetido = comando("--correo", correoAdm, "--rol", "aprobacion", "--motivo", motivo);
          assert.match(repetido.texto, /ya tenía el rol aprobacion/);
          assert.equal(await eventos("rol_personal_asignado"), 1);

          // Con otra persona que administra al personal, el rol se da por pantalla.
          const porPantalla = comando("--correo", `${NUEVO}@ejemplo.mx`, "--rol", "auditoria", "--motivo", motivo);
          assert.equal(porPantalla.estado, 1);
          assert.match(porPantalla.texto, /pantalla Personal/);

          // La 50ª sigue valiendo, no deja al personal sin administración y el motivo es obligatorio.
          assert.equal(comando("--correo", correoAdm, "--rol", "cumplimiento", "--motivo", motivo).estado, 0);
          const incompatible = comando("--correo", correoAdm, "--rol", "auditoria", "--motivo", motivo);
          assert.match(incompatible.texto, /Cumplimiento no se junta con Auditoría/);
          assert.match(comando("--correo", correoAdm, "--rol", "administracion_plataforma", "--motivo", motivo, "--quitar").texto, /no se queda sin administración/);
          assert.match(comando("--correo", correoAdm, "--rol", "aprobacion", "--motivo", "corto").texto, /de 10 a 500 caracteres/);
          assert.match(comando("--correo", "nadie@ejemplo.mx", "--rol", "aprobacion", "--motivo", motivo).texto, /No hay una persona activa/);
          assert.equal(await contar("select count(*)::int as n from platform_staff_roles where user_id = $1 and rol = 'auditoria'", [ADM]), 0);

          // Quitar deja su propio evento.
          const quitado = comando("--correo", correoAdm, "--rol", "aprobacion", "--motivo", motivo, "--quitar");
          assert.match(quitado.texto, /Se quitó el rol aprobacion/);
          assert.equal(await eventos("rol_personal_retirado"), 1);
          assert.equal(await contar("select count(*)::int as n from platform_staff_roles where user_id = $1 and rol = 'aprobacion'", [ADM]), 0);

          // Con la conexión agrupada ni siquiera conecta (el host lleva -pooler, como el de Neon).
          const urlAgrupada = new URL(urlDuena);
          urlAgrupada.hostname = "ep-ejemplo-pooler.neon.tech";
          const agrupada = spawnSync(join(process.cwd(), "node_modules/.bin/tsx"), ["scripts/plataforma.ts", "personal:rol", "--correo", correoAdm, "--rol", "aprobacion", "--motivo", motivo], {
            cwd: process.cwd(), encoding: "utf8", env: { ...process.env, DATABASE_URL_UNPOOLED: urlAgrupada.toString() },
          });
          assert.equal(agrupada.status, 1);
          assert.match(agrupada.stderr, /connection string agrupado/);
        });
      } finally {
        await dueno.end();
        await cerrarConexion();
        delete process.env.DATABASE_URL;
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
      [ids.companyId ?? "", ids.userId, ids.operadorId ?? ""],
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

/** El portal de Beta: dos personas, una copia de la 69-B y dos proveedores (uno está en la LPB vigente). */
async function sembrarPortal(dueno: pg.Client, companyId: string, operadorId: string): Promise<void> {
  await dueno.query("begin");
  try {
    // La base pide dos liberadores operativos para autorizar (0022): Luis pide, Rosa autoriza.
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
    await dueno.query("insert into lista_69b_snapshots (id, fecha_archivo, cargado_en) values ($1, current_date - 1, now())", [COPIA_69B]);
    await dueno.query(
      `insert into audit_log (operator_id, actor_tipo, superficie, accion, entidad, identificador)
       values ($1, 'sistema', 'sistema', 'cargar_lista_69b', 'lista_69b_snapshots', $2)`,
      [operadorId, COPIA_69B],
    );
    await dueno.query("insert into lista_69b_rows (snapshot_id, rfc, situacion) values ($1, 'PAL7202161U0', 'Presunto')", [COPIA_69B]);
    const proveedores: Array<[string, string, string]> = [
      [PROVEEDOR_LPB, "PBL101010AB1", "Proveedor Bloqueado SA"],
      [PROVEEDOR_LIMPIO, "LIM101010AB2", "Proveedor Limpio SA"],
    ];
    for (const [id, rfc, nombre] of proveedores) {
      const documento = randomUUID();
      const clabeId = randomUUID();
      await dueno.query(
        `insert into documents (id, company_id, clave_blob, hash_sha256, tipo, nombre_original, creado_en)
         values ($1, $2, $3, $4, 'application/pdf', 'constancia.pdf', now())`,
        [documento, companyId, `constancias/${id}`, "a".repeat(64)],
      );
      await dueno.query(
        `insert into suppliers (id, company_id, document_id, snapshot_id, rfc, razon_social, lista_fecha, lista_leida_en, boton_pago, alta_en)
         values ($1, $2, $3, $4, $5, $6, current_date - 1, now(), true, now())`,
        [id, companyId, documento, COPIA_69B, rfc, nombre],
      );
      await dueno.query(
        `insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador)
         values ($1, $2, 'miembro', $3, 'cliente', 'alta_proveedor', 'suppliers', $4)`,
        [operadorId, companyId, LUIS, id],
      );
      await dueno.query(
        `insert into supplier_clabes (id, company_id, supplier_id, clabe, digito_valido, vigente_desde)
         values ($1, $2, $3, $4, true, now() - interval '1 day')`,
        [clabeId, companyId, id, CLABE],
      );
      await dueno.query(
        `insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador)
         values ($1, $2, 'miembro', $3, 'cliente', 'clabe_proveedor', 'supplier_clabes', $4)`,
        [operadorId, companyId, LUIS, clabeId],
      );
    }
    await dueno.query("commit");
  } catch (error) {
    await dueno.query("rollback");
    throw error;
  }
}
