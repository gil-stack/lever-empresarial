"use client";

import { useActionState } from "react";
import Link from "next/link";

import { guardarContrasena, pedirEnlace } from "@/app/recuperar/acciones";
import { RECUPERAR_INICIAL, type EstadoRecuperar } from "@/app/recuperar/estado";

function Resultado({ estado }: { estado: EstadoRecuperar }) {
  if (estado.tipo === "inicial") return null;
  return (
    <div
      className={estado.tipo === "asentado" ? "alerta alerta-asentado" : "alerta"}
      role={estado.tipo === "asentado" ? "status" : "alert"}
    >
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
        <input id="correo" name="correo" type="email" autoComplete="username" maxLength={254} required />
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

export function FormularioContrasenaNueva({ token }: { token: string }) {
  const [estado, accion, pendiente] = useActionState(guardarContrasena, RECUPERAR_INICIAL);

  if (estado.tipo === "asentado") {
    return (
      <div className="alta-formulario">
        <Resultado estado={estado} />
        <div className="acciones">
          <Link className="boton" href="/entrar">
            Entrar
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form className="alta-formulario" action={accion} noValidate>
      <Resultado estado={estado} />
      <input type="hidden" name="token" value={token} />
      <div className="campo">
        <label htmlFor="contrasena">Contraseña nueva</label>
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
          Al menos 10 caracteres. Al guardarla se cierran tus otras sesiones.
        </p>
      </div>
      <div className="campo">
        <label htmlFor="confirmacion">Escríbela otra vez</label>
        <input id="confirmacion" name="confirmacion" type="password" autoComplete="new-password" required />
      </div>
      <div className="acciones">
        <button type="submit" className="boton" disabled={pendiente}>
          {pendiente ? "Guardando…" : "Guardar contraseña"}
        </button>
      </div>
    </form>
  );
}
