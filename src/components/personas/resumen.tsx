import { Metrica, Metricas, Monto } from "@/components/sistema";
import { fechaLarga } from "@/dominio/personas";
import type { ResumenPersonas } from "@/server/personas/tipos";

import { dinero } from "./util";

export function ResumenPersonas({ resumen }: { resumen: ResumenPersonas }) {
  return (
    <Metricas etiqueta="Resumen de personas y nómina">
      <Metrica rotulo="Colaboradores vigentes"><Monto>{resumen.vigentes}</Monto></Metrica>
      <Metrica rotulo="Nómina mensual estimada" nota="Planeación con neto vigente">
        <Monto>{dinero(resumen.nominaMensualCentavos)}</Monto>
      </Metrica>
      <Metrica
        rotulo="Próxima nómina"
        nota={resumen.proximoPagoEn ? fechaLarga(resumen.proximoPagoEn) : "Sin fecha programada"}
      >
        <Monto>{resumen.proximoPagoEn ? dinero(resumen.proximoPagoCentavos) : "—"}</Monto>
      </Metrica>
      <Metrica rotulo="Por configurar" nota={resumen.porConfigurar ? "Falta nómina" : "Todo al día"}>
        <Monto>{resumen.porConfigurar}</Monto>
      </Metrica>
    </Metricas>
  );
}
