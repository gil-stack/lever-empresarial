"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useActionState, useContext, useId, useState, type ReactNode } from "react";

import { decidirPagoSinScript, type DecisionSinScript } from "@/app/consola/aprobaciones/acciones";
import { decidirPago } from "@/app/consola/proveedores/acciones-pagos";
import { ESTADO_PAGO_INICIAL, type EstadoPagoFormulario } from "@/app/consola/proveedores/estado";
import { enviarSinReiniciar, useEnvioConBoton } from "@/components/proveedores/sin-reinicio";
import { Aviso, BotonEnviar, Dialogo } from "@/components/sistema";

const SIN_DECIDIR: DecisionSinScript = { tipo: "inicial" };

type Bandeja = {
  avisar: (texto: string) => void;
  /** Lo que devolvió una decisión enviada sin JavaScript, y la acción que la recibe. */
  sinScript: DecisionSinScript;
  accionSinScript: (datos: FormData) => void;
  /** El pago cuyo rechazo se abrió con la dirección (`?rechazar=…`), sin JavaScript. */
  rechazar: string | null;
};

const BandejaDePagos = createContext<Bandeja>({ avisar: () => {}, sinScript: SIN_DECIDIR, accionSinScript: () => {}, rechazar: null });

/**
 * Al decidir, la acción vuelve a pintar la página y la fila decidida ya no
 * está. El aviso vive aquí, fuera de las filas, para que la confirmación no se
 * vaya con ella: la fila lo enciende desde la acción misma, no desde un efecto
 * que ya no correría porque la fila se desmonta en el mismo cuadro.
 *
 * Sin JavaScript, los formularios de las filas envían a `accionSinScript`, que vive aquí por lo mismo: la página
 * vuelve pintada con su resultado y la fila decidida ya no está para recibirlo.
 */
export function ConAvisoDeDecision({ rechazar = null, children }: { rechazar?: string | null; children: ReactNode }) {
  const [aviso, setAviso] = useState<string | null>(null);
  const [sinScript, accionSinScript] = useActionState(decidirPagoSinScript, SIN_DECIDIR);
  const asentado = aviso ?? (sinScript.tipo === "listo" ? sinScript.mensaje : null);
  return (
    <BandejaDePagos value={{ avisar: setAviso, sinScript, accionSinScript, rechazar }}>
      <div className="aprobaciones-aviso" aria-live="polite">
        {asentado ? <Aviso tono="asentado" titulo="Decisión asentada">{asentado}</Aviso> : null}
      </div>
      {children}
    </BandejaDePagos>
  );
}

/**
 * Autorizar o rechazar un pago desde la bandeja con la misma acción y las
 * mismas reglas que el detalle de Proveedores: la decisión viaja con la
 * versión y el importe que la persona tiene en pantalla, autorizar exige un
 * segundo factor reciente y rechazar pide el motivo.
 *
 * Sin JavaScript también decide: «Rechazar» es un formulario que pide la misma página con `?rechazar=<pago>`, y esa
 * fila la pinta con el rechazo abierto debajo de sus botones; «Autorizar» y el rechazo envían a la acción del
 * servidor. Con JavaScript, `onSubmit` toma el envío (y React ya no llama a la acción del formulario).
 */
