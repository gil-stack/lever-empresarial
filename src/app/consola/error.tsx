"use client";

import { CabezaPagina, Hoja } from "@/components/sistema";

/**
 * Una página de la consola que no abrió: se dice y se ofrece reintentar, sin mostrar datos a medias.
 * `retry` vuelve a pedir la página al servidor; `reset` solo repintaría el error que ya llegó.
 */
export default function ErrorConsola({ retry }: { error: unknown; retry: () => void }) {
  return (
    <main id="contenido" className="pagina">
      <CabezaPagina kicker="Consola" titulo="No se pudo abrir esta página." />
      <Hoja id="error-consola" titulo="Vuelve a intentar">
        <p className="pista">Si vuelve a pasar, revisa si tu último cambio quedó guardado antes de repetirlo.</p>
        <div className="acciones">
          <button className="boton" type="button" onClick={retry}>
            Reintentar
          </button>
        </div>
      </Hoja>
    </main>
  );
}
