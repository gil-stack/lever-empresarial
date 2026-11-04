"use client";

import { useState } from "react";
import { useActionState } from "react";
import Link from "next/link";
import { startRegistration } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";

import { FACTOR_INICIAL } from "@/app/entrar/estado";
import {
  confirmarTotpDeCuenta,
  empezarTotpDeCuenta,
  guardarPasskeyDeCuenta,
  pedirPasskeyDeCuenta,
  regenerarCodigosDeCuenta,
  revocarPasskeyDeCuenta,
  revocarTotpDeCuenta,
} from "@/app/entrar/acciones";

import { CodigosDeRespaldo } from "./codigos";

export type PasskeyVisible = {
  id: string;
  nombre: string;
  creadaEn: string;
  ultimoUsoEn: string | null;
};

export function Seguridad({
  passkeys,
  totp,
  respaldoRestantes,
  esOperador,
  aviso,
}: {
  passkeys: PasskeyVisible[];
  totp: boolean;
  respaldoRestantes: number;
  esOperador: boolean;
  aviso: string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [alta, setAlta] = useState<{ qr: string; semilla: string } | null>(null);
  const [codigos, setCodigos] = useState<string[] | null>(null);
  const [confirmado, enviarCodigo, pendiente] = useActionState(confirmarTotpDeCuenta, FACTOR_INICIAL);

  if (codigos) return <CodigosDeRespaldo codigos={codigos} destino="/entrar/seguridad" />;

  async function agregarPasskey() {
    setError(null);
    const pedido = await pedirPasskeyDeCuenta();
    if (pedido.tipo === "error") {
      setError(pedido.mensaje);
      return;
    }
    try {
      const respuesta = await startRegistration({
        optionsJSON: pedido.opciones as PublicKeyCredentialCreationOptionsJSON,
      });
      const resultado = await guardarPasskeyDeCuenta(respuesta, "Este dispositivo");
      if (resultado?.tipo === "error") setError(resultado.mensaje);
    } catch (causa) {
      if (causa instanceof Error && causa.message.includes("NEXT_REDIRECT")) throw causa;
      setError(causa instanceof Error && causa.name === "NotAllowedError" ? "No se creó la passkey." : "No se pudo crear la passkey.");
    }
  }

  async function mostrarQr() {
    setError(null);
    const resultado = await empezarTotpDeCuenta();
    if (resultado.tipo === "alta") setAlta(resultado.alta);
    else if (resultado.tipo === "error") setError(resultado.mensaje);
  }

  async function regenerar() {
    setError(null);
    const resultado = await regenerarCodigosDeCuenta();
    if (resultado.tipo === "codigos") setCodigos(resultado.codigos);
    else if (resultado.tipo === "error") setError(resultado.mensaje);
  }

  const mensaje = error ?? (confirmado.tipo === "error" ? confirmado.mensaje : null) ?? aviso;

  return (
    <div>
      <p className="arco-kicker">Tu cuenta</p>
      <h1>Segundo factor.</h1>
      <p className="arco-nota">Puedes tener una passkey y una app. No se puede quitar el último método.</p>
      {mensaje ? (
        <div className="alerta" role="alert">
          <p>{mensaje}</p>
        </div>
      ) : null}
      <ul className="arco-lista">
        {passkeys.map((passkey) => (
          <li key={passkey.id}>
            <span>
              {passkey.nombre}
              <br />
              <small>Desde {passkey.creadaEn}</small>
            </span>
            <form action={revocarPasskeyDeCuenta}>
              <input type="hidden" name="passkey" value={passkey.id} />
              <button type="submit" className="boton-texto">
                Revocar
              </button>
            </form>
          </li>
        ))}
        {passkeys.length === 0 ? <li>No hay passkeys.</li> : null}
      </ul>
      <div className="arco-opciones">
        <button type="button" className="boton" onClick={agregarPasskey}>
          Agregar una passkey
        </button>
        {totp ? (
          <form action={revocarTotpDeCuenta}>
            <p className="arco-nota">La app autenticadora está activa.</p>
            <button type="submit" className="boton-texto">
              Revocar la app
            </button>
          </form>
        ) : (
          <button type="button" className="boton-texto" onClick={mostrarQr}>
            Configurar la app autenticadora
          </button>
        )}
        {alta ? (
          <form action={enviarCodigo}>
            {/* QR generado al vuelo como data URI. next/image no lo optimiza. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="arco-qr" alt="Código QR para la app autenticadora" src={alta.qr} width={196} height={196} />
            <p className="arco-semilla">{alta.semilla}</p>
            <div className="campo">
              <label htmlFor="codigo-cuenta">Código que muestra la app</label>
              <input id="codigo-cuenta" name="codigo" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required />
            </div>
            <button type="submit" className="boton" disabled={pendiente}>
              {pendiente ? "Comprobando…" : "Confirmar"}
            </button>
          </form>
        ) : null}
        <p className="arco-nota">Códigos de respaldo disponibles: {respaldoRestantes}.</p>
        <button type="button" className="boton-texto" onClick={regenerar}>
          Generar códigos nuevos
        </button>
      </div>
      {esOperador ? (
        <Link className="arco-enlace" href="/entrar/recuperaciones">
          Solicitudes de recuperación
        </Link>
      ) : null}
    </div>
  );
}
