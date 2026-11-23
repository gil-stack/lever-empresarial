import { randomUUID } from "node:crypto";
import type { ReactNode } from "react";
import { cookies } from "next/headers";

import { salirOperacion } from "@/app/operacion/acciones";
import { COOKIE_RECHAZO } from "@/app/operacion/rechazo";
import { BarraSuperior } from "@/components/cromo/barra-superior";
import { exigirContextoOperacion } from "@/server/operacion/contexto";

import { AvisoOperacion, avisoConocido, ID_AVISO_RECHAZO } from "./aviso";
import { esRespuestaDeEnvio, idDeAncla } from "./envio-sin-script";
import { AvisoSinFormulario, ResumenDelEnvio } from "./formulario-con-aviso";

/**
 * Una página de Operación, como la consola: el título y la acción van en la barra de arriba (la persona, al pie
 * del lateral); el contenido abre con el h1 para el lector de pantalla y el aviso del último envío. Una regla necesaria va una vez donde aplica (NotaRegla), no bajo la barra.
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
  const [, respuestaDeEnvio, destino, almacen] = await Promise.all([exigirContextoOperacion(), esRespuestaDeEnvio(), idDeAncla("contenido"), cookies()]);
  // La cookie también puede llegar del navegador (cualquiera la manda a mano): solo vale un código del catálogo.
  const enCookie = almacen.get(COOKIE_RECHAZO)?.value ?? "";
  const rechazo = avisoConocido(enCookie) ? enCookie : null;
  return (
    <>
      <BarraSuperior>
        <p className="barra-titulo">{titulo}</p>
        <span className="barra-espacio" />
        {accion}
        {/* La persona y su menú van al pie del lateral (MarcoOperacion). Sin JavaScript ese menú no abre, y en pantallas
            angostas el cajón tampoco: «Salir» queda aquí, a la vista, con la misma acción. */}
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
