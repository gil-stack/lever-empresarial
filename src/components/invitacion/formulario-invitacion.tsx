"use client";

import { useActionState } from "react";

import { enviarAceptacion } from "@/app/invitacion/acciones";
import { INVITACION_INICIAL } from "@/app/invitacion/estado";

export function FormularioInvitacion({ token, yaTieneContrasena }: { token: string; yaTieneContrasena: boolean }) {
  const [estado, accion, pendiente] = useActionState(enviarAceptacion, INVITACION_INICIAL);

  return (
    <form className="alta-formulario" action={accion} noValidate aria-busy={pendiente}>
      {estado.tipo === "invalido" ? (
        <div className="alerta" role="alert">
          <p className="alerta-titulo">No se aceptó</p>
          <p>{estado.mensaje}</p>
        </div>
      ) : null}
      <input type="hidden" name="token" value={token} />
      <div className="campo">
        <label htmlFor="contrasena">{yaTieneContrasena ? "Tu contraseña" : "Contraseña nueva"}</label>
        <input
          id="contrasena"
          name="contrasena"
          type="password"
          autoComplete={yaTieneContrasena ? "current-password" : "new-password"}
          required
        />
        {yaTieneContrasena ? null : <p className="pista">Al menos 10 caracteres.</p>}
      </div>
      {yaTieneContrasena ? null : (
        <div className="campo">
          <label htmlFor="confirmacion">Repite la contraseña</label>
          <input id="confirmacion" name="confirmacion" type="password" autoComplete="new-password" required />
        </div>
      )}
      <div className="acciones">
        <button type="submit" className="boton" disabled={pendiente}>
          {pendiente ? "Aceptando…" : "Aceptar la invitación"}
        </button>
      </div>
    </form>
  );
}
