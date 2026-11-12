import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NOMBRE_COOKIE } from "../session/cookie";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import type { Sesion } from "../session/tipos";
import { aBase32, codigoDelPaso, pasoDe } from "./totp";
import { cifrarSemilla } from "./cifrado";
import { hashDeRespaldo } from "./respaldo";
import {
  agregarPasskeyDeSesion,
  confirmarConPasskey,
  confirmarConRespaldo,
  confirmarConTotp,
  confirmarTotpDeSesion,
  entrarConPasskey,
  entrarConRespaldo,
  entrarConTotp,
  estadoDeConfirmacion,
  iniciarConContrasena,
  inscribirPasskey,
  inscribirTotp,
  leerPaso,
  nuevosCodigos,
  opcionesParaConfirmarConPasskey,
  opcionesParaEntrarConPasskey,
  opcionesParaInscribirPasskey,
  opcionesPasskeyDeSesion,
  pedirRecuperacion,
  PISO_RECHAZO_MS,
  prepararTotp,
  prepararTotpDeSesion,
  quitarPasskey,
  quitarTotp,
  resolverRecuperacion,
  verFactores,
  verRecuperaciones,
} from "./servicio";
import type { AvisoDeSeguridad } from "../seguridad/avisos";
import type {
  CeremoniaTotp,
  Efecto,
  EstadoFactores,
  NuevaPasskey,
  PasskeyGuardada,
  RepositorioAutenticacion,
  TotpGuardado,
  UsuarioAuth,
} from "./repositorio";
import type { AdaptadorWebauthn } from "./webauthn";
import { NOMBRE_COOKIE_ENTRADA } from "./cookie";

const AHORA = new Date("2026-11-04T12:00:00.000Z");
const CLAVE = "clave-segura-12";
const SEMILLA = Buffer.from("12345678901234567890");
const LLAVE = Buffer.alloc(32, 4);
const RETO = "a".repeat(43);
const CREDENCIAL = "credencial-valida-0001";

describe("entrar con segundo factor", () => {
  it("la contraseña sola no abre sesión, y el error no dice cuál falló", async () => {
    const repo = memoria();
    const verificaciones: string[] = [];
    const deps = base(repo, async (plana, hash) => {
      verificaciones.push(hash);
      return hash === `hash:${plana}`;
    });
    assert.equal((await iniciarConContrasena({ correo: "ana@ejemplo.mx", contrasena: "otra-clave-99" }, deps)).tipo, "rechazo");
    assert.equal(
      (await iniciarConContrasena({ correo: "nadie@ejemplo.mx", contrasena: CLAVE }, deps)).tipo,
      "rechazo",
    );
    assert.equal(verificaciones.length, 2);
    assert.notEqual(verificaciones[1], `hash:${CLAVE}`);
    assert.equal(repo.entradas.length, 0);
    assert.equal(repo.sesiones.length, 0);
    assert.equal(repo.eventos.includes("entrada_fallida"), true);

    const inicio = await iniciarConContrasena({ correo: "ANA@ejemplo.mx", contrasena: CLAVE }, deps);
    assert.equal(inicio.tipo, "entrada");
    if (inicio.tipo !== "entrada") return;
    assert.equal(inicio.cookie.nombre, NOMBRE_COOKIE_ENTRADA);
    assert.equal(inicio.cookie.valor.includes(CLAVE), false);
    assert.equal(repo.sesiones.length, 0);
    const paso = await leerPaso(inicio.cookie.valor, deps);
    assert.equal(paso.paso, "inscribir");
  });

  it("bloquea el correo tras ocho contraseñas mal y no abre entrada", async () => {
    const repo = memoria();
    const deps = base(repo);
    for (let i = 0; i < 8; i += 1) {
      assert.equal(
        (await iniciarConContrasena({ correo: "ana@ejemplo.mx", contrasena: "otra-clave-99" }, deps)).tipo,
        "rechazo",
      );
    }
    const bloqueada = await iniciarConContrasena({ correo: "ana@ejemplo.mx", contrasena: CLAVE }, deps);
    assert.deepEqual(bloqueada, { tipo: "rechazo", codigo: "credenciales_invalidas" });
    assert.equal(repo.entradas.length, 0);
    // El intento en el tope no se anota: la bitácora queda con los ocho fallos reales.
    assert.equal(repo.fallos.length, 8);
    assert.equal(repo.eventos.filter((e) => e === "entrada_fallida").length, 8);
  });

  it("inscribe TOTP, no guarda la semilla ni los códigos, y el código no sirve dos veces", async () => {
    const repo = memoria();
    const deps = base(repo);
    const token = await entrarHasta(deps);
    const alta = await prepararTotp(token, deps);
    assert.equal(alta.semilla.includes(" "), true);
    assert.equal(JSON.stringify(repo.totp).includes(aBase32(SEMILLA)), false);
    const codigo = codigoDelPaso(SEMILLA, pasoDe(AHORA));
    const inscripcion = await inscribirTotp(token, codigo, deps);
    assert.match(inscripcion.setCookie, new RegExp(`^${NOMBRE_COOKIE}=`));
    assert.equal(inscripcion.setCookie.includes(codigo), false);
    assert.equal(inscripcion.codigos.length, 10);
    assert.equal(repo.sesiones[0]?.factor, "totp");
    for (const codigoPlano of inscripcion.codigos) {
      assert.equal(JSON.stringify(repo.respaldos).includes(codigoPlano), false);
      assert.equal(repo.respaldos.some((r) => r.hash === hashDeRespaldo(codigoPlano.replace(/-/g, ""))), true);
    }
    assert.equal(JSON.stringify(await verFactores(sesionDe(repo), deps)).includes(aBase32(SEMILLA)), false);

    const repetido = await codigoDe(entrarConTotp(token, codigo, deps));
    assert.equal(repetido, "entrada_vencida");
    const otra = await entrarHasta(deps);
    assert.equal(await codigoDe(entrarConTotp(otra, codigo, deps)), "segundo_factor_invalido");
    const respaldo = inscripcion.codigos[0]!;
    const tercera = await entrarHasta(deps);
    const cookie = await entrarConRespaldo(tercera, respaldo, deps);
    assert.match(cookie, /sesion=/);
    assert.equal(await codigoDe(entrarConRespaldo(await entrarHasta(deps), respaldo, deps)), "segundo_factor_invalido");
  });

  it("registra una passkey, entra con ella y no deja quitar el último factor", async () => {
    const repo = memoria();
    const deps = base(repo);
    const token = await entrarHasta(deps);
    await opcionesParaInscribirPasskey(token, origen(), deps);
    const inscripcion = await inscribirPasskey(token, { id: CREDENCIAL }, origen(), "Laptop", deps);
    assert.equal(inscripcion.codigos.length, 10);
    assert.equal((await verFactores(sesionDe(repo), deps)).passkeys[0]?.nombre, "Laptop");
    assert.equal(await codigoDe(quitarPasskey(sesionDe(repo), repo.passkeys[0]?.id, deps)), "ultimo_factor");

    const otra = await entrarHasta(deps);
    await opcionesParaEntrarConPasskey(otra, origen(), deps);
    const cookie = await entrarConPasskey(otra, { id: CREDENCIAL }, origen(), deps);
    assert.match(cookie, /sesion=/);
    assert.equal(await codigoDe(entrarConPasskey(await entrarHasta(deps), { id: "credencial-falsa-00001" }, origen(), deps)), "segundo_factor_invalido");
  });

  it("la recuperación no abre la cuenta: otra persona aprueba y hay que inscribir de nuevo", async () => {
    const repo = memoria();
    const deps = base(repo);
    const token = await entrarHasta(deps);
    await prepararTotp(token, deps);
    await inscribirTotp(token, codigoDelPaso(SEMILLA, pasoDe(AHORA)), deps);
    const sesion = sesionDe(repo);
    const perdida = await entrarHasta(deps);
    await pedirRecuperacion(perdida, "Perdí el teléfono con la app", deps);
    assert.equal((await verFactores(sesion, deps)).totp, true);
    assert.equal(repo.recuperaciones[0]?.estado, "solicitada");

    deps.operadores.add("ana@ejemplo.mx");
    assert.equal(
      await codigoDe(
        resolverRecuperacion({ ...sesion, superficie: "sofipo" }, { id: repo.recuperaciones[0]!.id, aprobada: true, verificacion: "presencial" }, deps),
      ),
      "misma_persona_en_recuperacion",
    );
    const operador = sesionDe(repo, "00000000-0000-4000-8000-0000000000bb", "operador@arco.mx", { superficie: "sofipo" });
    repo.sesiones.push({ id: operador.id, userId: operador.usuario.id, factor: "totp" });
    await resolverRecuperacion(
      operador,
      { id: repo.recuperaciones[0]!.id, aprobada: true, verificacion: "videollamada", nota: "La vi" },
      deps,
    );
    assert.equal(repo.recuperaciones[0]?.estado, "aprobada");
    assert.ok(repo.passkeys.filter((p) => !p.revocado).length + repo.totp.filter((t) => t.confirmado && !t.revocado).length > 0);
    assert.equal(
      await codigoDe(
        resolverRecuperacion(operador, { id: "00000000-0000-4000-8000-000000000099", aprobada: true, verificacion: "presencial" }, deps),
      ),
      "recuperacion_ausente",
    );

    const deNuevo = await entrarHasta(deps);
    const paso = await leerPaso(deNuevo, deps);
    assert.deepEqual(paso, { paso: "inscribir", nombre: "Ana Pérez", correo: "ana@ejemplo.mx", porRecuperacion: true });
  });
});

