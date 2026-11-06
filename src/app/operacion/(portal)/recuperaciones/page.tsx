import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { aprobarRecuperacionAccion, rechazarRecuperacionAccion } from "@/app/operacion/acciones-recuperaciones";
import { ConfirmarIdentidad } from "@/components/entrar/confirmar-identidad";
import { fechaHora } from "@/components/operacion/formato";
import { PaginaOperacion } from "@/components/operacion/pagina";
import { estadoDeConfirmacion, verRecuperaciones } from "@/server/autenticacion";
import { sesionSegura } from "@/server/entrada";
import { exigirContextoOperacion } from "@/server/operacion";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Recuperaciones · Operación" };

export default async function RecuperacionesOperacion({ searchParams }: { searchParams: Promise<{ aviso?: string }> }) {
  await exigirContextoOperacion();
  const sesion = await sesionSegura();
  if (!sesion) redirect("/operacion/entrar");
  const [pendientes, confirmacion, params] = await Promise.all([
    verRecuperaciones(sesion),
    estadoDeConfirmacion(sesion),
    searchParams,
  ]);
  return (
    <PaginaOperacion
      titulo="Recuperaciones de segundo factor"
      descripcion="Aprobar deja que la persona registre un factor nuevo en su próxima entrada; no quita los que ya tiene. Quien pidió no puede aprobar y decidir exige confirmar tu segundo factor en los últimos cinco minutos."
      aviso={params.aviso}
    >
      {confirmacion.reciente ? null : (
        <section className="operacion-tarjeta">
          <ConfirmarIdentidad
            passkey={confirmacion.passkey}
            totp={confirmacion.totp}
            respaldo={confirmacion.respaldo}
            motivo="Antes de aprobar o rechazar una recuperación, prueba tu segundo factor. Vale cinco minutos."
          />
        </section>
      )}
      <section className="operacion-tarjeta">
        <h2>Solicitudes pendientes</h2>
        <p className="pista">{pendientes.length} pendientes.</p>
        {pendientes.length === 0 ? (
          <p className="vacio">No hay solicitudes pendientes.</p>
        ) : (
          <ul className="operacion-lista">
            {pendientes.map((solicitud) => (
              <li key={solicitud.id}>
                <div className="operacion-fila">
                  <div className="operacion-fila-cuerpo">
                    <h3>{solicitud.nombre}</h3>
                    <p className="operacion-meta">
                      {solicitud.correo} · {fechaHora(solicitud.solicitadaEn)}
                    </p>
                    <p className="operacion-detalle">{solicitud.motivo}</p>
                  </div>
                </div>
                <form action={aprobarRecuperacionAccion} className="operacion-acciones" style={{ marginTop: 14 }}>
                  <input type="hidden" name="id" value={solicitud.id} />
                  <div className="campo">
                    <label htmlFor={`verificacion-${solicitud.id}`}>Cómo verificaste la identidad</label>
                    <select id={`verificacion-${solicitud.id}`} name="verificacion" defaultValue="videollamada">
                      <option value="videollamada">Videollamada</option>
                      <option value="presencial">En persona</option>
                    </select>
                  </div>
                  <div className="campo">
                    <label htmlFor={`nota-${solicitud.id}`}>Nota (obligatoria para rechazar)</label>
                    <input id={`nota-${solicitud.id}`} name="nota" maxLength={500} />
                  </div>
                  <button type="submit" className="boton">
                    Aprobar
                  </button>
                  <button type="submit" className="boton-texto" formAction={rechazarRecuperacionAccion}>
                    Rechazar
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PaginaOperacion>
  );
}
