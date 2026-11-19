import { randomBytes, randomUUID } from "node:crypto";

import { encabezadoDeSesion, VIGENCIA_SESION_MS } from "../session/cookie";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { hashearContrasena, hashDeToken, tokenNuevo, verificarContrasena } from "../session/hash";
import type { Sesion } from "../session/tipos";
import { correoValido, normalizarCorreo } from "../session/validar";
import { avisarPorCorreo, avisarSinDeshacer, type Avisar, type CambioDeSeguridad } from "../seguridad/avisos";
import { cifrarSemilla, descifrarSemilla } from "./cifrado";
import { cookieDeEntrada, VIGENCIA_ENTRADA_MS, type CookieEntrada } from "./cookie";
import { llaveTotpDesdeEntorno } from "./entorno";
import { qrComoDataUri } from "./qr";
import { exigirFactorReciente, factorReciente, VIGENCIA_FACTORES_MS } from "./reautenticacion";
import { repositorioPg, type CeremoniaTotp, type Entrada, type PropositoDeReto, type RepositorioAutenticacion } from "./repositorio";
import { codigosNuevos, hashDeRespaldo, normalizarRespaldo } from "./respaldo";
import type {
  AltaTotp,
  Factores,
  Inscripcion,
  PasoEntrada,
  RecuperacionPendiente,
  VerificacionIdentidad,
} from "./tipos";
import { normalizarCodigoTotp, semillaLegible, semillaNueva, uriOtpauth, verificarTotp } from "./totp";
import type { Origen } from "./origen";
import { credencialDeRespuesta, webauthnReal, type AdaptadorWebauthn } from "./webauthn";
import { CONTROL } from "../../dominio/control";

/**
 * Correo y contraseña abren una entrada, no el portal. La sesión —la cookie
 * `sesion` de src/server/session— nace aquí, cuando el segundo factor
 * coincide, con el mismo encabezado que arma esa capa.
 */

const TOPE_CONTRASENA = 8;
const VENTANA_CONTRASENA_MS = 15 * 60 * 1000;
/**
 * Todo rechazo de contraseña tarda al menos esto desde que llega. El correo sin
 * cuenta no cuenta fallos y la cuenta en el tope no anota el intento: sin el
 * piso, cada camino tardaría distinto y el tiempo diría qué correos tienen
 * cuenta. Cubre con holgura bcrypt más la escritura del fallo.
 */
export const PISO_RECHAZO_MS = 1_500;
/** Único texto para cualquier rechazo de contraseña: no dice si el correo existe ni si llegó al tope. */
export const RECHAZO_DE_CONTRASENA =
  "El correo o la contraseña no coinciden. Si fallaste varias veces, espera quince minutos.";
const TOPE_SEGUNDO_FACTOR = 5;
/**
 * Tope por persona, por encima del de cada entrada: diez códigos fallidos en quince
 * minutos, sumando todas sus entradas y las dos puertas (portal y Operación). Sin él,
 * con la contraseña se abrían entradas sin fin y cada una traía cinco intentos más.
 * Solo rige a quien tiene app autenticadora: sus seis dígitos son lo único que se
 * adivina. Una passkey no se adivina y un código de respaldo trae 80 bits de azar.
 */
export const TOPE_SEGUNDO_FACTOR_PERSONA = 10;
const VENTANA_SEGUNDO_FACTOR_MS = 15 * 60 * 1000;
const VIGENCIA_RETO_MS = 5 * 60 * 1000;
const VIGENCIA_RECUPERACION_MS = 12 * 60 * 60 * 1000;
const EMISOR = "Lever";
const VIGENCIA_ALTA_TOTP_MS = 10 * 60 * 1000;

type Hashear = (contrasena: string) => Promise<string>;
type Verificar = (contrasena: string, hash: string) => Promise<boolean>;

export type DependenciasAutenticacion = {
  repositorio?: RepositorioAutenticacion;
  ahora?: () => Date;
  token?: () => string;
  ids?: () => string;
  hashear?: Hashear;
  verificar?: Verificar;
  webauthn?: AdaptadorWebauthn;
  llaveTotp?: Buffer | null;
  operadores?: ReadonlySet<string>;
  codigos?: () => string[];
  semilla?: () => Buffer;
  /** La puerta de operación fija `sofipo`; el resto conserva `cliente`. */
  superficie?: "cliente" | "sofipo" | "telefono";
  /** Aviso por correo de cada cambio de factor. Si falla, se registra y el cambio sigue. */
  avisar?: Avisar;
  /** Espera del piso de rechazo. En la aplicación es un setTimeout. */
  esperar?: (ms: number) => Promise<void>;
  /** Reloj monótono para medir el piso de rechazo. */
  ahoraMs?: () => number;
};

/** Correo inexistente, contraseña mala y cuenta en el tope dan el mismo rechazo. */
export type ResultadoContrasena =
  | { tipo: "entrada"; cookie: CookieEntrada }
  | { tipo: "rechazo"; codigo: "credenciales_invalidas" };

type Listo = {
  repositorio: RepositorioAutenticacion;
  ahora: () => Date;
  token: () => string;
  ids: () => string;
  hashear: Hashear;
  verificar: Verificar;
  webauthn: AdaptadorWebauthn;
  llaveTotp: Buffer | null;
  operadores: ReadonlySet<string> | undefined;
  codigos: () => string[];
  semilla: () => Buffer;
  superficie: "cliente" | "sofipo" | "telefono";
  avisar: Avisar;
  esperar: (ms: number) => Promise<void>;
  ahoraMs: () => number;
};

