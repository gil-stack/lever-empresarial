import type { ReactNode } from "react";
import Link from "next/link";

import { salirOperacion } from "@/app/operacion/acciones";
import { BarraSuperior } from "@/components/cromo/barra-superior";
import { IconoSalir, IconoSeguridad } from "@/components/cromo/iconos";
import { MenuDesplegable } from "@/components/cromo/menu-desplegable";
import { BotonEnviar } from "@/components/sistema";
import { exigirContextoOperacion } from "@/server/operacion/contexto";

import { AvisoOperacion } from "./aviso";

/**
 * Una página de Operación, como la consola: el título y la acción van en la barra de arriba
 * junto al chip de la persona; el contenido abre con el h1 para el lector de pantalla y el aviso
 * del último envío. Una regla necesaria va una vez donde aplica (NotaRegla), no bajo la barra.
 */
export async function PaginaOperacion({
  titulo,
  aviso,
  accion,
  children,
}: {
  titulo: string;
  aviso?: string;
  accion?: ReactNode;
  children: ReactNode;
}) {
  const ctx = await exigirContextoOperacion();
  return (
    <>
      <BarraSuperior>
        <p className="barra-titulo">{titulo}</p>
        <span className="barra-espacio" />
        {accion}
        <MenuPersona nombre={ctx.persona.nombre} />
      </BarraSuperior>
      <main id="contenido" className="pagina operacion-pagina">
        <h1 className="solo-lector">{titulo}</h1>
        <AvisoOperacion codigo={aviso} />
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
