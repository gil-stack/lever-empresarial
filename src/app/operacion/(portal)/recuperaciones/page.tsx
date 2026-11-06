import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { aprobarRecuperacionAccion, rechazarRecuperacionAccion } from "@/app/operacion/acciones-recuperaciones";
import { ConfirmarIdentidad } from "@/components/entrar/confirmar-identidad";
import { IconoSeguridad } from "@/components/cromo/iconos";
import { fechaHora } from "@/components/operacion/formato";
import { PaginaOperacion } from "@/components/operacion/pagina";
import { Bandeja, NotaRegla, Vacio } from "@/components/sistema";
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
  const notaInvalida = params.aviso === "verificacion_invalida";
  return (
    <PaginaOperacion titulo="Recuperaciones" aviso={params.aviso}>
      {confirmacion.reciente ? null : (
        <div className="panel operacion-confirmar">
          <ConfirmarIdentidad
            passkey={confirmacion.passkey}
            totp={confirmacion.totp}
            respaldo={confirmacion.respaldo}
            motivo="Antes de aprobar o rechazar una recuperación, prueba tu segundo factor. Vale cinco minutos."
          />
        </div>
      )}
      <Bandeja
        vacio={<Vacio titulo="Sin solicitudes">Cuando alguien pierda su segundo factor y pida ayuda, su solicitud aparece aquí.</Vacio>}
        decisiones={pendientes.map((solicitud) => ({
          id: solicitud.id,
          titulo: `Recuperación · ${solicitud.nombre}`,
          icono: <IconoSeguridad />,
          detalle: <span className="operacion-detalle">{solicitud.motivo}</span>,
          contexto: [solicitud.correo, fechaHora(solicitud.solicitadaEn)],
          acciones: (
            <form action={aprobarRecuperacionAccion} className="operacion-decision-forma">
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
                <input
                  id={`nota-${solicitud.id}`}
                  name="nota"
                  maxLength={500}
                  aria-invalid={notaInvalida || undefined}
                  aria-describedby={notaInvalida ? "aviso-operacion" : undefined}
                />
              </div>
              <div className="operacion-decision-botones">
                <button type="submit" className="boton-texto" formAction={rechazarRecuperacionAccion} data-atajo="rechazar">
                  Rechazar
                </button>
                <button type="submit" className="boton" data-atajo="aprobar">
                  Aprobar
                </button>
              </div>
            </form>
          ),
        }))}
      />
      <NotaRegla>Nadie decide su propia solicitud.</NotaRegla>
    </PaginaOperacion>
  );
}
