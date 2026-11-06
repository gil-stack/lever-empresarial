"use client";

// `retry` vuelve a pedir la página al servidor; `reset` solo repintaría el error que ya llegó.
export default function ErrorTelefono({ retry }: { error: unknown; retry: () => void }) {
  return <main id="contenido" className="superficie-telefono"><div className="telefono"><p className="kicker-app">Teléfono</p><h1>No se pudo abrir esta página.</h1><p className="lede">Vuelve a intentar en un momento.</p><button className="boton" type="button" onClick={retry}>Reintentar</button></div></main>;
}
