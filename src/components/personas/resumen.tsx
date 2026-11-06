import { Metrica, Metricas } from "@/components/sistema";
import { fechaLarga } from "@/dominio/personas";
import type { ResumenPersonas } from "@/server/personas/tipos";

import { dinero } from "./util";

export function ResumenPersonas({ resumen }: { resumen: ResumenPersonas }) {
  return (
    <Metricas etiqueta="Resumen de personas y nómina">
      <Metrica rotulo="Colaboradores vigentes">{resumen.vigentes}</Metrica>
      <Metrica rotulo="Nómina mensual estimada" nota="Planeación con neto vigente">
        {dinero(resumen.nominaMensualCentavos)}
      </Metrica>
      <Metrica
        rotulo="Próxima nómina"
        nota={resumen.proximoPagoEn ? fechaLarga(resumen.proximoPagoEn) : "Sin fecha programada"}
      >
        {resumen.proximoPagoEn ? dinero(resumen.proximoPagoCentavos) : "—"}
      </Metrica>
      <Metrica rotulo="Por configurar" nota={resumen.porConfigurar ? "Falta nómina" : "Todo al día"}>
        {resumen.porConfigurar}
      </Metrica>
    </Metricas>
  );
}
