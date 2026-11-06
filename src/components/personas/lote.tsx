import Link from "next/link";

import { CabezaPagina, EtiquetaMono, Hoja, Insignia, Metrica, Metricas, NotaRegla } from "@/components/sistema";
import { clabeVisible } from "@/dominio/clabe";
import { fechaLarga } from "@/dominio/personas";
import { enEmpresa } from "@/nucleo/rutas";
import type { LecturaLote } from "@/server/nomina/tipos";

import { NavegacionPersonas } from "./navegacion";
import { dinero } from "./util";

export function DetalleLoteNomina({
  lectura,
  empresaId,
}: {
  lectura: LecturaLote;
  empresaId: string;
}) {
  const { lote, items, detalle } = lectura;
  return (
    <>
      <Link className="enlace-texto" href={enEmpresa(empresaId, "/consola/personas/nomina")}>← Volver a Nómina</Link>
      <CabezaPagina kicker="Lote preparado" titulo={fechaLarga(lote.fechaPago)}>
        <p className="lede">Snapshot administrativo para revisión. Sus importes y destinos no cambian con ediciones posteriores.</p>
      </CabezaPagina>
      <NavegacionPersonas actual="nomina" empresaId={empresaId} />
      <Metricas etiqueta="Resumen del lote">
        <Metrica rotulo="Total programado">{dinero(lote.totalCentavos)}</Metrica>
        <Metrica rotulo="Personas">{lote.personas}</Metrica>
        <Metrica rotulo="Destinos pendientes">{lote.destinosPendientes}</Metrica>
        <Metrica rotulo="Estado"><Insignia tono={lote.destinosPendientes ? "aviso" : "sello"}>Preparada</Insignia></Metrica>
      </Metricas>
      <NotaRegla>Este lote no es una orden bancaria. No se ha dispersado dinero ni se ha emitido una tarjeta.</NotaRegla>
      <Hoja id="personas-lote" titulo="Personas e importes congelados">
        {detalle ? (
          <div className="personas-tabla-envoltura">
            <table className="personas-tabla">
              <thead><tr><th scope="col">Colaborador</th><th scope="col">Neto</th><th scope="col">Destino registrado</th><th scope="col">Revisión</th></tr></thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td data-label="Colaborador">{item.nombre}</td>
                    <td className="numero" data-label="Neto">{dinero(item.netoCentavos)}</td>
                    <td data-label="Destino registrado">
                      {item.clabe
                        ? <EtiquetaMono nombre="CLABE">{clabeVisible(item.clabe)}</EtiquetaMono>
                        : item.clabeFinal
                          ? <EtiquetaMono nombre="CLABE">{`•••• ${item.clabeFinal}`}</EtiquetaMono>
                          : "Tarjeta de nómina"}
                    </td>
                    <td data-label="Revisión"><Insignia tono={item.destinoListo ? "sello" : "aviso"}>{item.destinoListo ? "Destino listo" : "Destino pendiente"}</Insignia></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="lede">Tu rol ve el total del lote. El neto y el destino de cada persona los ve quien prepara o autoriza la nómina.</p>
        )}
      </Hoja>
    </>
  );
}
