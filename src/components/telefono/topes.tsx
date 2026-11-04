import { formatoPesos } from "@/dominio/centavos";
import type { TopeTelefono } from "@/server/telefono/tipos";

export function Topes({ topes }: { topes: TopeTelefono[] }) {
  return (
    <>
      <p className="kicker-app">Solo lectura</p>
      <h1>Topes</h1>
      <p className="lede">Son los topes escritos en la política de la empresa. Vacío no significa cero.</p>
      {topes.length === 0 ? (
        <div className="vacio"><p className="vacio-titulo">Sin categorías</p><p>La empresa todavía no ha creado categorías.</p></div>
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
