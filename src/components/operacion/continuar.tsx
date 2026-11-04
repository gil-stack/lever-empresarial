"use client";

import { useState } from "react";
import { useActionState } from "react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";

import {
  abrirPortalOperacion,
  opcionesPasskeyOperacion,
  opcionesRegistroOperacion,
  registrarPasskeyOperacion,
  registrarTotpOperacion,
  verificarPasskeyOperacion,
  verificarRespaldoOperacion,
  verificarTotpOperacion,
} from "@/app/operacion/acciones-autenticacion";
import { ESTADO_ACCESO_INICIAL, type AltaOperacion, type PasoOperacion } from "@/app/operacion/tipos-acceso";

export function ContinuarOperacion({ paso, alta, yaInscrito = false }: { paso: PasoOperacion; alta: AltaOperacion; yaInscrito?: boolean }) {
  const [codigos, setCodigos] = useState<string[] | null>(null);
  if (codigos) return <Codigos codigos={codigos} />;
  if (yaInscrito) return <Abrir />;
  if (paso.paso === "inscribir") return <Inscribir alta={alta} alGuardar={setCodigos} />;
  if (paso.paso === "recuperar") {
    return <><p className="arco-kicker">Segundo factor</p><h1>La cuenta sigue cerrada.</h1><p className="arco-nota">Otra persona del personal debe revisar la recuperación desde la puerta general de Lever.</p></>;
  }
  return <Verificar paso={paso} />;
}

function Verificar({ paso }: { paso: Extract<PasoOperacion, { paso: "verificar" }> }) {
  const [error, setError] = useState<string | null>(null);
  const [totp, enviarTotp, pendienteTotp] = useActionState(verificarTotpOperacion, ESTADO_ACCESO_INICIAL);
  const [respaldo, enviarRespaldo, pendienteRespaldo] = useActionState(verificarRespaldoOperacion, ESTADO_ACCESO_INICIAL);
  const mensaje = error ?? (totp.tipo === "error" ? totp.mensaje : null) ?? (respaldo.tipo === "error" ? respaldo.mensaje : null);

  async function conPasskey() {
    setError(null);
    try {
      const pedido = await opcionesPasskeyOperacion();
      if (pedido.tipo === "error") return setError(pedido.mensaje);
      const respuesta = await startAuthentication({ optionsJSON: pedido.opciones as PublicKeyCredentialRequestOptionsJSON });
      const resultado = await verificarPasskeyOperacion(respuesta);
      if (resultado.tipo === "error") setError(resultado.mensaje);
    } catch (causa) {
      if (causa instanceof Error && causa.message.includes("NEXT_REDIRECT")) throw causa;
      setError("No se pudo usar la passkey.");
    }
  }

  return (
    <div>
      <p className="arco-kicker">Segundo factor · Operación</p>
      <h1>Hola, {paso.nombre}.</h1>
      <p className="arco-nota">Confirma tu identidad para abrir la superficie SOFIPO.</p>
      {mensaje ? <div className="alerta" role="alert"><p>{mensaje}</p></div> : null}
      <div className="arco-opciones">
        {paso.passkey ? <button type="button" className="boton" onClick={conPasskey}>Entrar con passkey</button> : null}
        {paso.totp ? (
          <form action={enviarTotp}>
            <div className="campo"><label htmlFor="codigo">Código de la app autenticadora</label><input id="codigo" name="codigo" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required /></div>
            <button className="boton" disabled={pendienteTotp}>{pendienteTotp ? "Comprobando…" : "Entrar con el código"}</button>
          </form>
        ) : null}
        {paso.respaldo ? (
          <form action={enviarRespaldo}>
            <div className="campo"><label htmlFor="respaldo">Código de respaldo</label><input id="respaldo" name="codigo" autoComplete="off" required /></div>
            <button className="boton-texto" disabled={pendienteRespaldo}>Usar un código de respaldo</button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

function Inscribir({ alta, alGuardar }: { alta: AltaOperacion; alGuardar: (codigos: string[]) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [estado, registrarTotp, pendiente] = useActionState(registrarTotpOperacion, ESTADO_ACCESO_INICIAL);
  if (estado.tipo === "codigos") return <Codigos codigos={estado.codigos} />;

  async function conPasskey() {
    setError(null);
    try {
      const pedido = await opcionesRegistroOperacion();
      if (pedido.tipo === "error") return setError(pedido.mensaje);
      const respuesta = await startRegistration({ optionsJSON: pedido.opciones as PublicKeyCredentialCreationOptionsJSON });
      const resultado = await registrarPasskeyOperacion(respuesta, "Dispositivo de operación");
      if (resultado.tipo === "codigos") alGuardar(resultado.codigos);
      else if (resultado.tipo === "error") setError(resultado.mensaje ?? "No se pudo registrar.");
    } catch (causa) {
      if (causa instanceof Error && causa.message.includes("NEXT_REDIRECT")) throw causa;
      setError("No se pudo crear la passkey.");
    }
  }

  const mensaje = error ?? (estado.tipo === "error" ? estado.mensaje : null);
  return (
    <div>
      <p className="arco-kicker">Primer ingreso · Operación</p>
      <h1>Registra tu segundo factor.</h1>
      {mensaje ? <div className="alerta" role="alert"><p>{mensaje}</p></div> : null}
      <div className="arco-opciones">
        <button type="button" className="boton" onClick={conPasskey}>Crear una passkey</button>
        {alta ? (
          <form action={registrarTotp}>
            <p className="arco-nota">Escanea el código con tu app autenticadora.</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="arco-qr" alt="Código QR para la app autenticadora" src={alta.qr} width={196} height={196} />
            <p className="arco-semilla">{alta.semilla}</p>
            <div className="campo"><label htmlFor="codigo-alta">Código que muestra la app</label><input id="codigo-alta" name="codigo" inputMode="numeric" maxLength={6} required /></div>
            <button className="boton-texto" disabled={pendiente}>Confirmar el código</button>
          </form>
        ) : <p className="arco-nota">Si la app no está disponible, usa una passkey.</p>}
      </div>
    </div>
  );
}

function Codigos({ codigos }: { codigos: string[] }) {
  return (
    <div>
      <p className="arco-kicker">Una sola vez</p>
      <h1>Guarda tus códigos de respaldo.</h1>
      <p className="arco-nota">No volverán a mostrarse. Cada uno sirve una vez.</p>
      <ul className="operacion-codigos">{codigos.map((codigo) => <li key={codigo}><code>{codigo}</code></li>)}</ul>
      <Abrir />
    </div>
  );
}

function Abrir() {
  return <form action={abrirPortalOperacion}><button className="boton" type="submit">Abrir operación</button></form>;
}
