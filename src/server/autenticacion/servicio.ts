import { randomBytes, randomUUID } from "node:crypto";

import { encabezadoDeSesion, VIGENCIA_SESION_MS } from "../session/cookie";
import { ErrorDeDominio } from "../session/error-de-dominio";
import { hashearContrasena, hashDeToken, tokenNuevo, verificarContrasena } from "../session/hash";
import type { Sesion } from "../session/tipos";
import { correoValido, normalizarCorreo } from "../session/validar";
import { operadoresDesdeEntorno } from "../precio/operador";
import { cifrarSemilla, descifrarSemilla } from "./cifrado";
import { cookieDeEntrada, VIGENCIA_ENTRADA_MS, type CookieEntrada } from "./cookie";
import { llaveTotpDesdeEntorno } from "./entorno";
import { qrComoDataUri } from "./qr";
import { repositorioPg, type Entrada, type RepositorioAutenticacion } from "./repositorio";
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

/**
 * Correo y contraseña abren una entrada, no el portal. La sesión —la cookie
 * `sesion` de src/server/session— nace aquí, cuando el segundo factor
 * coincide, con el mismo encabezado que arma esa capa.
 */

const TOPE_CONTRASENA = 8;
const VENTANA_CONTRASENA_MS = 15 * 60 * 1000;
const TOPE_SEGUNDO_FACTOR = 5;
const VIGENCIA_RETO_MS = 5 * 60 * 1000;
const VIGENCIA_RECUPERACION_MS = 12 * 60 * 60 * 1000;
const EMISOR = "Arco";

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
};

export type ResultadoContrasena =
  | { tipo: "entrada"; cookie: CookieEntrada }
  | { tipo: "rechazo"; codigo: "credenciales_invalidas" | "entrada_bloqueada" };

type Listo = {
  repositorio: RepositorioAutenticacion;
  ahora: () => Date;
  token: () => string;
  ids: () => string;
  hashear: Hashear;
  verificar: Verificar;
  webauthn: AdaptadorWebauthn;
  llaveTotp: Buffer | null;
  operadores: ReadonlySet<string>;
  codigos: () => string[];
  semilla: () => Buffer;
};

const rellenos = new WeakMap<Hashear, Promise<string>>();

export async function iniciarConContrasena(
  entrada: { correo?: string; contrasena?: string },
  deps?: DependenciasAutenticacion,
): Promise<ResultadoContrasena> {
  const listo = resolver(deps);
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
  if (bloqueada) return { tipo: "rechazo", codigo: "entrada_bloqueada" };
  if (!coincide || !usuario) {
    if (usuario) await listo.repositorio.registrarContrasenaFallida(usuario.id, ahora);
    return { tipo: "rechazo", codigo: "credenciales_invalidas" };
  }

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
  const normalizado = normalizarCodigoTotp(codigo);
  const factores = await listo.repositorio.factores(entrada.userId);
  const totp = factores.totp?.confirmado ? factores.totp : null;
  const semilla = totp ? descifrarDe(totp.secretoCifrado, entrada.userId, listo) : null;
  const paso = semilla && normalizado ? verificarTotp(semilla, normalizado, listo.ahora(), totp!.ultimoPaso) : null;
  if (!totp || paso === null) return fallo(entrada, listo);
  return abrirSesion(entrada, "totp", { tipo: "totp", totpId: totp.id, paso }, listo);
}

export async function entrarConRespaldo(
  token: string | null,
  codigo: unknown,
  deps?: DependenciasAutenticacion,
): Promise<string> {
  const listo = resolver(deps);
  const entrada = await exigirEntrada(token, listo);
  const normalizado = normalizarRespaldo(codigo);
  if (!normalizado) return fallo(entrada, listo);
  return abrirSesion(entrada, "respaldo", { tipo: "respaldo", codigoHash: hashDeRespaldo(normalizado) }, listo);
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
  const credencialId = credencialDeRespuesta(respuesta);
  const reto = await listo.repositorio.tomarReto(entrada.userId, "entrar", listo.ahora());
  const passkey = credencialId
    ? (await listo.repositorio.factores(entrada.userId)).passkeys.find((p) => p.credencialId === credencialId)
    : undefined;
  const verificada =
    reto && passkey ? await listo.webauthn.verificarEntrada({ respuesta, reto, origen, passkey }) : null;
  if (!verificada) return fallo(entrada, listo);
  return abrirSesion(
    entrada,
    "passkey",
    { tipo: "passkey", passkeyId: passkey!.id, contador: verificada.contador },
    listo,
  );
}

export async function prepararTotp(token: string | null, deps?: DependenciasAutenticacion): Promise<AltaTotp> {
  const listo = resolver(deps);
  const entrada = await exigirEntrada(token, listo);
  const { paso, persona } = await contextoDeInscripcion(entrada.userId, listo);
  if (paso.paso !== "inscribir") throw new ErrorDeDominio("ya_tiene_segundo_factor");
  return altaTotp(entrada.userId, persona.correo, listo);
}

