import { CabezaPagina, Hoja, Insignia, Renglon, Renglones, Vacio } from "@/components/sistema";
import type { LecturaMaestro } from "@/server/personas/tipos";

import { FormularioArea } from "./formulario-area";
import { NavegacionPersonas } from "./navegacion";
import { dinero } from "./util";

export function AreasPersonas({
  lectura,
  empresaId,
  edita,
}: {
  lectura: LecturaMaestro;
  empresaId: string;
  edita: boolean;
}) {
  return (
    <>
      <CabezaPagina kicker="Personas" titulo="Áreas y presupuestos">
        <p className="lede">La nómina y las bolsas individuales se comparan contra la planeación mensual de cada área.</p>
      </CabezaPagina>
      <NavegacionPersonas actual="areas" empresaId={empresaId} />
      <p className="nota-regla">Comprometido = nómina mensual estimada + presupuestos individuales. Es planeación, no gasto real.</p>

      <div className="areas-rejilla">
        {edita ? (
          <Hoja id="nueva-area" titulo="Nueva área" className="area-nueva">
            <FormularioArea />
          </Hoja>
        ) : null}
        {lectura.areas.length === 0 ? (
          <Vacio titulo="Todavía no hay áreas">Crea la primera para poder dar de alta colaboradores.</Vacio>
        ) : lectura.areas.map((area) => (
          <Hoja key={area.id} id={`area-${area.id}`} titulo={area.nombre} className="area-tarjeta">
            <div className="area-cabeza">
              <div>
                <p className="area-cifra">{dinero(area.presupuestoCentavos)}</p>
                <p className="pista">Presupuesto mensual</p>
              </div>
              {area.esTesoreria ? <Insignia tono="sello">Tesorería</Insignia> : <Insignia>Área</Insignia>}
            </div>
            <Renglones dinero>
              <Renglon etiqueta="Colaboradores vigentes">{area.personas}</Renglon>
              <Renglon etiqueta="Nómina mensual estimada">{dinero(area.nominaMensualCentavos)}</Renglon>
              <Renglon etiqueta="Presupuestos individuales">{dinero(area.presupuestosIndividualesCentavos)}</Renglon>
              <Renglon etiqueta="Disponible para planeación">
                <strong className={area.disponibleCentavos !== null && area.disponibleCentavos < 0 ? "monto-excedido" : undefined}>
                  {dinero(area.disponibleCentavos)}
                </strong>
              </Renglon>
            </Renglones>
            {area.disponibleCentavos !== null && area.disponibleCentavos < 0 ? (
              <p className="area-alerta" role="note">La planeación supera el presupuesto por {dinero(Math.abs(area.disponibleCentavos))}.</p>
            ) : null}
            {edita ? (
              <details className="area-editar">
                <summary>Editar área y presupuesto</summary>
                <FormularioArea area={area} />
              </details>
            ) : null}
          </Hoja>
        ))}
      </div>
    </>
  );
}
