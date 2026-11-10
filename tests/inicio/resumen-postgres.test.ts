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
import { leerResumenInicio } from "../../src/server/inicio/resumen-servicio.ts";
import { aceptarInvitacion } from "../../src/server/invitaciones/servicio.ts";
import { darDeAltaPersona, nombrarCentro } from "../../src/server/personas/servicio.ts";
import { invitarAdministrador, contextoDePersonal } from "../../src/server/plataforma/servicio.ts";
import { cambiarAccesoFinanzas } from "../../src/server/roles/finanzas.ts";
import { asignarRol, quitarRol } from "../../src/server/roles/servicio.ts";
import { leerSesion } from "../../src/server/session/servicio.ts";
import type { Sesion } from "../../src/server/session/tipos.ts";
import { resolverContexto } from "../../src/server/tenencia/resolver.ts";
import { aplicarArchivo, conBaseDesechable, consultarJson, ejecutar, exigirBaseDesechable, urlDeAplicacion } from "../aislamiento/postgres.ts";

const urlAdmin = process.env.AISLAMIENTO_DATABASE_URL?.trim() ?? "";
const CLABE = "002180701150123452";
const CLAVE = "clave-segura-12";
/** Reloj fijo: los asientos son de noviembre de 2026 y la prueba no depende del día en que corre. */
const AHORA = { ahora: () => new Date("2026-11-05T18:00:00Z") };

