import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { digitoClabe, clabeVisible } from "../../src/dominio/clabe.ts";
import { cerrarConexion } from "../../src/nucleo/db.ts";
import type { ContextoConEmpresa } from "../../src/nucleo/contexto.ts";
import { ErrorDeDominio } from "../../src/nucleo/error-de-dominio.ts";
import { darDeAltaComoDuena } from "../../scripts/empresa-por-la-duena.ts";
import type { MensajeCorreo } from "../../src/server/correo/tipos.ts";
import { atenderAviso, asegurarClabeDeCliente, firmar, leerAvisosSinDestino, registrarCuentaFintoc, type ClabeFintoc, type ClienteFintoc, type ConfigFintoc } from "../../src/server/cobranza/fintoc.ts";
import { confirmarEstadoDeCuenta, leerVistaEstadoDeCuenta, prepararEstadoDeCuenta } from "../../src/server/cobranza/estado-cuenta.ts";
import { leerPaginaDelPagador, pedirSinRecordatorios } from "../../src/server/cobranza/pagador.ts";
import {
  anularPago,
  aplicarPago,
  cambiarRecordatorios,
  capturarMontoVariable,
  configurarCobranza,
  crearCargoUnico,
  darDeAltaCliente,
  leerVistaCliente,
  leerVistaCobranza,
  leerFiltros,
  registrarPagoManual,
  revertirAplicacion,
  simularAbono,
  editarCliente,
  ErrorDeCaptura,
  type DependenciasCobranza,
} from "../../src/server/cobranza/servicio.ts";
import { correrCobranza } from "../../src/server/cobranza/tarea.ts";
import { actorDeCliente, auditar } from "../../src/server/bitacora/auditar.ts";
import { baseCliente } from "../../src/nucleo/contexto.ts";
import type { Sesion } from "../../src/server/session/tipos.ts";
import { nombrarCentro } from "../../src/server/personas/servicio.ts";
import { contextoDePersonal } from "../../src/server/plataforma/servicio.ts";
import { administrador, CLABE_EMPRESA, contar, HOY, persona, reloj, sembrarPersonal } from "./siembra.ts";
import { aplicarArchivo, conBaseDesechable, consultarJson, ejecutar, exigirBaseDesechable, urlDeAplicacion } from "../aislamiento/postgres.ts";

const urlAdmin = process.env.AISLAMIENTO_DATABASE_URL?.trim() ?? "";
const URL = "https://lever.ejemplo.mx";

