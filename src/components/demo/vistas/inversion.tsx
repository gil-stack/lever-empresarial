import { IconoInversion } from "@/components/cromo/iconos";
import type { InversionDemo } from "@/dominio/demo/inversion";

import { Accion, Cifras, DeslizadorApagado, ID_AVISO_DEMO, InterruptorApagado, pesos, pesosRedondos, Renglon, Tarjeta } from "../piezas";

/** plat-12: invertir a plazo fijo y las inversiones vivas. */
export function VistaInversion({ datos }: { datos: InversionDemo }) {
  return (
    <>
      <Cifras cifras={datos.cifras} etiqueta="Inversión en cifras" />
      <div className="demo-rejilla demo-g21">
        <Tarjeta id="inversion-nueva" titulo="Nueva inversión a plazo fijo" nota="El dinero que hoy no usas, trabajando en tu SOFIPO">
          <fieldset disabled aria-describedby={ID_AVISO_DEMO}>
            <legend className="solo-lector">Plazo (demostración)</legend>
            <div className="demo-opciones">
              {datos.plazos.map((plazo, i) => (
                <button key={plazo.dias} type="button" className="demo-opcion" disabled aria-pressed={i === datos.elegido}>
                  <b>{plazo.dias}</b>
                  <small>{plazo.tasa}</small>
                </button>
              ))}
            </div>
          </fieldset>
          <p className="demo-tenue demo-separado">Monto</p>
          <p className="demo-saldo">{pesosRedondos(datos.montoCentavos)}</p>
          <DeslizadorApagado etiqueta="Monto a invertir" valorCentavos={datos.montoCentavos} rango={datos.rango} />
          <dl className="demo-desglose">
            <div>
              <dt>
                <small>{datos.recibes}</small>
              </dt>
              <dd>
                <b>{pesos(datos.recibesCentavos)}</b>
              </dd>
            </div>
            <div>
              <dt>
                <small>Rendimiento</small>
              </dt>
              <dd>
                <b>{pesos(datos.rendimientoCentavos, true)}</b>
              </dd>
            </div>
            <div>
              <dt>
                <small>GAT nominal · GAT real</small>
              </dt>
              <dd>
                <b>{datos.gat}</b>
              </dd>
            </div>
          </dl>
          <div className="demo-barra-herramientas">
            <div>
              <b>{datos.reinvertir.titulo}</b>
              <p className="demo-tenue">{datos.reinvertir.detalle}</p>
            </div>
            <span className="demo-empuje" />
            <InterruptorApagado etiqueta={datos.reinvertir.titulo} encendido={datos.reinvertir.activo} />
          </div>
          <Accion accion={{ etiqueta: datos.invertir, tipo: "principal" }} chico={false} icono={<IconoInversion />} className="demo-boton-ancho" />
        </Tarjeta>
        <Tarjeta id="inversion-vivas" titulo="Tus inversiones" nota="Pagaré con rendimiento liquidable al vencimiento">
          <ul className="demo-lista">
            {datos.vivas.map((inversion) => (
              <Renglon key={inversion.titulo} icono={<IconoInversion />} titulo={inversion.titulo} detalle={inversion.vence}>
                <span className="demo-li-cifra">{inversion.rendimiento}</span>
              </Renglon>
            ))}
          </ul>
        </Tarjeta>
      </div>
      <p className="demo-nota-fina">{datos.nota}</p>
    </>
  );
}
