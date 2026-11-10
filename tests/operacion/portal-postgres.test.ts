import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { diaAnterior, hoyEnMexico } from "../../src/dominio/operacion/comisiones.ts";
import type { ContextoDePersonal } from "../../src/nucleo/contexto.ts";
import { cerrarConexion, conContexto } from "../../src/nucleo/db.ts";
import { decidirActivacion, solicitarActivacion } from "../../src/server/operacion/activaciones.ts";
import { asignarAlerta, cerrarAlerta, crearAlerta, listarAlertas } from "../../src/server/operacion/alertas.ts";
import { listarClientes, leerCliente, registrarProspecto } from "../../src/server/operacion/clientes.ts";
import { decidirComision, listarComisiones, solicitarComision } from "../../src/server/operacion/comisiones.ts";
import { invitarPrimerAdministrador } from "../../src/server/operacion/invitaciones.ts";
import { entrarConRespaldo } from "../../src/server/autenticacion/servicio.ts";
import { hashDeRespaldo } from "../../src/server/autenticacion/respaldo.ts";
import { hashDeToken } from "../../src/server/session/hash.ts";
import { leerSesion } from "../../src/server/session/servicio.ts";
import { aplicarArchivo, conBaseDesechable, exigirBaseDesechable, urlDeAplicacion } from "../aislamiento/postgres.ts";
import { expedienteEnRegla, personal } from "./apoyo-alta-regulada.ts";

const urlAdmin = process.env.AISLAMIENTO_DATABASE_URL?.trim() ?? "";
const AHORA = new Date();
const sesionSofipo = { superficie: "sofipo" as const, segundoFactor: { metodo: "totp" as const, en: AHORA } };

