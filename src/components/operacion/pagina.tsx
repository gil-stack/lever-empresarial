import type { ReactNode } from "react";
import Link from "next/link";

import { salirOperacion } from "@/app/operacion/acciones";
import { BarraSuperior } from "@/components/cromo/barra-superior";
import { IconoSalir, IconoSeguridad } from "@/components/cromo/iconos";
import { MenuDesplegable } from "@/components/cromo/menu-desplegable";
import { exigirContextoOperacion } from "@/server/operacion/contexto";

import { AvisoOperacion } from "./aviso";

/**
 * Una página de Operación: la barra de arriba con el título de la página (el único h1),
 * la acción de la página y el chip de la persona; debajo, el aviso del último envío y el contenido.
 */
export async function PaginaOperacion({
  titulo,
  entrada,
  aviso,
  accion,
  children,
}: {
  titulo: string;
  /** Una frase bajo la barra, solo si dice algo que la página no muestra. */
  entrada?: ReactNode;
  aviso?: string;
  accion?: ReactNode;
  children: ReactNode;
}) {
  const ctx = await exigirContextoOperacion();
  return (
    <>
      <BarraSuperior>
        <h1 className="barra-titulo">{titulo}</h1>
        <span className="barra-espacio" />
        {accion}
        <MenuPersona nombre={ctx.persona.nombre} />
      </BarraSuperior>
      <main id="contenido" className="pagina operacion-pagina">
        {entrada ? <p className="lede operacion-entrada">{entrada}</p> : null}
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
        <button type="submit" role="menuitem" tabIndex={-1} className="menu-opcion">
          <IconoSalir />
          Salir
        </button>
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
