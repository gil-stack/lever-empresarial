export type UsuarioPublico = {
  id: string;
  nombre: string;
  correo: string;
};

export const METODOS_SEGUNDO_FACTOR = ["passkey", "totp", "respaldo"] as const;
export type MetodoSegundoFactor = (typeof METODOS_SEGUNDO_FACTOR)[number];

/**
 * La sesión dice quién es la persona y si ya verificó su segundo factor. No
 * dice en qué empresa está ni con qué rol: eso lo resuelve el contexto de
 * tenant con la empresa de la ruta.
 */
export type Sesion = {
  id: string;
  venceEn: Date;
  usuario: UsuarioPublico;
  /** Las lecturas de Postgres siempre la traen; los dobles antiguos pueden omitirla. */
  superficie?: "cliente" | "sofipo" | "telefono";
  /** Vacío: sesión parcial. Solo sirve para verificar el segundo factor. */
  segundoFactor: { metodo: MetodoSegundoFactor; en: Date } | null;
  /** Último uso registrado. Sin uso en 30 minutos la base ya no devuelve la sesión. */
  ultimoUsoEn?: Date;
};

export type SesionAbierta = {
  sesion: Sesion;
  setCookie: string;
};
