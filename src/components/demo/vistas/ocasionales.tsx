import { IconoAhorro, IconoMas, IconoPersonas, IconoVehiculo, IconoViajes } from "@/components/cromo/iconos";
import { BarraAvance } from "@/components/sistema";
import type { AhorroDemo } from "@/dominio/demo/ahorro";
import type { GasolinaDemo } from "@/dominio/demo/gasolina";
import type { ViajesDemo } from "@/dominio/demo/viajes";

import { Accion, Cifras, ID_AVISO_DEMO, InterruptorApagado, pesos, pesosRedondos, Renglon, Tarjeta } from "../piezas";

/** plat-13: viajes, eventos y proyectos con presupuesto y tope por día. */
export function VistaViajes({ datos }: { datos: ViajesDemo }) {
  return (
    <>
      <div className="demo-barra-herramientas">
        <p className="demo-intro">{datos.intro}</p>
        <span className="demo-empuje" />
        <Accion accion={{ etiqueta: "Nuevo viaje o proyecto", tipo: "principal" }} chico={false} icono={<IconoMas />} />
      </div>
      <div className="demo-rejilla demo-g3">
        {datos.grupos.map((grupo, i) => (
          <section key={grupo.nombre} className="hoja demo-grupo" aria-labelledby={`viaje-${i}`}>
            <div className="demo-grupo-cabeza">
              <span className="demo-li-icono" aria-hidden="true">
                {grupo.icono === "personas" ? <IconoPersonas /> : <IconoViajes />}
              </span>
              <div>
                <b id={`viaje-${i}`}>{grupo.nombre}</b>
                <small>
                  {grupo.tipo} · {grupo.fechas}
                </small>
              </div>
              <span className="insignia insignia-sello">{grupo.estado}</span>
            </div>
            <div className="demo-grupo-gasto">
              <div>
                <b>{pesosRedondos(grupo.gastadoCentavos)}</b>
                <span className="demo-tenue">de {pesosRedondos(grupo.presupuestoCentavos)}</span>
              </div>
              <BarraAvance valor={grupo.gastadoCentavos} tope={grupo.presupuestoCentavos} etiqueta={`${grupo.nombre}: gastado contra presupuesto`} />
            </div>
            <div className="demo-grupo-pie">
              <span className="demo-iniciales-grupo" aria-hidden="true">
                {grupo.iniciales.map((inicial) => (
                  <span key={inicial} className="demo-iniciales">
                    {inicial}
                  </span>
                ))}
              </span>
              <span>
                {grupo.detalle}
                {grupo.solicitudes > 0 ? (
                  <>
                    {" · "}
                    <em>
                      {grupo.solicitudes} {grupo.solicitudes === 1 ? "solicitud" : "solicitudes"}
                    </em>
                  </>
                ) : null}
              </span>
            </div>
          </section>
        ))}
      </div>
      <p className="demo-nota-fina">{datos.resumen}</p>
    </>
  );
}

