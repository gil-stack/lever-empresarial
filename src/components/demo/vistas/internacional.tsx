import { IconoInternacional, IconoPendientes } from "@/components/cromo/iconos";
import type { InternacionalDemo } from "@/dominio/demo/internacional";

import { Accion, Cifras, Estado, ID_AVISO_DEMO, pesos, Tarjeta } from "../piezas";

/** plat-08: un pago a un proveedor del extranjero, lo que pasa en contabilidad y los pagos enviados. */
export function VistaInternacional({ datos }: { datos: InternacionalDemo }) {
  const elegido = datos.beneficiarios[datos.elegido];
  return (
    <>
      <Cifras cifras={datos.cifras} etiqueta="Pagos internacionales en cifras" />
      <div className="demo-rejilla demo-g21">
        <Tarjeta id="internacional-nuevo" titulo="Nuevo pago internacional" nota="Desde la cuenta de la empresa · USD, EUR y CAD">
          <fieldset disabled aria-describedby={ID_AVISO_DEMO}>
            <legend className="solo-lector">Proveedor del extranjero (demostración)</legend>
            <div className="demo-opciones">
              {datos.beneficiarios.map((beneficiario, i) => (
                <button key={beneficiario.corto} type="button" className="demo-opcion" disabled aria-pressed={i === datos.elegido}>
                  <b>{beneficiario.corto}</b>
                  <small>
                    {beneficiario.pais} · {beneficiario.moneda} · {beneficiario.via}
                  </small>
                </button>
              ))}
            </div>
          </fieldset>
          <p className="demo-tenue demo-separado">{datos.montoNota}</p>
          <p className="demo-campo-monto" aria-label={`${datos.montoNota}: ${datos.monto}`}>
            <span>{elegido?.moneda}</span>
            {datos.monto}
          </p>
          <dl className="demo-desglose">
            <div>
              <dt>
                <small>Tipo de cambio</small>
              </dt>
              <dd>
                <b>{datos.tipoCambio}</b>
              </dd>
            </div>
            <div>
              <dt>
                <small>{datos.comisionVia}</small>
              </dt>
              <dd>
                <b>{datos.comision}</b>
              </dd>
            </div>
            <div>
              <dt>
                <small>Sale de tu cuenta</small>
              </dt>
              <dd>
                <b>{pesos(datos.saleCentavos)}</b>
              </dd>
            </div>
          </dl>
          <p>
            <b>{datos.factura}</b>
          </p>
          <p className="demo-tenue">{datos.facturaDetalle}</p>
          <Accion accion={{ etiqueta: datos.enviar, tipo: "principal" }} chico={false} icono={<IconoInternacional />} className="demo-boton-ancho" />
        </Tarjeta>
        <Tarjeta id="internacional-contabilidad" titulo="Para tu contabilidad" nota="Lever lo hace solo">
          <ul className="demo-revision">
            {datos.contabilidad.map((punto) => (
              <li key={punto.titulo}>
                <span className="demo-revision-punto" aria-hidden="true">
                  <IconoPendientes />
                </span>
                <div>
                  <b>{punto.titulo}</b>
                  <small>{punto.detalle}</small>
                </div>
              </li>
            ))}
          </ul>
        </Tarjeta>
      </div>
      <Tarjeta id="internacional-enviados" titulo="Pagos enviados" nota="Con su factura y el comprobante del banco">
        <div className="tabla-contenedor" tabIndex={0} role="region" aria-label="Tabla de pagos enviados">
          <table className="tabla">
            <thead>
              <tr>
                <th scope="col">Fecha</th>
                <th scope="col">Proveedor</th>
                <th scope="col" className="derecha">
                  Monto
                </th>
                <th scope="col" className="derecha">
                  En pesos
                </th>
                <th scope="col">Estado</th>
                <th scope="col">
                  <span className="solo-lector">Comprobante</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {datos.enviados.map((pago) => (
                <tr key={pago.proveedor}>
                  <td className="demo-num">{pago.fecha}</td>
                  <td>
                    {pago.proveedor}
                    <small>{pago.detalle}</small>
                  </td>
                  <td className="derecha">{pago.monto}</td>
                  <td className="derecha">
                    {pesos(pago.pesosCentavos)}
                    <small>{pago.tipoCambio}</small>
                  </td>
                  <td>
                    <Estado estado={pago.estado} />
                  </td>
                  <td className="derecha">
                    <Accion accion={{ etiqueta: pago.comprobante, tipo: "secundaria" }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Tarjeta>
      <p className="demo-nota-fina">{datos.nota}</p>
    </>
  );
}
