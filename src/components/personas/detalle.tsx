import Link from "next/link";

import { CabezaPagina, EtiquetaMono, Hoja, Insignia, Metrica, Metricas, NotaRegla, Renglon, Renglones } from "@/components/sistema";
import { clabeVisible } from "@/dominio/clabe";
import { estaDeBaja, fechaLarga, lineaDeRoles } from "@/dominio/personas";
import { enEmpresa } from "@/nucleo/rutas";
import type { DetallePersona } from "@/server/personas/tipos";

import { FormularioBaja } from "./formularios";
import { BotonReenviarInvitacion, FormularioEdicionPersona, FormularioNominaPersona } from "./formularios-detalle";
import { NavegacionPersonas } from "./navegacion";
import { accesoVisible, dinero, estadoDePersona, frecuenciaVisible } from "./util";

export function ExpedientePersona({
  detalle,
  hoy,
  empresaId,
  edita,
}: {
  detalle: DetallePersona;
  hoy: string;
  empresaId: string;
  edita: boolean;
}) {
  const { persona } = detalle;
  const estado = estadoDePersona(persona, hoy);
  const deBaja = estaDeBaja(persona.bajaEn, hoy);
  return (
    <>
      <Link className="enlace-texto" href={enEmpresa(empresaId, "/consola/personas")}>← Volver a Personas</Link>
      <CabezaPagina kicker="Expediente" titulo={persona.nombre}>
        <div className="expediente-estado">
          <Insignia tono={estado.tono}>{estado.texto}</Insignia>
          <span>{persona.centroNombre} · {persona.jefeNombre ? `Jefe: ${persona.jefeNombre}` : "Sin jefe"}</span>
        </div>
      </CabezaPagina>
      <NavegacionPersonas actual="personas" empresaId={empresaId} />
      <Metricas etiqueta={`Resumen de ${persona.nombre}`}>
        <Metrica rotulo="Neto por pago">{persona.nomina ? dinero(persona.nomina.netoCentavos) : "Pendiente"}</Metrica>
        <Metrica rotulo="Frecuencia">{persona.nomina ? frecuenciaVisible(persona.nomina.frecuencia) : "Sin configurar"}</Metrica>
        <Metrica rotulo="Próximo pago">{persona.nomina ? fechaLarga(persona.nomina.proximoPagoEn) : "—"}</Metrica>
        <Metrica rotulo="Presupuesto mensual">{dinero(persona.presupuestoCentavos)}</Metrica>
      </Metricas>

      <div className="expediente-rejilla">
        <Hoja id="expediente-laboral" titulo="Datos laborales">
          {edita ? (
            <FormularioEdicionPersona persona={persona} centros={detalle.centros} jefes={detalle.jefes} />
          ) : (
            <Renglones>
              <Renglon etiqueta="Ingreso">{fechaLarga(persona.altaEn)}</Renglon>
              <Renglon etiqueta="Área">{persona.centroNombre}</Renglon>
              <Renglon etiqueta="Jefe">{persona.jefeNombre ?? "Sin jefe"}</Renglon>
              <Renglon etiqueta="Presupuesto">{dinero(persona.presupuestoCentavos)}</Renglon>
            </Renglones>
          )}
        </Hoja>

        <Hoja id="expediente-nomina" titulo="Nómina y depósito">
          {persona.clabe ? (
            <>
              <EtiquetaMono nombre="CLABE">{clabeVisible(persona.clabe)}</EtiquetaMono>
              {detalle.clabeDuplicada ? <p className="area-alerta" role="note">Esta CLABE también aparece en otra persona. Revisa que sea correcta.</p> : null}
            </>
          ) : <p className="lede">Sin CLABE externa. El destino registrado es tarjeta de nómina.</p>}
          {edita && !deBaja ? (
            <FormularioNominaPersona persona={persona} hoy={hoy} />
          ) : persona.nomina ? (
            <Renglones>
              <Renglon etiqueta="Neto por pago">{dinero(persona.nomina.netoCentavos)}</Renglon>
              <Renglon etiqueta="Frecuencia">{frecuenciaVisible(persona.nomina.frecuencia)}</Renglon>
              <Renglon etiqueta="Próximo pago">{fechaLarga(persona.nomina.proximoPagoEn)}</Renglon>
              <Renglon etiqueta="Destino">{persona.nomina.destino === "clabe" ? "CLABE externa" : "Tarjeta de nómina"}</Renglon>
            </Renglones>
          ) : <p className="lede">La nómina todavía no está configurada.</p>}
        </Hoja>

        <Hoja id="expediente-acceso" titulo="Plataforma y tarjeta">
          <Renglones>
            <Renglon etiqueta="Plataforma">{lineaDeRoles(persona.roles, persona.invitada)}</Renglon>
            <Renglon etiqueta="Correo">{persona.correo ?? "Sin usuario"}</Renglon>
            <Renglon etiqueta="Servicios">{accesoVisible(persona)}</Renglon>
            <Renglon etiqueta="Tarjeta de nómina">{persona.tarjetaPendiente ? "Solicitud interna pendiente de emisión" : "Sin solicitud pendiente"}</Renglon>
          </Renglones>
          {edita && persona.invitada ? <BotonReenviarInvitacion personaId={persona.id} /> : null}
          <NotaRegla>La tarjeta no crea acceso. Tesorería puede tener acceso y tarjeta de forma independiente.</NotaRegla>
        </Hoja>

        <Hoja id="expediente-baja" titulo="Baja">
          <p className="lede">La baja efectiva cierra el acceso, detiene nuevas nóminas y cancela solicitudes de tarjeta pendientes.</p>
          {persona.bajaEn ? <p className="area-alerta">Fecha registrada: {fechaLarga(persona.bajaEn)}.</p> : null}
          {edita ? <FormularioBaja personaId={persona.id} nombre={persona.nombre} bajaActual={persona.bajaEn} /> : null}
        </Hoja>
      </div>
    </>
  );
}
