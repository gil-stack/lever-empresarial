import { createHash, randomUUID } from "node:crypto";

import { hoyEnMexico } from "../../src/dominio/personas";
import type { ContextoConEmpresa } from "../../src/nucleo/contexto";
import { aceptarInvitacion } from "../../src/server/invitaciones/servicio";
import { darDeAltaPersona, nombrarCentro } from "../../src/server/personas/servicio";
import { contextoDePersonal, invitarAdministrador } from "../../src/server/plataforma/servicio";
import { leerSesion } from "../../src/server/session/servicio";
import { resolverContexto } from "../../src/server/tenencia/resolver";
import { darDeAltaComoDuena } from "../../scripts/empresa-por-la-duena";
import { ejecutar } from "../aislamiento/postgres";

/**
 * Siembra de la e2e de Tarjetas con Efevoo: una empresa real propia, «Tarjetas E2E», para no cambiar lo que ven las
 * demás pruebas en Altamar (que dice «Disponible pronto»). Las personas pasan por los servicios de la aplicación:
 * Tania (administración), Leo (liberación), Fina (tarjeta y finanzas), Cuco (contador), y Tito y Tere (tarjetahabientes,
 * los titulares). El vínculo con el Efevoo falso y las tarjetas los pone tarjetas.spec.ts, que lo levanta la e2e.
 *
 * Deja en el entorno E2E_TARJETAS_ID.
 */

const CLAVE = "clave-segura-12";

export const CORREOS_TARJETAS = {
  tania: "tania-tarjetas@ejemplo.mx",
  leo: "leo-tarjetas@ejemplo.mx",
  fina: "fina-tarjetas@ejemplo.mx",
  cuco: "cuco-tarjetas@ejemplo.mx",
  tito: "tito-tarjetas@ejemplo.mx",
  tere: "tere-tarjetas@ejemplo.mx",
} as const;

export async function sembrarTarjetas(owner: string): Promise<void> {
  const personal = await contextoDePersonal("personal-e2e@ejemplo.mx");
  const hoy = hoyEnMexico(new Date());
  const empresa = await darDeAltaComoDuena(owner, personal, {
    rfc: "TEE200202AB3", razonSocial: "Tarjetas E2E", codigoPostal: "06600", regimen: "601", usoCfdi: "G03",
  }, { demostracion: false, corridoPor: "pruebas@ejemplo.mx" });
  const invitada = await invitarAdministrador(personal, { companyId: empresa.id, razonSocial: empresa.razonSocial, nombre: "Tania Tarjetas", correo: CORREOS_TARJETAS.tania });
  await aceptarInvitacion({ token: invitada.emitida.token, contrasena: CLAVE, confirmacion: CLAVE });
  const tania = await sesion(owner, invitada.emitida.userId, empresa.id);
  const centro = await nombrarCentro(tania, { nombre: "Operación" });

  const acceso = async (nombre: string, correo: string, ...rol: string[]) => {
    let token = "";
    await darDeAltaPersona(tania, {
      alta: `${hoy.slice(0, 7)}-01`, baja: "", jefeId: "", presupuesto: "", altaLlave: randomUUID(), clabe: "002180701150123452",
      nombre, centroId: centro.id, nomina: "no", acceso: "nueva", correo, rol,
    }, {
      entregar: async (emitida) => {
        token = emitida.token;
        return { entregada: false, codigo: "correo_no_configurado" };
      },
    });
    if (!token) throw new Error(`${nombre} no quedó con acceso.`);
    await aceptarInvitacion({ token, contrasena: CLAVE, confirmacion: CLAVE });
  };
  await acceso("Leo Liberador", CORREOS_TARJETAS.leo, "liberador");
  await acceso("Fina Finanzas", CORREOS_TARJETAS.fina, "tarjetahabiente", "finanzas");
  await acceso("Cuco Contador", CORREOS_TARJETAS.cuco, "contador");
  await acceso("Tito Titular", CORREOS_TARJETAS.tito, "tarjetahabiente");
  await acceso("Tere Titular", CORREOS_TARJETAS.tere, "tarjetahabiente");
  process.env.E2E_TARJETAS_ID = empresa.id;
}

/** Una sesión con segundo factor para sembrar con los servicios, como en siembra.ts. */
async function sesion(owner: string, userId: string, empresaId: string): Promise<ContextoConEmpresa> {
  const token = `S${randomUUID().replace(/-/g, "")}AAAAAAAAAA`.slice(0, 43);
  const entrada = randomUUID();
  ejecutar(owner, `
    insert into auth_entradas (id, user_id, token_hash, creada_en, vence_en, verificada_con, verificada_en, consumida_en)
      values ('${entrada}', '${userId}', '${createHash("sha256").update(entrada).digest("hex")}', now(), now() + interval '10 minutes', 'totp', now(), now());
    insert into sessions (id, user_id, token_hash, expires_at, segundo_factor, entrada_id)
      values ('${randomUUID()}', '${userId}', '${createHash("sha256").update(token).digest("hex")}', now() + interval '1 hour', 'totp', '${entrada}');`);
  const leida = await leerSesion(`sesion=${token}`);
  if (!leida?.segundoFactor) throw new Error("La sesión de siembra no quedó abierta.");
  return (await resolverContexto({ sesion: leida, empresaPedida: empresaId, peticionId: null, superficie: "cliente" })).ctx as ContextoConEmpresa;
}