const rellenos = new WeakMap<Hashear, Promise<string>>();

/**
 * Un rechazo no distingue el correo sin cuenta, la contraseña mala ni la cuenta
 * en el tope: mismo resultado y mismo tiempo (PISO_RECHAZO_MS). Un error de la
 * base también espera el piso. La entrada correcta no espera.
 */
export async function iniciarConContrasena(
  entrada: { correo?: string; contrasena?: string },
  deps?: DependenciasAutenticacion,
): Promise<ResultadoContrasena> {
  const listo = resolver(deps);
  const inicio = listo.ahoraMs();
  let abrio = false;
  try {
    const resultado = await probarContrasena(entrada, listo);
    abrio = resultado.tipo === "entrada";
    return resultado;
  } finally {
    if (!abrio) {
      const resta = PISO_RECHAZO_MS - (listo.ahoraMs() - inicio);
      if (resta > 0) await listo.esperar(resta);
    }
  }
}

async function probarContrasena(
  entrada: { correo?: string; contrasena?: string },
  listo: Listo,
): Promise<ResultadoContrasena> {
  const correo = typeof entrada?.correo === "string" ? normalizarCorreo(entrada.correo) : "";
  const contrasena = typeof entrada?.contrasena === "string" ? entrada.contrasena : "";
  if (!correoValido(correo) || contrasena.length === 0) return { tipo: "rechazo", codigo: "credenciales_invalidas" };

  const ahora = listo.ahora();
  const usuario = await listo.repositorio.buscarUsuarioPorCorreo(correo);
  const bloqueada = usuario
    ? (await listo.repositorio.contarFallosContrasena(
        usuario.id,
        new Date(ahora.getTime() - VENTANA_CONTRASENA_MS),
      )) >= TOPE_CONTRASENA
    : false;
  const coincide = await contrasenaCoincide(contrasena, usuario?.passwordHash ?? null, listo.hashear, listo.verificar);
  // En el tope el intento no se anota: el bloqueo sigue contando desde los fallos reales.
  if (bloqueada) return { tipo: "rechazo", codigo: "credenciales_invalidas" };
  if (!coincide || !usuario) {
    await listo.repositorio.registrarContrasenaFallida(usuario?.id ?? null, ahora);
    return { tipo: "rechazo", codigo: "credenciales_invalidas" };
  }
  // Con el segundo factor en su tope, la contraseña correcta recibe el mismo rechazo
  // (y el mismo piso) que una mala. No se anota como contraseña fallida.
  if (await segundoFactorEnElTope(usuario.id, listo)) return { tipo: "rechazo", codigo: "credenciales_invalidas" };

  const id = listo.ids();
  const token = listo.token();
  await listo.repositorio.crearEntrada({
    id,
    userId: usuario.id,
    tokenHash: hashDeToken(token),
    creadaEn: ahora,
    venceEn: new Date(ahora.getTime() + VIGENCIA_ENTRADA_MS),
  });
  return { tipo: "entrada", cookie: cookieDeEntrada(token) };
}

export async function leerPaso(token: string | null, deps?: DependenciasAutenticacion): Promise<PasoEntrada> {
  const listo = resolver(deps);
  const entrada = await exigirEntrada(token, listo);
  return armarPaso(entrada.userId, listo);
}

export async function entrarConTotp(
  token: string | null,
  codigo: unknown,
  deps?: DependenciasAutenticacion,
): Promise<string> {
  const listo = resolver(deps);
  const entrada = await exigirEntrada(token, listo);
  await exigirBajoElTope(entrada, listo);
  const intentos = await apartarIntento(entrada, listo);
  const normalizado = normalizarCodigoTotp(codigo);
  const factores = await listo.repositorio.factores(entrada.userId);
  const totp = factores.totp?.confirmado ? factores.totp : null;
  const semilla = totp ? descifrarDe(totp.secretoCifrado, entrada.userId, listo) : null;
  const paso = semilla && normalizado ? verificarTotp(semilla, normalizado, listo.ahora(), totp!.ultimoPaso) : null;
  if (!totp || paso === null) return fallo(entrada, intentos, listo);
  return abrirSesion(entrada, intentos, "totp", { tipo: "totp", totpId: totp.id, paso }, listo);
}

export async function entrarConRespaldo(
  token: string | null,
  codigo: unknown,
  deps?: DependenciasAutenticacion,
): Promise<string> {
  const listo = resolver(deps);
  const entrada = await exigirEntrada(token, listo);
  await exigirBajoElTope(entrada, listo);
  const intentos = await apartarIntento(entrada, listo);
  const normalizado = normalizarRespaldo(codigo);
  if (!normalizado) return fallo(entrada, intentos, listo);
  return abrirSesion(entrada, intentos, "respaldo", { tipo: "respaldo", codigoHash: hashDeRespaldo(normalizado) }, listo);
}

export async function opcionesParaEntrarConPasskey(
  token: string | null,
  origen: Origen,
  deps?: DependenciasAutenticacion,
): Promise<unknown> {
  const listo = resolver(deps);
  const entrada = await exigirEntrada(token, listo);
  const factores = await listo.repositorio.factores(entrada.userId);
  if (factores.passkeys.length === 0) throw new ErrorDeDominio("passkey_ausente");
  const opciones = await listo.webauthn.opcionesEntrada({
    origen,
    passkeys: factores.passkeys.map((p) => ({ credencialId: p.credencialId, transportes: p.transportes })),
  });
  await guardarReto(entrada.userId, "entrar", opciones.reto, listo);
  return opciones.opciones;
}

