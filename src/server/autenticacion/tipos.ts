export const METODOS = ["passkey", "totp", "respaldo"] as const;

export type MetodoSegundoFactor = (typeof METODOS)[number];

export type PasskeyPublica = {
  id: string;
  nombre: string;
  creadaEn: Date;
  ultimoUsoEn: Date | null;
  respaldada: boolean;
};

/** Lo que una pantalla puede saber. Sin semillas, sin llaves, sin códigos. */
export type Factores = {
  passkeys: PasskeyPublica[];
  totp: boolean;
  respaldoRestantes: number;
};

/**
 * Qué le toca a quien ya pasó la contraseña.
 * `verificar`: ya tiene un segundo factor.
 * `inscribir`: primer ingreso, o una recuperación aprobada y vigente.
 * `recuperar`: tuvo segundo factor, ya no lo tiene y nadie ha aprobado reponerlo.
 */
export type PasoEntrada =
  | {
      paso: "verificar";
      nombre: string;
      passkey: boolean;
      totp: boolean;
      respaldo: boolean;
      solicitudAbierta: boolean;
    }
  | { paso: "inscribir"; nombre: string; correo: string; porRecuperacion: boolean }
  | { paso: "recuperar"; nombre: string; solicitudAbierta: boolean };

export type RecuperacionPendiente = {
  id: string;
  nombre: string;
  correo: string;
  motivo: string;
  solicitadaEn: Date;
};

export type VerificacionIdentidad = "presencial" | "videollamada";

export type AltaTotp = {
  qr: string;
  semilla: string;
};

export type Inscripcion = {
  setCookie: string;
  codigos: string[];
};
