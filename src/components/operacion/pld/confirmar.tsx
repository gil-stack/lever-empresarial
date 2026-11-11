import { redirect } from "next/navigation";

import { ConfirmarIdentidad } from "@/components/entrar/confirmar-identidad";
import { estadoDeConfirmacion } from "@/server/autenticacion";
import { factorReciente, VIGENCIA_AUTORIZACION_MS } from "@/server/autenticacion/reautenticacion";
import { sesionSegura } from "@/server/entrada";

/**
 * Las decisiones de PLD (dictamen, parámetros de las alertas y quién dictamina)
 * piden el segundo factor de los últimos 30 minutos, como las demás decisiones de
 * Operación. Si el de la sesión es más viejo, ofrece «Confirma que eres tú» aquí
 * mismo; al confirmar, la página se vuelve a leer con el factor renovado.
 */
export async function ConfirmarParaDecidir({ motivo }: { motivo: string }) {
  const sesion = await sesionSegura();
  if (!sesion) redirect("/operacion/entrar");
  if (factorReciente(sesion, { superficie: "sofipo", vigenciaMs: VIGENCIA_AUTORIZACION_MS })) return null;
  const confirmacion = await estadoDeConfirmacion(sesion);
  return (
    <div className="panel operacion-confirmar">
      <ConfirmarIdentidad passkey={confirmacion.passkey} totp={confirmacion.totp} respaldo={confirmacion.respaldo} motivo={motivo} />
    </div>
  );
}
