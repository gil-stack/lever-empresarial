export type PasoOperacion =
  | { paso: "verificar"; nombre: string; passkey: boolean; totp: boolean; respaldo: boolean; solicitudAbierta: boolean }
  | { paso: "inscribir"; nombre: string; correo: string; porRecuperacion: boolean }
  | { paso: "recuperar"; nombre: string; solicitudAbierta: boolean };

export type AltaOperacion = { qr: string; semilla: string } | null;

export type EstadoAcceso = { tipo: "inicial" | "error"; mensaje?: string } | { tipo: "codigos"; codigos: string[] };

export const ESTADO_ACCESO_INICIAL: EstadoAcceso = { tipo: "inicial" };
