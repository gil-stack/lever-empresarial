import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { soloTexto, type Parametros } from "@/app/operacion/busqueda";
import { cambiarRolAccion } from "@/app/operacion/acciones-alta";
import { ConfirmarIdentidad } from "@/components/entrar/confirmar-identidad";
import { PaginaOperacion } from "@/components/operacion/pagina";
import { SinPermiso } from "@/components/operacion/sin-permiso";
import { BotonEnviar, Hoja, Insignia, NotaRegla, Vacio } from "@/components/sistema";
import { ROLES_PLATAFORMA } from "@/nucleo/capacidades";
import { estadoDeConfirmacion } from "@/server/autenticacion";
import { sesionSegura } from "@/server/entrada";
import {
  DESCRIPCION_ROL_PLATAFORMA,
  ETIQUETA_ROL_PLATAFORMA,
  exigirContextoOperacion,
  listarPersonalConRoles,
  puedeEnOperacion,
} from "@/server/operacion";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Personal · Operación" };

const ESTADO_PERSONAL: Record<string, string> = { invitado: "Invitado", activo: "Activo", suspendido: "Suspendido" };

/**
 * Roles del personal SOFIPO (Ola R1). Separación de funciones de la 50ª de las disposiciones
 * del art. 124 LACP: Cumplimiento no se junta con Auditoría ni con Originación, y nadie se da
 * roles a sí mismo. La base lo vuelve a exigir con su trigger aunque alguien se salte esta pantalla.
 */
export default async function PersonalOperacion({ searchParams }: { searchParams: Parametros<"aviso"> }) {
  const ctx = await exigirContextoOperacion();
  if (!puedeEnOperacion(ctx, "plataforma.personal.administrar")) {
    return (
      <PaginaOperacion titulo="Personal">
        <SinPermiso>Los roles del personal los asigna Administración de la plataforma.</SinPermiso>
      </PaginaOperacion>
    );
  }
  const sesion = await sesionSegura();
  if (!sesion) redirect("/operacion/entrar");
  const [personas, confirmacion, params] = await Promise.all([listarPersonalConRoles(ctx), estadoDeConfirmacion(sesion), soloTexto(searchParams)]);
  return (
    <PaginaOperacion titulo="Personal" aviso={params.aviso}>
      {confirmacion.reciente ? null : (
        <div className="panel operacion-confirmar">
          <ConfirmarIdentidad
            passkey={confirmacion.passkey}
            totp={confirmacion.totp}
            respaldo={confirmacion.respaldo}
            motivo="Antes de asignar o quitar un rol, prueba tu segundo factor. Vale cinco minutos."
          />
        </div>
      )}
      <Hoja id="personal-titulo" titulo={`Personal · ${personas.length}`}>
        {personas.length === 0 ? (
          <Vacio titulo="Sin personal">Las personas que entren por la puerta de Operación aparecen aquí.</Vacio>
        ) : (
          <ul className="operacion-lista">
            {personas.map((persona) => {
              const propia = persona.id === ctx.persona.id;
              return (
                <li key={persona.id}>
                  <div className="operacion-fila">
                    <div className="operacion-fila-cuerpo">
                      <h3>
                        {persona.nombre}
                        {propia ? " (tú)" : ""}
                      </h3>
                      <p className="operacion-meta">
                        <span>{persona.correo}</span>
                        <span>{ESTADO_PERSONAL[persona.estado]}</span>
                      </p>
                    </div>
                    <div className="operacion-roles">
                      {persona.roles.length === 0 ? (
                        <Insignia>Sin rol</Insignia>
                      ) : (
                        persona.roles.map((rol) => (
                          <Insignia key={rol} tono="sello">
                            {ETIQUETA_ROL_PLATAFORMA[rol]}
                          </Insignia>
                        ))
                      )}
                    </div>
                  </div>
                  {propia ? (
                    <p className="pista">Tus roles los cambia otra persona de Administración.</p>
                  ) : (
                    <div className="operacion-acciones" aria-label={`Roles de ${persona.nombre}`} role="group">
                      {ROLES_PLATAFORMA.map((rol) => {
                        const tiene = persona.roles.includes(rol);
                        return (
                          <form key={rol} action={cambiarRolAccion}>
                            <input type="hidden" name="userId" value={persona.id} />
                            <input type="hidden" name="rol" value={rol} />
                            <input type="hidden" name="quitar" value={tiene ? "si" : "no"} />
                            <BotonEnviar className={tiene ? "boton-texto" : "boton-secundario"}>
                              {tiene ? `Quitar ${ETIQUETA_ROL_PLATAFORMA[rol]}` : `Dar ${ETIQUETA_ROL_PLATAFORMA[rol]}`}
                            </BotonEnviar>
                          </form>
                        );
                      })}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Hoja>
      <Hoja id="roles-titulo" titulo="Qué hace cada rol">
        <ul className="operacion-lista">
          {ROLES_PLATAFORMA.map((rol) => (
            <li key={rol}>
              <h3>{ETIQUETA_ROL_PLATAFORMA[rol]}</h3>
              <p className="operacion-detalle">{DESCRIPCION_ROL_PLATAFORMA[rol]}</p>
            </li>
          ))}
        </ul>
      </Hoja>
      <NotaRegla>
        Cumplimiento no puede tener también Auditoría ni Originación, y nadie se asigna roles a sí mismo. Cada cambio queda en la
        bitácora con quién, cuándo y qué rol.
      </NotaRegla>
    </PaginaOperacion>
  );
}
