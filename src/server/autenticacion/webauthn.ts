import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";

import type { Origen } from "./origen";
import type { PasskeyGuardada, Persona } from "./repositorio";

/**
 * WebAuthn detrás de una interfaz chica, para probar el servicio sin
 * navegador. La firma, el origen y el contador los comprueba
 * @simplewebauthn/server. Aquí se fijan las reglas del producto: la passkey
 * exige verificación de la persona y no se pide atestación del fabricante.
 */

export const NOMBRE_RP = "Arco";

export type CredencialPublica = { credencialId: string; transportes: string[] };

export type CredencialRegistrada = {
  credencialId: string;
  llavePublica: Uint8Array;
  contador: number;
  transportes: string[];
  respaldada: boolean;
};

export type OpcionesWebauthn = { opciones: unknown; reto: string };

export type AdaptadorWebauthn = {
  opcionesRegistro: (args: { origen: Origen; persona: Persona; existentes: CredencialPublica[] }) => Promise<OpcionesWebauthn>;
  verificarRegistro: (args: { respuesta: unknown; reto: string; origen: Origen }) => Promise<CredencialRegistrada | null>;
  opcionesEntrada: (args: { origen: Origen; passkeys: CredencialPublica[] }) => Promise<OpcionesWebauthn>;
  verificarEntrada: (args: {
    respuesta: unknown;
    reto: string;
    origen: Origen;
    passkey: PasskeyGuardada;
  }) => Promise<{ contador: number } | null>;
};

export function credencialDeRespuesta(respuesta: unknown): string | null {
  if (typeof respuesta !== "object" || respuesta === null) return null;
  const id = (respuesta as { id?: unknown }).id;
  return typeof id === "string" && /^[A-Za-z0-9_-]{16,1400}$/.test(id) ? id : null;
}

const TRANSPORTES = new Set(["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"]);

function transportes(valores: readonly string[] | undefined): AuthenticatorTransportFuture[] {
  return (valores ?? []).filter((t): t is AuthenticatorTransportFuture => TRANSPORTES.has(t));
}

export function webauthnReal(): AdaptadorWebauthn {
  return {
    async opcionesRegistro({ origen, persona, existentes }) {
      const { generateRegistrationOptions } = await import("@simplewebauthn/server");
      const opciones = await generateRegistrationOptions({
        rpName: NOMBRE_RP,
        rpID: origen.rpID,
        userName: persona.correo,
        userDisplayName: persona.nombre,
        userID: new TextEncoder().encode(persona.id),
        attestationType: "none",
        excludeCredentials: existentes.map((c) => ({ id: c.credencialId, transports: transportes(c.transportes) })),
        authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
        timeout: 120_000,
      });
      return { opciones, reto: opciones.challenge };
    },
    async verificarRegistro({ respuesta, reto, origen }) {
      const { verifyRegistrationResponse } = await import("@simplewebauthn/server");
      try {
        const resultado = await verifyRegistrationResponse({
          response: respuesta as Parameters<typeof verifyRegistrationResponse>[0]["response"],
          expectedChallenge: reto,
          expectedOrigin: origen.origen,
          expectedRPID: origen.rpID,
          requireUserVerification: true,
        });
        if (!resultado.verified) return null;
        const { credential, credentialBackedUp } = resultado.registrationInfo;
        return {
          credencialId: credential.id,
          llavePublica: credential.publicKey,
          contador: credential.counter,
          transportes: transportes(credential.transports),
          respaldada: credentialBackedUp,
        };
      } catch {
        return null;
      }
    },
    async opcionesEntrada({ origen, passkeys }) {
      const { generateAuthenticationOptions } = await import("@simplewebauthn/server");
      const opciones = await generateAuthenticationOptions({
        rpID: origen.rpID,
        allowCredentials: passkeys.map((c) => ({ id: c.credencialId, transports: transportes(c.transportes) })),
        userVerification: "required",
        timeout: 120_000,
      });
      return { opciones, reto: opciones.challenge };
    },
    async verificarEntrada({ respuesta, reto, origen, passkey }) {
      const { verifyAuthenticationResponse } = await import("@simplewebauthn/server");
      try {
        const resultado = await verifyAuthenticationResponse({
          response: respuesta as Parameters<typeof verifyAuthenticationResponse>[0]["response"],
          expectedChallenge: reto,
          expectedOrigin: origen.origen,
          expectedRPID: origen.rpID,
          requireUserVerification: true,
          credential: {
            id: passkey.credencialId,
            publicKey: new Uint8Array(passkey.llavePublica),
            counter: passkey.contador,
            transports: transportes(passkey.transportes),
          },
        });
        return resultado.verified ? { contador: resultado.authenticationInfo.newCounter } : null;
      } catch {
        return null;
      }
    },
  };
}
