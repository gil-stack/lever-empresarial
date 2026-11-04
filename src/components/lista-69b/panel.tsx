import { FormularioCargar } from "@/components/lista-69b/formulario-cargar";
import {
  Ausencia,
  EtiquetaMono,
  Frase,
  Hoja,
  Insignia,
  NotaRegla,
  Rejilla,
  Renglon,
  Renglones,
  Vacio,
} from "@/components/sistema";
import type { VistaLista69b } from "@/server/lista-69b";

export function PanelLista69b({ vista }: { vista: VistaLista69b }) {
  return (
    <Rejilla
      principal={<Consulta vista={vista} />}
      lateral={
        <>
          <Archivo vista={vista} />
          {vista.puedeGuardar ? <Carga /> : <NotaRegla>La copia la guarda la plataforma. El administrador de la empresa no la modifica.</NotaRegla>}
        </>
      }
    />
  );
}

function Consulta({ vista }: { vista: VistaLista69b }) {
  return (
    <Hoja id="consulta-69b" titulo="Consulta de un RFC">
      <form method="get" action="/consola/lista-69b">
        <div className="campo">
          <label htmlFor="rfc-proveedor">RFC del proveedor</label>
          <input
            id="rfc-proveedor"
            name="rfc"
            className="entrada-rfc"
            defaultValue={vista.rfcEscrito}
            autoComplete="off"
            spellCheck={false}
            maxLength={40}
            aria-invalid={vista.errorRfc ? true : undefined}
            aria-describedby={vista.errorRfc ? "rfc-proveedor-error rfc-proveedor-pista" : "rfc-proveedor-pista"}
          />
          {vista.errorRfc ? (
            <p className="error-campo" id="rfc-proveedor-error">
              {vista.errorRfc}
            </p>
          ) : null}
          <p className="pista" id="rfc-proveedor-pista">
            Doce o trece caracteres. Consultar no crea al proveedor ni envía un pago.
          </p>
        </div>
        <div className="acciones">
          <button type="submit" className="boton">
            Consultar
          </button>
        </div>
      </form>
      {vista.resultado ? <Resultado vista={vista} /> : null}
    </Hoja>
  );
}

function Archivo({ vista }: { vista: VistaLista69b }) {
  return (
    <Hoja className="hoja-archivo" id="archivo-69b" titulo="Archivo del SAT">
      {vista.fechaTexto ? (
        <Renglones>
          <Renglon etiqueta="Fecha del archivo">{vista.fechaTexto}</Renglon>
          <Renglon etiqueta="Hora de carga">{vista.cargadoTexto}</Renglon>
          <Renglon etiqueta="RFC en el archivo">{vista.contribuyentesTexto}</Renglon>
          <Renglon etiqueta="Esta consulta">{vista.consultaTexto}</Renglon>
        </Renglones>
      ) : (
        <>
          <Vacio titulo="Todavía no hay archivo">
            La fecha aparece cuando el servidor guarda el listado.
          </Vacio>
          <Renglones>
            <Renglon etiqueta="Fecha del archivo">
              <Ausencia>sin fecha</Ausencia>
            </Renglon>
            <Renglon etiqueta="Esta consulta">{vista.consultaTexto}</Renglon>
          </Renglones>
        </>
      )}
    </Hoja>
  );
}

function Carga() {
  return (
    <Hoja id="carga-69b" titulo="Guardar una copia">
      <p className="pista">
        El servidor lee la página de contribuyentes publicados y guarda el listado completo del artículo 69-B, con
        la fecha del archivo. Desde aquí no se sube un archivo ni se envía dinero.
      </p>
      <FormularioCargar />
    </Hoja>
  );
}

function Resultado({ vista }: { vista: VistaLista69b }) {
  const resultado = vista.resultado;
  if (!resultado) return null;
  return (
    <>
      <div className="resultado-69b">
        <EtiquetaMono nombre="RFC">{resultado.rfc}</EtiquetaMono>
        <Frase>{resultado.frase}</Frase>
        {resultado.situaciones.length > 0 ? (
          <ul className="lista-simple">
            {resultado.situaciones.map((situacion) => (
              <li key={situacion}>
                <Insignia tono="aviso">{situacion}</Insignia>
              </li>
            ))}
          </ul>
        ) : resultado.decision.motivo === "fuera_del_listado" ? (
          <Insignia>Fuera de la lista</Insignia>
        ) : null}
        <Renglones>
          <Renglon etiqueta="Fecha del archivo">
            {vista.fechaTexto ?? <Ausencia>sin fecha</Ausencia>}
          </Renglon>
        </Renglones>
      </div>
    </>
  );
}
