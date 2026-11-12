import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { cerrarConexion } from "../../src/nucleo/db.ts";
import type { ContextoDeTenant } from "../../src/nucleo/contexto.ts";
import { ErrorDeDominio } from "../../src/nucleo/error-de-dominio.ts";
import { darDeAltaComoDuena } from "../../scripts/empresa-por-la-duena.ts";
import { clienteHttpEfevoo } from "../../src/server/efevoo/cliente.ts";
import type { ConfigEfevoo } from "../../src/server/efevoo/config.ts";
import {
  conciliarOperacionEfevoo,
  ejecutarOperacionEfevoo,
  llamadaEstandar,
  reintentarOperacionEfevoo,
  saldoDeEmpresaEfevoo,
  type DependenciasOperacion,
  type EntradaOperacion,
} from "../../src/server/efevoo/operaciones.ts";
import { nombrarCentro } from "../../src/server/personas/servicio.ts";
import { contextoDePersonal } from "../../src/server/plataforma/servicio.ts";
import { aplicarArchivo, conBaseDesechable, consultarJson, ejecutar, exigirBaseDesechable, urlDeAplicacion } from "../aislamiento/postgres.ts";
import { administrador, persona, sembrarPersonal } from "../cobranza/siembra.ts";
import { iniciarEfevooFalso, ultimos8De, type EfevooFalso } from "./servidor-falso.ts";

/**
 * El ciclo asentar → llamar → resolver y la conciliación, con la base real
 * (0033) y el Efevoo falso por HTTP. Cada regla de dinero con su caso: doble
 * clic, timeout incierto sin reintento, conciliación por referencia, «no
 * apareció» solo después de 10 minutos y el reintento ligado, falso éxito con
 * id 0, saldos que valida Lever, 901, 401 y permisos.
 */

const urlAdmin = process.env.AISLAMIENTO_DATABASE_URL?.trim() ?? "";
const RAZON = "Escuela Alfa Ciclo";
const TITULAR = {
  nombre: "PRUEBA", primerApellido: "LEVER", segundoApellido: "UNO", nombreEmbozar: "PRUEBA LEVER",
  telefono: "5500000001", correo: "titular-ciclo@lever.test", paisNacimiento: "México", domicilio: "Calle Prueba 1",
};