export async function entrarConPasskey(
  token: string | null,
  respuesta: unknown,
  origen: Origen,
  deps?: DependenciasAutenticacion,
): Promise<string> {
  const listo = resolver(deps);
  const entrada = await exigirEntrada(token, listo);
  const intentos = await apartarIntento(entrada, listo);
  const credencialId = credencialDeRespuesta(respuesta);
  const reto = await listo.repositorio.tomarReto(entrada.userId, "entrar", listo.ahora());
  const passkey = credencialId
    ? (await listo.repositorio.factores(entrada.userId)).passkeys.find((p) => p.credencialId === credencialId)
    : undefined;
  const verificada =
    reto && passkey ? await listo.webauthn.verificarEntrada({ respuesta, reto, origen, passkey }) : null;
  if (!verificada) return fallo(entrada, intentos, listo);
  return abrirSesion(
    entrada,
    intentos,
    "passkey",
    { tipo: "passkey", passkeyId: passkey!.id, contador: verificada.contador },
    listo,
  );
}

export async function prepararTotp(token: string | null, deps?: DependenciasAutenticacion): Promise<AltaTotp> {
  const listo = resolver(deps);
  const entrada = await exigirEntrada(token, listo);
  const { paso, persona, recuperacionId } = await contextoDeInscripcion(entrada.userId, listo);
  if (paso.paso !== "inscribir") throw new ErrorDeDominio("ya_tiene_segundo_factor");
  return altaTotp(entrada.userId, persona.correo, { entradaId: entrada.id, recuperacionId }, listo);
}

export async function inscribirTotp(
  token: string | null,
  codigo: unknown,
  deps?: DependenciasAutenticacion,
): Promise<Inscripcion> {
  const listo = resolver(deps);
  const entrada = await exigirEntrada(token, listo);
  const { paso, persona, recuperacionId } = await contextoDeInscripcion(entrada.userId, listo);
  if (paso.paso !== "inscribir") throw new ErrorDeDominio("ya_tiene_segundo_factor");
  const pendiente = await listo.repositorio.leerTotpPendiente(entrada.userId, { entradaId: entrada.id, recuperacionId }, listo.ahora());
  const intentos = await apartarIntento(entrada, listo);
  const normalizado = normalizarCodigoTotp(codigo);
  const semilla = pendiente ? descifrarDe(pendiente.secretoCifrado, entrada.userId, listo) : null;
  const pasoTotp = semilla && normalizado ? verificarTotp(semilla, normalizado, listo.ahora(), null) : null;
  if (!pendiente || pasoTotp === null) return fallo(entrada, intentos, listo);
  const codigos = listo.codigos();
  const setCookie = await abrirSesion(
    entrada,
    intentos,
    "totp",
    {
      tipo: "inscribir_totp",
      totpId: pendiente.id,
      paso: pasoTotp,
      codigosHash: codigos.map((c) => hashDeRespaldo(c.replace(/-/g, ""))),
      recuperacionId,
    },
    listo,
  );
  if (recuperacionId) await avisar(persona, "factor_reinscrito", listo);
  return { setCookie, codigos };
}

export async function opcionesParaInscribirPasskey(
  token: string | null,
  origen: Origen,
  deps?: DependenciasAutenticacion,
): Promise<unknown> {
  const listo = resolver(deps);
  const entrada = await exigirEntrada(token, listo);
  const { paso, persona } = await contextoDeInscripcion(entrada.userId, listo);
  if (paso.paso !== "inscribir") throw new ErrorDeDominio("ya_tiene_segundo_factor");
  const opciones = await listo.webauthn.opcionesRegistro({ origen, persona, existentes: [] });
  await guardarReto(entrada.userId, "registrar", opciones.reto, listo);
  return opciones.opciones;
}

export async function inscribirPasskey(
  token: string | null,
  respuesta: unknown,
  origen: Origen,
  nombre: unknown,
  deps?: DependenciasAutenticacion,
): Promise<Inscripcion> {
  const listo = resolver(deps);
  const entrada = await exigirEntrada(token, listo);
  const { paso, persona, recuperacionId } = await contextoDeInscripcion(entrada.userId, listo);
  if (paso.paso !== "inscribir") throw new ErrorDeDominio("ya_tiene_segundo_factor");
  const intentos = await apartarIntento(entrada, listo);
  const reto = await listo.repositorio.tomarReto(entrada.userId, "registrar", listo.ahora());
  const credencial = reto ? await listo.webauthn.verificarRegistro({ respuesta, reto, origen }) : null;
  if (!credencial) return fallo(entrada, intentos, listo);
  const codigos = listo.codigos();
  const setCookie = await abrirSesion(
    entrada,
    intentos,
    "passkey",
    {
      tipo: "inscribir_passkey",
      passkey: {
        id: listo.ids(),
        credencialId: credencial.credencialId,
        llavePublica: credencial.llavePublica,
        contador: credencial.contador,
        transportes: credencial.transportes,
        nombre: nombreDePasskey(nombre),
        respaldada: credencial.respaldada,
      },
      codigosHash: codigos.map((c) => hashDeRespaldo(c.replace(/-/g, ""))),
      recuperacionId,
    },
    listo,
  );
  if (recuperacionId) await avisar(persona, "factor_reinscrito", listo);
  return { setCookie, codigos };
}

