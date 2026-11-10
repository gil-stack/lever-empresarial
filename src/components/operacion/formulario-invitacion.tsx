"use client";

import { invitarAdministradorAccion } from "@/app/operacion/acciones";
import { BotonEnviar } from "@/components/sistema";

import { useFormularioConAviso } from "./formulario-con-aviso";

const ID_AVISO = "aviso-invitacion";

/**
 * Invitar (o reinvitar) al primer administrador de la empresa. Si el servidor lo rechaza, vuelven el nombre y el
 * correo como se escribieron, no los de la última invitación. `vista` es la última invitación que se vio en la ficha.
 */
export function FormularioInvitacion({
  companyId,
  vista,
  nombre,
  correo,
}: {
  companyId: string;
  vista: string;
  /** El administrador de la última invitación, si la hubo. */
  nombre: string | null;
  correo: string | null;
}) {
  const { forma, enviar, vuelta, valor, ligado, mensaje, resumen } = useFormularioConAviso(invitarAdministradorAccion, ID_AVISO);
  return (
    <form key={vuelta} ref={forma} action={enviar}>
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="vista" value={vista} />
      {resumen}
      <div className="campo">
        <label htmlFor="nombre">Nombre</label>
        {mensaje("nombre")}
        <input id="nombre" name="nombre" maxLength={200} defaultValue={valor("nombre", nombre ?? "")} required {...ligado("nombre")} />
      </div>
      <div className="campo">
        <label htmlFor="correo">Correo</label>
        {mensaje("correo")}
        <input id="correo" name="correo" type="email" maxLength={254} defaultValue={valor("correo", correo ?? "")} required {...ligado("correo")} />
        {nombre ? <p className="pista">Reenviar anula el enlace anterior.</p> : null}
      </div>
      <div className="acciones">
        <BotonEnviar>{nombre ? "Reenviar invitación" : "Enviar invitación"}</BotonEnviar>
      </div>
    </form>
  );
}
