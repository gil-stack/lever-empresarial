import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { cerrarConexion } from "../../src/nucleo/db.ts";
import { configurarNomina, leerLoteNomina, prepararNomina } from "../../src/server/nomina/servicio.ts";
import { darDeAltaEmpresa } from "../../src/server/company/servicio.ts";
import { aceptarInvitacion } from "../../src/server/invitaciones/servicio.ts";
import {
  darDeAltaPersona,
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
    clabe: CLABE,
  }, { ahora: () => new Date("2026-11-15T18:00:00.000Z") });
  const antesDePreparar = await leerDetallePersona(admin, tesoreria.id);
  assert.equal(antesDePreparar?.persona.nomina?.netoCentavos, 25000);
  assert.equal(antesDePreparar?.persona.nomina?.activa, true);

  const preparada = await prepararNomina(admin, "2026-11-15", {
    ahora: () => new Date("2026-11-15T18:00:00.000Z"),
  });
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
    clabe: CLABE,
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