describe("Cobranza en Postgres", { skip: urlAdmin.length === 0 }, () => {
  it("alta con plan, cron idempotente, pagos, pagador, demo, aislamiento y Fintoc", async () => {
    exigirBaseDesechable();
    await conBaseDesechable(urlAdmin, async (url) => {
      const dir = join(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");
      for (const archivo of readdirSync(dir).sort()) {
        if (archivo.endsWith(".sql")) aplicarArchivo(url, join(dir, archivo));
      }
      ejecutar(url, `do $$ begin execute format('alter database %I set timezone to %L', current_database(), 'UTC'); end $$;`);
      await cerrarConexion();
      const previo = process.env.DATABASE_URL;
      process.env.DATABASE_URL = urlDeAplicacion(url);
      try {
        await escenario(url);
      } finally {
        await cerrarConexion();
        if (previo === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = previo;
      }
    });
  });
});

/** Un buzón falso: nada sale a internet; los destinatarios son siempre @ejemplo.mx. */
function buzon() {
  const enviados: MensajeCorreo[] = [];
  const deps = (ahora = HOY, extra: Partial<DependenciasCobranza> = {}): DependenciasCobranza => ({
    ahora,
    urlPublica: () => URL,
    enviador: () => async (m) => {
      assert.match(m.para, /@ejemplo\.mx$/);
      enviados.push(m);
      return { id: randomUUID() };
    },
    fintoc: null,
    registrar: () => {},
    ...extra,
  });
  return { enviados, deps };
}

/** Fintoc falso en memoria: crea CLABEs ficticias (banco 999) y puede caerse después de crear. */
function fintocFalso(cuentaId: string) {
  const clabes: ClabeFintoc[] = [];
  let creadas = 0;
  let caerDespuesDeCrear = false;
  const cliente: ClienteFintoc = {
    async listarClabes(cuenta, despuesDe) {
      await new Promise((r) => setTimeout(r, 15));
      const desde = despuesDe ? clabes.findIndex((c) => c.id === despuesDe) + 1 : 0;
      return clabes.filter((c) => c.cuentaId === cuenta).slice(desde, desde + 300);
    },
    async crearClabe(cuenta, _empresa, clienteId) {
      await new Promise((r) => setTimeout(r, 15));
      creadas += 1;
      const diecisiete = `999${String(100_000_000_000_00 + creadas).padStart(14, "0")}`;
      const nueva = { id: `acno_falsa${creadas}`, cuentaId: cuenta, numero: `${diecisiete}${digitoClabe(diecisiete)}`, clienteId, borrada: false };
      clabes.push(nueva);
      if (caerDespuesDeCrear) {
        caerDespuesDeCrear = false;
        throw new ErrorDeDominio("proveedor_no_disponible");
      }
      return nueva;
    },
  };
  assert.match(cuentaId, /^acc_/);
  return { cliente, clabes, creadas: () => creadas, caerLaProxima: () => { caerDespuesDeCrear = true; } };
}

async function escenario(url: string): Promise<void> {
  sembrarPersonal(url);
  const personal = await contextoDePersonal("personal-cobranza@ejemplo.mx");
  const alfa = await darDeAltaComoDuena(url, personal, { rfc: "TCM010101AB1", razonSocial: "Escuela Alfa Cobranza", codigoPostal: "06600", regimen: "601", usoCfdi: "G03" }, { demostracion: false, corridoPor: "pruebas@ejemplo.mx" });
  const beta = await darDeAltaComoDuena(url, personal, { rfc: "CABL840215RF4", razonSocial: "Taller Beta Cobranza", codigoPostal: "44100", regimen: "612", usoCfdi: "G03" }, { demostracion: false, corridoPor: "pruebas@ejemplo.mx" });
  const demo = await darDeAltaComoDuena(url, personal, { rfc: "MOT970101AA1", razonSocial: "Demo Cobranza", codigoPostal: "64000", regimen: "601", usoCfdi: "G03" }, { demostracion: true, corridoPor: "pruebas@ejemplo.mx" });
  const [admin, sesionAdmin] = await administrador(url, personal, alfa, "admin-alfa-cobranza@ejemplo.mx");
  const [adminBeta, sesionBeta] = await administrador(url, personal, beta, "admin-beta-cobranza@ejemplo.mx");
  const [adminDemo, sesionDemo] = await administrador(url, personal, demo, "admin-demo-cobranza@ejemplo.mx");
  const centro = await nombrarCentro(admin, { nombre: "Operación" }, { ahora: HOY });
  const contador = await persona(url, admin, centro.id, "Contadora Cobranza", "contadora-cobranza@ejemplo.mx", ["contador"]);
  const { enviados, deps } = buzon();
  const codigo = (esperado: string) => (e: unknown) => e instanceof ErrorDeDominio && e.codigo === esperado;

  // 1. Sin configuración no hay alta; el contador ve, pero no escribe.
  const datosAlta = {
    nombre: "Colegio Uno", rfc: "", correos: "pagos-colegio@ejemplo.mx, tesoreria-colegio@ejemplo.mx", concepto: "Renta de bodega",
    tipo: "fijo", monto: "10000.00", periodicidad: "mensual", primerVencimiento: "2026-11-15", fin: "",
  };
  await assert.rejects(() => darDeAltaCliente(admin, { ...datosAlta, altaId: randomUUID() }, deps()), codigo("cobranza_sin_configurar"));
  const config = {
    clabe: CLABE_EMPRESA, beneficiario: "Escuela Alfa Cobranza SA de CV", correoContacto: "cobranza-alfa@ejemplo.mx",
    emitirDiasAntes: "7", antesDias: "3", avisoElDia: "si", despuesCadaDias: "7", despuesTope: "3", envioAutomatico: "si",
  };
  await assert.rejects(() => configurarCobranza(contador, config, sesionAdmin, deps()), codigo("sin_permiso"));
  const configurada = await configurarCobranza(admin, config, sesionAdmin, deps());
  assert.deepEqual(configurada, { clabeCambio: true, avisos: 1 });
  assert.equal(enviados.at(-1)?.para, "admin-alfa-cobranza@ejemplo.mx");
  assert.doesNotMatch(enviados.at(-1)?.texto ?? "", new RegExp(CLABE_EMPRESA));
  await configurarCobranza(adminBeta, { ...config, correoContacto: "cobranza-beta@ejemplo.mx" }, sesionBeta, deps());
  await configurarCobranza(adminDemo, { ...config, correoContacto: "" }, sesionDemo, deps());

  // 2. Alta con plan: dos envíos a la vez y uno después = un cliente, un plan, un cargo y un solo correo de cobro por destinatario.
  const altaId = randomUUID();
  const antes = enviados.length;
  const altas = [...(await Promise.all([darDeAltaCliente(admin, { ...datosAlta, altaId }, deps()), darDeAltaCliente(admin, { ...datosAlta, altaId }, deps())])),
    await darDeAltaCliente(admin, { ...datosAlta, altaId }, deps())];
  assert.deepEqual(altas.map((a) => a.clienteId), [altaId, altaId, altaId]);
  assert.equal(altas.filter((a) => !a.repetida).length, 1);
  assert.equal(contar(url, `select count(*) from collection_customers where company_id = '${alfa.id}'`), 1);
  assert.equal(contar(url, `select count(*) from collection_charges where customer_id = '${altaId}' and estado = 'emitido'`), 1);
  const cobros = enviados.slice(antes);
  assert.deepEqual(cobros.map((m) => m.para).sort(), ["pagos-colegio@ejemplo.mx", "tesoreria-colegio@ejemplo.mx"]);
  for (const m of cobros) {
    assert.equal(m.responderA, "cobranza-alfa@ejemplo.mx");
    assert.match(m.texto, new RegExp(clabeVisible(CLABE_EMPRESA)));
    // La primera referencia de la empresa: el consecutivo empieza en 100000, sin ceros a la izquierda (r63-N2).
    assert.match(m.texto, /1000009/);
  }
  await assert.rejects(() => darDeAltaCliente(admin, { ...datosAlta, nombre: "Otro", altaId }, deps()), codigo("formulario_ya_enviado"));
  const conRfc = { ...datosAlta, nombre: "Con RFC", rfc: "CABL840215RF4", correos: "conrfc@ejemplo.mx" };
  await darDeAltaCliente(admin, { ...conRfc, altaId: randomUUID() }, deps());
  await assert.rejects(() => darDeAltaCliente(admin, { ...conRfc, altaId: randomUUID() }, deps()), codigo("rfc_duplicado"));

  // 3. Plan variable: queda «sin monto» hasta capturarlo; al capturarlo sale el cobro.
  const variable = await darDeAltaCliente(admin, { ...datosAlta, nombre: "Variable SA", correos: "variable@ejemplo.mx", tipo: "variable", monto: "", altaId: randomUUID() }, deps());
  const porEmitir = consultarJson<{ id: string }[]>(url, `select json_agg(json_build_object('id', id)) from collection_charges where customer_id = '${variable.clienteId}' and estado = 'por_emitir'`);
  assert.equal(porEmitir.length, 1);
  await capturarMontoVariable(admin, { cargoId: porEmitir[0]!.id, monto: "4321.00" }, deps());
  assert.equal(enviados.at(-1)?.para, "variable@ejemplo.mx");

  // 4. La tarea dos veces el mismo día no crea ni manda nada nuevo.
  const tarea = (ahora: () => Date) => correrCobranza({ ahora, auditar, enviador: deps().enviador, urlPublica: () => URL, fintoc: null, registrar: () => {}, ritmoMs: 0 });
  const enviadosAntes = enviados.length;
  const t1 = await tarea(HOY);
  const t2 = await tarea(HOY);
  assert.equal(t1.cargos + t2.cargos, 0);
  assert.equal(enviados.length, enviadosAntes);
  // Un mes después: el periodo 1 se genera una sola vez y el periodo 0 (vencido) recibe un recordatorio.
  const diciembre = reloj("2026-12-10T18:00:00.000Z");
  const t3 = await tarea(diciembre);
  const t4 = await tarea(diciembre);
  assert.ok(t3.cargos >= 2, `cargos de diciembre: ${t3.cargos}`);
  assert.equal(t4.cargos, 0);
  assert.equal(t4.correos.enviado, 0);
  assert.equal(contar(url, `select count(*) from collection_charges where customer_id = '${altaId}'`), 2);
  assert.equal(contar(url, `select count(*) from collection_emails e join collection_charges c on c.id = e.charge_id where c.customer_id = '${altaId}' and e.tipo = 'despues'`), 1);

  // 5. Pagos manuales: parcial, completo con saldo a favor, y duplicado por clave de rastreo (no se aplica).
  const cargo0 = consultarJson<{ id: string }[]>(url, `select json_agg(json_build_object('id', id)) from collection_charges where customer_id = '${altaId}' and periodo = 0`)[0]!.id;
  const p1 = await registrarPagoManual(admin, { altaId: randomUUID(), cargoId: cargo0, monto: "6000.00", recibidoEl: "2026-12-10", claveRastreo: "RASTREO001" }, null, deps(diciembre));
  assert.equal(p1.aplicadoCentavos, 600_000);
  const comprobante = { nombre: "cep.pdf", bytes: new Uint8Array([...new TextEncoder().encode("%PDF-1.4\n"), ...new Uint8Array(80)]) };
  const guardados: string[] = [];
  const almacen = { guardar: async (e: { clave: string }) => { guardados.push(e.clave); return { clave: e.clave }; }, borrar: async () => {} };
  const p2 = await registrarPagoManual(admin, { altaId: randomUUID(), cargoId: cargo0, monto: "5000.00", recibidoEl: "2026-12-10", claveRastreo: "RASTREO002" }, comprobante, deps(diciembre, { almacen }));
  assert.equal(p2.aplicadoCentavos, 400_000);
  assert.equal(guardados.length, 1);
  assert.equal(consultarJson<{ e: string }[]>(url, `select json_agg(json_build_object('e', estado)) from collection_charges where id = '${cargo0}'`)[0]!.e, "pagado");
  const p3 = await registrarPagoManual(admin, { altaId: randomUUID(), monto: "5000.00", recibidoEl: "2026-12-10", claveRastreo: "rastreo002", clienteId: altaId }, null, deps(diciembre));
  assert.deepEqual([p3.aplicadoCentavos, p3.posibleDuplicado], [0, true]);
  await assert.rejects(() => registrarPagoManual(admin, { altaId: randomUUID(), monto: "1.00", recibidoEl: "2026-12-10" }, { nombre: "x.exe", bytes: new Uint8Array(100) }, deps(diciembre, { almacen })));

  // 6. Revertir y anular dejan las sumas cuadradas (la base lo verifica al confirmar).
  const aplicacion = consultarJson<{ id: string }[]>(url, `select json_agg(json_build_object('id', id)) from collection_applications where payment_id = '${p2.pagoId}'`)[0]!.id;
  await revertirAplicacion(admin, { aplicacionId: aplicacion, motivo: "Se aplicó al cargo equivocado." }, deps(diciembre));
  await assert.rejects(() => revertirAplicacion(admin, { aplicacionId: aplicacion, motivo: "Otra vez." }, deps(diciembre)), codigo("aplicacion_no_valida"));
  assert.equal(consultarJson<{ e: string }[]>(url, `select json_agg(json_build_object('e', estado)) from collection_charges where id = '${cargo0}'`)[0]!.e, "emitido");
  await aplicarPago(admin, { pagoId: p2.pagoId, cargoId: cargo0 }, deps(diciembre));
  await anularPago(admin, { pagoId: p3.pagoId, motivo: "Era el mismo depósito." }, deps(diciembre));
  await assert.rejects(() => anularPago(admin, { pagoId: p1.pagoId, motivo: "No se puede." }, deps(diciembre)), codigo("pago_no_anulable"));

  // 7. El simulador solo existe en demostración; ahí los correos quedan simulados y no salen.
  const cargo1 = consultarJson<{ id: string }[]>(url, `select json_agg(json_build_object('id', id)) from collection_charges where customer_id = '${altaId}' and periodo = 1`)[0]!.id;
  await assert.rejects(() => simularAbono(admin, { cargoId: cargo1, variante: "exacto" }, deps(diciembre)), codigo("solo_demostracion"));
  const enviadosDemo = enviados.length;
  const altaDemo = await darDeAltaCliente(adminDemo, { ...datosAlta, correos: "demo-cliente@ejemplo.mx", altaId: randomUUID() }, deps());
  assert.equal(altaDemo.correo, "simulado");
  assert.equal(enviados.length, enviadosDemo);
  const cargoDemo = consultarJson<{ id: string }[]>(url, `select json_agg(json_build_object('id', id)) from collection_charges where customer_id = '${altaDemo.clienteId}'`)[0]!.id;
  assert.deepEqual(await simularAbono(adminDemo, { cargoId: cargoDemo, variante: "exacto" }, deps()), { repetido: false, motivo: "referencia" });
  assert.deepEqual(await simularAbono(adminDemo, { cargoId: cargoDemo, variante: "repetir_aviso" }, deps()), { repetido: true, motivo: null });
  assert.equal(contar(url, `select count(*) from collection_payments where company_id = '${demo.id}'`), 1);

  // 8. Aislamiento: Beta no ve ni toca lo de Alfa.
  assert.equal(await leerVistaCliente(adminBeta, altaId, deps()), null);
  await assert.rejects(() => editarCliente(adminBeta, { clienteId: altaId, nombre: "Robado", rfc: "", correos: "x@ejemplo.mx" }, deps()), codigo("cliente_no_encontrado"));
  await assert.rejects(() => aplicarPago(adminBeta, { pagoId: p2.pagoId, cargoId: cargo0 }, deps()), codigo("pago_ya_aplicado"));
  const vistaBeta = await leerVistaCobranza(adminBeta, leerFiltros({}), deps());
  assert.equal(vistaBeta.cargos.total, 0);
  assert.equal(vistaBeta.clientes.length, 0);
  const vistaAlfa = await leerVistaCobranza(admin, leerFiltros({ estado: "vencido" }), deps(diciembre));
  assert.ok(vistaAlfa.resumen.porCobrar > 0);

  // 9. Página del pagador: con el token del correo; «sin recordatorios» avisa a la empresa una sola vez.
  const token = /\/pagar\/([A-Za-z0-9_-]{43})/.exec(cobros[0]!.texto)?.[1];
  assert.ok(token);
  assert.equal(await leerPaginaDelPagador("x".repeat(43)), null);
  const pagina = await leerPaginaDelPagador(token, { ahora: HOY });
  assert.equal(pagina?.estado, "pagado");
  const avisosAntes = enviados.length;
  assert.equal(await pedirSinRecordatorios(token, deps()), true);
  assert.equal(await pedirSinRecordatorios(token, deps()), true);
  assert.equal(enviados.length, avisosAntes + 1);
  assert.equal(enviados.at(-1)?.para, "admin-alfa-cobranza@ejemplo.mx");
  assert.equal(contar(url, `select count(*) from collection_customers where id = '${altaId}' and not recordatorios and recordatorios_por = 'pagador'`), 1);
  await cambiarRecordatorios(admin, { clienteId: altaId, activos: "si" }, deps());
  assert.equal(contar(url, `select count(*) from audit_log where accion = 'recordatorios_cliente_cobranza' and identificador = '${altaId}'`), 2);

  // 10. Fintoc: la cuenta la registra el personal (nunca en demo); una sola CLABE por cliente.
  const cuenta = "acc_PruebaAlfa01";
  await assert.rejects(() => registrarCuentaFintoc(personal, { empresaId: demo.id, cuentaId: "acc_PruebaDemo01" }), codigo("solo_empresas_reales"));
  await assert.rejects(() => registrarCuentaFintoc(admin, { empresaId: alfa.id, cuentaId: cuenta }), codigo("no_es_operador"));
  await registrarCuentaFintoc(personal, { empresaId: alfa.id, cuentaId: cuenta });
  const fintoc = fintocFalso(cuenta);
  const asegurar = (clienteId: string) => asegurarClabeDeCliente(baseCliente(admin), actorDeCliente(admin), auditar, clienteId, fintoc.cliente);
  const [a1, a2] = await Promise.all([asegurar(altaId), asegurar(altaId)]);
  assert.equal(a1?.clabe, a2?.clabe);
  assert.equal(fintoc.creadas(), 1);
  // Se cae después de que Fintoc la creó; el reintento (la llave de 24 h ya no sirve) la encuentra y no crea otra.
  fintoc.caerLaProxima();
  await assert.rejects(() => asegurar(variable.clienteId), codigo("proveedor_no_disponible"));
  assert.equal(contar(url, `select count(*) from collection_virtual_accounts where customer_id = '${variable.clienteId}'`), 0);
  const recuperada = await asegurar(variable.clienteId);
  assert.equal(recuperada?.recuperada, true);
  assert.equal(fintoc.creadas(), 2);
  assert.equal(contar(url, `select count(*) from collection_virtual_accounts where company_id = '${alfa.id}'`), 2);

  // El alta con Fintoc activo manda el cobro con la CLABE propia del cliente.
  const conClabe = await darDeAltaCliente(admin, { ...datosAlta, nombre: "Con CLABE propia", correos: "clabe-propia@ejemplo.mx", altaId: randomUUID() }, deps(HOY, { fintoc: fintoc.cliente }));
  assert.equal(conClabe.clabePropia, "creada");
  const propia = fintoc.clabes.find((c) => c.clienteId === conClabe.clienteId)!;
  assert.match(enviados.at(-1)?.texto ?? "", new RegExp(clabeVisible(propia.numero)));

  // El aviso firmado: el mismo evento dos veces deja un solo pago; firma vieja es 400; cuenta ajena se ignora.
  const configFintoc: ConfigFintoc = { llaveSecreta: `sk_test_${randomUUID().replace(/-/g, "")}`, secretoWebhook: createHash("sha256").update(randomUUID()).digest("hex"), modo: "test" };
  const ahoraSeg = Math.floor(Date.now() / 1000);
  const depsAviso = { config: configFintoc, ahora: () => new Date(ahoraSeg * 1000), auditar, enviador: deps().enviador, urlPublica: () => URL, registrar: () => {} };
  const evento = (cuentaNumero: string, monto: number, cuentaDe = cuenta) => JSON.stringify({
    id: `evt_${randomUUID().replace(/-/g, "")}`, type: "transfer.inbound.succeeded", object: "event", mode: "test", created_at: new Date().toISOString(),
    data: {
      id: `tr_${randomUUID().replace(/-/g, "")}`, object: "transfer", direction: "inbound", status: "succeeded", amount: monto, currency: "MXN", mode: "test",
      transaction_date: "2026-11-10T17:00:00.000Z", reference_id: null, tracking_key: "FINTOC0001",
      account_number: { id: cuentaNumero, account_id: cuentaDe }, counterparty: { holder_name: "Cliente con CLABE", account_number: null, account_type: "clabe" },
    },
  });
  const cuerpo = evento(propia.id, 1_000_000);
  const bytes = new TextEncoder().encode(cuerpo);
  const firma = firmar(cuerpo, configFintoc.secretoWebhook, ahoraSeg);
  assert.deepEqual(await atenderAviso(bytes, firma, depsAviso), { estado: 200, cuerpo: { ok: true, efecto: "registrado" } });
  assert.deepEqual(await atenderAviso(bytes, firma, depsAviso), { estado: 200, cuerpo: { ok: true, efecto: "repetido" } });
  assert.equal(contar(url, `select count(*) from collection_payments where fuente = 'fintoc'`), 1);
  assert.equal(contar(url, `select count(*) from collection_payments where fuente = 'fintoc' and customer_id = '${conClabe.clienteId}' and estado = 'aplicado'`), 1);
  assert.equal((await atenderAviso(bytes, firmar(cuerpo, configFintoc.secretoWebhook, ahoraSeg - 301), depsAviso)).estado, 400);
  // r63-N7: un abono a una cuenta que nadie registró no se pierde: queda «sin destino» para el personal, y el registro no lleva datos.
  const ajeno = evento("acno_NoExiste", 100, "acc_Ajena");
  const lineas: string[] = [];
  const errorOriginal = console.error;
  console.error = (linea: unknown) => { lineas.push(String(linea)); };
  try {
    assert.deepEqual(await atenderAviso(new TextEncoder().encode(ajeno), firmar(ajeno, configFintoc.secretoWebhook, ahoraSeg), depsAviso), { estado: 200, cuerpo: { ok: true, efecto: "sin_destino" } });
    assert.deepEqual(await atenderAviso(new TextEncoder().encode(ajeno), firmar(ajeno, configFintoc.secretoWebhook, ahoraSeg), depsAviso), { estado: 200, cuerpo: { ok: true, efecto: "repetido" } });
  } finally {
    console.error = errorOriginal;
  }
  assert.equal(contar(url, "select count(*) from collection_unrouted_events where proveedor = 'fintoc' and cuenta_id = 'acc_Ajena' and cuenta_numero_id = 'acno_NoExiste' and monto_centavos = 100"), 1);
  assert.ok(lineas.length > 0);
  for (const linea of lineas) assert.doesNotMatch(linea, /acc_Ajena|acno_NoExiste|evt_|tr_|"monto|Cliente con CLABE/);
  // El personal lo ve con avisos:sin-destino; una empresa no.
  const sinDestino = await leerAvisosSinDestino(personal, 10);
  assert.deepEqual(sinDestino.map((a) => [a.tipo, a.cuentaId, a.cuentaNumeroId, a.montoCentavos]), [["transfer.inbound.succeeded", "acc_Ajena", "acno_NoExiste", 100]]);
  await assert.rejects(() => leerAvisosSinDestino(admin, 10), codigo("no_es_operador"));

  // 11. Estado de cuenta (Beta): la primera vez se empatan columnas; el abono con referencia se aplica,
  // el que no se identifica va a «Por conciliar», el marcado se descarta, y volver a subirlo no duplica nada.
  const deBeta = await darDeAltaCliente(adminBeta, { ...datosAlta, nombre: "Cliente Estado de Cuenta", correos: "edc@ejemplo.mx", monto: "2500.00", altaId: randomUUID() }, deps());
  const [cargoBeta] = consultarJson<{ id: string; referencia: string }[]>(url, `select json_agg(json_build_object('id', id, 'referencia', referencia)) from collection_charges where customer_id = '${deBeta.clienteId}'`);
  assert.ok(cargoBeta);
  const csv = [
    "Fecha,Concepto,Referencia,Cargo,Abono,Saldo",
    `09/11/2026,SPEI RECIBIDO ${cargoBeta.referencia},${cargoBeta.referencia},,"2,500.00","10,000.00"`,
    `10/11/2026,SPEI RECIBIDO SIN REFERENCIA,,,"777.00","10,777.00"`,
    `10/11/2026,INTERESES DEL MES,,,"12.34","10,789.34"`,
    `10/11/2026,COMISION,,"50.00",,"10,739.34"`,
  ].join("\r\n");
  const archivo = { nombre: "banorte-noviembre.csv", bytes: new TextEncoder().encode(csv) };
  const primera = await prepararEstadoDeCuenta(adminBeta, { banco: "banorte" }, archivo, deps());
  assert.equal(primera.tipo, "empatar");
  await assert.rejects(() => prepararEstadoDeCuenta(contador, { banco: "banorte" }, archivo, deps()), codigo("sin_permiso"));
  const empate = { banco: "banorte", empatar: "si", filaEncabezado: "0", columnaFecha: "0", columnaConcepto: "1", columnaReferencia: "2", columnaAbono: "4", columnaRastreo: "" };
  const importado = await prepararEstadoDeCuenta(adminBeta, empate, archivo, deps());
  assert.equal(importado.tipo, "importado");
  if (importado.tipo !== "importado") return;
  assert.equal(importado.nuevos, 3);
  const vistaEdc = await leerVistaEstadoDeCuenta(adminBeta, importado.importacionId);
  assert.deepEqual(vistaEdc.bancosConEmpate, ["banorte"]);
  const propuestas = new Map(vistaEdc.actual!.renglones.map((r) => [r.montoCentavos, r]));
  assert.equal(propuestas.get(250_000)?.propuesta?.tipo, "aplicar");
  assert.equal(propuestas.get(77_700)?.propuesta?.tipo, "por_conciliar");
  // Alfa no ve la importación de Beta.
  assert.equal((await leerVistaEstadoDeCuenta(admin, importado.importacionId)).actual, null);
  const confirmado = await confirmarEstadoDeCuenta(adminBeta, { importacionId: importado.importacionId, descartar: [propuestas.get(1_234)!.id] }, deps());
  assert.deepEqual(confirmado, { aplicados: 1, porConciliar: 1, yaRegistrados: 0, descartados: 1 });
  await assert.rejects(() => confirmarEstadoDeCuenta(adminBeta, { importacionId: importado.importacionId, descartar: [] }, deps()));
  assert.equal(consultarJson<{ e: string }[]>(url, `select json_agg(json_build_object('e', estado)) from collection_charges where id = '${cargoBeta.id}'`)[0]!.e, "pagado");
  assert.equal(contar(url, `select count(*) from collection_payments where company_id = '${beta.id}' and fuente = 'estado_cuenta'`), 2);
  assert.equal(contar(url, `select count(*) from collection_payments where company_id = '${beta.id}' and fuente = 'estado_cuenta' and estado = 'abierto'`), 1);
  // Segunda vez, el mismo archivo: se frena de entrada con su fecha, con el banco que sea (r63-N1).
  const yaImportado = (e: unknown) => e instanceof ErrorDeCaptura && e.errores[0]?.campo === "archivo" && /^Ese archivo ya se importó el /.test(e.errores[0]?.mensaje ?? "");
  await assert.rejects(() => prepararEstadoDeCuenta(adminBeta, { banco: "banorte" }, archivo, deps()), yaImportado);
  await assert.rejects(() => prepararEstadoDeCuenta(adminBeta, { ...empate, banco: "hsbc" }, archivo, deps()), yaImportado);
  assert.equal(contar(url, `select count(*) from collection_statement_rows where company_id = '${beta.id}'`), 3);
  assert.equal(contar(url, `select count(*) from audit_log where accion in ('empate_estado_cuenta', 'importar_estado_cuenta', 'confirmar_estado_cuenta') and company_id = '${beta.id}'`), 3);

  // 12. Revisión del #63 ------------------------------------------------------------------------
  await revision63(url, { admin, adminBeta, sesionAdmin, personal, alfa, beta, deps, enviados, codigo, cuenta, propia, configFintoc, depsAviso, ahoraSeg, altaId, variableId: variable.clienteId, empate });
  await revision63b(url, { admin, adminBeta, sesionAdmin, personal, alfa, beta, deps, enviados, codigo, cuenta, propia, configFintoc, depsAviso, ahoraSeg, altaId, variableId: variable.clienteId, empate });

  // Toda escritura dejó su evento: ninguna fila de cobranza sin bitácora.
  assert.equal(contar(url, `select count(*) from collection_payments p where not exists (select 1 from audit_log a where a.identificador = p.id)`), 0);
  assert.equal(contar(url, `select count(*) from collection_virtual_accounts v where not exists (select 1 from audit_log a where a.identificador = v.id)`), 0);
}

type Revision63 = {
  admin: ContextoConEmpresa;
  adminBeta: ContextoConEmpresa;
  sesionAdmin: Sesion;
  personal: Awaited<ReturnType<typeof contextoDePersonal>>;
  alfa: { id: string };
  beta: { id: string };
  deps: (ahora?: () => Date, extra?: Partial<DependenciasCobranza>) => DependenciasCobranza;
  enviados: MensajeCorreo[];
  codigo: (esperado: string) => (e: unknown) => boolean;
  cuenta: string;
  propia: ClabeFintoc;
  configFintoc: ConfigFintoc;
  depsAviso: Parameters<typeof atenderAviso>[2];
  ahoraSeg: number;
  altaId: string;
  variableId: string;
  empate: Record<string, string>;
};

/** Las regresiones de la revisión del #63 (revision-63.md): cada una falló antes de su arreglo. */
async function revision63(url: string, r: Revision63): Promise<void> {
  const { admin, adminBeta, deps, enviados, codigo, cuenta, configFintoc, depsAviso, ahoraSeg } = r;
  const fila = <T,>(sql: string) => consultarJson<T[]>(url, `select json_agg(x) from (${sql}) x`)?.[0];
  const avisoFintoc = async (datos: { tipo?: string; status?: string; transferencia?: string; cuentaNumero: string; cuentaDe?: string; monto: number; referencia?: string | null; ordenante?: string | null; rastreo?: string | null }) => {
    const cuerpo = JSON.stringify({
      id: `evt_${randomUUID().replace(/-/g, "")}`, type: datos.tipo ?? "transfer.inbound.succeeded", object: "event", mode: "test", created_at: new Date().toISOString(),
      data: {
        id: datos.transferencia ?? `tr_${randomUUID().replace(/-/g, "")}`, object: "transfer", direction: "inbound", status: datos.status ?? "succeeded",
        amount: datos.monto, currency: "MXN", mode: "test", transaction_date: "2026-11-10T17:00:00.000Z",
        reference_id: datos.referencia ?? null, tracking_key: datos.rastreo ?? null,
        account_number: { id: datos.cuentaNumero, account_id: datos.cuentaDe ?? cuenta },
        counterparty: { holder_name: "Ordenante de prueba", account_number: datos.ordenante ?? null, account_type: "clabe" },
      },
    });
    return atenderAviso(new TextEncoder().encode(cuerpo), firmar(cuerpo, configFintoc.secretoWebhook, ahoraSeg), depsAviso);
  };
  const principal = "acno_PrincipalAlfa01";
  const cargoAbierto = (cliente: string) => fila<{ id: string; referencia: string; saldo: number }>(
    `select id, referencia, (monto_centavos - pagado_centavos)::int as saldo from collection_charges where customer_id = '${cliente}' and estado = 'emitido' order by vencimiento limit 1`)!;

  // r63-N2 (webhook): un número corto de un tercero a la cuenta de la empresa no se aplica a nadie.
  const deVariable = cargoAbierto(r.variableId);
  const corto = deVariable.referencia.slice(-2);
  assert.deepEqual(await avisoFintoc({ cuentaNumero: principal, monto: 100, referencia: corto, rastreo: "CORTO0001" }), { estado: 200, cuerpo: { ok: true, efecto: "registrado" } });
  assert.deepEqual(fila(`select estado, customer_id, aplicado_centavos from collection_payments where clave_rastreo = 'CORTO0001'`), { estado: "abierto", customer_id: null, aplicado_centavos: 0 });
  // Con los 7 dígitos sí se aplica, aunque sea un pago parcial.
  assert.deepEqual(await avisoFintoc({ cuentaNumero: principal, monto: 100, referencia: deVariable.referencia, rastreo: "COMPLETO01" }), { estado: 200, cuerpo: { ok: true, efecto: "registrado" } });
  assert.deepEqual(fila(`select estado, aplicado_centavos from collection_payments where clave_rastreo = 'COMPLETO01'`), { estado: "aplicado", aplicado_centavos: 100 });
  assert.equal(fila<{ p: number }>(`select pagado_centavos as p from collection_charges where id = '${deVariable.id}'`)!.p, 100);

  // r63-N4: la CLABE X pagó antes por Uno; ahora manda la referencia de Variable: se aplica a Variable, con la marca visible.
  const d17 = "01218000123456789";
  const clabeX = `${d17}${digitoClabe(d17)}`;
  const deUno = cargoAbierto(r.altaId);
  await avisoFintoc({ cuentaNumero: principal, monto: 10_000, referencia: deUno.referencia, ordenante: clabeX, rastreo: "XUNO0001" });
  assert.equal(fila<{ m: boolean }>(`select de_otro_cliente as m from collection_payments where clave_rastreo = 'XUNO0001'`)!.m, false);
  const transferenciaX = `tr_${randomUUID().replace(/-/g, "")}`;
  await avisoFintoc({ cuentaNumero: principal, monto: 7_000, referencia: deVariable.referencia, ordenante: clabeX, rastreo: "XDOS0001", transferencia: transferenciaX });
  assert.deepEqual(fila(`select estado, customer_id, de_otro_cliente from collection_payments where clave_rastreo = 'XDOS0001'`), { estado: "aplicado", customer_id: r.variableId, de_otro_cliente: true });
  const vistaVariable = await leerVistaCliente(admin, r.variableId, deps());
  assert.equal(vistaVariable?.detalle.pagos.find((p) => p.claveRastreo === "XDOS0001")?.deOtroCliente, true);

  // r63-N8, falla segura: una devolución con una forma que no es la de la doc (aquí status «return_pending») no se lee:
  // responde 500 para que Fintoc reintente y no mueve ni el pago ni el cargo.
  const pagosAntes = contar(url, "select count(*) from collection_payments");
  const reversionesAntes = contar(url, "select count(*) from collection_applications where regla = 'reversion'");
  assert.deepEqual(await avisoFintoc({ tipo: "transfer.inbound.returned", status: "return_pending", cuentaNumero: principal, monto: 7_000, transferencia: transferenciaX }),
    { estado: 500, cuerpo: { error: "aviso_ilegible" } });
  assert.deepEqual(fila(`select estado, aplicado_centavos from collection_payments where clave_rastreo = 'XDOS0001'`), { estado: "aplicado", aplicado_centavos: 7_000 });
  assert.equal(contar(url, "select count(*) from collection_payments"), pagosAntes);
  assert.equal(contar(url, "select count(*) from collection_applications where regla = 'reversion'"), reversionesAntes);

  // r63-N8: Fintoc avisa que la empresa devolvió esa transferencia: se revierte, el cargo vuelve a emitido y se avisa.
  const avisosAntes = enviados.length;
  const devuelta = await avisoFintoc({ tipo: "transfer.inbound.returned", status: "returned", cuentaNumero: principal, monto: 7_000, referencia: deVariable.referencia, ordenante: clabeX, rastreo: "XDOS0001", transferencia: transferenciaX });
  assert.deepEqual(devuelta, { estado: 200, cuerpo: { ok: true, efecto: "devuelto" } });
  assert.deepEqual(fila(`select estado, aplicado_centavos from collection_payments where clave_rastreo = 'XDOS0001'`), { estado: "devuelto", aplicado_centavos: 0 });
  assert.deepEqual(fila(`select estado, pagado_centavos from collection_charges where id = '${deVariable.id}'`), { estado: "emitido", pagado_centavos: 100 });
  assert.equal(contar(url, `select count(*) from collection_applications a join collection_payments p on p.id = a.payment_id where p.clave_rastreo = 'XDOS0001' and a.regla = 'reversion'`), 1);
  assert.equal(enviados.length, avisosAntes + 1);
  assert.match(enviados.at(-1)?.asunto ?? "", /devolvi/i);
  // El mismo aviso de devolución otra vez no revierte dos veces; «return_failed» no cambia nada.
  assert.deepEqual((await avisoFintoc({ tipo: "transfer.inbound.returned", status: "returned", cuentaNumero: principal, monto: 7_000, transferencia: transferenciaX })).cuerpo, { ok: true, efecto: "repetido" });
  assert.deepEqual((await avisoFintoc({ tipo: "transfer.inbound.return_failed", status: "succeeded", cuentaNumero: principal, monto: 7_000, transferencia: transferenciaX })).cuerpo, { ok: true, efecto: "ignorado" });
  assert.equal(contar(url, `select count(*) from collection_applications a join collection_payments p on p.id = a.payment_id where p.clave_rastreo = 'XDOS0001' and a.regla = 'reversion'`), 1);

  // r63-base-N3: la plataforma cambia la cuenta de Fintoc de Alfa; la CLABE que el cliente ya tenía sigue registrando sus pagos.
  await registrarCuentaFintoc(r.personal, { empresaId: r.alfa.id, cuentaId: "acc_PruebaAlfa02" });
  assert.deepEqual(await avisoFintoc({ cuentaNumero: r.propia.id, cuentaDe: cuenta, monto: 2_500, rastreo: "HUERFANA01" }), { estado: 200, cuerpo: { ok: true, efecto: "registrado" } });
  assert.equal(contar(url, `select count(*) from collection_payments where clave_rastreo = 'HUERFANA01' and company_id = '${r.alfa.id}' and customer_id = '${r.propia.clienteId}'`), 1);

  // r63-N3: el correo de contacto (el Reply-To de cada cobro) exige segundo factor reciente y avisa; el beneficiario también avisa.
  const config = fila<{ clabe: string; beneficiario: string; correo_contacto: string }>(`select clabe, beneficiario, correo_contacto from collection_settings where company_id = '${r.alfa.id}'`)!;
  const base = { clabe: config.clabe, beneficiario: config.beneficiario, correoContacto: config.correo_contacto, emitirDiasAntes: "7", antesDias: "3", avisoElDia: "si", despuesCadaDias: "7", despuesTope: "3", envioAutomatico: "si" };
  const vieja = { ...r.sesionAdmin, segundoFactor: { metodo: r.sesionAdmin.segundoFactor!.metodo, en: new Date(Date.now() - 31 * 60_000) } };
  await assert.rejects(() => configurarCobranza(admin, { ...base, correoContacto: "otro-buzon-r63@ejemplo.mx" }, vieja, deps()), codigo("reautenticacion_requerida"));
  assert.equal(fila<{ c: string }>(`select correo_contacto as c from collection_settings where company_id = '${r.alfa.id}'`)!.c, config.correo_contacto);
  const antesContacto = enviados.length;
  assert.deepEqual(await configurarCobranza(admin, { ...base, correoContacto: "otro-buzon-r63@ejemplo.mx" }, r.sesionAdmin, deps()), { clabeCambio: false, avisos: 1 });
  assert.match(enviados.at(-1)?.asunto ?? "", /correo de contacto/i);
  assert.equal(enviados.length, antesContacto + 1);
  assert.deepEqual(await configurarCobranza(admin, { ...base, correoContacto: "otro-buzon-r63@ejemplo.mx", beneficiario: "Escuela Alfa Cobranza SC" }, r.sesionAdmin, deps()), { clabeCambio: false, avisos: 1 });
  assert.match(enviados.at(-1)?.asunto ?? "", /beneficiario/i);
  // Lo demás (el calendario) no pide factor ni avisa.
  assert.deepEqual(await configurarCobranza(admin, { ...base, correoContacto: "otro-buzon-r63@ejemplo.mx", beneficiario: "Escuela Alfa Cobranza SC", antesDias: "2" }, vieja, deps()), { clabeCambio: false, avisos: 0 });

  // r63-N10: registrar un pago con el id de un cargo de otra empresa dice «no encontrado», no «ya cambió».
  const deBeta = fila<{ id: string }>(`select id from collection_charges where company_id = '${r.beta.id}' limit 1`)!;
  await assert.rejects(() => registrarPagoManual(admin, { altaId: randomUUID(), cargoId: deBeta.id, monto: "1.00", recibidoEl: "2026-11-10" }, null, deps()), codigo("cargo_ausente"));
  assert.equal(contar(url, `select count(*) from collection_payments where id_externo like 'manual:%' and company_id = '${r.alfa.id}' and monto_centavos = 100`), 0);

  // r63-N1: el mismo depósito en otro archivo (con un renglón nuevo), con otro banco y otro empate, no se aplica dos veces.
  const deBetaEmitido = fila<{ id: string; referencia: string }>(`select id, referencia from collection_charges where company_id = '${r.beta.id}' and estado = 'pagado' limit 1`)!;
  const pagadoAntes = fila<{ p: number }>(`select pagado_centavos as p from collection_charges where id = '${deBetaEmitido.id}'`)!.p;
  const otroArchivo = [
    "Fecha,Concepto,Referencia,Cargo,Abono,Saldo",
    `09/11/2026,SPEI RECIBIDO ${deBetaEmitido.referencia},${deBetaEmitido.referencia},,"2,500.00","10,000.00"`,
    `10/11/2026,DEPOSITO DE TERCERO SIN RELACION,18,,"1.00","10,740.34"`,
  ].join("\r\n");
  // Otro banco y otro empate (sin la columna del concepto): el renglón repetido se reconoce igual.
  const conOtroEmpate = { ...r.empate, banco: "hsbc", columnaConcepto: "" };
  const segunda = await prepararEstadoDeCuenta(adminBeta, conOtroEmpate, { nombre: "hsbc-noviembre.csv", bytes: new TextEncoder().encode(otroArchivo) }, deps());
  assert.equal(segunda.tipo, "importado");
  if (segunda.tipo !== "importado") return;
  assert.deepEqual([segunda.nuevos, segunda.repetidos], [1, 1]);
  // r63-N2 (estado de cuenta): «18» de un tercero va a «Por conciliar» como referencia incompleta.
  const vistaSegunda = await leerVistaEstadoDeCuenta(adminBeta, segunda.importacionId);
  const renglon18 = vistaSegunda.actual!.renglones.find((x) => x.montoCentavos === 100)!;
  assert.equal(renglon18.propuesta?.tipo, "por_conciliar");
  assert.equal(renglon18.propuesta?.tipo === "por_conciliar" ? renglon18.propuesta.motivo : null, "referencia_incompleta");
  assert.deepEqual(await confirmarEstadoDeCuenta(adminBeta, { importacionId: segunda.importacionId, descartar: [] }, deps()), { aplicados: 0, porConciliar: 1, yaRegistrados: 0, descartados: 0 });
  assert.equal(fila<{ p: number }>(`select pagado_centavos as p from collection_charges where id = '${deBetaEmitido.id}'`)!.p, pagadoAntes);
  assert.equal(contar(url, `select count(*) from collection_applications where charge_id = '${deBetaEmitido.id}'`), 1);
  // La base frena el mismo archivo aunque dos subidas lleguen a la vez: UNIQUE (empresa, huella del archivo).
  assert.equal(contar(url, `select count(*) from pg_constraint where conname = 'collection_statement_imports_archivo_unico'`), 1);
}

/**
 * r63b-N1: el mismo depósito por dos fuentes sin una clave de rastreo que los empate. El abono que coincide con un pago
 * vigente de otra fuente en monto, referencia y fecha (±1 día) va a «Por conciliar» como posible duplicado, en los dos
 * órdenes y también si las dos fuentes llegan a la vez. Cada caso falla en 247f0ef (se aplicaba dos veces).
 */
async function revision63b(url: string, r: Revision63): Promise<void> {
  // revision63 deja a Alfa con su segunda cuenta de Fintoc (r63-base-N3).
  const { admin, deps, configFintoc, depsAviso, ahoraSeg } = r;
  const fila = <T,>(sql: string) => consultarJson<T[]>(url, `select json_agg(x) from (${sql}) x`)?.[0];
  const cargo = async (nombre: string, monto: string) => {
    const alta = await darDeAltaCliente(admin, { nombre, rfc: "", correos: "r63b@ejemplo.mx", concepto: `Servicio ${nombre}`, tipo: "fijo", monto, periodicidad: "mensual", primerVencimiento: "2026-11-15", fin: "", altaId: randomUUID() }, deps());
    return fila<{ id: string; referencia: string }>(`select id, referencia from collection_charges where customer_id = '${alta.clienteId}' and estado = 'emitido'`)!;
  };
  // Un aviso de Fintoc a la cuenta de la empresa (no a la CLABE de un cliente): manda la referencia.
  // Por omisión a la cuenta de la empresa; `cuentaNumero` la manda a la CLABE propia de un cliente. Una devolución lleva
  // el tipo `returned` y la misma transferencia.
  const fintoc = async (
    monto: number, referencia: string | null, fecha = "2026-11-10", rastreo: string | null = null,
    extra: { cuentaNumero?: string; transferencia?: string; devolucion?: boolean } = {},
  ) => {
    const cuerpo = JSON.stringify({
      id: `evt_${randomUUID().replace(/-/g, "")}`, type: extra.devolucion ? "transfer.inbound.returned" : "transfer.inbound.succeeded", object: "event", mode: "test", created_at: new Date().toISOString(),
      data: {
        id: extra.transferencia ?? `tr_${randomUUID().replace(/-/g, "")}`, object: "transfer", direction: "inbound", status: extra.devolucion ? "returned" : "succeeded", amount: monto, currency: "MXN", mode: "test",
        transaction_date: `${fecha}T17:00:00.000Z`, reference_id: referencia, tracking_key: rastreo,
        account_number: { id: extra.cuentaNumero ?? "acno_CuentaDeLaEmpresa", account_id: "acc_PruebaAlfa02" }, counterparty: { holder_name: "Ordenante r63b", account_number: null, account_type: "clabe" },
      },
    });
    return atenderAviso(new TextEncoder().encode(cuerpo), firmar(cuerpo, configFintoc.secretoWebhook, ahoraSeg), depsAviso);
  };
  // Un estado de cuenta de BBVA sin columna de rastreo (muchos bancos lo traen en el concepto).
  const empateBbva = { banco: "bbva", empatar: "si", filaEncabezado: "0", columnaFecha: "0", columnaConcepto: "1", columnaReferencia: "2", columnaAbono: "3", columnaRastreo: "" };
  const subir = async (renglones: string[]) => {
    const csv = ["Fecha,Concepto,Referencia,Abono", ...renglones].join("\r\n");
    const hecho = await prepararEstadoDeCuenta(admin, empateBbva, { nombre: `bbva-${randomUUID().slice(0, 8)}.csv`, bytes: new TextEncoder().encode(csv) }, deps());
    assert.equal(hecho.tipo, "importado");
    if (hecho.tipo !== "importado") throw new Error("sin importar");
    const vista = await leerVistaEstadoDeCuenta(admin, hecho.importacionId);
    return { id: hecho.importacionId, renglones: vista.actual!.renglones };
  };
  const confirmar = (id: string) => confirmarEstadoDeCuenta(admin, { importacionId: id, descartar: [] }, deps());
  const pagado = (cargoId: string) => fila<{ p: number }>(`select pagado_centavos as p from collection_charges where id = '${cargoId}'`)!.p;
  const aplicaciones = (cargoId: string) => contar(url, `select count(*) from collection_applications where charge_id = '${cargoId}' and regla <> 'reversion'`);
  const ultimo = (fuente: string, monto: number) => fila<{ id: string; estado: string; posible_duplicado: boolean; parecido_a: string | null }>(
    `select id, estado, posible_duplicado, parecido_a from collection_payments where company_id = '${r.alfa.id}' and fuente = '${fuente}' and monto_centavos = ${monto} order by registrado_en desc limit 1`)!;

  // Cada caso corre aunque otro falle: así se ve cuáles caen sin el arreglo.
  const fallas: string[] = [];
  const caso = async (nombre: string, pasos: () => Promise<void>) => {
    try {
      await pasos();
    } catch (error) {
      fallas.push(`${nombre}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    }
  };

  // Caso D del revisor: Fintoc aplica, y el mismo depósito en el estado de cuenta (rastreo en el concepto, sin columna) no.
  await caso("caso D (Fintoc → estado de cuenta)", async () => {
    // El cargo debe el doble: con saldo, el código anterior aplicaba el depósito otra vez (con el cargo ya pagado lo frenaba).
    const d = await cargo("R63b D", "246.00");
    assert.deepEqual(await fintoc(12_300, d.referencia, "2026-11-10", "R63D0000000001"), { estado: 200, cuerpo: { ok: true, efecto: "registrado" } });
    assert.equal(pagado(d.id), 12_300);
    const deD = await subir([`10/11/2026,SPEI RECIBIDO R63D0000000001,${d.referencia},123.00`]);
    const propuestaD = deD.renglones[0]!.propuesta;
    assert.equal(propuestaD?.tipo, "por_conciliar", "caso D: la propuesta aplicaba el mismo depósito otra vez");
    assert.equal(propuestaD?.tipo === "por_conciliar" ? propuestaD.motivo : null, "parecido_de_otra_fuente");
    assert.equal(propuestaD?.tipo === "por_conciliar" ? propuestaD.parecido?.fuente : null, "fintoc");
    assert.deepEqual(await confirmar(deD.id), { aplicados: 0, porConciliar: 1, yaRegistrados: 0, descartados: 0 });
    assert.deepEqual([pagado(d.id), aplicaciones(d.id)], [12_300, 1], "caso D: el cargo sumó dos aplicaciones");
    const dupD = ultimo("estado_cuenta", 12_300);
    assert.deepEqual([dupD.estado, dupD.posible_duplicado, dupD.parecido_a], ["abierto", true, ultimo("fintoc", 12_300).id]);
    // Se descarta: queda anulado con su motivo y su evento, que nombra el pago parecido.
    await anularPago(admin, { pagoId: dupD.id, motivo: "Es el mismo depósito que llegó por Fintoc" }, deps());
    assert.equal(ultimo("estado_cuenta", 12_300).estado, "anulado");
    assert.equal(contar(url, `select count(*) from audit_log where accion = 'descartar_duplicado_cobranza' and identificador = '${dupD.id}' and cambio->>'parecido_a' = '${dupD.parecido_a}'`), 1);
    // Un pago automático que no es posible duplicado sigue sin poder anularse.
    await assert.rejects(() => anularPago(admin, { pagoId: ultimo("fintoc", 12_300).id, motivo: "No se puede anular" }, deps()), r.codigo("pago_no_anulable"));
  });

  // Manual y luego el estado de cuenta (un día después): no se aplica dos veces.
  await caso("manual → estado de cuenta", async () => {
    const m = await cargo("R63b Manual", "468.00");
    const manual = await registrarPagoManual(admin, { altaId: randomUUID(), cargoId: m.id, monto: "234.00", recibidoEl: "2026-11-09" }, null, deps());
    assert.equal(manual.aplicadoCentavos, 23_400);
    const deM = await subir([`10/11/2026,DEPOSITO ${m.referencia},${m.referencia},234.00`]);
    assert.deepEqual(await confirmar(deM.id), { aplicados: 0, porConciliar: 1, yaRegistrados: 0, descartados: 0 }, "manual → estado de cuenta: se aplicó dos veces");
    assert.deepEqual([pagado(m.id), aplicaciones(m.id)], [23_400, 1]);
    assert.equal(ultimo("estado_cuenta", 23_400).parecido_a, manual.pagoId);
  });

  // El estado de cuenta primero y luego Fintoc: el aviso queda como posible duplicado.
  await caso("estado de cuenta → Fintoc", async () => {
    const e = await cargo("R63b Estado", "690.00");
    const deE = await subir([`09/11/2026,SPEI RECIBIDO ${e.referencia},${e.referencia},345.00`]);
    assert.deepEqual(await confirmar(deE.id), { aplicados: 1, porConciliar: 0, yaRegistrados: 0, descartados: 0 });
    await fintoc(34_500, e.referencia, "2026-11-10");
    assert.deepEqual([pagado(e.id), aplicaciones(e.id)], [34_500, 1], "estado de cuenta → Fintoc: se aplicó dos veces");
    const dupE = ultimo("fintoc", 34_500);
    assert.deepEqual([dupE.estado, dupE.posible_duplicado, dupE.parecido_a], ["abierto", true, ultimo("estado_cuenta", 34_500).id]);
  });

  // El pago a mano después de Fintoc, con el cargo elegido (aún con saldo): tampoco se aplica solo.
  await caso("Fintoc → manual", async () => {
    const f = await cargo("R63b Fintoc Manual", "1356.00");
    await fintoc(67_800, f.referencia, "2026-11-10");
    const tarde = await registrarPagoManual(admin, { altaId: randomUUID(), cargoId: f.id, monto: "678.00", recibidoEl: "2026-11-10" }, null, deps());
    assert.deepEqual([tarde.aplicadoCentavos, tarde.posibleDuplicado, tarde.parecido], [0, true, true]);
    assert.deepEqual([pagado(f.id), aplicaciones(f.id)], [67_800, 1]);
  });

  // La orilla: a dos días ya no es el mismo depósito (se aplica); a un día, sí lo parece.
  await caso("orilla de ±1 día", async () => {
    const o = await cargo("R63b Orilla", "912.00");
    await fintoc(45_600, o.referencia, "2026-11-10");
    const deO = await subir([`08/11/2026,SPEI RECIBIDO ${o.referencia},${o.referencia},456.00`]);
    assert.deepEqual(await confirmar(deO.id), { aplicados: 1, porConciliar: 0, yaRegistrados: 0, descartados: 0 }, "a dos días se aplica");
    assert.deepEqual([pagado(o.id), aplicaciones(o.id)], [91_200, 2]);
  });

  // Otro monto con la misma referencia y el mismo día: es otro pago y se aplica normal.
  await caso("otro monto", async () => {
    const p = await cargo("R63b Parcial", "1000.00");
    await fintoc(40_000, p.referencia, "2026-11-10");
    const deP = await subir([`10/11/2026,SPEI RECIBIDO ${p.referencia},${p.referencia},600.00`]);
    assert.deepEqual(await confirmar(deP.id), { aplicados: 1, porConciliar: 0, yaRegistrados: 0, descartados: 0 }, "otro monto se aplica");
    assert.equal(pagado(p.id), 100_000);
  });

  // Otra referencia, mismo monto y día: dos pagos distintos, los dos se aplican.
  await caso("otra referencia", async () => {
    const [x1, x2] = [await cargo("R63b Ref Uno", "321.00"), await cargo("R63b Ref Dos", "321.00")];
    await fintoc(32_100, x1.referencia, "2026-11-10");
    const deX = await subir([`10/11/2026,SPEI RECIBIDO ${x2.referencia},${x2.referencia},321.00`]);
    assert.deepEqual(await confirmar(deX.id), { aplicados: 1, porConciliar: 0, yaRegistrados: 0, descartados: 0 });
    assert.deepEqual([pagado(x1.id), pagado(x2.id)], [32_100, 32_100]);
  });

  // Sin referencia de un lado (criterio conservador): mismo monto y fecha que un pago de otra fuente va a «Por conciliar».
  // Una persona decide que sí fueron dos depósitos y lo aplica.
  await caso("sin referencia (conservador) y aplicar", async () => {
    const q = await cargo("R63b Sin Ref", "1134.00");
    await fintoc(56_700, q.referencia, "2026-11-10");
    const deQ = await subir(["10/11/2026,SPEI RECIBIDO SIN REFERENCIA,,567.00"]);
    const propuestaQ = deQ.renglones[0]!.propuesta;
    assert.equal(propuestaQ?.tipo === "por_conciliar" ? propuestaQ.motivo : null, "parecido_de_otra_fuente");
    assert.deepEqual(await confirmar(deQ.id), { aplicados: 0, porConciliar: 1, yaRegistrados: 0, descartados: 0 });
    await aplicarPago(admin, { pagoId: ultimo("estado_cuenta", 56_700).id, cargoId: q.id }, deps());
    assert.equal(pagado(q.id), 113_400);
  });

  // La carrera: Fintoc y el estado de cuenta del mismo depósito a la vez, en dos conexiones. El candado de la empresa
  // las forma: la segunda ve a la primera y el cargo recibe una sola aplicación, en cualquier orden.
  await caso("carrera de dos conexiones", async () => {
    for (const [i, monto] of [[1, "789.00"], [2, "790.00"], [3, "791.00"]] as const) {
      const centavosK = Math.round(Number(monto) * 100);
      const k = await cargo(`R63b Carrera ${i}`, (centavosK * 2 / 100).toFixed(2));
      const deK = await subir([`10/11/2026,SPEI RECIBIDO ${k.referencia},${k.referencia},${monto}`]);
      const [aviso, confirmado] = await Promise.all([fintoc(centavosK, k.referencia, "2026-11-10"), confirmar(deK.id)]);
      assert.equal(aviso.estado, 200);
      assert.equal(confirmado.aplicados + confirmado.porConciliar, 1);
      assert.deepEqual([pagado(k.id), aplicaciones(k.id)], [centavosK, 1], `carrera ${i}: dos aplicaciones`);
      assert.equal(contar(url, `select count(*) from collection_payments where company_id = '${r.alfa.id}' and monto_centavos = ${centavosK} and posible_duplicado and parecido_a is not null`), 1);
    }
  });

  // r63d-N1: el abono ya sabe de qué cliente es (llegó a la CLABE propia del cliente) y OTRO cliente pagó lo mismo ese día
  // por otra fuente: son dos depósitos de dos clientes y se aplica. Del mismo cliente sí queda frenado.
  const cargoDeLaClabe = async (concepto: string, monto: string) => {
    const hecho = await crearCargoUnico(admin, { clienteId: r.propia.clienteId, altaId: randomUUID(), concepto, monto, vencimiento: "2026-11-20" }, deps());
    return hecho.cargoId;
  };
  await caso("r63d-N1 otro cliente ya identificado", async () => {
    const otro = await cargo("R63d Otro Cliente", "135.00");
    await registrarPagoManual(admin, { altaId: randomUUID(), cargoId: otro.id, monto: "135.00", recibidoEl: "2026-11-10" }, null, deps());
    const suyo = await cargoDeLaClabe("R63d por su CLABE", "135.00");
    await fintoc(13_500, null, "2026-11-10", null, { cuentaNumero: r.propia.id });
    assert.deepEqual([pagado(suyo), aplicaciones(suyo)], [13_500, 1], "r63d-N1: el abono a la CLABE de su cliente quedó frenado por el pago de otro cliente");
    assert.equal(ultimo("fintoc", 13_500).posible_duplicado, false);
  });
  await caso("r63d-N1 mismo cliente, otra fuente: sigue frenado", async () => {
    const suyo = await cargoDeLaClabe("R63d mismo cliente", "492.00");
    const manual = await registrarPagoManual(admin, { altaId: randomUUID(), cargoId: suyo, monto: "246.00", recibidoEl: "2026-11-10" }, null, deps());
    await fintoc(24_600, null, "2026-11-10", null, { cuentaNumero: r.propia.id });
    assert.deepEqual([pagado(suyo), aplicaciones(suyo)], [24_600, 1], "mismo cliente: se aplicó dos veces");
    assert.equal(ultimo("fintoc", 24_600).parecido_a, manual.pagoId);
  });

  // r63d-N2: un pago anulado o devuelto ya no cuenta como parecido: el abono nuevo idéntico se aplica.
  await caso("r63d-N2 un pago anulado no frena", async () => {
    const k = await cargo("R63d Anulado", "579.00");
    const error = await registrarPagoManual(admin, { altaId: randomUUID(), monto: "579.00", recibidoEl: "2026-11-10" }, null, deps());
    await anularPago(admin, { pagoId: error.pagoId, motivo: "Se capturó por error" }, deps());
    const deK = await subir([`10/11/2026,SPEI RECIBIDO ${k.referencia},${k.referencia},579.00`]);
    assert.deepEqual(await confirmar(deK.id), { aplicados: 1, porConciliar: 0, yaRegistrados: 0, descartados: 0 }, "r63d-N2: el pago anulado frenó el abono");
  });
  await caso("r63d-N2 un pago devuelto no frena", async () => {
    const k = await cargo("R63d Devuelto", "681.00");
    const transferencia = `tr_${randomUUID().replace(/-/g, "")}`;
    await fintoc(34_050, k.referencia, "2026-11-10", null, { transferencia });
    assert.equal(pagado(k.id), 34_050);
    assert.deepEqual(await fintoc(34_050, k.referencia, "2026-11-10", null, { transferencia, devolucion: true }), { estado: 200, cuerpo: { ok: true, efecto: "devuelto" } });
    assert.equal(pagado(k.id), 0);
    const deK = await subir([`10/11/2026,SPEI RECIBIDO ${k.referencia} OTRA VEZ,${k.referencia},340.50`]);
    assert.deepEqual(await confirmar(deK.id), { aplicados: 1, porConciliar: 0, yaRegistrados: 0, descartados: 0 }, "r63d-N2: el pago devuelto frenó el abono");
    assert.equal(pagado(k.id), 34_050);
  });

  assert.deepEqual(fallas, [], "r63b-N1: casos que aplicaron dos veces el mismo depósito");

  // La base: parecido_a solo en un posible duplicado, y no cambia después.
  assert.equal(contar(url, "select count(*) from collection_payments where parecido_a is not null and not posible_duplicado"), 0);
  assert.equal(contar(url, "select count(*) from pg_constraint where conname in ('collection_payments_parecido', 'collection_payments_parecido_de')"), 2);
}
