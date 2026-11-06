"use client";

import { useActionState } from "react";

import { entrarOperacion } from "@/app/operacion/acciones-autenticacion";
import { ENTRADA_INICIAL } from "@/app/sesion/estado";
import { CampoContrasena } from "@/components/sistema/campo-contrasena";

/** La puerta SOFIPO. `aviso` llega por la URL cuando otra pantalla manda de regreso (entrada vencida o agotada). */
export function FormularioEntrarOperacion({ aviso }: { aviso: string | null }) {
  const [estado, accion, pendiente] = useActionState(entrarOperacion, ENTRADA_INICIAL);
  const invalido = estado.tipo === "invalido";
  const mensaje = invalido ? estado.mensaje : aviso;
  // El aviso de una entrada fallida es de los dos campos.
  const ligado = mensaje ? ({ "aria-invalid": true, "aria-describedby": "entrar-error" } as const) : {};

  return (
    <form className="alta-formulario" action={accion}>
      {mensaje ? (
        <div className="alerta" role="alert" id="entrar-error">
          <p>{mensaje}</p>
        </div>
      ) : null}
      <div className="campo">
        <label htmlFor="correo">Correo</label>
        <input
          id="correo"
          name="correo"
          type="email"
          autoComplete="username"
          maxLength={254}
          defaultValue={invalido ? estado.correo : undefined}
          required
          {...ligado}
        />
      </div>
      <div className="campo">
        <label htmlFor="contrasena">Contraseña</label>
        <CampoContrasena id="contrasena" name="contrasena" autoComplete="current-password" required {...ligado} />
      </div>
      <div className="acciones">
        <button className="boton" type="submit" disabled={pendiente} aria-busy={pendiente}>
          {pendiente ? "Comprobando…" : "Continuar"}
        </button>
      </div>
    </form>
  );
}
