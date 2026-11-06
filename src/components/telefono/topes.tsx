import { formatoPesos } from "@/dominio/centavos";
import type { TopeTelefono } from "@/server/telefono/tipos";

export function Topes({ topes }: { topes: TopeTelefono[] }) {
  return (
    <>
      <h1 className="solo-lector">Tus topes</h1>
      {topes.length === 0 ? (
        <div className="vacio"><p className="vacio-titulo">Sin categorías</p><p>Quien administra la empresa todavía no las crea.</p></div>
      ) : (
        <dl className="topes-app">
          {topes.map((tope) => (
            <div key={tope.id}>
              <dt>{tope.nombre}</dt>
              <dd className={tope.topeCentavos === null ? "tope-ausente" : "tope-monto"}>
                {tope.topeCentavos === null ? "Sin tope escrito" : formatoPesos(tope.topeCentavos)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </>
  );
}
