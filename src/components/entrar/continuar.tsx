"use client";

import { useState } from "react";
import { useActionState } from "react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";

import { FACTOR_INICIAL } from "@/app/entrar/estado";
import {
  enviarInscripcionTotp,
  enviarPasskey,
  enviarRecuperacion,
  enviarRegistroPasskey,
  enviarRespaldo,
  enviarTotp,
  pedirOpcionesPasskey,
  pedirRegistroPasskey,
} from "@/app/entrar/acciones";
import type { AltaTotp, PasoEntrada } from "@/nucleo/autenticacion-tipos";
import { BotonEnviar } from "@/components/sistema/boton-enviar";

import { CodigosDeRespaldo, ListoParaEntrar } from "./codigos";

export function Continuar({
  paso,
  siguiente,
  alta,
  sinTotp,
  yaInscrito = false,
}: {
  paso: PasoEntrada;
  siguiente: string;
  alta: AltaTotp | null;
  sinTotp: boolean;
  yaInscrito?: boolean;
}) {
  const [codigos, setCodigos] = useState<string[] | null>(null);
  if (codigos) return <CodigosDeRespaldo codigos={codigos} destino={siguiente} />;
  if (paso.paso === "inscribir") {
    return (
      <Inscribir
        siguiente={siguiente}
        alta={alta}
        sinTotp={sinTotp}
        alGuardar={setCodigos}
        yaInscrito={yaInscrito}
        porRecuperacion={paso.porRecuperacion}
      />
    );
  }
  if (paso.paso === "recuperar") return <Recuperar nombre={paso.nombre} solicitudAbierta={paso.solicitudAbierta} />;
  return <Verificar paso={paso} siguiente={siguiente} />;
}

