import { IconoCredito, IconoCuenta, IconoDescargar } from "@/components/cromo/iconos";
import type { CreditoDemo } from "@/dominio/demo/credito";

import { Accion, Cifras, Estado, ID_AVISO_DEMO, pesos, Renglon, Tarjeta } from "../piezas";

const ICONOS = [<IconoCuenta key="cuenta" />, <IconoCredito key="credito" />, <IconoDescargar key="descargar" />];

/** plat-11: la línea revolvente, el simulador informativo y los pagos programados. */
export function VistaCredito({ datos }: { datos: CreditoDemo }) {
  const simulador = datos.simulador;
  return (
    <>
      <Cifras cifras={datos.cifras} etiqueta="Línea de crédito" />
      <div className="demo-rejilla demo-g2">
        <Tarjeta id="credito-usar" titulo="Usar la línea">
          <ul className="demo-lista">
            {datos.usos.map((uso, i) => (
              <Renglon
                key={uso.titulo}
                icono={ICONOS[i]}
                titulo={uso.titulo}
                detalle={
                  <>
                    {uso.detalle}
                    {uso.porDefinir ? (
                      <>
                        {" "}
                        <span className="demo-por-definir">Por definir</span>
                      </>
                    ) : null}
                  </>
                }
              >
                <Accion accion={uso.accion} />
              </Renglon>
            ))}
          </ul>
        </Tarjeta>
        <Tarjeta id="credito-simulador" titulo="Simulador" nota="Informativo, no es una oferta">
          <p className="demo-tenue">
            Monto · <b>{pesos(simulador.montoCentavos)}</b>
          </p>
          <fieldset disabled aria-describedby={ID_AVISO_DEMO}>
            <legend className="demo-etiqueta-campo">Plazo</legend>
            <div className="demo-chips">
              {simulador.plazos.map((plazo, i) => (
                <button key={plazo} type="button" className="demo-chip" disabled aria-pressed={i === simulador.elegido}>
                  {plazo}
                </button>
              ))}
            </div>
          </fieldset>
          <p className="eyebrow demo-separado">Pago mensual estimado</p>
          <p className="demo-saldo">{pesos(simulador.mensualCentavos)}</p>
          <dl className="renglones renglones-dinero">
            <div>
              <dt>Total a pagar</dt>
              <dd>{pesos(simulador.totalCentavos)}</dd>
            </div>
            <div>
              <dt>Comisión por apertura</dt>
              <dd>{pesos(simulador.comisionCentavos)}</dd>
            </div>
            <div>
              <dt>CAT PROMEDIO</dt>
              <dd>{simulador.cat}</dd>
            </div>
          </dl>
        </Tarjeta>
      </div>
      <h2 className="demo-titulo-seccion">Pagos programados</h2>
      <section className="hoja" aria-label="Pagos programados">
        <div className="tabla-contenedor">
          <table className="tabla">
            <thead>
              <tr>
                <th scope="col">Fecha</th>
                <th scope="col">Concepto</th>
                <th scope="col" className="derecha">
                  Capital
                </th>
                <th scope="col" className="derecha">
                  Intereses
                </th>
                <th scope="col" className="derecha">
                  Total
                </th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              {datos.pagos.map((pago) => (
                <tr key={pago.fecha}>
                  <td className="demo-num">{pago.fecha}</td>
                  <td>{pago.concepto}</td>
                  <td className="derecha">{pesos(pago.capitalCentavos)}</td>
                  <td className="derecha">{pesos(pago.interesesCentavos)}</td>
                  <td className="derecha">{pesos(pago.totalCentavos)}</td>
                  <td>
                    <Estado estado={pago.estado} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="demo-tenue">
          <b>{datos.otorgante}</b>
        </p>
      </section>
      <Tarjeta id="credito-pagar" titulo="Pagar la línea" nota="Desde la cuenta de la empresa">
        <div className="demo-barra-herramientas">
          <div>
            <b>{datos.usado}</b>
            <p className="demo-tenue">{datos.pagarNota}</p>
          </div>
          <span className="demo-empuje" />
          <Accion accion={{ etiqueta: "Pagar o anticipar", tipo: "principal" }} />
        </div>
      </Tarjeta>
    </>
  );
}
