import assert from "node:assert/strict";
import { test } from "node:test";

import { cfdiDePrueba } from "../../src/dominio/cfdi.test.ts";
import { capacidadesDe, type RolCliente } from "../../src/nucleo/capacidades.ts";
import type { ContextoDeTenant } from "../../src/nucleo/contexto.ts";
import { cerrarConexion } from "../../src/nucleo/db.ts";
import { ErrorDeDominio } from "../../src/nucleo/error-de-dominio.ts";
import { crearPagoProveedor, editarYReenviarPago, cancelarPagoProveedor, resolverPagoProveedor } from "../../src/server/pagos-proveedores/servicio.ts";
import type { AlmacenConstancia } from "../../src/server/proveedores/constancia.ts";
import { avisarCambioClabe } from "../../src/server/proveedores/avisos.ts";
import type { MensajeCorreo } from "../../src/server/correo/tipos.ts";
import { DIRECTORIO_MIGRACIONES, evaluarEsquema } from "../aislamiento/esquema.ts";
import { aplicarArchivo, conBaseDesechable, consultarJson, ejecutar, exigirBaseDesechable, urlDeAplicacion } from "../aislamiento/postgres.ts";

const LUIS = "11111111-1111-4111-8111-111111111111";
const ROSA = "22222222-2222-4222-8222-222222222222";
const EMPRESA = "33333333-3333-4333-8333-333333333333";
const PROVEEDOR = "44444444-4444-4444-8444-444444444444";
const DOCUMENTO = "55555555-5555-4555-8555-555555555555";
const COPIA = "66666666-6666-4666-8666-666666666666";
const CLABE_ID = "77777777-7777-4777-8777-777777777777";
const CLABE_NUEVA_ID = "88888888-8888-4888-8888-888888888888";
const CLABE = "002180701150123452";
const CLABE_NUEVA = "646180701150123452";
const AHORA = new Date("2026-11-05T12:00:00.000Z");
const PDF = new Uint8Array(80);
PDF.set([0x25, 0x50, 0x44, 0x46, 0x2d]);