const LUEGO = new Date(AHORA.getTime() + 6 * 60 * 1000);
const TOTP_CONFIRMADO = "00000000-0000-4000-8000-0000000000f1";

/** Ana con TOTP confirmado (ya usado en AHORA), códigos de respaldo y una sesión cliente abierta en AHORA. */
function anaConTotp() {
  const repo = memoria();
  repo.totp.push({
    id: TOTP_CONFIRMADO,
    userId: repo.ana.id,
    secretoCifrado: cifrarSemilla(SEMILLA, repo.ana.id, LLAVE),
    confirmado: true,
    ultimoPaso: pasoDe(AHORA),
    revocado: false,
  });
  repo.respaldos.push({ id: "r1", userId: repo.ana.id, hash: hashDeRespaldo("ABCDEFGHJKLMNPQR"), usado: false });
  repo.sesiones.push({ id: "00000000-0000-4000-8000-00000000aa01", userId: repo.ana.id, factor: "totp" });
  return repo;
}

describe("cambiar factores exige confirmar la identidad hace cinco minutos o menos", () => {
  it("con el factor de hace seis minutos ningún cambio pasa y nada cambia ni se avisa", async () => {
    const repo = anaConTotp();
    repo.passkeys.push({
      id: "00000000-0000-4000-8000-0000000000p1",
      userId: repo.ana.id,
      credencialId: CREDENCIAL,
      llavePublica: new Uint8Array(32),
      contador: 0,
      transportes: [],
      nombre: "Laptop",
      respaldada: false,
      creadaEn: AHORA,
      ultimoUsoEn: null,
      revocado: false,
    });
    const deps = base(repo, undefined, LUEGO);
    const vieja = sesionDe(repo, undefined, "ana@ejemplo.mx", { factorEn: AHORA });
    const intentos: Array<[string, Promise<unknown>]> = [
      ["nuevosCodigos", nuevosCodigos(vieja, deps)],
      ["prepararTotpDeSesion", prepararTotpDeSesion(vieja, deps)],
      ["confirmarTotpDeSesion", confirmarTotpDeSesion(vieja, "123456", deps)],
      ["opcionesPasskeyDeSesion", opcionesPasskeyDeSesion(vieja, origen(), deps)],
      ["agregarPasskeyDeSesion", agregarPasskeyDeSesion(vieja, { id: CREDENCIAL }, origen(), "Otra", deps)],
      ["quitarPasskey", quitarPasskey(vieja, repo.passkeys[0]!.id, deps)],
      ["quitarTotp", quitarTotp(vieja, deps)],
    ];
    for (const [nombre, intento] of intentos) {
      assert.equal(await codigoDe(intento), "reautenticacion_requerida", nombre);
    }
    assert.equal(repo.respaldos.length, 1);
    assert.equal(repo.passkeys.filter((p) => !p.revocado).length, 1);
    assert.equal(repo.totp.filter((t) => t.confirmado && !t.revocado).length, 1);
    assert.equal(repo.retos.length, 0);
    assert.deepEqual(repo.avisos, []);
    assert.equal((await estadoDeConfirmacion(vieja, deps)).reciente, false);
  });

  it("confirmar con el código de la app renueva el factor; luego regenerar pasa, se audita y se avisa", async () => {
    const repo = anaConTotp();
    const deps = base(repo, undefined, LUEGO);
    const vieja = sesionDe(repo, undefined, "ana@ejemplo.mx", { factorEn: AHORA });
    // El código ya usado al entrar no sirve para confirmar (no se repite un paso TOTP).
    assert.equal(await codigoDe(confirmarConTotp(vieja, codigoDelPaso(SEMILLA, pasoDe(AHORA)), deps)), "segundo_factor_invalido");
    await confirmarConTotp(vieja, codigoDelPaso(SEMILLA, pasoDe(LUEGO)), deps);
    assert.equal(repo.sesiones[0]?.renovadaCon, "totp");
    assert.equal(repo.sesiones[0]?.fallos, 0);
    assert.equal(repo.eventos.includes("reautenticacion"), true);

    // Lo que la base devuelve después: segundo_factor_en renovado.
    const renovada = sesionDe(repo, undefined, "ana@ejemplo.mx", { factorEn: LUEGO });
    assert.equal((await estadoDeConfirmacion(renovada, deps)).reciente, true);
    const codigos = await nuevosCodigos(renovada, deps);
    assert.equal(codigos.length, 10);
    assert.equal(repo.eventos.includes("respaldo_generado"), true);
    assert.deepEqual(
      repo.avisos.map((a) => [a.cambio, a.para, a.userId]),
      [["respaldo_regenerado", "ana@ejemplo.mx", repo.ana.id]],
    );
  });

  it("confirmar con un código de respaldo lo consume; con passkey usa un reto nuevo", async () => {
    const repo = anaConTotp();
    repo.passkeys.push({
      id: "00000000-0000-4000-8000-0000000000p2",
      userId: repo.ana.id,
      credencialId: CREDENCIAL,
      llavePublica: new Uint8Array(32),
      contador: 0,
      transportes: [],
      nombre: "Laptop",
      respaldada: false,
      creadaEn: AHORA,
      ultimoUsoEn: null,
      revocado: false,
    });
    const deps = base(repo, undefined, LUEGO);
    const vieja = sesionDe(repo, undefined, "ana@ejemplo.mx", { factorEn: AHORA });
    await confirmarConRespaldo(vieja, "ABCD-EFGH-JKLM-NPQR", deps);
    assert.equal(repo.respaldos[0]?.usado, true);
    assert.equal(await codigoDe(confirmarConRespaldo(vieja, "ABCD-EFGH-JKLM-NPQR", deps)), "segundo_factor_invalido");

    assert.equal(await codigoDe(confirmarConPasskey(vieja, { id: CREDENCIAL }, origen(), deps)), "segundo_factor_invalido");
    await opcionesParaConfirmarConPasskey(vieja, origen(), deps);
    await confirmarConPasskey(vieja, { id: CREDENCIAL }, origen(), deps);
    assert.equal(repo.sesiones[0]?.renovadaCon, "passkey");
  });

  it("cinco confirmaciones fallidas cierran la sesión", async () => {
    const repo = anaConTotp();
    const deps = base(repo, undefined, LUEGO);
    const vieja = sesionDe(repo, undefined, "ana@ejemplo.mx", { factorEn: AHORA });
    for (let i = 0; i < 4; i += 1) assert.equal(await codigoDe(confirmarConTotp(vieja, "000000", deps)), "segundo_factor_invalido");
    assert.equal(await codigoDe(confirmarConTotp(vieja, "000000", deps)), "reautenticacion_agotada");
    assert.equal(repo.sesiones.length, 0);
  });

  it("si el aviso por correo falla, el cambio queda hecho igual", async () => {
    const repo = anaConTotp();
    repo.correoCaido = true;
    const deps = base(repo);
    const fresca = sesionDe(repo);
    const codigos = await nuevosCodigos(fresca, deps);
    assert.equal(codigos.length, 10);
    assert.equal(repo.respaldos.filter((r) => !r.usado).length, 10);
    assert.deepEqual(repo.avisos, []);
  });
});

