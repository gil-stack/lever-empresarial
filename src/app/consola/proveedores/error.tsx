"use client";

import { CabezaPagina } from "@/components/sistema";

export default function ErrorProveedores({ reset }: { reset: () => void }) {
  return <main id="contenido" className="pagina pagina-proveedores">
    <CabezaPagina kicker="Proveedores" titulo="No se pudo abrir la mesa de pagos.">
      <p className="lede">Vuelve a intentarlo en un momento.</p>
      <button className="boton" type="button" onClick={reset}>Reintentar</button>
    </CabezaPagina>
  </main>;
}
