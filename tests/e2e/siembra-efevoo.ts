import { createHash, randomUUID } from "node:crypto";

import { darDeAltaComoDuena } from "../../scripts/empresa-por-la-duena";
import type { ContextoConEmpresa, ContextoDePersonal } from "../../src/nucleo/contexto";
import { aceptarInvitacion } from "../../src/server/invitaciones/servicio";
import { enviarVersion } from "../../src/server/operacion/expediente";
import { darDeAltaPersona, nombrarCentro } from "../../src/server/personas/servicio";
import { contextoDePersonal, invitarAdministrador } from "../../src/server/plataforma/servicio";
import { leerSesion } from "../../src/server/session/servicio";
import { resolverContexto } from "../../src/server/tenencia/resolver";
import { ejecutar } from "../aislamiento/postgres";
import { armarBorrador } from "../operacion/apoyo-alta-regulada";
import { CORREOS } from "./siembra";

/**
 * Siembra de tests/e2e/efevoo.spec.ts: Ceiba E2E, una empresa real (no de
 * demostración) y activa, con su expediente enviado (lo que toma el alta en
 * Efevoo) y dos empleados activos sin cuenta, a quienes se les asignan
 * tarjetas. Es solo de este spec: ningún otro la usa ni la vincula con Efevoo.
 */

export const CEIBA = { razonSocial: "Ceiba E2E", rfc: "CEE170101AB2" } as const;
export const EMPLEADOS_CEIBA = ["Paula Ceiba Robles", "Marco Ceiba Luna"] as const;
const CLAVE = "clave-segura-12";
const CLABE = "002180701150123452";

export async function sembrarEfevoo(owner: string): Promise<void> {
  const personal = await contextoDePersonal("personal-e2e@ejemplo.mx");
  const ceiba = await darDeAltaComoDuena(owner, personal, { ...CEIBA, codigoPostal: "06600", regimen: "601", usoCfdi: "G03" },
    { demostracion: false, corridoPor: "pruebas@ejemplo.mx" });
  const invitada = await invitarAdministrador(personal, { companyId: ceiba.id, razonSocial: ceiba.razonSocial, nombre: "Admin Ceiba", correo: "admin@ceiba-e2e.mx" });
  await aceptarInvitacion({ token: invitada.emitida.token, contrasena: CLAVE, confirmacion: CLAVE });
  const admin = await contextoDeCliente(owner, invitada.emitida.userId, ceiba.id);
  const centro = await nombrarCentro(admin, { nombre: "Operación" }, {});
  const hoy = new Date().toISOString().slice(0, 7);
  for (const nombre of EMPLEADOS_CEIBA) {
    await darDeAltaPersona(admin, {
      nombre, alta: `${hoy}-01`, baja: "", centroId: centro.id, jefeId: "", presupuesto: "", altaLlave: randomUUID(),
      nomina: "no", clabe: CLABE, acceso: "no", correo: "", rol: [],
    }, {});
  }
  // El expediente que lee el alta en Efevoo: la versión 1, armada y enviada por Originación (op1).
  const origina = (await contextoDePersonal(CORREOS.op1)) as ContextoDePersonal;
  const { versionId } = await armarBorrador(origina, { companyId: ceiba.id, ...CEIBA });
  await enviarVersion(origina, versionId);
  process.env.E2E_CEIBA_ID = ceiba.id;
}

async function contextoDeCliente(owner: string, userId: string, empresaId: string): Promise<ContextoConEmpresa> {
  const token = `S${randomUUID().replace(/-/g, "")}AAAAAAAAAA`.slice(0, 43);
  const entrada = randomUUID();
  ejecutar(owner, `
    insert into auth_entradas (id, user_id, token_hash, creada_en, vence_en, verificada_con, verificada_en, consumida_en)
      values ('${entrada}', '${userId}', '${createHash("sha256").update(entrada).digest("hex")}', now(), now() + interval '10 minutes', 'totp', now(), now());
    insert into sessions (id, user_id, token_hash, expires_at, segundo_factor, entrada_id)
      values ('${randomUUID()}', '${userId}', '${createHash("sha256").update(token).digest("hex")}', now() + interval '1 hour', 'totp', '${entrada}');`);
  const sesion = await leerSesion(`sesion=${token}`);
  if (!sesion?.segundoFactor) throw new Error("La sesión de siembra de Ceiba no quedó abierta.");
  return (await resolverContexto({ sesion, empresaPedida: empresaId, peticionId: null, superficie: "cliente" })).ctx as ContextoConEmpresa;
}
