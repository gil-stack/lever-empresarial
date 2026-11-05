import assert from "node:assert/strict";
import { mock, test } from "node:test";

import pg from "pg";

import { cfdiDePrueba } from "../../src/dominio/cfdi.test.ts";
import { capacidadesDe, type RolCliente } from "../../src/nucleo/capacidades.ts";
import type { ContextoDeTenant } from "../../src/nucleo/contexto.ts";
import { cerrarConexion } from "../../src/nucleo/db.ts";
import { ErrorDeDominio } from "../../src/nucleo/error-de-dominio.ts";
import {
  cancelarPagoProveedor,
  crearPagoProveedor,
  descargarDocumentoProveedor,
  editarYReenviarPago,
  leerPagosProveedores,
  resolverPagoProveedor,
} from "../../src/server/pagos-proveedores/servicio.ts";
import type { AlmacenConstancia } from "../../src/server/proveedores/constancia.ts";
import { avisarCambioClabe } from "../../src/server/proveedores/avisos.ts";
import { cambiarClabeProveedor } from "../../src/server/proveedores/servicio-clabes.ts";
import type { MensajeCorreo } from "../../src/server/correo/tipos.ts";
import { DIRECTORIO_MIGRACIONES, evaluarEsquema } from "../aislamiento/esquema.ts";
import { aplicarArchivo, conBaseDesechable, consultarJson, ejecutar, exigirBaseDesechable, urlDeAplicacion } from "../aislamiento/postgres.ts";

const LUIS = "11111111-1111-4111-8111-111111111111";
const ROSA = "22222222-2222-4222-8222-222222222222";
const SOFIA = "12121212-1212-4212-8212-121212121212";
const CARLOS = "13131313-1313-4313-8313-131313131313";
const BETO = "14141414-1414-4414-8414-141414141414";
const EMPRESA = "33333333-3333-4333-8333-333333333333";
const OTRA = "99999999-9999-4999-8999-999999999999";
const PROVEEDOR = "44444444-4444-4444-8444-444444444444";
const PROVEEDOR_69B = "45454545-4545-4545-8545-454545454545";
const PROVEEDOR_CARRERA = "46464646-4646-4646-8646-464646464646";
const DOCUMENTO = "55555555-5555-4555-8555-555555555555";
const COPIA = "66666666-6666-4666-8666-666666666666";
const CLABE_ID = "77777777-7777-4777-8777-777777777777";
const CLABE = "002180701150123452";
const CLABE_NUEVA = "646180701150123452";
const AHORA = new Date("2026-11-05T12:00:00.000Z");
const PDF = new Uint8Array(80);
PDF.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
const SESION = { superficie: "cliente" as const, segundoFactor: { metodo: "totp" as const, en: new Date(AHORA) } };

