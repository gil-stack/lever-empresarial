import Link from "next/link";

import { decidirActivacionAccion, decidirComisionAccion } from "@/app/operacion/acciones";
import { Bandeja, Vacio, type Decision } from "@/components/sistema";
import { textoComision } from "@/dominio/operacion";
import type { listarComisiones, listarSolicitudesActivacion } from "@/server/operacion";

import { fechaDia, fechaHora } from "./formato";
import { IconoActivacion, IconoComisiones } from "./iconos";
import { RechazarConMotivo } from "./rechazar";

type Solicitud = Awaited<ReturnType<typeof listarSolicitudesActivacion>>[number];
type Comision = Awaited<ReturnType<typeof listarComisiones>>[number];

/**
 * «Necesita tu decisión» de Operación: activaciones para el portal y versiones de comisión
 * pendientes. Aprobar va directo; rechazar pide el motivo. Lo que pidió la misma persona
 * se ve, pero sin botones: lo decide otra.
 */
export function DecisionesOperacion({
  solicitudes,
  comisiones,
  personaId,
}: {
  solicitudes: Solicitud[];
  comisiones: Comision[];
  personaId: string;
}) {
  const decisiones: Decision[] = [
    ...solicitudes.map((solicitud) => ({
      id: solicitud.id,
      titulo: `Activación · ${solicitud.razonSocial}`,
      icono: <IconoActivacion />,
      detalle: (
        <>
          <Link href={`/operacion/clientes/${solicitud.companyId}`}>{solicitud.razonSocial}</Link> · RFC {solicitud.rfc}
        </>
      ),
      contexto: [`Pidió ${solicitud.solicitante}`, fechaHora(solicitud.solicitadaEn)],
      acciones:
        solicitud.solicitadaPor === personaId ? (
          <p className="pista">La pediste tú: decide otra persona.</p>
        ) : (
          <Acciones
            id={solicitud.id}
            accion={decidirActivacionAccion}
            que={`la activación de ${solicitud.razonSocial}`}
          />
        ),
    })),
    ...comisiones.map((comision) => ({
      id: comision.id,
      titulo: `Comisión · ${comision.razonSocial}`,
      icono: <IconoComisiones />,
      detalle: textoComision(comision.tipo, comision.valor),
      contexto: [`Desde ${fechaDia(comision.vigenteDesde)}`, `Propuso ${comision.solicitante}`],
      acciones:
        comision.solicitadaPor === personaId ? (
          <p className="pista">La propusiste tú: decide otra persona.</p>
        ) : (
          <Acciones
            id={comision.id}
            accion={decidirComisionAccion}
            que={`la comisión de ${comision.tipo} de ${comision.razonSocial}`}
          />
        ),
    })),
  ];
  return (
    <Bandeja
      decisiones={decisiones}
      vacio={<Vacio titulo="Nada por decidir">Las activaciones y las comisiones que pida otra persona aparecen aquí.</Vacio>}
    />
  );
}

function Acciones({ id, accion, que }: { id: string; accion: (formData: FormData) => Promise<void>; que: string }) {
  return (
    <>
      <RechazarConMotivo id={id} accion={accion} que={que} />
      <form action={accion}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="decision" value="aprobar" />
        <button type="submit" className="boton" data-atajo="aprobar">
          Aprobar
        </button>
      </form>
    </>
  );
}
