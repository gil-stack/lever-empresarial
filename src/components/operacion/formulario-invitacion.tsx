"use client";

import { invitarAdministradorAccion } from "@/app/operacion/acciones";
import { BotonEnviar } from "@/components/sistema";

import { EnlaceParaCopiar } from "./enlace-para-copiar";
import { useFormularioConAviso } from "./formulario-con-aviso";

const ID_AVISO = "aviso-invitacion";

/**
 * Invitar (o reinvitar) al primer administrador de la empresa. Si el servidor lo rechaza, vuelven el nombre y el
 * correo como se escribieron, no los de la última invitación. `vista` es la última invitación que se vio en la ficha.
 * Si el correo no sale, la respuesta trae el enlace y se muestra para copiarlo.
 */
export function FormularioInvitacion({
  companyId,
  vista,
  nombre,
  correo,
  nombreSugerido,
  correoSugerido,
}: {
  companyId: string;
  vista: string;
  /** El administrador de la última invitación, si la hubo. */
  nombre: string | null;
  correo: string | null;
  /** Quien se anotó en el alta como primer administrador, para llenar el formulario la primera vez. */
  nombreSugerido?: string | null;
  correoSugerido?: string | null;
}) {
  const { forma, enviar, vuelta, valor, ligado, mensaje, resumen, enlace } = useFormularioConAviso(invitarAdministradorAccion, ID_AVISO);
  return (
    <form key={vuelta} ref={forma} action={enviar}>
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="vista" value={vista} />
      {resumen}
      {enlace ? <EnlaceParaCopiar enlace={enlace} /> : null}
      <div className="campo">
        <label htmlFor="nombre">Nombre</label>
        {mensaje("nombre")}
        <input id="nombre" name="nombre" maxLength={200} defaultValue={valor("nombre", nombre ?? nombreSugerido ?? "")} required {...ligado("nombre")} />
      </div>
      <div className="campo">
        <label htmlFor="correo">Correo</label>
        {mensaje("correo")}
        <input
          id="correo"
          name="correo"
          type="email"
          maxLength={254}
          defaultValue={valor("correo", correo ?? correoSugerido ?? "")}
          required
          {...ligado("correo")}
        />
        {nombre ? <p className="pista">Reenviar anula el enlace anterior.</p> : null}
      </div>
      <div className="acciones">
        <BotonEnviar>{nombre ? "Reenviar invitación" : "Enviar invitación"}</BotonEnviar>
      </div>
    </form>
  );
}
