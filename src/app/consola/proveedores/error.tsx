"use client";

import { CabezaPagina } from "@/components/sistema";

/** `retry` vuelve a pedir la mesa al servidor; `reset` solo repintaría el error que ya llegó. */
export default function ErrorProveedores({ retry }: { retry: () => void }) {
  return <main id="contenido" className="pagina pagina-proveedores">
    <CabezaPagina kicker="Proveedores" titulo="No se pudo abrir la mesa de pagos.">
      <p className="lede">Vuelve a intentarlo en un momento.</p>
      <button className="boton" type="button" onClick={retry}>Reintentar</button>
    </CabezaPagina>
  </main>;
}
