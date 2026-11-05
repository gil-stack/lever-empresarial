import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { tiene } from "../../src/nucleo/capacidades.ts";
import { cerrarConexion } from "../../src/nucleo/db.ts";
import { ErrorDeDominio } from "../../src/nucleo/error-de-dominio.ts";
import { darDeAltaEmpresa } from "../../src/server/company/servicio.ts";
import { leerResumenInicio } from "../../src/server/inicio/resumen-servicio.ts";
import { aceptarInvitacion } from "../../src/server/invitaciones/servicio.ts";
import { darDeAltaPersona, nombrarCentro } from "../../src/server/personas/servicio.ts";
import { invitarAdministrador, contextoDePersonal } from "../../src/server/plataforma/servicio.ts";
import { quitarRol } from "../../src/server/roles/servicio.ts";
import { leerSesion } from "../../src/server/session/servicio.ts";
import type { Sesion } from "../../src/server/session/tipos.ts";
import { resolverContexto } from "../../src/server/tenencia/resolver.ts";
import { aplicarArchivo, conBaseDesechable, ejecutar, exigirBaseDesechable, urlDeAplicacion } from "../aislamiento/postgres.ts";

const urlAdmin = process.env.AISLAMIENTO_DATABASE_URL?.trim() ?? "";
const CLABE = "002180701150123452";
const CLAVE = "clave-segura-12";

describe("Inicio financiero en Postgres", { skip: urlAdmin.length === 0 }, () => {
  it("consolida solo la empresa y Finanzas se puede otorgar y revocar", async () => {
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
  const personal = await contextoDePersonal("personal-inicio@ejemplo.mx");
  const alfa = await darDeAltaEmpresa(personal, {
    rfc: "TCM010101AB1",
    razonSocial: "Escuela Alfa Inicio",
    codigoPostal: "06600",
    regimen: "601",
    usoCfdi: "G03",
  }, { demostracion: true });
  const beta = await darDeAltaEmpresa(personal, {
    rfc: "CABL840215RF4",
    razonSocial: "Taller Beta Inicio",
    codigoPostal: "44100",
    regimen: "612",
    usoCfdi: "G03",
  }, { demostracion: true });

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
    insert into postings (id, company_id, drawer_id, centavos, motivo, ocurrido_en)
    select '${movimientoBeta}', '${beta.id}', id, 999000, 'Movimiento que no debe mezclarse', '2026-11-05 12:00:00+00'
    from drawers where company_id = '${beta.id}' order by codigo limit 1;
  `);

  const resumen = await leerResumenInicio(finanzas.ctx, 6);
  assert.equal(resumen.saldoCentavos, 100000);
  assert.equal(resumen.ingresosMesCentavos, 123456);
  assert.equal(resumen.gastosMesCentavos, 23456);
  assert.equal(resumen.resultadoMesCentavos, 100000);
  assert.equal(resumen.recientes.length, 2);
  assert.equal(JSON.stringify(resumen).includes(movimientoBeta), false);
  assert.equal(JSON.stringify(resumen).includes("Movimiento que no debe mezclarse"), false);
  assert.equal(tiene(finanzas.ctx.capacidades, "cliente.resumen.ver"), true);
  assert.equal(tiene(finanzas.ctx.capacidades, "cliente.politica.ver"), false);
  assert.equal(tiene(finanzas.ctx.capacidades, "cliente.proveedores.ver"), false);
  assert.equal(tiene(finanzas.ctx.capacidades, "cliente.pago.liberar"), false);

  await quitarRol(admin.ctx, { userId: aceptada.userId, rol: "finanzas" });
  const revocado = await resolverContexto({ sesion: sesionFinanzas, empresaPedida: alfa.id, peticionId: null, superficie: "cliente" });
  assert.equal(tiene(revocado.ctx.capacidades, "cliente.resumen.ver"), false);
  assert.equal(tiene(revocado.ctx.capacidades, "cliente.consola.ver"), false);
  await assert.rejects(
    () => leerResumenInicio(revocado.ctx, 6),
    (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "sin_permiso",
  );
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
