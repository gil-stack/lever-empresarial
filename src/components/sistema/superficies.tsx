"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { IconoCerrar, IconoPendientes } from "@/components/cromo/iconos";

/**
 * <dialog> modal: el navegador atrapa el foco, Escape cierra y el foco vuelve
 * a quien lo abrió. `alCerrar` se llama con Escape, el velo o el botón.
 */
function useDialogo(abierto: boolean, alCerrar: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialogo = ref.current;
    if (!dialogo) return;
    if (abierto && !dialogo.open) dialogo.showModal();
    if (!abierto && dialogo.open) dialogo.close();
  }, [abierto]);
  const props = {
    ref,
    onClose: alCerrar,
    // Un clic en el velo cae sobre el propio <dialog>, fuera de su contenido.
    onClick: (evento: React.MouseEvent<HTMLDialogElement>) => {
      if (evento.target === evento.currentTarget) alCerrar();
    },
  };
  return props;
}

/** El modal del diseño: título en Sora fina, explicación y botones al pie. Para lo irreversible. */
export function Dialogo({
  abierto,
  alCerrar,
  titulo,
  explicacion,
  pie,
  children,
}: {
  abierto: boolean;
  alCerrar: () => void;
  titulo: string;
  explicacion?: ReactNode;
  pie: ReactNode;
  children?: ReactNode;
}) {
  const props = useDialogo(abierto, alCerrar);
  return (
    <dialog className="dialogo" aria-label={titulo} {...props}>
      <div className="dialogo-cuerpo">
        <h2>{titulo}</h2>
        {explicacion ? <p className="dialogo-sub">{explicacion}</p> : null}
        {children}
        <div className="dialogo-pie">{pie}</div>
      </div>
    </dialog>
  );
}

/** El panel lateral de detalle del diseño: entra desde la derecha sobre la página. */
export function PanelDetalle({
  abierto,
  alCerrar,
  titulo,
  contexto,
  children,
}: {
  abierto: boolean;
  alCerrar: () => void;
  titulo: string;
  /** Línea corta arriba, junto al botón de cerrar. */
  contexto?: string;
  children: ReactNode;
}) {
  const props = useDialogo(abierto, alCerrar);
  return (
    <dialog className="panel-detalle" aria-label={titulo} {...props}>
      <div className="panel-detalle-cabeza">
        <small className="pista">{contexto}</small>
        <button type="button" className="boton-texto boton-chico" onClick={alCerrar}>
          <IconoCerrar />
          Cerrar
        </button>
      </div>
      <div className="panel-detalle-cuerpo">
        <h2>{titulo}</h2>
        {children}
      </div>
    </dialog>
  );
}

/**
 * El aviso de abajo: confirma lo que acaba de pasar y, si se puede, ofrece «Deshacer»
 * durante 5.5 s (2.6 s si no hay nada que deshacer), como el diseño.
 */
export function AvisoInferior({
  mensaje,
  alDeshacer,
  alTerminar,
}: {
  mensaje: string | null;
  alDeshacer?: () => void;
  alTerminar: () => void;
}) {
  useEffect(() => {
    if (!mensaje) return;
    const reloj = window.setTimeout(alTerminar, alDeshacer ? 5500 : 2600);
    return () => window.clearTimeout(reloj);
  }, [mensaje, alDeshacer, alTerminar]);

  return (
    <div className="aviso-inferior-region" role="status" aria-live="polite">
      {mensaje ? (
        <div className="aviso-inferior">
          <IconoPendientes />
          <span>{mensaje}</span>
          {alDeshacer ? (
            <button
              type="button"
              className="aviso-inferior-deshacer"
              onClick={() => {
                alDeshacer();
                alTerminar();
              }}
            >
              Deshacer
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Interruptor de encendido y apagado (diseño .sw). */
export function Interruptor({
  etiqueta,
  encendido,
  alCambiar,
}: {
  etiqueta: string;
  encendido: boolean;
  alCambiar: (valor: boolean) => void;
}) {
  return (
    <button
      type="button"
      className="interruptor"
      role="switch"
      aria-checked={encendido}
      aria-label={etiqueta}
      onClick={() => alCambiar(!encendido)}
    />
  );
}
