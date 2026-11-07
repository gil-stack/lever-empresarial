"use client";

import Link from "next/link";
import { useActionState } from "react";

import { guardarContrasena, pedirEnlace } from "@/app/recuperar/acciones";
import { RECUPERAR_INICIAL, type EstadoRecuperar } from "@/app/recuperar/estado";
import { BotonEnviar } from "@/components/sistema/boton-enviar";
import { CampoContrasena } from "@/components/sistema/campo-contrasena";

const ID_RESULTADO = "recuperar-resultado";

function Resultado({ estado }: { estado: EstadoRecuperar }) {
  if (estado.tipo === "inicial") return null;
  return (
    <div
      id={ID_RESULTADO}
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
        <input id="correo" name="correo" type="email" autoComplete="username" required maxLength={254} {...ligado(estado)} />
      </div>
      <div className="acciones">
        <BotonEnviar pendiente={pendiente}>Enviar el enlace</BotonEnviar>
      </div>
      <Link className="arco-enlace" href="/entrar">
        Volver a entrar
      </Link>
    </form>
  );
}

export function FormularioNuevaContrasena({ token }: { token: string }) {
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
        <CampoContrasena
          id="contrasena"
          name="contrasena"
          autoComplete="new-password"
          required
          minLength={10}
          aria-describedby={estado.tipo === "invalido" ? `${ID_RESULTADO} contrasena-pista` : "contrasena-pista"}
          aria-invalid={estado.tipo === "invalido" || undefined}
        />
        <p className="pista" id="contrasena-pista">
          Al menos 10 caracteres.
        </p>
      </div>
      <div className="campo">
        <label htmlFor="confirmacion">Repite la contraseña</label>
        <CampoContrasena id="confirmacion" name="confirmacion" autoComplete="new-password" required minLength={10} {...ligado(estado)} />
      </div>
      <div className="acciones">
        <BotonEnviar pendiente={pendiente} enviando="Guardando…">
          Guardar la contraseña
        </BotonEnviar>
      </div>
    </form>
  );
}

/** Un error del formulario se liga a su campo. */
function ligado(estado: EstadoRecuperar) {
  return estado.tipo === "invalido" ? ({ "aria-invalid": true, "aria-describedby": ID_RESULTADO } as const) : {};
}
