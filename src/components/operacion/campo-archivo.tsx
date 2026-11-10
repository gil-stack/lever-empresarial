"use client";

import { useState, type ReactNode } from "react";

import { TOPE_ARCHIVO_BYTES } from "@/dominio/archivos";

/**
 * Campo de archivo que revisa el tamaño en el navegador antes de enviar: un archivo
 * que pasa del tope no sale (la plataforma lo cortaría antes de llegar a la acción).
 * El aviso queda ligado al campo y el formulario no se envía mientras siga marcado.
 * El mensaje del error va entre la etiqueta y el control, como en los demás campos de Operación.
 */
export function CampoArchivo({
  id,
  name,
  accept,
  mensaje,
  required = false,
  ligado = {},
  mensajeDelServidor = null,
  nota,
}: {
  id: string;
  name: string;
  accept: string;
  mensaje: string;
  required?: boolean;
  /** El error que devolvió el servidor para este campo (errorDelCampo) y su mensaje (MensajeDelCampo). */
  ligado?: Record<string, unknown>;
  mensajeDelServidor?: ReactNode;
  /** Tras un rechazo, el archivo no vuelve (el navegador no deja rellenar este campo): lo dice esta nota. */
  nota?: string;
}) {
  const [excede, setExcede] = useState(false);
  const delServidor = typeof ligado["aria-describedby"] === "string" ? ligado["aria-describedby"] : undefined;
  const descripcion = [excede ? `${id}-error` : delServidor, nota ? `${id}-nota` : undefined].filter(Boolean).join(" ");
  return (
    <>
      {/* El archivo que elige ahora reemplaza al que rechazó el servidor: queda un solo mensaje. */}
      {excede ? (
        <p id={`${id}-error`} className="error-campo error-antes-del-control" role="alert">
          {mensaje}
        </p>
      ) : (
        mensajeDelServidor
      )}
      <input
        id={id}
        name={name}
        type="file"
        accept={accept}
        required={required}
        aria-invalid={excede || ligado["aria-invalid"] === true ? true : undefined}
        aria-describedby={descripcion || undefined}
        // Con el error del servidor, el foco llega a este control, como en los demás campos de Operación (errorDelCampo).
        autoFocus={ligado.autoFocus === true ? true : undefined}
        onChange={(evento) => {
          const archivo = evento.currentTarget.files?.[0];
          const grande = archivo !== undefined && archivo.size > TOPE_ARCHIVO_BYTES;
          evento.currentTarget.setCustomValidity(grande ? mensaje : "");
          setExcede(grande);
        }}
      />
      {nota ? (
        <p id={`${id}-nota`} className="pista">
          {nota}
        </p>
      ) : null}
    </>
  );
}