describe("Efevoo: el ciclo de una operación (servicio + 0033 + Efevoo falso)", { skip: urlAdmin.length === 0 }, () => {
  it("asienta, llama, resuelve y concilia con cada regla de dinero", async () => {
    exigirBaseDesechable();
    const falso = await iniciarEfevooFalso(0);
    try {
      await conBaseDesechable(urlAdmin, async (url) => {
        const dir = join(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");
        for (const archivo of readdirSync(dir).sort()) {
          if (archivo.endsWith(".sql")) aplicarArchivo(url, join(dir, archivo));
        }
        await cerrarConexion();
        const previo = process.env.DATABASE_URL;
        process.env.DATABASE_URL = urlDeAplicacion(url);
        try {
          await ciclo(url, falso);
        } finally {
          await cerrarConexion();
          if (previo === undefined) delete process.env.DATABASE_URL;
          else process.env.DATABASE_URL = previo;
        }
      });
    } finally {
      await falso.cerrar();
    }
  });
});

async function ciclo(url: string, falso: EfevooFalso): Promise<void> {
  sembrarPersonal(url);
  const personal = await contextoDePersonal("personal-cobranza@ejemplo.mx");
  const alfa = await darDeAltaComoDuena(url, personal, { rfc: "TCM010101AB1", razonSocial: RAZON, codigoPostal: "06600", regimen: "601", usoCfdi: "G03" },
    { demostracion: false, corridoPor: "pruebas@ejemplo.mx" });
  const [admin] = await administrador(url, personal, alfa, "admin-ciclo@ejemplo.mx");
  const centro = await nombrarCentro(admin, { nombre: "Operación" }, { ahora: () => new Date("2026-11-10T18:00:00.000Z") });
  const liberador = await persona(url, admin, centro.id, "Liberadora Ciclo", "liberadora-ciclo@ejemplo.mx", ["liberador"]);
  const contador = await persona(url, admin, centro.id, "Contadora Ciclo", "contadora-ciclo@ejemplo.mx", ["contador"]);
  const titular = await persona(url, admin, centro.id, "Titular Ciclo", "titular-ciclo@ejemplo.mx", ["tarjetahabiente"]);
  const uno = <T>(sql: string) => consultarJson<T[]>(url, `select coalesce(jsonb_agg(x), '[]'::jsonb) from (${sql}) x`);
  const empleado = uno<{ id: string }>(`select e.id from employees e join users u on u.id = e.user_id where u.correo = 'titular-ciclo@ejemplo.mx'`)[0]!.id;

  const config: ConfigEfevoo = { url: `${falso.url}/v1/apiservice`, usuario: falso.usuario, llave: falso.llave, ambiente: "sandbox" };
  const deps = (extra: Partial<DependenciasOperacion> = {}): DependenciasOperacion => ({ config, efevoo: clienteHttpEfevoo(config, fetch, 400), ...extra });
  const E = alfa.id;
  const entrada = (e: Omit<EntradaOperacion, "llave" | "companyId"> & { llave?: string }): EntradaOperacion => ({ llave: randomUUID(), companyId: E, ...e });
  const llamadas = () => falso.estado().tarjetas.reduce((s, t) => s + t.transacciones.length, 0);
  const rechazo = async (p: Promise<unknown>, codigo: string) => {
    await assert.rejects(p, (e: unknown) => e instanceof ErrorDeDominio && e.codigo === codigo, codigo);
  };

  // O1: alta. Doble clic: la misma llave regresa la misma operación y Efevoo tiene un solo cliente.
  const llaveAlta = randomUUID();
  const crear = (ctx: ContextoDeTenant) => ejecutarOperacionEfevoo(ctx, entrada({ tipo: "alta_cliente", llave: llaveAlta }),
    async (_op, efevoo) => String((await efevoo.crearCliente({ correo: "alfa-ciclo@lever.test", razonSocial: RAZON })).idepCliente), deps());
  const alta = await crear(personal);
  assert.deepEqual([alta.estado, alta.idEfevoo, alta.nueva], ["confirmada", "300", true]);
  const otraVez = await crear(personal);
  assert.deepEqual([otraVez.id, otraVez.nueva], [alta.id, false]);
  assert.equal(falso.estado().clientes.length, 1, "doble clic en el alta: un solo cliente en Efevoo");
  assert.equal(uno<{ idep_cliente: number }>(`select idep_cliente from efevoo_clientes where company_id = '${E}'`)[0]!.idep_cliente, 300);

  // O2: depósito de prueba con su saldo previo anotado; doble clic deja uno.
  const efevoo = deps().efevoo!;
  const llaveDeposito = randomUUID();
  const depositar = () => saldoDeEmpresaEfevoo(efevoo, 300).then((saldo) => ejecutarOperacionEfevoo(personal,
    entrada({ tipo: "deposito_prueba", llave: llaveDeposito, montoCentavos: 100_000, saldoPrevioCentavos: saldo }), llamadaEstandar, deps()));
  const deposito = await depositar();
  assert.deepEqual([deposito.estado, deposito.saldoPrevioCentavos], ["confirmada", 0]);
  assert.equal((await depositar()).id, deposito.id);
  assert.equal(falso.estado().clientes[0]!.saldoCentavos, 100_000, "doble clic en el depósito: un solo depósito");
  // La misma llave con otro monto es un error, no la operación de antes.
  await rechazo(ejecutarOperacionEfevoo(personal, entrada({ tipo: "deposito_prueba", llave: llaveDeposito, montoCentavos: 200_000 }), llamadaEstandar, deps()),
    "intento_con_otros_datos");

  // O3: asignar el plástico 1363 al titular y activarlo.
  const asignada = await ejecutarOperacionEfevoo(personal, entrada({
    tipo: "asignacion", inventario: { idEfevoo: 557, terminacion: "1363", employeeId: empleado, nombreTarjeta: "PRUEBA LEVER" },
  }), async (op, ef) => String((await ef.asignarTarjeta({ producto: 16, subproducto: 19, idepCliente: op.idepCliente!, ultimos8: ultimos8De("1363"), titular: TITULAR })).id), deps());
  assert.deepEqual([asignada.estado, asignada.idEfevoo], ["confirmada", "557"]);
  const tarjeta = uno<{ id: string; estado: string }>("select id, estado from efevoo_tarjetas where id_efevoo = 557")[0]!;
  assert.equal(tarjeta.estado, "asignada");
  assert.equal((await ejecutarOperacionEfevoo(personal, entrada({ tipo: "activacion", tarjetaId: tarjeta.id }), llamadaEstandar, deps())).estado, "confirmada");
  const T = tarjeta.id;
  assert.equal(uno<{ estado: string }>(`select estado from efevoo_tarjetas where id = '${T}'`)[0]!.estado, "activa");

  // Carga de la liberadora: confirmada con el id del movimiento; el saldo de la empresa baja.
  const carga = await ejecutarOperacionEfevoo(liberador, entrada({ tipo: "carga", tarjetaId: T, montoCentavos: 5_000 }), llamadaEstandar, deps());
  assert.equal(carga.estado, "confirmada");
  assert.match(carga.idEfevoo ?? "", /^[0-9]+$/);
  assert.equal(falso.estado().tarjetas.find((t) => t.id === 557)!.saldoCentavos, 5_000);

  // Lever valida los saldos: sin saldo de la empresa no carga; sin saldo de la tarjeta no retira. Efevoo no se llama.
  const antes = llamadas();
  const sinSaldo = await ejecutarOperacionEfevoo(liberador, entrada({ tipo: "carga", tarjetaId: T, montoCentavos: 10_000_000 }), llamadaEstandar, deps());
  assert.deepEqual([sinSaldo.estado, sinSaldo.codigoEfevoo], ["fallida", "saldo_insuficiente"]);
  const sinSaldoTarjeta = await ejecutarOperacionEfevoo(liberador, entrada({ tipo: "retiro", tarjetaId: T, montoCentavos: 5_001 }), llamadaEstandar, deps());
  assert.deepEqual([sinSaldoTarjeta.estado, sinSaldoTarjeta.codigoEfevoo], ["fallida", "saldo_insuficiente"]);
  assert.equal(llamadas(), antes, "sin saldo no se mueve nada en Efevoo");

  // Falso éxito: «Operación realizada correctamente» con id 0 queda fallida.
  const idCero = await ejecutarOperacionEfevoo(liberador, entrada({ tipo: "carga", tarjetaId: T, montoCentavos: 100 }),
    async (op, ef) => String((await ef.cargarTarjeta(557, "otro-correo@lever.test", op.montoCentavos!, op.referencia, "x")).id), deps());
  assert.deepEqual([idCero.estado, idCero.codigoEfevoo], ["fallida", "id_cero"]);

  // 401: fallida (Efevoo no lo procesó). E1-3: un 901 (u otro código no medido) NO prueba que el dinero no se movió: queda incierta.
  falso.simular({ metodo: "fundCard", falla: "401", idCard: 557 });
  assert.deepEqual(pick(await ejecutarOperacionEfevoo(liberador, entrada({ tipo: "carga", tarjetaId: T, montoCentavos: 100 }), llamadaEstandar, deps())), ["fallida", "401"]);
  falso.simular({ metodo: "fundCard", falla: "901", idCard: 557 });
  const cinco = await ejecutarOperacionEfevoo(liberador, entrada({ tipo: "carga", tarjetaId: T, montoCentavos: 100 }), llamadaEstandar, deps());
  assert.deepEqual(pick(cinco), ["incierta", "901"]);
  // Mientras esté incierta, la tarjeta no admite otra operación: hay que conciliarla primero.
  await rechazo(ejecutarOperacionEfevoo(liberador, entrada({ tipo: "carga", tarjetaId: T, montoCentavos: 100 }), llamadaEstandar, deps()), "operacion_en_curso");
  // El 901 no movió nada: antes de 10 minutos la conciliación espera y dice cuándo volver.
  const espera = await conciliarOperacionEfevoo(liberador, E, cinco.id, deps());
  assert.equal(espera.resultado, "espera");
  assert.equal(espera.operacion.estado, "incierta");
  assert.equal(espera.resultado === "espera" ? Date.parse(espera.reintentarDespuesDe) - Date.parse(cinco.creadaEn) : 0, 10 * 60_000);
  // Aunque el reloj de la aplicación diga que ya pasaron, la base no deja concluir «no apareció» antes de tiempo.
  await rechazo(conciliarOperacionEfevoo(liberador, E, cinco.id, deps({ ahora: () => new Date(Date.now() + 11 * 60_000) })), "conciliacion_prematura");
  // Después de 10 minutos (la dueña mueve la hora de la operación): no apareció → fallida, y el reintento lleva referencia nueva ligada.
  ejecutar(url, `set session_replication_role = replica; update efevoo_operaciones set creada_en = now() - interval '11 minutes' where id = '${cinco.id}'; set session_replication_role = origin;`);
  const noAparecio = await conciliarOperacionEfevoo(liberador, E, cinco.id, deps());
  assert.deepEqual([noAparecio.resultado, noAparecio.operacion.estado, noAparecio.operacion.codigoEfevoo], ["no_aparecio", "fallida", "no_aparecio"]);
  const reintento = await reintentarOperacionEfevoo(liberador, E, cinco.id, randomUUID(), llamadaEstandar, deps());
  assert.equal(reintento.estado, "confirmada");
  assert.equal(reintento.reintentoDe, cinco.id);
  assert.notEqual(reintento.referencia, cinco.referencia);
  await rechazo(reintentarOperacionEfevoo(liberador, E, cinco.id, randomUUID(), llamadaEstandar, deps()), "reintento_ya_hecho");

  // Timeout que Efevoo sí procesó: incierta, sin reintento automático; la conciliación la encuentra por su referencia.
  falso.simular({ metodo: "fundCard", falla: "timeout", idCard: 557 });
  const antesTimeout = llamadas();
  const timeout = await ejecutarOperacionEfevoo(liberador, entrada({ tipo: "carga", tarjetaId: T, montoCentavos: 250 }), llamadaEstandar, deps());
  assert.deepEqual(pick(timeout), ["incierta", "timeout"]);
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(llamadas(), antesTimeout + 1, "una sola llamada: sin reintento automático");
  const conciliada = await conciliarOperacionEfevoo(liberador, E, timeout.id, deps());
  assert.deepEqual([conciliada.resultado, conciliada.operacion.estado], ["confirmada", "confirmada"]);
  assert.match(conciliada.operacion.idEfevoo ?? "", /^[0-9]+$/);
  assert.equal((await conciliarOperacionEfevoo(liberador, E, timeout.id, deps())).resultado, "ya_resuelta");

  // E1-5: la conciliación no confunde la referencia con un movimiento viejo, de otro tipo o repetido.
  falso.simular({ metodo: "fundCard", falla: "timeout_sin_efecto", idCard: 557 });
  const sinEfecto = await ejecutarOperacionEfevoo(liberador, entrada({ tipo: "carga", tarjetaId: T, montoCentavos: 777 }), llamadaEstandar, deps());
  assert.deepEqual(pick(sinEfecto), ["incierta", "timeout"]);
  falso.inyectarMovimiento({ idCard: 557, concepto: "PAGO A TARJETA", importe: 7.77, tipo: "Abono", referencia: sinEfecto.referencia, fecha: "2025-08-13T19:26:52Z" });
  falso.inyectarMovimiento({ idCard: 557, concepto: "DEVOLUCIÓN PAGO A TARJETA", importe: 7.77, tipo: "Cargo", referencia: sinEfecto.referencia });
  falso.inyectarMovimiento({ idCard: 557, concepto: "PAGO A TARJETA", importe: 7.78, tipo: "Abono", referencia: sinEfecto.referencia });
  assert.equal((await conciliarOperacionEfevoo(liberador, E, sinEfecto.id, deps())).resultado, "espera", "ni el viejo, ni el retiro, ni otro importe confirman la carga");
  falso.inyectarMovimiento({ idCard: 557, concepto: "PAGO A TARJETA", importe: 7.77, tipo: "Abono", referencia: sinEfecto.referencia });
  const buena = await conciliarOperacionEfevoo(liberador, E, sinEfecto.id, deps());
  assert.deepEqual([buena.resultado, buena.operacion.estado], ["confirmada", "confirmada"]);
  const idInyectado = (await efevoo.movimientosDeTarjeta(557, TITULAR.correo)).find((m) => m.referencia === sinEfecto.referencia && m.centavos === 777 && m.tipo === "abono" && m.fechaHora.startsWith("2026"));
  assert.equal(buena.operacion.idEfevoo, idInyectado?.idMovimiento, "guarda el IDMovimiento encontrado");
  // Dos movimientos que cuadran: no se adivina.
  falso.simular({ metodo: "fundCard", falla: "timeout_sin_efecto", idCard: 557 });
  const doble = await ejecutarOperacionEfevoo(liberador, entrada({ tipo: "carga", tarjetaId: T, montoCentavos: 888 }), llamadaEstandar, deps());
  for (let i = 0; i < 2; i++) falso.inyectarMovimiento({ idCard: 557, concepto: "PAGO A TARJETA", importe: 8.88, tipo: "Abono", referencia: doble.referencia });
  const ambigua = await conciliarOperacionEfevoo(liberador, E, doble.id, deps());
  assert.deepEqual([ambigua.resultado, ambigua.operacion.estado], ["ambigua", "incierta"]);
  ejecutar(url, `set session_replication_role = replica; update efevoo_operaciones set estado = 'fallida', codigo_efevoo = 'revisada_a_mano' where id = '${doble.id}'; set session_replication_role = origin;`);

  // Bloqueo y desbloqueo cambian el estado de la tarjeta.
  assert.equal((await ejecutarOperacionEfevoo(liberador, entrada({ tipo: "bloqueo", tarjetaId: T }), llamadaEstandar, deps())).estado, "confirmada");
  assert.equal(uno<{ estado: string }>(`select estado from efevoo_tarjetas where id = '${T}'`)[0]!.estado, "bloqueada");
  assert.equal((await ejecutarOperacionEfevoo(liberador, entrada({ tipo: "desbloqueo", tarjetaId: T }), llamadaEstandar, deps())).estado, "confirmada");

  // Permisos: el contador y el titular no operan, y Efevoo no se llama.
  const antesPermisos = llamadas();
  await rechazo(ejecutarOperacionEfevoo(contador, entrada({ tipo: "carga", tarjetaId: T, montoCentavos: 100 }), llamadaEstandar, deps()), "sin_permiso_para_efevoo");
  await rechazo(ejecutarOperacionEfevoo(titular, entrada({ tipo: "carga", tarjetaId: T, montoCentavos: 100 }), llamadaEstandar, deps()), "sin_permiso_para_efevoo");
  await rechazo(ejecutarOperacionEfevoo(liberador, entrada({ tipo: "cancelacion", tarjetaId: T, motivo: "Robo de la tarjeta" }), llamadaEstandar, deps()), "sin_permiso_para_efevoo");
  await rechazo(ejecutarOperacionEfevoo(admin, entrada({ tipo: "deposito_prueba", montoCentavos: 100 }), llamadaEstandar, deps()), "sin_permiso_para_efevoo");
  assert.equal(llamadas(), antesPermisos);

  // E1-2: una carga sin respuesta (5xx, incierta) no impide cancelar la tarjeta.
  falso.simular({ metodo: "fundCard", falla: "5xx", idCard: 557 });
  assert.deepEqual(pick(await ejecutarOperacionEfevoo(liberador, entrada({ tipo: "carga", tarjetaId: T, montoCentavos: 100 }), llamadaEstandar, deps())), ["incierta", "http_502"]);

  // O4: cancelar (administración de la empresa) deja la tarjeta cancelada con su motivo.
  const cancelada = await ejecutarOperacionEfevoo(admin, entrada({ tipo: "cancelacion", tarjetaId: T, motivo: "Robo de la tarjeta" }), llamadaEstandar, deps());
  assert.equal(cancelada.estado, "confirmada");
  assert.deepEqual(uno<{ estado: string; motivo_cancelacion: string }>(`select estado, motivo_cancelacion from efevoo_tarjetas where id = '${T}'`)[0],
    { estado: "cancelada", motivo_cancelacion: "Robo de la tarjeta" });
  assert.equal(falso.estado().tarjetas.find((t) => t.id === 557)!.estado, "cancelled");

  // Bitácora: cada operación dejó su evento de asentar y el de resolver, sin correos ni números de tarjeta.
  const eventos = uno<{ accion: string; cambio: unknown }>("select accion, cambio from audit_log where entidad = 'efevoo_operaciones' order by ocurrido_en");
  const ops = uno<{ n: number }>("select count(*)::int as n from efevoo_operaciones")[0]!.n;
  assert.equal(eventos.filter((e) => !["efevoo_confirmada", "efevoo_fallida", "efevoo_incierta"].includes(e.accion)).length, ops);
  assert.doesNotMatch(JSON.stringify(eventos), /@|\d{13,19}/);
}

function pick(op: { estado: string; codigoEfevoo: string | null }): [string, string | null] {
  return [op.estado, op.codigoEfevoo];
}