/** plat-14: litros, rendimiento, reglas de las tarjetas de gasolina y cada carga revisada. */
export function VistaGasolina({ datos }: { datos: GasolinaDemo }) {
  return (
    <>
      <Cifras cifras={datos.cifras} etiqueta="Gasolina de octubre" />
      <div className="demo-rejilla demo-g2">
        <Tarjeta id="gasolina-vehiculos" titulo="Vehículos" nota="Cada tarjeta ligada a una placa">
          <ul className="demo-lista">
            {datos.vehiculos.map((vehiculo) => (
              <Renglon key={vehiculo.nombre} icono={<IconoVehiculo />} titulo={vehiculo.nombre} detalle={vehiculo.detalle}>
                {vehiculo.litrosMes ? (
                  <span className="insignia insignia-sello">{vehiculo.litrosMes}</span>
                ) : (
                  <Accion accion={{ etiqueta: "Emitir tarjeta de gasolina", tipo: "secundaria" }} />
                )}
              </Renglon>
            ))}
          </ul>
        </Tarjeta>
        <Tarjeta id="gasolina-reglas" titulo="Reglas de las tarjetas de gasolina" nota="La app y la terminal las aplican al cargar">
          <fieldset disabled aria-describedby={ID_AVISO_DEMO}>
            <legend className="solo-lector">Reglas (demostración)</legend>
            <div className="demo-limites">
              {datos.limites.map((limite, i) => (
                <div className="campo" key={limite.rotulo}>
                  <label htmlFor={`gasolina-limite-${i}`}>{limite.rotulo}</label>
                  <input id={`gasolina-limite-${i}`} type="text" inputMode="numeric" defaultValue={limite.valor} readOnly />
                </div>
              ))}
            </div>
            <p className="demo-etiqueta-campo demo-separado">Combustible permitido</p>
            <div className="demo-chips">
              {datos.combustibles.map((combustible) => (
                <button key={combustible.nombre} type="button" className="demo-chip" disabled aria-pressed={combustible.permitido}>
                  {combustible.nombre}
                </button>
              ))}
            </div>
            <p className="demo-etiqueta-campo demo-separado">Estaciones permitidas</p>
            <div className="demo-chips">
              {datos.estaciones.map((estacion) => (
                <button key={estacion.nombre} type="button" className="demo-chip" disabled aria-pressed={estacion.permitido}>
                  {estacion.nombre}
                </button>
              ))}
            </div>
          </fieldset>
          <ul className="demo-lista demo-separado">
            {datos.reglas.map((regla) => (
              <li className="demo-li" key={regla.titulo}>
                <div className="demo-li-texto">
                  <b>{regla.titulo}</b>
                  {regla.detalle ? <small>{regla.detalle}</small> : null}
                </div>
                <InterruptorApagado etiqueta={regla.titulo} encendido={regla.activa} />
              </li>
            ))}
          </ul>
        </Tarjeta>
      </div>
      <Tarjeta id="gasolina-cargas" titulo="Cargas" nota={datos.alertasDelMes}>
        <div className="tabla-contenedor" tabIndex={0} role="region" aria-label="Tabla de cargas de gasolina">
          <table className="tabla">
            <thead>
              <tr>
                <th scope="col">Fecha</th>
                <th scope="col">Vehículo</th>
                <th scope="col">Estación</th>
                <th scope="col" className="derecha">
                  Litros
                </th>
                <th scope="col" className="derecha">
                  Monto
                </th>
                <th scope="col" className="derecha">
                  Km/l
                </th>
                <th scope="col">Revisión</th>
              </tr>
            </thead>
            <tbody>
              {datos.cargas.map((carga) => (
                <tr key={`${carga.fecha}-${carga.hora}`}>
                  <td className="demo-num">
                    {carga.fecha}
                    <small>{carga.hora}</small>
                  </td>
                  <td>
                    <b>{carga.placa}</b>
                    <small>{carga.odometro}</small>
                  </td>
                  <td>
                    {carga.estacion}
                    <small>{carga.lugar}</small>
                  </td>
                  <td className="derecha">{carga.litros}</td>
                  <td className="derecha">{pesos(-carga.centavos)}</td>
                  <td className="derecha">{carga.rendimiento}</td>
                  <td>
                    {carga.alertas.length === 0 ? (
                      <span className="insignia insignia-sello">En orden</span>
                    ) : (
                      carga.alertas.map((alerta) => (
                        <span key={alerta} className="insignia demo-insignia-ambar demo-alerta-carga">
                          {alerta}
                        </span>
                      ))
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Tarjeta>
    </>
  );
}

/** plat-15: suscripciones y gastos que se pueden recortar. */
export function VistaAhorro({ datos }: { datos: AhorroDemo }) {
  return (
    <>
      <section className="demo-hero demo-hero-solo" aria-labelledby="ahorro-total">
        <div>
          <p className="eyebrow" id="ahorro-total">
            Ahorro posible al mes
          </p>
          <p className="demo-hero-cifra">{datos.total}</p>
          <p className="demo-hero-pie">
            <span>{datos.resumen}</span>
          </p>
        </div>
      </section>
      <section className="hoja" aria-label="Oportunidades de ahorro">
        <ul className="demo-lista">
          {datos.oportunidades.map((oportunidad) => (
            <Renglon key={oportunidad.titulo} icono={<IconoAhorro />} titulo={oportunidad.titulo} detalle={oportunidad.detalle}>
              <Accion accion={oportunidad.accion} />
            </Renglon>
          ))}
        </ul>
      </section>
      <p className="demo-tenue demo-separado">{datos.nota}</p>
    </>
  );
}
