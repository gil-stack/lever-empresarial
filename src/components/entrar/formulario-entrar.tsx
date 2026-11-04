"use client";

import Link from "next/link";
import { useActionState } from "react";

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
        <input id="correo" name="correo" type="email" autoComplete="username" maxLength={254} placeholder="nombre@empresa.com" required />
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
          {pendiente ? "Comprobando…" : "Continuar"}
        </button>
      </div>
      <p className="arco-pie">Acceso protegido mediante passkey, aplicación autenticadora o código de respaldo.</p>
    </form>
  );
}
