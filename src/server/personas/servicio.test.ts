import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { capacidadesDe, type RolCliente } from "../../nucleo/capacidades.ts";
import type { ContextoDeTenant } from "../../nucleo/contexto.ts";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio.ts";
import { negarLiberacion } from "./liberar.ts";
import { fechaDeColumna, SQL } from "./repositorio.ts";
import { darDeAltaPersona, nombrarCentro } from "./servicio.ts";
import type { RepositorioPersonas, TransaccionMaestro } from "./tipos.ts";

const HOY = new Date("2026-11-03T18:00:00.000Z");
const CLABE = "002180701150123452";
const EMPRESA = "11111111-1111-4111-8111-111111111111";
const ADMIN = "22222222-2222-4222-8222-222222222222";

describe("el maestro no dispersa y no abre con una sola firma", () => {
  it("rechaza la CLABE mala y la invitación no guarda una contraseña", async () => {
    const mundo = memoria();
    const centro = await nombrarCentro(ctx(["administrador"]), { nombre: "Nómina" }, mundo.deps);
    await assert.rejects(
      () => darDeAltaPersona(ctx(["administrador"]), alta({ centroId: centro.id, clabe: "002180701150123453" }), mundo.deps),
      (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "clabe_invalida",
    );
    assert.equal(mundo.personas.length, 0);
    const creada = await darDeAltaPersona(
      ctx(["administrador"]),
      alta({ centroId: centro.id, acceso: "nueva", correo: "Liberador@Ejemplo.MX", rol: "liberador", nombre: "Luis Soto" }),
      mundo.deps,
    );
    assert.equal(creada.invitacion, "pendiente");
    assert.equal(JSON.stringify(creada).toLowerCase().includes("contraseña"), false);
    assert.equal(mundo.personas.find((fila) => fila.id === creada.id)?.clabe, CLABE);
    assert.equal(mundo.usuarios[0]?.passwordHash, null);
    assert.equal(JSON.stringify(mundo.auditoria).includes(CLABE), false);
  });

  it("el contador no da de alta y un centro de otra empresa no se ve", async () => {
    const mundo = memoria();
    const centro = await nombrarCentro(ctx(["administrador"]), { nombre: "Obra" }, mundo.deps);
    mundo.centros.push({ id: randomUUID(), companyId: randomUUID(), nombre: "Ajeno" });
    await assert.rejects(
      () => darDeAltaPersona(ctx(["contador"]), alta({ centroId: centro.id }), mundo.deps),
      (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "sin_permiso",
    );
    await assert.rejects(
      () =>
        darDeAltaPersona(
          ctx(["administrador"]),
          alta({ centroId: mundo.centros.at(-1)?.id, acceso: "no" }),
          mundo.deps,
        ),
      (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "centro_invalido",
    );
  });

  it("un solo liberador no dispersa, y la baja le quita ese rol", async () => {
    const mundo = memoria();
    await assert.rejects(
      () => negarLiberacion(ctx(["liberador"]), randomUUID(), mundo.deps),
      (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "empresa_no_operable",
    );
    const centro = await nombrarCentro(ctx(["administrador"]), { nombre: "Nómina" }, mundo.deps);
    const creada = await darDeAltaPersona(
      ctx(["administrador"]),
      alta({
        centroId: centro.id,
        acceso: "nueva",
        correo: "libera@ejemplo.mx",
        rol: "liberador",
        nombre: "Luis Soto",
        baja: "2026-11-03",
      }),
      mundo.deps,
    );
    assert.equal(mundo.roles.get(mundo.usuarios[0]?.id ?? "")?.includes("liberador"), false);
    assert.equal(mundo.personas.find((fila) => fila.id === creada.id)?.bajaEn, "2026-11-03");
  });
});

function ctx(roles: RolCliente[]): ContextoDeTenant {
  return {
    sesionId: "33333333-3333-4333-8333-333333333333",
    peticionId: null,
    superficie: "cliente",
    persona: { id: ADMIN, nombre: "Ada", correo: "ada@ejemplo.mx" },
    segundoFactor: "totp",
    empresa: {
      id: EMPRESA,
      rfc: "EKU9003173C9",
      razonSocial: "Escuela",
      operadorId: "44444444-4444-4444-8444-444444444444",
      estado: "activa",
      demostracion: true,
    },
    roles,
    personal: null,
    empresas: [{ id: EMPRESA, razonSocial: "Escuela" }],
    capacidades: capacidadesDe({ rolesCliente: roles, rolesPlataforma: [] }),
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
    rol: "liberador",
    ...parcial,
  };
}

function memoria() {
  const estado = {
    personas: [] as Array<{ id: string; companyId: string; clabe: string; bajaEn: string | null; userId: string | null; nombre: string }>,
    centros: [] as Array<{ id: string; companyId: string; nombre: string }>,
    usuarios: [] as Array<{ id: string; correo: string; passwordHash: null }>,
    roles: new Map<string, string[]>(),
    auditoria: [] as Array<{ accion: string }>,
    autorizados: 1,
  };
  const tx = (): TransaccionMaestro => ({
    companyId: EMPRESA,
    consulta: {
      async query() {
        return { rows: [], rowCount: 1 };
      },
    },
    async centroPorId(id) {
      const centro = estado.centros.find((fila) => fila.id === id && fila.companyId === EMPRESA);
      return centro ? { id: centro.id, nombre: centro.nombre } : null;
    },
    async centroOcupado(nombre) {
      return estado.centros.some((fila) => fila.companyId === EMPRESA && fila.nombre.toLowerCase() === nombre.toLowerCase());
    },
    async clabeDuplicada() {
      return false;
    },
    async jefePorId() {
      return null;
    },
    async bloquearPersona(id) {
      const persona = estado.personas.find((fila) => fila.id === id);
      return persona
        ? { id: persona.id, altaEn: "2026-11-03", bajaEn: persona.bajaEn, userId: persona.userId, roles: [] }
        : null;
    },
    async miembroPorCorreo() {
      return null;
    },
    async rolesDe(userId) {
      return (estado.roles.get(userId) ?? []) as RolCliente[];
    },
    async insertarCentro(centro) {
      estado.centros.push({ ...centro, companyId: EMPRESA });
    },
    async insertarEmpleado(empleado) {
      estado.personas.push({
        id: empleado.id,
        companyId: EMPRESA,
        clabe: empleado.clabe,
        bajaEn: empleado.bajaEn,
        userId: empleado.userId,
        nombre: empleado.nombre,
      });
    },
    async escribirBaja(id, bajaEn) {
      const persona = estado.personas.find((fila) => fila.id === id);
      if (!persona) throw new ErrorDeDominio("persona_ausente");
      persona.bajaEn = bajaEn;
    },
    async quitarLiberador(userId) {
      const roles = (estado.roles.get(userId) ?? []).filter((rol) => rol !== "liberador");
      estado.roles.set(userId, roles.length > 0 ? roles : ["tarjetahabiente"]);
    },
  });
  const repo: RepositorioPersonas = {
    async conEmpresa(_ctx, fn) {
      return fn(tx());
    },
    async leer() {
      return { centros: [], personas: [], autorizados: [] };
    },
    async resumen() {
      return { nombres: [] };
    },
    async hechosLiberacion() {
      return { actorDeBaja: false, autorizados: estado.autorizados };
    },
  };
  return {
    ...estado,
    deps: {
      repositorio: repo,
      ahora: () => HOY,
      auditar: async (_consulta: unknown, _actor: unknown, hecho: { accion: string }) => {
        estado.auditoria.push(hecho);
      },
      emitir: async () => {
        const id = randomUUID();
        estado.usuarios.push({ id, correo: "liberador@ejemplo.mx", passwordHash: null });
        estado.roles.set(id, ["liberador"]);
        return {
          invitacionId: randomUUID(),
          userId: id,
          companyId: EMPRESA,
          correo: "liberador@ejemplo.mx",
          nombre: "Luis Soto",
          roles: ["liberador"] as RolCliente[],
          token: "a".repeat(43),
          expiraEn: HOY,
        };
      },
      entregar: async () => ({ entregada: false, codigo: "correo_no_configurado" }),
    },
  };
}

describe("fechas DATE del driver", () => {
  it("conserva el día local y no lo corre al convertirlo a ISO", () => {
    const local = new Date(2026, 10, 5);
    assert.equal(fechaDeColumna(local), "2026-11-05");
  });
});

describe("contrato del libro", () => {
  it("la ficha manda la baja con el nombre que el servicio valida", () => {
    const acciones = readFileSync(new URL("../../app/consola/personas/acciones.ts", import.meta.url), "utf8");
    assert.match(
      acciones,
      /registrarBaja\(\s*sesion,\s*\{\s*personaId:\s*validada\.personaId,\s*baja:\s*validada\.bajaEn,?\s*\}\)/,
    );
  });

  it("filtra por la empresa de la sesión y no selecciona el hash ni la CLABE para liberar", () => {
    assert.match(SQL.personas, /e\.company_id = \$1/);
    assert.match(SQL.personas, /e\.clabe/);
    assert.doesNotMatch(SQL.personas, /password_hash/);
    assert.doesNotMatch(SQL.autorizados, /clabe/);
    assert.doesNotMatch(SQL.miembroPorCorreo, /password_hash/);
    assert.match(SQL.autorizados, /r\.rol = 'liberador'/);
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
