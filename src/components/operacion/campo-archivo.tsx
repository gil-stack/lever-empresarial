"use client";

import { useState, type ReactNode } from "react";

import { TOPE_ARCHIVO_BYTES } from "@/dominio/archivos";

/**
 * Campo de archivo que revisa el tamaño en el navegador antes de enviar: un archivo
 * que pasa del tope no sale (la plataforma lo cortaría antes de llegar a la acción).
 * El aviso queda ligado al campo y el formulario no se envía mientras siga marcado.
 */
export function CampoArchivo({
  id,
  name,
  accept,
  mensaje,
  required = false,
  ligado = {},
  mensajeDelServidor = null,
}: {
  id: string;
  name: string;
  accept: string;
  mensaje: string;
  required?: boolean;
  /** El error que devolvió el servidor para este campo (errorDelCampo) y su mensaje (MensajeDelCampo). */
  ligado?: Record<string, unknown>;
  mensajeDelServidor?: ReactNode;
}) {
  const [excede, setExcede] = useState(false);
  const delServidor = typeof ligado["aria-describedby"] === "string" ? ligado["aria-describedby"] : undefined;
  return (
    <>
      <input
        id={id}
        name={name}
        type="file"
        accept={accept}
        required={required}
        aria-invalid={excede || ligado["aria-invalid"] === true ? true : undefined}
        aria-describedby={excede ? `${id}-error` : delServidor}
        // Con el error del servidor, el foco llega a este control, como en los demás campos de Operación (errorDelCampo).
        autoFocus={ligado.autoFocus === true ? true : undefined}
        onChange={(evento) => {
          const archivo = evento.currentTarget.files?.[0];
          const grande = archivo !== undefined && archivo.size > TOPE_ARCHIVO_BYTES;
          evento.currentTarget.setCustomValidity(grande ? mensaje : "");
          setExcede(grande);
        }}
      />
      {/* El archivo que elige ahora reemplaza al que rechazó el servidor: queda un solo mensaje. */}
      {excede ? (
        <p id={`${id}-error`} className="error-campo" role="alert">
          {mensaje}
        </p>
      ) : (
        mensajeDelServidor
      )}
    </>
  );
}
