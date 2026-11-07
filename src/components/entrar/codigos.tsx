"use client";

import { useState } from "react";

import { abrirPortal } from "@/app/entrar/acciones";
import { BotonEnviar } from "@/components/sistema/boton-enviar";

/**
 * Se muestran una vez. En la base solo queda el hash. Al entrar, `destino` abre el portal; desde
 * Seguridad, `alTerminar` vuelve a la misma página (abrirPortal solo lleva a la consola o al teléfono).
 */
export function CodigosDeRespaldo({
  codigos,
  ...salida
}: { codigos: string[] } & ({ destino: string } | { alTerminar: () => void })) {
  const [guardados, setGuardados] = useState(false);
  const confirmacion = (
    <label className="campo-confirmacion">
      <input type="checkbox" checked={guardados} onChange={(evento) => setGuardados(evento.target.checked)} />
      Ya los guardé en un lugar seguro
    </label>
  );
  return (
    <div>
      <p className="arco-kicker">Guárdalos ahora</p>
      <h1>Códigos de respaldo.</h1>
      <p className="arco-nota">
        Cada uno entra una sola vez, si no tienes a la mano la passkey ni la app. No se vuelven a mostrar.
      </p>
      <ul className="arco-codigos">
        {codigos.map((codigo) => (
          <li key={codigo}>{codigo}</li>
        ))}
      </ul>
      {"alTerminar" in salida ? (
        <>
          {confirmacion}
          <div className="acciones">
            <button type="button" className="boton" disabled={!guardados} onClick={salida.alTerminar}>
              Volver a Seguridad
            </button>
          </div>
        </>
      ) : (
        <form action={abrirPortal}>
          <input type="hidden" name="siguiente" value={salida.destino} />
          {confirmacion}
          <div className="acciones">
            <BotonEnviar disabled={!guardados}>Entrar al portal</BotonEnviar>
          </div>
        </form>
      )}
    </div>
  );
}

/** Si la página se recargó, los códigos ya no están. La sesión sigue pendiente. */
export function ListoParaEntrar({ siguiente }: { siguiente: string }) {
  return (
    <div>
      <p className="arco-kicker">Segundo factor</p>
      <h1>Ya puedes entrar.</h1>
      <p className="arco-nota">Los códigos de respaldo se mostraron una sola vez. Si no los guardaste, podrás generar otros desde la cuenta.</p>
      <form action={abrirPortal}>
        <input type="hidden" name="siguiente" value={siguiente} />
        <BotonEnviar>Entrar al portal</BotonEnviar>
      </form>
    </div>
  );
}