export async function verFactores(sesion: Sesion, deps?: DependenciasAutenticacion): Promise<Factores> {
  const listo = resolver(deps);
  await exigirFuerte(sesion, listo);
  return presentar(await listo.repositorio.factores(sesion.usuario.id));
}

export async function prepararTotpDeSesion(sesion: Sesion, deps?: DependenciasAutenticacion): Promise<AltaTotp> {
  const listo = resolver(deps);
  await exigirCambioDeFactor(sesion, listo);
  const factores = await listo.repositorio.factores(sesion.usuario.id);
  if (factores.totp?.confirmado) throw new ErrorDeDominio("ya_tiene_segundo_factor");
  return altaTotp(sesion.usuario.id, sesion.usuario.correo, { sesionId: sesion.id }, listo);
}

export async function confirmarTotpDeSesion(
  sesion: Sesion,
  codigo: unknown,
  deps?: DependenciasAutenticacion,
): Promise<void> {
  const listo = resolver(deps);
  await exigirCambioDeFactor(sesion, listo);
  const pendiente = await listo.repositorio.leerTotpPendiente(sesion.usuario.id, { sesionId: sesion.id }, listo.ahora());
  const normalizado = normalizarCodigoTotp(codigo);
  const semilla = pendiente ? descifrarDe(pendiente.secretoCifrado, sesion.usuario.id, listo) : null;
  const paso = semilla && normalizado ? verificarTotp(semilla, normalizado, listo.ahora(), null) : null;
  if (!pendiente || paso === null) throw new ErrorDeDominio("segundo_factor_invalido");
  await listo.repositorio.confirmarTotp({ userId: sesion.usuario.id, totpId: pendiente.id, paso, ahora: listo.ahora(), ceremonia: { sesionId: sesion.id } });
  await avisar(sesion.usuario, "totp_activado", listo);
}

export async function opcionesPasskeyDeSesion(
  sesion: Sesion,
  origen: Origen,
  deps?: DependenciasAutenticacion,
): Promise<unknown> {
  const listo = resolver(deps);
  await exigirCambioDeFactor(sesion, listo);
  const persona = await listo.repositorio.buscarPersona(sesion.usuario.id);
  if (!persona) throw new ErrorDeDominio("usuario_ausente");
  const factores = await listo.repositorio.factores(sesion.usuario.id);
  const opciones = await listo.webauthn.opcionesRegistro({
    origen,
    persona,
    existentes: factores.passkeys.map((p) => ({ credencialId: p.credencialId, transportes: p.transportes })),
  });
  await guardarReto(sesion.usuario.id, "registrar", opciones.reto, listo);
  return opciones.opciones;
}

export async function agregarPasskeyDeSesion(
  sesion: Sesion,
  respuesta: unknown,
  origen: Origen,
  nombre: unknown,
  deps?: DependenciasAutenticacion,
): Promise<void> {
  const listo = resolver(deps);
  await exigirCambioDeFactor(sesion, listo);
  const reto = await listo.repositorio.tomarReto(sesion.usuario.id, "registrar", listo.ahora());
  const credencial = reto ? await listo.webauthn.verificarRegistro({ respuesta, reto, origen }) : null;
  if (!credencial) throw new ErrorDeDominio("segundo_factor_invalido");
  await listo.repositorio.agregarPasskey({
    userId: sesion.usuario.id,
    ahora: listo.ahora(),
    passkey: {
      id: listo.ids(),
      credencialId: credencial.credencialId,
      llavePublica: credencial.llavePublica,
      contador: credencial.contador,
      transportes: credencial.transportes,
      nombre: nombreDePasskey(nombre),
      respaldada: credencial.respaldada,
    },
  });
  await avisar(sesion.usuario, "passkey_agregada", listo);
}

export async function quitarPasskey(
  sesion: Sesion,
  passkeyId: unknown,
  deps?: DependenciasAutenticacion,
): Promise<void> {
  const listo = resolver(deps);
  await exigirCambioDeFactor(sesion, listo);
  if (typeof passkeyId !== "string") throw new ErrorDeDominio("passkey_ausente");
  await listo.repositorio.revocarPasskey({
    userId: sesion.usuario.id,
    passkeyId,
    actorId: sesion.usuario.id,
    ahora: listo.ahora(),
  });
  await avisar(sesion.usuario, "passkey_quitada", listo);
}

export async function quitarTotp(sesion: Sesion, deps?: DependenciasAutenticacion): Promise<void> {
  const listo = resolver(deps);
  await exigirCambioDeFactor(sesion, listo);
  await listo.repositorio.revocarTotp({ userId: sesion.usuario.id, actorId: sesion.usuario.id, ahora: listo.ahora() });
  await avisar(sesion.usuario, "totp_quitado", listo);
}

export async function nuevosCodigos(sesion: Sesion, deps?: DependenciasAutenticacion): Promise<string[]> {
  const listo = resolver(deps);
  await exigirCambioDeFactor(sesion, listo);
  const factores = await listo.repositorio.factores(sesion.usuario.id);
  if (factores.passkeys.length === 0 && !factores.totp?.confirmado) throw new ErrorDeDominio("segundo_factor_ausente");
  const codigos = listo.codigos();
  await listo.repositorio.regenerarRespaldo({
    userId: sesion.usuario.id,
    codigosHash: codigos.map((c) => hashDeRespaldo(c.replace(/-/g, ""))),
    ahora: listo.ahora(),
  });
  await avisar(sesion.usuario, "respaldo_regenerado", listo);
  return codigos;
}

