import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { cerrarConexion } from "../../src/nucleo/db.ts";
import { configurarNomina, leerLoteNomina, leerNomina, prepararNomina } from "../../src/server/nomina/servicio.ts";
import { leerPendientesInicio } from "../../src/server/inicio/servicio.ts";
import { darDeAltaEmpresa } from "../../src/server/company/servicio.ts";
import { aceptarInvitacion } from "../../src/server/invitaciones/servicio.ts";
import { hoyEnMexico } from "../../src/dominio/personas.ts";
import type { ContextoDeTenant } from "../../src/nucleo/contexto.ts";
import { ErrorDeDominio } from "../../src/nucleo/error-de-dominio.ts";
import {
  cambiarClabeNomina,
  cancelarBaja,
  darDeAltaPersona,
  editarArea,
  editarPersona,
  leerDetallePersona,
  leerMaestro,
  nombrarCentro,
  registrarBaja,
} from "../../src/server/personas/servicio.ts";
import { contextoDePersonal, invitarAdministrador } from "../../src/server/plataforma/servicio.ts";
import { leerSesion } from "../../src/server/session/servicio.ts";
import type { Sesion } from "../../src/server/session/tipos.ts";
import { resolverContexto } from "../../src/server/tenencia/resolver.ts";
import {
  aplicarArchivo,
  conBaseDesechable,
  consultarJson,
  ejecutar,
  exigirBaseDesechable,
  urlDeAplicacion,
} from "../aislamiento/postgres.ts";

const CLABE = "002180701150123452";
const CLAVE = "clave-segura-12";
const AHORA = new Date("2026-11-05T18:00:00.000Z");
const URL_ADMIN = process.env.AISLAMIENTO_DATABASE_URL?.trim() ?? "";

