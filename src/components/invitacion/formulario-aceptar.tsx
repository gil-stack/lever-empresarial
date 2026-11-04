"use client";

import { useActionState } from "react";
import Link from "next/link";

import { aceptar } from "@/app/invitacion/acciones";
import { ACEPTAR_INICIAL } from "@/app/invitacion/estado";

export function FormularioAceptar({
  token,
  correo,
  cuentaExistente,
}: {
  token: string;
  correo: string;
  cuentaExistente: boolean;
}) {
  const [estado, accion, pendiente] = useActionState(aceptar, ACEPTAR_INICIAL);

  if (estado.tipo === "asentado") {
    return (
      <div className="alta-formulario">
        <div className="alerta alerta-asentado" role="status">
          <p className="alerta-titulo">{estado.titulo}</p>
          <p>{estado.mensaje}</p>
        </div>
      </div>
    );
  }

  return (
    <form className="alta-formulario" action={accion} noValidate>
      {estado.tipo === "invalido" ? (
        <div className="alerta" role="alert">
          <p className="alerta-titulo">{estado.titulo}</p>
          <p>{estado.mensaje}</p>
        </div>
      ) : null}
      <input type="hidden" name="token" value={token} />
      <div className="campo">
        <label htmlFor="correo">Correo</label>
        <input id="correo" type="email" value={correo} autoComplete="username" readOnly />
      </div>
      {cuentaExistente ? (
        <div className="campo">
          <label htmlFor="contrasena">Tu contraseña</label>
          <input
            id="contrasena"
            name="contrasena"
            type="password"
            autoComplete="current-password"
            required
          />
          <p className="pista">Ya tienes cuenta con este correo. Entra con la contraseña de siempre.</p>
        </div>
      ) : (
        <>
          <div className="campo">
            <label htmlFor="contrasena">Elige tu contraseña</label>
            <input
              id="contrasena"
              name="contrasena"
              type="password"
              autoComplete="new-password"
              minLength={10}
              aria-describedby="contrasena-pista"
              required
            />
            <p className="pista" id="contrasena-pista">
              Al menos 10 caracteres. Solo tú la conoces. Después registras tu segundo factor.
            </p>
          </div>
          <div className="campo">
            <label htmlFor="confirmacion">Escríbela otra vez</label>
            <input
              id="confirmacion"
              name="confirmacion"
              type="password"
              autoComplete="new-password"
              minLength={10}
              required
            />
          </div>
        </>
      )}
      <div className="acciones">
        <button type="submit" className="boton" disabled={pendiente}>
          {pendiente ? "Guardando…" : cuentaExistente ? "Aceptar y seguir" : "Guardar y seguir"}
        </button>
        {cuentaExistente ? (
          <Link className="enlace-texto" href="/recuperar">
            No recuerdo mi contraseña
          </Link>
        ) : null}
      </div>
    </form>
  );
}