test("cuentas por pagar: dos personas, duplicados, corrección y CLABE cambiada", async () => {
  const esquema = evaluarEsquema(DIRECTORIO_MIGRACIONES);
  if (esquema.pendiente) throw new Error(esquema.motivo);
  const previo = process.env.DATABASE_URL;
  const previaUrl = process.env.URL_APLICACION;
  process.env.URL_APLICACION = "http://localhost:3109";
  await conBaseDesechable(exigirBaseDesechable(), async (url) => {
    for (const archivo of esquema.archivos) aplicarArchivo(url, archivo);
    const operadorId = sembrar(url);
    await cerrarConexion();
    process.env.DATABASE_URL = urlDeAplicacion(url);
    const borrados: string[] = [];
    const almacen: AlmacenConstancia = {
      async guardar(entrada) { return { clave: entrada.clave }; },
      async borrar(clave) { borrados.push(clave); },
    };
    const deps = { almacen, ahora: () => new Date(AHORA) };
    const luis = contexto(LUIS, ["administrador", "liberador"], operadorId);
    const rosa = contexto(ROSA, ["liberador"], operadorId);
    const sesion = { superficie: "cliente" as const, segundoFactor: { metodo: "totp" as const, en: new Date(AHORA) } };
    try {
      const entradaCfdi = {
        supplierId: PROVEEDOR, origen: "cfdi", xml: { nombre: "factura.xml", bytes: cfdiDePrueba() },
        pdf: { nombre: "factura.pdf", bytes: PDF }, venceEl: "2026-11-30", programadaEl: "2026-11-06",
      };
      const creado = await crearPagoProveedor(luis, entradaCfdi, deps);
      await assert.rejects(
        () => resolverPagoProveedor(luis, sesion, { requestId: creado.requestId, decision: "autorizar" }, deps),
        (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "pago_no_autorizable",
      );
      await resolverPagoProveedor(rosa, sesion, { requestId: creado.requestId, decision: "autorizar" }, deps);
      assert.equal(estado(url, creado.requestId), "listo_para_pagar");

      await assert.rejects(
        () => crearPagoProveedor(luis, entradaCfdi, deps),
        (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "cfdi_duplicado",
      );
      assert.equal(borrados.length, 0, "el duplicado se detecta antes de subir archivos y no deja huérfanos");

      const excepcion = await crearPagoProveedor(luis, {
        supplierId: PROVEEDOR, origen: "excepcion", pdf: { nombre: "soporte.pdf", bytes: PDF },
        monto: "1,250.50", referencia: "Servicio extraordinario", emitidaEl: "2026-11-01",
        venceEl: "2026-11-30", programadaEl: "2026-11-07", motivoExcepcion: "Trabajo urgente autorizado por dirección",
      }, deps);
      await resolverPagoProveedor(rosa, sesion, { requestId: excepcion.requestId, decision: "rechazar", motivo: "Falta desglose del trabajo" }, deps);
      await editarYReenviarPago(luis, excepcion.requestId, {
        origen: "excepcion", monto: "2,000.00", referencia: "Servicio extraordinario", emitidaEl: "2026-11-01",
        venceEl: "2026-11-30", programadaEl: "2026-11-08", motivoExcepcion: "Trabajo urgente con desglose anexado por dirección",
      }, deps);
      assert.equal(estado(url, excepcion.requestId), "por_autorizar");

      ejecutar(url, `begin;
        update supplier_clabes set vigente_hasta = timestamptz '2026-11-05 12:00:00+00' where id = '${CLABE_ID}';
        insert into supplier_clabes (id, company_id, supplier_id, clabe, digito_valido, vigente_desde)
          values ('${CLABE_NUEVA_ID}', '${EMPRESA}', '${PROVEEDOR}', '${CLABE_NUEVA}', true, timestamptz '2026-11-05 12:00:00+00');
        insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador)
          values ('${operadorId}', '${EMPRESA}', 'miembro', '${LUIS}', 'cliente', 'clabe_proveedor', 'supplier_clabes', '${CLABE_NUEVA_ID}');
        commit;`);
      await assert.rejects(
        () => resolverPagoProveedor(rosa, sesion, { requestId: excepcion.requestId, decision: "autorizar" }, deps),
        (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "pago_no_autorizable",
      );
      await cancelarPagoProveedor(luis, { requestId: excepcion.requestId, motivo: "Cambió la cuenta de depósito" }, deps);
      assert.equal(estado(url, excepcion.requestId), "cancelado");

      const correos: MensajeCorreo[] = [];
      const avisados = await avisarCambioClabe(luis, { supplierId: PROVEEDOR, clabeId: CLABE_NUEVA_ID, clabe: CLABE_NUEVA, ahora: AHORA }, async (mensaje) => {
        correos.push(mensaje);
        return { id: `correo-${correos.length}` };
      });
      assert.equal(avisados, 2);
      assert.deepEqual(correos.map((correo) => correo.para).sort(), ["luis-pagos@ejemplo.mx", "rosa-pagos@ejemplo.mx"]);
      assert.equal(correos.every((correo) => correo.idempotencia.includes(CLABE_NUEVA_ID)), true);
      assert.equal(correos.every((correo) => !correo.html.includes(CLABE_NUEVA) && !correo.texto.includes(CLABE_NUEVA)), true);

      const aislamiento = consultarJson<Array<{ cargos: number; solicitudes: number }>>(url, `begin;
        set local role plataforma_cliente;
        select set_config('app.company_id', '99999999-9999-4999-8999-999999999999', true);
        select json_agg(fila) from (
          select (select count(*) from supplier_payables) as cargos,
                 (select count(*) from supplier_payment_requests) as solicitudes
        ) fila;
        rollback;`);
      assert.deepEqual(aislamiento[0], { cargos: 0, solicitudes: 0 });
    } finally {
      await cerrarConexion();
      if (previo === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previo;
      if (previaUrl === undefined) delete process.env.URL_APLICACION;
      else process.env.URL_APLICACION = previaUrl;
    }
  });
});

function estado(url: string, requestId: string): string {
  const filas = consultarJson<Array<{ estado: string }>>(url, `select coalesce(json_agg(json_build_object('estado', estado)), '[]'::json)
    from supplier_payment_requests where id = '${requestId}'`);
  if (filas.length !== 1) throw new Error("La solicitud no existe");
  return filas[0]?.estado ?? "";
}

function contexto(userId: string, roles: RolCliente[], operadorId: string): ContextoDeTenant {
  return {
    sesionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", peticionId: null, superficie: "cliente",
    persona: { id: userId, nombre: userId === LUIS ? "Luis" : "Rosa", correo: `${userId.slice(0, 8)}@ejemplo.mx` },
    segundoFactor: "totp",
    empresa: { id: EMPRESA, rfc: "EKU9003173C9", razonSocial: "Escuela Kemper", operadorId, estado: "activa", demostracion: true },
    roles, personal: null, empresas: [], capacidades: capacidadesDe({ rolesCliente: roles, rolesPlataforma: [] }),
  };
}

function sembrar(url: string): string {
  ejecutar(url, `begin;
    insert into users (id, nombre, correo) values ('${LUIS}', 'Luis', 'luis-pagos@ejemplo.mx'), ('${ROSA}', 'Rosa', 'rosa-pagos@ejemplo.mx');
    insert into companies (id, rfc, razon_social, codigo_postal, regimen, uso_cfdi, operator_id, estado, demostracion)
      values ('${EMPRESA}', 'EKU9003173C9', 'Escuela Kemper', '06600', '601', 'G03',
        (select id from operators order by alta_en limit 1), 'activa', true);
    insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador)
      values ((select id from operators order by alta_en limit 1), '${EMPRESA}', 'miembro', '${LUIS}', 'cliente', 'alta_empresa', 'companies', '${EMPRESA}');
    insert into memberships (user_id, company_id, estado) values ('${LUIS}', '${EMPRESA}', 'activa'), ('${ROSA}', '${EMPRESA}', 'activa');
    insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, cambio)
      select operator_id, '${EMPRESA}', 'miembro', '${LUIS}', 'cliente', 'asignar_rol', 'membership_roles', '${LUIS}', '{"rol":"administrador"}' from companies where id = '${EMPRESA}';
    insert into membership_roles (user_id, company_id, rol) values ('${LUIS}', '${EMPRESA}', 'administrador');
    insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, cambio)
      select operator_id, '${EMPRESA}', 'miembro', '${LUIS}', 'cliente', 'asignar_rol', 'membership_roles', '${LUIS}', '{"rol":"liberador"}' from companies where id = '${EMPRESA}';
    insert into membership_roles (user_id, company_id, rol) values ('${LUIS}', '${EMPRESA}', 'liberador');
    insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, cambio)
      select operator_id, '${EMPRESA}', 'miembro', '${LUIS}', 'cliente', 'asignar_rol', 'membership_roles', '${ROSA}', '{"rol":"liberador"}' from companies where id = '${EMPRESA}';
    insert into membership_roles (user_id, company_id, rol) values ('${ROSA}', '${EMPRESA}', 'liberador');
    insert into lista_69b_snapshots (id, fecha_archivo, cargado_en) values ('${COPIA}', date '2026-09-30', timestamptz '2026-10-01 15:00:00+00');
    insert into audit_log (operator_id, actor_tipo, superficie, accion, entidad, identificador)
      values ((select id from operators order by alta_en limit 1), 'sistema', 'sistema', 'cargar_lista_69b', 'lista_69b_snapshots', '${COPIA}');
    insert into lista_69b_rows (snapshot_id, rfc, situacion) values ('${COPIA}', 'PAL7202161U0', 'Presunto');
    insert into documents (id, company_id, clave_blob, hash_sha256, tipo, nombre_original, creado_en)
      values ('${DOCUMENTO}', '${EMPRESA}', 'constancias/${DOCUMENTO}', '${"a".repeat(64)}', 'application/pdf', 'constancia.pdf', now());
    insert into suppliers (id, company_id, document_id, snapshot_id, rfc, razon_social, lista_fecha, lista_leida_en, boton_pago, alta_en)
      values ('${PROVEEDOR}', '${EMPRESA}', '${DOCUMENTO}', '${COPIA}', 'AAA010101AAA', 'Proveedor Uno', date '2026-09-30', now(), true, now());
    insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador)
      select operator_id, '${EMPRESA}', 'miembro', '${LUIS}', 'cliente', 'alta_proveedor', 'suppliers', '${PROVEEDOR}' from companies where id = '${EMPRESA}';
    insert into supplier_clabes (id, company_id, supplier_id, clabe, digito_valido, vigente_desde)
      values ('${CLABE_ID}', '${EMPRESA}', '${PROVEEDOR}', '${CLABE}', true, now());
    insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador)
      select operator_id, '${EMPRESA}', 'miembro', '${LUIS}', 'cliente', 'clabe_proveedor', 'supplier_clabes', '${CLABE_ID}' from companies where id = '${EMPRESA}';
    commit;`);
  const operador = consultarJson<Array<{ id: string }>>(url, "select coalesce(json_agg(json_build_object('id', id)), '[]'::json) from operators");
  if (operador.length !== 1) throw new Error("Falta el operador de prueba");
  return operador[0]?.id ?? "";
}