/**
 * Lo que la pantalla «Confirma que eres tú» necesita: si el factor de la sesión
 * sigue fresco para cambiar factores y con qué métodos puede renovarlo.
 */
export async function estadoDeConfirmacion(
  sesion: Sesion,
  deps?: DependenciasAutenticacion,
): Promise<{ reciente: boolean; passkey: boolean; totp: boolean; respaldo: boolean }> {
  const listo = resolver(deps);
  await exigirFuerte(sesion, listo);
  const factores = await listo.repositorio.factores(sesion.usuario.id);
  return {
    reciente: factorReciente(sesion, { vigenciaMs: VIGENCIA_FACTORES_MS }, listo.ahora()),
    passkey: factores.passkeys.length > 0,
    totp: Boolean(factores.totp?.confirmado),
    respaldo: factores.respaldoRestantes > 0,
  };
}

/** Confirma la identidad con el código de la app y renueva el factor de esta sesión. */
export async function confirmarConTotp(sesion: Sesion, codigo: unknown, deps?: DependenciasAutenticacion): Promise<void> {
  const listo = resolver(deps);
  await exigirFuerte(sesion, listo);
  const intentos = await apartarConfirmacion(sesion, listo);
  const normalizado = normalizarCodigoTotp(codigo);
  const factores = await listo.repositorio.factores(sesion.usuario.id);
  const totp = factores.totp?.confirmado ? factores.totp : null;
  const semilla = totp ? descifrarDe(totp.secretoCifrado, sesion.usuario.id, listo) : null;
  const paso = semilla && normalizado ? verificarTotp(semilla, normalizado, listo.ahora(), totp!.ultimoPaso) : null;
  if (!totp || paso === null) return falloDeConfirmacion(sesion, intentos, listo);
  await renovarFactor(sesion, intentos, "totp", { tipo: "totp", totpId: totp.id, paso }, listo);
}

/** Confirma la identidad con un código de respaldo; el código queda usado. */
export async function confirmarConRespaldo(sesion: Sesion, codigo: unknown, deps?: DependenciasAutenticacion): Promise<void> {
  const listo = resolver(deps);
  await exigirFuerte(sesion, listo);
  const intentos = await apartarConfirmacion(sesion, listo);
  const normalizado = normalizarRespaldo(codigo);
  if (!normalizado) return falloDeConfirmacion(sesion, intentos, listo);
  await renovarFactor(sesion, intentos, "respaldo", { tipo: "respaldo", codigoHash: hashDeRespaldo(normalizado) }, listo);
}

export async function opcionesParaConfirmarConPasskey(
  sesion: Sesion,
  origen: Origen,
  deps?: DependenciasAutenticacion,
): Promise<unknown> {
  const listo = resolver(deps);
  await exigirFuerte(sesion, listo);
  const factores = await listo.repositorio.factores(sesion.usuario.id);
  if (factores.passkeys.length === 0) throw new ErrorDeDominio("passkey_ausente");
  const opciones = await listo.webauthn.opcionesEntrada({
    origen,
    passkeys: factores.passkeys.map((p) => ({ credencialId: p.credencialId, transportes: p.transportes })),
  });
  // Reto propio y ligado a esta sesión: los retos de la puerta no lo consumen.
  await guardarReto(sesion.usuario.id, "reautenticar", opciones.reto, listo, sesion.id);
  return opciones.opciones;
}

export async function confirmarConPasskey(
  sesion: Sesion,
  respuesta: unknown,
  origen: Origen,
  deps?: DependenciasAutenticacion,
): Promise<void> {
  const listo = resolver(deps);
  await exigirFuerte(sesion, listo);
  const intentos = await apartarConfirmacion(sesion, listo);
  const credencialId = credencialDeRespuesta(respuesta);
  const reto = await listo.repositorio.tomarReto(sesion.usuario.id, "reautenticar", listo.ahora(), sesion.id);
  const passkey = credencialId
    ? (await listo.repositorio.factores(sesion.usuario.id)).passkeys.find((p) => p.credencialId === credencialId)
    : undefined;
  const verificada =
    reto && passkey ? await listo.webauthn.verificarEntrada({ respuesta, reto, origen, passkey }) : null;
  if (!verificada) return falloDeConfirmacion(sesion, intentos, listo);
  await renovarFactor(
    sesion,
    intentos,
    "passkey",
    { tipo: "passkey", passkeyId: passkey!.id, contador: verificada.contador },
    listo,
  );
}

export async function pedirRecuperacion(
  token: string | null,
  motivo: unknown,
  deps?: DependenciasAutenticacion,
): Promise<void> {
  const listo = resolver(deps);
  const entrada = await exigirEntrada(token, listo);
  const paso = await armarPaso(entrada.userId, listo);
  if (paso.paso === "inscribir") throw new ErrorDeDominio("recuperacion_no_aplica");
  const limpio = textoBreve(motivo, 500);
  if (!limpio) throw new ErrorDeDominio("motivo_invalido");
  await listo.repositorio.solicitarRecuperacion({
    id: listo.ids(),
    userId: entrada.userId,
    motivo: limpio,
    entradaId: entrada.id,
    ahora: listo.ahora(),
  });
}

