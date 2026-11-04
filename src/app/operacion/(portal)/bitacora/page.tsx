import type { Metadata } from "next";
import Link from "next/link";

import { fechaHora } from "@/components/operacion/formato";
import { PaginaOperacion } from "@/components/operacion/pagina";
import { exigirContextoOperacion, leerBitacora } from "@/server/operacion";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Bitácora · Operación" };

export default async function BitacoraOperacion() {
  const ctx = await exigirContextoOperacion();
  const eventos = await leerBitacora(ctx);
  return (
    <PaginaOperacion titulo="Bitácora de solo lectura" descripcion="Actores, acciones y motivos registrados transaccionalmente. No muestra tokens, contraseñas ni material de segundo factor.">
      {eventos.length === 0 ? <p className="vacio">No hay eventos todavía.</p> : <div className="operacion-tabla-envoltura"><table className="operacion-tabla"><thead><tr><th>Fecha</th><th>Empresa</th><th>Actor</th><th>Acción</th><th>Motivo</th></tr></thead><tbody>{eventos.map((evento) => <tr key={evento.id}><td>{fechaHora(evento.ocurridoEn)}</td><td>{evento.companyId && evento.razonSocial ? <Link href={`/operacion/clientes/${evento.companyId}`}>{evento.razonSocial}</Link> : "Plataforma"}</td><td>{evento.actor}</td><td>{evento.accion}<small>{evento.entidad}</small></td><td>{evento.motivo ?? "—"}</td></tr>)}</tbody></table></div>}
    </PaginaOperacion>
  );
}