describe("las recuperaciones se resuelven solo desde Operación y con confirmación reciente", () => {
  it("rechaza la sesión cliente del personal y la SOFIPO vieja; aprueba la fresca y avisa a quien pidió", async () => {
    const repo = memoria();
    const deps = base(repo, undefined, LUEGO);
    const token = await entrarHasta(base(repo));
    await prepararTotp(token, base(repo));
    await inscribirTotp(token, codigoDelPaso(SEMILLA, pasoDe(AHORA)), base(repo));
    await pedirRecuperacion(await entrarHasta(base(repo)), "Perdí el teléfono", base(repo));
    const id = repo.recuperaciones[0]!.id;
    const operadorId = "00000000-0000-4000-8000-0000000000bb";
    const desdeCliente = sesionDe(repo, operadorId, "operador@arco.mx", { superficie: "cliente", factorEn: LUEGO });
    const sofipoVieja = sesionDe(repo, operadorId, "operador@arco.mx", { superficie: "sofipo", factorEn: AHORA });
    const sofipoFresca = sesionDe(repo, operadorId, "operador@arco.mx", { superficie: "sofipo", factorEn: LUEGO });
    repo.sesiones.push({ id: sofipoFresca.id, userId: operadorId, factor: "totp" });

    assert.equal(await codigoDe(verRecuperaciones(desdeCliente, deps)), "sin_permiso");
    assert.equal(
      await codigoDe(resolverRecuperacion(desdeCliente, { id, aprobada: true, verificacion: "videollamada" }, deps)),
      "sin_permiso",
    );
    assert.equal(
      await codigoDe(resolverRecuperacion(sofipoVieja, { id, aprobada: true, verificacion: "videollamada" }, deps)),
      "reautenticacion_requerida",
    );
    assert.equal(repo.recuperaciones[0]?.estado, "solicitada");

    assert.equal((await verRecuperaciones(sofipoFresca, deps)).length, 1);
    await resolverRecuperacion(sofipoFresca, { id, aprobada: true, verificacion: "videollamada" }, deps);
    assert.equal(repo.recuperaciones[0]?.estado, "aprobada");
    assert.deepEqual(repo.avisos.map((a) => [a.cambio, a.para]), [["recuperacion_aprobada", "ana@ejemplo.mx"]]);
  });
});

