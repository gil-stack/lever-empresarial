import type { ReactNode } from "react";

import { Aviso } from "@/components/sistema";
import { MENSAJE_RECHAZO, type ErrorCampo, type EstadoMaestro } from "@/dominio/personas";

export function AvisosFormulario({
  estado,
  errores,
  prefijo = "",
}: {
  estado: EstadoMaestro;
  errores: ErrorCampo[];
  prefijo?: string;
}) {
  if (errores.length > 0) {
    return (
      <Aviso titulo="Revisa antes de continuar">
        <ul>
          {errores.map((error) => (
            <li key={`${error.campo}-${error.mensaje}`}>
              <a href={`#${prefijo}${error.campo}`}>{error.mensaje}</a>
            </li>
          ))}
        </ul>
      </Aviso>
    );
  }
  if (estado.tipo === "listo") return <Aviso tono="asentado" titulo="Quedó asentado">{estado.mensaje}</Aviso>;
  if (estado.tipo === "rechazado") {
    const rechazo = MENSAJE_RECHAZO[estado.codigo];
    return <Aviso titulo={rechazo.titulo}>{rechazo.texto}</Aviso>;
  }
  return null;
}

export function CampoFormulario({
  id,
  etiqueta,
  pista,
  error,
  children,
}: {
  id: string;
  etiqueta: string;
  pista?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="campo">
      <label htmlFor={id}>{etiqueta}</label>
      {children}
      {pista ? <p className="pista" id={`${id}-pista`}>{pista}</p> : null}
      {error ? <p className="error-campo" id={`${id}-error`}>{error}</p> : null}
    </div>
  );
}

export function descritoPor(id: string, error?: string, pista = true): string | undefined {
  const ids = [pista ? `${id}-pista` : "", error ? `${id}-error` : ""].filter(Boolean);
  return ids.length > 0 ? ids.join(" ") : undefined;
}
