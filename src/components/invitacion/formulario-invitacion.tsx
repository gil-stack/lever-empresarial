"use client";

import { useActionState } from "react";

import { enviarAceptacion } from "@/app/invitacion/acciones";
import { INVITACION_INICIAL } from "@/app/invitacion/estado";
import { BotonEnviar } from "@/components/sistema/boton-enviar";
import { CampoContrasena } from "@/components/sistema/campo-contrasena";

export function FormularioInvitacion({ token, yaTieneContrasena }: { token: string; yaTieneContrasena: boolean }) {
  const [estado, accion, pendiente] = useActionState(enviarAceptacion, INVITACION_INICIAL);
  // Solo un rechazo de lo escrito marca los campos; los demás (empresa suspendida, invitación vencida) van en el aviso.
  const ligado =
    estado.tipo === "invalido" && estado.deLaContrasena ? ({ "aria-invalid": true, "aria-describedby": "invitacion-error" } as const) : {};

  return (
    <form className="alta-formulario" action={accion} noValidate aria-busy={pendiente}>
      {estado.tipo === "invalido" ? (
        <div className="alerta" role="alert" id="invitacion-error">
          <p className="alerta-titulo">{estado.titulo}</p>
          <p>{estado.mensaje}</p>
        </div>
      ) : null}
      <input type="hidden" name="token" value={token} />
      <div className="campo">
        <label htmlFor="contrasena">{yaTieneContrasena ? "Tu contraseña" : "Contraseña nueva"}</label>
        <CampoContrasena
          id="contrasena"
          name="contrasena"
          autoComplete={yaTieneContrasena ? "current-password" : "new-password"}
          required
          {...ligado}
        />
        {yaTieneContrasena ? null : <p className="pista">Al menos 10 caracteres. Nadie más la conoce.</p>}
      </div>
      {yaTieneContrasena ? null : (
        <div className="campo">
          <label htmlFor="confirmacion">Repite la contraseña</label>
          <CampoContrasena id="confirmacion" name="confirmacion" autoComplete="new-password" required {...ligado} />
        </div>
      )}
      <div className="acciones">
        <BotonEnviar pendiente={pendiente} enviando="Aceptando…">
          Aceptar la invitación
        </BotonEnviar>
      </div>
    </form>
  );
}
