"use client";

import Link from "next/link";
import { useActionState } from "react";

import { enviarContrasena } from "@/app/entrar/acciones";
import { ENTRADA_INICIAL } from "@/app/sesion/estado";
import { CampoContrasena } from "@/components/sistema/campo-contrasena";

export function FormularioEntrar({ siguiente, aviso }: { siguiente: string; aviso: string | null }) {
  const [estado, accion, pendiente] = useActionState(enviarContrasena, ENTRADA_INICIAL);
  const invalido = estado.tipo === "invalido";
  // El error de la contraseña es de los dos campos: el lector de pantalla lo oye al volver a cualquiera.
  const ligado = invalido ? ({ "aria-invalid": true, "aria-describedby": "entrar-error" } as const) : {};

  return (
    <form className="alta-formulario" action={accion} noValidate>
      {aviso ? (
        <div className="alerta" role="status">
          <p>{aviso}</p>
        </div>
      ) : null}
      {invalido ? (
        <div className="alerta" role="alert" id="entrar-error">
          <p className="alerta-titulo">No se pudo entrar</p>
          <p>{estado.mensaje}</p>
        </div>
      ) : null}
      <input type="hidden" name="siguiente" value={siguiente} />
      <div className="campo">
        <label htmlFor="correo">Correo</label>
        <input
          id="correo"
          name="correo"
          type="email"
          autoComplete="username"
          maxLength={254}
          placeholder="nombre@empresa.com"
          defaultValue={invalido ? estado.correo : undefined}
          required
          {...ligado}
        />
      </div>
      <div className="campo">
        <label htmlFor="contrasena">Contraseña</label>
        <CampoContrasena id="contrasena" name="contrasena" autoComplete="current-password" required {...ligado} />
        <p className="pista">
          <Link href="/recuperar">¿Olvidaste tu contraseña?</Link>
        </p>
      </div>
      <div className="acciones">
        <button type="submit" className="boton" disabled={pendiente} aria-busy={pendiente}>
          {pendiente ? "Comprobando…" : "Continuar"}
        </button>
      </div>
      <p className="arco-pie">Después te pedimos tu passkey, el código de tu app autenticadora o un código de respaldo.</p>
    </form>
  );
}
