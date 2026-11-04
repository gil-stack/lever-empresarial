import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { MarcoArco } from "@/components/entrar/marco-arco";
import { aprobarRecuperacion, rechazarRecuperacion } from "@/app/entrar/acciones";
import { verRecuperaciones } from "@/server/autenticacion";
import { sesionDesdeCookie } from "@/server/entrada";
import { ErrorDeDominio } from "@/server/session";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Recuperaciones",
};

const AVISOS: Record<string, string> = {
  sin_permiso: "No puedes resolver recuperaciones.",
  recuperacion_ausente: "Esa solicitud ya no está pendiente.",
  misma_persona_en_recuperacion: "Otra persona tiene que aprobar la recuperación.",
  motivo_invalido: "Escribe la nota, en una frase.",
  verificacion_invalida: "Di cómo verificaste la identidad.",
};

export default async function PaginaRecuperaciones({
  searchParams,
}: {
  searchParams: Promise<{ aviso?: string }>;
}) {
  const sesion = await sesionDesdeCookie();
  if (!sesion) redirect("/entrar?siguiente=/entrar/recuperaciones");

  let pendientes;
  try {
    pendientes = await verRecuperaciones(sesion);
  } catch (error) {
    if (error instanceof ErrorDeDominio && error.codigo === "sin_permiso") redirect("/entrar/seguridad");
    throw error;
  }

  const avisoParam = (await searchParams).aviso;
  const aviso = typeof avisoParam === "string" ? (AVISOS[avisoParam] ?? null) : null;
  const formato = new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Mexico_City",
  });

  return (
    <MarcoArco>
      <p className="arco-kicker">Equipo</p>
      <h1>Recuperar un segundo factor.</h1>
      <p className="arco-nota">
        Aprobar no quita la passkey, la app autenticadora ni los códigos de respaldo. La contraseña se cambia por el
        enlace de correo, y el segundo factor sigue.
      </p>
      {aviso ? (
        <div className="alerta" role="alert">
          <p>{aviso}</p>
        </div>
      ) : null}
      {pendientes.length === 0 ? <p className="arco-nota">No hay solicitudes pendientes.</p> : null}
      <ul className="arco-lista">
        {pendientes.map((solicitud) => (
          <li key={solicitud.id}>
            <form action={aprobarRecuperacion}>
              <p>
                <strong>{solicitud.nombre}</strong> · {solicitud.correo}
              </p>
              <p className="arco-nota">{solicitud.motivo}</p>
              <p className="arco-pie">{formato.format(solicitud.solicitadaEn)}</p>
              <input type="hidden" name="id" value={solicitud.id} />
              <div className="campo">
                <label htmlFor={`verificacion-${solicitud.id}`}>Cómo verificaste la identidad</label>
                <select id={`verificacion-${solicitud.id}`} name="verificacion" defaultValue="videollamada">
                  <option value="videollamada">Videollamada</option>
                  <option value="presencial">En persona</option>
                </select>
              </div>
              <div className="campo">
                <label htmlFor={`nota-${solicitud.id}`}>Nota</label>
                <input id={`nota-${solicitud.id}`} name="nota" maxLength={500} />
              </div>
              <div className="acciones">
                <button type="submit" className="boton">
                  Aprobar
                </button>
                <button type="submit" className="boton-texto" formAction={rechazarRecuperacion}>
                  Rechazar
                </button>
              </div>
            </form>
          </li>
        ))}
      </ul>
    </MarcoArco>
  );
}
