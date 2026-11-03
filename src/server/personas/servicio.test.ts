import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { ErrorDeDominio } from "../session/error-de-dominio.ts";
import type { Rol, Sesion } from "../session/tipos.ts";
import { negarLiberacion } from "./liberar.ts";
import { SQL } from "./repositorio.ts";
import { darDeAltaPersona, leerMaestro, nombrarCentro, registrarBaja, resumenParaConsola } from "./servicio.ts";
import type {
  ContextoMaestro,
  EmpleadoNuevo,
  LecturaMaestro,
  RepositorioPersonas,
  UsuarioDeCorreo,
} from "./tipos.ts";

const HOY = new Date("2026-11-03T18:00:00.000Z");
const CLABE = "002180701150123452";
const PASSWORD = "una frase larga";

describe("el maestro no dispersa y no abre con una sola firma", () => {
  it("rechaza la CLABE mala antes de escribir y no guarda la contraseña en la auditoría", async () => {
    const mundo = memoria();
    const admin = mundo.sembrar({ rol: "administrador", nombre: "Ada Admin" });
    const centro = await nombrarCentro(sesion(admin, "administrador"), { nombre: "Nómina" }, mundo.deps);
    assert.equal(mundo.auditoria.some((evento) => evento.accion === "alta_centro_costo"), true);

    await assert.rejects(
      () =>
        darDeAltaPersona(
          sesion(admin, "administrador"),
          alta({ centroId: centro.id, clabe: "002180701150123453", acceso: "no" }),
          mundo.deps,
        ),
      (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "clabe_invalida",
    );
    assert.equal(mundo.personas.length, 0);

    const creada = await darDeAltaPersona(
      sesion(admin, "administrador"),
      alta({
        centroId: centro.id,
        clabe: "002 180 70115012345 2",
        acceso: "nueva",
        correo: "Liberador@Ejemplo.MX",
        contrasena: PASSWORD,
        rol: "liberador",
        nombre: "Luis Soto",
      }),
      mundo.deps,
    );
    assert.equal(JSON.stringify(creada).includes(PASSWORD), false);
    assert.equal(JSON.stringify(creada).includes(CLABE), false);
    const persona = mundo.personas.find((fila) => fila.id === creada.id);
    assert.equal(persona?.clabe, CLABE);
    assert.equal(persona?.companyId, mundo.companyId);
    const usuario = mundo.usuarios.find((fila) => fila.correo === "liberador@ejemplo.mx");
    assert.ok(usuario);
    assert.equal(usuario?.passwordHash, `hash:${PASSWORD}`);
    assert.equal(usuario?.passwordHash.includes(PASSWORD) && usuario.passwordHash === PASSWORD, false);
    const evento = mundo.auditoria.find((fila) => fila.accion === "alta_persona");
    const texto = JSON.stringify(evento);
    assert.equal(texto.includes(PASSWORD), false);
    assert.equal(texto.includes(CLABE), false);
    assert.equal(texto.includes("hash:"), false);
    assert.equal(mundo.dispersiones, 0);
  });

  it("aísla jefe y centro: la otra empresa no se ve y el contador no da de alta", async () => {
    const mundo = memoria();
    const admin = mundo.sembrar({ rol: "administrador", nombre: "Ada Admin" });
    const otra = randomUUID();
    mundo.centros.push({ id: otra, companyId: randomUUID(), nombre: "Ajeno" });
    const jefeAjeno = randomUUID();
    mundo.personas.push(persona(jefeAjeno, randomUUID(), randomUUID(), "Ajena"));
    const centro = await nombrarCentro(sesion(admin, "administrador"), { nombre: "Obra" }, mundo.deps);

    await assert.rejects(
      () =>
        darDeAltaPersona(
          sesion(admin, "administrador"),
          alta({ centroId: otra, acceso: "no" }),
          mundo.deps,
        ),
      (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "centro_invalido",
    );
    await assert.rejects(
      () =>
        darDeAltaPersona(
          sesion(admin, "administrador"),
          alta({ centroId: centro.id, jefeId: jefeAjeno, acceso: "no" }),
          mundo.deps,
        ),
      (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "jefe_invalido",
    );

    const contador = mundo.sembrar({ rol: "contador", nombre: "Cora Conta" });
    let lecturas = 0;
    const original = mundo.deps.repositorio.leer;
    mundo.deps.repositorio.leer = async (...args) => {
      lecturas += 1;
      return original(...args);
    };
    const lectura = await leerMaestro(sesion(contador, "contador"), mundo.deps);
    assert.equal(lectura.rol, "contador");
    assert.equal(lecturas > 0, true);

    const tarjeta = mundo.sembrar({ rol: "tarjetahabiente", nombre: "Tere" });
    lecturas = 0;
    await assert.rejects(
      () => leerMaestro(sesion(tarjeta, "tarjetahabiente"), mundo.deps),
      (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "maestro_no_disponible",
    );
    assert.equal(lecturas, 0);
    await assert.rejects(
      () =>
        darDeAltaPersona(sesion(contador, "contador"), alta({ centroId: centro.id, acceso: "no" }), mundo.deps),
      (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "sin_permiso",
    );
  });

  it("no queda operable con un liberador, el contador no libera y dos firmas tampoco dispersan", async () => {
    const mundo = memoria();
    const admin = mundo.sembrar({ rol: "administrador", nombre: "Ada Admin" });
    const centro = await nombrarCentro(sesion(admin, "administrador"), { nombre: "Nómina" }, mundo.deps);
    const contadorUser = mundo.sembrar({ rol: "contador", nombre: "Cora Conta" });
    let hechos = 0;
    const original = mundo.deps.repositorio.hechosLiberacion;
    mundo.deps.repositorio.hechosLiberacion = async (...args) => {
      hechos += 1;
      return original(...args);
    };
    await assert.rejects(
      () => negarLiberacion(sesion(contadorUser, "contador"), null, mundo.deps),
      (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "sin_accion_de_liberar",
    );
    assert.equal(hechos, 0);

    const primero = await darDeAltaPersona(
      sesion(admin, "administrador"),
      alta({ centroId: centro.id, nombre: "Luis Soto", acceso: "nueva", correo: "luis@ejemplo.mx", rol: "liberador" }),
      mundo.deps,
    );
    const luis = mundo.personas.find((fila) => fila.id === primero.id)?.userId;
    assert.ok(luis);
    await assert.rejects(
      () => negarLiberacion(sesion(luis, "liberador"), null, mundo.deps),
      (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "empresa_no_operable",
    );

    const segundo = await darDeAltaPersona(
      sesion(admin, "administrador"),
      alta({
        centroId: centro.id,
        nombre: "María Ríos",
        jefeId: primero.id,
        acceso: "nueva",
        correo: "maria@ejemplo.mx",
        rol: "liberador",
      }),
      mundo.deps,
    );
    const maria = mundo.personas.find((fila) => fila.id === segundo.id)?.userId;
    assert.ok(maria);
    await assert.rejects(
      () => negarLiberacion(sesion(luis, "liberador"), maria, mundo.deps),
      (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "sin_dispersion",
    );
    await assert.rejects(
      () => negarLiberacion(sesion(luis, "liberador"), luis, mundo.deps),
      (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "misma_firma",
    );
    assert.equal(mundo.dispersiones, 0);

    await registrarBaja(sesion(admin, "administrador"), { personaId: segundo.id, baja: "2026-11-03" }, mundo.deps);
    await assert.rejects(
      () => negarLiberacion(sesion(luis, "liberador"), maria, mundo.deps),
      (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "empresa_no_operable",
    );
    const maestro = await leerMaestro(sesion(admin, "administrador"), mundo.deps);
    const deBaja = maestro.personas.find((fila) => fila.id === segundo.id);
    assert.equal(deBaja?.bajaEn, "2026-11-03");
    assert.equal(deBaja?.clabe, CLABE);
    assert.equal(maestro.autorizados.length, 1);
    const resumen = await resumenParaConsola(sesion(admin, "administrador"), mundo.deps);
    assert.deepEqual(resumen?.nombres, ["Luis Soto"]);
    assert.equal(JSON.stringify(resumen).includes(CLABE), false);
  });
});

describe("contrato del libro", () => {
  it("filtra por la empresa de la sesión y no selecciona el hash ni la CLABE para liberar", () => {
    assert.match(SQL.bloquearEmpresa, /for update of c/i);
    assert.match(SQL.personas, /e\.company_id = \$1/);
    assert.match(SQL.personas, /e\.clabe/);
    assert.doesNotMatch(SQL.personas, /password_hash/);
    assert.doesNotMatch(SQL.hechos, /clabe/);
    assert.doesNotMatch(SQL.hechos, /password_hash/);
    assert.doesNotMatch(SQL.autorizados, /clabe/);
    assert.doesNotMatch(SQL.usuarioPorCorreo, /password_hash/);
    assert.match(SQL.autorizados, /m\.rol = 'liberador'/);
    assert.match(SQL.insertarEmpleado, /clabe_digito_valido/);
    const fuente = [
      readFileSync(new URL("./servicio.ts", import.meta.url), "utf8"),
      readFileSync(new URL("./liberar.ts", import.meta.url), "utf8"),
      readFileSync(new URL("./repositorio.ts", import.meta.url), "utf8"),
    ].join("\n");
    assert.equal(fuente.includes("console."), false);
    assert.doesNotMatch(fuente, /\b(spei|visa|payment_orders|payroll_batches)\b/i);
    const ui = [
      readFileSync(new URL("../../components/personas/maestro.tsx", import.meta.url), "utf8"),
      readFileSync(new URL("../../components/personas/formularios.tsx", import.meta.url), "utf8"),
      readFileSync(new URL("../../app/consola/personas/acciones.ts", import.meta.url), "utf8"),
      readFileSync(new URL("../../app/consola/personas/page.tsx", import.meta.url), "utf8"),
    ].join("\n");
    assert.match(ui, /FRASE_CONTADOR|El contador no tiene la acción de liberar/);
    assert.doesNotMatch(ui, /<button[^>]*>\s*Liberar/);
    assert.doesNotMatch(ui, /negarLiberacion|password_hash|DATABASE_URL|\b(spei|visa)\b/i);
    assert.match(ui, /clabeVisible/);
  });
});

function sesion(userId: string, rol: Rol): Sesion {
  return {
    id: randomUUID(),
    venceEn: new Date("2026-12-01T00:00:00.000Z"),
    usuario: { id: userId, nombre: "Quien entra", correo: "entra@ejemplo.mx" },
    companyId: "forjado-no-autoriza",
    rol,
  };
}

function alta(parcial: Record<string, unknown> = {}) {
  return {
    nombre: "Persona Norte",
    alta: "2026-11-03",
    baja: "",
    centroId: "",
    jefeId: "",
    clabe: CLABE,
    acceso: "no",
    correo: "",
    contrasena: PASSWORD,
    rol: "liberador",
    ...parcial,
  };
}

type PersonaMem = EmpleadoNuevo & { companyId: string; jefeNombre: string | null; centroNombre: string };

function persona(id: string, companyId: string, centroId: string, nombre: string): PersonaMem {
  return {
    id,
    companyId,
    nombre,
    altaEn: "2026-11-03",
    bajaEn: null,
    clabe: CLABE,
    jefeId: null,
    jefeNombre: null,
    centroId,
    centroNombre: "Ajeno",
    userId: null,
  };
}

function memoria() {
  const companyId = randomUUID();
  const estado = {
    companyId,
    membresias: new Map<string, { companyId: string; rol: Rol }>(),
    centros: [] as { id: string; companyId: string; nombre: string }[],
    personas: [] as PersonaMem[],
    usuarios: [] as { id: string; nombre: string; correo: string; passwordHash: string }[],
    auditoria: [] as { accion: string; params: readonly unknown[] }[],
    dispersiones: 0,
  };

  function clonar() {
    return {
      membresias: new Map(estado.membresias),
      centros: estado.centros.map((fila) => ({ ...fila })),
      personas: estado.personas.map((fila) => ({ ...fila })),
      usuarios: estado.usuarios.map((fila) => ({ ...fila })),
      auditoria: estado.auditoria.map((fila) => ({ ...fila, params: [...fila.params] })),
    };
  }

  function restaurar(copia: ReturnType<typeof clonar>) {
    estado.membresias = copia.membresias;
    estado.centros = copia.centros;
    estado.personas = copia.personas;
    estado.usuarios = copia.usuarios;
    estado.auditoria = copia.auditoria.map((fila) => ({ ...fila }));
  }

  const repositorio: RepositorioPersonas = {
    async conEmpresa(userId, fn) {
      const miembro = estado.membresias.get(userId);
      if (!miembro || miembro.companyId !== companyId) throw new ErrorDeDominio("sin_empresa");
      const copia = clonar();
      const ctx = contexto(miembro.rol);
      try {
        return await fn(ctx);
      } catch (error) {
        restaurar(copia);
        throw error;
      }
    },
    async puerta(userId) {
      const miembro = estado.membresias.get(userId);
      if (!miembro || miembro.companyId !== companyId) return null;
      return { rol: miembro.rol };
    },
    async leer(userId) {
      const miembro = estado.membresias.get(userId);
      if (!miembro || miembro.companyId !== companyId) return null;
      return lectura(miembro.rol);
    },
    async resumen(userId) {
      const miembro = estado.membresias.get(userId);
      if (!miembro || miembro.companyId !== companyId) return null;
      return { nombres: nombresAutorizados() };
    },
    async hechosLiberacion(userId) {
      const miembro = estado.membresias.get(userId);
      if (!miembro || miembro.companyId !== companyId) return null;
      const propia = estado.personas.find((fila) => fila.userId === userId && fila.companyId === companyId);
      return {
        rol: miembro.rol,
        actorDeBaja: Boolean(propia?.bajaEn && propia.bajaEn <= "2026-11-03"),
        autorizados: nombresAutorizados().length,
      };
    },
  };

  function nombresAutorizados(): string[] {
    const nombres: string[] = [];
    for (const [userId, miembro] of estado.membresias) {
      if (miembro.companyId !== companyId || miembro.rol !== "liberador") continue;
      const ficha = estado.personas.find((fila) => fila.userId === userId);
      if (ficha?.bajaEn && ficha.bajaEn <= "2026-11-03") continue;
      const usuario = estado.usuarios.find((fila) => fila.id === userId);
      if (usuario) nombres.push(usuario.nombre);
    }
    return nombres.sort((a, b) => a.localeCompare(b, "es"));
  }

  function lectura(rol: Rol): LecturaMaestro {
    const personas = estado.personas.filter((fila) => fila.companyId === companyId);
    return {
      rol,
      centros: estado.centros
        .filter((fila) => fila.companyId === companyId)
        .map((fila) => ({ id: fila.id, nombre: fila.nombre })),
      personas: personas.map((fila) => ({
        id: fila.id,
        nombre: fila.nombre,
        altaEn: fila.altaEn,
        bajaEn: fila.bajaEn,
        clabe: fila.clabe,
        jefeId: fila.jefeId,
        jefeNombre: fila.jefeId
          ? (estado.personas.find((jefe) => jefe.id === fila.jefeId)?.nombre ?? null)
          : null,
        centroId: fila.centroId,
        centroNombre:
          estado.centros.find((centro) => centro.id === fila.centroId)?.nombre ?? fila.centroNombre,
        rol: fila.userId ? (estado.membresias.get(fila.userId)?.rol ?? null) : null,
        correo: fila.userId
          ? (estado.usuarios.find((usuario) => usuario.id === fila.userId)?.correo ?? null)
          : null,
      })),
      autorizados: nombresAutorizados(),
    };
  }

  function contexto(rol: Rol): ContextoMaestro {
    return {
      companyId,
      rol,
      consulta: {
        async query(sql, params) {
          estado.auditoria.push({ accion: String(params?.[3] ?? ""), params: params ?? [] });
          return { rows: [], rowCount: 1 };
        },
      },
      async centroPorId(id) {
        const centro = estado.centros.find((fila) => fila.id === id && fila.companyId === companyId);
        return centro ? { id: centro.id, nombre: centro.nombre } : null;
      },
      async centroOcupado(nombre) {
        return estado.centros.some(
          (fila) => fila.companyId === companyId && fila.nombre.toLowerCase() === nombre.toLowerCase(),
        );
      },
      async jefePorId(id) {
        const jefe = estado.personas.find((fila) => fila.id === id && fila.companyId === companyId);
        return jefe ? { id: jefe.id, altaEn: jefe.altaEn, bajaEn: jefe.bajaEn } : null;
      },
      async bloquearPersona(id) {
        const personaActual = estado.personas.find((fila) => fila.id === id && fila.companyId === companyId);
        return personaActual
          ? { id: personaActual.id, altaEn: personaActual.altaEn, bajaEn: personaActual.bajaEn }
          : null;
      },
      async usuarioPorCorreo(correo) {
        const usuario = estado.usuarios.find((fila) => fila.correo === correo.toLowerCase());
        if (!usuario) return null;
        const miembro = estado.membresias.get(usuario.id);
        const tieneEmpleado = estado.personas.some((fila) => fila.userId === usuario.id);
        const encontrado: UsuarioDeCorreo = {
          id: usuario.id,
          companyId: miembro?.companyId ?? null,
          tieneEmpleado,
        };
        return encontrado;
      },
      async insertarCentro(centro) {
        estado.centros.push({ ...centro, companyId });
      },
      async insertarUsuario(usuario) {
        estado.usuarios.push(usuario);
      },
      async insertarMembresia(userId, rolNuevo) {
        estado.membresias.set(userId, { companyId, rol: rolNuevo });
      },
      async insertarEmpleado(empleado) {
        const centro = estado.centros.find((fila) => fila.id === empleado.centroId && fila.companyId === companyId);
        if (!centro) throw new ErrorDeDominio("centro_invalido");
        estado.personas.push({ ...empleado, companyId, jefeNombre: null, centroNombre: centro.nombre });
      },
      async escribirBaja(id, bajaEn) {
        const personaActual = estado.personas.find((fila) => fila.id === id && fila.companyId === companyId);
        if (!personaActual) throw new ErrorDeDominio("persona_ausente");
        personaActual.bajaEn = bajaEn;
      },
    };
  }

  return {
    companyId,
    get personas() {
      return estado.personas;
    },
    get usuarios() {
      return estado.usuarios;
    },
    get auditoria() {
      return estado.auditoria;
    },
    get dispersiones() {
      return estado.dispersiones;
    },
    get centros() {
      return estado.centros;
    },
    deps: {
      repositorio,
      ahora: () => HOY,
      hashear: async (contrasena: string) => `hash:${contrasena}`,
    },
    sembrar(opciones: { rol: Rol; nombre: string }) {
      const id = randomUUID();
      estado.usuarios.push({
        id,
        nombre: opciones.nombre,
        correo: `${id}@ejemplo.mx`,
        passwordHash: "hash:no-importa",
      });
      estado.membresias.set(id, { companyId, rol: opciones.rol });
      return id;
    },
  };
}
