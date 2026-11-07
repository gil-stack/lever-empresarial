"use client";

import { Hoja } from "@/components/sistema";

/**
 * Una sección que no abrió: se dice y se ofrece reintentar, sin mostrar datos a medias.
 * `retry` vuelve a pedir la sección al servidor; `reset` solo repintaría el error que ya llegó.
 */
export default function ErrorOperacion({ retry }: { error: unknown; retry: () => void }) {
  return (
    <main id="contenido" className="pagina operacion-pagina">
      <h1 className="operacion-error-titulo">No se pudo abrir esta sección.</h1>
      <Hoja id="error-operacion" titulo="Vuelve a intentar">
        <p className="pista">Si vuelve a pasar, revisa en la Bitácora si tu última decisión quedó registrada antes de repetirla.</p>
        <div className="acciones">
          <button className="boton" type="button" onClick={retry}>
            Reintentar
          </button>
        </div>
      </Hoja>
    </main>
  );
}
