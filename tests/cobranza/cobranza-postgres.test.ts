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
import { darDeAltaEmpresa } from "../../src/server/company/servicio.ts";
import type { MensajeCorreo } from "../../src/server/correo/tipos.ts";
import { atenderAviso, asegurarClabeDeCliente, firmar, registrarCuentaFintoc, type ClabeFintoc, type ClienteFintoc, type ConfigFintoc } from "../../src/server/cobranza/fintoc.ts";
import { confirmarEstadoDeCuenta, leerVistaEstadoDeCuenta, prepararEstadoDeCuenta } from "../../src/server/cobranza/estado-cuenta.ts";
import { leerPaginaDelPagador, pedirSinRecordatorios } from "../../src/server/cobranza/pagador.ts";
import {
  anularPago,
  aplicarPago,
  cambiarRecordatorios,
  capturarMontoVariable,
  configurarCobranza,
  darDeAltaCliente,
  leerVistaCliente,
  leerVistaCobranza,
  leerFiltros,
  registrarPagoManual,
  revertirAplicacion,
  simularAbono,
  editarCliente,
  type DependenciasCobranza,
} from "../../src/server/cobranza/servicio.ts";
import { correrCobranza } from "../../src/server/cobranza/tarea.ts";
import { actorDeCliente, auditar } from "../../src/server/bitacora/auditar.ts";
import { baseCliente } from "../../src/nucleo/contexto.ts";
import { aceptarInvitacion } from "../../src/server/invitaciones/servicio.ts";
import { darDeAltaPersona, nombrarCentro } from "../../src/server/personas/servicio.ts";
import { invitarAdministrador, contextoDePersonal } from "../../src/server/plataforma/servicio.ts";
import { leerSesion } from "../../src/server/session/servicio.ts";
import type { Sesion } from "../../src/server/session/tipos.ts";
import { resolverContexto } from "../../src/server/tenencia/resolver.ts";
import { aplicarArchivo, conBaseDesechable, consultarJson, ejecutar, exigirBaseDesechable, urlDeAplicacion } from "../aislamiento/postgres.ts";

const urlAdmin = process.env.AISLAMIENTO_DATABASE_URL?.trim() ?? "";
const CLAVE = "clave-segura-12";
const CLABE_EMPRESA = "002180701150123452";
const URL = "https://lever.ejemplo.mx";
const reloj = (iso: string) => () => new Date(iso);
/** Martes 10 de noviembre de 2026, mediodía en México. */
const HOY = reloj("2026-11-10T18:00:00.000Z");

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
  const alfa = await darDeAltaEmpresa(personal, { rfc: "TCM010101AB1", razonSocial: "Escuela Alfa Cobranza", codigoPostal: "06600", regimen: "601", usoCfdi: "G03" }, { demostracion: false });
  const beta = await darDeAltaEmpresa(personal, { rfc: "CABL840215RF4", razonSocial: "Taller Beta Cobranza", codigoPostal: "44100", regimen: "612", usoCfdi: "G03" }, { demostracion: false });
  const demo = await darDeAltaEmpresa(personal, { rfc: "MOT970101AA1", razonSocial: "Demo Cobranza", codigoPostal: "64000", regimen: "601", usoCfdi: "G03" }, { demostracion: true });
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
    assert.match(m.texto, /0000018/);
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
  const depsAviso = { config: configFintoc, ahora: () => new Date(ahoraSeg * 1000), auditar };
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
  const ajeno = evento("acno_NoExiste", 100, "acc_Ajena");
  assert.deepEqual(await atenderAviso(new TextEncoder().encode(ajeno), firmar(ajeno, configFintoc.secretoWebhook, ahoraSeg), depsAviso), { estado: 200, cuerpo: { ok: true, efecto: "ignorado" } });

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
  // Segunda vez: el empate guardado se usa solo y ningún renglón entra de nuevo.
  assert.deepEqual(await prepararEstadoDeCuenta(adminBeta, { banco: "banorte" }, archivo, deps()), { tipo: "sin_nuevos", repetidos: 3 });
  assert.equal(contar(url, `select count(*) from collection_statement_rows where company_id = '${beta.id}'`), 3);
  assert.equal(contar(url, `select count(*) from audit_log where accion in ('empate_estado_cuenta', 'importar_estado_cuenta', 'confirmar_estado_cuenta') and company_id = '${beta.id}'`), 3);

  // Toda escritura dejó su evento: ninguna fila de cobranza sin bitácora.
  assert.equal(contar(url, `select count(*) from collection_payments p where not exists (select 1 from audit_log a where a.identificador = p.id)`), 0);
  assert.equal(contar(url, `select count(*) from collection_virtual_accounts v where not exists (select 1 from audit_log a where a.identificador = v.id)`), 0);
}