export function DecisionPagoEnBandeja({
  requestId,
  version,
  totalCentavos,
  proveedor,
  soloRechazo,
}: {
  requestId: string;
  version: number;
  totalCentavos: number;
  proveedor: string;
  soloRechazo: boolean;
}) {
  const { avisar, sinScript, accionSinScript, rechazar } = useContext(BandejaDePagos);
  const pagina = usePathname();
  const [abierto, setAbierto] = useState(false);
  const [estado, accion, pendiente] = useActionState(async (previo: EstadoPagoFormulario, datos: FormData) => {
    const resultado = await decidirPago(previo, datos);
    if (resultado.tipo === "listo") {
      setAbierto(false);
      avisar(`${proveedor}: ${resultado.mensaje}`);
    }
    return resultado;
  }, ESTADO_PAGO_INICIAL);
  const { enviar, oprimido } = useEnvioConBoton(accion);
  const motivo = useId();

  // Una decisión sin JavaScript que el servidor no aceptó vuelve con lo escrito; solo la fila de ese pago la muestra.
  const devuelta = sinScript.tipo === "invalido" && sinScript.requestId === requestId ? sinScript : null;
  const visto: EstadoPagoFormulario =
    estado.tipo === "inicial" && devuelta ? { tipo: "invalido", mensaje: devuelta.mensaje, campo: devuelta.campo } : estado;
  const enLinea = rechazar === requestId || devuelta?.decision === "rechazar";
  const motivoFalla = visto.tipo === "invalido" && visto.campo === "motivo";
  const ocultos = (
    <>
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="totalCentavos" value={totalCentavos} />
    </>
  );
  const rechazo = (dentro: "dialogo" | "linea") => {
    const campo = dentro === "linea" ? `${motivo}-linea` : motivo;
    const aviso = `${campo}-error`;
    return (
      <form action={accionSinScript} onSubmit={enviar} className="aprobaciones-dialogo-forma">
        {ocultos}
        <div className="campo">
          <label htmlFor={campo}>Motivo</label>
          <textarea
            id={campo}
            name="motivo"
            rows={3}
            maxLength={500}
            required
            minLength={5}
            defaultValue={devuelta?.motivo}
            // Sin JavaScript nadie mueve el foco: el atributo lo deja en el motivo al abrir o al volver con el aviso.
            autoFocus={dentro === "linea"}
            aria-invalid={motivoFalla || undefined}
            aria-describedby={visto.tipo === "invalido" ? aviso : undefined}
          />
          {visto.tipo === "invalido" ? (
            <p className="error-campo" id={aviso} role="alert">
              {visto.mensaje}
            </p>
          ) : null}
        </div>
        <div className="dialogo-pie">
          {dentro === "dialogo" ? (
            <button type="button" className="boton-texto" onClick={() => setAbierto(false)}>
              Cancelar
            </button>
          ) : (
            <Link href={pagina} className="boton-texto">
              Cancelar
            </Link>
          )}
          <BotonEnviar name="decision" value="rechazar" pendiente={pendiente && oprimido === "rechazar"} disabled={pendiente}>
            Rechazar
          </BotonEnviar>
        </div>
      </form>
    );
  };
  const explicacion = `Vas a rechazar el pago a ${proveedor}. Quien lo solicitó ve el motivo y puede corregirlo; queda en la bitácora.`;

  return (
    <>
      {visto.tipo === "invalido" && !abierto && !enLinea ? (
        <p className="error-campo aprobaciones-error" role="alert">
          {visto.mensaje}
        </p>
      ) : null}
      {enLinea ? null : (
        // Sin JavaScript, el botón pide la misma página con el rechazo de este pago abierto.
        <form method="get" className="aprobaciones-abrir-rechazo">
          <input type="hidden" name="rechazar" value={requestId} />
          <button
            type="submit"
            className="boton-texto"
            data-atajo="rechazar"
            disabled={pendiente}
            onClick={(evento) => {
              evento.preventDefault();
              setAbierto(true);
            }}
          >
            Rechazar
          </button>
        </form>
      )}
      {soloRechazo ? null : (
        <form action={accionSinScript} onSubmit={enviarSinReiniciar(accion)}>
          {ocultos}
          <BotonEnviar name="decision" value="autorizar" data-atajo="aprobar" pendiente={pendiente} enviando="Autorizando…">
            Autorizar
          </BotonEnviar>
        </form>
      )}
      {enLinea ? (
        // Un diálogo abierto, no modal: se ve sin JavaScript y los atajos de la bandeja no deciden desde él.
        <dialog open className="aprobaciones-rechazo-en-linea" aria-label="Rechazar el pago">
          <p className="dialogo-sub">{explicacion}</p>
          {rechazo("linea")}
        </dialog>
      ) : (
        <Dialogo abierto={abierto} alCerrar={() => setAbierto(false)} titulo="Rechazar el pago" explicacion={explicacion} pie={null}>
          {rechazo("dialogo")}
        </Dialogo>
      )}
    </>
  );
}