export async function verRecuperaciones(
  sesion: Sesion,
  deps?: DependenciasAutenticacion,
): Promise<RecuperacionPendiente[]> {
  const listo = resolver(deps);
  await exigirOperador(sesion, listo);
  return listo.repositorio.recuperacionesPendientes(sesion.usuario.id);
}

export async function resolverRecuperacion(
  sesion: Sesion,
  decision: { id?: unknown; aprobada?: boolean; verificacion?: unknown; nota?: unknown },
  deps?: DependenciasAutenticacion,
): Promise<void> {
  const listo = resolver(deps);
  await exigirOperador(sesion, listo);
  // Decidir quién vuelve a registrar un segundo factor es un cambio de factor.
  exigirFactorReciente(sesion, { superficie: "sofipo", vigenciaMs: VIGENCIA_FACTORES_MS }, listo.ahora());
  if (typeof decision.id !== "string") throw new ErrorDeDominio("recuperacion_ausente");
  const ahora = listo.ahora();
  const nota = textoBreve(decision.nota, 500);
  if (decision.aprobada) {
    const verificacion = decision.verificacion === "presencial" || decision.verificacion === "videollamada"
      ? decision.verificacion
      : null;
    if (!verificacion) throw new ErrorDeDominio("verificacion_invalida");
    const { userId } = await listo.repositorio.aprobarRecuperacion({
      id: decision.id,
      aprobadorId: sesion.usuario.id,
      verificacion: verificacion as VerificacionIdentidad,
      nota,
      ahora,
      venceEn: new Date(ahora.getTime() + VIGENCIA_RECUPERACION_MS),
    });
    // La aprobación ya quedó: leer a la persona o avisarle no la convierte en error.
    await avisarSinDeshacer(listo.avisar, {
      userId,
      cambio: "recuperacion_aprobada",
      cuando: listo.ahora(),
      persona: () => listo.repositorio.buscarPersona(userId),
    });
    return;
  }
  if (!nota) throw new ErrorDeDominio("motivo_invalido");
  await listo.repositorio.rechazarRecuperacion({ id: decision.id, aprobadorId: sesion.usuario.id, nota, ahora });
}

function resolver(deps?: DependenciasAutenticacion): Listo {
  const hashear = deps?.hashear ?? hashearContrasena;
  return {
    repositorio: deps?.repositorio ?? repositorioPg(),
    ahora: deps?.ahora ?? (() => new Date()),
    token: deps?.token ?? tokenNuevo,
    ids: deps?.ids ?? randomUUID,
    hashear,
    verificar: deps?.verificar ?? verificarContrasena,
    webauthn: deps?.webauthn ?? webauthnReal(),
    llaveTotp: deps && "llaveTotp" in deps ? (deps.llaveTotp ?? null) : llaveTotpDesdeEntorno(),
    operadores: deps?.operadores,
    codigos: deps?.codigos ?? codigosNuevos,
    semilla: deps?.semilla ?? semillaNueva,
    superficie: deps?.superficie ?? "cliente",
    avisar: deps?.avisar ?? avisarPorCorreo,
    esperar: deps?.esperar ?? ((ms) => new Promise((fin) => setTimeout(fin, ms))),
    ahoraMs: deps?.ahoraMs ?? (() => performance.now()),
  };
}

async function exigirEntrada(token: string | null, listo: Listo): Promise<Entrada> {
  if (!token) throw new ErrorDeDominio("entrada_vencida");
  const entrada = await listo.repositorio.leerEntrada(hashDeToken(token), listo.ahora());
  if (!entrada) throw new ErrorDeDominio("entrada_vencida");
  return entrada;
}

async function armarPaso(userId: string, listo: Listo): Promise<PasoEntrada> {
  const persona = await listo.repositorio.buscarPersona(userId);
  if (!persona) throw new ErrorDeDominio("entrada_vencida");
  const factores = await listo.repositorio.factores(userId);
  const recuperacion = await listo.repositorio.recuperacionAbierta(userId);
  const ahora = listo.ahora().getTime();
  const aprobadaVigente =
    recuperacion?.estado === "aprobada" && recuperacion.venceEn !== null && recuperacion.venceEn.getTime() > ahora;
  // Con la recuperación aprobada y vigente se inscribe un factor nuevo aunque
  // haya viejos: pueden estar en otras manos y se revocan al confirmar el nuevo.
  if (aprobadaVigente) {
    return { paso: "inscribir", nombre: persona.nombre, correo: persona.correo, porRecuperacion: true };
  }
  const passkey = factores.passkeys.length > 0;
  const totp = Boolean(factores.totp?.confirmado);
  const respaldo = factores.respaldoRestantes > 0;
  if (passkey || totp || respaldo) {
    return {
      paso: "verificar",
      nombre: persona.nombre,
      passkey,
      totp,
      respaldo,
      solicitudAbierta: recuperacion?.estado === "solicitada",
    };
  }
  if (!factores.tuvoFactores) {
    return { paso: "inscribir", nombre: persona.nombre, correo: persona.correo, porRecuperacion: false };
  }
  return { paso: "recuperar", nombre: persona.nombre, solicitudAbierta: recuperacion?.estado === "solicitada" };
}