test("cuentas por pagar contra Postgres: personas, versiones, CLABE, 69-B, SQL directo y concurrencia", async (t) => {
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
    const guardados: string[] = [];
    const borrados: string[] = [];
    const almacen: AlmacenConstancia = {
      async guardar(entrada) { guardados.push(entrada.clave); return { clave: entrada.clave }; },
      async borrar(clave) { borrados.push(clave); },
    };
    const deps = { almacen, ahora: () => new Date(AHORA) };
    const luis = contexto(LUIS, ["administrador", "liberador"], operadorId);
    const rosa = contexto(ROSA, ["liberador"], operadorId);
    const sofia = contexto(SOFIA, ["solicitante"], operadorId);
    const carlos = contexto(CARLOS, ["contador"], operadorId);
    const beto = contexto(BETO, ["liberador"], operadorId);
    const decidir = (ctx: ContextoDeTenant, requestId: string, decision: "autorizar" | "rechazar", visto: { version: number; total: number }, motivo?: string) =>
      resolverPagoProveedor(ctx, SESION, { requestId, decision, motivo, version: visto.version, totalCentavos: visto.total }, deps);
    const excepcion = (clientRequestId: string, supplierId = PROVEEDOR, monto = "1,250.50") => ({
      clientRequestId, supplierId, origen: "excepcion", pdf: { nombre: "soporte.pdf", bytes: PDF },
      monto, referencia: "Servicio extraordinario", emitidaEl: "2026-11-01",
      venceEl: "2026-11-30", programadaEl: "2026-11-07", motivoExcepcion: "Trabajo urgente autorizado por dirección",
    });
    const conCodigo = (codigo: string) => (error: unknown) => error instanceof ErrorDeDominio && error.codigo === codigo;

    try {
      const entradaCfdi = {
        clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
        supplierId: PROVEEDOR, origen: "cfdi", xml: { nombre: "factura.xml", bytes: cfdiDePrueba() },
        pdf: { nombre: "factura.pdf", bytes: PDF }, venceEl: "2026-11-30", programadaEl: "2026-11-06",
      };
      const pagoA = await crearPagoProveedor(luis, entradaCfdi, deps);
      const pagoB = await crearPagoProveedor(sofia, excepcion("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab1"), deps);
      const pagoC = await crearPagoProveedor(sofia, {
        ...entradaCfdi, clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac1",
        xml: { nombre: "otra.xml", bytes: cfdiConUuid("123E4567-E89B-42D3-A456-4266141740CC") },
      }, deps);

      await t.test("dos personas: quien solicita no autoriza y el CFDI repetido no sube archivos", async () => {
        await assert.rejects(() => decidir(luis, pagoA.requestId, "autorizar", { version: 1, total: 123456 }), conCodigo("pago_no_autorizable"));
        await assert.rejects(() => decidir(sofia, pagoB.requestId, "autorizar", { version: 1, total: 125050 }), conCodigo("sin_permiso"));
        await decidir(rosa, pagoA.requestId, "autorizar", { version: 1, total: 123456 });
        assert.equal(estado(url, pagoA.requestId), "listo_para_pagar");

        const subidosAntes = guardados.length;
        await assert.rejects(
          () => crearPagoProveedor(luis, { ...entradaCfdi, clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2" }, deps),
          conCodigo("cfdi_duplicado"),
        );
        assert.equal(guardados.length, subidosAntes, "el duplicado se detecta antes de subir archivos");
        assert.equal(borrados.length, 0, "y no deja huérfanos que borrar");
        const reintento = await crearPagoProveedor(sofia, excepcion("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab1"), deps);
        assert.deepEqual(reintento, { ...pagoB, existente: true });
        assert.equal(guardados.length, subidosAntes, "el reintento idempotente tampoco sube archivos");

        // El archivo sube antes de la transacción; si la transacción falla, se borra.
        const fallida = crearPagoProveedor(sofia, excepcion("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa94"), {
          ...deps,
          auditar: async (consulta, actor, hecho) => {
            if (hecho.accion === "solicitar_pago_proveedor") throw new ErrorDeDominio("auditoria_no_disponible");
            const { auditar } = await import("../../src/server/bitacora/auditar.ts");
            return auditar(consulta, actor, hecho);
          },
        });
        await assert.rejects(() => fallida, conCodigo("auditoria_no_disponible"));
        assert.equal(guardados.length, subidosAntes + 1);
        assert.deepEqual(borrados, [guardados.at(-1)], "la evidencia subida se limpia al revertir");
        const huerfano = consultarJson<Array<{ n: number }>>(url, `select json_agg(json_build_object('n', count)) from (
          select count(*)::int from supplier_payment_requests where client_request_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa94') c`);
        assert.equal(huerfano[0]?.n, 0);
        borrados.length = 0;
      });

      await t.test("se autoriza la versión que vio quien decide, no la que haya ahora", async () => {
        await assert.rejects(() => decidir(rosa, pagoB.requestId, "autorizar", { version: 2, total: 125050 }), conCodigo("pago_cambio_en_revision"));
        await assert.rejects(() => decidir(rosa, pagoB.requestId, "autorizar", { version: 1, total: 999 }), conCodigo("pago_cambio_en_revision"));
        assert.equal(estado(url, pagoB.requestId), "por_autorizar");
      });

      await t.test("el rechazo se conserva en el historial y subir el importe exige evidencia nueva", async () => {
        await decidir(rosa, pagoB.requestId, "rechazar", { version: 1, total: 125050 }, "Falta desglose del trabajo");
        const correccion = { origen: "excepcion", monto: "2,000.00", referencia: "Servicio extraordinario", emitidaEl: "2026-11-01",
          venceEl: "2026-11-30", programadaEl: "2026-11-08", motivoExcepcion: "Trabajo urgente con desglose anexado por dirección" };
        await assert.rejects(() => editarYReenviarPago(rosa, pagoB.requestId, correccion, deps), conCodigo("pago_no_autorizable"));
        const subidosAntes = guardados.length;
        await assert.rejects(() => editarYReenviarPago(sofia, pagoB.requestId, correccion, deps), conCodigo("evidencia_requerida"));
        assert.equal(guardados.length, subidosAntes, "sin evidencia no se sube nada");
        await editarYReenviarPago(sofia, pagoB.requestId, { ...correccion, pdf: { nombre: "desglose.pdf", bytes: PDF } }, deps);
        assert.equal(estado(url, pagoB.requestId), "por_autorizar");
        assert.equal(guardados.length, subidosAntes + 1);
        const evidencias = consultarJson<Array<{ n: number }>>(url, `select json_agg(json_build_object('n', count)) from (
          select count(*)::int from supplier_payable_documents where payable_id = '${pagoB.payableId}' and tipo = 'evidencia') c`);
        assert.equal(evidencias[0]?.n, 2);

        const lectura = await leerPagosProveedores(rosa, { pagoId: pagoB.requestId }, deps);
        const rechazo = lectura.historial.find((version) => version.estado === "rechazado");
        assert.equal(rechazo?.resolvio, "Rosa");
        assert.equal(rechazo?.motivo, "Falta desglose del trabajo");
        assert.equal(rechazo?.totalCentavos, 125050);
        assert.equal(lectura.pagos[0]?.totalCentavos, 200000);
        assert.equal(lectura.pagos[0]?.version, 2);

        await assert.rejects(() => decidir(luis, pagoB.requestId, "autorizar", { version: 1, total: 125050 }), conCodigo("pago_cambio_en_revision"));
        await decidir(luis, pagoB.requestId, "autorizar", { version: 2, total: 200000 });
        assert.equal(estado(url, pagoB.requestId), "listo_para_pagar");
      });

      await t.test("la base protege cargo y solicitud aunque se escriba SQL directo", async () => {
        await decidir(rosa, pagoC.requestId, "rechazar", { version: 1, total: 123456 }, "Fecha prevista equivocada");
        assert.throws(() => comoCliente(url, CARLOS, `update supplier_payables set total_centavos = 1 where id = '${pagoA.payableId}'`), /cargo_proveedor_no_editable/);
        assert.throws(() => comoCliente(url, LUIS, `update supplier_payables set total_centavos = 1 where id = '${pagoC.payableId}'`), /cargo_proveedor_no_editable/);
        assert.throws(() => comoCliente(url, SOFIA, `update supplier_payables set total_centavos = 1 where id = '${pagoC.payableId}'`), /cargo_cfdi_inmutable/);
        assert.throws(() => comoCliente(url, SOFIA, `update supplier_payables set folio = '999' where id = '${pagoC.payableId}'`), /cargo_cfdi_inmutable/);
        assert.throws(() => comoCliente(url, SOFIA, `update supplier_payables set emitida_el = emitida_el - 1 where id = '${pagoC.payableId}'`), /cargo_cfdi_inmutable/);
        assert.throws(() => comoCliente(url, ROSA, `update supplier_payment_requests set clabe = '${CLABE_NUEVA}' where id = '${pagoA.requestId}'`), /pago_proveedor_transicion_invalida/);
        assert.throws(() => comoCliente(url, ROSA, `update supplier_payment_requests set estado = 'por_autorizar', resuelto_por = null, resuelto_en = null, version = version + 1 where id = '${pagoA.requestId}'`), /pago_proveedor_regreso_sin_causa/);
        assert.throws(() => comoCliente(url, ROSA, `delete from supplier_payment_requests where id = '${pagoA.requestId}'`), /permission denied|no_se_borra/);
        assert.throws(() => comoCliente(url, ROSA, `delete from supplier_payment_request_history`), /permission denied|historial_pago_inmutable/);
        assert.throws(() => comoCliente(url, ROSA, `insert into supplier_payment_request_history (company_id, request_id, version, estado, estado_nuevo, supplier_clabe_id, clabe, total_centavos, programada_el, solicitado_por, solicitado_en)
          values ('${EMPRESA}', '${pagoA.requestId}', 9, 'rechazado', 'cancelado', '${CLABE_ID}', '${CLABE}', 1, date '2026-11-30', '${LUIS}', now())`), /permission denied/);

        const roles = consultarJson<Array<{ propia: boolean; ajena: boolean; liberadores: number }>>(url, `begin;
          set local role plataforma_cliente;
          select set_config('app.company_id', '${OTRA}', true), set_config('app.user_id', '${ROSA}', true);
          select json_agg(json_build_object(
            'propia', cliente_tiene_rol_operativo('${EMPRESA}', '${ROSA}', array['liberador']),
            'ajena', cliente_tiene_rol_operativo('${OTRA}', '${ROSA}', array['liberador']),
            'liberadores', cliente_liberadores_operativos('${EMPRESA}')));
          rollback;`);
        assert.deepEqual(roles[0], { propia: false, ajena: false, liberadores: 0 }, "con otra empresa en el contexto las funciones dicen que no");
      });

      await t.test("una escritura sin su evento de bitácora se revierte completa", async () => {
        const antes = consultarJson<Array<{ vence: string }>>(url, `select json_agg(json_build_object('vence', vence_el::text)) from supplier_payables where id = '${pagoC.payableId}'`);
        assert.throws(() => comoCliente(url, SOFIA, `update supplier_payables set vence_el = vence_el + 1, actualizado_en = now() where id = '${pagoC.payableId}'`), /auditoria_pago_proveedor_ausente/);
        const despues = consultarJson<Array<{ vence: string }>>(url, `select json_agg(json_build_object('vence', vence_el::text)) from supplier_payables where id = '${pagoC.payableId}'`);
        assert.deepEqual(despues, antes);
        const pagoR = await crearPagoProveedor(sofia, excepcion("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa91"), deps);
        assert.throws(() => comoCliente(url, ROSA, autorizarSql(pagoR.requestId, ROSA)), /auditoria_pago_proveedor_ausente/);
        assert.equal(estado(url, pagoR.requestId), "por_autorizar", "la autorización sin evento no quedó");
        const historial = consultarJson<Array<{ n: number }>>(url, `select json_agg(json_build_object('n', count)) from (
          select count(*)::int from supplier_payment_request_history where request_id = '${pagoR.requestId}') c`);
        assert.equal(historial[0]?.n, 0, "ni su versión en el historial");
      });

      await t.test("el contador y un liberador dado de baja no autorizan, ni por servicio ni por SQL", async () => {
        const pagoD = await crearPagoProveedor(sofia, excepcion("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaad1"), deps);
        await assert.rejects(() => decidir(carlos, pagoD.requestId, "autorizar", { version: 1, total: 125050 }), conCodigo("sin_permiso"));
        assert.throws(() => comoCliente(url, CARLOS, autorizarSql(pagoD.requestId, CARLOS)), /sin_permiso_para_liberar/);
        darDeBaja(url, operadorId, BETO);
        await assert.rejects(() => decidir(beto, pagoD.requestId, "autorizar", { version: 1, total: 125050 }), conCodigo("sin_permiso_para_liberar"));
        assert.throws(() => comoCliente(url, BETO, autorizarSql(pagoD.requestId, BETO)), /sin_permiso_para_liberar/);
        assert.equal(estado(url, pagoD.requestId), "por_autorizar");
      });

      await t.test("el cambio de CLABE regresa los pagos listos a revisión en la misma transacción", async () => {
        const resultado = await cambiarClabeProveedor(luis, { supplierId: PROVEEDOR, clabe: CLABE_NUEVA }, SESION, { avisar: async () => 0, ahora: () => new Date(AHORA) });
        assert.deepEqual(resultado, { tipo: "cambiada", pagosRegresados: 2, avisosEnviados: 0 });
        for (const id of [pagoA.requestId, pagoB.requestId]) assert.equal(estado(url, id), "por_autorizar");
        const eventos = consultarJson<Array<{ actor_tipo: string; actor_id: string; motivo: string }>>(url, `select json_agg(json_build_object('actor_tipo', actor_tipo, 'actor_id', actor_id, 'motivo', motivo))
          from audit_log where accion = 'regresar_pago_proveedor' and identificador = '${pagoA.requestId}'`);
        assert.equal(eventos.length, 1);
        assert.equal(eventos[0]?.actor_tipo, "miembro");
        assert.equal(eventos[0]?.actor_id, LUIS);
        assert.match(eventos[0]?.motivo ?? "", /CLABE/);

        const lectura = await leerPagosProveedores(rosa, { pagoId: pagoA.requestId }, deps);
        assert.equal(lectura.pagos[0]?.bloqueo, "clabe_cambiada");
        assert.equal(lectura.historial[0]?.estado, "listo_para_pagar");
        assert.equal(lectura.historial[0]?.resolvio, "Rosa");
        assert.match(lectura.historial[0]?.motivo ?? "", /CLABE/);

        await assert.rejects(() => decidir(rosa, pagoA.requestId, "autorizar", { version: 2, total: 123456 }), conCodigo("pago_no_autorizable"));
        await decidir(rosa, pagoA.requestId, "rechazar", { version: 2, total: 123456 }, "Cambió la CLABE, vuelve a solicitar");
        await editarYReenviarPago(luis, pagoA.requestId, { origen: "cfdi", venceEl: "2026-11-30", programadaEl: "2026-11-09" }, deps);
        await decidir(rosa, pagoA.requestId, "autorizar", { version: 3, total: 123456 });
        const instruccion = consultarJson<Array<{ clabe: string; estado: string }>>(url, `select json_agg(json_build_object('clabe', clabe, 'estado', estado)) from supplier_payment_requests where id = '${pagoA.requestId}'`);
        assert.deepEqual(instruccion[0], { clabe: CLABE_NUEVA, estado: "listo_para_pagar" });
      });

      await t.test("un pago listo se cancela con motivo, un rechazado lo cancela quien solicitó y el UUID queda libre", async () => {
        await assert.rejects(() => cancelarPagoProveedor(sofia, { requestId: pagoA.requestId, motivo: "Ya no aplica" }, deps), conCodigo("cancelacion_no_permitida"));
        await cancelarPagoProveedor(rosa, { requestId: pagoA.requestId, motivo: "El proveedor pidió reprogramar" }, deps);
        assert.equal(estado(url, pagoA.requestId), "cancelado");
        const anulado = consultarJson<Array<{ anulado: boolean }>>(url, `select json_agg(json_build_object('anulado', anulado_en is not null)) from supplier_payables where id = '${pagoA.payableId}'`);
        assert.equal(anulado[0]?.anulado, true);
        const recaptura = await crearPagoProveedor(sofia, { ...entradaCfdi, clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3" }, deps);
        assert.equal(recaptura.existente, false, "el mismo UUID se captura de nuevo tras cancelar");

        await assert.rejects(() => cancelarPagoProveedor(rosa, { requestId: pagoC.requestId, motivo: "No me corresponde" }, deps), conCodigo("cancelacion_no_permitida"));
        await cancelarPagoProveedor(sofia, { requestId: pagoC.requestId, motivo: "La factura se volverá a emitir" }, deps);
        assert.equal(estado(url, pagoC.requestId), "cancelado");
        assert.throws(() => comoCliente(url, SOFIA, `update supplier_payables set anulado_en = null where id = '${pagoC.payableId}'`), /cargo_proveedor_no_editable/);
      });

      await t.test("la lista 69-B posterior a la autorización regresa el pago a revisión", async () => {
        const pagoE = await crearPagoProveedor(sofia, excepcion("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaae1", PROVEEDOR_69B), deps);
        await decidir(rosa, pagoE.requestId, "autorizar", { version: 1, total: 125050 });
        cargarLista(url, operadorId, "aaaaaaaa-0000-4000-8000-000000000001", "2026-10-31", ["BBB020202BA2"]);
        assert.equal(estado(url, pagoE.requestId), "por_autorizar");
        const evento = consultarJson<Array<{ actor_tipo: string }>>(url, `select json_agg(json_build_object('actor_tipo', actor_tipo)) from audit_log
          where accion = 'regresar_pago_proveedor' and identificador = '${pagoE.requestId}'`);
        assert.deepEqual(evento, [{ actor_tipo: "sistema" }]);
        await assert.rejects(() => decidir(rosa, pagoE.requestId, "autorizar", { version: 2, total: 125050 }), conCodigo("pago_no_autorizable"));
        const lectura = await leerPagosProveedores(rosa, { pagoId: pagoE.requestId }, deps);
        assert.equal(lectura.pagos[0]?.bloqueo, "proveedor_bloqueado");
      });

      await t.test("concurrencia: dos liberadores a la vez, y la carga 69-B espera a la autorización en vuelo", async () => {
        const pagoF = await crearPagoProveedor(sofia, excepcion("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaf1"), deps);
        const dos = await Promise.allSettled([
          decidir(rosa, pagoF.requestId, "autorizar", { version: 1, total: 125050 }),
          decidir(luis, pagoF.requestId, "rechazar", { version: 1, total: 125050 }, "Rechazo simultáneo"),
        ]);
        assert.equal(dos.filter((resultado) => resultado.status === "fulfilled").length, 1, "solo una decisión gana");
        const perdedora = dos.find((resultado) => resultado.status === "rejected");
        assert.equal(perdedora?.status === "rejected" && conCodigo("pago_cambio_en_revision")(perdedora.reason), true);
        assert.equal(estado(url, pagoF.requestId), dos[0]?.status === "fulfilled" ? "listo_para_pagar" : "rechazado");

        // Orden 1: la autorización toma el proveedor FOR SHARE; la relectura 69-B espera y luego la regresa.
        const pagoG = await crearPagoProveedor(sofia, excepcion("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa92", PROVEEDOR_CARRERA), deps);
        const autoriza = new pg.Client({ connectionString: url });
        const carga = new pg.Client({ connectionString: url });
        await autoriza.connect();
        await carga.connect();
        try {
          await autoriza.query("begin");
          await autoriza.query("set local role plataforma_cliente");
          await autoriza.query("select set_config('app.company_id', $1, true), set_config('app.user_id', $2, true)", [EMPRESA, ROSA]);
          await autoriza.query(autorizarSql(pagoG.requestId, ROSA));
          await autoriza.query(`insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador)
            values ($1, $2, 'miembro', $3, 'cliente', 'autorizar_pago_proveedor', 'supplier_payment_requests', $4)`, [operadorId, EMPRESA, ROSA, pagoG.requestId]);
          await carga.query("begin");
          await carga.query(sqlCarga(operadorId, "aaaaaaaa-0000-4000-8000-000000000002", "2026-11-01", ["DDD040404DA1"]));
          const cierre = carga.query("commit");
          await esperarCandado(url);
          await autoriza.query("commit");
          await cierre;
        } finally {
          await autoriza.end();
          await carga.end();
        }
        assert.equal(estado(url, pagoG.requestId), "por_autorizar", "la autorización que ganó el candado se regresó al cerrar la carga");
        const regreso = consultarJson<Array<{ estado: string; nuevo: string }>>(url, `select json_agg(json_build_object('estado', estado, 'nuevo', estado_nuevo) order by cerrado_en)
          from supplier_payment_request_history where request_id = '${pagoG.requestId}'`);
        assert.deepEqual(regreso.at(-1), { estado: "listo_para_pagar", nuevo: "por_autorizar" });

        // Orden 2: la relectura toma el proveedor primero; la autorización espera y ve el bloqueo.
        const pagoH = await crearPagoProveedor(sofia, excepcion("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa93"), deps);
        const relee = new pg.Client({ connectionString: url });
        await relee.connect();
        try {
          await relee.query("begin");
          await relee.query(sqlCarga(operadorId, "aaaaaaaa-0000-4000-8000-000000000003", "2026-11-02", ["AAA010101AAA"]));
          await relee.query("select releer_proveedores_69b($1, now())", ["aaaaaaaa-0000-4000-8000-000000000003"]);
          const intento = decidir(rosa, pagoH.requestId, "autorizar", { version: 1, total: 125050 }).then(() => null, (error: unknown) => error);
          await esperarCandado(url);
          await relee.query("commit");
          const error = await intento;
          assert.equal(conCodigo("pago_no_autorizable")(error), true, "la autorización ve al proveedor ya bloqueado");
        } finally {
          await relee.end();
        }
        assert.equal(estado(url, pagoH.requestId), "por_autorizar");
      });

      await t.test("el aviso de CLABE que falla se registra sin datos sensibles", async () => {
        const correos: MensajeCorreo[] = [];
        const avisados = await avisarCambioClabe(luis, { supplierId: PROVEEDOR, clabeId: CLABE_ID, clabe: CLABE_NUEVA, ahora: AHORA }, async (mensaje) => {
          correos.push(mensaje);
          return { id: `correo-${correos.length}` };
        });
        assert.equal(avisados, 2);
        assert.deepEqual(correos.map((correo) => correo.para).sort(), ["luis-pagos@ejemplo.mx", "rosa-pagos@ejemplo.mx"]);
        assert.equal(correos.every((correo) => !correo.html.includes(CLABE_NUEVA) && !correo.texto.includes(CLABE_NUEVA)), true);

        const registro = mock.method(console, "error", () => undefined);
        try {
          const fallidos = await avisarCambioClabe(luis, { supplierId: PROVEEDOR, clabeId: CLABE_ID, clabe: CLABE_NUEVA, ahora: AHORA }, async (mensaje) => {
            throw new Error(`El proveedor de correo rechazó ${mensaje.para}`);
          });
          assert.equal(fallidos, 0);
          assert.equal(registro.mock.callCount(), 2);
          for (const llamada of registro.mock.calls) {
            const linea = String(llamada.arguments[0]);
            const datos = JSON.parse(linea) as Record<string, unknown>;
            assert.equal(datos.evento, "aviso_clabe_envio_fallido");
            assert.equal(datos.empresa, EMPRESA);
            assert.doesNotMatch(linea, /@|646180701150123452|rechazó/);
          }
        } finally {
          registro.mock.restore();
        }
      });

      await t.test("quien solicita ve la terminación de la CLABE y no descarga constancias", async () => {
        const lectura = await leerPagosProveedores(sofia, {}, deps);
        assert.equal(lectura.proveedores.every((proveedor) => proveedor.clabe === null && proveedor.constanciaId === null), true);
        assert.equal(lectura.pagos.every((pago) => pago.clabe === null && /^\d{4}$/.test(pago.clabeFinal)), true);
        assert.equal(lectura.documentos.every((documento) => documento.payableId !== null), true);
        await assert.rejects(() => descargarDocumentoProveedor(sofia, DOCUMENTO, { ...deps, leer: async () => new Response(PDF).body as ReadableStream<Uint8Array> }), conCodigo("archivo_no_disponible"));
        const completa = await leerPagosProveedores(rosa, {}, deps);
        assert.equal(completa.proveedores.some((proveedor) => proveedor.clabe === CLABE_NUEVA), true);

        // Un documento de la empresa que no es de un proveedor ni de un cargo no sale por esta ruta.
        const ajeno = "56565656-5656-4656-8656-565656565656";
        ejecutar(url, `insert into documents (id, company_id, clave_blob, hash_sha256, tipo, nombre_original, creado_en)
          values ('${ajeno}', '${EMPRESA}', 'nomina/${ajeno}', '${"b".repeat(64)}', 'application/pdf', 'nomina.pdf', now())`);
        let leido = false;
        const lector = { ...deps, leer: async () => { leido = true; return new Response(PDF).body as ReadableStream<Uint8Array>; } };
        await assert.rejects(() => descargarDocumentoProveedor(rosa, ajeno, lector), conCodigo("archivo_no_disponible"));
        assert.equal(leido, false, "ni siquiera se lee del almacén");
      });

      const aislamiento = consultarJson<Array<{ cargos: number; solicitudes: number; historial: number }>>(url, `begin;
        set local role plataforma_cliente;
        select set_config('app.company_id', '${OTRA}', true);
        select json_agg(fila) from (
          select (select count(*) from supplier_payables) as cargos,
                 (select count(*) from supplier_payment_requests) as solicitudes,
                 (select count(*) from supplier_payment_request_history) as historial
        ) fila;
        rollback;`);
      assert.deepEqual(aislamiento[0], { cargos: 0, solicitudes: 0, historial: 0 });
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

/** SQL directo con el rol del portal, como lo haría alguien que se salta el servicio. */
function comoCliente(url: string, userId: string, sql: string): void {
  ejecutar(url, `begin;
    set local role plataforma_cliente;
    select set_config('app.company_id', '${EMPRESA}', true), set_config('app.user_id', '${userId}', true);
    ${sql};
    commit;`);
}

function autorizarSql(requestId: string, userId: string): string {
  return `update supplier_payment_requests set estado = 'listo_para_pagar', resuelto_por = '${userId}', resuelto_en = now()
    where id = '${requestId}'`;
}

async function esperarCandado(url: string): Promise<void> {
  for (let intento = 0; intento < 100; intento += 1) {
    const esperando = consultarJson<Array<{ n: number }>>(url, `select json_agg(json_build_object('n', count)) from (
      select count(*)::int from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock') c`);
    if ((esperando[0]?.n ?? 0) > 0) return;
    await new Promise((listo) => setTimeout(listo, 50));
  }
  throw new Error("La segunda transacción nunca esperó el candado");
}

function sqlCarga(operadorId: string, copia: string, fecha: string, rfcs: string[]): string {
  return `insert into lista_69b_snapshots (id, fecha_archivo, cargado_en) values ('${copia}', date '${fecha}', now());
    insert into audit_log (operator_id, actor_tipo, superficie, accion, entidad, identificador)
      values ('${operadorId}', 'sistema', 'sistema', 'cargar_lista_69b', 'lista_69b_snapshots', '${copia}');
    insert into lista_69b_rows (snapshot_id, rfc, situacion) values ${rfcs.map((rfc) => `('${copia}', '${rfc}', 'Presunto')`).join(", ")};`;
}

function cargarLista(url: string, operadorId: string, copia: string, fecha: string, rfcs: string[]): void {
  ejecutar(url, `begin; ${sqlCarga(operadorId, copia, fecha, rfcs)} commit;`);
}

/** Baja efectiva hoy: el maestro quita el rol de liberador y la función ya no lo cuenta. */
function darDeBaja(url: string, operadorId: string, userId: string): void {
  const centro = "15151515-1515-4515-8515-151515151515";
  const persona = "16161616-1616-4616-8616-161616161616";
  ejecutar(url, `begin;
    insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador)
      values ('${operadorId}', '${EMPRESA}', 'miembro', '${LUIS}', 'cliente', 'alta_centro_costo', 'cost_centers', '${centro}'),
             ('${operadorId}', '${EMPRESA}', 'miembro', '${LUIS}', 'cliente', 'alta_persona', 'employees', '${persona}'),
             ('${operadorId}', '${EMPRESA}', 'miembro', '${LUIS}', 'cliente', 'baja_persona', 'employees', '${persona}');
    insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, cambio)
      values ('${operadorId}', '${EMPRESA}', 'miembro', '${LUIS}', 'cliente', 'quitar_liberador', 'membership_roles', '${userId}', '{"rol":"liberador"}');
    insert into cost_centers (id, company_id, nombre) values ('${centro}', '${EMPRESA}', 'Finanzas');
    insert into employees (id, company_id, user_id, cost_center_id, nombre, alta_en, baja_en, clabe, clabe_digito_valido)
      values ('${persona}', '${EMPRESA}', '${userId}', '${centro}', 'Beto', current_date - 30,
        (timezone('America/Mexico_City', clock_timestamp()))::date, '${CLABE}', true);
    commit;`);
}

function cfdiConUuid(uuid: string): Uint8Array {
  const xml = new TextDecoder().decode(cfdiDePrueba());
  return new TextEncoder().encode(xml.replace(/UUID="[^"]+"/, `UUID="${uuid}"`));
}

function contexto(userId: string, roles: RolCliente[], operadorId: string): ContextoDeTenant {
  const nombres: Record<string, string> = { [LUIS]: "Luis", [ROSA]: "Rosa", [SOFIA]: "Sofía", [CARLOS]: "Carlos", [BETO]: "Beto" };
  return {
    sesionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", peticionId: null, superficie: "cliente",
    persona: { id: userId, nombre: nombres[userId] ?? "Persona", correo: `${userId.slice(0, 8)}@ejemplo.mx` },
    segundoFactor: "totp",
    empresa: { id: EMPRESA, rfc: "EKU9003173C9", razonSocial: "Escuela Kemper", operadorId, estado: "activa", demostracion: true },
    roles, personal: null, empresas: [], capacidades: capacidadesDe({ rolesCliente: roles, rolesPlataforma: [] }),
  };
}

function sembrar(url: string): string {
  const personas: Array<[string, string, string, string[]]> = [
    [LUIS, "Luis", "luis-pagos@ejemplo.mx", ["administrador", "liberador"]],
    [ROSA, "Rosa", "rosa-pagos@ejemplo.mx", ["liberador"]],
    [SOFIA, "Sofía", "sofia-pagos@ejemplo.mx", ["solicitante"]],
    [CARLOS, "Carlos", "carlos-pagos@ejemplo.mx", ["contador"]],
    [BETO, "Beto", "beto-pagos@ejemplo.mx", ["liberador"]],
  ];
  const roles = personas.flatMap(([id, , , lista]) => lista.map((rol) => `
    insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, cambio)
      select operator_id, '${EMPRESA}', 'miembro', '${LUIS}', 'cliente', 'asignar_rol', 'membership_roles', '${id}', '{"rol":"${rol}"}' from companies where id = '${EMPRESA}';
    insert into membership_roles (user_id, company_id, rol) values ('${id}', '${EMPRESA}', '${rol}');`)).join("\n");
  const proveedores: Array<[string, string, string, string]> = [
    [PROVEEDOR, "AAA010101AAA", "Proveedor Uno", CLABE_ID],
    [PROVEEDOR_69B, "BBB020202BA2", "Proveedor Dos", "78787878-7878-4878-8878-787878787878"],
    [PROVEEDOR_CARRERA, "DDD040404DA1", "Proveedor Tres", "79797979-7979-4979-8979-797979797979"],
  ];
  const altas = proveedores.map(([id, rfc, nombre, clabeId], indice) => `
    insert into documents (id, company_id, clave_blob, hash_sha256, tipo, nombre_original, creado_en)
      values ('${indice === 0 ? DOCUMENTO : `5555555${indice}-5555-4555-8555-555555555555`}', '${EMPRESA}', 'constancias/${id}', '${"a".repeat(64)}', 'application/pdf', 'constancia.pdf', now());
    insert into suppliers (id, company_id, document_id, snapshot_id, rfc, razon_social, lista_fecha, lista_leida_en, boton_pago, alta_en)
      values ('${id}', '${EMPRESA}', '${indice === 0 ? DOCUMENTO : `5555555${indice}-5555-4555-8555-555555555555`}', '${COPIA}', '${rfc}', '${nombre}', date '2026-09-30', now(), true, now());
    insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador)
      select operator_id, '${EMPRESA}', 'miembro', '${LUIS}', 'cliente', 'alta_proveedor', 'suppliers', '${id}' from companies where id = '${EMPRESA}';
    insert into supplier_clabes (id, company_id, supplier_id, clabe, digito_valido, vigente_desde)
      values ('${clabeId}', '${EMPRESA}', '${id}', '${CLABE}', true, now() - interval '1 day');
    insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador)
      select operator_id, '${EMPRESA}', 'miembro', '${LUIS}', 'cliente', 'clabe_proveedor', 'supplier_clabes', '${clabeId}' from companies where id = '${EMPRESA}';`).join("\n");
  ejecutar(url, `begin;
    insert into users (id, nombre, correo) values ${personas.map(([id, nombre, correo]) => `('${id}', '${nombre}', '${correo}')`).join(", ")};
    insert into companies (id, rfc, razon_social, codigo_postal, regimen, uso_cfdi, operator_id, estado, demostracion)
      values ('${EMPRESA}', 'EKU9003173C9', 'Escuela Kemper', '06600', '601', 'G03',
        (select id from operators order by alta_en limit 1), 'activa', true);
    insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador)
      values ((select id from operators order by alta_en limit 1), '${EMPRESA}', 'miembro', '${LUIS}', 'cliente', 'alta_empresa', 'companies', '${EMPRESA}');
    insert into memberships (user_id, company_id, estado) values ${personas.map(([id]) => `('${id}', '${EMPRESA}', 'activa')`).join(", ")};
    ${roles}
    insert into lista_69b_snapshots (id, fecha_archivo, cargado_en) values ('${COPIA}', date '2026-09-30', timestamptz '2026-10-01 15:00:00+00');
    insert into audit_log (operator_id, actor_tipo, superficie, accion, entidad, identificador)
      values ((select id from operators order by alta_en limit 1), 'sistema', 'sistema', 'cargar_lista_69b', 'lista_69b_snapshots', '${COPIA}');
    insert into lista_69b_rows (snapshot_id, rfc, situacion) values ('${COPIA}', 'PAL7202161U0', 'Presunto');
    ${altas}
    commit;`);
  const operador = consultarJson<Array<{ id: string }>>(url, "select coalesce(json_agg(json_build_object('id', id)), '[]'::json) from operators");
  if (operador.length !== 1) throw new Error("Falta el operador de prueba");
  return operador[0]?.id ?? "";
}
