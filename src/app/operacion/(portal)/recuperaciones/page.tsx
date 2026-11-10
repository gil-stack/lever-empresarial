import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { soloTexto, type Parametros } from "@/app/operacion/busqueda";
import { decidirRecuperacionAccion } from "@/app/operacion/acciones-recuperaciones";
import { ConfirmarIdentidad } from "@/components/entrar/confirmar-identidad";
import { IconoSeguridad } from "@/components/cromo/iconos";
import { DecisionRecuperacion } from "@/components/operacion/decision-recuperacion";
import { fechaHora } from "@/components/operacion/formato";
import { PaginaOperacion } from "@/components/operacion/pagina";
import { SinPermiso } from "@/components/operacion/sin-permiso";
import { Bandeja, NotaRegla, Vacio } from "@/components/sistema";
import { estadoDeConfirmacion, verRecuperaciones } from "@/server/autenticacion";
import { sesionSegura } from "@/server/entrada";
import { exigirContextoOperacion } from "@/server/operacion";
import { puedeEnOperacion } from "@/server/operacion/permisos";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Recuperaciones · Operación" };

export default async function RecuperacionesOperacion({ searchParams }: { searchParams: Parametros<"aviso"> }) {
  const ctx = await exigirContextoOperacion();
  // Desde la Ola R1 hay roles que no administran cuentas: Auditoría o Cumplimiento no aprueban recuperaciones.
  if (!puedeEnOperacion(ctx, "plataforma.empresa.alta")) {
    return (
      <PaginaOperacion titulo="Recuperaciones">
        <SinPermiso>Las recuperaciones de segundo factor las decide Administración de la plataforma.</SinPermiso>
      </PaginaOperacion>
    );
  }
  const sesion = await sesionSegura();
  if (!sesion) redirect("/operacion/entrar");
  const [pendientes, confirmacion, params] = await Promise.all([
    verRecuperaciones(sesion),
    estadoDeConfirmacion(sesion),
    soloTexto(searchParams),
  ]);
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
            <DecisionRecuperacion key={solicitud.id} id={solicitud.id} accion={decidirRecuperacionAccion} />
          ),
        }))}
      />
      <NotaRegla>
        Al aprobar, la persona tiene 12 horas para registrar un factor nuevo; al confirmarlo, los anteriores dejan de servir. Nadie decide su propia solicitud.
      </NotaRegla>
    </PaginaOperacion>
  );
}
