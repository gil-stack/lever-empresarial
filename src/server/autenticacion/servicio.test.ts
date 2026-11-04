import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NOMBRE_COOKIE } from "../session/cookie";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import type { Sesion } from "../session/tipos";
import { aBase32, codigoDelPaso, pasoDe } from "./totp";
import { hashDeRespaldo } from "./respaldo";
import {
  entrarConPasskey,
  entrarConRespaldo,
  entrarConTotp,
  iniciarConContrasena,
  inscribirPasskey,
  inscribirTotp,
  leerPaso,
  opcionesParaEntrarConPasskey,
  opcionesParaInscribirPasskey,
  pedirRecuperacion,
  prepararTotp,
  quitarPasskey,
  resolverRecuperacion,
  verFactores,
} from "./servicio";
import type {
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
    assert.deepEqual(bloqueada, { tipo: "rechazo", codigo: "entrada_bloqueada" });
    assert.equal(repo.entradas.length, 0);
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
        resolverRecuperacion(sesion, { id: repo.recuperaciones[0]!.id, aprobada: true, verificacion: "presencial" }, deps),
      ),
      "misma_persona_en_recuperacion",
    );
    const operador = sesionDe(repo, "00000000-0000-4000-8000-0000000000bb", "operador@arco.mx");
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
    assert.equal(paso.paso, "verificar");
  });
});

function origen() {
  return { rpID: "localhost", origen: "http://localhost:3000" };
}

async function entrarHasta(deps: ReturnType<typeof base>): Promise<string> {
  const inicio = await iniciarConContrasena({ correo: "ana@ejemplo.mx", contrasena: CLAVE }, deps);
  if (inicio.tipo !== "entrada") throw new Error(inicio.codigo);
  return inicio.cookie.valor;
}

function sesionDe(repo: Memoria, userId?: string, correo = "ana@ejemplo.mx"): Sesion {
  if (userId) {
    return {
      id: `11111111-1111-4111-8111-${userId.slice(-12)}`,
      venceEn: AHORA,
      usuario: { id: userId, nombre: "Operador", correo },
      companyId: null,
      rol: null,
    };
  }
  const guardada = repo.sesiones[repo.sesiones.length - 1];
  if (!guardada) throw new Error("sin sesión en la prueba");
  return {
    id: guardada.id,
    venceEn: AHORA,
    usuario: { id: guardada.userId, nombre: "Ana Pérez", correo },
    companyId: null,
    rol: null,
  };
}

function base(repo: Memoria, verificar?: (plana: string, hash: string) => Promise<boolean>) {
  let n = 0;
  let t = 0;
  return {
    repositorio: repo.repo,
    ahora: () => AHORA,
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
  fallos: Date[] = [];
  passkeys: (PasskeyGuardada & { revocado: boolean })[] = [];
  totp: (TotpGuardado & { revocado: boolean })[] = [];
  respaldos: RespaldoMem[] = [];
  retos: { userId: string; proposito: string; reto: string; usado: boolean }[] = [];
  sesiones: { id: string; userId: string; factor: string }[] = [];
  recuperaciones: RecuperacionMem[] = [];
  eventos: string[] = [];
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
      registrarContrasenaFallida: async () => {
        this.fallos.push(AHORA);
        this.eventos.push("entrada_fallida");
      },
      leerEntrada: async (tokenHash) => {
        const entrada = this.entradas.find((e) => e.tokenHash === tokenHash && !e.consumida && e.intentos < 5);
        return entrada
          ? { id: entrada.id, userId: entrada.userId, venceEn: entrada.venceEn, intentosFallidos: entrada.intentos }
          : null;
      },
      contarFallosContrasena: async () => {
        return this.fallos.length;
      },
      sumarFallo: async (entradaId) => {
        const entrada = this.entradas.find((e) => e.id === entradaId && !e.consumida);
        if (!entrada) throw new ErrorDeDominio("entrada_vencida");
        entrada.intentos += 1;
        if (entrada.intentos >= 5) entrada.consumida = true;
        return entrada.intentos;
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
        this.retos.push({ userId: reto.userId, proposito: reto.proposito, reto: reto.reto, usado: false });
      },
      tomarReto: async (userId, proposito) => {
        const reto = [...this.retos].reverse().find((r) => r.userId === userId && r.proposito === proposito && !r.usado);
        if (!reto) return null;
        reto.usado = true;
        return reto.reto;
      },
      completarEntrada: async ({ entradaId, userId, metodo, sesion, efecto }) => {
        this.aplicar(userId, efecto);
        const entrada = this.entradas.find((e) => e.id === entradaId && !e.consumida);
        if (!entrada) throw new ErrorDeDominio("entrada_vencida");
        entrada.consumida = true;
        this.sesiones = this.sesiones.filter((s) => s.userId !== userId);
        this.sesiones.push({ id: sesion.id, userId, factor: metodo });
        this.eventos.push("entrada_completa");
      },
      guardarTotpPendiente: async ({ id, userId, secretoCifrado }) => {
        this.totp = this.totp.filter((t) => t.confirmado || t.revocado);
        this.totp.push({ id, userId, secretoCifrado, confirmado: false, ultimoPaso: null, revocado: false });
      },
      confirmarTotp: async () => {
        throw new ErrorDeDominio("segundo_factor_invalido");
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
    const totp = this.totp.find((t) => t.userId === userId && !t.revocado) ?? null;
    return {
      passkeys,
      totp,
      respaldoRestantes: this.respaldos.filter((r) => r.userId === userId && !r.usado).length,
      tuvoFactores: this.passkeys.some((p) => p.userId === userId) || this.totp.some((t) => t.userId === userId && t.confirmado),
    };
  }

  vigentes(userId: string): number {
    const estado = this.estado(userId);
    return estado.passkeys.length + (estado.totp?.confirmado ? 1 : 0);
  }

  aplicar(userId: string, efecto: Efecto): void {
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
      if (this.vigentes(userId) > 0) throw new ErrorDeDominio("ya_tiene_segundo_factor");
      const totp = this.totp.find((t) => t.id === efecto.totpId && !t.confirmado);
      if (!totp) throw new ErrorDeDominio("segundo_factor_invalido");
      totp.confirmado = true;
      totp.ultimoPaso = efecto.paso;
      this.guardarRespaldo(userId, efecto.codigosHash);
      this.cumplir(userId, efecto.recuperacionId);
      return;
    }
    if (this.vigentes(userId) > 0) throw new ErrorDeDominio("ya_tiene_segundo_factor");
    this.totp = this.totp.filter((t) => t.confirmado || t.userId !== userId);
    this.agregarPasskey(userId, efecto.passkey);
    this.guardarRespaldo(userId, efecto.codigosHash);
    this.cumplir(userId, efecto.recuperacionId);
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