test("colaboradores, nómina, tarjetas y lotes conservan tenant, idempotencia y snapshot", { skip: URL_ADMIN.length === 0 }, async () => {
  const urlAdmin = exigirBaseDesechable();
  const previo = process.env.DATABASE_URL;
  await conBaseDesechable(urlAdmin, async (url) => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");
    for (const archivo of readdirSync(dir).sort()) {
      if (archivo.endsWith(".sql")) aplicarArchivo(url, join(dir, archivo));
    }
    await cerrarConexion();
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

async function escenario(url: string): Promise<void> {
  sembrarPersonal(url);
  const personal = await contextoDePersonal("personal-colaboradores@ejemplo.mx");
  const empresa = await darDeAltaEmpresa(personal, {
    rfc: "TCM010101AB1",
    razonSocial: "Escuela Colaboradores",
    codigoPostal: "06600",
    regimen: "601",
    usoCfdi: "G03",
  }, { demostracion: true });
  const invitacion = await invitarAdministrador(personal, {
    companyId: empresa.id,
    razonSocial: empresa.razonSocial,
    nombre: "Admin Colaboradores",
    correo: "admin-colaboradores@ejemplo.mx",
  });
  await aceptarInvitacion({ token: invitacion.emitida.token, contrasena: CLAVE, confirmacion: CLAVE });
  const sesion = await sesionPara(url, invitacion.emitida.userId);
  const admin = (await resolverContexto({ sesion, empresaPedida: empresa.id, peticionId: null, superficie: "cliente" })).ctx;
  const area = await nombrarCentro(admin, {
    nombre: "Tesorería",
    presupuesto: "10000.00",
    esTesoreria: true,
  }, { ahora: () => AHORA });

  const llave = randomUUID();
  const entradaOperativo = {
    nombre: "Operativo Tarjeta",
    alta: "2026-11-01",
    baja: "",
    centroId: area.id,
    jefeId: "",
    presupuesto: "500.00",
    altaLlave: llave,
    neto: "100.00",
    frecuencia: "quincenal",
    primerPago: "2026-11-15",
    destino: "tarjeta",
    clabe: "",
    acceso: "no",
    correo: "",
    rol: "",
  };
  const operativo = await darDeAltaPersona(admin, entradaOperativo, { ahora: () => AHORA });
  const reintento = await darDeAltaPersona(admin, entradaOperativo, { ahora: () => AHORA });
  assert.equal(reintento.id, operativo.id);
  assert.equal(reintento.repetida, true);

  let tokenTesoreria = "";
  const tesoreria = await darDeAltaPersona(admin, {
    nombre: "Tesorería Acceso",
    alta: "2026-11-01",
    baja: "",
    centroId: area.id,
    jefeId: "",
    presupuesto: "1000.00",
    altaLlave: randomUUID(),
    neto: "200.00",
    frecuencia: "mensual",
    primerPago: "2026-11-15",
    destino: "clabe",
    clabe: CLABE,
    acceso: "nueva",
    correo: "tesoreria-colaboradores@ejemplo.mx",
    rol: ["administrador", "liberador"],
  }, {
    ahora: () => AHORA,
    entregar: async (emitida) => {
      tokenTesoreria = emitida.token;
      return { entregada: false, codigo: "correo_no_configurado" };
    },
  });
  assert.notEqual(tokenTesoreria, "");

  const detalleOperativo = await leerDetallePersona(admin, operativo.id);
  assert.equal(detalleOperativo?.persona.clabe, null);
  assert.equal(detalleOperativo?.persona.tarjetaPendiente, true);
  assert.equal(detalleOperativo?.persona.membresia, null);
  assert.equal(detalleOperativo?.persona.nomina?.netoCentavos, 10000);
  const detalleTesoreria = await leerDetallePersona(admin, tesoreria.id);
  assert.equal(detalleTesoreria?.persona.membresia, "invitada");
  assert.equal(detalleTesoreria?.persona.tarjetaPendiente, false);
  const directorio = await leerMaestro(admin);
  assert.equal(directorio.resumen.vigentes, 2);
  assert.equal(directorio.areas[0]?.presupuestosIndividualesCentavos, 150000);
  assert.equal(directorio.areas[0]?.nominaMensualCentavos, 40000);

  await configurarNomina(admin, {
    personaId: tesoreria.id,
    neto: "250.00",
    frecuencia: "mensual",
    primerPago: "2026-11-15",
    destino: "clabe",
  }, { ahora: () => new Date("2026-11-15T18:00:00.000Z") });
  const antesDePreparar = await leerDetallePersona(admin, tesoreria.id);
  assert.equal(antesDePreparar?.persona.nomina?.netoCentavos, 25000);
  assert.equal(antesDePreparar?.persona.nomina?.activa, true);

  // Pendientes avisa la fecha vencida sin lote (la misma que prepararNomina) y la retira al prepararla.
  const nominaEnPendientes = async () =>
    (await leerPendientesInicio(admin, { ahora: () => new Date("2026-11-15T18:00:00.000Z") }))
      .find((pendiente) => pendiente.id === "nomina-por-preparar")?.titulo ?? null;
  assert.equal(await nominaEnPendientes(), "Prepara el lote de nómina del 15 de noviembre");

  const preparada = await prepararNomina(admin, "2026-11-15", {
    ahora: () => new Date("2026-11-15T18:00:00.000Z"),
  });
  assert.equal(await nominaEnPendientes(), null);
  const repetida = await prepararNomina(admin, "2026-11-15", {
    ahora: () => new Date("2026-11-15T18:00:00.000Z"),
  });
  assert.equal(repetida.id, preparada.id);
  assert.equal(repetida.repetida, true);
  const lote = await leerLoteNomina(admin, preparada.id);
  assert.equal(lote?.lote.totalCentavos, 35000);
  assert.equal(lote?.lote.destinosPendientes, 1);
  assert.equal(lote?.items.length, 2);
  assert.equal(lote?.items.find((item) => item.personaId === operativo.id)?.clabe, null);
  assert.equal(lote?.items.find((item) => item.personaId === tesoreria.id)?.clabe, CLABE);

  await configurarNomina(admin, {
    personaId: tesoreria.id,
    neto: "275.00",
    frecuencia: "mensual",
    primerPago: "2026-12-15",
    destino: "clabe",
  }, { ahora: () => new Date("2026-11-15T18:00:00.000Z") });
  const congelado = await leerLoteNomina(admin, preparada.id);
  assert.equal(congelado?.items.find((item) => item.personaId === tesoreria.id)?.netoCentavos, 25000);
  assert.equal(congelado?.lote.totalCentavos, 35000);
  assert.throws(() => ejecutar(url, `update payroll_batches set total_centavos = 1 where id = '${preparada.id}'`), /lote_de_nomina_inmutable/);
  await assert.rejects(
    () => darDeAltaPersona(admin, {
      ...entradaOperativo,
      nombre: "Tarde Para Esa Fecha",
      altaLlave: randomUUID(),
    }, { ahora: () => new Date("2026-11-15T18:00:00.000Z") }),
    (error: unknown) => error instanceof Error && "codigo" in error && error.codigo === "fecha_ya_preparada",
  );
  const despuesDeTarde = await leerMaestro(admin);
  assert.equal(despuesDeTarde.personas.some((persona) => persona.nombre === "Tarde Para Esa Fecha"), false);

  const aceptada = await aceptarInvitacion({ token: tokenTesoreria, contrasena: CLAVE, confirmacion: CLAVE });
  const sesionTesoreria = await sesionPara(url, aceptada.userId);
  await registrarBaja(admin, { personaId: operativo.id, baja: "2026-11-05" }, { ahora: () => AHORA });
  await registrarBaja(admin, { personaId: tesoreria.id, baja: "2026-11-05" }, { ahora: () => AHORA });
  const despues = await leerDetallePersona(admin, operativo.id);
  assert.equal(despues?.persona.nomina?.activa, false);
  assert.equal(despues?.persona.tarjetaPendiente, false);
  const accesoCerrado = await resolverContexto({ sesion: sesionTesoreria, empresaPedida: empresa.id, peticionId: null, superficie: "cliente" });
  assert.equal(accesoCerrado.ctx.empresa, null);
  const sesiones = consultarJson<Array<{ n: number }>>(url, `select json_agg(fila) from (select count(*)::int as n from sessions where user_id = '${aceptada.userId}') fila`);
  assert.equal(sesiones[0]?.n, 0);

  const sinTenant = consultarJson<Array<{ n: number }>>(url, `
    begin;
    set local role plataforma_cliente;
    select set_config('app.company_id', '${randomUUID()}', true);
    select json_agg(fila) from (select count(*)::int as n from payroll_batches) fila;
  `);
  assert.equal(sinTenant[0]?.n, 0);
  const forzada = consultarJson<Array<{ n: number }>>(url, `
    select json_agg(fila) from (
      select count(*)::int as n from pg_class
      where relname in ('employee_payroll_profiles', 'employee_card_requests', 'payroll_batches', 'payroll_batch_items')
        and relrowsecurity and relforcerowsecurity
    ) fila;
  `);
  assert.equal(forzada[0]?.n, 4);
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
      values ('99999999-9999-4999-8999-999999999999', 'Personal', 'personal-colaboradores@ejemplo.mx', '$2b$12$${"a".repeat(53)}');
    insert into platform_staff (operator_id, user_id, estado)
      values ((select id from operators order by alta_en limit 1), '99999999-9999-4999-8999-999999999999', 'activo');
    insert into platform_staff_roles (operator_id, user_id, rol)
      values ((select id from operators order by alta_en limit 1), '99999999-9999-4999-8999-999999999999', 'administracion_plataforma');
  `);
}

test("blindajes: baja que vence, CLABE de nómina, permisos, empresas ajenas y calendario", { skip: URL_ADMIN.length === 0 }, async () => {
  const urlAdmin = exigirBaseDesechable();
  const previo = process.env.DATABASE_URL;
  await conBaseDesechable(urlAdmin, async (url) => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");
    for (const archivo of readdirSync(dir).sort()) {
      if (archivo.endsWith(".sql")) aplicarArchivo(url, join(dir, archivo));
    }
    await cerrarConexion();
    process.env.DATABASE_URL = urlDeAplicacion(url);
    try {
      await blindajes(url);
    } finally {
      await cerrarConexion();
      if (previo === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previo;
    }
  });
});

const CLABE_DOS = "012180001234567899";
const HOY_REAL = () => hoyEnMexico(new Date());

function codigo(esperado: string) {
  return (error: unknown) => error instanceof ErrorDeDominio && error.codigo === esperado;
}

function sumarDias(fecha: string, dias: number): string {
  const [anio, mes, dia] = fecha.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(anio, mes - 1, dia + dias)).toISOString().slice(0, 10);
}

function eventos(url: string, accion: string, identificador: string): Array<{ actor_tipo: string; cambio: Record<string, unknown> | null }> {
  return consultarJson(url, `select coalesce(jsonb_agg(to_jsonb(fila) - 'ocurrido_en' order by fila.ocurrido_en), '[]'::jsonb) from (
    select actor_tipo, cambio, ocurrido_en from audit_log where accion = '${accion}' and identificador = '${identificador}'
  ) fila`);
}

async function empresaCon(personal: ContextoDeTenant, url: string, rfc: string, razon: string, correo: string) {
  const empresa = await darDeAltaEmpresa(personal, {
    rfc,
    razonSocial: razon,
    codigoPostal: "06600",
    regimen: "601",
    usoCfdi: "G03",
  }, { demostracion: true });
  const invitacion = await invitarAdministrador(personal, { companyId: empresa.id, razonSocial: razon, nombre: `Admin ${razon}`, correo });
  await aceptarInvitacion({ token: invitacion.emitida.token, contrasena: CLAVE, confirmacion: CLAVE });
  const sesion = await sesionPara(url, invitacion.emitida.userId);
  const ctx = (await resolverContexto({ sesion, empresaPedida: empresa.id, peticionId: null, superficie: "cliente" })).ctx;
  return { empresa, sesion, ctx, userId: invitacion.emitida.userId };
}

async function miembro(
  url: string,
  admin: ContextoDeTenant,
  empresaId: string,
  entrada: Record<string, unknown>,
): Promise<{ id: string; userId: string; sesion: Sesion; ctx: ContextoDeTenant }> {
  let token = "";
  const alta = await darDeAltaPersona(admin, { altaLlave: randomUUID(), alta: "2026-11-01", baja: "", jefeId: "", ...entrada }, {
    entregar: async (emitida) => {
      token = emitida.token;
      return { entregada: false, codigo: "correo_no_configurado" };
    },
  });
  const aceptada = await aceptarInvitacion({ token, contrasena: CLAVE, confirmacion: CLAVE });
  const sesion = await sesionPara(url, aceptada.userId);
  const ctx = (await resolverContexto({ sesion, empresaPedida: empresaId, peticionId: null, superficie: "cliente" })).ctx;
  return { id: alta.id, userId: aceptada.userId, sesion, ctx };
}

async function blindajes(url: string): Promise<void> {
  sembrarPersonal(url);
  const personal = await contextoDePersonal("personal-colaboradores@ejemplo.mx");
  const a = await empresaCon(personal, url, "AAA010101AAA", "Empresa Uno", "admin-uno@ejemplo.mx");
  const b = await empresaCon(personal, url, "BBB010101BBA", "Empresa Dos", "admin-dos@ejemplo.mx");
  const hoy = HOY_REAL();
  const area = await nombrarCentro(a.ctx, { nombre: "Operación", presupuesto: "50000.00" });
  const areaB = await nombrarCentro(b.ctx, { nombre: "Ajena" });

  // H8: editar el área deja nombre, presupuesto y tesorería anteriores y nuevos.
  await editarArea(a.ctx, { centroId: area.id, nombre: "Operación Norte", presupuesto: "60000.00", esTesoreria: true });
  const area8 = eventos(url, "editar_area", area.id)[0]?.cambio;
  assert.equal(area8?.nombre_anterior, "Operación");
  assert.equal(area8?.nombre_nuevo, "Operación Norte");
  assert.equal(area8?.tesoreria_anterior, false);
  assert.equal(area8?.tesoreria_nueva, true);

  const primerPago = sumarDias(hoy, 3);
  const liberadora = await miembro(url, a.ctx, a.empresa.id, {
    nombre: "Liberadora Uno", centroId: area.id, presupuesto: "100.00", destino: "clabe", clabe: CLABE,
    neto: "1000.00", frecuencia: "mensual", primerPago, acceso: "nueva", correo: "liberadora@ejemplo.mx", rol: ["liberador"],
  });
  // H17: una persona «solo acceso» no exige neto, destino ni CLABE.
  const contadora = await miembro(url, a.ctx, a.empresa.id, {
    nomina: "no", nombre: "Contadora Uno", centroId: area.id, acceso: "nueva", correo: "contadora@ejemplo.mx", rol: ["contador"],
  });
  const soloAcceso = await leerDetallePersona(a.ctx, contadora.id);
  assert.equal(soloAcceso?.persona.nomina, null);
  assert.equal(soloAcceso?.persona.clabeFinal, null);
  const ajena = await darDeAltaPersona(b.ctx, {
    nombre: "Persona Ajena", alta: "2026-11-01", baja: "", centroId: areaB.id, jefeId: "", altaLlave: randomUUID(),
    destino: "clabe", clabe: CLABE, neto: "10.00", frecuencia: "mensual", primerPago, acceso: "no",
  });

  // H12: contador y liberador no editan, no configuran nómina ni cambian CLABE.
  for (const ctx of [contadora.ctx, liberadora.ctx]) {
    await assert.rejects(() => editarPersona(ctx, { personaId: liberadora.id, nombre: "X", alta: "2026-11-01", centroId: area.id }), codigo("sin_permiso"));
    await assert.rejects(() => configurarNomina(ctx, { personaId: liberadora.id, neto: "1.00", frecuencia: "mensual", primerPago, destino: "clabe" }), codigo("sin_permiso"));
    await assert.rejects(() => cambiarClabeNomina(ctx, null, { personaId: liberadora.id, clabe: CLABE_DOS }), codigo("sin_permiso"));
    await assert.rejects(() => registrarBaja(ctx, { personaId: liberadora.id, baja: hoy }), codigo("sin_permiso"));
  }
  await assert.rejects(() => prepararNomina(contadora.ctx), codigo("sin_permiso"));

  // H12: un id de otra empresa no se encuentra, ni para leer ni para escribir.
  await assert.rejects(() => configurarNomina(a.ctx, { personaId: ajena.id, neto: "1.00", frecuencia: "mensual", primerPago, destino: "clabe" }), codigo("persona_ausente"));
  await assert.rejects(() => cambiarClabeNomina(a.ctx, a.sesion, { personaId: ajena.id, clabe: CLABE_DOS }), codigo("persona_ausente"));
  await assert.rejects(() => registrarBaja(a.ctx, { personaId: ajena.id, baja: hoy }), codigo("persona_ausente"));
  assert.equal(await leerDetallePersona(a.ctx, ajena.id), null);

  // H11: el contador ve la terminación y totales; el liberador ve neto, no la CLABE completa.
  const vistaContadora = await leerDetallePersona(contadora.ctx, liberadora.id);
  assert.equal(vistaContadora?.persona.clabe, null);
  assert.equal(vistaContadora?.persona.clabeFinal, CLABE.slice(-4));
  assert.equal(vistaContadora?.persona.nomina?.netoCentavos, null);
  assert.deepEqual(vistaContadora?.historialClabe, []);
  const vistaLiberadora = await leerDetallePersona(liberadora.ctx, liberadora.id);
  assert.equal(vistaLiberadora?.persona.clabe, null);
  assert.equal(vistaLiberadora?.persona.nomina?.netoCentavos, 100000);
  const vistaAdmin = await leerDetallePersona(a.ctx, liberadora.id);
  assert.equal(vistaAdmin?.persona.clabe, CLABE);
  assert.equal(vistaAdmin?.historialClabe.length, 1);
  const directorioContadora = await leerMaestro(contadora.ctx);
  assert.equal(JSON.stringify(directorioContadora).includes(CLABE), false);

  // H2: cambiar la CLABE exige segundo factor reciente en la misma sesión.
  const vieja = { ...a.sesion, segundoFactor: { metodo: "totp" as const, en: new Date(Date.now() - 31 * 60 * 1000) } };
  await assert.rejects(() => cambiarClabeNomina(a.ctx, vieja, { personaId: liberadora.id, clabe: CLABE_DOS }), codigo("reautenticacion_requerida"));
  await assert.rejects(() => cambiarClabeNomina(a.ctx, b.sesion, { personaId: liberadora.id, clabe: CLABE_DOS }), codigo("reautenticacion_requerida"));
  const avisos: string[] = [];
  const cambio = await cambiarClabeNomina(a.ctx, a.sesion, { personaId: liberadora.id, clabe: CLABE_DOS }, {
    avisar: async (aviso) => {
      avisos.push(`${aviso.para}:${aviso.finalNueva}`);
      return { entregada: false, codigo: "correo_no_configurado" };
    },
  });
  assert.deepEqual(cambio, { tipo: "cambiada", aviso: "no_enviado" });
  assert.deepEqual(avisos, ["liberadora@ejemplo.mx:7899"]);
  await assert.rejects(() => cambiarClabeNomina(a.ctx, a.sesion, { personaId: liberadora.id, clabe: CLABE_DOS }), codigo("clabe_misma"));
  const historial = (await leerDetallePersona(a.ctx, liberadora.id))?.historialClabe ?? [];
  assert.equal(historial.length, 2);
  assert.equal(historial[0]?.visible, "•••• 7899");
  assert.equal(historial[0]?.hasta, null);
  assert.equal(historial[1]?.visible, "•••• 3452");
  assert.notEqual(historial[1]?.hasta, null);
  const bitacoraClabe = eventos(url, "cambiar_clabe_nomina", liberadora.id);
  assert.deepEqual(bitacoraClabe.map((evento) => evento.cambio), [{ clabe_anterior: "•••• 3452", clabe_nueva: "•••• 7899" }]);
  const aviso = eventos(url, "aviso_clabe_nomina", liberadora.id);
  assert.deepEqual(aviso.map((evento) => evento.cambio), [{ entregado: false, codigo: "correo_no_configurado" }]);
  const sinDigitos = consultarJson<Array<{ n: number }>>(url, `select json_agg(fila) from (
    select count(*)::int as n from audit_log where cambio::text like '%${CLABE}%' or cambio::text like '%${CLABE_DOS}%'
  ) fila`);
  assert.equal(sinDigitos[0]?.n, 0);

  // H2: la base no deja cambiar la CLABE sin su evento ni reescribir el historial.
  assert.throws(() => ejecutar(url, `update employees set clabe = '${CLABE}' where id = '${liberadora.id}'`), /auditoria_de_clabe_nomina_ausente/);
  assert.throws(() => ejecutar(url, `update employee_payroll_clabes set clabe = '${CLABE}' where employee_id = '${liberadora.id}'`), /clabe_no_se_pisa/);
  assert.throws(() => ejecutar(url, `delete from employee_payroll_clabes where employee_id = '${liberadora.id}'`), /historial_de_clabe_no_se_borra/);

  // H4: mover la baja no abre la puerta a editar nombre ni CLABE en el mismo UPDATE.
  const operador = consultarJson<Array<{ id: string }>>(url, "select json_agg(fila) from (select id from operators order by alta_en limit 1) fila")[0]?.id;
  const conBaja = (extra: string) => `
    insert into audit_log (operator_id, company_id, actor_tipo, superficie, accion, entidad, identificador)
      values ('${operador}', '${a.empresa.id}', 'sistema', 'sistema', 'baja_persona', 'employees', '${liberadora.id}');
    update employees set baja_en = '${sumarDias(hoy, 40)}', ${extra} where id = '${liberadora.id}';`;
  assert.throws(() => ejecutar(url, conBaja("nombre = 'Otra'")), /auditoria_de_edicion_persona_ausente/);
  assert.throws(() => ejecutar(url, conBaja("jefe_id = null, presupuesto_mensual_centavos = 1")), /auditoria_de_edicion_persona_ausente/);
  assert.throws(() => ejecutar(url, conBaja(`clabe = '${CLABE}'`)), /auditoria_de_clabe_nomina_ausente/);

  // H6: los datos laborales ignoran destino y CLABE que mande el cliente.
  await editarPersona(a.ctx, {
    personaId: liberadora.id, nombre: "Liberadora Uno", alta: "2026-11-01", centroId: area.id, jefeId: "",
    presupuesto: "250.00", destino: "tarjeta", clabe: "",
  });
  const tras6 = await leerDetallePersona(a.ctx, liberadora.id);
  assert.equal(tras6?.persona.clabe, CLABE_DOS);
  assert.equal(tras6?.persona.presupuestoCentavos, 25000);
  const edicion = eventos(url, "editar_persona", liberadora.id).at(-1)?.cambio;
  assert.deepEqual(edicion, { campos: "presupuesto", presupuesto_anterior: 10000, presupuesto_nuevo: 25000 });

  // H8: configurar la nómina deja destino, frecuencia y fecha anteriores y nuevos.
  const otroPago = sumarDias(hoy, 4);
  await configurarNomina(a.ctx, { personaId: liberadora.id, neto: "1200.00", frecuencia: "semanal", primerPago: otroPago, destino: "tarjeta" });
  const config = eventos(url, "configurar_nomina", liberadora.id).at(-1)?.cambio;
  assert.equal(config?.destino_anterior, "clabe");
  assert.equal(config?.destino_nuevo, "tarjeta");
  assert.equal(config?.frecuencia_anterior, "mensual");
  assert.equal(config?.frecuencia_nueva, "semanal");
  assert.equal(config?.pago_anterior, primerPago);
  assert.equal(config?.pago_nuevo, otroPago);
  // Sin CLABE vigente no se programa un depósito a CLABE.
  await assert.rejects(() => configurarNomina(a.ctx, { personaId: contadora.id, neto: "1.00", frecuencia: "mensual", primerPago, destino: "clabe" }), codigo("clabe_requerida"));

  // H7: el único administrador no se da de baja; con otro vigente, sí.
  const yo = await darDeAltaPersona(a.ctx, {
    nombre: "Admin Uno", alta: "2026-11-01", baja: "", centroId: area.id, jefeId: "", altaLlave: randomUUID(),
    nomina: "no", acceso: "ya", correo: "admin-uno@ejemplo.mx",
  });
  await assert.rejects(() => registrarBaja(a.ctx, { personaId: yo.id, baja: sumarDias(hoy, 30) }), codigo("ultimo_administrador"));
  await assert.rejects(() => registrarBaja(a.ctx, { personaId: yo.id, baja: hoy }), codigo("ultimo_administrador"));
  const segundo = await miembro(url, a.ctx, a.empresa.id, {
    nomina: "no", nombre: "Admin Segundo", centroId: area.id, acceso: "nueva", correo: "admin-segundo@ejemplo.mx", rol: ["administrador"],
  });
  await registrarBaja(a.ctx, { personaId: yo.id, baja: sumarDias(hoy, 30) });
  // La baja programada del primero ya no lo cuenta: el segundo queda como único.
  await assert.rejects(() => registrarBaja(a.ctx, { personaId: segundo.id, baja: sumarDias(hoy, 60) }), codigo("ultimo_administrador"));
  await cancelarBaja(a.ctx, { personaId: yo.id });
  assert.equal((await leerDetallePersona(a.ctx, yo.id))?.persona.bajaEn, null);
  assert.deepEqual(eventos(url, "baja_persona", yo.id).at(-1)?.cambio, { baja_anterior: sumarDias(hoy, 30), baja_nueva: null });

  // H1: una baja futura no corta hoy; cuando vence, el acceso se cierra solo.
  const futura = sumarDias(hoy, 10);
  await registrarBaja(a.ctx, { personaId: liberadora.id, baja: futura });
  const antes = await resolverContexto({ sesion: liberadora.sesion, empresaPedida: a.empresa.id, peticionId: null, superficie: "cliente" });
  assert.equal(antes.ctx.empresa?.id, a.empresa.id);
  // Llega el día: la fecha registrada ya es hoy en México. (Mover la fila es
  // la simulación; el trigger de 0017 quita el rol liberador y pide su evento.)
  ejecutar(url, `
    insert into audit_log (operator_id, company_id, actor_tipo, superficie, accion, entidad, identificador)
      values ('${operador}', '${a.empresa.id}', 'sistema', 'sistema', 'baja_persona', 'employees', '${liberadora.id}'),
             ('${operador}', '${a.empresa.id}', 'sistema', 'sistema', 'quitar_liberador', 'membership_roles', '${liberadora.userId}');
    update employees set baja_en = (timezone('America/Mexico_City', clock_timestamp()))::date where id = '${liberadora.id}';`);
  const despues = await resolverContexto({ sesion: liberadora.sesion, empresaPedida: a.empresa.id, peticionId: null, superficie: "cliente" });
  assert.equal(despues.ctx.empresa, null);
  assert.equal(despues.eleccion, "ajena");
  const cerrada = consultarJson<Array<{ membresia: string; sesiones: number; nomina: boolean; tarjetas: number }>>(url, `select json_agg(fila) from (
    select (select estado from memberships where user_id = '${liberadora.userId}') as membresia,
           (select count(*)::int from sessions where user_id = '${liberadora.userId}') as sesiones,
           (select activa from employee_payroll_profiles where employee_id = '${liberadora.id}') as nomina,
           (select count(*)::int from employee_card_requests where employee_id = '${liberadora.id}' and estado = 'pendiente') as tarjetas
  ) fila`)[0];
  assert.deepEqual(cerrada, { membresia: "suspendida", sesiones: 0, nomina: false, tarjetas: 0 });
  assert.equal(await leerSesion(`sesion=${"x".repeat(43)}`), null);
  const sistema = eventos(url, "desprovisionar_persona", liberadora.id);
  assert.equal(sistema.length, 1);
  assert.equal(sistema[0]?.actor_tipo, "sistema");
  // Repetir el barrido no duplica eventos.
  await resolverContexto({ sesion: liberadora.sesion, empresaPedida: a.empresa.id, peticionId: null, superficie: "cliente" });
  await leerMaestro(a.ctx);
  assert.equal(eventos(url, "desprovisionar_persona", liberadora.id).length, 1);
  // Una baja ya efectiva no se cancela ni se mueve al futuro.
  await assert.rejects(() => cancelarBaja(a.ctx, { personaId: liberadora.id }), codigo("baja_ya_efectiva"));
  await assert.rejects(() => registrarBaja(a.ctx, { personaId: liberadora.id, baja: sumarDias(hoy, 5) }), codigo("baja_ya_efectiva"));
  // H18: registrar otra vez la misma baja efectiva no deja otro evento de desaprovisionamiento.
  await registrarBaja(a.ctx, { personaId: contadora.id, baja: hoy });
  await registrarBaja(a.ctx, { personaId: contadora.id, baja: hoy });
  assert.equal(eventos(url, "desprovisionar_persona", contadora.id).length, 1);
  assert.equal(eventos(url, "baja_persona", contadora.id).length, 1);

  // H18: «%» y «_» se buscan como texto.
  const comodin = await leerMaestro(a.ctx, { buscar: "%", centroId: null, estado: "todos", pagina: 1 });
  assert.equal(comodin.total, 0);
}

test("calendario y lotes: fecha del servidor, fechas ya preparadas, totales sin tope y renglones por rol", { skip: URL_ADMIN.length === 0 }, async () => {
  const urlAdmin = exigirBaseDesechable();
  const previo = process.env.DATABASE_URL;
  await conBaseDesechable(urlAdmin, async (url) => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");
    for (const archivo of readdirSync(dir).sort()) {
      if (archivo.endsWith(".sql")) aplicarArchivo(url, join(dir, archivo));
    }
    await cerrarConexion();
    process.env.DATABASE_URL = urlDeAplicacion(url);
    try {
      await calendario(url);
    } finally {
      await cerrarConexion();
      if (previo === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previo;
    }
  });
});

async function calendario(url: string): Promise<void> {
  sembrarPersonal(url);
  const personal = await contextoDePersonal("personal-colaboradores@ejemplo.mx");
  const a = await empresaCon(personal, url, "AAA010101AAA", "Empresa Calendario", "admin-cal@ejemplo.mx");
  const area = await nombrarCentro(a.ctx, { nombre: "Planta" });
  const configurar = { ahora: () => new Date("2026-11-05T18:00:00.000Z") };
  const base = { alta: "2026-11-01", baja: "", centroId: area.id, jefeId: "", acceso: "no", destino: "clabe", clabe: CLABE };

  // H9: 61 personas el 15; la lista se corta en 60, los totales no.
  for (let indice = 0; indice < 61; indice += 1) {
    await darDeAltaPersona(a.ctx, {
      ...base, nombre: `Persona ${String(indice).padStart(2, "0")}`, altaLlave: randomUUID(),
      neto: "100.00", frecuencia: "quincenal", primerPago: "2026-11-15",
    }, configurar);
  }
  const liberadora = await miembro(url, a.ctx, a.empresa.id, {
    nombre: "Liberadora Cal", centroId: area.id, destino: "clabe", clabe: CLABE, neto: "300.00", frecuencia: "mensual",
    primerPago: "2026-11-30", acceso: "nueva", correo: "liberadora-cal@ejemplo.mx", rol: ["liberador"],
  });
  const contadora = await miembro(url, a.ctx, a.empresa.id, {
    nomina: "no", nombre: "Contadora Cal", centroId: area.id, acceso: "nueva", correo: "contadora-cal@ejemplo.mx", rol: ["contador"],
  });
  const semanal = await darDeAltaPersona(a.ctx, {
    ...base, nombre: "Semanal", altaLlave: randomUUID(), neto: "50.00", frecuencia: "semanal", primerPago: "2026-11-08",
  }, configurar);

  const leida = await leerNomina(a.ctx, { ahora: () => new Date("2026-11-06T18:00:00.000Z") });
  assert.equal(leida.proximas.length, 60);
  assert.equal(leida.totales.programadas, 63);
  assert.equal(leida.totales.proximaFecha, "2026-11-08");
  assert.equal(leida.totales.netoProximaCentavos, 5000);
  const delQuince = await leerNomina(a.ctx, { ahora: () => new Date("2026-11-09T18:00:00.000Z") });
  assert.equal(delQuince.totales.primeraVencida, "2026-11-08");

  // H5: el servidor decide la fecha; una del cliente que no es la vencida más antigua se rechaza.
  const el16 = { ahora: () => new Date("2026-11-16T18:00:00.000Z") };
  // Pendientes nombra la misma fecha que prepararNomina toma sin fecha del cliente: la vencida más antigua.
  const nominaDeA = async () =>
    (await leerPendientesInicio(a.ctx, el16)).find((pendiente) => pendiente.id === "nomina-por-preparar")?.titulo ?? null;
  assert.equal(await nominaDeA(), "Prepara el lote de nómina del 8 de noviembre");
  await assert.rejects(() => prepararNomina(a.ctx, "2026-11-15", el16), codigo("nomina_fecha_distinta"));
  await assert.rejects(() => prepararNomina(a.ctx, "2026-12-01", el16), codigo("nomina_fecha_distinta"));
  const del8 = await prepararNomina(a.ctx, "2026-11-08", el16);
  assert.equal(await nominaDeA(), "Prepara el lote de nómina del 15 de noviembre");
  assert.equal((await leerLoteNomina(a.ctx, del8.id))?.lote.totalCentavos, 5000);
  // Semanal avanzó al 15, que todavía no tiene lote.
  // H15: la liberadora (rol que la app deja preparar) también pasa la base.
  const del15 = await prepararNomina(liberadora.ctx, undefined, el16);
  const lote15 = await leerLoteNomina(a.ctx, del15.id);
  assert.equal(lote15?.lote.fechaPago, "2026-11-15");
  assert.equal(await nominaDeA(), null);
  assert.equal(lote15?.lote.personas, 62);
  assert.equal(lote15?.lote.totalCentavos, 61 * 10000 + 5000);
  assert.equal((await prepararNomina(a.ctx, "2026-11-15", el16)).repetida, true);

  // H11: el contador ve el total del lote, no los renglones; la liberadora ve netos sin la CLABE completa.
  const comoContadora = await leerLoteNomina(contadora.ctx, del15.id);
  assert.equal(comoContadora?.detalle, false);
  assert.deepEqual(comoContadora?.items, []);
  assert.equal(comoContadora?.lote.totalCentavos, 615000);
  assert.deepEqual((await leerNomina(contadora.ctx)).proximas, []);
  const comoLiberadora = await leerLoteNomina(liberadora.ctx, del15.id);
  assert.equal(comoLiberadora?.items.length, 62);
  assert.equal(comoLiberadora?.items.every((item) => item.clabe === null && item.clabeFinal === CLABE.slice(-4)), true);
  assert.equal((await leerLoteNomina(a.ctx, del15.id))?.items[0]?.clabe, CLABE);
  // H12: el lote de una empresa no se lee desde otra, aunque se conozca su id.
  const ajena = await empresaCon(personal, url, "BBB010101BBA", "Empresa Ajena Cal", "admin-ajena-cal@ejemplo.mx");
  assert.equal(await leerLoteNomina(ajena.ctx, del15.id), null);
  assert.equal((await leerNomina(ajena.ctx)).totales.lotes, 0);

  // H5: una persona atrasada cuyo siguiente pago ya tiene lote salta a la siguiente fecha libre.
  const operador = consultarJson<Array<{ id: string }>>(url, "select json_agg(fila) from (select id from operators order by alta_en limit 1) fila")[0]?.id;
  ejecutar(url, `
    insert into audit_log (operator_id, company_id, actor_tipo, superficie, accion, entidad, identificador)
      values ('${operador}', '${a.empresa.id}', 'sistema', 'sistema', 'configurar_nomina', 'employee_payroll_profiles', '${semanal.id}');
    update employee_payroll_profiles set proximo_pago_en = '2026-11-01' where employee_id = '${semanal.id}';`);
  const del1 = await prepararNomina(a.ctx, undefined, el16);
  assert.equal((await leerLoteNomina(a.ctx, del1.id))?.lote.fechaPago, "2026-11-01");
  const avance = consultarJson<Array<{ proximo: string }>>(url, `select json_agg(fila) from (
    select proximo_pago_en::text as proximo from employee_payroll_profiles where employee_id = '${semanal.id}'
  ) fila`)[0];
  // 1 → 8 (ya preparado) → 15 (ya preparado) → 22.
  assert.equal(avance?.proximo, "2026-11-22");
  assert.deepEqual(eventos(url, "avanzar_calendario_nomina", semanal.id).at(-1)?.cambio, { pago_anterior: "2026-11-01", pago_nuevo: "2026-11-22" });
  await assert.rejects(() => prepararNomina(a.ctx, undefined, el16), codigo("nomina_sin_vencimientos"));

  // H16: un lote con total y sin renglones no pasa la base.
  const loteVacio = randomUUID();
  assert.throws(() => ejecutar(url, `
    select set_config('app.user_id', '${a.userId}', true);
    insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador)
      values ('${operador}', '${a.empresa.id}', 'miembro', '${a.userId}', 'cliente', 'preparar_nomina', 'payroll_batches', '${loteVacio}');
    insert into payroll_batches (id, company_id, fecha_pago, total_centavos, preparada_por)
      values ('${loteVacio}', '${a.empresa.id}', '2026-10-01', 100, '${a.userId}');`), /lote_de_nomina_vacio/);
}