async function contextoDeInscripcion(userId: string, listo: Listo) {
  const paso = await armarPaso(userId, listo);
  const persona = await listo.repositorio.buscarPersona(userId);
  if (!persona) throw new ErrorDeDominio("entrada_vencida");
  let recuperacionId: string | null = null;
  if (paso.paso === "inscribir" && paso.porRecuperacion) {
    const abierta = await listo.repositorio.recuperacionAbierta(userId);
    if (abierta?.estado !== "aprobada") throw new ErrorDeDominio("recuperacion_vencida");
    recuperacionId = abierta.id;
  }
  return { paso, persona, recuperacionId };
}

/**
 * El factor que la base rechaza al aplicarlo (paso TOTP repetido, código de
 * respaldo que no existe) cuenta como fallo del intento ya apartado.
 */
async function abrirSesion(
  entrada: Entrada,
  intentos: number,
  metodo: "passkey" | "totp" | "respaldo",
  efecto: Parameters<RepositorioAutenticacion["completarEntrada"]>[0]["efecto"],
  listo: Listo,
): Promise<string> {
  const token = listo.token();
  const ahora = listo.ahora();
  const venceEn = new Date(ahora.getTime() + VIGENCIA_SESION_MS);
  try {
    await listo.repositorio.completarEntrada({
      entradaId: entrada.id,
      userId: entrada.userId,
      metodo,
      sesion: { id: listo.ids(), tokenHash: hashDeToken(token), expiresAt: venceEn, superficie: listo.superficie },
      efecto,
      ahora,
    });
  } catch (error) {
    if (error instanceof ErrorDeDominio && error.codigo === "segundo_factor_invalido") return fallo(entrada, intentos, listo);
    throw error;
  }
  return encabezadoDeSesion(token, venceEn, ahora);
}

/**
 * Aparta el intento en la base antes de verificar el factor. Con 5 apartados no
 * se verifica nada más, aunque lleguen muchas peticiones a la vez.
 */
async function apartarIntento(entrada: Entrada, listo: Listo): Promise<number> {
  const intentos = await listo.repositorio.apartarIntentoDeEntrada(entrada.id, entrada.userId);
  if (intentos === null) throw new ErrorDeDominio("entrada_agotada");
  return intentos;
}

async function fallo(entrada: Entrada, intentos: number, listo: Listo): Promise<never> {
  await listo.repositorio.registrarFalloDeEntrada({
    entradaId: entrada.id,
    userId: entrada.userId,
    intentos,
    ahora: listo.ahora(),
  });
  const fallos = await fallosDeSegundoFactor(entrada.userId, listo);
  if (fallos >= TOPE_SEGUNDO_FACTOR_PERSONA && (await tieneTotp(entrada.userId, listo))) {
    // Solo el fallo que llega al tope avisa: los siguientes ya no se verifican.
    if (fallos === TOPE_SEGUNDO_FACTOR_PERSONA) {
      await avisarSinDeshacer(listo.avisar, {
        userId: entrada.userId,
        cambio: "segundo_factor_bloqueado",
        cuando: listo.ahora(),
        persona: () => listo.repositorio.buscarPersona(entrada.userId),
      });
    }
    throw new ErrorDeDominio("entrada_agotada");
  }
  throw new ErrorDeDominio(intentos >= TOPE_SEGUNDO_FACTOR ? "entrada_agotada" : "segundo_factor_invalido");
}

function fallosDeSegundoFactor(userId: string, listo: Listo): Promise<number> {
  return listo.repositorio.contarFallosSegundoFactor(
    userId,
    new Date(listo.ahora().getTime() - VENTANA_SEGUNDO_FACTOR_MS),
  );
}

async function tieneTotp(userId: string, listo: Listo): Promise<boolean> {
  return Boolean((await listo.repositorio.factores(userId)).totp?.confirmado);
}

/** Lee los factores solo cuando ya hay diez fallos: la entrada normal paga una consulta. */
async function segundoFactorEnElTope(userId: string, listo: Listo): Promise<boolean> {
  if ((await fallosDeSegundoFactor(userId, listo)) < TOPE_SEGUNDO_FACTOR_PERSONA) return false;
  return tieneTotp(userId, listo);
}

/** En el tope, la entrada abierta tampoco prueba códigos: ni aparta intento ni verifica. */
async function exigirBajoElTope(entrada: Entrada, listo: Listo): Promise<void> {
  if (await segundoFactorEnElTope(entrada.userId, listo)) throw new ErrorDeDominio("entrada_agotada");
}

async function altaTotp(userId: string, correo: string, ceremonia: CeremoniaTotp, listo: Listo): Promise<AltaTotp> {
  const llave = exigirLlave(listo);
  const ahora = listo.ahora();
  const pendiente = await listo.repositorio.guardarTotpPendiente({
    id: listo.ids(),
    userId,
    secretoCifrado: cifrarSemilla(listo.semilla(), userId, llave),
    creadoEn: ahora,
    venceEn: new Date(ahora.getTime() + VIGENCIA_ALTA_TOTP_MS),
    ceremonia,
  });
  const semilla = descifrarDe(pendiente.secretoCifrado, userId, listo);
  const uri = uriOtpauth(EMISOR, correo, semilla);
  return { qr: await qrComoDataUri(uri), semilla: semillaLegible(semilla) };
}

function descifrarDe(cifrado: string, userId: string, listo: Listo): Buffer {
  return descifrarSemilla(cifrado, userId, exigirLlave(listo));
}

function exigirLlave(listo: Listo): Buffer {
  if (!listo.llaveTotp) throw new ErrorDeDominio("totp_no_disponible");
  return listo.llaveTotp;
}

