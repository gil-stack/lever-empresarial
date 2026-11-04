"use client";

import Link from "next/link";
import { useActionState } from "react";

import { guardarContrasena, pedirEnlace } from "@/app/recuperar/acciones";
import { RECUPERAR_INICIAL, type EstadoRecuperar } from "@/app/recuperar/estado";
import { CampoContrasena } from "@/components/sistema/campo-contrasena";

function Resultado({ estado }: { estado: EstadoRecuperar }) {
  if (estado.tipo === "inicial") return null;
  return (
    <div className={estado.tipo === "asentado" ? "alerta alerta-asentado" : "alerta"} role={estado.tipo === "asentado" ? "status" : "alert"}>
      <p className="alerta-titulo">{estado.titulo}</p>
      <p>{estado.mensaje}</p>
    </div>
  );
}

export function FormularioPedirEnlace() {
  const [estado, accion, pendiente] = useActionState(pedirEnlace, RECUPERAR_INICIAL);
  return (
    <form className="alta-formulario" action={accion} noValidate>
      <Resultado estado={estado} />
      <div className="campo">
        <label htmlFor="correo">Correo</label>
        <input id="correo" name="correo" type="email" autoComplete="username" required maxLength={254} />
      </div>
      <div className="acciones">
        <button type="submit" className="boton" disabled={pendiente}>
          {pendiente ? "Enviando…" : "Enviar el enlace"}
        </button>
        <Link className="enlace-texto" href="/entrar">
          Volver a entrar
        </Link>
      </div>
    </form>
  );
}

export function FormularioNuevaContrasena({ token }: { token: string }) {
  const [estado, accion, pendiente] = useActionState(guardarContrasena, RECUPERAR_INICIAL);
  if (estado.tipo === "asentado") {
    return (
      <div className="alta-formulario">
        <Resultado estado={estado} />
        <Link className="boton" href="/entrar">
          Entrar
        </Link>
      </div>
    );
  }
  return (
    <form className="alta-formulario" action={accion} noValidate>
      <Resultado estado={estado} />
      <input type="hidden" name="token" value={token} />
      <div className="campo">
        <label htmlFor="contrasena">Contraseña nueva</label>
        <CampoContrasena id="contrasena" name="contrasena" autoComplete="new-password" required minLength={10} />
      </div>
      <div className="campo">
        <label htmlFor="confirmacion">Otra vez</label>
        <CampoContrasena id="confirmacion" name="confirmacion" autoComplete="new-password" required minLength={10} />
      </div>
      <p className="pista">Tu segundo factor no cambia. Al entrar te lo pedimos.</p>
      <button type="submit" className="boton" disabled={pendiente}>
        {pendiente ? "Guardando…" : "Guardar la contraseña"}
      </button>
    </form>
  );
}