describe("Inicio financiero en Postgres", { skip: urlAdmin.length === 0 }, () => {
  it("consolida solo la empresa, corta el mes en hora de México y Finanzas se otorga y revoca", async () => {
    exigirBaseDesechable();
    await conBaseDesechable(urlAdmin, async (url) => {
      const dir = join(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");
      for (const archivo of readdirSync(dir).sort()) {
        if (archivo.endsWith(".sql")) aplicarArchivo(url, join(dir, archivo));
      }
      // La sesión de la aplicación en UTC, como Neon y el contenedor de CI.
      fijarZona(url, "UTC");
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
  const personal = await contextoDePersonal("personal-inicio@ejemplo.mx");
  const alfa = await darDeAltaComoDuena(url, personal, {
    rfc: "TCM010101AB1",
    razonSocial: "Escuela Alfa Inicio",
    codigoPostal: "06600",
    regimen: "601",
    usoCfdi: "G03",
  }, { demostracion: true, corridoPor: "pruebas@ejemplo.mx" });
  const beta = await darDeAltaComoDuena(url, personal, {
    rfc: "CABL840215RF4",
    razonSocial: "Taller Beta Inicio",
    codigoPostal: "44100",
    regimen: "612",
    usoCfdi: "G03",
  }, { demostracion: true, corridoPor: "pruebas@ejemplo.mx" });

  const invitado = await invitarAdministrador(personal, {
    companyId: alfa.id,
    razonSocial: alfa.razonSocial,
    nombre: "Admin Inicio",
    correo: "admin-inicio@ejemplo.mx",
  });
  await aceptarInvitacion({ token: invitado.emitida.token, contrasena: CLAVE, confirmacion: CLAVE });
  const admin = await resolverContexto({
    sesion: await sesionPara(url, invitado.emitida.userId),
    empresaPedida: alfa.id,
    peticionId: null,
    superficie: "cliente",
  });
  const centro = await nombrarCentro(admin.ctx, { nombre: "Operación" });

  let tokenFinanzas = "";
  await darDeAltaPersona(admin.ctx, {
    nombre: "Finanzas Lectura",
    alta: "2026-11-04",
    baja: "",
    centroId: centro.id,
    jefeId: "",
    clabe: CLABE,
    acceso: "nueva",
    correo: "finanzas-inicio@ejemplo.mx",
    rol: ["tarjetahabiente", "finanzas"],
  }, {
    entregar: async (emitida) => {
      tokenFinanzas = emitida.token;
      return { entregada: false, codigo: "correo_no_configurado" };
    },
  });
  const aceptada = await aceptarInvitacion({ token: tokenFinanzas, contrasena: CLAVE, confirmacion: CLAVE });
  const sesionFinanzas = await sesionPara(url, aceptada.userId);
  const finanzas = await resolverContexto({ sesion: sesionFinanzas, empresaPedida: alfa.id, peticionId: null, superficie: "cliente" });

  const movimientoBeta = randomUUID();
  ejecutar(url, `
    insert into postings (id, company_id, drawer_id, centavos, motivo, ocurrido_en)
    select '${randomUUID()}', '${alfa.id}', id, 123456, 'Venta de Alfa', '2026-11-04 12:00:00+00'
    from drawers where company_id = '${alfa.id}' order by codigo limit 1;
    insert into postings (id, company_id, drawer_id, centavos, motivo, ocurrido_en)
    select '${randomUUID()}', '${alfa.id}', id, -23456, 'Proveedor de Alfa', '2026-11-05 12:00:00+00'
    from drawers where company_id = '${alfa.id}' order by codigo limit 1;
    -- 31 de octubre, 20:00 en México: en UTC ya es 1 de noviembre, pero es de octubre.
    insert into postings (id, company_id, drawer_id, centavos, motivo, ocurrido_en)
    select '${randomUUID()}', '${alfa.id}', id, -5000, 'Viáticos del 31 de octubre', '2026-10-31 20:00:00-06'
    from drawers where company_id = '${alfa.id}' and codigo = 'viaticos';
    -- 1 de diciembre, 00:30 en México: fuera del mes actual aunque en UTC siga noviembre.
    insert into postings (id, company_id, drawer_id, centavos, motivo, ocurrido_en)
    select '${randomUUID()}', '${alfa.id}', id, -7000, 'Cargo de diciembre', '2026-12-01 00:30:00-06'
    from drawers where company_id = '${alfa.id}' and codigo = 'viaticos';
    insert into postings (id, company_id, drawer_id, centavos, motivo, ocurrido_en)
    select '${movimientoBeta}', '${beta.id}', id, 999000, 'Movimiento que no debe mezclarse', '2026-11-05 12:00:00+00'
    from drawers where company_id = '${beta.id}' order by codigo limit 1;
  `);

  const resumen = await leerResumenInicio(finanzas.ctx, 6, AHORA);
  assert.equal(resumen.saldoCentavos, 100000 - 5000 - 7000);
  assert.equal(resumen.entradasMesCentavos, 123456);
  assert.equal(resumen.salidasMesCentavos, 23456);
  assert.equal(resumen.netoMesCentavos, 100000);
  assert.deepEqual(resumen.meses.find((mes) => mes.clave === "2026-10"), {
    clave: "2026-10",
    etiqueta: "Oct",
    entradasCentavos: 0,
    salidasCentavos: 5000,
  });
  // Las categorías del mes son el mismo intervalo que «Salidas del mes»: sin el 31 de octubre ni diciembre.
  assert.equal(resumen.categorias.some((categoria) => categoria.codigo === "viaticos"), false);
  assert.equal(resumen.categorias.reduce((suma, categoria) => suma + categoria.salidasCentavos, 0), resumen.salidasMesCentavos);
  assert.equal(resumen.recientes.length, 4);
  assert.equal(JSON.stringify(resumen).includes(movimientoBeta), false);
  assert.equal(JSON.stringify(resumen).includes("Movimiento que no debe mezclarse"), false);

  // El corte no depende de la zona de la sesión: con UTC+14 las cifras son las mismas.
  fijarZona(url, "Pacific/Kiritimati");
  await cerrarConexion();
  assert.deepEqual(await leerResumenInicio(finanzas.ctx, 6, AHORA), resumen);
  fijarZona(url, "UTC");
  await cerrarConexion();

  // Finanzas: solo resumen y pendientes; nada del teléfono por Finanzas.
  assert.equal(tiene(finanzas.ctx.capacidades, "cliente.resumen.ver"), true);
  assert.equal(tiene(finanzas.ctx.capacidades, "cliente.politica.ver"), false);
  assert.equal(tiene(finanzas.ctx.capacidades, "cliente.proveedores.ver"), false);
  assert.equal(tiene(finanzas.ctx.capacidades, "cliente.pago.liberar"), false);

  // Un contador recibe Finanzas por asignarRol en la base y lo pierde al quitarlo.
  let tokenContador = "";
  await darDeAltaPersona(admin.ctx, {
    nombre: "Contador Norte",
    alta: "2026-11-04",
    baja: "",
    centroId: centro.id,
    jefeId: "",
    clabe: CLABE,
    acceso: "nueva",
    correo: "contador-inicio@ejemplo.mx",
    rol: ["contador"],
  }, {
    entregar: async (emitida) => {
      tokenContador = emitida.token;
      return { entregada: false, codigo: "correo_no_configurado" };
    },
  });
  const contadorAceptado = await aceptarInvitacion({ token: tokenContador, contrasena: CLAVE, confirmacion: CLAVE });
  const sesionContador = await sesionPara(url, contadorAceptado.userId);
  const contador = await resolverContexto({ sesion: sesionContador, empresaPedida: alfa.id, peticionId: null, superficie: "cliente" });
  assert.equal(tiene(contador.ctx.capacidades, "cliente.resumen.ver"), false);
  assert.equal(tiene(contador.ctx.capacidades, "telefono.inicio.ver"), true);

  // Sin administración no se otorga Finanzas, ni a sí mismo.
  await assert.rejects(
    () => asignarRol(contador.ctx, { userId: contadorAceptado.userId, rol: "finanzas" }),
    (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "sin_permiso",
  );
  assert.deepEqual(
    await cambiarAccesoFinanzas(finanzas.ctx, { userId: contadorAceptado.userId, verFinanzas: "si" }),
    { tipo: "rechazado", codigo: "sin_permiso", habilitado: false },
  );

  const asignada = await asignarRol(admin.ctx, { userId: contadorAceptado.userId, rol: "finanzas" });
  assert.deepEqual([...asignada.roles].sort(), ["contador", "finanzas"]);
  const conFinanzas = await resolverContexto({ sesion: sesionContador, empresaPedida: alfa.id, peticionId: null, superficie: "cliente" });
  assert.equal(tiene(conFinanzas.ctx.capacidades, "cliente.resumen.ver"), true);
  assert.equal((await leerResumenInicio(conFinanzas.ctx, 6, AHORA)).saldoCentavos, resumen.saldoCentavos);

  // Nadie queda solo con Finanzas.
  await assert.rejects(
    () => quitarRol(admin.ctx, { userId: contadorAceptado.userId, rol: "contador" }),
    (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "ultimo_rol_de_trabajo",
  );

  // IDOR: el administrador de Alfa no cambia a una persona de Beta aunque mande su userId.
  const invitadoBeta = await invitarAdministrador(personal, {
    companyId: beta.id,
    razonSocial: beta.razonSocial,
    nombre: "Admin Beta",
    correo: "admin-beta-inicio@ejemplo.mx",
  });
  const adminBeta = await aceptarInvitacion({ token: invitadoBeta.emitida.token, contrasena: CLAVE, confirmacion: CLAVE });
  assert.deepEqual(
    await cambiarAccesoFinanzas(admin.ctx, { userId: adminBeta.userId, verFinanzas: "si" }),
    { tipo: "rechazado", codigo: "sin_membresia", habilitado: false },
  );
  await assert.rejects(
    () => asignarRol(admin.ctx, { userId: adminBeta.userId, rol: "finanzas", companyId: beta.id }),
    (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "sin_membresia",
  );
  assert.equal(
    contarFilas(url, `select count(*) from membership_roles where user_id = '${adminBeta.userId}' and rol = 'finanzas'`),
    0,
  );

  const retirado = await cambiarAccesoFinanzas(admin.ctx, { userId: contadorAceptado.userId, verFinanzas: "no" });
  assert.deepEqual(retirado, { tipo: "listo", mensaje: "Se retiró el acceso a Inicio financiero.", habilitado: false });

  await quitarRol(admin.ctx, { userId: aceptada.userId, rol: "finanzas" });
  const revocado = await resolverContexto({ sesion: sesionFinanzas, empresaPedida: alfa.id, peticionId: null, superficie: "cliente" });
  assert.equal(tiene(revocado.ctx.capacidades, "cliente.resumen.ver"), false);
  assert.equal(tiene(revocado.ctx.capacidades, "cliente.consola.ver"), false);
  await assert.rejects(
    () => leerResumenInicio(revocado.ctx, 6, AHORA),
    (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "sin_permiso",
  );
}

function fijarZona(url: string, zona: string): void {
  ejecutar(url, `do $$ begin execute format('alter database %I set timezone to %L', current_database(), '${zona}'); end $$;`);
}

function contarFilas(url: string, sql: string): number {
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
      values ('99999999-9999-4999-8999-999999999999', 'Personal', 'personal-inicio@ejemplo.mx', '$2b$12$${"a".repeat(53)}');
    insert into platform_staff (operator_id, user_id, estado)
      values ((select id from operators order by alta_en limit 1), '99999999-9999-4999-8999-999999999999', 'activo');
    insert into platform_staff_roles (operator_id, user_id, rol)
      values ((select id from operators order by alta_en limit 1), '99999999-9999-4999-8999-999999999999', 'administracion_plataforma');
  `);
}
