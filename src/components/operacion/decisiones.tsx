import Link from "next/link";

import { decidirActivacionAccion, decidirComisionAccion } from "@/app/operacion/acciones";
import { decidirSuspensionAccion } from "@/app/operacion/acciones-alta";
import { Bandeja, BotonEnviar, Vacio, type Decision } from "@/components/sistema";
import { textoComision } from "@/dominio/operacion";
import type { listarComisiones, listarSolicitudesActivacion, listarSuspensionesPendientes } from "@/server/operacion";

import { fechaDia, fechaHora } from "./formato";
import { IconoActivacion, IconoComisiones, IconoSuspension } from "./iconos";
import { RechazarConMotivo } from "./rechazar";

type Solicitud = Awaited<ReturnType<typeof listarSolicitudesActivacion>>[number];
type Comision = Awaited<ReturnType<typeof listarComisiones>>[number];
type Suspension = Awaited<ReturnType<typeof listarSuspensionesPendientes>>[number];

/** Qué decide esta persona: cada tipo de decisión tiene su rol (Ola R1). */
export type QuienDecide = { activaciones: boolean; comisiones: boolean; suspensiones: boolean };

/**
 * «Necesita tu decisión» de Operación: activaciones para el portal, versiones de comisión y
 * suspensiones o reactivaciones pendientes. Aprobar va directo; rechazar pide el motivo. Lo que
 * pidió la misma persona se ve, pero sin botones: lo decide otra. Sin el rol, tampoco hay botones.
 */
export function DecisionesOperacion({
  solicitudes,
  comisiones,
  suspensiones = [],
  personaId,
  decide,
}: {
  solicitudes: Solicitud[];
  comisiones: Comision[];
  suspensiones?: Suspension[];
  personaId: string;
  decide: QuienDecide;
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
        ) : !decide.activaciones ? (
          <p className="pista">La decide alguien con rol de Aprobación.</p>
        ) : (
          <Acciones
            id={solicitud.id}
            tipo="activacion"
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
        ) : !decide.comisiones ? (
          <p className="pista">La autoriza Administración de la plataforma.</p>
        ) : (
          <Acciones
            id={comision.id}
            tipo="comision"
            accion={decidirComisionAccion}
            que={`la comisión de ${comision.tipo} de ${comision.razonSocial}`}
          />
        ),
    })),
    ...suspensiones.map((suspension) => ({
      id: suspension.id,
      titulo: `${suspension.tipo === "suspension" ? "Suspensión" : "Reactivación"} · ${suspension.razonSocial}`,
      icono: <IconoSuspension />,
      detalle: (
        <>
          <Link href={`/operacion/clientes/${suspension.companyId}`}>{suspension.razonSocial}</Link> · {suspension.motivo}
        </>
      ),
      contexto: [`Pidió ${suspension.solicitadaPor}`, fechaHora(suspension.solicitadaEn)],
      acciones:
        suspension.solicitadaPorId === personaId ? (
          <p className="pista">La pediste tú: decide otra persona.</p>
        ) : !decide.suspensiones ? (
          <p className="pista">La decide alguien con rol de Aprobación.</p>
        ) : (
          <Acciones
            id={suspension.id}
            tipo="suspension"
            accion={decidirSuspensionAccion}
            que={`la ${suspension.tipo === "suspension" ? "suspensión" : "reactivación"} de ${suspension.razonSocial}`}
          />
        ),
    })),
  ];
  return (
    <Bandeja
      decisiones={decisiones}
      vacio={<Vacio titulo="Nada por decidir">Las activaciones, comisiones y suspensiones que pida otra persona aparecen aquí.</Vacio>}
    />
  );
}

function Acciones({
  id,
  tipo,
  accion,
  que,
}: {
  id: string;
  tipo: "activacion" | "comision" | "suspension";
  accion: (formData: FormData) => Promise<void>;
  que: string;
}) {
  return (
    <>
      <RechazarConMotivo id={id} tipo={tipo} que={que} />
      <form action={accion}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="decision" value="aprobar" />
        <BotonEnviar data-atajo="aprobar">Aprobar</BotonEnviar>
      </form>
    </>
  );
}