export async function inscribirTotp(
  token: string | null,
  codigo: unknown,
  deps?: DependenciasAutenticacion,
): Promise<Inscripcion> {
  const listo = resolver(deps);
  const entrada = await exigirEntrada(token, listo);
  const { paso, recuperacionId } = await contextoDeInscripcion(entrada.userId, listo);
  if (paso.paso !== "inscribir") throw new ErrorDeDominio("ya_tiene_segundo_factor");
  const factores = await listo.repositorio.factores(entrada.userId);
  const pendiente = factores.totp && !factores.totp.confirmado ? factores.totp : null;
  const normalizado = normalizarCodigoTotp(codigo);
  const semilla = pendiente ? descifrarDe(pendiente.secretoCifrado, entrada.userId, listo) : null;
  const pasoTotp = semilla && normalizado ? verificarTotp(semilla, normalizado, listo.ahora(), null) : null;
  if (!pendiente || pasoTotp === null) return fallo(entrada, listo);
  const codigos = listo.codigos();
  const setCookie = await abrirSesion(
    entrada,
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
  const { paso, recuperacionId } = await contextoDeInscripcion(entrada.userId, listo);
  if (paso.paso !== "inscribir") throw new ErrorDeDominio("ya_tiene_segundo_factor");
  const reto = await listo.repositorio.tomarReto(entrada.userId, "registrar", listo.ahora());
  const credencial = reto ? await listo.webauthn.verificarRegistro({ respuesta, reto, origen }) : null;
  if (!credencial) return fallo(entrada, listo);
  const codigos = listo.codigos();
  const setCookie = await abrirSesion(
    entrada,
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
  return { setCookie, codigos };
}

export async function verFactores(sesion: Sesion, deps?: DependenciasAutenticacion): Promise<Factores> {
  const listo = resolver(deps);
  await exigirFuerte(sesion, listo);
  return presentar(await listo.repositorio.factores(sesion.usuario.id));
}

export async function prepararTotpDeSesion(sesion: Sesion, deps?: DependenciasAutenticacion): Promise<AltaTotp> {
  const listo = resolver(deps);
  await exigirFuerte(sesion, listo);
  const factores = await listo.repositorio.factores(sesion.usuario.id);
  if (factores.totp?.confirmado) throw new ErrorDeDominio("ya_tiene_segundo_factor");
  return altaTotp(sesion.usuario.id, sesion.usuario.correo, listo);
}

export async function confirmarTotpDeSesion(
  sesion: Sesion,
  codigo: unknown,
  deps?: DependenciasAutenticacion,
): Promise<void> {
  const listo = resolver(deps);
  await exigirFuerte(sesion, listo);
  const factores = await listo.repositorio.factores(sesion.usuario.id);
  const pendiente = factores.totp && !factores.totp.confirmado ? factores.totp : null;
  const normalizado = normalizarCodigoTotp(codigo);
  const semilla = pendiente ? descifrarDe(pendiente.secretoCifrado, sesion.usuario.id, listo) : null;
  const paso = semilla && normalizado ? verificarTotp(semilla, normalizado, listo.ahora(), null) : null;
  if (!pendiente || paso === null) throw new ErrorDeDominio("segundo_factor_invalido");
  await listo.repositorio.confirmarTotp({ userId: sesion.usuario.id, totpId: pendiente.id, paso, ahora: listo.ahora() });
}

export async function opcionesPasskeyDeSesion(
  sesion: Sesion,
  origen: Origen,
  deps?: DependenciasAutenticacion,
): Promise<unknown> {
  const listo = resolver(deps);
  await exigirFuerte(sesion, listo);
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
  await exigirFuerte(sesion, listo);
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
}

export async function quitarPasskey(
  sesion: Sesion,
  passkeyId: unknown,
  deps?: DependenciasAutenticacion,
): Promise<void> {
  const listo = resolver(deps);
  await exigirFuerte(sesion, listo);
  if (typeof passkeyId !== "string") throw new ErrorDeDominio("passkey_ausente");
  await listo.repositorio.revocarPasskey({
    userId: sesion.usuario.id,
    passkeyId,
    actorId: sesion.usuario.id,
    ahora: listo.ahora(),
  });
}

export async function quitarTotp(sesion: Sesion, deps?: DependenciasAutenticacion): Promise<void> {
  const listo = resolver(deps);
  await exigirFuerte(sesion, listo);
  await listo.repositorio.revocarTotp({ userId: sesion.usuario.id, actorId: sesion.usuario.id, ahora: listo.ahora() });
}

export async function nuevosCodigos(sesion: Sesion, deps?: DependenciasAutenticacion): Promise<string[]> {
  const listo = resolver(deps);
  await exigirFuerte(sesion, listo);
  const factores = await listo.repositorio.factores(sesion.usuario.id);
  if (factores.passkeys.length === 0 && !factores.totp?.confirmado) throw new ErrorDeDominio("segundo_factor_ausente");
  const codigos = listo.codigos();
  await listo.repositorio.regenerarRespaldo({
    userId: sesion.usuario.id,
    codigosHash: codigos.map((c) => hashDeRespaldo(c.replace(/-/g, ""))),
    ahora: listo.ahora(),
  });
  return codigos;
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
  return listo.repositorio.recuperacionesPendientes();
}

export async function resolverRecuperacion(
  sesion: Sesion,
  decision: { id?: unknown; aprobada?: boolean; verificacion?: unknown; nota?: unknown },
  deps?: DependenciasAutenticacion,
): Promise<void> {
  const listo = resolver(deps);
  await exigirOperador(sesion, listo);
  if (typeof decision.id !== "string") throw new ErrorDeDominio("recuperacion_ausente");
  const ahora = listo.ahora();
  const nota = textoBreve(decision.nota, 500);
  if (decision.aprobada) {
    const verificacion = decision.verificacion === "presencial" || decision.verificacion === "videollamada"
      ? decision.verificacion
      : null;
    if (!verificacion) throw new ErrorDeDominio("verificacion_invalida");
    await listo.repositorio.aprobarRecuperacion({
      id: decision.id,
      aprobadorId: sesion.usuario.id,
      verificacion: verificacion as VerificacionIdentidad,
      nota,
      ahora,
      venceEn: new Date(ahora.getTime() + VIGENCIA_RECUPERACION_MS),
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
    operadores: deps?.operadores ?? operadoresDesdeEntorno(),
    codigos: deps?.codigos ?? codigosNuevos,
    semilla: deps?.semilla ?? semillaNueva,
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
  if (!factores.tuvoFactores || aprobadaVigente) {
    return { paso: "inscribir", nombre: persona.nombre, correo: persona.correo, porRecuperacion: Boolean(aprobadaVigente) };
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

async function abrirSesion(
  entrada: Entrada,
  metodo: "passkey" | "totp" | "respaldo",
  efecto: Parameters<RepositorioAutenticacion["completarEntrada"]>[0]["efecto"],
  listo: Listo,
): Promise<string> {
  const token = listo.token();
  const ahora = listo.ahora();
  const venceEn = new Date(ahora.getTime() + VIGENCIA_SESION_MS);
  await listo.repositorio.completarEntrada({
    entradaId: entrada.id,
    userId: entrada.userId,
    metodo,
    sesion: { id: listo.ids(), tokenHash: hashDeToken(token), expiresAt: venceEn },
    efecto,
    ahora,
  });
  return encabezadoDeSesion(token, venceEn, ahora);
}

async function fallo(entrada: Entrada, listo: Listo): Promise<never> {
  const intentos = await listo.repositorio.sumarFallo(entrada.id, entrada.userId, listo.ahora());
  throw new ErrorDeDominio(intentos >= TOPE_SEGUNDO_FACTOR ? "entrada_agotada" : "segundo_factor_invalido");
}

async function altaTotp(userId: string, correo: string, listo: Listo): Promise<AltaTotp> {
  const factores = await listo.repositorio.factores(userId);
  const pendiente = factores.totp && !factores.totp.confirmado ? factores.totp : null;
  const llave = exigirLlave(listo);
  let semilla: Buffer | null = null;
  if (pendiente) {
    try {
      semilla = descifrarSemilla(pendiente.secretoCifrado, userId, llave);
    } catch {
      semilla = null;
    }
  }
  if (!semilla) {
    semilla = listo.semilla();
    await listo.repositorio.guardarTotpPendiente({
      id: listo.ids(),
      userId,
      secretoCifrado: cifrarSemilla(semilla, userId, llave),
      creadoEn: listo.ahora(),
    });
  }
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

async function guardarReto(userId: string, proposito: "entrar" | "registrar", reto: string, listo: Listo): Promise<void> {
  const ahora = listo.ahora();
  await listo.repositorio.guardarReto({
    id: listo.ids(),
    userId,
    proposito,
    reto,
    creadoEn: ahora,
    venceEn: new Date(ahora.getTime() + VIGENCIA_RETO_MS),
  });
}

async function exigirFuerte(sesion: Sesion, listo: Listo): Promise<void> {
  if (!sesion?.id || !sesion.usuario?.id) throw new ErrorDeDominio("segundo_factor_ausente");
  const factor = await listo.repositorio.segundoFactorDeSesion(sesion.id);
  if (!factor) throw new ErrorDeDominio("segundo_factor_ausente");
}

async function exigirOperador(sesion: Sesion, listo: Listo): Promise<void> {
  await exigirFuerte(sesion, listo);
  if (!listo.operadores.has(normalizarCorreo(sesion.usuario.correo))) throw new ErrorDeDominio("sin_permiso");
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
  if (typeof valor !== "string" || /[\u0000-\u001F\u007F]/.test(valor)) return null;
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
