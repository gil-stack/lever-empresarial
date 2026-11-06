import { randomUUID } from "node:crypto";

import { aplicarSentencia, conContexto, type Consulta } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { hecho, registrarHechoAutenticacion } from "./auditar";
import type { MetodoSegundoFactor, RecuperacionPendiente, VerificacionIdentidad } from "./tipos";

function conTransaccion<T>(userId: string, fn: (consulta: Consulta) => Promise<T>): Promise<T> {
  return conContexto({ rol: "plataforma_cliente", userId }, fn);
}

function consultar(sentencia: string, params: readonly unknown[], userId: string) {
  return conTransaccion(userId, (consulta) => aplicarSentencia(consulta, sentencia, params));
}

function consultarDefinidor(sentencia: string, params: readonly unknown[]) {
  return conContexto({ rol: "plataforma_cliente" }, (consulta) => aplicarSentencia(consulta, sentencia, params));
}

async function conPersonal<T>(userId: string, fn: (consulta: Consulta) => Promise<T>): Promise<T> {
  return conContexto({ rol: "plataforma_cliente", userId }, async (consulta) => {
    const personal = await consulta.query(
      "select operator_id from platform_staff where user_id = $1 and estado = 'activo'",
      [userId],
    );
    const operadorId = (personal.rows[0] as { operator_id?: unknown } | undefined)?.operator_id;
    if (typeof operadorId !== "string") throw new ErrorDeDominio("sin_permiso");
    await consulta.query("set local role plataforma_sofipo");
    await consulta.query("select set_config('app.operator_id', $1, true), set_config('app.user_id', $2, true)", [
      operadorId,
      userId,
    ]);
    return fn(consulta);
  });
}

export type UsuarioAuth = { id: string; nombre: string; correo: string; passwordHash: string };
export type Persona = { id: string; nombre: string; correo: string };

export type Entrada = { id: string; userId: string; venceEn: Date; intentosFallidos: number };

export type PasskeyGuardada = {
  id: string;
  userId: string;
  credencialId: string;
  llavePublica: Uint8Array;
  contador: number;
  transportes: string[];
  nombre: string;
  respaldada: boolean;
  creadaEn: Date;
  ultimoUsoEn: Date | null;
};

export type TotpGuardado = {
  id: string;
  userId: string;
  secretoCifrado: string;
  confirmado: boolean;
  ultimoPaso: number | null;
};

export type EstadoFactores = {
  passkeys: PasskeyGuardada[];
  /** La app autenticadora confirmada y vigente. */
  totp: TotpGuardado | null;
  /** La app que se está inscribiendo. Con una recuperación aprobada convive con la confirmada vieja. */
  totpPendiente: TotpGuardado | null;
  respaldoRestantes: number;
  /** Alguna vez tuvo passkey o TOTP confirmado, aunque hoy estén revocados. */
  tuvoFactores: boolean;
};

export type RecuperacionAbierta = {
  id: string;
  estado: "solicitada" | "aprobada";
  venceEn: Date | null;
};

export type SuperficieDeSesion = "cliente" | "sofipo" | "telefono";

/** «reautenticar»: confirmar la identidad dentro de una sesión. Su reto queda ligado a esa sesión. */
export type PropositoDeReto = "entrar" | "registrar" | "reautenticar";

export type SesionNueva = {
  id: string;
  tokenHash: string;
  expiresAt: Date;
  superficie?: "cliente" | "sofipo" | "telefono";
};

export type NuevaPasskey = {
  id: string;
  credencialId: string;
  llavePublica: Uint8Array;
  contador: number;
  transportes: string[];
  nombre: string;
  respaldada: boolean;
};

/** Lo que el segundo factor cambia, en la misma transacción que abre la sesión. */
export type Efecto =
  | { tipo: "totp"; totpId: string; paso: number }
  | { tipo: "passkey"; passkeyId: string; contador: number }
  | { tipo: "respaldo"; codigoHash: string }
  | { tipo: "inscribir_totp"; totpId: string; paso: number; codigosHash: string[]; recuperacionId: string | null }
  | { tipo: "inscribir_passkey"; passkey: NuevaPasskey; codigosHash: string[]; recuperacionId: string | null };