describe("con la recuperación aprobada se inscribe un factor nuevo y los anteriores quedan sin efecto", () => {
  it("la recuperación no adopta la semilla que dejó pendiente otra sesión", async () => {
    const repo = anaConPasskey();
    repo.totp = [];
    const deps = base(repo);
    const atacante = sesionDe(repo);
    const previa = await prepararTotpDeSesion(atacante, deps);
    conRecuperacionAprobada(repo);
    const token = await entrarHasta(deps);
    const nueva = await prepararTotp(token, { ...deps, semilla: () => SEMILLA_NUEVA });
    assert.notEqual(nueva.semilla, previa.semilla, "la semilla del atacante no pertenece a esta recuperación");
    assert.equal(await codigoDe(inscribirTotp(token, codigoDelPaso(SEMILLA, pasoDe(AHORA)), deps)), "segundo_factor_invalido");
    await inscribirTotp(token, codigoDelPaso(SEMILLA_NUEVA, pasoDe(AHORA)), deps);
    assert.equal(repo.recuperaciones[0]?.estado, "cumplida");
  });

  it("Ana pide, otra persona aprueba, Ana inscribe una app nueva: la app, la passkey, los códigos y la sesión viejos dejan de servir", async () => {
    const repo = anaConPasskey();
    const deps = base(repo, undefined, LUEGO);
    await pedirRecuperacion(await entrarHasta(deps), "Perdí el teléfono con la app", deps);
    const operadorId = "00000000-0000-4000-8000-0000000000bb";
    const operador = sesionDe(repo, operadorId, "operador@arco.mx", { superficie: "sofipo", factorEn: LUEGO });
    repo.sesiones.push({ id: operador.id, userId: operadorId, factor: "totp" });
    await resolverRecuperacion(operador, { id: repo.recuperaciones[0]!.id, aprobada: true, verificacion: "videollamada" }, deps);

    const token = await entrarHasta(deps);
    assert.deepEqual(await leerPaso(token, deps), {
      paso: "inscribir",
      nombre: "Ana Pérez",
      correo: "ana@ejemplo.mx",
      porRecuperacion: true,
    });
    const conSemillaNueva = { ...deps, semilla: () => SEMILLA_NUEVA };
    await prepararTotp(token, conSemillaNueva);
    assert.equal(repo.totp.filter((t) => t.userId === repo.ana.id && !t.revocado).length, 2);
    const inscripcion = await inscribirTotp(token, codigoDelPaso(SEMILLA_NUEVA, pasoDe(LUEGO)), conSemillaNueva);
    assert.equal(inscripcion.codigos.length, 10);

    assert.equal(repo.totp.find((t) => t.id === TOTP_CONFIRMADO)?.revocado, true);
    assert.equal(repo.passkeys.every((p) => p.revocado), true);
    assert.equal(repo.respaldos.find((r) => r.id === "r1")?.usado, true);
    assert.deepEqual(
      repo.totp.filter((t) => t.userId === repo.ana.id && !t.revocado).map((t) => t.confirmado),
      [true],
    );
    assert.equal(repo.recuperaciones[0]?.estado, "cumplida");
    assert.deepEqual(
      repo.sesiones.filter((s) => s.userId === repo.ana.id).map((s) => s.factor),
      ["totp"],
      "solo queda la sesión que abrió la inscripción",
    );
    assert.ok(repo.sesiones.some((s) => s.id === operador.id), "la sesión de otra persona sigue");
    assert.ok(repo.eventos.includes("passkey_revocada"));
    assert.ok(repo.eventos.includes("totp_revocado"));
    assert.ok(repo.eventos.includes("sesion_cerrada:00000000-0000-4000-8000-00000000aa01"));
    assert.deepEqual(repo.avisos.at(-1)?.cambio, "factor_reinscrito");

    const conLaVieja = await entrarHasta(deps);
    assert.equal(await codigoDe(entrarConTotp(conLaVieja, codigoDelPaso(SEMILLA, pasoDe(LUEGO)), deps)), "segundo_factor_invalido");
    assert.equal(await codigoDe(entrarConRespaldo(await entrarHasta(deps), "ABCD-EFGH-JKLM-NPQR", deps)), "segundo_factor_invalido");
    assert.equal(
      await codigoDe(entrarConPasskey(await entrarHasta(deps), { id: CREDENCIAL }, origen(), deps)),
      "segundo_factor_invalido",
    );
    assert.deepEqual(await leerPaso(await entrarHasta(deps), deps), {
      paso: "verificar",
      nombre: "Ana Pérez",
      passkey: false,
      totp: true,
      respaldo: true,
      solicitudAbierta: false,
    });
  });

  it("con una passkey nueva también revoca la app y la passkey viejas", async () => {
    const repo = anaConPasskey();
    conRecuperacionAprobada(repo);
    const deps = { ...base(repo), webauthn: webauthnQueRegistra(CREDENCIAL_NUEVA) };
    const token = await entrarHasta(deps);
    await opcionesParaInscribirPasskey(token, origen(), deps);
    await inscribirPasskey(token, { id: CREDENCIAL_NUEVA }, origen(), "Teléfono nuevo", deps);

    assert.deepEqual(
      repo.passkeys.map((p) => [p.credencialId, p.revocado]),
      [
        [CREDENCIAL, true],
        [CREDENCIAL_NUEVA, false],
      ],
    );
    assert.equal(repo.totp.find((t) => t.id === TOTP_CONFIRMADO)?.revocado, true);
    assert.equal(repo.recuperaciones[0]?.estado, "cumplida");
    assert.deepEqual(repo.avisos.at(-1)?.cambio, "factor_reinscrito");
  });

  it("la recuperación vencida ya no deja inscribir: vuelve a pedir el factor de siempre", async () => {
    const repo = anaConTotp();
    conRecuperacionAprobada(repo, new Date(AHORA.getTime() - 1));
    const deps = base(repo);
    const token = await entrarHasta(deps);
    assert.equal((await leerPaso(token, deps)).paso, "verificar");
    assert.equal(await codigoDe(prepararTotp(token, deps)), "ya_tiene_segundo_factor");
    assert.equal(await codigoDe(inscribirTotp(token, codigoDelPaso(SEMILLA, pasoDe(AHORA)), deps)), "ya_tiene_segundo_factor");
    assert.equal(repo.totp.find((t) => t.id === TOTP_CONFIRMADO)?.revocado, false);
    assert.equal(repo.sesiones.length, 1);
  });

  it("si la recuperación vence entre el QR y el código, no se inscribe nada", async () => {
    const repo = anaConTotp();
    conRecuperacionAprobada(repo);
    const deps = { ...base(repo), semilla: () => SEMILLA_NUEVA };
    const token = await entrarHasta(deps);
    await prepararTotp(token, deps);
    repo.recuperaciones[0]!.venceEn = new Date(AHORA.getTime() - 1);
    assert.equal(
      await codigoDe(inscribirTotp(token, codigoDelPaso(SEMILLA_NUEVA, pasoDe(AHORA)), deps)),
      "ya_tiene_segundo_factor",
    );
    assert.equal(repo.totp.find((t) => t.id === TOTP_CONFIRMADO)?.revocado, false);
    assert.equal(repo.totp.filter((t) => t.confirmado).length, 1);
  });

  it("sin recuperación aprobada, quien tiene factores sigue en verificar y no puede inscribir", async () => {
    const repo = anaConTotp();
    const deps = base(repo);
    const token = await entrarHasta(deps);
    assert.equal((await leerPaso(token, deps)).paso, "verificar");
    assert.equal(await codigoDe(prepararTotp(token, deps)), "ya_tiene_segundo_factor");
    await pedirRecuperacion(await entrarHasta(deps), "Perdí el teléfono", deps);
    const conSolicitud = await leerPaso(await entrarHasta(deps), deps);
    assert.equal(conSolicitud.paso, "verificar");
    assert.equal(conSolicitud.paso === "verificar" && conSolicitud.solicitudAbierta, true);
    assert.equal(repo.totp.find((t) => t.id === TOTP_CONFIRMADO)?.revocado, false);
    // Control: el mismo código de respaldo que la recuperación anula sí abre mientras no hay recuperación.
    assert.match(await entrarConRespaldo(await entrarHasta(deps), "ABCD-EFGH-JKLM-NPQR", deps), /sesion=/);
  });

  it("si el aviso por correo falla, el factor nuevo queda inscrito igual", async () => {
    const repo = anaConTotp();
    conRecuperacionAprobada(repo);
    repo.correoCaido = true;
    const deps = { ...base(repo), semilla: () => SEMILLA_NUEVA };
    const token = await entrarHasta(deps);
    await prepararTotp(token, deps);
    const inscripcion = await inscribirTotp(token, codigoDelPaso(SEMILLA_NUEVA, pasoDe(AHORA)), deps);
    assert.equal(inscripcion.codigos.length, 10);
    assert.equal(repo.recuperaciones[0]?.estado, "cumplida");
    assert.deepEqual(repo.avisos, []);
  });
});

