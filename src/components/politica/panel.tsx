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
        El plazo de la empresa marca los días para pasar de «todavía no» a «ya se pasó» y cuántos
        comprobantes vencidos pausan la tarjeta. Cada persona del maestro puede dejar el suyo, aunque no
        entre a la consola. La categoría no trae tope hasta que la empresa escribe el centavo.
      </p>

      <section className="politica-bloque" aria-labelledby="plazo-titulo">
        <h2 id="plazo-titulo">Plazo de la empresa</h2>
        <p>{frasePlazo(vista.diasComprobante, vista.maxVencidos)}</p>
        <p className="pista">
          La cuenta nace con cinco días y cinco comprobantes vencidos. La pausa de la tarjeta no corre en
          este corte. Cambiar este plazo no reescribe a quien ya tiene el suyo.
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
          Quien no tiene un plazo propio usa el de la empresa. Guardar los mismos números quita el plazo
          propio.
        </p>
        {vista.personas.length === 0 ? (
          <p className="lede">Todavía no hay personas en el maestro.</p>
        ) : (
          vista.personas.map((persona) => (
            <article className="persona" key={persona.personaId}>
              <h3>{persona.nombre}</h3>
              <p className="pista">
                {persona.correo ? `${persona.rolEtiqueta}. ${persona.correo}` : persona.rolEtiqueta}
              </p>
              {persona.propio ? <p>{frasePlazo(persona.diasComprobante, persona.maxVencidos)}</p> : null}
              <p className="pista">
                {persona.propio ? "Escrito para esta persona." : "Usa el plazo de la empresa."}
              </p>
              {vista.puedeEditar ? (
                <FormularioPersona
                  key={`${persona.personaId}-${persona.diasComprobante}-${persona.maxVencidos}-${persona.propio}`}
                  personaId={persona.personaId}
                  dias={persona.diasComprobante}
                  vencidos={persona.maxVencidos}
                  propio={persona.propio}
                />
              ) : null}
            </article>
          ))
        )}
      </section>

      <section className="politica-bloque" aria-labelledby="umbral-titulo">
        <h2 id="umbral-titulo">Umbral de proveedores</h2>
        <p>{fraseUmbral(vista.umbralCentavos)}</p>
        <p className="pista">
          Vacío hasta que la empresa escribe el monto. Escribirlo no libera un pago ni envía un SPEI.
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
          <p className="lede">Todavía no hay categorías.</p>
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
