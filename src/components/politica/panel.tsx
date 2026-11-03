import { Cajones } from "@/components/consola/cajones";
import {
  frasePlazo,
  fraseTope,
  fraseUmbral,
  type VistaPolitica,
} from "@/dominio/politica";
import {
  BotonBorrarCategoria,
  BotonQuitarTope,
  FormularioNuevaCategoria,
  FormularioPersona,
  FormularioPlazo,
  FormularioTope,
  FormularioUmbral,
} from "./formularios";

export function PanelPolitica({ vista }: { vista: VistaPolitica }) {
  return (
    <div className="consola">
      <p className="kicker">Política</p>
      <h1>Política de comprobantes</h1>
      <p className="lede">
        El default de la empresa marca los días para pasar de «todavía no» a «ya se pasó» y cuántos
        comprobantes vencidos pausan la tarjeta. Cada persona puede dejar el suyo. La categoría no trae
        tope hasta que la empresa escribe el centavo.
      </p>

      <section className="politica-bloque" aria-labelledby="default-titulo">
        <h2 id="default-titulo">Default de la empresa</h2>
        <p>{frasePlazo(vista.diasComprobante, vista.maxVencidos)}</p>
        <p className="pista">
          La cuenta nace con cinco días y cinco comprobantes vencidos. La pausa todavía no llega al
          emisor: aquí solo queda el número. Cambiar el default no reescribe a quien ya tiene un plazo
          propio.
        </p>
        {vista.puedeEditar ? (
          <FormularioPlazo
            key={`${vista.diasComprobante}-${vista.maxVencidos}`}
            dias={vista.diasComprobante}
            vencidos={vista.maxVencidos}
          />
        ) : (
          <p className="pista">Tu rol no escribe la política.</p>
        )}
      </section>

      <section className="politica-bloque" aria-labelledby="personas-titulo">
        <h2 id="personas-titulo">Por persona</h2>
        <p className="pista">
          Quien no tiene un plazo propio usa el default de la empresa. Guardar los mismos números que el
          default quita el plazo propio.
        </p>
        {vista.personas.map((persona) => (
          <article className="persona" key={persona.userId}>
            <h3>{persona.nombre}</h3>
            <p className="pista">
              {persona.rolEtiqueta}. {persona.correo}
            </p>
            <p>{frasePlazo(persona.diasComprobante, persona.maxVencidos)}</p>
            <p className="pista">{persona.propio ? "Escrito para esta persona." : "Usa el default de la empresa."}</p>
            {vista.puedeEditar ? (
              <FormularioPersona
                key={`${persona.userId}-${persona.diasComprobante}-${persona.maxVencidos}-${persona.propio}`}
                userId={persona.userId}
                dias={persona.diasComprobante}
                vencidos={persona.maxVencidos}
                propio={persona.propio}
              />
            ) : null}
          </article>
        ))}
      </section>

      <section className="politica-bloque" aria-labelledby="umbral-titulo">
        <h2 id="umbral-titulo">Umbral de proveedores</h2>
        <p>{fraseUmbral(vista.umbralCentavos)}</p>
        <p className="pista">
          Vacío hasta que la empresa escribe el monto. No hay una cifra de ejemplo. Escribirlo no libera un
          pago ni envía un SPEI.
        </p>
        {vista.puedeEditar ? <FormularioUmbral escrito={vista.umbralCentavos !== null} /> : null}
      </section>

      <section className="politica-bloque" aria-labelledby="categorias-titulo">
        <h2 id="categorias-titulo">Categorías</h2>
        <p className="pista">
          Sin tope escrito, la categoría no alcanza para emitir una tarjeta. Cero, si se escribe, es un
          tope. El plástico no sale en este corte.
        </p>
        {vista.categorias.length === 0 ? (
          <div className="vacio">
            <p className="vacio-titulo">Sin categorías</p>
            <p>No hay una tabla de ejemplo. El tope nace vacío.</p>
          </div>
        ) : (
          vista.categorias.map((categoria) => (
            <article className="categoria" key={categoria.id}>
              <h3>{categoria.nombre}</h3>
              <p>{fraseTope(categoria.topeCentavos)}</p>
              {vista.puedeEditar ? (
                <>
                  <FormularioTope
                    key={`${categoria.id}-${categoria.topeCentavos ?? "vacio"}`}
                    categoriaId={categoria.id}
                  />
                  {categoria.topeCentavos !== null ? <BotonQuitarTope categoriaId={categoria.id} /> : null}
                  <BotonBorrarCategoria categoriaId={categoria.id} />
                </>
              ) : null}
            </article>
          ))
        )}
        {vista.puedeEditar ? <FormularioNuevaCategoria /> : null}
      </section>

      <Cajones vista={vista} enlace={false} />
    </div>
  );
}