async function guardarReto(
  userId: string,
  proposito: PropositoDeReto,
  reto: string,
  listo: Listo,
  sesionId: string | null = null,
): Promise<void> {
  const ahora = listo.ahora();
  await listo.repositorio.guardarReto({
    id: listo.ids(),
    userId,
    proposito,
    reto,
    creadoEn: ahora,
    venceEn: new Date(ahora.getTime() + VIGENCIA_RETO_MS),
    sesionId,
  });
}

async function exigirFuerte(sesion: Sesion, listo: Listo): Promise<void> {
  if (!sesion?.id || !sesion.usuario?.id) throw new ErrorDeDominio("segundo_factor_ausente");
  const factor = await listo.repositorio.segundoFactorDeSesion(sesion.id);
  if (!factor) throw new ErrorDeDominio("segundo_factor_ausente");
}

/** Agregar, quitar o regenerar un factor exige haberlo probado hace cinco minutos o menos. */
async function exigirCambioDeFactor(sesion: Sesion, listo: Listo): Promise<void> {
  await exigirFuerte(sesion, listo);
  exigirFactorReciente(sesion, { vigenciaMs: VIGENCIA_FACTORES_MS }, listo.ahora());
}

/** Renueva el sello y regresa el contador a 0. Si la base rechaza el factor, cuenta como fallo. */
async function renovarFactor(
  sesion: Sesion,
  intentos: number,
  metodo: "passkey" | "totp" | "respaldo",
  efecto: Parameters<RepositorioAutenticacion["reautenticar"]>[0]["efecto"],
  listo: Listo,
): Promise<void> {
  try {
    await listo.repositorio.reautenticar({
      sesionId: sesion.id,
      userId: sesion.usuario.id,
      metodo,
      efecto,
      superficie: sesion.superficie ?? "cliente",
      ahora: listo.ahora(),
    });
  } catch (error) {
    if (error instanceof ErrorDeDominio && error.codigo === "segundo_factor_invalido") {
      return falloDeConfirmacion(sesion, intentos, listo);
    }
    throw error;
  }
}

/** Aparta el intento de confirmar antes de verificar. Sin intentos, la sesión ya se cerró. */
async function apartarConfirmacion(sesion: Sesion, listo: Listo): Promise<number> {
  const intentos = await listo.repositorio.apartarIntentoDeReautenticacion({
    sesionId: sesion.id,
    userId: sesion.usuario.id,
  });
  if (intentos === null) throw new ErrorDeDominio("reautenticacion_agotada");
  return intentos;
}

async function falloDeConfirmacion(sesion: Sesion, intentos: number, listo: Listo): Promise<never> {
  await listo.repositorio.registrarFalloDeReautenticacion({
    sesionId: sesion.id,
    userId: sesion.usuario.id,
    superficie: sesion.superficie ?? "cliente",
    intentos,
    ahora: listo.ahora(),
  });
  throw new ErrorDeDominio(intentos >= TOPE_SEGUNDO_FACTOR ? "reautenticacion_agotada" : "segundo_factor_invalido");
}

async function avisar(
  persona: { id: string; nombre: string; correo: string },
  cambio: CambioDeSeguridad,
  listo: Listo,
): Promise<void> {
  await avisarSinDeshacer(listo.avisar, {
    userId: persona.id,
    para: persona.correo,
    nombre: persona.nombre,
    cambio,
    cuando: listo.ahora(),
  });
}

async function exigirOperador(sesion: Sesion, listo: Listo): Promise<void> {
  await exigirFuerte(sesion, listo);
  // El personal resuelve recuperaciones desde Operación, no desde una sesión cliente.
  if (sesion.superficie !== "sofipo") throw new ErrorDeDominio("sin_permiso");
  if (listo.operadores) {
    if (!listo.operadores.has(normalizarCorreo(sesion.usuario.correo))) throw new ErrorDeDominio("sin_permiso");
    return;
  }
  if (!(await listo.repositorio.esPersonal(sesion.usuario.id))) throw new ErrorDeDominio("sin_permiso");
}

function presentar(estado: Awaited<ReturnType<RepositorioAutenticacion["factores"]>>): Factores {
  return {
    passkeys: estado.passkeys.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      creadaEn: p.creadaEn,
      ultimoUsoEn: p.ultimoUsoEn,
      respaldada: p.respaldada,
    })),
    totp: Boolean(estado.totp?.confirmado),
    respaldoRestantes: estado.respaldoRestantes,
  };
}

function nombreDePasskey(valor: unknown): string {
  const nombre = textoBreve(valor, 60);
  return nombre ?? "Este dispositivo";
}

function textoBreve(valor: unknown, maximo: number): string | null {
  if (typeof valor !== "string" || CONTROL.test(valor)) return null;
  const limpio = valor.trim().replace(/\s+/g, " ");
  if (limpio.length < 1 || limpio.length > maximo) return null;
  return limpio;
}

async function contrasenaCoincide(
  contrasena: string,
  hash: string | null,
  hashear: Hashear,
  verificar: Verificar,
): Promise<boolean> {
  if (hash) return verificar(contrasena, hash);
  await verificar(contrasena, await hashDeRelleno(hashear));
  return false;
}

function hashDeRelleno(hashear: Hashear): Promise<string> {
  let pendiente = rellenos.get(hashear);
  if (!pendiente) {
    pendiente = hashear(randomBytes(32).toString("base64url"));
    rellenos.set(hashear, pendiente);
  }
  return pendiente;
}