describe("los intentos se apartan antes de verificar y cada reto sirve a su propósito", () => {
  it("diez confirmaciones a la vez verifican como mucho cinco y cierran la sesión", async () => {
    const repo = anaConPasskey();
    let verificaciones = 0;
    const deps = { ...base(repo, undefined, LUEGO), webauthn: webauthnQueCuenta(() => (verificaciones += 1)) };
    const vieja = sesionDe(repo, undefined, "ana@ejemplo.mx", { factorEn: AHORA });
    for (let i = 0; i < 10; i += 1) await opcionesParaConfirmarConPasskey(vieja, origen(), deps);
    const codigos = await Promise.all(
      Array.from({ length: 10 }, () => codigoDe(confirmarConPasskey(vieja, { id: CREDENCIAL }, origen(), deps))),
    );
    assert.ok(verificaciones <= 5, `verificó ${verificaciones}`);
    assert.equal(repo.sesiones.length, 0);
    assert.ok(codigos.every((c) => c === "segundo_factor_invalido" || c === "reautenticacion_agotada"), codigos.join());
  });

  it("en la puerta, diez intentos a la vez verifican como mucho cinco y queman la entrada", async () => {
    const repo = anaConPasskey();
    let verificaciones = 0;
    const deps = { ...base(repo), webauthn: webauthnQueCuenta(() => (verificaciones += 1)) };
    const token = await entrarHasta(deps);
    for (let i = 0; i < 10; i += 1) await opcionesParaEntrarConPasskey(token, origen(), deps);
    await Promise.all(Array.from({ length: 10 }, () => codigoDe(entrarConPasskey(token, { id: CREDENCIAL }, origen(), deps))));
    assert.ok(verificaciones <= 5, `verificó ${verificaciones}`);
    assert.equal(repo.entradas[0]?.consumida, true);
    assert.equal(repo.sesiones.filter((s) => s.factor === "passkey").length, 0);
  });

  it("un acierto en la puerta no deja su intento contado", async () => {
    const repo = anaConPasskey();
    const deps = base(repo);
    const token = await entrarHasta(deps);
    await opcionesParaEntrarConPasskey(token, origen(), deps);
    await entrarConPasskey(token, { id: CREDENCIAL }, origen(), deps);
    assert.equal(repo.entradas[0]?.intentos, 0);
  });

  it("los retos que alguien pide en la puerta no tocan la confirmación del titular", async () => {
    const repo = anaConPasskey();
    const emitidos: string[] = [];
    const deps = {
      ...base(repo, undefined, LUEGO),
      webauthn: {
        ...webauthnFalso(),
        async opcionesEntrada() {
          const reto = `reto${String(emitidos.length).padStart(2, "0")}`.padEnd(43, "x");
          emitidos.push(reto);
          return { opciones: { challenge: reto }, reto };
        },
        async verificarEntrada({ reto }: { reto: string }) {
          return reto === emitidos[0] ? { contador: 1 } : null;
        },
      } as AdaptadorWebauthn,
    };
    const vieja = sesionDe(repo, undefined, "ana@ejemplo.mx", { factorEn: AHORA });
    await opcionesParaConfirmarConPasskey(vieja, origen(), deps);
    // Quien sabe la contraseña pide retos de entrada y prueba la puerta.
    const intruso = await entrarHasta(deps);
    for (let i = 0; i < 3; i += 1) await opcionesParaEntrarConPasskey(intruso, origen(), deps);
    assert.equal(await codigoDe(entrarConPasskey(await entrarHasta(deps), { id: CREDENCIAL }, origen(), deps)), "segundo_factor_invalido");
    assert.equal(repo.retos.find((r) => r.reto === emitidos[0])?.usado, false);
    await confirmarConPasskey(vieja, { id: CREDENCIAL }, origen(), deps);
    assert.equal(repo.sesiones.find((s) => s.id === vieja.id)?.renovadaCon, "passkey");
    assert.equal(repo.retos.find((r) => r.reto === emitidos[0])?.sesionId, vieja.id);
  });

  it("si leer a quien pidió falla tras aprobar, la aprobación queda y no da error", async () => {
    const repo = memoria();
    const token = await entrarHasta(base(repo));
    await prepararTotp(token, base(repo));
    await inscribirTotp(token, codigoDelPaso(SEMILLA, pasoDe(AHORA)), base(repo));
    await pedirRecuperacion(await entrarHasta(base(repo)), "Perdí el teléfono", base(repo));
    const operadorId = "00000000-0000-4000-8000-0000000000bb";
    const sofipo = sesionDe(repo, operadorId, "operador@arco.mx", { superficie: "sofipo", factorEn: LUEGO });
    repo.sesiones.push({ id: sofipo.id, userId: operadorId, factor: "totp" });
    const leer = repo.repo.buscarPersona;
    repo.repo.buscarPersona = async (userId) => {
      if (userId === repo.ana.id) throw new Error("conexion_perdida");
      return leer(userId);
    };
    const deps = base(repo, undefined, LUEGO);
    await resolverRecuperacion(sofipo, { id: repo.recuperaciones[0]!.id, aprobada: true, verificacion: "videollamada" }, deps);
    assert.equal(repo.recuperaciones[0]?.estado, "aprobada");
    assert.deepEqual(repo.avisos, []);
  });
});

const SEMILLA_NUEVA = Buffer.from("abcdefghijabcdefghij");
const CREDENCIAL_NUEVA = "credencial-nueva-00002";

/** Recuperación de Ana ya aprobada por otra persona, vigente hasta `venceEn`. */
function conRecuperacionAprobada(repo: Memoria, venceEn = new Date(AHORA.getTime() + 60 * 60 * 1000)) {
  repo.recuperaciones.push({
    id: "00000000-0000-4000-8000-0000000000c1",
    userId: repo.ana.id,
    estado: "aprobada",
    venceEn,
    motivo: "Perdí el teléfono",
  });
}

/** Registra una credencial con el id dado: una passkey nueva no repite el id de la vieja. */
function webauthnQueRegistra(credencialId: string): AdaptadorWebauthn {
  const falso = webauthnFalso();
  return {
    ...falso,
    async verificarRegistro(args) {
      const registro = await falso.verificarRegistro(args);
      return registro ? { ...registro, credencialId } : null;
    },
  };
}

function anaConPasskey() {
  const repo = anaConTotp();
  repo.passkeys.push({
    id: "00000000-0000-4000-8000-0000000000p3",
    userId: repo.ana.id,
    credencialId: CREDENCIAL,
    llavePublica: new Uint8Array(32),
    contador: 0,
    transportes: [],
    nombre: "Laptop",
    respaldada: false,
    creadaEn: AHORA,
    ultimoUsoEn: null,
    revocado: false,
  });
  return repo;
}

/** Cuenta cada verificación de passkey y la rechaza: así se ve cuántas llegaron a verificarse. */
function webauthnQueCuenta(contar: () => void): AdaptadorWebauthn {
  return {
    ...webauthnFalso(),
    async verificarEntrada() {
      contar();
      await new Promise((resolver) => setTimeout(resolver, 1));
      return null;
    },
  };
}

function origen() {
  return { rpID: "localhost", origen: "http://localhost:3000" };
}

