import { darDeAltaEmpresa } from "../../src/server/company/servicio";
import { aceptarInvitacion } from "../../src/server/invitaciones/servicio";
import { contextoDePersonal, invitarAdministrador } from "../../src/server/plataforma/servicio";

/**
 * Siembra de la e2e de cobranza: dos empresas propias para no mover los totales
 * del flujo de caja de Altamar. «Cobranza E2E» es real (sin datos de ejemplo:
 * la detección automática dice «disponible pronto»); «Demo Cobranza E2E» es de
 * demostración (correos simulados y depósitos simulados). Cada una con su
 * administrador; los correos de los clientes los escribe la prueba (@ejemplo.mx).
 *
 * Deja en el entorno E2E_COBRANZA_ID y E2E_COBRANZA_DEMO_ID.
 */

const CLAVE = "clave-segura-12";

export const CORREOS_COBRANZA = {
  carla: "carla-cobranza@ejemplo.mx",
  dario: "dario-demo-cobranza@ejemplo.mx",
} as const;

export async function sembrarCobranza(): Promise<void> {
  const personal = await contextoDePersonal("personal-e2e@ejemplo.mx");
  const empresa = async (rfc: string, razonSocial: string, demostracion: boolean, nombre: string, correo: string) => {
    const alta = await darDeAltaEmpresa(personal, { rfc, razonSocial, codigoPostal: "06600", regimen: "601", usoCfdi: "G03" }, { demostracion });
    const invitada = await invitarAdministrador(personal, { companyId: alta.id, razonSocial: alta.razonSocial, nombre, correo });
    await aceptarInvitacion({ token: invitada.emitida.token, contrasena: CLAVE, confirmacion: CLAVE });
    return alta.id;
  };
  process.env.E2E_COBRANZA_ID = await empresa("CEE200101AB1", "Cobranza E2E", false, "Carla Cobranza", CORREOS_COBRANZA.carla);
  process.env.E2E_COBRANZA_DEMO_ID = await empresa("DCE200101AB2", "Demo Cobranza E2E", true, "Darío Demo", CORREOS_COBRANZA.dario);
}
