import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { tiene } from "../../src/nucleo/capacidades.ts";
import { cerrarConexion } from "../../src/nucleo/db.ts";
import { ErrorDeDominio } from "../../src/nucleo/error-de-dominio.ts";
import { darDeAltaComoDuena } from "../../scripts/empresa-por-la-duena.ts";
import { leerPendientesInicio } from "../../src/server/inicio/servicio.ts";
import { aceptarInvitacion } from "../../src/server/invitaciones/servicio.ts";
import { darDeAltaPersona, nombrarCentro, registrarBaja } from "../../src/server/personas/servicio.ts";
import { invitarAdministrador, contextoDePersonal } from "../../src/server/plataforma/servicio.ts";
import { leerSesion } from "../../src/server/session/servicio.ts";
import type { Sesion } from "../../src/server/session/tipos.ts";
import { crearCategoria } from "../../src/server/politica/servicio.ts";
import { leerFacturacionTelefono, leerInicioTelefono, leerTopesTelefono } from "../../src/server/telefono/servicio.ts";
import { resolverContexto } from "../../src/server/tenencia/resolver.ts";
import { aplicarArchivo, conBaseDesechable, ejecutar, exigirBaseDesechable, urlDeAplicacion } from "./postgres.ts";

const urlAdmin = process.env.AISLAMIENTO_DATABASE_URL?.trim() ?? "";
const CLABE = "002180701150123452";
const CLAVE = "clave-segura-12";