describe("el tope de contraseña no revela qué correos tienen cuenta", () => {
  const MALA = "otra-clave-99";
  const RECHAZO = { tipo: "rechazo", codigo: "credenciales_invalidas" };

  async function enElTope(repo: Memoria, deps: ReturnType<typeof base>) {
    for (let i = 0; i < 8; i += 1) await iniciarConContrasena({ correo: "ana@ejemplo.mx", contrasena: MALA }, deps);
    assert.equal(repo.fallos.filter((id) => id === repo.ana.id).length, 8);
  }

  it("cuenta en el tope, contraseña mala y correo inexistente responden exactamente lo mismo", async () => {
    const libre = memoria();
    const malaSinTope = await iniciarConContrasena({ correo: "ana@ejemplo.mx", contrasena: MALA }, base(libre));

    const repo = memoria();
    const deps = base(repo);
    await enElTope(repo, deps);
    const topeConMala = await iniciarConContrasena({ correo: "ana@ejemplo.mx", contrasena: MALA }, deps);
    const topeConCorrecta = await iniciarConContrasena({ correo: "ana@ejemplo.mx", contrasena: CLAVE }, deps);
    const inexistente = await iniciarConContrasena({ correo: "nadie@ejemplo.mx", contrasena: MALA }, deps);
    const inexistenteTrasNueve = await (async () => {
      for (let i = 0; i < 8; i += 1) await iniciarConContrasena({ correo: "nadie@ejemplo.mx", contrasena: MALA }, deps);
      return iniciarConContrasena({ correo: "nadie@ejemplo.mx", contrasena: MALA }, deps);
    })();

    for (const resultado of [malaSinTope, topeConMala, topeConCorrecta, inexistente, inexistenteTrasNueve]) {
      assert.deepEqual(resultado, RECHAZO);
    }
  });

  it("los tres rechazos terminan en el mismo instante aunque su trabajo tarde distinto", async () => {
    const duraciones: Record<string, number> = {};
    for (const caso of ["tope", "mala", "inexistente"] as const) {
      const repo = memoria();
      if (caso === "tope") for (let i = 0; i < 8; i += 1) repo.fallos.push(repo.ana.id);
      let reloj = 0;
      const real = repo.repo;
      // Costos simulados: la escritura del fallo solo ocurre en «mala» e «inexistente»
      // y el conteo de fallos solo con cuenta real.
      const repositorio: RepositorioAutenticacion = {
        ...real,
        buscarUsuarioPorCorreo: async (correo) => {
          reloj += 4;
          return real.buscarUsuarioPorCorreo(correo);
        },
        contarFallosContrasena: async (userId, desde) => {
          reloj += 3;
          return real.contarFallosContrasena(userId, desde);
        },
        registrarContrasenaFallida: async (userId, ahora) => {
          reloj += 25;
          return real.registrarContrasenaFallida(userId, ahora);
        },
      };
      const deps = {
        ...base(repo),
        repositorio,
        verificar: async (plana: string, hash: string) => {
          reloj += 200;
          return hash === `hash:${plana}`;
        },
        ahoraMs: () => reloj,
        esperar: async (ms: number) => {
          reloj += ms;
        },
      };
      const correo = caso === "inexistente" ? "nadie@ejemplo.mx" : "ana@ejemplo.mx";
      assert.deepEqual(await iniciarConContrasena({ correo, contrasena: MALA }, deps), RECHAZO);
      duraciones[caso] = reloj;
    }
    assert.deepEqual(duraciones, { tope: PISO_RECHAZO_MS, mala: PISO_RECHAZO_MS, inexistente: PISO_RECHAZO_MS });
  });

  it("la entrada correcta no espera el piso", async () => {
    const repo = memoria();
    const esperas: number[] = [];
    const deps = { ...base(repo), esperar: async (ms: number) => void esperas.push(ms) };
    assert.equal((await iniciarConContrasena({ correo: "ana@ejemplo.mx", contrasena: CLAVE }, deps)).tipo, "entrada");
    assert.deepEqual(esperas, []);
  });

  it("el correo mal escrito y el error de la base también esperan el piso completo", async () => {
    const repo = memoria();
    const esperas: number[] = [];
    const reloj = { ahoraMs: () => 0, esperar: async (ms: number) => void esperas.push(ms) };
    assert.deepEqual(
      await iniciarConContrasena({ correo: "no-es-correo", contrasena: CLAVE }, { ...base(repo), ...reloj }),
      RECHAZO,
    );
    const caida: RepositorioAutenticacion = {
      ...repo.repo,
      buscarUsuarioPorCorreo: async () => {
        throw new ErrorDeDominio("base_no_disponible");
      },
    };
    await assert.rejects(
      iniciarConContrasena({ correo: "ana@ejemplo.mx", contrasena: CLAVE }, { ...base(repo), ...reloj, repositorio: caida }),
      (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "base_no_disponible",
    );
    assert.deepEqual(esperas, [PISO_RECHAZO_MS, PISO_RECHAZO_MS]);
  });
});

async function entrarHasta(deps: ReturnType<typeof base>): Promise<string> {
  const inicio = await iniciarConContrasena({ correo: "ana@ejemplo.mx", contrasena: CLAVE }, deps);
  if (inicio.tipo !== "entrada") throw new Error(inicio.codigo);
  return inicio.cookie.valor;
}

function sesionDe(
  repo: Memoria,
  userId?: string,
  correo = "ana@ejemplo.mx",
  opciones: { superficie?: "cliente" | "sofipo"; factorEn?: Date } = {},
): Sesion {
  const segundoFactor = { metodo: "totp" as const, en: opciones.factorEn ?? AHORA };
  const superficie = opciones.superficie ?? "cliente";
  if (userId) {
    return {
      id: `11111111-1111-4111-8111-${userId.slice(-12)}`,
      venceEn: AHORA,
      usuario: { id: userId, nombre: "Operador", correo },
      superficie,
      segundoFactor,
    };
  }
  const guardada = repo.sesiones[repo.sesiones.length - 1];
  if (!guardada) throw new Error("sin sesión en la prueba");
  return {
    id: guardada.id,
    venceEn: AHORA,
    usuario: { id: guardada.userId, nombre: "Ana Pérez", correo },
    superficie,
    segundoFactor,
  };
}

function base(repo: Memoria, verificar?: (plana: string, hash: string) => Promise<boolean>, ahora: Date = AHORA) {
  let n = 0;
  let t = 0;
  return {
    repositorio: repo.repo,
    ahora: () => ahora,
    avisar: async (aviso: AvisoDeSeguridad) => {
      if (repo.correoCaido) throw new ErrorDeDominio("correo_no_disponible");
      repo.avisos.push(aviso);
    },
    token: () => {
      t += 1;
      return (`t${String(t).padStart(2, "0")}` + "b".repeat(43)).slice(0, 43);
    },
    ids: () => {
      n += 1;
      return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    },
    hashear: async (contrasena: string) => `hash:${contrasena}`,
    verificar: verificar ?? (async (plana: string, hash: string) => hash === `hash:${plana}`),
    webauthn: webauthnFalso(),
    llaveTotp: LLAVE,
    operadores: new Set(["operador@arco.mx"]),
    semilla: () => SEMILLA,
    // El piso de rechazo se prueba aparte, con su propio reloj.
    esperar: async () => {},
  };
}

function webauthnFalso(): AdaptadorWebauthn {
  return {
    async opcionesRegistro() {
      return { opciones: { challenge: RETO }, reto: RETO };
    },
    async verificarRegistro({ reto }) {
      if (reto !== RETO) return null;
      return {
        credencialId: CREDENCIAL,
        llavePublica: new Uint8Array(32).fill(3),
        contador: 0,
        transportes: ["internal"],
        respaldada: false,
      };
    },
    async opcionesEntrada() {
      return { opciones: { challenge: RETO }, reto: RETO };
    },
    async verificarEntrada({ reto, passkey }) {
      if (reto !== RETO || passkey.credencialId !== CREDENCIAL) return null;
      return { contador: passkey.contador + 1 };
    },
  };
}

type EntradaMem = { id: string; userId: string; tokenHash: string; venceEn: Date; intentos: number; consumida: boolean };
type RespaldoMem = { id: string; userId: string; hash: string; usado: boolean };
type RecuperacionMem = { id: string; userId: string; estado: string; venceEn: Date | null; motivo: string };

class Memoria {
  ana: UsuarioAuth = {
    id: "00000000-0000-4000-8000-0000000000aa",
    nombre: "Ana Pérez",
    correo: "ana@ejemplo.mx",
    passwordHash: `hash:${CLAVE}`,
  };
  entradas: EntradaMem[] = [];
  /** Persona de cada contraseña fallida; null cuando el correo no tiene cuenta. */
  fallos: (string | null)[] = [];
  passkeys: (PasskeyGuardada & { revocado: boolean })[] = [];
  totp: (TotpGuardado & { revocado: boolean; ceremonia?: CeremoniaTotp; venceEn?: Date })[] = [];
  respaldos: RespaldoMem[] = [];
  retos: { userId: string; proposito: string; reto: string; usado: boolean; sesionId: string | null }[] = [];
  sesiones: { id: string; userId: string; factor: string; fallos?: number; renovadaCon?: string }[] = [];
  recuperaciones: RecuperacionMem[] = [];
  eventos: string[] = [];
  avisos: AvisoDeSeguridad[] = [];
  correoCaido = false;
  repo: RepositorioAutenticacion;

  constructor() {
    this.repo = {
      buscarUsuarioPorCorreo: async (correo) => {
        return correo === this.ana.correo ? this.ana : null;
      },
      buscarPersona: async (userId) => {
        if (userId === this.ana.id) return { id: this.ana.id, nombre: this.ana.nombre, correo: this.ana.correo };
        if (userId === "00000000-0000-4000-8000-0000000000bb") {
          return { id: userId, nombre: "Operador", correo: "operador@arco.mx" };
        }
        return null;
      },
      crearEntrada: async (entrada) => {
        this.entradas.push({ ...entrada, intentos: 0, consumida: false });
        this.eventos.push("entrada_contrasena");
      },
      registrarContrasenaFallida: async (userId) => {
        this.fallos.push(userId);
        this.eventos.push("entrada_fallida");
      },
      leerEntrada: async (tokenHash) => {
        const entrada = this.entradas.find((e) => e.tokenHash === tokenHash && !e.consumida && e.intentos < 5);
        return entrada
          ? { id: entrada.id, userId: entrada.userId, venceEn: entrada.venceEn, intentosFallidos: entrada.intentos }
          : null;
      },
      contarFallosContrasena: async (userId) => {
        return this.fallos.filter((id) => id === userId).length;
      },
      apartarIntentoDeEntrada: async (entradaId) => {
        const entrada = this.entradas.find((e) => e.id === entradaId && !e.consumida && e.intentos < 5);
        if (!entrada) return null;
        entrada.intentos += 1;
        return entrada.intentos;
      },
      registrarFalloDeEntrada: async ({ entradaId, intentos }) => {
        const entrada = this.entradas.find((e) => e.id === entradaId);
        if (entrada && intentos >= 5) entrada.consumida = true;
        this.eventos.push("segundo_factor_fallido");
      },
      factores: async (userId) => {
        return this.estado(userId);
      },
      recuperacionAbierta: async (userId) => {
        const abierta = this.recuperaciones.find((r) => r.userId === userId && (r.estado === "solicitada" || r.estado === "aprobada"));
        if (!abierta) return null;
        return { id: abierta.id, estado: abierta.estado as "solicitada" | "aprobada", venceEn: abierta.venceEn };
      },
      guardarReto: async (reto) => {
        this.retos.push({
          userId: reto.userId,
          proposito: reto.proposito,
          reto: reto.reto,
          usado: false,
          sesionId: reto.sesionId ?? null,
        });
      },
      tomarReto: async (userId, proposito, _ahora, sesionId = null) => {
        const reto = [...this.retos]
          .reverse()
          .find((r) => r.userId === userId && r.proposito === proposito && r.sesionId === sesionId && !r.usado);
        if (!reto) return null;
        reto.usado = true;
        return reto.reto;
      },
      completarEntrada: async ({ entradaId, userId, metodo, sesion, efecto }) => {
        this.aplicar(userId, efecto, entradaId);
        const entrada = this.entradas.find((e) => e.id === entradaId && !e.consumida && e.intentos >= 1);
        if (!entrada) throw new ErrorDeDominio("entrada_vencida");
        entrada.consumida = true;
        // El intento apartado acertó: se devuelve al consumir, como en la base.
        entrada.intentos -= 1;
        this.sesiones = this.sesiones.filter((s) => s.userId !== userId);
        this.sesiones.push({ id: sesion.id, userId, factor: metodo });
        this.eventos.push("entrada_completa");
      },
      leerTotpPendiente: async (userId, ceremonia, ahora) => {
        return this.pendiente(userId, ceremonia, ahora);
      },
      guardarTotpPendiente: async ({ id, userId, secretoCifrado, creadoEn, venceEn, ceremonia }) => {
        this.totp = this.totp.filter((t) => t.userId !== userId || t.confirmado || t.revocado ||
          (t.venceEn && t.venceEn > creadoEn && (!("entradaId" in ceremonia) || !ceremonia.recuperacionId ||
            (t.ceremonia && "entradaId" in t.ceremonia && t.ceremonia.recuperacionId === ceremonia.recuperacionId))));
        const existente = this.pendiente(userId, ceremonia, creadoEn);
        if (existente) return existente;
        const nueva = { id, userId, secretoCifrado, confirmado: false, ultimoPaso: null, revocado: false, ceremonia, venceEn };
        this.totp.push(nueva);
        return nueva;
      },
      confirmarTotp: async ({ userId, totpId, paso, ahora, ceremonia }) => {
        const totp = this.pendiente(userId, ceremonia, ahora);
        if (!totp || totp.id !== totpId) throw new ErrorDeDominio("segundo_factor_invalido");
        totp.confirmado = true;
        totp.ultimoPaso = paso;
      },
      agregarPasskey: async ({ userId, passkey }) => {
        this.agregarPasskey(userId, passkey);
      },
      revocarPasskey: async ({ userId, passkeyId }) => {
        const passkey = this.passkeys.find((p) => p.id === passkeyId && p.userId === userId && !p.revocado);
        if (!passkey) throw new ErrorDeDominio("passkey_ausente");
        if (this.vigentes(userId) <= 1) throw new ErrorDeDominio("ultimo_factor");
        passkey.revocado = true;
      },
      revocarTotp: async (args) => {
        const vigente = this.totp.find((t) => t.userId === args.userId && t.confirmado && !t.revocado);
        if (!vigente) throw new ErrorDeDominio("totp_ausente");
        if (this.vigentes(args.userId) <= 1) throw new ErrorDeDominio("ultimo_factor");
        vigente.revocado = true;
      },
      regenerarRespaldo: async ({ userId, codigosHash }) => {
        for (const respaldo of this.respaldos) if (respaldo.userId === userId) respaldo.usado = true;
        for (const hash of codigosHash) this.respaldos.push({ id: hash.slice(0, 8), userId, hash, usado: false });
        this.eventos.push("respaldo_generado");
      },
      reautenticar: async ({ sesionId, userId, metodo, efecto }) => {
        this.aplicar(userId, efecto);
        const sesion = this.sesiones.find((s) => s.id === sesionId && s.userId === userId);
        if (!sesion) throw new ErrorDeDominio("sesion_ausente");
        sesion.renovadaCon = metodo;
        sesion.fallos = 0;
        this.eventos.push("reautenticacion");
      },
      apartarIntentoDeReautenticacion: async ({ sesionId, userId }) => {
        const sesion = this.sesiones.find((s) => s.id === sesionId && s.userId === userId);
        if (!sesion || (sesion.fallos ?? 0) >= 5) {
          this.sesiones = this.sesiones.filter((s) => s !== sesion);
          return null;
        }
        sesion.fallos = (sesion.fallos ?? 0) + 1;
        return sesion.fallos;
      },
      registrarFalloDeReautenticacion: async ({ sesionId, userId, intentos }) => {
        if (intentos >= 5) this.sesiones = this.sesiones.filter((s) => !(s.id === sesionId && s.userId === userId));
        this.eventos.push("reautenticacion_fallida");
      },
      solicitarRecuperacion: async ({ id, userId, motivo, entradaId }) => {
        const entrada = this.entradas.find((e) => e.id === entradaId && !e.consumida);
        if (!entrada) throw new ErrorDeDominio("entrada_vencida");
        entrada.consumida = true;
        const abierta = this.recuperaciones.find((r) => r.userId === userId && (r.estado === "solicitada" || r.estado === "aprobada"));
        if (abierta) throw new ErrorDeDominio("recuperacion_abierta");
        this.recuperaciones.push({ id, userId, estado: "solicitada", venceEn: null, motivo });
      },
      recuperacionesPendientes: async () => {
        return this.recuperaciones
          .filter((r) => r.estado === "solicitada")
          .map((r) => ({ id: r.id, nombre: this.ana.nombre, correo: this.ana.correo, motivo: r.motivo, solicitadaEn: AHORA }));
      },
      aprobarRecuperacion: async ({ id, aprobadorId, venceEn }) => {
        const solicitud = this.recuperaciones.find((r) => r.id === id && r.estado === "solicitada");
        if (!solicitud) throw new ErrorDeDominio("recuperacion_ausente");
        if (solicitud.userId === aprobadorId) throw new ErrorDeDominio("misma_persona_en_recuperacion");
        solicitud.estado = "aprobada";
        solicitud.venceEn = venceEn;
        return { userId: solicitud.userId };
      },
      rechazarRecuperacion: async ({ id }) => {
        const solicitud = this.recuperaciones.find((r) => r.id === id && r.estado === "solicitada");
        if (!solicitud) throw new ErrorDeDominio("recuperacion_ausente");
        solicitud.estado = "rechazada";
      },
      esPersonal: async () => false,
      segundoFactorDeSesion: async (sessionId) => {
        const sesion = this.sesiones.find((s) => s.id === sessionId);
        return sesion?.factor === "passkey" || sesion?.factor === "totp" || sesion?.factor === "respaldo" ? sesion.factor : null;
      },
    };
  }

  estado(userId: string): EstadoFactores {
    const passkeys = this.passkeys.filter((p) => p.userId === userId && !p.revocado);
    const vivas = this.totp.filter((t) => t.userId === userId && !t.revocado);
    return {
      passkeys,
      totp: vivas.find((t) => t.confirmado) ?? null,
      respaldoRestantes: this.respaldos.filter((r) => r.userId === userId && !r.usado).length,
      tuvoFactores: this.passkeys.some((p) => p.userId === userId) || this.totp.some((t) => t.userId === userId && t.confirmado),
    };
  }

  pendiente(userId: string, ceremonia: CeremoniaTotp, ahora: Date) {
    return this.totp.find((t) => t.userId === userId && !t.confirmado && !t.revocado && t.venceEn && t.venceEn > ahora
      && JSON.stringify(t.ceremonia) === JSON.stringify(ceremonia)) as (TotpGuardado & { venceEn: Date }) | undefined ?? null;
  }

  vigentes(userId: string): number {
    const estado = this.estado(userId);
    return estado.passkeys.length + (estado.totp?.confirmado ? 1 : 0);
  }

  aplicar(userId: string, efecto: Efecto, entradaId?: string): void {
    if (efecto.tipo === "totp") {
      const totp = this.totp.find((t) => t.id === efecto.totpId && t.confirmado && !t.revocado);
      if (!totp || (totp.ultimoPaso !== null && efecto.paso <= totp.ultimoPaso)) {
        throw new ErrorDeDominio("segundo_factor_invalido");
      }
      totp.ultimoPaso = efecto.paso;
      return;
    }
    if (efecto.tipo === "passkey") {
      const passkey = this.passkeys.find((p) => p.id === efecto.passkeyId && !p.revocado);
      if (!passkey) throw new ErrorDeDominio("segundo_factor_invalido");
      passkey.contador = Math.max(passkey.contador, efecto.contador);
      return;
    }
    if (efecto.tipo === "respaldo") {
      const respaldo = this.respaldos.find((r) => r.userId === userId && r.hash === efecto.codigoHash && !r.usado);
      if (!respaldo) throw new ErrorDeDominio("segundo_factor_invalido");
      respaldo.usado = true;
      return;
    }
    if (efecto.tipo === "inscribir_totp") {
      this.retirarAnteriores(userId, efecto.recuperacionId);
      const totp = entradaId ? this.pendiente(userId, { entradaId, recuperacionId: efecto.recuperacionId }, AHORA) : null;
      if (totp?.id !== efecto.totpId) throw new ErrorDeDominio("segundo_factor_invalido");
      if (!totp) throw new ErrorDeDominio("segundo_factor_invalido");
      totp.confirmado = true;
      totp.ultimoPaso = efecto.paso;
      this.guardarRespaldo(userId, efecto.codigosHash);
      this.cumplir(userId, efecto.recuperacionId);
      return;
    }
    this.retirarAnteriores(userId, efecto.recuperacionId);
    this.totp = this.totp.filter((t) => t.confirmado || t.revocado || t.userId !== userId);
    this.agregarPasskey(userId, efecto.passkey);
    this.guardarRespaldo(userId, efecto.codigosHash);
    this.cumplir(userId, efecto.recuperacionId);
  }

  /** Como la base: sin recuperación exige no tener factores; con ella revoca los viejos y cierra las sesiones. */
  retirarAnteriores(userId: string, recuperacionId: string | null): void {
    if (!recuperacionId) {
      if (this.vigentes(userId) > 0) throw new ErrorDeDominio("ya_tiene_segundo_factor");
      return;
    }
    for (const passkey of this.passkeys) {
      if (passkey.userId === userId && !passkey.revocado) {
        passkey.revocado = true;
        this.eventos.push("passkey_revocada");
      }
    }
    for (const app of this.totp) {
      if (app.userId === userId && app.confirmado && !app.revocado) {
        app.revocado = true;
        this.eventos.push("totp_revocado");
      }
    }
    for (const sesion of this.sesiones.filter((s) => s.userId === userId)) this.eventos.push(`sesion_cerrada:${sesion.id}`);
    this.sesiones = this.sesiones.filter((s) => s.userId !== userId);
  }

  agregarPasskey(userId: string, passkey: NuevaPasskey): void {
    this.passkeys.push({
      id: passkey.id,
      userId,
      credencialId: passkey.credencialId,
      llavePublica: passkey.llavePublica,
      contador: passkey.contador,
      transportes: passkey.transportes,
      nombre: passkey.nombre,
      respaldada: passkey.respaldada,
      creadaEn: AHORA,
      ultimoUsoEn: null,
      revocado: false,
    });
  }

  guardarRespaldo(userId: string, hashes: string[]): void {
    for (const respaldo of this.respaldos) if (respaldo.userId === userId && !respaldo.usado) respaldo.usado = true;
    for (const hash of hashes) this.respaldos.push({ id: hash.slice(0, 8), userId, hash, usado: false });
  }

  cumplir(userId: string, recuperacionId: string | null): void {
    if (!recuperacionId) return;
    const solicitud = this.recuperaciones.find((r) => r.id === recuperacionId && r.userId === userId && r.estado === "aprobada");
    if (!solicitud || !solicitud.venceEn || solicitud.venceEn.getTime() <= AHORA.getTime()) {
      throw new ErrorDeDominio("recuperacion_vencida");
    }
    solicitud.estado = "cumplida";
  }
}

function memoria(): Memoria {
  return new Memoria();
}

async function codigoDe(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
  } catch (error) {
    if (error instanceof ErrorDeDominio) return error.codigo;
    throw error;
  }
  return "ok";
}