export type RepositorioAutenticacion = {
  buscarUsuarioPorCorreo: (correo: string) => Promise<UsuarioAuth | null>;
  buscarPersona: (userId: string) => Promise<Persona | null>;
  crearEntrada: (entrada: { id: string; userId: string; tokenHash: string; creadaEn: Date; venceEn: Date }) => Promise<void>;
  registrarContrasenaFallida: (userId: string | null, ahora: Date) => Promise<void>;
  leerEntrada: (tokenHash: string, ahora: Date) => Promise<Entrada | null>;
  contarFallosContrasena: (userId: string, desde: Date) => Promise<number>;
  /**
   * Aparta un intento de segundo factor en la entrada antes de verificar. Devuelve
   * los intentos apartados, o null si ya hay 5 (o la entrada venció): entonces no
   * se verifica nada. Un acierto lo devuelve al consumir la entrada.
   */
  apartarIntentoDeEntrada: (entradaId: string, userId: string) => Promise<number | null>;
  /** El intento apartado falló: queda en la bitácora y, con 5, la entrada se quema. */
  registrarFalloDeEntrada: (args: { entradaId: string; userId: string; intentos: number; ahora: Date }) => Promise<void>;
  factores: (userId: string) => Promise<EstadoFactores>;
  recuperacionAbierta: (userId: string) => Promise<RecuperacionAbierta | null>;
  guardarReto: (reto: {
    id: string;
    userId: string;
    proposito: PropositoDeReto;
    reto: string;
    creadoEn: Date;
    venceEn: Date;
    /** Solo para reautenticar: la sesión que pidió el reto. */
    sesionId?: string | null;
  }) => Promise<void>;
  tomarReto: (userId: string, proposito: PropositoDeReto, ahora: Date, sesionId?: string | null) => Promise<string | null>;
  completarEntrada: (args: {
    entradaId: string;
    userId: string;
    metodo: MetodoSegundoFactor;
    sesion: SesionNueva;
    efecto: Efecto;
    ahora: Date;
  }) => Promise<void>;
  guardarTotpPendiente: (args: { id: string; userId: string; secretoCifrado: string; creadoEn: Date }) => Promise<void>;
  confirmarTotp: (args: { userId: string; totpId: string; paso: number; ahora: Date }) => Promise<void>;
  agregarPasskey: (args: { userId: string; passkey: NuevaPasskey; ahora: Date }) => Promise<void>;
  revocarPasskey: (args: { userId: string; passkeyId: string; actorId: string; ahora: Date }) => Promise<void>;
  revocarTotp: (args: { userId: string; actorId: string; ahora: Date }) => Promise<void>;
  regenerarRespaldo: (args: { userId: string; codigosHash: string[]; ahora: Date }) => Promise<void>;
  /**
   * Confirma la identidad dentro de una sesión ya abierta: consume el factor
   * (paso TOTP, contador de passkey o código de respaldo) y renueva
   * segundo_factor_en de esa sesión en la misma transacción. Queda auditado.
   */
  reautenticar: (args: {
    sesionId: string;
    userId: string;
    metodo: MetodoSegundoFactor;
    efecto: Extract<Efecto, { tipo: "totp" | "passkey" | "respaldo" }>;
    superficie: SuperficieDeSesion;
    ahora: Date;
  }) => Promise<void>;
  /**
   * Aparta un intento de confirmar la identidad antes de verificar. Devuelve los
   * intentos apartados, o null si ya hay 5: entonces borra la sesión sin verificar.
   * Un acierto lo regresa a 0 en la transacción que renueva el sello.
   */
  apartarIntentoDeReautenticacion: (args: { sesionId: string; userId: string }) => Promise<number | null>;
  /** El intento apartado falló: queda en la bitácora y, con 5, la sesión se borra. */
  registrarFalloDeReautenticacion: (args: {
    sesionId: string;
    userId: string;
    superficie: SuperficieDeSesion;
    intentos: number;
    ahora: Date;
  }) => Promise<void>;
  solicitarRecuperacion: (args: { id: string; userId: string; motivo: string; entradaId: string; ahora: Date }) => Promise<void>;
  /** Solo el personal activo: corre como plataforma_sofipo. */
  recuperacionesPendientes: (personalId: string) => Promise<RecuperacionPendiente[]>;
  /** Devuelve a quién pertenece la solicitud aprobada, para avisarle. */
  aprobarRecuperacion: (args: {
    id: string;
    aprobadorId: string;
    verificacion: VerificacionIdentidad;
    nota: string | null;
    ahora: Date;
    venceEn: Date;
  }) => Promise<{ userId: string }>;
  rechazarRecuperacion: (args: { id: string; aprobadorId: string; nota: string; ahora: Date }) => Promise<void>;
  segundoFactorDeSesion: (sessionId: string) => Promise<MetodoSegundoFactor | null>;
  esPersonal: (userId: string) => Promise<boolean>;
};

