"use client";

import { useActionState } from "react";
import Link from "next/link";

import { enviarContrasena } from "@/app/entrar/acciones";
import { ENTRADA_INICIAL } from "@/app/sesion/estado";

export function FormularioEntrar({ siguiente, aviso }: { siguiente: string; aviso: string | null }) {
  const [estado, accion, pendiente] = useActionState(enviarContrasena, ENTRADA_INICIAL);

  return (
    <form className="alta-formulario" action={accion} noValidate>
      {aviso ? (
        <div className="alerta" role="status">
          <p>{aviso}</p>
        </div>
      ) : null}
      {estado.tipo === "invalido" ? (
        <div className="alerta" role="alert">
          <p className="alerta-titulo">No se pudo entrar</p>
          <p>{estado.mensaje}</p>
        </div>
      ) : null}
      <input type="hidden" name="siguiente" value={siguiente} />
      <div className="campo">
        <label htmlFor="correo">Correo</label>
        <input id="correo" name="correo" type="email" autoComplete="username" maxLength={254} required />
      </div>
      <div className="campo">
        <label htmlFor="contrasena">Contraseña</label>
        <input id="contrasena" name="contrasena" type="password" autoComplete="current-password" required />
      </div>
      <div className="acciones">
        <button type="submit" className="boton" disabled={pendiente}>
          {pendiente ? "Comprobando…" : "Continuar"}
        </button>
        <Link className="enlace-texto" href="/">
          Dar de alta la razón social
        </Link>
      </div>
      <p className="arco-pie">Después hace falta una passkey o un código de tu app autenticadora.</p>
    </form>
  );
}
