import { Hoja, Insignia, Monto, NotaRegla, Renglon, Renglones, Vacio } from "@/components/sistema";
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
      <h1 className="solo-lector">Áreas y presupuestos</h1>
      <NavegacionPersonas actual="areas" empresaId={empresaId} />
      <NotaRegla>Cada área compara su presupuesto mensual contra lo comprometido: la nómina mensual estimada más los presupuestos individuales.</NotaRegla>

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
                <Monto>{dinero(area.presupuestoCentavos)}</Monto>
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
