import Link from "next/link";

import { EtiquetaMono, Hoja, Insignia, Metrica, Metricas, Monto, NotaRegla, Renglon, Renglones } from "@/components/sistema";
import { clabeVisible } from "@/dominio/clabe";
import { accesoFinanzasDe, estaDeBaja, fechaLarga, lineaDeRoles } from "@/dominio/personas";
import { enEmpresa } from "@/nucleo/rutas";
import type { DetallePersona } from "@/server/personas/tipos";

import { FormularioBaja, FormularioFinanzas } from "./formularios";
import {
  BotonCancelarBaja,
  BotonReenviarInvitacion,
  FormularioClabeNomina,
  FormularioEdicionPersona,
  FormularioNominaPersona,
} from "./formularios-detalle";
import { NavegacionPersonas } from "./navegacion";
import { accesoVisible, dinero, estadoDePersona, frecuenciaVisible, momentoLegible } from "./util";

export function ExpedientePersona({
  detalle,
  hoy,
  empresaId,
  edita,
  cambiaClabe,
}: {
  detalle: DetallePersona;
  hoy: string;
  empresaId: string;
  edita: boolean;
  cambiaClabe: boolean;
}) {
  const { persona } = detalle;
  const estado = estadoDePersona(persona, hoy);
  const deBaja = estaDeBaja(persona.bajaEn, hoy);
  const finanzas = edita ? accesoFinanzasDe(persona, hoy) : null;
  // En el bloque de nómina basta la terminación; los 18 dígitos viven solo en «CLABE de nómina».
  const clabe = persona.clabeFinal ? `•••• ${persona.clabeFinal}` : null;
  const neto = persona.nomina ? dinero(persona.nomina.netoCentavos, "Reservado") : "Pendiente";
  return (
    <>
      <h1 className="solo-lector">{persona.nombre}</h1>
      <div className="expediente-estado">
        <Insignia tono={estado.tono}>{estado.texto}</Insignia>
        <span>{persona.centroNombre} · {persona.jefeNombre ? `Jefe: ${persona.jefeNombre}` : "Sin jefe"}</span>
        <Link className="enlace-texto" href={enEmpresa(empresaId, "/consola/personas")}>Volver al directorio</Link>
      </div>
      <Metricas etiqueta={`Resumen de ${persona.nombre}`}>
        <Metrica rotulo="Neto por pago"><Monto>{neto}</Monto></Metrica>
        <Metrica rotulo="Frecuencia"><Monto>{persona.nomina ? frecuenciaVisible(persona.nomina.frecuencia) : "Sin configurar"}</Monto></Metrica>
        <Metrica rotulo="Próximo pago"><Monto>{persona.nomina ? fechaLarga(persona.nomina.proximoPagoEn) : "—"}</Monto></Metrica>
        <Metrica rotulo="Presupuesto mensual"><Monto>{dinero(persona.presupuestoCentavos)}</Monto></Metrica>
      </Metricas>
      <NavegacionPersonas actual="personas" empresaId={empresaId} />

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
          {clabe ? <EtiquetaMono nombre="CLABE">{clabe}</EtiquetaMono> : <p className="lede">Sin CLABE externa registrada.</p>}
          {edita && !deBaja ? (
            <FormularioNominaPersona persona={persona} hoy={hoy} />
          ) : persona.nomina ? (
            <Renglones>
              <Renglon etiqueta="Neto por pago">{neto}</Renglon>
              <Renglon etiqueta="Frecuencia">{frecuenciaVisible(persona.nomina.frecuencia)}</Renglon>
              <Renglon etiqueta="Próximo pago">{fechaLarga(persona.nomina.proximoPagoEn)}</Renglon>
              <Renglon etiqueta="Destino">{persona.nomina.destino === "clabe" ? "CLABE externa" : "Tarjeta de nómina"}</Renglon>
            </Renglones>
          ) : <p className="lede">La nómina todavía no está configurada.</p>}
          {persona.nomina && persona.nomina.netoCentavos === null ? (
            <p className="pista">Tu rol ve los totales de nómina; el neto de cada persona lo ve quien prepara o autoriza.</p>
          ) : null}
        </Hoja>

        {cambiaClabe ? (
          <Hoja id="expediente-clabe" titulo="CLABE de nómina">
            {persona.clabe ? <EtiquetaMono nombre="Vigente">{clabeVisible(persona.clabe)}</EtiquetaMono> : <p className="lede">Todavía no hay CLABE de nómina.</p>}
            {detalle.clabeDuplicada ? <p className="area-alerta" role="note">Esta CLABE también aparece en otra persona. Revisa que sea correcta.</p> : null}
            {!deBaja ? <FormularioClabeNomina persona={persona} /> : null}
            <NotaRegla>Cada cambio exige tu segundo factor reciente, queda en el historial y se avisa por correo a la persona.</NotaRegla>
            {detalle.historialClabe.length > 0 ? (
              <div className="tabla-contenedor">
                <table className="tabla personas-tabla clabe-historial">
                  <caption className="seccion-lectura">Historial de la CLABE de nómina</caption>
                  <thead><tr><th scope="col">CLABE</th><th scope="col">Desde</th><th scope="col">Hasta</th><th scope="col">Registró</th></tr></thead>
                  <tbody>
                    {detalle.historialClabe.map((linea) => (
                      <tr key={linea.id}>
                        <td data-label="CLABE">{linea.visible}</td>
                        <td data-label="Desde">{momentoLegible(linea.desde)}</td>
                        <td data-label="Hasta">{linea.hasta ? momentoLegible(linea.hasta) : <Insignia tono="sello">Vigente</Insignia>}</td>
                        <td data-label="Registró">{linea.registradaPor ?? "Migración del maestro"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </Hoja>
        ) : null}

        <Hoja id="expediente-acceso" titulo="Plataforma y tarjeta">
          <Renglones>
            <Renglon etiqueta="Plataforma">{lineaDeRoles(persona.roles, persona.invitada)}</Renglon>
            <Renglon etiqueta="Correo">{persona.correo ?? "Sin usuario"}</Renglon>
            <Renglon etiqueta="Servicios">{accesoVisible(persona)}</Renglon>
            <Renglon etiqueta="Tarjeta de nómina">{persona.tarjetaPendiente ? "Solicitud interna pendiente de emisión" : "Sin solicitud pendiente"}</Renglon>
          </Renglones>
          {edita && persona.invitada ? <BotonReenviarInvitacion personaId={persona.id} /> : null}
          {finanzas === "incluido" ? (
            <p className="pista">Inicio financiero está incluido con administración.</p>
          ) : finanzas === "casilla" && persona.userId ? (
            <FormularioFinanzas key={persona.userId} userId={persona.userId} habilitado={persona.roles.includes("finanzas")} />
          ) : null}
          <NotaRegla>La tarjeta no crea acceso. Tesorería puede tener acceso y tarjeta de forma independiente.</NotaRegla>
        </Hoja>

        <Hoja id="expediente-baja" titulo="Baja">
          <p className="lede">La baja efectiva cierra el acceso, detiene nuevas nóminas y cancela solicitudes de tarjeta pendientes. Una baja futura lo hace sola el día que llega.</p>
          {persona.bajaEn ? <p className="area-alerta">{deBaja ? "Baja efectiva desde" : "Baja programada para"} el {fechaLarga(persona.bajaEn)}.</p> : null}
          {edita ? <FormularioBaja personaId={persona.id} nombre={persona.nombre} bajaActual={persona.bajaEn} /> : null}
          {edita && persona.bajaEn && !deBaja ? <BotonCancelarBaja personaId={persona.id} /> : null}
        </Hoja>
      </div>
    </>
  );
}
