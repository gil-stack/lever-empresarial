"use client";

export default function ErrorConsola({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="contenido" className="consola">
      <p className="kicker">Consola</p>
      <h1>No se pudo abrir esta página.</h1>
      <p className="lede">No se muestran datos supuestos. Vuelve a intentar.</p>
      <div className="acciones"><button className="boton" type="button" onClick={reset}>Reintentar</button></div>
    </main>
  );
}
