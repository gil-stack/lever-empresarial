"use client";

import Link from "next/link";
import { useActionState } from "react";

import { enviarEntrada } from "@/app/sesion/acciones";
import { ENTRADA_INICIAL } from "@/app/sesion/estado";

export function FormularioEntrar() {
  const [estado, accion, pendiente] = useActionState(enviarEntrada, ENTRADA_INICIAL);

  return (
    <form className="alta-formulario" action={accion} noValidate>
      {estado.tipo === "invalido" ? (
        <div className="alerta" role="alert">
          <p className="alerta-titulo">No se pudo entrar</p>
          <p>{estado.mensaje}</p>
        </div>
      ) : null}
      <div className="campo">
        <label htmlFor="correo">Correo</label>
        <input id="correo" name="correo" type="email" autoComplete="username" maxLength={254} required />
      </div>
      <div className="campo">
        <label htmlFor="contrasena">Contraseña</label>
        <input id="contrasena" name="contrasena" type="password" autoComplete="current-password" required />
        <p className="pista">
          <Link href="/recuperar">¿Olvidaste tu contraseña?</Link>
        </p>
      </div>
      <div className="acciones">
        <button type="submit" className="boton" disabled={pendiente}>
          {pendiente ? "Entrando…" : "Entrar"}
        </button>
      </div>
    </form>
  );
}
