"use client";

export default function ErrorTelefono({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main id="contenido" className="superficie-telefono"><div className="telefono"><p className="kicker-app">Teléfono</p><h1>No se pudo abrir esta página.</h1><p className="lede">No se muestran datos supuestos.</p><button className="boton" type="button" onClick={reset}>Reintentar</button></div></main>;
}
