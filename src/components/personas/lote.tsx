import Link from "next/link";

import { EtiquetaMono, Insignia, Metrica, Metricas, Monto, NotaRegla } from "@/components/sistema";
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
      <h1 className="solo-lector">Lote de nómina del {fechaLarga(lote.fechaPago)}</h1>
      <Metricas etiqueta="Resumen del lote">
        <Metrica rotulo="Total programado" nota={`Pago del ${fechaLarga(lote.fechaPago)}`}><Monto>{dinero(lote.totalCentavos)}</Monto></Metrica>
        <Metrica rotulo="Personas"><Monto>{lote.personas}</Monto></Metrica>
        <Metrica rotulo="Destinos pendientes"><Monto>{lote.destinosPendientes}</Monto></Metrica>
        <Metrica rotulo="Estado"><Insignia tono={lote.destinosPendientes ? "aviso" : "sello"}>Preparada</Insignia></Metrica>
      </Metricas>
      <NavegacionPersonas actual="nomina" empresaId={empresaId} />
      <section className="panel" aria-labelledby="personas-lote">
        <div className="panel-cabeza">
          <h2 id="personas-lote">Personas e importes congelados</h2>
          <Link className="enlace-texto" href={enEmpresa(empresaId, "/consola/personas/nomina")}>Volver a Nómina</Link>
        </div>
        {detalle ? (
          <div className="tabla-contenedor">
            <table className="tabla personas-tabla">
              <thead><tr><th scope="col">Colaborador</th><th scope="col" className="derecha">Neto</th><th scope="col">Destino registrado</th><th scope="col">Revisión</th></tr></thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td data-label="Colaborador">{item.nombre}</td>
                    <td className="cifra" data-label="Neto">{dinero(item.netoCentavos)}</td>
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
      </section>
      <NotaRegla>Los importes y destinos quedaron congelados al preparar el lote; editar un expediente no los cambia. La dispersión de la nómina todavía no sale desde Lever.</NotaRegla>
    </>
  );
}
