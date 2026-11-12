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
import { clienteHttpEfevoo, type ClienteEfevoo } from "../../src/server/efevoo/cliente.ts";
import type { ConfigEfevoo } from "../../src/server/efevoo/config.ts";
import {
  cerrarOperacionManualEfevoo,
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

  // O1: alta. En el sandbox compartido ya hay un HOMÓNIMO (otra integración, otro correo): idepCliente 300.
  // PC2-1: el alta de Lever no responde (timeout con efecto) y se concilia en el acto por CORREO, no por nombre.
  const correoAlfa = `empresa-${E.replace(/-/g, "").slice(0, 12)}@lever.test`;
  await clienteHttpEfevoo(config).crearCliente({ correo: "otro-integrador@lever.test", razonSocial: RAZON });
  const llaveAlta = randomUUID();
  const crear = (ctx: ContextoDeTenant) => ejecutarOperacionEfevoo(ctx, entrada({ tipo: "alta_cliente", llave: llaveAlta }),
    async (_op, efevoo) => String((await efevoo.crearCliente({ correo: correoAlfa, razonSocial: RAZON })).idepCliente), deps());
  falso.simular({ metodo: "createClient", falla: "timeout" });
  const alta = await crear(personal);
  assert.deepEqual([alta.estado, alta.idEfevoo, alta.codigoEfevoo, alta.nueva], ["confirmada", "301", "conciliada", true], "con un homónimo, el alta se concilia por correo");
  const otraVez = await crear(personal);
  assert.deepEqual([otraVez.id, otraVez.nueva], [alta.id, false]);
  assert.equal(falso.estado().clientes.length, 2, "doble clic en el alta: un solo cliente de Lever en Efevoo");
  assert.equal(uno<{ idep_cliente: number }>(`select idep_cliente from efevoo_clientes where company_id = '${E}'`)[0]!.idep_cliente, 301);

  // PC2-1: «Cliente previamente registrado» (el alta sí ocurrió antes y Lever no se enteró) vincula por correo en el acto.
  const beta = await darDeAltaComoDuena(url, personal, { rfc: "CABL840215RF4", razonSocial: RAZON, codigoPostal: "06600", regimen: "612", usoCfdi: "G03" },
    { demostracion: false, corridoPor: "pruebas@ejemplo.mx" });
  const correoBeta = `empresa-${beta.id.replace(/-/g, "").slice(0, 12)}@lever.test`;
  const previa = await clienteHttpEfevoo(config).crearCliente({ correo: correoBeta, razonSocial: RAZON });
  const altaBeta = await ejecutarOperacionEfevoo(personal, { tipo: "alta_cliente", llave: randomUUID(), companyId: beta.id },
    async (_op, efevoo) => String((await efevoo.crearCliente({ correo: correoBeta, razonSocial: RAZON })).idepCliente), deps());
  assert.deepEqual([altaBeta.estado, altaBeta.idEfevoo, altaBeta.codigoEfevoo], ["confirmada", String(previa.idepCliente), "conciliada"]);

  // PC2-1b: la búsqueda por correo va del más nuevo al más viejo, primero la misma razón social, se detiene en la
  // primera coincidencia y tiene tope (20 dentro del alta). Se cuentan los getClient.
  const contado = (base: ClienteEfevoo) => {
    const cuenta = { lecturas: 0 };
    return { cuenta, cliente: { ...base, leerCliente: (id: number) => { cuenta.lecturas += 1; return base.leerCliente(id); } } as ClienteEfevoo };
  };
  const otro = clienteHttpEfevoo(config);
  for (let i = 0; i < 210; i++) await otro.crearCliente({ correo: `viejo-${i}@lever.test`, razonSocial: `Cliente viejo ${i}` });
  const gamma = await darDeAltaComoDuena(url, personal, { rfc: "GCE170101AB2", razonSocial: "Gamma Ciclo", codigoPostal: "06600", regimen: "601", usoCfdi: "G03" },
    { demostracion: false, corridoPor: "pruebas@ejemplo.mx" });
  const correoGamma = `empresa-${gamma.id.replace(/-/g, "").slice(0, 12)}@lever.test`;
  const g = contado(clienteHttpEfevoo(config, fetch, 400));
  falso.simular({ metodo: "createClient", falla: "timeout" });
  const altaGamma = await ejecutarOperacionEfevoo(personal, { tipo: "alta_cliente", llave: randomUUID(), companyId: gamma.id },
    async (_op, ef) => String((await ef.crearCliente({ correo: correoGamma, razonSocial: "Gamma Ciclo" })).idepCliente), { config, efevoo: g.cliente });
  assert.equal(altaGamma.estado, "confirmada", "con 210 clientes más viejos, el alta nueva se encuentra en el acto");
  assert.ok(g.cuenta.lecturas <= 20, `getClient dentro del alta: ${g.cuenta.lecturas}`);
  // Con 25 homónimos MÁS NUEVOS que el cliente de la empresa, el tope de 20 se agota: «ambigua» (sigue incierta), nunca
  // «no apareció»; la conciliación explícita (tope 200) sí lo encuentra.
  const delta = await darDeAltaComoDuena(url, personal, { rfc: "DCE170101AB3", razonSocial: "Delta Ciclo", codigoPostal: "06600", regimen: "601", usoCfdi: "G03" },
    { demostracion: false, corridoPor: "pruebas@ejemplo.mx" });
  const correoDelta = `empresa-${delta.id.replace(/-/g, "").slice(0, 12)}@lever.test`;
  const delDelta = await otro.crearCliente({ correo: correoDelta, razonSocial: "Delta Ciclo" });
  for (let i = 0; i < 25; i++) await otro.crearCliente({ correo: `homonimo-${i}@lever.test`, razonSocial: "Delta Ciclo" });
  const altaDelta = await ejecutarOperacionEfevoo(personal, { tipo: "alta_cliente", llave: randomUUID(), companyId: delta.id },
    async (_op, ef) => String((await ef.crearCliente({ correo: correoDelta, razonSocial: "Delta Ciclo" })).idepCliente), deps());
  assert.deepEqual([altaDelta.estado, altaDelta.codigoEfevoo], ["incierta", "1"], "tope agotado dentro del alta: incierta, no fallida");
  // Pasados los 10 minutos, si la conciliación agota su tope (aquí 10, con 25 homónimos más nuevos) es «ambigua»,
  // nunca «no apareció»: el alta sí ocurrió y un reintento solo recibiría otro «previamente registrado».
  ejecutar(url, `set session_replication_role = replica; update efevoo_operaciones set creada_en = now() - interval '11 minutes' where id = '${altaDelta.id}'; set session_replication_role = origin;`);
  const agotada = await conciliarOperacionEfevoo(personal, delta.id, altaDelta.id, deps({ topeAltaConciliacion: 10 }));
  assert.deepEqual([agotada.resultado, agotada.operacion.estado], ["ambigua", "incierta"]);
  const conciliadaDelta = await conciliarOperacionEfevoo(personal, delta.id, altaDelta.id, deps());
  assert.deepEqual([conciliadaDelta.resultado, conciliadaDelta.operacion.idEfevoo], ["confirmada", String(delDelta.idepCliente)]);

  // O2: depósito de prueba con su saldo previo anotado; doble clic deja uno.
  const efevoo = deps().efevoo!;
  const llaveDeposito = randomUUID();
  const depositar = () => saldoDeEmpresaEfevoo(efevoo, 301).then((saldo) => ejecutarOperacionEfevoo(personal,
    entrada({ tipo: "deposito_prueba", llave: llaveDeposito, montoCentavos: 100_000, saldoPrevioCentavos: saldo }), llamadaEstandar, deps()));
  const deposito = await depositar();
  assert.deepEqual([deposito.estado, deposito.saldoPrevioCentavos], ["confirmada", 0]);
  assert.equal((await depositar()).id, deposito.id);
  assert.equal(falso.estado().clientes.find((c) => c.id === 301)!.saldoCentavos, 100_000, "doble clic en el depósito: un solo depósito");
  // La misma llave con otro monto es un error, no la operación de antes.
  await rechazo(ejecutarOperacionEfevoo(personal, entrada({ tipo: "deposito_prueba", llave: llaveDeposito, montoCentavos: 200_000 }), llamadaEstandar, deps()),
    "intento_con_otros_datos");

  // E1-14: un depósito sin respuesta que sí ocurrió se encuentra por monto, saldo previo y hora (guarda el id del movimiento).
  falso.simular({ metodo: "clientBalance", falla: "timeout" });
  const depIncierto = await saldoDeEmpresaEfevoo(efevoo, 301).then((saldo) => ejecutarOperacionEfevoo(personal,
    entrada({ tipo: "deposito_prueba", montoCentavos: 50_000, saldoPrevioCentavos: saldo }), llamadaEstandar, deps()));
  assert.deepEqual(pick(depIncierto), ["incierta", "timeout"]);
  const depConciliado = await conciliarOperacionEfevoo(personal, E, depIncierto.id, deps());
  assert.deepEqual([depConciliado.resultado, depConciliado.operacion.idEfevoo], ["confirmada", null]);
  assert.match(depConciliado.operacion.idMovimientoEfevoo ?? "", /^[1-9][0-9]*$/);
  // Sin saldo previo anotado, un depósito anterior del mismo monto no lo confirma: no se adivina.
  falso.simular({ metodo: "clientBalance", falla: "timeout_sin_efecto" });
  const depSinPrevio = await ejecutarOperacionEfevoo(personal, entrada({ tipo: "deposito_prueba", montoCentavos: 50_000, saldoPrevioCentavos: null }), llamadaEstandar, deps());
  assert.equal((await conciliarOperacionEfevoo(personal, E, depSinPrevio.id, deps())).resultado, "ambigua");
  ejecutar(url, `set session_replication_role = replica; update efevoo_operaciones set estado = 'fallida', codigo_efevoo = 'revisada_a_mano' where id = '${depSinPrevio.id}'; set session_replication_role = origin;`);

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
  assert.equal(carga.idMovimientoEfevoo, null, "el id de la respuesta y el IDMovimiento no se mezclan");
  assert.notEqual(carga.idEfevoo, (await efevoo.movimientosDeTarjeta(557, TITULAR.correo))[0]!.idMovimiento);
  assert.equal(falso.estado().tarjetas.find((t) => t.id === 557)!.saldoCentavos, 5_000);

  // E1-11: dos cargas abiertas a la vez en tarjetas distintas de la empresa no gastan el mismo saldo.
  // Una carga incierta en otra tarjeta cuenta como gastada: si el resto no alcanza, Efevoo no se llama.
  const otra = await ejecutarOperacionEfevoo(personal, entrada({
    tipo: "asignacion", inventario: { idEfevoo: 563, terminacion: "0168", employeeId: null, nombreTarjeta: "OTRA LEVER" },
  }), async (op, ef) => String((await ef.asignarTarjeta({ producto: 16, subproducto: 19, idepCliente: op.idepCliente!, ultimos8: ultimos8De("0168"), titular: { ...TITULAR, correo: "otra-ciclo@lever.test" } })).id), deps());
  const T2 = uno<{ id: string }>(`select id from efevoo_tarjetas where id_efevoo = ${otra.idEfevoo}`)[0]!.id;
  await ejecutarOperacionEfevoo(personal, entrada({ tipo: "activacion", tarjetaId: T2 }), llamadaEstandar, deps());
  const saldoEmpresa = (await saldoDeEmpresaEfevoo(efevoo, 301))!;
  falso.simular({ metodo: "fundCard", falla: "timeout_sin_efecto", idCard: 563 });
  const grande = await ejecutarOperacionEfevoo(liberador, entrada({ tipo: "carga", tarjetaId: T2, montoCentavos: saldoEmpresa - 1_000 }), llamadaEstandar, deps());
  assert.deepEqual(pick(grande), ["incierta", "timeout"]);
  const antesReserva = llamadas();
  const sinReserva = await ejecutarOperacionEfevoo(liberador, entrada({ tipo: "carga", tarjetaId: T, montoCentavos: 2_000 }), llamadaEstandar, deps());
  assert.deepEqual(pick(sinReserva), ["fallida", "saldo_insuficiente"], "el saldo ya está apartado por la carga incierta de la otra tarjeta");
  assert.equal(llamadas(), antesReserva);
  ejecutar(url, `set session_replication_role = replica; update efevoo_operaciones set creada_en = now() - interval '11 minutes' where id = '${grande.id}'; set session_replication_role = origin;`);
  assert.equal((await conciliarOperacionEfevoo(liberador, E, grande.id, deps())).resultado, "no_aparecio");

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
  assert.match(conciliada.operacion.idMovimientoEfevoo ?? "", /^[1-9][0-9]*$/);
  assert.equal(conciliada.operacion.idEfevoo, null);
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
  assert.equal(buena.operacion.idMovimientoEfevoo, idInyectado?.idMovimiento, "guarda el IDMovimiento encontrado");
  // E1-10: un movimiento con la misma referencia que no se puede leer completo (sin tipo y con un concepto
  // desconocido) da «ambigua», nunca «no apareció», aunque ya pasaron los 10 minutos.
  falso.simular({ metodo: "fundCard", falla: "timeout_sin_efecto", idCard: 557 });
  const ilegible = await ejecutarOperacionEfevoo(liberador, entrada({ tipo: "carga", tarjetaId: T, montoCentavos: 999 }), llamadaEstandar, deps());
  falso.inyectarMovimiento({ idCard: 557, concepto: "AJUSTE DE SALDO", importe: 9.99, tipo: null, referencia: ilegible.referencia });
  ejecutar(url, `set session_replication_role = replica; update efevoo_operaciones set creada_en = now() - interval '11 minutes' where id = '${ilegible.id}'; set session_replication_role = origin;`);
  falso.inyectarMovimiento({ idCard: 557, concepto: "AJUSTE DE SALDO", importe: 9.99, tipo: null, referencia: ilegible.referencia });
  const sinLeer = await conciliarOperacionEfevoo(liberador, E, ilegible.id, deps());
  assert.deepEqual([sinLeer.resultado, sinLeer.operacion.estado], ["ambigua", "incierta"]);
  ejecutar(url, `set session_replication_role = replica; update efevoo_operaciones set estado = 'fallida', codigo_efevoo = 'revisada_a_mano' where id = '${ilegible.id}'; set session_replication_role = origin;`);

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
  const sinRespuesta = await ejecutarOperacionEfevoo(liberador, entrada({ tipo: "carga", tarjetaId: T, montoCentavos: 100 }), llamadaEstandar, deps());
  assert.deepEqual(pick(sinRespuesta), ["incierta", "http_502"]);

  // O4: cancelar (administración de la empresa) deja la tarjeta cancelada con su motivo.
  const cancelada = await ejecutarOperacionEfevoo(admin, entrada({ tipo: "cancelacion", tarjetaId: T, motivo: "Robo de la tarjeta" }), llamadaEstandar, deps());
  assert.equal(cancelada.estado, "confirmada");
  assert.deepEqual(uno<{ estado: string; motivo_cancelacion: string }>(`select estado, motivo_cancelacion from efevoo_tarjetas where id = '${T}'`)[0],
    { estado: "cancelada", motivo_cancelacion: "Robo de la tarjeta" });
  assert.equal(falso.estado().tarjetas.find((t) => t.id === 557)!.estado, "cancelled");

  // CM-1: el cierre manual de la carga sin respuesta (tarjeta ya cancelada) deja su evento con «resultado desconocido».
  ejecutar(url, `set session_replication_role = replica; update efevoo_operaciones set creada_en = now() - interval '11 minutes' where id = '${sinRespuesta.id}'; set session_replication_role = origin;`);
  const cerrada = await cerrarOperacionManualEfevoo(personal, E, sinRespuesta.id, "La tarjeta se canceló y Efevoo ya no deja leer sus movimientos", deps());
  assert.deepEqual([cerrada.estado, cerrada.codigoEfevoo], ["fallida", "cierre_manual"]);
  const evento = uno<{ cambio: Record<string, unknown>; motivo: string }>(`select cambio, motivo from audit_log where accion = 'efevoo_cierre_manual' and identificador = '${sinRespuesta.id}'`)[0]!;
  assert.equal(evento.cambio.resultado, "desconocido");
  assert.equal("estado" in evento.cambio, false, "el evento no dice «fallida»");
  assert.match(evento.motivo, /ya no deja leer/);

  // Bitácora: cada operación dejó su evento de asentar y el de resolver, sin correos ni números de tarjeta.
  const eventos = uno<{ accion: string; cambio: unknown }>("select accion, cambio from audit_log where entidad = 'efevoo_operaciones' order by ocurrido_en");
  const ops = uno<{ n: number }>("select count(*)::int as n from efevoo_operaciones")[0]!.n;
  assert.equal(eventos.filter((e) => !["efevoo_confirmada", "efevoo_fallida", "efevoo_incierta", "efevoo_cierre_manual"].includes(e.accion)).length, ops);
  assert.doesNotMatch(JSON.stringify(eventos), /@|\d{13,19}/);
}

function pick(op: { estado: string; codigoEfevoo: string | null }): [string, string | null] {
  return [op.estado, op.codigoEfevoo];
}