/** Corre únicamente con la base desechable de scripts/ci/pruebas-postgres.sh. */
describe("teléfono y tenencia en Postgres", { skip: urlAdmin.length === 0 }, () => {
  it("no expone tesorería, otra persona ni otra empresa; NULL y cero se conservan", async () => {
    exigirBaseDesechable();
    await conBaseDesechable(urlAdmin, async (url) => {
      const dir = join(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");
      for (const archivo of readdirSync(dir).sort()) {
        if (archivo.endsWith(".sql")) aplicarArchivo(url, join(dir, archivo));
      }
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

async function escenario(url: string): Promise<void> {
  sembrarPersonal(url);
  const personal = await contextoDePersonal("personal-telefono@ejemplo.mx");
  const alfa = await darDeAltaComoDuena(url, personal, {
    rfc: "TCM010101AB1",
    razonSocial: "Escuela Alfa Teléfono",
    codigoPostal: "06600",
    regimen: "601",
    usoCfdi: "G03",
  }, { demostracion: true, corridoPor: "pruebas@ejemplo.mx" });
  const beta = await darDeAltaComoDuena(url, personal, {
    rfc: "CABL840215RF4",
    razonSocial: "Taller Beta Ajeno",
    codigoPostal: "44100",
    regimen: "612",
    usoCfdi: "G03",
  }, { demostracion: true, corridoPor: "pruebas@ejemplo.mx" });

  const adminInvitado = await invitarAdministrador(personal, {
    companyId: alfa.id,
    razonSocial: alfa.razonSocial,
    nombre: "Admin Teléfono",
    correo: "admin-telefono@ejemplo.mx",
  });
  await aceptarInvitacion({ token: adminInvitado.emitida.token, contrasena: CLAVE, confirmacion: CLAVE });
  const sesionAdmin = await sesionPara(url, adminInvitado.emitida.userId);
  const admin = await resolverContexto({ sesion: sesionAdmin, empresaPedida: alfa.id, peticionId: null, superficie: "cliente" });
  const centro = await nombrarCentro(admin.ctx, { nombre: "Operación" });

  let tokenTarjeta = "";
  const tarjetaPersona = await darDeAltaPersona(admin.ctx, {
    nombre: "Tarjeta Propia",
    alta: "2026-11-04",
    baja: "",
    centroId: centro.id,
    jefeId: "",
    clabe: CLABE,
    acceso: "nueva",
    correo: "tarjeta-telefono@ejemplo.mx",
    rol: "tarjetahabiente",
  }, {
    entregar: async (emitida) => {
      tokenTarjeta = emitida.token;
      return { entregada: false, codigo: "correo_no_configurado" };
    },
  });
  assert.notEqual(tokenTarjeta, "");
  const tarjetaAceptada = await aceptarInvitacion({ token: tokenTarjeta, contrasena: CLAVE, confirmacion: CLAVE });
  await darDeAltaPersona(admin.ctx, {
    nombre: "Persona Que No Debe Salir",
    alta: "2026-11-04",
    baja: "",
    centroId: centro.id,
    jefeId: "",
    clabe: CLABE,
    acceso: "nueva",
    correo: "otra-telefono@ejemplo.mx",
    rol: "tarjetahabiente",
  }, { entregar: async () => ({ entregada: false, codigo: "correo_no_configurado" }) });
  await crearCategoria(admin.ctx, { nombre: "Sin escribir", tope: "" });
  await crearCategoria(admin.ctx, { nombre: "Cero", tope: "0" });
  ejecutar(url, `
    insert into postings (id, company_id, drawer_id, centavos, motivo)
    select '${randomUUID()}', '${alfa.id}', id, 123456, 'Tesorería que no debe salir'
    from drawers where company_id = '${alfa.id}' order by codigo limit 1;
  `);

  const sesionTarjeta = await sesionPara(url, tarjetaAceptada.userId);
  const tarjeta = await resolverContexto({ sesion: sesionTarjeta, empresaPedida: alfa.id, peticionId: null, superficie: "telefono" });
  assert.equal(tiene(tarjeta.ctx.capacidades, "cliente.consola.ver"), false);
  assert.equal(tiene(tarjeta.ctx.capacidades, "telefono.inicio.ver"), true);
  await assert.rejects(
    () => leerPendientesInicio(tarjeta.ctx),
    (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "sin_permiso",
  );

  const inicio = await leerInicioTelefono(tarjeta.ctx);
  const topes = await leerTopesTelefono(tarjeta.ctx);
  const fiscales = await leerFacturacionTelefono(tarjeta.ctx);
  assert.equal(inicio?.nombre, "Tarjeta Propia");
  assert.deepEqual(topes.map((tope) => tope.topeCentavos), [0, null]);
  assert.equal(fiscales?.rfc, "TCM010101AB1");
  const proyeccion = JSON.stringify({ inicio, topes, fiscales });
  assert.equal(proyeccion.includes("Persona Que No Debe Salir"), false);
  assert.equal(proyeccion.includes("Taller Beta Ajeno"), false);
  assert.equal(proyeccion.includes(CLABE), false);
  assert.equal(proyeccion.includes("123456"), false);

  const ajena = await resolverContexto({ sesion: sesionTarjeta, empresaPedida: beta.id, peticionId: null, superficie: "telefono" });
  assert.equal(ajena.eleccion, "ajena");
  assert.equal(ajena.ctx.empresa, null);
  await assert.rejects(() => leerTopesTelefono(ajena.ctx), (error: unknown) => error instanceof ErrorDeDominio);

  await registrarBaja(admin.ctx, { personaId: tarjetaPersona.id, baja: new Date().toISOString().slice(0, 10) });
  assert.equal(await leerInicioTelefono(tarjeta.ctx), null);
  assert.deepEqual(await leerTopesTelefono(tarjeta.ctx), []);
  assert.equal(await leerFacturacionTelefono(tarjeta.ctx), null);

  assert.equal(tiene(admin.ctx.capacidades, "cliente.consola.ver"), true);
  assert.equal(tiene(admin.ctx.capacidades, "telefono.inicio.ver"), true);
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
      values ('99999999-9999-4999-8999-999999999999', 'Personal', 'personal-telefono@ejemplo.mx', '$2b$12$${"a".repeat(53)}');
    insert into platform_staff (operator_id, user_id, estado)
      values ((select id from operators order by alta_en limit 1), '99999999-9999-4999-8999-999999999999', 'activo');
    insert into platform_staff_roles (operator_id, user_id, rol)
      values ((select id from operators order by alta_en limit 1), '99999999-9999-4999-8999-999999999999', 'administracion_plataforma');
  `);
}
