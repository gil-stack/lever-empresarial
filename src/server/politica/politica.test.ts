import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { CAJONES, saldoDeAsientos } from "../../dominio/politica.ts";
import { ErrorDeDominio } from "../session/error-de-dominio.ts";
import type { Sesion } from "../session/tipos.ts";
import { rechazarSiNoEscribe, type ContextoEscritura, type EventoPolitica, type RepositorioPolitica } from "./repositorio.ts";
import {
  borrarCategoria,
  crearCategoria,
  editarPlazoEmpresa,
  editarPoliticaPersona,
  editarUmbral,
  escribirTopeCategoria,
  leerPolitica,
  quitarTopeCategoria,
} from "./servicio.ts";

const AHORA = new Date("2026-11-03T18:00:00.000Z");

describe("política, categorías y cajones", () => {
  it("la cuenta nace sin montos y el contador no escribe", async () => {
    const libro = memoria();
    const ana = libro.sembrarEmpresa("Alfa");
    const beto = libro.agregarPersona(ana.companyId, "Beto", "contador");
    libro.agregarPersona(ana.companyId, "Cata", "tarjetahabiente");

    const vista = await leerPolitica(sesion(ana.userId), { repositorio: libro.repo, ahora: () => AHORA });
    assert.ok(vista);
    assert.equal(vista.puedeEditar, true);
    assert.equal(vista.diasComprobante, 5);
    assert.equal(vista.maxVencidos, 5);
    assert.equal(vista.umbralCentavos, null);
    assert.equal(vista.categorias.length, 0);
    assert.deepEqual(
      vista.cajones.map((cajon) => [cajon.nombre, cajon.saldoCentavos]),
      [
        ["Viáticos", 0],
        ["Proveedores", 0],
        ["Impuestos", 0],
        ["Nómina", 0],
      ],
    );
    assert.equal(vista.sinCajonCentavos, 0);
    assert.equal(vista.personas.find((persona) => persona.personaId === beto.personaId)?.propio, false);
    assert.equal(vista.personas.some((persona) => persona.nombre === "Alfa"), false);

    const contador = await leerPolitica(sesion(beto.userId), { repositorio: libro.repo, ahora: () => AHORA });
    assert.equal(contador?.puedeEditar, false);
    await assert.rejects(
      editarPlazoEmpresa(sesion(beto.userId), { dias: "10", vencidos: "3" }, { repositorio: libro.repo, ahora: () => AHORA }),
      (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "rol_sin_permiso",
    );
    assert.equal(libro.empresa(ana.companyId).dias, 5);
    assert.equal(libro.auditoria.length, 0);
  });

  it("el plazo propio no se hereda, y guardar el default lo quita", async () => {
    const libro = memoria();
    const ana = libro.sembrarEmpresa("Alfa");
    const cata = libro.agregarPersona(ana.companyId, "Cata", "tarjetahabiente");
    const helena = libro.agregarSinConsola(ana.companyId, "Helena");
    const deps = { repositorio: libro.repo, ahora: () => AHORA };

    await editarPlazoEmpresa(sesion(ana.userId), { dias: "10", vencidos: "3" }, deps);
    await editarPoliticaPersona(
      sesion(ana.userId),
      { personaId: helena, dias: "9", vencidos: "2", quitar: false },
      deps,
    );
    const conPropio = await leerPolitica(sesion(ana.userId), deps);
    assert.equal(conPropio?.diasComprobante, 10);
    assert.equal(conPropio?.personas.find((persona) => persona.personaId === helena)?.diasComprobante, 9);
    assert.equal(conPropio?.personas.find((persona) => persona.personaId === helena)?.propio, true);
    assert.equal(conPropio?.personas.find((persona) => persona.personaId === helena)?.rolEtiqueta, "No entra a la consola");
    assert.equal(conPropio?.personas.find((persona) => persona.personaId === cata.personaId)?.propio, false);
    assert.equal(conPropio?.personas.find((persona) => persona.personaId === cata.personaId)?.diasComprobante, 10);
    assert.equal(conPropio?.personas.some((persona) => persona.nombre === "Alfa"), false);

    const igualado = await editarPoliticaPersona(
      sesion(ana.userId),
      { personaId: helena, dias: "10", vencidos: "3", quitar: false },
      deps,
    );
    assert.equal(igualado.propio, false);
    const otraVez = await leerPolitica(sesion(ana.userId), deps);
    assert.equal(otraVez?.personas.find((persona) => persona.personaId === helena)?.propio, false);
    assert.equal(
      libro.auditoria.some((evento) => evento.accion === "quitar_politica_persona" && evento.identificador === helena),
      true,
    );
    assert.equal(JSON.stringify(libro.auditoria).includes("centavos"), false);
  });

  it("la categoría nace sin tope y el centavo la deja lista", async () => {
    const libro = memoria();
    const ana = libro.sembrarEmpresa("Alfa");
    const deps = { repositorio: libro.repo, ahora: () => AHORA };
    await crearCategoria(sesion(ana.userId), { nombre: " Comida ", tope: "  " }, deps);
    const sinTope = await leerPolitica(sesion(ana.userId), deps);
    assert.equal(sinTope?.categorias[0]?.nombre, "Comida");
    assert.equal(sinTope?.categorias[0]?.topeCentavos, null);
    assert.equal(sinTope?.categorias[0]?.listaParaTarjeta, false);

    const id = sinTope?.categorias[0]?.id;
    assert.ok(id);
    await escribirTopeCategoria(sesion(ana.userId), { categoriaId: id, tope: "0.01" }, deps);
    const conCentavo = await leerPolitica(sesion(ana.userId), deps);
    assert.equal(conCentavo?.categorias[0]?.topeCentavos, 1);
    assert.equal(conCentavo?.categorias[0]?.listaParaTarjeta, true);

    await quitarTopeCategoria(sesion(ana.userId), { categoriaId: id }, deps);
    const otraVez = await leerPolitica(sesion(ana.userId), deps);
    assert.equal(otraVez?.categorias[0]?.topeCentavos, null);

    await escribirTopeCategoria(sesion(ana.userId), { categoriaId: id, tope: "0" }, deps);
    const cero = await leerPolitica(sesion(ana.userId), deps);
    assert.equal(cero?.categorias[0]?.topeCentavos, 0);
    assert.equal(cero?.categorias[0]?.listaParaTarjeta, true);

    await assert.rejects(
      crearCategoria(sesion(ana.userId), { nombre: "comida", tope: "" }, deps),
      (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "categoria_duplicada",
    );
    await borrarCategoria(sesion(ana.userId), { categoriaId: id }, deps);
    assert.equal((await leerPolitica(sesion(ana.userId), deps))?.categorias.length, 0);
  });

  it("el umbral vacío no es un monto, y un asiento de otra cuenta no cruza", async () => {
    const libro = memoria();
    const ana = libro.sembrarEmpresa("Alfa");
    const beta = libro.sembrarEmpresa("Beta");
    const deps = { repositorio: libro.repo, ahora: () => AHORA };
    libro.asentar(beta.companyId, "viaticos", 1);

    await editarUmbral(sesion(ana.userId), { texto: "", quitar: false }, deps).then(
      () => {
        throw new Error("el vacío no debía guardarse");
      },
      (error: unknown) => {
        assert.equal(error instanceof ErrorDeDominio && error.codigo, "umbral_invalido");
      },
    );
    await editarUmbral(sesion(ana.userId), { texto: "1.50", quitar: false }, deps);
    const conUmbral = await leerPolitica(sesion(ana.userId), deps);
    assert.equal(conUmbral?.umbralCentavos, 150);
    assert.equal(conUmbral?.diasComprobante, 5);
    await editarUmbral(sesion(ana.userId), { texto: "no-importa", quitar: true }, deps);
    assert.equal((await leerPolitica(sesion(ana.userId), deps))?.umbralCentavos, null);
    assert.equal(JSON.stringify(libro.auditoria).includes("150"), false);

    libro.asentar(ana.companyId, "viaticos", 100);
    libro.asentar(ana.companyId, "viaticos", -40);
    libro.asentar(ana.companyId, null, 7);
    const alfa = await leerPolitica(sesion(ana.userId, beta.companyId), deps);
    assert.equal(alfa?.cajones[0]?.saldoCentavos, 60);
    assert.equal(alfa?.sinCajonCentavos, 7);
    assert.equal(alfa?.cajones.slice(1).every((cajon) => cajon.saldoCentavos === 0), true);
    const otra = await leerPolitica(sesion(beta.userId, ana.companyId), deps);
    assert.equal(otra?.cajones[0]?.saldoCentavos, 1);
    assert.equal(otra?.sinCajonCentavos, 0);
    assert.equal(JSON.stringify(alfa).includes(beta.companyId), false);

    await assert.rejects(
      editarPoliticaPersona(
        sesion(ana.userId),
        { personaId: beta.userId, dias: "4", vencidos: "4", quitar: false },
        deps,
      ),
      (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "persona_ajena",
    );
    const ajena = beta.categoria ?? "";
    await assert.rejects(
      escribirTopeCategoria(sesion(ana.userId), { categoriaId: ajena, tope: "2.00" }, deps),
      (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "categoria_ajena",
    );
  });

  it("los otros roles tampoco escriben, y sin sesión no hay lectura", async () => {
    for (const rol of ["solicitante", "liberador", "tarjetahabiente"] as const) {
      assert.throws(() => rechazarSiNoEscribe(rol), (error: unknown) => error instanceof ErrorDeDominio);
    }
    const libro = memoria();
    await assert.rejects(
      leerPolitica(null, { repositorio: libro.repo }),
      (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "sesion_ausente",
    );
    assert.equal(await leerPolitica(sesion(randomUUID()), { repositorio: libro.repo, ahora: () => AHORA }), null);
  });
});

type Miembro = {
  userId: string;
  nombre: string;
  correo: string;
  rol: string;
};

type EmpleadoPolitica = {
  personaId: string;
  nombre: string;
  correo: string;
  rol: string;
};

type Categoria = { id: string; nombre: string; topeCentavos: number | null };

type Asiento = { codigo: (typeof CAJONES)[number]["codigo"] | null; centavos: number };

type Empresa = {
  dias: number;
  vencidos: number;
  umbral: number | null;
  miembros: Miembro[];
  empleados: EmpleadoPolitica[];
  plazos: Map<string, { dias: number; vencidos: number }>;
  categorias: Categoria[];
  asientos: Asiento[];
};

function memoria() {
  const empresas = new Map<string, Empresa>();
  const dueno = new Map<string, string>();
  const auditoria: EventoPolitica[] = [];

  function empresaDe(userId: string): { companyId: string; empresa: Empresa; rol: string } {
    const companyId = dueno.get(userId);
    const empresa = companyId ? empresas.get(companyId) : undefined;
    const rol = empresa?.miembros.find((miembro) => miembro.userId === userId)?.rol;
    if (!companyId || !empresa || !rol) throw new ErrorDeDominio("sin_empresa");
    return { companyId, empresa, rol };
  }

  const repo: RepositorioPolitica = {
    async leer(userId) {
      const hallado = dueno.get(userId);
      if (!hallado) return null;
      const empresa = empresas.get(hallado);
      if (!empresa) return null;
      const rol = empresa.miembros.find((miembro) => miembro.userId === userId)?.rol;
      if (!rol) return null;
      return {
        companyId: hallado,
        rol,
        diasComprobante: empresa.dias,
        maxVencidos: empresa.vencidos,
        umbralCentavos: empresa.umbral,
        personas: empresa.empleados.map((empleado) => ({
          personaId: empleado.personaId,
          nombre: empleado.nombre,
          correo: empleado.correo,
          rol: empleado.rol,
          diasComprobante: empresa.plazos.get(empleado.personaId)?.dias ?? null,
          maxVencidos: empresa.plazos.get(empleado.personaId)?.vencidos ?? null,
        })),
        categorias: empresa.categorias.map((categoria) => ({ ...categoria })),
        cajones: CAJONES.map((cajon) => ({
          codigo: cajon.codigo,
          nombre: cajon.nombre,
          saldoCentavos: saldoDeAsientos(
            empresa.asientos.filter((asiento) => asiento.codigo === cajon.codigo).map((asiento) => asiento.centavos),
          ),
        })),
        sinCajonCentavos: saldoDeAsientos(
          empresa.asientos.filter((asiento) => asiento.codigo === null).map((asiento) => asiento.centavos),
        ),
      };
    },
    async escribir(userId, fn) {
      const { companyId, empresa, rol } = empresaDe(userId);
      rechazarSiNoEscribe(rol);
      const foto = clonar(empresa);
      const marca = auditoria.length;
      const ctx: ContextoEscritura = {
        companyId,
        rol,
        plazo: { diasComprobante: empresa.dias, maxVencidos: empresa.vencidos },
        async guardarPlazo(dias, vencidos) {
          empresa.dias = dias;
          empresa.vencidos = vencidos;
        },
        async guardarUmbral(centavos) {
          empresa.umbral = centavos;
        },
        async guardarPersona(personaId, dias, vencidos) {
          if (!empresa.empleados.some((empleado) => empleado.personaId === personaId)) {
            throw new ErrorDeDominio("persona_ajena");
          }
          empresa.plazos.set(personaId, { dias, vencidos });
        },
        async quitarPersona(personaId) {
          if (!empresa.empleados.some((empleado) => empleado.personaId === personaId)) {
            throw new ErrorDeDominio("persona_ajena");
          }
          return empresa.plazos.delete(personaId);
        },
        async crearCategoria(categoria) {
          const clave = categoria.nombre.toLocaleLowerCase("es-MX");
          if (empresa.categorias.some((actual) => actual.nombre.toLocaleLowerCase("es-MX") === clave)) {
            throw new ErrorDeDominio("categoria_duplicada");
          }
          empresa.categorias.push({ ...categoria });
        },
        async escribirTope(categoriaId, centavos) {
          const categoria = empresa.categorias.find((actual) => actual.id === categoriaId);
          if (!categoria) throw new ErrorDeDominio("categoria_ajena");
          categoria.topeCentavos = centavos;
        },
        async quitarTope(categoriaId) {
          const categoria = empresa.categorias.find((actual) => actual.id === categoriaId);
          if (!categoria) throw new ErrorDeDominio("categoria_ajena");
          categoria.topeCentavos = null;
        },
        async borrarCategoria(categoriaId) {
          const indice = empresa.categorias.findIndex((actual) => actual.id === categoriaId);
          if (indice < 0) throw new ErrorDeDominio("categoria_ajena");
          empresa.categorias.splice(indice, 1);
        },
        async auditar(evento) {
          auditoria.push(evento);
        },
      };
      try {
        await fn(ctx);
      } catch (error) {
        empresas.set(companyId, foto);
        auditoria.splice(marca);
        throw error;
      }
    },
  };

  return {
    repo,
    auditoria,
    sembrarEmpresa(nombre: string) {
      const companyId = randomUUID();
      const userId = randomUUID();
      const empresa: Empresa = {
        dias: 5,
        vencidos: 5,
        umbral: null,
        miembros: [{ userId, nombre, correo: `${nombre.toLowerCase()}@ejemplo.mx`, rol: "administrador" }],
        empleados: [],
        plazos: new Map(),
        categorias: [],
        asientos: [],
      };
      empresas.set(companyId, empresa);
      dueno.set(userId, companyId);
      const categoriaId = randomUUID();
      if (nombre === "Beta") {
        empresa.categorias.push({ id: categoriaId, nombre: "Ajena", topeCentavos: null });
      }
      return { companyId, userId, categoria: nombre === "Beta" ? categoriaId : null };
    },
    agregarPersona(companyId: string, nombre: string, rol: string) {
      const userId = randomUUID();
      const personaId = randomUUID();
      const empresa = empresas.get(companyId);
      if (!empresa) throw new Error("empresa ausente");
      const correo = `${nombre.toLowerCase()}@ejemplo.mx`;
      empresa.miembros.push({ userId, nombre, correo, rol });
      empresa.empleados.push({ personaId, nombre, correo, rol });
      dueno.set(userId, companyId);
      return { userId, personaId };
    },
    agregarSinConsola(companyId: string, nombre: string) {
      const personaId = randomUUID();
      const empresa = empresas.get(companyId);
      if (!empresa) throw new Error("empresa ausente");
      empresa.empleados.push({ personaId, nombre, correo: "", rol: "" });
      return personaId;
    },
    asentar(companyId: string, codigo: Asiento["codigo"], centavos: number) {
      empresas.get(companyId)?.asientos.push({ codigo, centavos });
    },
    empresa(companyId: string) {
      const empresa = empresas.get(companyId);
      if (!empresa) throw new Error("empresa ausente");
      return empresa;
    },
  };
}

function clonar(empresa: Empresa): Empresa {
  return {
    dias: empresa.dias,
    vencidos: empresa.vencidos,
    umbral: empresa.umbral,
    miembros: empresa.miembros.map((miembro) => ({ ...miembro })),
    empleados: empresa.empleados.map((empleado) => ({ ...empleado })),
    plazos: new Map(empresa.plazos),
    categorias: empresa.categorias.map((categoria) => ({ ...categoria })),
    asientos: empresa.asientos.map((asiento) => ({ ...asiento })),
  };
}

function sesion(userId: string, companyId: string | null = null): Sesion {
  return {
    id: randomUUID(),
    venceEn: new Date("2026-11-04T00:00:00.000Z"),
    usuario: { id: userId, nombre: "Ana", correo: "ana@ejemplo.mx" },
    companyId,
    rol: null,
  };
}