describe("vertical slice 5A en Postgres desechable", { skip: urlAdmin.length === 0 }, () => {
  it("origina, separa aprobadores, invalida reenvíos, aísla RLS y versiona sin solapes", async () => {
    exigirBaseDesechable();
    await conBaseDesechable(urlAdmin, async (urlDuena) => {
      const dir = join(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");
      for (const archivo of readdirSync(dir).sort()) if (archivo.endsWith(".sql")) aplicarArchivo(urlDuena, join(dir, archivo));
      const { Client } = await import("pg");
      const admin = new Client({ connectionString: urlDuena });
      await admin.connect();
      const operador = await admin.query("select id from operators order by alta_en limit 1");
      const operatorId = String(operador.rows[0].id);
      const otroOperador = randomUUID();
      await admin.query("insert into operators (id, nombre) values ($1, 'Otro operador')", [otroOperador]);
      const a = randomUUID();
      const b = randomUUID();
      const externa = randomUUID();
      // Ola R1: el alta regulada pide originación y cumplimiento para el expediente, y aprobación para activar.
      const origina = randomUUID();
      const cumple = randomUUID();
      for (const [id, correo] of [[a, "a@ejemplo.mx"], [b, "b@ejemplo.mx"], [externa, "externa@ejemplo.mx"], [origina, "origina@ejemplo.mx"], [cumple, "cumple@ejemplo.mx"]] as const) {
        await admin.query("insert into users (id, nombre, correo, password_hash) values ($1, $2, $3, null)", [id, correo.split("@")[0].toUpperCase(), correo]);
      }
      for (const id of [a, b]) {
        await admin.query("insert into platform_staff (operator_id, user_id, estado) values ($1, $2, 'activo')", [operatorId, id]);
        await admin.query("insert into platform_staff_roles (operator_id, user_id, rol) values ($1, $2, 'administracion_plataforma')", [operatorId, id]);
      }
      await admin.query("insert into platform_staff_roles (operator_id, user_id, rol) values ($1, $2, 'aprobacion')", [operatorId, b]);
      for (const [id, rol] of [[origina, "originacion"], [cumple, "cumplimiento"]] as const) {
        await admin.query("insert into platform_staff (operator_id, user_id, estado) values ($1, $2, 'activo')", [operatorId, id]);
        await admin.query("insert into platform_staff_roles (operator_id, user_id, rol) values ($1, $2, $3)", [operatorId, id, rol]);
      }
      await admin.query("insert into platform_staff (operator_id, user_id, estado) values ($1, $2, 'activo')", [otroOperador, externa]);
      await admin.query("insert into platform_staff_roles (operator_id, user_id, rol) values ($1, $2, 'administracion_plataforma')", [otroOperador, externa]);
      await admin.end();

      process.env.DATABASE_URL = urlDeAplicacion(urlDuena);
      await cerrarConexion();
      const ana = contexto(operatorId, a);
      const beto = personal(operatorId, b, ["administracion_plataforma", "aprobacion"]);
      const ori = personal(operatorId, origina, ["originacion"]);
      const cum = personal(operatorId, cumple, ["cumplimiento"]);
      const enRegla = (companyId: string, rfc: string, razonSocial: string) => expedienteEnRegla(ori, cum, { companyId, rfc, razonSocial });
      const ajena = contexto(otroOperador, externa);
      try {
        const authOwner = new Client({ connectionString: urlDuena });
        await authOwner.connect();
        const entradaToken = "e".repeat(43);
        const sesionToken = "f".repeat(43);
        const respaldo = "ABCDEFGHJKLMNPQR";
        await authOwner.query("update users set password_hash = $2 where id = $1", [b, `$2b$12$${"a".repeat(53)}`]);
        await authOwner.query(
          "insert into auth_entradas (id, user_id, token_hash, creada_en, vence_en) values ($1, $2, $3, now(), now() + interval '10 minutes')",
          [randomUUID(), b, hashDeToken(entradaToken)],
        );
        await authOwner.query("insert into auth_codigos_respaldo (id, user_id, codigo_hash, creado_en) values ($1, $2, $3, now())", [
          randomUUID(), b, hashDeRespaldo(respaldo),
        ]);
        await authOwner.end();
        const cookieSofipo = await entrarConRespaldo(entradaToken, respaldo, {
          superficie: "sofipo",
          token: () => sesionToken,
          ids: () => randomUUID(),
        });
        const sesionLeida = await leerSesion(cookieSofipo);
        assert.equal(sesionLeida?.superficie, "sofipo");
        assert.equal(sesionLeida?.segundoFactor?.metodo, "respaldo");

        const companyId = await registrarProspecto(ana, {
          rfc: "AAA010101AAA", razonSocial: "Empresa Uno", codigoPostal: "01000", regimen: "601", usoCfdi: "G03",
        });
        assert.equal((await leerCliente(ana, companyId))?.estado, "prospecto");
        assert.deepEqual(await listarClientes(ajena), []);
        const solicitudId = await solicitarActivacion(ana, companyId);
        assert.equal((await leerCliente(ana, companyId))?.estado, "en_alta");
        await assert.rejects(decidirActivacion(ana, sesionSofipo, { id: solicitudId, aprobada: true }), /sin_permiso_operacion/);
        // El candado de la base: sin expediente aprobado ni grado de riesgo vigente no se activa.
        await assert.rejects(decidirActivacion(beto, sesionSofipo, { id: solicitudId, aprobada: true }), /activacion_sin_expediente_aprobado/);
        await enRegla(companyId, "AAA010101AAA", "Empresa Uno");
        // Quien pide la activación no la decide, aunque también tenga el rol de aprobación.
        const mixta = await registrarProspecto(ana, { rfc: "MIX010101MXA", razonSocial: "Empresa Mixta", codigoPostal: "01000", regimen: "601", usoCfdi: "G03" });
        const pedidaPorBeto = await solicitarActivacion(beto, mixta);
        await assert.rejects(decidirActivacion(beto, sesionSofipo, { id: pedidaPorBeto, aprobada: true }), /misma_persona_en_activacion/);
        // serv-N18: el motivo del rechazo cuenta caracteres, no unidades UTF-16: «Revisar 😀» son 9.
        await assert.rejects(decidirActivacion(beto, sesionSofipo, { id: solicitudId, aprobada: false, motivo: "Revisar 😀" }), /motivo_corto/);
        await decidirActivacion(beto, sesionSofipo, { id: solicitudId, aprobada: true });
        assert.equal((await leerCliente(ana, companyId))?.estado, "activa");
        assert.ok((await listarAlertas(ana, companyId)).every((alerta) => alerta.estado === "cerrada"));

        let llamadasCorreo = 0;
        const entregar = async () => { llamadasCorreo += 1; return { entregada: true as const }; };
        const inicio = Date.now();
        const alSegundo = (segundo: number) => ({ produccion: false, entregar, ahora: () => new Date(inicio + segundo * 1000) });
        // Doceava revisión: «ana@ejemplo» pasa el `type=email` del navegador; antes el servidor respondía `invitacion_invalida`,
        // que no era de ningún campo. Cada rechazo es de su campo y no emite nada.
        await assert.rejects(invitarPrimerAdministrador(ana, { companyId, nombre: "Admin Uno", correo: "ana@ejemplo" }, alSegundo(0)), /dato_invalido_correo/);
        await assert.rejects(invitarPrimerAdministrador(ana, { companyId, nombre: " \u200b ", correo: "admin@ejemplo.mx" }, alSegundo(0)), /dato_invalido_nombre/);
        const primera = await invitarPrimerAdministrador(ana, { companyId, nombre: "Admin Uno", correo: "admin@ejemplo.mx" }, alSegundo(0));
        const segunda = await invitarPrimerAdministrador(ana, { companyId, nombre: "Admin Uno", correo: "admin@ejemplo.mx" }, alSegundo(10));
        assert.equal(llamadasCorreo, 0);
        assert.equal(primera.entrega, "omitida_desarrollo");
        assert.equal(JSON.stringify(segunda).includes("token"), false);
        const invitaciones = await conContexto({ rol: "plataforma_sofipo", userId: a, operadorId: operatorId }, (consulta) =>
          consulta.query("select revocada_en from invitations where company_id = $1 order by emitida_en", [companyId]),
        );
        assert.equal(invitaciones.rows.length, 2);
        assert.notEqual((invitaciones.rows[0] as { revocada_en: unknown }).revocada_en, null);
        assert.equal((invitaciones.rows[1] as { revocada_en: unknown }).revocada_en, null);

        // Reenviar solo reemplaza la invitación que la persona tenía en pantalla: un segundo clic sobre
        // la misma, o un primer envío cuando ya hay una, no emite otra ni manda otro correo.
        const admin = { companyId, nombre: "Admin Uno", correo: "admin@ejemplo.mx" };
        await assert.rejects(invitarPrimerAdministrador(ana, { ...admin, vista: primera.invitationId }, alSegundo(20)), /invitacion_ya_enviada/);
        await assert.rejects(invitarPrimerAdministrador(ana, { ...admin, vista: "" }, alSegundo(20)), /invitacion_ya_enviada/);
        assert.equal((await leerCliente(ana, companyId))?.ultimaInvitacionId, segunda.invitationId);
        const tercera = await invitarPrimerAdministrador(ana, { ...admin, vista: segunda.invitationId }, alSegundo(20));
        await assert.rejects(invitarPrimerAdministrador(ana, { ...admin, vista: segunda.invitationId }, alSegundo(21)), /invitacion_ya_enviada/);
        // El segundo clic de un doble clic llega cuando la pantalla ya muestra la invitación nueva: trae la
        // `vista` vigente, pero a un segundo de la anterior tampoco emite. Pasada la ventana, reenviar sí emite.
        await assert.rejects(invitarPrimerAdministrador(ana, { ...admin, vista: tercera.invitationId }, alSegundo(21)), /invitacion_ya_enviada/);
        await assert.rejects(invitarPrimerAdministrador(ana, admin, alSegundo(21)), /invitacion_ya_enviada/);
        const cuarta = await invitarPrimerAdministrador(ana, { ...admin, vista: tercera.invitationId }, alSegundo(23));
        const trasReenviar = await conContexto({ rol: "plataforma_sofipo", userId: a, operadorId: operatorId }, (consulta) =>
          consulta.query(
            `select i.id, i.revocada_en, (select count(*)::int from invitation_deliveries d where d.invitation_id = i.id) as entregas
             from invitations i where i.company_id = $1 order by i.emitida_en`,
            [companyId],
          ),
        );
        const filas = trasReenviar.rows as Array<{ id: string; revocada_en: unknown; entregas: number }>;
        assert.equal(filas.length, 4);
        assert.equal(filas[3].id, cuarta.invitationId);
        assert.deepEqual(filas.map((fila) => fila.revocada_en === null), [false, false, false, true]);
        assert.deepEqual(filas.map((fila) => fila.entregas), [1, 1, 1, 1]);

        // Sin ninguna invitación previa, `vista` vacío emite la primera; dos envíos a la vez en ese mismo
        // estado dejan una sola invitación y una sola entrega (el otro recibe invitacion_ya_enviada).
        const activa = async (rfc: string, razonSocial: string) => {
          const id = await registrarProspecto(ana, { rfc, razonSocial, codigoPostal: "01000", regimen: "601", usoCfdi: "G03" });
          await enRegla(id, rfc, razonSocial);
          await decidirActivacion(beto, sesionSofipo, { id: await solicitarActivacion(ana, id), aprobada: true });
          return id;
        };
        const sinPrevia = await activa("CCC010101CCA", "Empresa Dos");
        assert.equal((await leerCliente(ana, sinPrevia))?.ultimaInvitacionId, null);
        const emitidaSinPrevia = await invitarPrimerAdministrador(
          ana, { companyId: sinPrevia, nombre: "Admin Dos", correo: "admin2@ejemplo.mx", vista: "" }, { produccion: false, entregar },
        );
        assert.equal((await leerCliente(ana, sinPrevia))?.ultimaInvitacionId, emitidaSinPrevia.invitationId);
        const simultanea = await activa("DDD010101DDA", "Empresa Tres");
        const envios = await Promise.allSettled([1, 2].map(() => invitarPrimerAdministrador(
          ana, { companyId: simultanea, nombre: "Admin Tres", correo: "admin3@ejemplo.mx", vista: "" }, { produccion: false, entregar },
        )));
        assert.deepEqual(envios.map((envio) => envio.status).sort(), ["fulfilled", "rejected"]);
        const rechazado = envios.find((envio): envio is PromiseRejectedResult => envio.status === "rejected");
        assert.equal((rechazado?.reason as { codigo?: unknown } | undefined)?.codigo, "invitacion_ya_enviada");
        const porEmpresa = await conContexto({ rol: "plataforma_sofipo", userId: a, operadorId: operatorId }, (consulta) =>
          consulta.query(
            `select (select count(*)::int from invitations i where i.company_id = c.id) as invitaciones,
                    (select count(*)::int from invitation_deliveries d where d.company_id = c.id) as entregas
             from companies c where c.id = any($1::uuid[]) order by c.razon_social`,
            [[sinPrevia, simultanea]],
          ),
        );
        assert.deepEqual(porEmpresa.rows, [{ invitaciones: 1, entregas: 1 }, { invitaciones: 1, entregas: 1 }]);

        const hoy = hoyEnMexico(new Date());
        const despues = new Date(`${hoy}T00:00:00Z`);
        despues.setUTCDate(despues.getUTCDate() + 2);
        const vigenteDespues = despues.toISOString().slice(0, 10);
        const comisionId = await solicitarComision(ana, { companyId, tipo: "fondeo", valor: "250", vigenteDesde: hoy });
        await assert.rejects(decidirComision(ana, sesionSofipo, { id: comisionId, aprobada: true }), /misma_persona_en_comision/);
        await assert.rejects(decidirComision(beto, sesionSofipo, { id: comisionId, aprobada: false, motivo: "Revisar 😀" }), /motivo_corto/);
        await decidirComision(beto, sesionSofipo, { id: comisionId, aprobada: true });
        const segundaComision = await solicitarComision(ana, { companyId, tipo: "fondeo", valor: "300", vigenteDesde: vigenteDespues });
        await decidirComision(beto, sesionSofipo, { id: segundaComision, aprobada: true });
        // Ronda 13 (doce-N1): con una versión pendiente, pedir otra para la misma empresa y tipo chocaba con
        // `company_commissions_una_pendiente` y la pantalla decía «La base no respondió». Ahora dice cuál es el problema.
        const speiPendiente = await solicitarComision(ana, { companyId, tipo: "spei", valor: "500", vigenteDesde: vigenteDespues });
        await assert.rejects(solicitarComision(ana, { companyId, tipo: "spei", valor: "600", vigenteDesde: vigenteDespues }), /comision_pendiente/);
        assert.deepEqual((await listarComisiones(ana, companyId)).filter((v) => v.tipo === "spei").map((v) => [v.id, v.estado]), [[speiPendiente, "pendiente"]]);
        await decidirComision(beto, sesionSofipo, { id: speiPendiente, aprobada: false, motivo: "Se revisa con la tarifa del trimestre." });
        const versiones = (await listarComisiones(ana, companyId)).filter((v) => v.tipo === "fondeo");
        assert.deepEqual(versiones.map((v) => v.estado).sort(), ["cerrada", "vigente"]);
        assert.equal(
          versiones.find((v) => v.id === comisionId)?.vigenteHasta,
          diaAnterior(vigenteDespues),
          JSON.stringify({ hoy, vigenteDespues, versiones }),
        );
        await assert.rejects(
          conContexto({ rol: "plataforma_sofipo", userId: b, operadorId: operatorId }, (consulta) => consulta.query(
            `insert into company_commissions (id, operator_id, company_id, tipo, valor, vigente_desde, estado, solicitada_por, solicitada_en, decidida_por, decidida_en)
             values ($1, $2, $3, 'fondeo', 100, $4, 'vigente', $5, now(), $6, now())`,
            [randomUUID(), operatorId, companyId, hoy, a, b],
          )),
          /base_no_disponible|comision_sin_auditoria|company_commissions_sin_solape/,
        );

        // El detalle y el motivo escritos en varios renglones (el navegador manda CRLF) se guardan en uno:
        // la base no acepta saltos de línea. Antes, el servidor los aceptaba y la base los rechazaba.
        // Doceava revisión: un título o un detalle sin nada que se vea (el navegador los deja pasar) da el error de su campo.
        await assert.rejects(crearAlerta(ana, { companyId, titulo: "   ", detalle: "Seguimiento", responsableId: a }), /dato_invalido_titulo/);
        await assert.rejects(crearAlerta(ana, { companyId, titulo: "Revisar datos", detalle: " \r\n ", responsableId: a }), /dato_invalido_detalle/);
        await crearAlerta(ana, { companyId, titulo: "Revisar datos", detalle: "Seguimiento\r\noperativo", responsableId: a });
        const abierta = (await listarAlertas(ana, companyId)).find((alerta) => alerta.titulo === "Revisar datos");
        assert.ok(abierta);
        assert.equal(abierta.detalle, "Seguimiento operativo");
        await asignarAlerta(ana, abierta.id, b);
        await cerrarAlerta(beto, abierta.id, "Datos\n\trevisados");
        assert.equal((await listarAlertas(ana, companyId)).find((alerta) => alerta.id === abierta.id)?.motivoCierre, "Datos revisados");
        await assert.rejects(cerrarAlerta(beto, abierta.id, "Otra vez"), /alerta_ya_cerrada/);

        const rollbackCompanyId = await registrarProspecto(ana, {
          rfc: "BBB010101BBA", razonSocial: "Empresa Rollback", codigoPostal: "01000", regimen: "601", usoCfdi: "G03",
        });
        await enRegla(rollbackCompanyId, "BBB010101BBA", "Empresa Rollback");
        const rollbackRequestId = await solicitarActivacion(ana, rollbackCompanyId);
        const owner = new Client({ connectionString: urlDuena });
        await owner.connect();
        try {
          await owner.query("revoke insert on audit_log from plataforma_sofipo");
          await assert.rejects(
            decidirActivacion(beto, sesionSofipo, { id: rollbackRequestId, aprobada: true }),
            /sin_permiso|auditoria_no_disponible/,
          );
        } finally {
          await owner.query("grant insert on audit_log to plataforma_sofipo");
          await owner.end();
        }
        assert.equal((await leerCliente(ana, rollbackCompanyId))?.estado, "en_alta");
        const pendiente = await conContexto({ rol: "plataforma_sofipo", userId: b, operadorId: operatorId }, (consulta) =>
          consulta.query("select estado from company_activation_requests where id = $1", [rollbackRequestId]),
        );
        assert.equal((pendiente.rows[0] as { estado: string }).estado, "pendiente");

        await assert.rejects(
          conContexto({ rol: "plataforma_cliente", userId: a }, (consulta) => consulta.query("select id from company_commissions", [])),
          /sin_permiso/,
        );
      } finally {
        await cerrarConexion();
        delete process.env.DATABASE_URL;
      }
    });
  });
});

function contexto(operadorId: string, userId: string): ContextoDePersonal {
  return {
    sesionId: randomUUID(), peticionId: null, superficie: "sofipo",
    persona: { id: userId, nombre: userId, correo: `${userId}@ejemplo.mx` }, segundoFactor: "totp",
    empresa: null, roles: [], personal: { operadorId, roles: ["administracion_plataforma"] }, empresas: [], capacidades: [],
  };
}