async function administrador(url: string, personal: Awaited<ReturnType<typeof contextoDePersonal>>, empresa: { id: string; razonSocial: string }, correo: string): Promise<[ContextoConEmpresa, Sesion]> {
  const invitado = await invitarAdministrador(personal, { companyId: empresa.id, razonSocial: empresa.razonSocial, nombre: `Admin ${empresa.razonSocial}`, correo });
  await aceptarInvitacion({ token: invitado.emitida.token, contrasena: CLAVE, confirmacion: CLAVE });
  const sesion = await sesionPara(url, invitado.emitida.userId);
  return [(await resolverContexto({ sesion, empresaPedida: empresa.id, peticionId: null, superficie: "cliente" })).ctx as ContextoConEmpresa, sesion];
}

async function persona(url: string, admin: ContextoConEmpresa, centroId: string, nombre: string, correo: string, rol: string[]): Promise<ContextoConEmpresa> {
  let token = "";
  await darDeAltaPersona(admin, {
    nombre, alta: "2026-11-01", baja: "", centroId, jefeId: "", presupuesto: "", altaLlave: randomUUID(),
    nomina: "no", clabe: CLABE_EMPRESA, acceso: "nueva", correo, rol,
  }, {
    ahora: HOY,
    entregar: async (emitida) => {
      token = emitida.token;
      return { entregada: false, codigo: "correo_no_configurado" };
    },
  });
  const aceptada = await aceptarInvitacion({ token, contrasena: CLAVE, confirmacion: CLAVE });
  const sesion = await sesionPara(url, aceptada.userId);
  return (await resolverContexto({ sesion, empresaPedida: admin.empresa.id, peticionId: null, superficie: "cliente" })).ctx as ContextoConEmpresa;
}

function contar(url: string, sql: string): number {
  const fila = consultarJson<{ n: number }[]>(url, `select json_agg(json_build_object('n', (${sql}))) from (select 1) x`);
  return fila[0]?.n ?? -1;
}

async function sesionPara(url: string, userId: string): Promise<Sesion> {
  const token = `S${randomUUID().replace(/-/g, "")}AAAAAAAAAA`.slice(0, 43);
  const entradaId = randomUUID();
  const sesionId = randomUUID();
  const hashEntrada = createHash("sha256").update(entradaId).digest("hex");
  const hashSesion = createHash("sha256").update(token).digest("hex");
  ejecutar(url, `
    insert into auth_entradas (id, user_id, token_hash, creada_en, vence_en, verificada_con, verificada_en, consumida_en)
      values ('${entradaId}', '${userId}', '${hashEntrada}', now(), now() + interval '10 minutes', 'totp', now(), now());
    insert into sessions (id, user_id, token_hash, expires_at, segundo_factor, entrada_id)
      values ('${sesionId}', '${userId}', '${hashSesion}', now() + interval '12 hours', 'totp', '${entradaId}');
  `);
  const sesion = await leerSesion(`sesion=${token}`);
  if (!sesion?.segundoFactor) throw new Error("La sesión de prueba no quedó abierta.");
  return sesion;
}

function sembrarPersonal(url: string): void {
  ejecutar(url, `
    insert into users (id, nombre, correo, password_hash)
      values ('99999999-9999-4999-8999-999999999998', 'Personal', 'personal-cobranza@ejemplo.mx', '$2b$12$${"a".repeat(53)}');
    insert into platform_staff (operator_id, user_id, estado)
      values ((select id from operators order by alta_en limit 1), '99999999-9999-4999-8999-999999999998', 'activo');
    insert into platform_staff_roles (operator_id, user_id, rol)
      values ((select id from operators order by alta_en limit 1), '99999999-9999-4999-8999-999999999998', 'administracion_plataforma');
  `);
}
