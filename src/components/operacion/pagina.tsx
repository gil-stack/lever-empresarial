import { randomUUID } from "node:crypto";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import Link from "next/link";

import { salirOperacion } from "@/app/operacion/acciones";
import { COOKIE_RECHAZO } from "@/app/operacion/rechazo";
import { BarraSuperior } from "@/components/cromo/barra-superior";
import { IconoSalir, IconoSeguridad } from "@/components/cromo/iconos";
import { MenuDesplegable } from "@/components/cromo/menu-desplegable";
import { BotonEnviar } from "@/components/sistema";
import { exigirContextoOperacion } from "@/server/operacion/contexto";

import { AvisoOperacion, avisoConocido, ID_AVISO_RECHAZO } from "./aviso";
import { esRespuestaDeEnvio, idDeAncla } from "./envio-sin-script";
import { AvisoSinFormulario, ResumenDelEnvio } from "./formulario-con-aviso";

/**
 * Una página de Operación, como la consola: el título y la acción van en la barra de arriba
 * junto al chip de la persona; el contenido abre con el h1 para el lector de pantalla y el aviso
 * del último envío. Una regla necesaria va una vez donde aplica (NotaRegla), no bajo la barra.
 *
 * Un formulario rechazado vuelve con su aviso dentro del formulario, sin cambiar la dirección: el aviso de la dirección
 * (el del envío anterior) ya no aplica. Con JavaScript lo oculta `ResumenDelEnvio`; sin JavaScript, la página que
 * responde al envío (`esRespuestaDeEnvio`) no lo pinta. Tampoco cuando esta página responde a un rechazo: su código
 * llega en la cookie de `rechazado` y va arriba solo si ningún formulario lo muestra (`AvisoSinFormulario`). El id
 * de `main` es el destino de «Saltar al contenido» (`idDeAncla`).
 */
export async function PaginaOperacion({
  titulo,
  aviso,
  detalleAviso,
  accion,
  children,
}: {
  titulo: string;
  aviso?: string;
  /** Una línea más bajo el aviso, como el renglón del CSV que no se pudo leer. */
  detalleAviso?: string;
  accion?: ReactNode;
  children: ReactNode;
}) {
  const [ctx, respuestaDeEnvio, destino, almacen] = await Promise.all([exigirContextoOperacion(), esRespuestaDeEnvio(), idDeAncla("contenido"), cookies()]);
  // La cookie también puede llegar del navegador (cualquiera la manda a mano): solo vale un código del catálogo.
  const enCookie = almacen.get(COOKIE_RECHAZO)?.value ?? "";
  const rechazo = avisoConocido(enCookie) ? enCookie : null;
  return (
    <>
      <BarraSuperior>
        <p className="barra-titulo">{titulo}</p>
        <span className="barra-espacio" />
        {accion}
        <MenuPersona nombre={ctx.persona.nombre} />
        {/* Sin JavaScript el menú de la cuenta no abre: «Salir» va junto a él, con la misma acción. */}
        <noscript>
          <form action={salirOperacion} className="salir-sin-script">
            <button type="submit" className="boton-secundario">
              Salir
            </button>
          </form>
        </noscript>
      </BarraSuperior>
      <main id={destino} className="pagina operacion-pagina">
        <h1 className="solo-lector">{titulo}</h1>
        {respuestaDeEnvio || rechazo ? null : (
          <ResumenDelEnvio>
            <AvisoOperacion codigo={aviso} detalle={detalleAviso} />
          </ResumenDelEnvio>
        )}
        {/* Una llave por respuesta: cada rechazo nuevo lo vuelve a mostrar aunque el anterior se haya descartado. */}
        {rechazo ? (
          <AvisoSinFormulario key={randomUUID()}>
            <AvisoOperacion codigo={rechazo} id={ID_AVISO_RECHAZO} />
          </AvisoSinFormulario>
        ) : null}
        {children}
      </main>
    </>
  );
}

function MenuPersona({ nombre }: { nombre: string }) {
  return (
    <MenuDesplegable
      clase="cuenta"
      etiqueta="Tu cuenta"
      disparador={
        <>
          <span className="persona-iniciales" aria-hidden="true">
            {iniciales(nombre)}
          </span>
          <span className="persona-datos">
            <span className="persona-nombre">{nombre}</span>
            <span className="persona-rol">Personal SOFIPO</span>
          </span>
        </>
      }
    >
      <p className="menu-seccion">Tú</p>
      <Link href="/entrar/seguridad" role="menuitem" tabIndex={-1} className="menu-opcion">
        <IconoSeguridad />
        Mi perfil y seguridad
      </Link>
      <form action={salirOperacion} className="menu-pie">
        <BotonEnviar role="menuitem" tabIndex={-1} className="menu-opcion" enviando="Saliendo…">
          <IconoSalir />
          Salir
        </BotonEnviar>
      </form>
    </MenuDesplegable>
  );
}

function iniciales(nombre: string): string {
  const palabras = nombre.trim().split(/\s+/).filter(Boolean);
  return (palabras.length > 1 ? palabras.slice(0, 2).map((palabra) => palabra.charAt(0)) : [nombre.trim().slice(0, 2)])
    .join("")
    .toLocaleUpperCase("es-MX");
}
