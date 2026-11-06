"use client";

import { CabezaPagina } from "@/components/sistema";

export default function ErrorProveedores({ reset }: { reset: () => void }) {
  return <main id="contenido" className="pagina pagina-proveedores">
    <CabezaPagina kicker="Pagos a proveedores" titulo="No se pudo abrir la mesa de trabajo.">
      <p className="lede">No se mostraron importes, documentos ni datos de proveedores. Vuelve a intentarlo.</p>
      <button className="boton" type="button" onClick={reset}>Reintentar</button>
    </CabezaPagina>
  </main>;
}
