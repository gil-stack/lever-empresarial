import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { cerrarConexion, conContexto } from "../../src/nucleo/db.ts";
import { baseCliente, type ContextoConEmpresa } from "../../src/nucleo/contexto.ts";
import { ErrorDeDominio } from "../../src/nucleo/error-de-dominio.ts";
import { auditar } from "../../src/server/bitacora/auditar.ts";
import { configurarCobranza, darDeAltaCliente, type DependenciasCobranza } from "../../src/server/cobranza/servicio.ts";
import { darDeAltaEmpresa } from "../../src/server/company/servicio.ts";
import { ErrorDeCorreo } from "../../src/server/correo/errores.ts";
import type { MensajeCorreo } from "../../src/server/correo/tipos.ts";
import { correrAlertasDeCaja } from "../../src/server/flujo/alertas-caja.ts";
import { configurarMesesMinimos, leerVistaRunway } from "../../src/server/flujo/runway.ts";
import { cancelarCobro, configurarColchon, declararSaldo, ErrorDeCaptura, leerFlujoInicio, registrarCobro, registrarObligacion } from "../../src/server/flujo/servicio.ts";
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
/** El lunes siguiente: otra semana, otra foto. */
const LUNES = reloj("2026-11-16T15:00:00.000Z");

describe("Runway y alertas de caja en Postgres", { skip: urlAdmin.length === 0 }, () => {
  it("foto semanal, un aviso por cruce, dos corridas a la vez, reintento, descartado, demo, permisos y RLS", async () => {
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

/** Un buzón falso: nada sale a internet; los destinatarios son siempre @ejemplo.mx. Se puede caer a voluntad. */
function buzon() {
  const enviados: MensajeCorreo[] = [];
  let caido = false;
  const enviador = () => async (m: MensajeCorreo) => {
    assert.match(m.para, /@ejemplo\.mx$/);
    if (caido) throw new ErrorDeCorreo("correo_no_disponible");
    enviados.push(m);
    return { id: randomUUID() };
  };
  return { enviados, enviador, caer: (si: boolean) => { caido = si; } };
}

async function escenario(url: string): Promise<void> {
  sembrarPersonal(url);
  const personal = await contextoDePersonal("personal-runway@ejemplo.mx");
  const alfa = await darDeAltaEmpresa(personal, { rfc: "TCM010101AB1", razonSocial: "Alfa Runway", codigoPostal: "06600", regimen: "601", usoCfdi: "G03" }, { demostracion: false });
  const beta = await darDeAltaEmpresa(personal, { rfc: "CABL840215RF4", razonSocial: "Beta Sin Saldo", codigoPostal: "44100", regimen: "612", usoCfdi: "G03" }, { demostracion: false });
  const gamma = await darDeAltaEmpresa(personal, { rfc: "GAM010101AB1", razonSocial: "Gamma Planes", codigoPostal: "64000", regimen: "601", usoCfdi: "G03" }, { demostracion: false });
  const demo = await darDeAltaEmpresa(personal, { rfc: "MOT970101AA1", razonSocial: "Demo Runway", codigoPostal: "64000", regimen: "601", usoCfdi: "G03" }, { demostracion: true });
  const [admin] = await administrador(url, personal, alfa, "admin-alfa-runway@ejemplo.mx");
  const [adminBeta] = await administrador(url, personal, beta, "admin-beta-runway@ejemplo.mx");
  const [adminGamma, sesionGamma] = await administrador(url, personal, gamma, "admin-gamma-runway@ejemplo.mx");
  const [adminDemo] = await administrador(url, personal, demo, "admin-demo-runway@ejemplo.mx");
  const centro = await nombrarCentro(admin, { nombre: "Operación" }, { ahora: HOY });
  const contador = await persona(url, admin, centro.id, "Contadora Runway", "contadora-runway@ejemplo.mx", ["contador"]);
  const finanzas = await persona(url, admin, centro.id, "Finanzas Runway", "finanzas-runway@ejemplo.mx", ["tarjetahabiente", "finanzas"]);
  const codigo = (esperado: string) => (e: unknown) => e instanceof ErrorDeDominio && e.codigo === esperado;
  const { enviados, enviador, caer } = buzon();
  const tarea = (ahora = HOY) => correrAlertasDeCaja({ ahora, auditar, enviador, urlPublica: () => URL, registrar: () => {}, ritmoMs: 0 });
  const D = { ahora: HOY };

  // 1. El mínimo de meses: 3 por defecto; lo cambian administración y finanzas; el rechazo dice su campo.
  assert.equal((await leerVistaRunway(admin, D)).mesesElegidos, false);
  assert.equal((await leerVistaRunway(admin, D)).mesesMinimos, 3);
  await assert.rejects(() => configurarMesesMinimos(contador, { meses: "4" }, D), codigo("sin_permiso"));
  for (const malo of ["0", "13", "2.5", "abc", "", undefined]) {
    await assert.rejects(
      () => configurarMesesMinimos(admin, { meses: malo }, D),
      (e: unknown) => e instanceof ErrorDeCaptura && e.errores[0]?.campo === "meses",
      String(malo),
    );
  }
  assert.equal(await configurarMesesMinimos(finanzas, { meses: "6" }, D), 6);
  assert.equal(await configurarMesesMinimos(admin, { meses: "4" }, D), 4);
  assert.equal(contar(url, `select count(*) from audit_log where accion = 'configurar_runway' and company_id = '${alfa.id}'`), 2);
  assert.equal(contar(url, `select count(*) from audit_log where accion = 'configurar_runway' and company_id = '${alfa.id}' and cambio = '{"meses_anterior": 6, "meses_nuevo": 4}'::jsonb`), 1);

  // 2. Saldo de $300,000 y renta de $100,000 cada día 20: Inicio no ve faltante (la semana 13 cierra en 0), el runway sí se acorta.
  await declararSaldo(admin, { saldo: "300000.00", alDia: "2026-11-09", altaId: randomUUID() }, D);
  await registrarObligacion(admin, { concepto: "Renta", monto: "100000.00", frecuencia: "mensual", proximaFecha: "2026-11-20", altaId: randomUUID() }, D);
  const vista = await leerVistaRunway(admin, D);
  assert.equal(vista.runway.conservador.tipo, "agota");
  if (vista.runway.conservador.tipo === "agota") {
    assert.equal(vista.runway.conservador.hasta, "2027-02-14");
    assert.equal(vista.runway.conservador.meses, 3.1);
  }
  assert.equal(vista.estado, "runway_bajo");
  const inicio = await leerFlujoInicio(admin, {}, D);
  assert.equal(inicio.proyeccion.alcance.tipo, "holgado");
  assert.deepEqual(inicio.runway.conservador, vista.runway.conservador);

  // 3. Primera corrida: foto de la semana y un aviso de runway, a administración y finanzas (contaduría no lo pidió).
  const r1 = await tarea();
  assert.equal(r1.empresas, 1, "solo Alfa tiene saldo declarado");
  assert.equal(r1.avisos, 1);
  assert.equal(r1.fotos, 1);
  assert.deepEqual(enviados.map((m) => m.para).sort(), ["admin-alfa-runway@ejemplo.mx", "finanzas-runway@ejemplo.mx"]);
  for (const m of enviados) {
    assert.match(m.idempotencia, /^alerta-caja\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
    assert.match(m.asunto, /runway debajo de 4 meses · Alfa Runway/);
    assert.match(m.texto, /3\.1 meses \(alcanza hasta el 14 de febrero de 2027\), menos que tu mínimo de 4 meses/);
  }
  assert.deepEqual(estado(url, alfa.id), { bajo_colchon: false, runway_bajo: true });
  assert.equal(contar(url, `select count(*) from cash_alerts where company_id = '${alfa.id}' and estado = 'enviado' and destinatarios = 2`), 1);
  assert.equal(contar(url, `select count(*) from cash_alert_deliveries where company_id = '${alfa.id}'`), 2);

  // 4. La tarea otra vez y dos a la vez: nada nuevo (ni aviso, ni correo, ni foto).
  const r2 = await tarea();
  const [r3, r4] = await Promise.all([tarea(), tarea()]);
  for (const r of [r2, r3, r4]) {
    assert.equal(r.avisos, 0);
    assert.equal(r.fotos, 0);
    assert.equal(r.correos.enviados, 0);
  }
  assert.equal(enviados.length, 2);
  assert.equal(contar(url, `select count(*) from cash_runway_snapshots where company_id = '${alfa.id}'`), 1);

  // 5. Un colchón de $50,000: la semana del 18 ene cierra en $0, debajo del colchón. Aviso de colchón; el runway sigue encendido y no se repite.
  await configurarColchon(admin, { colchon: "50000.00" }, D);
  const r5 = await tarea();
  assert.equal(r5.avisos, 1);
  assert.equal(enviados.length, 4);
  assert.match(enviados.at(-1)!.asunto, /la caja proyectada baja de tu colchón/);
  assert.match(enviados.at(-1)!.texto, /debajo de tu colchón de \$50,000\.00/);
  assert.doesNotMatch(enviados.at(-1)!.texto, /menos que tu mínimo/);
  assert.deepEqual(estado(url, alfa.id), { bajo_colchon: true, runway_bajo: true });
  assert.equal((await tarea()).avisos, 0);

  // 6. Sube: un cobro esperado de $500,000 apaga las dos sin correo.
  const cobro = await registrarCobro(admin, { clienteNombre: "Cliente Grande", concepto: "Proyecto", monto: "500000.00", fechaProbable: "2026-11-25", altaId: randomUUID() }, D);
  const r6 = await tarea();
  assert.equal(r6.avisos, 0);
  assert.equal(enviados.length, 4);
  assert.deepEqual(estado(url, alfa.id), { bajo_colchon: false, runway_bajo: false });

  // 7. Vuelve a cruzar: cancelar el cobro enciende las dos y sale un solo correo con las dos.
  await cancelarCobro(admin, { id: cobro.id, motivo: "El cliente canceló el proyecto" }, D);
  const r7 = await tarea();
  assert.equal(r7.avisos, 1);
  assert.equal(enviados.length, 6);
  assert.match(enviados.at(-1)!.asunto, /debajo del colchón y runway corto/);
  assert.equal(contar(url, `select count(*) from cash_alerts where company_id = '${alfa.id}'`), 3);

  // 8. El proveedor de correo se cae: el aviso queda fallido y la siguiente corrida lo manda (intento 2), sin repetir a nadie.
  await registrarCobro(admin, { clienteNombre: "Cliente Dos", concepto: "Anticipo", monto: "500000.00", fechaProbable: "2026-11-26", altaId: randomUUID() }, D);
  await tarea();
  const segundo = consultarJson<{ id: string }[]>(url, `select json_agg(json_build_object('id', id)) from expected_collections where cliente_nombre = 'Cliente Dos'`)[0]!.id;
  await cancelarCobro(admin, { id: segundo, motivo: "Se pospuso sin fecha" }, D);
  caer(true);
  const r8 = await tarea();
  assert.equal(r8.avisos, 1);
  assert.equal(r8.correos.fallidos, 1);
  assert.equal(enviados.length, 6);
  caer(false);
  const r9 = await tarea();
  assert.equal(r9.avisos, 0);
  assert.equal(r9.correos.enviados, 1);
  assert.equal(enviados.length, 8);
  assert.equal(contar(url, `select count(*) from cash_alerts where company_id = '${alfa.id}' and estado = 'enviado' and intentos = 2`), 1);
  assert.equal((await tarea()).correos.enviados, 0);

  // 9. Otro fallido cuya condición se resuelve antes del reintento: queda descartado, sin correo.
  const tres = await registrarCobro(admin, { clienteNombre: "Cliente Tres", concepto: "Anticipo", monto: "500000.00", fechaProbable: "2026-11-27", altaId: randomUUID() }, D);
  await tarea();
  await cancelarCobro(admin, { id: tres.id, motivo: "Se pospuso sin fecha" }, D);
  caer(true);
  await tarea();
  caer(false);
  await registrarCobro(admin, { clienteNombre: "Cliente Cuatro", concepto: "Anticipo", monto: "500000.00", fechaProbable: "2026-11-28", altaId: randomUUID() }, D);
  const r10 = await tarea();
  assert.equal(r10.correos.descartados, 1);
  assert.equal(r10.correos.enviados, 0);
  assert.equal(enviados.length, 8);
  assert.equal(contar(url, `select count(*) from cash_alerts where company_id = '${alfa.id}' and estado = 'descartado'`), 1);

  // 10. Un apartado que se quedó a medias (más de 30 minutos en «enviando») se cierra como fallido y vuelve a salir si sigue encendido.
  const cinco = consultarJson<{ id: string }[]>(url, `select json_agg(json_build_object('id', id)) from expected_collections where cliente_nombre = 'Cliente Cuatro'`)[0]!.id;
  await cancelarCobro(admin, { id: cinco, motivo: "Se pospuso sin fecha" }, D);
  caer(true);
  await tarea();
  caer(false);
  const atorado = consultarJson<{ id: string }[]>(url, `select json_agg(json_build_object('id', id)) from cash_alerts where company_id = '${alfa.id}' and estado = 'fallido'`)[0]!.id;
  // Como si una corrida lo hubiera apartado hace una hora y se hubiera caído (el dueño de la base puede fijar la fecha).
  ejecutar(url, `
    set session_replication_role = replica;
    update cash_alerts set estado = 'enviando', terminado_en = null, intentado_en = now() - interval '1 hour' where id = '${atorado}';
  `);
  const r11 = await tarea();
  assert.equal(r11.correos.enviados, 1);
  assert.equal(contar(url, `select count(*) from cash_alerts where id = '${atorado}' and estado = 'enviado'`), 1);
  assert.equal(contar(url, `select count(*) from audit_log where accion = 'alerta_caja' and identificador = '${atorado}' and cambio->>'codigo' = 'interrumpido'`), 1);

  // 11. Otra semana, otra foto; la misma semana no se reescribe.
  await tarea(LUNES);
  await tarea(LUNES);
  assert.equal(contar(url, `select count(*) from cash_runway_snapshots where company_id = '${alfa.id}'`), 2);
  const fotos = (await leerVistaRunway(admin, { ahora: LUNES })).fotos;
  assert.deepEqual(fotos.map((f) => f.semana), ["2026-11-09", "2026-11-16"]);

  // 12. Planes de cobranza: el fijo suma al esperado, nunca al conservador; un variable sin historial se lista.
  await declararSaldo(adminGamma, { saldo: "100000.00", alDia: "2026-11-09", altaId: randomUUID() }, D);
  await registrarObligacion(adminGamma, { concepto: "Renta", monto: "60000.00", frecuencia: "mensual", proximaFecha: "2026-11-20", altaId: randomUUID() }, D);
  const cobranzaDeps: DependenciasCobranza = { ahora: HOY, urlPublica: () => URL, enviador, fintoc: null, registrar: () => {} };
  await configurarCobranza(adminGamma, {
    clabe: CLABE_EMPRESA, beneficiario: "Gamma Planes SA de CV", correoContacto: "cobranza-gamma@ejemplo.mx",
    emitirDiasAntes: "5", antesDias: "3", avisoElDia: "si", despuesCadaDias: "7", despuesTope: "3", envioAutomatico: "si",
  }, sesionGamma, cobranzaDeps);
  const alta = { rfc: "", correos: "cliente-gamma@ejemplo.mx", concepto: "Servicio", periodicidad: "mensual", fin: "" };
  await darDeAltaCliente(adminGamma, { ...alta, nombre: "Fijo SA", tipo: "fijo", monto: "40000.00", primerVencimiento: "2026-12-15", altaId: randomUUID() }, cobranzaDeps);
  await darDeAltaCliente(adminGamma, { ...alta, nombre: "Variable SA", tipo: "variable", monto: "", primerVencimiento: "2026-12-20", altaId: randomUUID() }, cobranzaDeps);
  const gammaVista = await leerVistaRunway(adminGamma, D);
  assert.deepEqual(gammaVista.runway.planes.incluidos.map((p) => [p.cliente, p.tipo, p.montoCentavos]), [["Fijo SA", "fijo", 4_000_000]]);
  assert.deepEqual(gammaVista.runway.planes.sinHistorial.map((p) => p.cliente), ["Variable SA"]);
  const rango = (a: typeof gammaVista.runway.conservador) => (a.tipo === "agota" ? a.semanas : a.tipo === "holgado" ? 99 : -1);
  assert.ok(rango(gammaVista.runway.esperado) > rango(gammaVista.runway.conservador));
  assert.ok(gammaVista.runway.resumen.some((l) => l.tipo === "plan_fijo" && l.estimado));

  // 13. Demostración: el aviso queda simulado y no sale correo; la tendencia de ejemplo solo ahí.
  await declararSaldo(adminDemo, { saldo: "1000.00", alDia: "2026-11-09", altaId: randomUUID() }, D);
  await registrarObligacion(adminDemo, { concepto: "Renta", monto: "50000.00", frecuencia: "mensual", proximaFecha: "2026-11-20", altaId: randomUUID() }, D);
  const antesDemo = enviados.length;
  const r13 = await tarea();
  assert.equal(r13.correos.simulados, 1);
  assert.deepEqual(enviados.slice(antesDemo).map((m) => m.para), ["admin-gamma-runway@ejemplo.mx"], "Gamma (real) sí recibe su aviso");
  assert.equal(enviados.filter((m) => m.para === "admin-demo-runway@ejemplo.mx").length, 0, "ningún correo de la empresa de demostración sale");
  assert.equal(contar(url, `select count(*) from cash_alerts where company_id = '${demo.id}' and estado = 'simulado'`), 1);
  assert.equal((await leerVistaRunway(adminDemo, D)).fotosDeEjemplo, true);
  assert.equal((await leerVistaRunway(adminGamma, D)).fotosDeEjemplo, false);
  assert.equal((await leerVistaRunway(adminGamma, D)).fotos.length, 1, "una empresa real solo ve sus fotos");

  // 14. Sin saldo: sin runway, sin estado, sin fotos.
  const betaVista = await leerVistaRunway(adminBeta, D);
  assert.equal(betaVista.estado, "sin_saldo");
  assert.equal(contar(url, `select count(*) from cash_alert_states where company_id = '${beta.id}'`), 0);

  // 15. Permisos y RLS: el contador ve sin editar; otra empresa no ve nada; nadie con sesión escribe lo de la tarea; nada se borra.
  const vistaContador = await leerVistaRunway(contador, D);
  assert.equal(vistaContador.puedeEditar, false);
  assert.equal(vistaContador.ultimoAviso !== null, true);
  const ajenas = await conContexto(baseCliente(adminBeta), async (consulta) =>
    (await consulta.query("select (select count(*) from cash_alerts)::int as a, (select count(*) from cash_runway_snapshots)::int as f, (select count(*) from cash_alert_states)::int as e")).rows[0]);
  assert.deepEqual(ajenas, { a: 0, f: 0, e: 0 });
  // La base rechaza (trigger y GRANT); la aplicación lo ve como base no disponible y nada cambia.
  const estadoAntes = estado(url, alfa.id);
  const fotosAntes = contar(url, `select count(*) from cash_runway_snapshots`);
  await assert.rejects(() =>
    conContexto(baseCliente(admin), (consulta) => consulta.query(`insert into cash_alert_states (company_id, bajo_colchon, runway_bajo) values ($1, false, false) on conflict (company_id) do update set runway_bajo = false, bajo_colchon = false`, [alfa.id])));
  await assert.rejects(() => conContexto(baseCliente(admin), (consulta) => consulta.query("delete from cash_runway_snapshots")));
  await assert.rejects(() => conContexto(baseCliente(admin), (consulta) => consulta.query("delete from cash_runway_settings")));
  await assert.rejects(() => conContexto(baseCliente(admin), (consulta) => consulta.query("update cash_alerts set estado = 'descartado'")));
  assert.deepEqual(estado(url, alfa.id), estadoAntes);
  assert.equal(contar(url, `select count(*) from cash_runway_snapshots`), fotosAntes);
  assert.equal(contar(url, `select count(*) from cash_runway_settings where company_id = '${alfa.id}'`), 1);
  // El mismo rechazo, leído en la base: solo el sistema escribe el estado.
  assert.match(
    ejecutarComo(url, alfa.id, admin.persona.id, `insert into cash_alert_states (company_id, bajo_colchon, runway_bajo) values ('${alfa.id}', false, false)`),
    /alerta_solo_del_sistema/,
  );
  // Cada escritura de la tarea dejó su evento.
  for (const [tabla, accion] of [["cash_alert_deliveries", "alerta_caja_entregada"], ["cash_runway_snapshots", "foto_runway"]] as const) {
    assert.equal(
      contar(url, `select count(*) from ${tabla} t where not exists (select 1 from audit_log l where l.accion = '${accion}' and l.identificador = t.id)`),
      0,
      tabla,
    );
  }
}

/** Corre una sentencia como plataforma_cliente con la empresa y la persona en el contexto; devuelve el error de la base. */
function ejecutarComo(url: string, empresaId: string, personaId: string, sql: string): string {
  try {
    ejecutar(url, `begin; set local role plataforma_cliente; select set_config('app.company_id', '${empresaId}', true), set_config('app.user_id', '${personaId}', true); ${sql}; commit;`);
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function estado(url: string, empresaId: string): { bajo_colchon: boolean; runway_bajo: boolean } | null {
  return consultarJson<{ bajo_colchon: boolean; runway_bajo: boolean }[] | null>(
    url,
    `select json_agg(json_build_object('bajo_colchon', bajo_colchon, 'runway_bajo', runway_bajo)) from cash_alert_states where company_id = '${empresaId}'`,
  )?.[0] ?? null;
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
      values ('99999999-9999-4999-8999-999999999997', 'Personal', 'personal-runway@ejemplo.mx', '$2b$12$${"a".repeat(53)}');
    insert into platform_staff (operator_id, user_id, estado)
      values ((select id from operators order by alta_en limit 1), '99999999-9999-4999-8999-999999999997', 'activo');
    insert into platform_staff_roles (operator_id, user_id, rol)
      values ((select id from operators order by alta_en limit 1), '99999999-9999-4999-8999-999999999997', 'administracion_plataforma');
  `);
}