export const SQL = {
  buscarCorreo: "select id, nombre, correo, password_hash from identidad_por_correo($1)",
  buscarPersona: "select id, nombre, correo from users where id = $1",
  bloquearUsuario: "select id from users where id = $1 for update",
  insertarEntrada: `insert into auth_entradas (id, user_id, token_hash, creada_en, vence_en)
    values ($1, $2, $3, $4, $5)`,
  leerEntrada: "select id, user_id, vence_en, intentos_fallidos from entrada_por_token($1, $2)",
  contarFallosContrasena: "select fallos_de_contrasena($1, $2) as fallos",
  apartarIntentoDeEntrada: `update auth_entradas
    set intentos_fallidos = intentos_fallidos + 1
    where id = $1 and user_id = $2 and consumida_en is null and intentos_fallidos < 5 and vence_en > now()
    returning intentos_fallidos`,
  // El intento apartado acertó: se devuelve en la misma escritura que consume.
  consumirEntrada: `update auth_entradas
    set verificada_con = $3, verificada_en = now(), consumida_en = now(), intentos_fallidos = intentos_fallidos - 1
    where id = $1 and user_id = $2 and consumida_en is null and intentos_fallidos between 1 and 5 and vence_en >= now()`,
  quemarEntrada: `update auth_entradas set consumida_en = now()
    where id = $1 and user_id = $2 and consumida_en is null`,
  passkeysVigentes: `select id, user_id, credencial_id, llave_publica, contador, transportes, nombre, respaldada,
      creada_en, ultimo_uso_en
    from auth_passkeys where user_id = $1 and revocada_en is null order by creada_en`,
  totpVigente: `select id, user_id, secreto_cifrado, confirmado_en, ultimo_paso
    from auth_totp where user_id = $1 and revocado_en is null`,
  respaldoRestantes: `select count(*)::int as restantes from auth_codigos_respaldo
    where user_id = $1 and usado_en is null and invalidado_en is null`,
  tuvoFactores: `select (
      exists (select 1 from auth_passkeys where user_id = $1)
      or exists (select 1 from auth_totp where user_id = $1 and confirmado_en is not null)
    ) as tuvo`,
  factoresVigentes: `select
      (select count(*) from auth_passkeys where user_id = $1 and revocada_en is null)::int as passkeys,
      (select count(*) from auth_totp where user_id = $1 and revocado_en is null and confirmado_en is not null)::int as totp`,
  recuperacionAbierta: `select id, estado, vence_en from auth_recuperaciones
    where user_id = $1 and estado in ('solicitada', 'aprobada')`,
  recuperacionParaActualizar: `select id, estado, vence_en from auth_recuperaciones
    where user_id = $1 and estado in ('solicitada', 'aprobada') for update`,
  insertarReto: `insert into auth_retos (id, user_id, proposito, reto, creado_en, vence_en, sesion_id)
    values ($1, $2, $3, $4, $5, $6, $7)`,
  tomarReto: `update auth_retos set usado_en = $3
    where id = (
      select id from auth_retos
      where user_id = $1 and proposito = $2 and sesion_id is not distinct from $4 and usado_en is null and vence_en > $3
      order by creado_en desc
      limit 1
      for update skip locked
    )
    returning reto`,
  borrarSesionesDelUsuario: "delete from sessions where user_id = $1",
  cerrarSesionesDelUsuario: "delete from sessions where user_id = $1 returning id",
  insertarSesion: `insert into sessions (id, user_id, token_hash, expires_at, segundo_factor, entrada_id, superficie)
    values ($1, $2, $3, $4, $5, $6, $7)`,
  usarTotp: `update auth_totp set ultimo_paso = $2
    where id = $1 and user_id = $3 and revocado_en is null and confirmado_en is not null
      and (ultimo_paso is null or ultimo_paso < $2)`,
  usarPasskey: `update auth_passkeys set contador = greatest(contador, $2), ultimo_uso_en = $3
    where id = $1 and user_id = $4 and revocada_en is null`,
  usarRespaldo: `update auth_codigos_respaldo set usado_en = $3
    where user_id = $1 and codigo_hash = $2 and usado_en is null and invalidado_en is null
    returning id`,
  borrarTotpPendiente: "delete from auth_totp where user_id = $1 and confirmado_en is null",
  insertarTotp: "insert into auth_totp (id, user_id, secreto_cifrado, creado_en) values ($1, $2, $3, $4)",
  confirmarTotp: `update auth_totp set confirmado_en = $3, ultimo_paso = $4
    where id = $1 and user_id = $2 and confirmado_en is null and revocado_en is null`,
  insertarPasskey: `insert into auth_passkeys
      (id, user_id, credencial_id, llave_publica, contador, transportes, nombre, respaldada, creada_en)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
  revocarPasskey: `update auth_passkeys set revocada_en = $3, revocada_por = $4
    where id = $1 and user_id = $2 and revocada_en is null`,
  revocarTotp: `update auth_totp set revocado_en = $2, revocado_por = $3
    where user_id = $1 and revocado_en is null and confirmado_en is not null
    returning id`,
  invalidarRespaldo: `update auth_codigos_respaldo set invalidado_en = $2
    where user_id = $1 and usado_en is null and invalidado_en is null`,
  insertarRespaldo: `insert into auth_codigos_respaldo (id, user_id, codigo_hash, creado_en)
    select gen_random_uuid(), $1, hash, $3 from unnest($2::text[]) as hash`,
  cumplirRecuperacion: `update auth_recuperaciones set estado = 'cumplida', cumplida_en = $3
    where id = $1 and user_id = $2 and estado = 'aprobada' and vence_en > $3`,
  vencerRecuperacion: `update auth_recuperaciones set estado = 'vencida'
    where id = $1 and user_id = $2 and estado = 'aprobada' and vence_en <= $3`,
  insertarRecuperacion: `insert into auth_recuperaciones (id, user_id, solicitada_en, motivo)
    values ($1, $2, $3, $4)`,
  recuperacionesPendientes: "select id, nombre, correo, motivo, solicitada_en from recuperaciones_pendientes()",
  bloquearRecuperacion: "select user_id, estado from auth_recuperaciones where id = $1 for update",
  aprobarRecuperacion: `update auth_recuperaciones
    set estado = 'aprobada', resuelta_por = $2, resuelta_en = $3, verificacion = $4, nota = $5, vence_en = $6
    where id = $1 and estado = 'solicitada'`,
  rechazarRecuperacion: `update auth_recuperaciones
    set estado = 'rechazada', resuelta_por = $2, resuelta_en = $3, nota = $4
    where id = $1 and estado = 'solicitada'`,
  revocarPasskeysDelUsuario: `update auth_passkeys set revocada_en = $2, revocada_por = $3
    where user_id = $1 and revocada_en is null
    returning id`,
  segundoFactorDeSesion: "select factor_de_sesion($1) as segundo_factor",
  // clock_timestamp(): después del candado de la persona, así el sello siempre
  // avanza aunque otra confirmación de esta sesión haya empezado después.
  renovarFactorDeSesion: `update sessions
    set segundo_factor_en = clock_timestamp(), segundo_factor_metodo = $3, reautenticaciones_fallidas = 0
    where id = $1 and user_id = $2`,
  apartarIntentoDeReautenticacion: `update sessions
    set reautenticaciones_fallidas = reautenticaciones_fallidas + 1
    where id = $1 and user_id = $2 and reautenticaciones_fallidas < 5
    returning reautenticaciones_fallidas`,
  borrarSesion: "delete from sessions where id = $1 and user_id = $2",
} as const;

export function repositorioPg(): RepositorioAutenticacion {
  return {
    async buscarUsuarioPorCorreo(correo) {
      const fila = primera(await consultarDefinidor(SQL.buscarCorreo, [correo]));
      if (!fila) return null;
      return {
        id: texto(fila.id),
        nombre: texto(fila.nombre),
        correo: texto(fila.correo),
        passwordHash: texto(fila.password_hash),
      };
    },
    async buscarPersona(userId) {
      const fila = primera(await consultar(SQL.buscarPersona, [userId], userId));
      if (!fila) return null;
      return { id: texto(fila.id), nombre: texto(fila.nombre), correo: texto(fila.correo) };
    },
    async crearEntrada(entrada) {
      await conTransaccion(entrada.userId, async (consulta) => {
        await consulta.query(SQL.insertarEntrada, [
          entrada.id,
          entrada.userId,
          entrada.tokenHash,
          entrada.creadaEn,
          entrada.venceEn,
        ]);
        await registrarHechoAutenticacion(
          hecho("entrada_contrasena", entrada.id, entrada.userId, entrada.creadaEn),
          consulta,
        );
      });
    },
    async registrarContrasenaFallida(userId, ahora) {
      const escribir = async (consulta: Consulta) => {
        await registrarHechoAutenticacion(
          hecho("entrada_fallida", userId ?? randomUUID(), userId, ahora),
          consulta,
        );
      };
      if (userId) await conTransaccion(userId, escribir);
      else await conContexto({ rol: "plataforma_cliente" }, escribir);
    },
    async leerEntrada(tokenHash, ahora) {
      const fila = primera(await consultarDefinidor(SQL.leerEntrada, [tokenHash, ahora]));
      if (!fila) return null;
      return {
        id: texto(fila.id),
        userId: texto(fila.user_id),
        venceEn: fecha(fila.vence_en),
        intentosFallidos: Number(fila.intentos_fallidos),
      };
    },
    async contarFallosContrasena(userId, desde) {
      const fila = primera(await consultarDefinidor(SQL.contarFallosContrasena, [userId, desde]));
      return Number(fila?.fallos ?? 0);
    },
    async apartarIntentoDeEntrada(entradaId, userId) {
      const fila = primera(await consultar(SQL.apartarIntentoDeEntrada, [entradaId, userId], userId));
      return fila ? Number(fila.intentos_fallidos) : null;
    },
    async registrarFalloDeEntrada({ entradaId, userId, intentos, ahora }) {
      await conTransaccion(userId, async (consulta) => {
        if (intentos >= 5) await consulta.query(SQL.quemarEntrada, [entradaId, userId]);
        await registrarHechoAutenticacion(hecho("segundo_factor_fallido", entradaId, userId, ahora), consulta);
      });
    },
    async factores(userId) {
      const [passkeys, totp, respaldo, tuvo] = await Promise.all([
        consultar(SQL.passkeysVigentes, [userId], userId),
        consultar(SQL.totpVigente, [userId], userId),
        consultar(SQL.respaldoRestantes, [userId], userId),
        consultar(SQL.tuvoFactores, [userId], userId),
      ]);
      const apps = (totp.rows as Record<string, unknown>[]).map(mapearTotp);
      return {
        passkeys: (passkeys.rows as Record<string, unknown>[]).map(mapearPasskey),
        totp: apps.find((app) => app.confirmado) ?? null,
        totpPendiente: apps.find((app) => !app.confirmado) ?? null,
        respaldoRestantes: Number((respaldo.rows[0] as { restantes?: unknown } | undefined)?.restantes ?? 0),
        tuvoFactores: (tuvo.rows[0] as { tuvo?: unknown } | undefined)?.tuvo === true,
      };
    },
    async recuperacionAbierta(userId) {
      return mapearAbierta(primera(await consultar(SQL.recuperacionAbierta, [userId], userId)));
    },
    async guardarReto(reto) {
      await consultar(
        SQL.insertarReto,
        [reto.id, reto.userId, reto.proposito, reto.reto, reto.creadoEn, reto.venceEn, reto.sesionId ?? null],
        reto.userId,
      );
    },
    async tomarReto(userId, proposito, ahora, sesionId) {
      const fila = primera(await consultar(SQL.tomarReto, [userId, proposito, ahora, sesionId ?? null], userId));
      return typeof fila?.reto === "string" ? fila.reto : null;
    },
    async completarEntrada({ entradaId, userId, metodo, sesion, efecto, ahora }) {
      await conTransaccion(userId, async (consulta) => {
        await consulta.query(SQL.bloquearUsuario, [userId]);
        await aplicarEfecto(consulta, userId, efecto, ahora);
        const consumida = await consulta.query(SQL.consumirEntrada, [entradaId, userId, metodo]);
        if (consumida.rowCount !== 1) throw new ErrorDeDominio("entrada_vencida");
        // Hoy la sesión de la persona es una. El frente de tenencia va a
        // permitir varias: entonces este delete tiene que quedar en la sesión
        // que nació sin segundo factor, no en todas.
        await consulta.query(SQL.borrarSesionesDelUsuario, [userId]);
        await consulta.query(SQL.insertarSesion, [
          sesion.id,
          userId,
          sesion.tokenHash,
          sesion.expiresAt,
          metodo,
          entradaId,
          sesion.superficie ?? "cliente",
        ]);
        const sofipo = sesion.superficie === "sofipo";
        if (sofipo) {
          const personal = await consulta.query(
            "select operator_id from platform_staff where user_id = $1 and estado = 'activo'",
            [userId],
          );
          const fila = personal.rows[0] as { operator_id?: unknown } | undefined;
          if (typeof fila?.operator_id !== "string") throw new ErrorDeDominio("sin_permiso");
          await consulta.query("set local role plataforma_sofipo");
          await consulta.query("select set_config('app.operator_id', $1, true), set_config('app.user_id', $2, true)", [
            fila.operator_id,
            userId,
          ]);
        }
        await registrarHechoAutenticacion(
          hecho("entrada_completa", sesion.id, userId, ahora),
          consulta,
          sofipo ? "sofipo" : "cliente",
        );
      });
    },
    async guardarTotpPendiente({ id, userId, secretoCifrado, creadoEn }) {
      await conTransaccion(userId, async (consulta) => {
        await consulta.query(SQL.bloquearUsuario, [userId]);
        await consulta.query(SQL.borrarTotpPendiente, [userId]);
        await consulta.query(SQL.insertarTotp, [id, userId, secretoCifrado, creadoEn]);
      });
    },
    async confirmarTotp({ userId, totpId, paso, ahora }) {
      await conTransaccion(userId, async (consulta) => {
        await consulta.query(SQL.bloquearUsuario, [userId]);
        const confirmado = await consulta.query(SQL.confirmarTotp, [totpId, userId, ahora, paso]);
        if (confirmado.rowCount !== 1) throw new ErrorDeDominio("segundo_factor_invalido");
        await registrarHechoAutenticacion(hecho("totp_confirmado", totpId, userId, ahora), consulta);
      });
    },
    async agregarPasskey({ userId, passkey, ahora }) {
      await conTransaccion(userId, async (consulta) => {
        await consulta.query(SQL.bloquearUsuario, [userId]);
        await insertarPasskey(consulta, userId, passkey, ahora);
      });
    },
    async revocarPasskey({ userId, passkeyId, actorId, ahora }) {
      await conTransaccion(userId, async (consulta) => {
        await consulta.query(SQL.bloquearUsuario, [userId]);
        const revocada = await consulta.query(SQL.revocarPasskey, [passkeyId, userId, ahora, actorId]);
        if (revocada.rowCount !== 1) throw new ErrorDeDominio("passkey_ausente");
        await exigirOtroFactor(consulta, userId);
        await registrarHechoAutenticacion(hecho("passkey_revocada", passkeyId, actorId, ahora), consulta);
      });
    },
    async revocarTotp({ userId, actorId, ahora }) {
      await conTransaccion(userId, async (consulta) => {
        await consulta.query(SQL.bloquearUsuario, [userId]);
        const revocado = await consulta.query(SQL.revocarTotp, [userId, ahora, actorId]);
        const fila = revocado.rows[0] as { id?: unknown } | undefined;
        if (typeof fila?.id !== "string") throw new ErrorDeDominio("totp_ausente");
        await exigirOtroFactor(consulta, userId);
        await registrarHechoAutenticacion(hecho("totp_revocado", fila.id, actorId, ahora), consulta);
      });
    },
    async regenerarRespaldo({ userId, codigosHash, ahora }) {
      await conTransaccion(userId, async (consulta) => {
        await consulta.query(SQL.bloquearUsuario, [userId]);
        await guardarRespaldo(consulta, userId, codigosHash, ahora);
      });
    },
    async solicitarRecuperacion({ id, userId, motivo, entradaId, ahora }) {
      await conTransaccion(userId, async (consulta) => {
        await consulta.query(SQL.bloquearUsuario, [userId]);
        const quemada = await consulta.query(SQL.quemarEntrada, [entradaId, userId]);
        if (quemada.rowCount !== 1) throw new ErrorDeDominio("entrada_vencida");
        const abierta = mapearAbierta(primera(await consulta.query(SQL.recuperacionParaActualizar, [userId])));
        if (abierta?.estado === "aprobada" && abierta.venceEn !== null && abierta.venceEn.getTime() <= ahora.getTime()) {
          const vencida = await consulta.query(SQL.vencerRecuperacion, [abierta.id, userId, ahora]);
          if (vencida.rowCount !== 1) throw new ErrorDeDominio("recuperacion_abierta");
          await registrarHechoAutenticacion(hecho("recuperacion_vencida", abierta.id, userId, ahora), consulta);
        } else if (abierta) {
          throw new ErrorDeDominio("recuperacion_abierta");
        }
        await consulta.query(SQL.insertarRecuperacion, [id, userId, ahora, motivo]);
        await registrarHechoAutenticacion(hecho("recuperacion_solicitada", id, userId, ahora), consulta);
      });
    },
    async reautenticar({ sesionId, userId, metodo, efecto, superficie, ahora }) {
      await conTransaccion(userId, async (consulta) => {
        await consulta.query(SQL.bloquearUsuario, [userId]);
        await aplicarEfecto(consulta, userId, efecto, ahora);
        const renovada = await consulta.query(SQL.renovarFactorDeSesion, [sesionId, userId, metodo]);
        if (renovada.rowCount !== 1) throw new ErrorDeDominio("sesion_ausente");
        await auditarEnSuperficie(consulta, userId, superficie, hecho("reautenticacion", sesionId, userId, ahora));
      });
    },
    async apartarIntentoDeReautenticacion({ sesionId, userId }) {
      return conTransaccion(userId, async (consulta) => {
        const fila = primera(await consulta.query(SQL.apartarIntentoDeReautenticacion, [sesionId, userId]));
        if (fila) return Number(fila.reautenticaciones_fallidas);
        // Sin intento que apartar: la sesión agotó sus 5 (o ya no existe).
        await consulta.query(SQL.borrarSesion, [sesionId, userId]);
        return null;
      });
    },
    async registrarFalloDeReautenticacion({ sesionId, userId, superficie, intentos, ahora }) {
      await conTransaccion(userId, async (consulta) => {
        if (intentos >= 5) await consulta.query(SQL.borrarSesion, [sesionId, userId]);
        await auditarEnSuperficie(consulta, userId, superficie, hecho("reautenticacion_fallida", sesionId, userId, ahora));
      });
    },
    async recuperacionesPendientes(personalId) {
      const resultado = await conPersonal(personalId, (consulta) => consulta.query(SQL.recuperacionesPendientes, []));
      return (resultado.rows as Record<string, unknown>[]).map((fila) => ({
        id: texto(fila.id),
        nombre: texto(fila.nombre),
        correo: texto(fila.correo),
        motivo: texto(fila.motivo),
        solicitadaEn: fecha(fila.solicitada_en),
      }));
    },
    async aprobarRecuperacion({ id, aprobadorId, verificacion, nota, ahora, venceEn }) {
      return conPersonal(aprobadorId, async (consulta) => {
        const userId = await bloquearSolicitud(consulta, id, aprobadorId);
        const aprobada = await consulta.query(SQL.aprobarRecuperacion, [
          id,
          aprobadorId,
          ahora,
          verificacion,
          nota,
          venceEn,
        ]);
        if (aprobada.rowCount !== 1) throw new ErrorDeDominio("recuperacion_ausente");
        await registrarHechoAutenticacion(hecho("recuperacion_aprobada", id, aprobadorId, ahora), consulta, "sofipo");
        return { userId };
      });
    },
    async rechazarRecuperacion({ id, aprobadorId, nota, ahora }) {
      await conPersonal(aprobadorId, async (consulta) => {
        await bloquearSolicitud(consulta, id, aprobadorId);
        const rechazada = await consulta.query(SQL.rechazarRecuperacion, [id, aprobadorId, ahora, nota]);
        if (rechazada.rowCount !== 1) throw new ErrorDeDominio("recuperacion_ausente");
        await registrarHechoAutenticacion(hecho("recuperacion_rechazada", id, aprobadorId, ahora), consulta, "sofipo");
      });
    },
    async esPersonal(userId) {
      const fila = primera(
        await consultar(
          "select operator_id from platform_staff where user_id = $1 and estado = 'activo'",
          [userId],
          userId,
        ),
      );
      return typeof fila?.operator_id === "string";
    },
    async segundoFactorDeSesion(sessionId) {
      const fila = primera(await consultarDefinidor(SQL.segundoFactorDeSesion, [sessionId]));
      const valor = fila?.segundo_factor;
      return valor === "passkey" || valor === "totp" || valor === "respaldo" ? valor : null;
    },
  };
}

async function aplicarEfecto(consulta: Consulta, userId: string, efecto: Efecto, ahora: Date): Promise<void> {
  switch (efecto.tipo) {
    case "totp": {
      const usado = await consulta.query(SQL.usarTotp, [efecto.totpId, efecto.paso, userId]);
      if (usado.rowCount !== 1) throw new ErrorDeDominio("segundo_factor_invalido");
      return;
    }
    case "passkey": {
      const usada = await consulta.query(SQL.usarPasskey, [efecto.passkeyId, efecto.contador, ahora, userId]);
      if (usada.rowCount !== 1) throw new ErrorDeDominio("segundo_factor_invalido");
      return;
    }
    case "respaldo": {
      const usado = await consulta.query(SQL.usarRespaldo, [userId, efecto.codigoHash, ahora]);
      const fila = usado.rows[0] as { id?: unknown } | undefined;
      if (typeof fila?.id !== "string") throw new ErrorDeDominio("segundo_factor_invalido");
      await registrarHechoAutenticacion(hecho("respaldo_usado", fila.id, userId, ahora), consulta);
      return;
    }
    case "inscribir_totp": {
      await retirarFactoresAnteriores(consulta, userId, efecto.recuperacionId, ahora);
      const confirmado = await consulta.query(SQL.confirmarTotp, [efecto.totpId, userId, ahora, efecto.paso]);
      if (confirmado.rowCount !== 1) throw new ErrorDeDominio("segundo_factor_invalido");
      await registrarHechoAutenticacion(hecho("totp_confirmado", efecto.totpId, userId, ahora), consulta);
      await guardarRespaldo(consulta, userId, efecto.codigosHash, ahora);
      await cumplirRecuperacion(consulta, userId, efecto.recuperacionId, ahora);
      return;
    }
    case "inscribir_passkey": {
      await retirarFactoresAnteriores(consulta, userId, efecto.recuperacionId, ahora);
      await consulta.query(SQL.borrarTotpPendiente, [userId]);
      await insertarPasskey(consulta, userId, efecto.passkey, ahora);
      await guardarRespaldo(consulta, userId, efecto.codigosHash, ahora);
      await cumplirRecuperacion(consulta, userId, efecto.recuperacionId, ahora);
      return;
    }
  }
}

async function insertarPasskey(consulta: Consulta, userId: string, passkey: NuevaPasskey, ahora: Date): Promise<void> {
  await consulta.query(SQL.insertarPasskey, [
    passkey.id,
    userId,
    passkey.credencialId,
    Buffer.from(passkey.llavePublica),
    passkey.contador,
    passkey.transportes,
    passkey.nombre,
    passkey.respaldada,
    ahora,
  ]);
  await registrarHechoAutenticacion(hecho("passkey_registrada", passkey.id, userId, ahora), consulta);
}

async function guardarRespaldo(consulta: Consulta, userId: string, codigosHash: string[], ahora: Date): Promise<void> {
  await consulta.query(SQL.invalidarRespaldo, [userId, ahora]);
  await consulta.query(SQL.insertarRespaldo, [userId, codigosHash, ahora]);
  await registrarHechoAutenticacion(hecho("respaldo_generado", userId, userId, ahora), consulta);
}

async function cumplirRecuperacion(
  consulta: Consulta,
  userId: string,
  recuperacionId: string | null,
  ahora: Date,
): Promise<void> {
  if (!recuperacionId) return;
  const cumplida = await consulta.query(SQL.cumplirRecuperacion, [recuperacionId, userId, ahora]);
  if (cumplida.rowCount !== 1) throw new ErrorDeDominio("recuperacion_vencida");
  await registrarHechoAutenticacion(hecho("recuperacion_cumplida", recuperacionId, userId, ahora), consulta);
}

/**
 * Sin recuperación, inscribir solo cabe sin factores. Con la recuperación
 * aprobada, los factores anteriores pueden estar en otras manos: se revocan las
 * passkeys y la app confirmada y se cierran las sesiones, cada uno con su
 * evento, en la transacción que confirma el factor nuevo y cumple la
 * recuperación. Los códigos de respaldo viejos los invalida guardarRespaldo.
 */
async function retirarFactoresAnteriores(
  consulta: Consulta,
  userId: string,
  recuperacionId: string | null,
  ahora: Date,
): Promise<void> {
  if (!recuperacionId) {
    await exigirSinFactores(consulta, userId);
    return;
  }
  const passkeys = await consulta.query(SQL.revocarPasskeysDelUsuario, [userId, ahora, userId]);
  for (const id of idsDe(passkeys.rows)) {
    await registrarHechoAutenticacion(hecho("passkey_revocada", id, userId, ahora), consulta);
  }
  const apps = await consulta.query(SQL.revocarTotp, [userId, ahora, userId]);
  for (const id of idsDe(apps.rows)) {
    await registrarHechoAutenticacion(hecho("totp_revocado", id, userId, ahora), consulta);
  }
  const sesiones = await consulta.query(SQL.cerrarSesionesDelUsuario, [userId]);
  for (const id of idsDe(sesiones.rows)) {
    await registrarHechoAutenticacion(hecho("sesion_cerrada", id, userId, ahora), consulta);
  }
}

function idsDe(filas: unknown[]): string[] {
  return (filas as { id?: unknown }[]).map((fila) => texto(fila.id));
}

async function contarVigentes(consulta: Consulta, userId: string): Promise<number> {
  const fila = (await consulta.query(SQL.factoresVigentes, [userId])).rows[0] as
    | { passkeys?: unknown; totp?: unknown }
    | undefined;
  return Number(fila?.passkeys ?? 0) + Number(fila?.totp ?? 0);
}

async function exigirSinFactores(consulta: Consulta, userId: string): Promise<void> {
  if ((await contarVigentes(consulta, userId)) > 0) throw new ErrorDeDominio("ya_tiene_segundo_factor");
}

async function exigirOtroFactor(consulta: Consulta, userId: string): Promise<void> {
  if ((await contarVigentes(consulta, userId)) === 0) throw new ErrorDeDominio("ultimo_factor");
}

/**
 * El personal firma como personal: igual que al abrir su sesión, la
 * transacción pasa a plataforma_sofipo con su operador antes de auditar.
 */
async function auditarEnSuperficie(
  consulta: Consulta,
  userId: string,
  superficie: SuperficieDeSesion,
  evento: ReturnType<typeof hecho>,
): Promise<void> {
  if (superficie !== "sofipo") {
    await registrarHechoAutenticacion(evento, consulta, "cliente");
    return;
  }
  const personal = await consulta.query(
    "select operator_id from platform_staff where user_id = $1 and estado = 'activo'",
    [userId],
  );
  const fila = personal.rows[0] as { operator_id?: unknown } | undefined;
  if (typeof fila?.operator_id !== "string") throw new ErrorDeDominio("sin_permiso");
  await consulta.query("set local role plataforma_sofipo");
  await consulta.query("select set_config('app.operator_id', $1, true), set_config('app.user_id', $2, true)", [
    fila.operator_id,
    userId,
  ]);
  await registrarHechoAutenticacion(evento, consulta, "sofipo");
}

async function bloquearSolicitud(consulta: Consulta, id: string, aprobadorId: string): Promise<string> {
  const fila = (await consulta.query(SQL.bloquearRecuperacion, [id])).rows[0] as
    | { user_id?: unknown; estado?: unknown }
    | undefined;
  if (!fila || fila.estado !== "solicitada" || typeof fila.user_id !== "string") {
    throw new ErrorDeDominio("recuperacion_ausente");
  }
  if (fila.user_id === aprobadorId) throw new ErrorDeDominio("misma_persona_en_recuperacion");
  return fila.user_id;
}

function mapearPasskey(fila: Record<string, unknown>): PasskeyGuardada {
  const llave = fila.llave_publica;
  return {
    id: texto(fila.id),
    userId: texto(fila.user_id),
    credencialId: texto(fila.credencial_id),
    llavePublica: llave instanceof Uint8Array ? new Uint8Array(llave) : new Uint8Array(),
    contador: Number(fila.contador),
    transportes: Array.isArray(fila.transportes) ? fila.transportes.filter((t): t is string => typeof t === "string") : [],
    nombre: texto(fila.nombre),
    respaldada: fila.respaldada === true,
    creadaEn: fecha(fila.creada_en),
    ultimoUsoEn: fila.ultimo_uso_en === null || fila.ultimo_uso_en === undefined ? null : fecha(fila.ultimo_uso_en),
  };
}

function mapearTotp(fila: Record<string, unknown>): TotpGuardado {
  return {
    id: texto(fila.id),
    userId: texto(fila.user_id),
    secretoCifrado: texto(fila.secreto_cifrado),
    confirmado: fila.confirmado_en !== null && fila.confirmado_en !== undefined,
    ultimoPaso: fila.ultimo_paso === null || fila.ultimo_paso === undefined ? null : Number(fila.ultimo_paso),
  };
}

function mapearAbierta(fila: Record<string, unknown> | undefined): RecuperacionAbierta | null {
  if (!fila) return null;
  return {
    id: texto(fila.id),
    estado: fila.estado === "aprobada" ? "aprobada" : "solicitada",
    venceEn: fila.vence_en === null || fila.vence_en === undefined ? null : fecha(fila.vence_en),
  };
}

function primera(resultado: { rows: unknown[] }): Record<string, unknown> | undefined {
  return resultado.rows[0] as Record<string, unknown> | undefined;
}

function texto(valor: unknown): string {
  if (typeof valor !== "string") throw new ErrorDeDominio("base_no_disponible");
  return valor;
}

function fecha(valor: unknown): Date {
  const instante = valor instanceof Date ? valor : new Date(String(valor));
  if (Number.isNaN(instante.getTime())) throw new ErrorDeDominio("base_no_disponible");
  return instante;
}
