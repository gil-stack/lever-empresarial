import { createHash, randomUUID } from "node:crypto";

import type { ContextoConEmpresa } from "../../src/nucleo/contexto.ts";
import { aceptarInvitacion } from "../../src/server/invitaciones/servicio.ts";
import { darDeAltaPersona } from "../../src/server/personas/servicio.ts";
import { invitarAdministrador, type contextoDePersonal } from "../../src/server/plataforma/servicio.ts";
import { leerSesion } from "../../src/server/session/servicio.ts";
import type { Sesion } from "../../src/server/session/tipos.ts";
import { resolverContexto } from "../../src/server/tenencia/resolver.ts";
import { consultarJson, ejecutar } from "../aislamiento/postgres.ts";

/** Siembra compartida de las pruebas de cobranza en Postgres: personal, administradores y personas con sesión real. */

export const CLAVE = "clave-segura-12";
export const CLABE_EMPRESA = "002180701150123452";
export const reloj = (iso: string) => () => new Date(iso);
/** Martes 10 de noviembre de 2026, mediodía en México. */
export const HOY = reloj("2026-11-10T18:00:00.000Z");

export type Personal = Awaited<ReturnType<typeof contextoDePersonal>>;

export function contar(url: string, sql: string): number {
  const fila = consultarJson<{ n: number }[]>(url, `select json_agg(json_build_object('n', (${sql}))) from (select 1) x`);
  return fila[0]?.n ?? -1;
}

export async function sesionPara(url: string, userId: string): Promise<Sesion> {
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

export function sembrarPersonal(url: string): void {
  ejecutar(url, `
    insert into users (id, nombre, correo, password_hash)
      values ('99999999-9999-4999-8999-999999999998', 'Personal', 'personal-cobranza@ejemplo.mx', '$2b$12$${"a".repeat(53)}');
    insert into platform_staff (operator_id, user_id, estado)
      values ((select id from operators order by alta_en limit 1), '99999999-9999-4999-8999-999999999998', 'activo');
    insert into platform_staff_roles (operator_id, user_id, rol)
      values ((select id from operators order by alta_en limit 1), '99999999-9999-4999-8999-999999999998', 'administracion_plataforma');
  `);
}

export async function administrador(url: string, personal: Personal, empresa: { id: string; razonSocial: string }, correo: string): Promise<[ContextoConEmpresa, Sesion]> {
  const invitado = await invitarAdministrador(personal, { companyId: empresa.id, razonSocial: empresa.razonSocial, nombre: `Admin ${empresa.razonSocial}`, correo });
  await aceptarInvitacion({ token: invitado.emitida.token, contrasena: CLAVE, confirmacion: CLAVE });
  const sesion = await sesionPara(url, invitado.emitida.userId);
  return [(await resolverContexto({ sesion, empresaPedida: empresa.id, peticionId: null, superficie: "cliente" })).ctx as ContextoConEmpresa, sesion];
}

export async function persona(url: string, admin: ContextoConEmpresa, centroId: string, nombre: string, correo: string, rol: string[]): Promise<ContextoConEmpresa> {
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
