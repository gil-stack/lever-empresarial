import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";

import { AcentoInicial } from "@/components/apariencia/acento-inicial";
import { AparienciaViva } from "@/components/apariencia/viva";
import { salirOperacion } from "@/app/operacion/acciones";
import { IconoSalir, IconoSeguridad } from "@/components/cromo/iconos";
import { LateralMovil } from "@/components/cromo/lateral-movil";
import { Logotipo } from "@/components/cromo/logotipo";
import { MenuDesplegable } from "@/components/cromo/menu-desplegable";
import { OpcionesTema } from "@/components/cromo/opciones-tema";
import { COOKIE_TEMA, temaDesde, type Tema } from "@/components/cromo/tema";
import { BotonEnviar } from "@/components/sistema";

import { idDeAncla } from "./envio-sin-script";
import { NavegacionOperacion } from "./navegacion";

/**
 * El marco de Operación SOFIPO es el de la consola: escena detrás, lateral con
 * secciones (cajón en pantallas angostas) y lienzo. La barra de arriba la pone
 * cada página (`PaginaOperacion`), con su título y su acción. La persona va al pie del lateral: su menú
 * abre hacia arriba con el perfil, el tema y «Salir».
 */
export async function MarcoOperacion({
  personaId,
  nombre,
  rol,
  capacidades,
  children,
}: {
  personaId: string;
  nombre: string;
  /** Los roles de la persona en la plataforma, ya en texto («Administración»). */
  rol: string;
  capacidades: readonly string[];
  children: ReactNode;
}) {
  const [almacen, destino] = await Promise.all([cookies(), idDeAncla("contenido")]);
  const tema = temaDesde(almacen.get(COOKIE_TEMA)?.value);
  return (
    <>
      <AcentoInicial persona={personaId} tema={tema} />
      <AparienciaViva persona={personaId} tema={tema} />
      <div className="marco">
        {/* El destino es el `main` de PaginaOperacion; sin JavaScript, tras un envío lleva sufijo (idDeAncla). */}
        <a className="saltar" href={`#${destino}`}>
          Saltar al contenido
        </a>
        {/* Dos marcas, no el mismo elemento dos veces: el servidor lo mandaría una sola vez y los dos
            lazos compartirían el id de su degradado, que vive en el de la barra móvil, oculta en escritorio. */}
        <LateralMovil marca={<Marca />}>
          <div className="lateral-cabeza">
            <Marca />
          </div>
          <NavegacionOperacion capacidades={capacidades} />
          <div className="operacion-lateral-pie">
            <MenuCuenta nombre={nombre} rol={rol} tema={tema} />
          </div>
        </LateralMovil>
        <div className="lienzo">{children}</div>
      </div>
    </>
  );
}

function Marca() {
  return (
    <Link href="/operacion" className="marca">
      {/* El nombre lo lleva un solo texto para el lector: el logotipo es flexible y, junto a otro texto, el nombre
          quedaba «Lever Operación SOFIPO , ir al resumen». Sin aria-label, el nombre contiene lo que se ve (WCAG 2.5.3). */}
      <span aria-hidden="true">
        <Logotipo linea="Operación SOFIPO" />
      </span>
      <span className="solo-lector">Lever Operación SOFIPO, ir al resumen</span>
    </Link>
  );
}

function MenuCuenta({ nombre, rol, tema }: { nombre: string; rol: string; tema: Tema }) {
  return (
    <MenuDesplegable
      clase="cuenta cuenta-lateral"
      etiqueta="Tu cuenta"
      fijo
      hacia="arriba"
      disparador={
        <>
          <span className="persona-iniciales" aria-hidden="true">
            {iniciales(nombre)}
          </span>
          <span className="persona-datos">
            <span className="persona-nombre">{nombre}</span>
            <span className="persona-rol">{rol}</span>
          </span>
        </>
      }
    >
      <p className="menu-seccion">Tú</p>
      <Link href="/entrar/seguridad" role="menuitem" tabIndex={-1} className="menu-opcion">
        <IconoSeguridad />
        Mi perfil y seguridad
      </Link>
      <OpcionesTema inicial={tema} />
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
