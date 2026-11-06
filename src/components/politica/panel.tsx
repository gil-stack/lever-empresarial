import { Cajones } from "@/components/consola/cajones";
import { Metrica, Metricas, Monto, NotaRegla, Vacio } from "@/components/sistema";
import { formatoPesos } from "@/dominio/centavos";
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
  const sinTope = vista.categorias.filter((categoria) => categoria.topeCentavos === null).length;
  const propios = vista.personas.filter((persona) => persona.propio).length;
  return (
    <div className="consola politica">
      <h1 className="solo-lector">Política de comprobantes</h1>
      <Metricas etiqueta="Resumen de la política">
        <Metrica rotulo="Plazo de comprobantes" nota="Para pasar de «todavía no» a «ya se pasó»">
          <Monto>{vista.diasComprobante === 1 ? "1 día" : `${vista.diasComprobante} días`}</Monto>
        </Metrica>
        <Metrica rotulo="Vencidos antes de pausar" nota="Comprobantes por persona">
          <Monto>{vista.maxVencidos}</Monto>
        </Metrica>
        <Metrica rotulo="Umbral de proveedores" nota={vista.umbralCentavos === null ? "Sin monto escrito" : "Monto escrito"}>
          <Monto>{vista.umbralCentavos === null ? "—" : formatoPesos(vista.umbralCentavos)}</Monto>
        </Metrica>
        <Metrica rotulo="Categorías" nota={vista.categorias.length === 0 ? "Ninguna todavía" : sinTope ? `${sinTope} sin tope escrito` : "Todas con tope"}>
          <Monto>{vista.categorias.length}</Monto>
        </Metrica>
      </Metricas>
      {vista.puedeEditar ? null : <p className="pista politica-rol">Tu rol consulta la política; no la edita.</p>}

      <div className="politica-rejilla">
        <section className="panel" aria-labelledby="plazo-titulo">
          <div className="panel-cabeza">
            <h2 id="plazo-titulo">Plazo de la empresa</h2>
          </div>
          <p className="politica-frase">{frasePlazo(vista.diasComprobante, vista.maxVencidos)}</p>
          <p className="pista">Cambiarlo no toca a quien ya tiene un plazo propio.</p>
          {vista.puedeEditar ? (
            // Sin `key` por valor: al guardar, la forma se queda y muestra que quedó.
            <FormularioPlazo dias={vista.diasComprobante} vencidos={vista.maxVencidos} />
          ) : null}
        </section>

        <section className="panel" aria-labelledby="umbral-titulo">
          <div className="panel-cabeza">
            <h2 id="umbral-titulo">Umbral de proveedores</h2>
          </div>
          <p className="politica-frase">{fraseUmbral(vista.umbralCentavos)}</p>
          {vista.puedeEditar ? <FormularioUmbral escrito={vista.umbralCentavos !== null} /> : null}
        </section>
      </div>

      <section className="panel" aria-labelledby="personas-titulo">
        <div className="panel-cabeza">
          <h2 id="personas-titulo">Por persona</h2>
          <small>{propios === 1 ? "1 con plazo propio" : `${propios} con plazo propio`}</small>
        </div>
        <p className="pista">Quien no tiene un plazo propio usa el de la empresa. Guardar los mismos números quita el plazo propio.</p>
        {vista.personas.length === 0 ? (
          <Vacio titulo="Todavía no hay personas">Cuando des de alta a alguien en Personas, aquí podrás darle su propio plazo.</Vacio>
        ) : (
          vista.personas.map((persona) => (
            <article className="persona" key={persona.personaId}>
              <h3>{persona.nombre}</h3>
              <p className="pista">
                {persona.correo ? `${persona.rolEtiqueta}. ${persona.correo}` : persona.rolEtiqueta}
              </p>
              <p>{persona.propio ? frasePlazo(persona.diasComprobante, persona.maxVencidos) : "Usa el plazo de la empresa."}</p>
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

      <section className="panel" aria-labelledby="categorias-titulo">
        <div className="panel-cabeza">
          <h2 id="categorias-titulo">Categorías</h2>
          <small>{vista.categorias.length === 1 ? "1 categoría" : `${vista.categorias.length} categorías`}</small>
        </div>
        <p className="pista">Sin tope escrito, la categoría no alcanza para emitir una tarjeta. Cero también es un tope.</p>
        {vista.categorias.length === 0 ? (
          <Vacio titulo="Todavía no hay categorías">Crea la primera con su tope.</Vacio>
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

      <Cajones vista={vista} />
      <NotaRegla>Las tarjetas todavía no se emiten desde Lever: el plazo, la pausa y los topes quedan escritos para cuando salgan.</NotaRegla>
    </div>
  );
}