function Verificar({
  paso,
  siguiente,
}: {
  paso: Extract<PasoEntrada, { paso: "verificar" }>;
  siguiente: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [perdi, setPerdi] = useState(false);
  const [totp, enviarCodigo, pendienteTotp] = useActionState(enviarTotp, FACTOR_INICIAL);
  const [respaldo, enviarCodigoRespaldo, pendienteRespaldo] = useActionState(enviarRespaldo, FACTOR_INICIAL);
  const mensaje = error ?? (totp.tipo === "error" ? totp.mensaje : null) ?? (respaldo.tipo === "error" ? respaldo.mensaje : null);

  async function conPasskey() {
    setError(null);
    try {
      const pedido = await pedirOpcionesPasskey();
      if (pedido.tipo === "error") {
        setError(pedido.mensaje);
        return;
      }
      const respuesta = await startAuthentication({
        optionsJSON: pedido.opciones as PublicKeyCredentialRequestOptionsJSON,
      });
      const resultado = await enviarPasskey(respuesta, siguiente);
      if (resultado?.tipo === "error") setError(resultado.mensaje);
    } catch (causa) {
      if (causa instanceof Error && causa.message.includes("NEXT_REDIRECT")) throw causa;
      setError(causa instanceof Error && causa.name === "NotAllowedError" ? "No se usó la passkey." : "No se pudo usar la passkey.");
    }
  }

  if (perdi) return <Recuperar nombre={paso.nombre} solicitudAbierta={paso.solicitudAbierta} />;

  return (
    <div>
      <p className="arco-kicker">Segundo factor</p>
      <h1>Hola, {paso.nombre}.</h1>
      <p className="arco-nota">La contraseña ya coincidió. Falta confirmar que eres tú.</p>
      {mensaje ? (
        <div className="alerta" role="alert" id="factor-error">
          <p>{mensaje}</p>
        </div>
      ) : null}
      {paso.solicitudAbierta ? <p className="arco-nota">Tu solicitud de recuperación sigue en revisión.</p> : null}
      <div className="arco-opciones">
        {paso.passkey ? (
          <button type="button" className="boton" onClick={conPasskey}>
            Entrar con passkey
          </button>
        ) : null}
        {paso.totp ? (
          <form action={enviarCodigo}>
            <input type="hidden" name="siguiente" value={siguiente} />
            <div className="campo">
              <label htmlFor="codigo">Código de la app autenticadora</label>
              <input
                id="codigo"
                name="codigo"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                {...ligarError(totp.tipo === "error")}
              />
            </div>
            <BotonEnviar pendiente={pendienteTotp} enviando="Comprobando…">
              Entrar con el código
            </BotonEnviar>
          </form>
        ) : null}
        {paso.respaldo ? (
          <form action={enviarCodigoRespaldo}>
            <input type="hidden" name="siguiente" value={siguiente} />
            <div className="campo">
              <label htmlFor="respaldo">Código de respaldo</label>
              <input id="respaldo" name="codigo" autoComplete="off" spellCheck={false} required {...ligarError(respaldo.tipo === "error")} />
            </div>
            <BotonEnviar className="boton-texto" pendiente={pendienteRespaldo} enviando="Comprobando…">
              Usar un código de respaldo
            </BotonEnviar>
          </form>
        ) : null}
      </div>
      <button type="button" className="arco-enlace" onClick={() => setPerdi(true)}>
        Perdí el segundo factor
      </button>
    </div>
  );
}

function Inscribir({
  siguiente,
  alta,
  sinTotp,
  alGuardar,
  yaInscrito,
  porRecuperacion,
}: {
  siguiente: string;
  alta: AltaTotp | null;
  sinTotp: boolean;
  alGuardar: (codigos: string[]) => void;
  yaInscrito: boolean;
  porRecuperacion: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [totp, enviarCodigo, pendiente] = useActionState(enviarInscripcionTotp, FACTOR_INICIAL);
  const mensaje = error ?? (totp.tipo === "error" ? totp.mensaje : null);
  if (totp.tipo === "codigos") return <CodigosDeRespaldo codigos={totp.codigos} destino={siguiente} />;
  if (yaInscrito) return <ListoParaEntrar siguiente={siguiente} />;

  async function conPasskey() {
    setError(null);
    try {
      const pedido = await pedirRegistroPasskey();
      if (pedido.tipo === "error") {
        setError(pedido.mensaje);
        return;
      }
      const respuesta = await startRegistration({
        optionsJSON: pedido.opciones as PublicKeyCredentialCreationOptionsJSON,
      });
      const resultado = await enviarRegistroPasskey(respuesta, "Este dispositivo");
      if (resultado.tipo === "codigos") alGuardar(resultado.codigos);
      else setError(resultado.mensaje);
    } catch (causa) {
      if (causa instanceof Error && causa.message.includes("NEXT_REDIRECT")) throw causa;
      setError(causa instanceof Error && causa.name === "NotAllowedError" ? "No se creó la passkey." : "No se pudo crear la passkey.");
    }
  }

  return (
    <div>
      <p className="arco-kicker">{porRecuperacion ? "Recuperación aprobada" : "Primer ingreso"}</p>
      <h1>{porRecuperacion ? "Registra un factor nuevo." : "Registra cómo vas a entrar."}</h1>
      <p className="arco-nota">
        {porRecuperacion
          ? "Al confirmarlo, tus passkeys, tu app autenticadora y tus códigos de respaldo anteriores dejan de servir y se cierran tus otras sesiones."
          : "Elige una passkey o una app autenticadora. Con eso entras cada vez."}
      </p>
      {mensaje ? (
        <div className="alerta" role="alert" id="factor-error">
          <p>{mensaje}</p>
        </div>
      ) : null}
      <div className="arco-opciones">
        <button type="button" className="boton" onClick={conPasskey}>
          Crear una passkey
        </button>
        {alta ? (
          <form action={enviarCodigo}>
            <input type="hidden" name="siguiente" value={siguiente} />
            <p className="arco-nota">O escanea el código con Google Authenticator, Microsoft Authenticator u otra app compatible.</p>
            {/* QR generado al vuelo como data URI. next/image no lo optimiza. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="arco-qr" alt="Código QR para la app autenticadora" src={alta.qr} width={196} height={196} />
            <p className="arco-semilla">{alta.semilla}</p>
            <div className="campo">
              <label htmlFor="codigo-alta">Código que muestra la app</label>
              <input
                id="codigo-alta"
                name="codigo"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                {...ligarError(totp.tipo === "error")}
              />
            </div>
            <BotonEnviar className="boton-texto" pendiente={pendiente} enviando="Comprobando…">
              Confirmar el código
            </BotonEnviar>
          </form>
        ) : null}
        {sinTotp ? <p className="arco-nota">La app autenticadora no está disponible en este entorno. Usa una passkey.</p> : null}
      </div>
    </div>
  );
}

function Recuperar({ nombre, solicitudAbierta }: { nombre: string; solicitudAbierta: boolean }) {
  const [estado, accion, pendiente] = useActionState(enviarRecuperacion, FACTOR_INICIAL);
  return (
    <div>
      <p className="arco-kicker">Recuperación</p>
      <h1>{nombre}, la cuenta sigue cerrada.</h1>
      <p className="arco-nota">
        Si guardaste un código de respaldo, entra con él. Si no, pide ayuda: el equipo de Lever confirma que eres tú y
        después registras un factor nuevo. Pedir ayuda no quita nada; al registrar el nuevo, los anteriores dejan de
        servir.
      </p>
      {solicitudAbierta ? (
        <p className="arco-nota">Tu solicitud ya está en revisión.</p>
      ) : (
        <form action={accion}>
          {estado.tipo === "error" ? (
            <div className="alerta" role="alert" id="factor-error">
              <p>{estado.mensaje}</p>
            </div>
          ) : null}
          <div className="campo">
            <label htmlFor="motivo">Qué pasó</label>
            <input
              id="motivo"
              name="motivo"
              maxLength={500}
              required
              placeholder="Perdí el teléfono con la app"
              {...ligarError(estado.tipo === "error")}
            />
          </div>
          <BotonEnviar pendiente={pendiente}>Pedir recuperación</BotonEnviar>
        </form>
      )}
    </div>
  );
}

/** El error de la tarjeta se liga al campo que lo causó. */
function ligarError(conError: boolean) {
  return conError ? ({ "aria-invalid": true, "aria-describedby": "factor-error" } as const) : {};
}
