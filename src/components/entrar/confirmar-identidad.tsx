"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { startAuthentication } from "@simplewebauthn/browser";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";

import {
  confirmarIdentidadConPasskey,
  confirmarIdentidadConRespaldo,
  confirmarIdentidadConTotp,
  pedirOpcionesDeConfirmacion,
} from "@/app/entrar/acciones-confirmacion";
import { CONFIRMACION_INICIAL, type EstadoConfirmacion } from "@/app/entrar/estado-confirmacion";

/**
 * «Confirma que eres tú». Reusa la verificación de la puerta: passkey, código
 * de la app o código de respaldo. Al confirmar, la página vuelve a leerse con
 * el factor de la sesión renovado.
 */
export function ConfirmarIdentidad({
  passkey,
  totp,
  respaldo,
  motivo,
  alConfirmar,
}: {
  passkey: boolean;
  totp: boolean;
  respaldo: boolean;
  motivo: string;
  alConfirmar?: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [conTotp, enviarTotp, pendienteTotp] = useActionState(confirmarIdentidadConTotp, CONFIRMACION_INICIAL);
  const [conRespaldo, enviarRespaldo, pendienteRespaldo] = useActionState(
    confirmarIdentidadConRespaldo,
    CONFIRMACION_INICIAL,
  );
  const confirmada = conTotp.tipo === "confirmada" || conRespaldo.tipo === "confirmada";

  useEffect(() => {
    if (!confirmada) return;
    alConfirmar?.();
    router.refresh();
  }, [confirmada, alConfirmar, router]);

  async function conPasskey() {
    setError(null);
    try {
      const pedido = await pedirOpcionesDeConfirmacion();
      if (pedido.tipo === "error") {
        setError(pedido.mensaje);
        return;
      }
      const respuesta = await startAuthentication({
        optionsJSON: pedido.opciones as PublicKeyCredentialRequestOptionsJSON,
      });
      const resultado: EstadoConfirmacion = await confirmarIdentidadConPasskey(respuesta);
      if (resultado.tipo === "error") setError(resultado.mensaje);
      if (resultado.tipo === "confirmada") {
        alConfirmar?.();
        router.refresh();
      }
    } catch (causa) {
      if (causa instanceof Error && causa.message.includes("NEXT_REDIRECT")) throw causa;
      setError(causa instanceof Error && causa.name === "NotAllowedError" ? "No se usó la passkey." : "No se pudo usar la passkey.");
    }
  }

  const mensaje =
    error ?? (conTotp.tipo === "error" ? conTotp.mensaje : null) ?? (conRespaldo.tipo === "error" ? conRespaldo.mensaje : null);

  return (
    <section className="confirmar-identidad" aria-labelledby="confirmar-identidad-titulo">
      <h2 id="confirmar-identidad-titulo">Confirma que eres tú</h2>
      <p className="arco-nota">{motivo}</p>
      {mensaje ? (
        <div className="alerta" role="alert">
          <p>{mensaje}</p>
        </div>
      ) : null}
      {passkey ? (
        <button type="button" className="boton" onClick={conPasskey}>
          Confirmar con passkey
        </button>
      ) : null}
      {totp ? (
        <form action={enviarTotp}>
          <div className="campo">
            <label htmlFor="confirmar-codigo">Código de la app autenticadora</label>
            <input id="confirmar-codigo" name="codigo" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required />
          </div>
          <button type="submit" className="boton" disabled={pendienteTotp}>
            {pendienteTotp ? "Comprobando…" : "Confirmar con el código"}
          </button>
        </form>
      ) : null}
      {respaldo ? (
        <form action={enviarRespaldo}>
          <div className="campo">
            <label htmlFor="confirmar-respaldo">Código de respaldo</label>
            <input id="confirmar-respaldo" name="codigo" autoComplete="off" spellCheck={false} required />
          </div>
          <button type="submit" className="boton-texto" disabled={pendienteRespaldo}>
            Usar un código de respaldo
          </button>
        </form>
      ) : null}
    </section>
  );
}
