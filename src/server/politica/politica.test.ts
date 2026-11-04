import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CAJONES } from "../../dominio/politica.ts";
import { capacidadesDe, type RolCliente } from "../../nucleo/capacidades.ts";
import type { ContextoDeTenant } from "../../nucleo/contexto.ts";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio.ts";
import { rechazarSiNoEscribe, type ContextoEscritura, type RepositorioPolitica } from "./repositorio.ts";
import { crearCategoria, editarPlazoEmpresa, leerPolitica } from "./servicio.ts";

const EMPRESA = "11111111-1111-4111-8111-111111111111";
const PERSONA = "22222222-2222-4222-8222-222222222222";

describe("política, categorías y cajones", () => {
  it("el contador no escribe y el administrador sí deja el plazo", async () => {
    const libro = memoria();
    const vista = await leerPolitica(ctx(["contador"]), { repositorio: libro });
    assert.equal(vista?.puedeEditar, false);
    assert.equal(vista?.diasComprobante, 5);
    await assert.rejects(
      () => editarPlazoEmpresa(ctx(["contador"]), { dias: 10, vencidos: 4 }, { repositorio: libro }),
      (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "rol_sin_permiso",
    );
    await editarPlazoEmpresa(ctx(["administrador"]), { dias: 10, vencidos: 4 }, { repositorio: libro });
    assert.deepEqual(libro.plazo, { dias: 10, vencidos: 4 });
  });

  it("una categoría puede nacer sin tope", async () => {
    const libro = memoria();
    await crearCategoria(ctx(["administrador"]), { nombre: "Comida", tope: "" }, { repositorio: libro });
    assert.equal(libro.categorias[0]?.nombre, "Comida");
    assert.equal(libro.categorias[0]?.tope, null);
  });

  it("sin empresa no hay lectura", async () => {
    await assert.rejects(
      () => leerPolitica(null),
      (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "sesion_ausente",
    );
  });
});

function ctx(roles: RolCliente[]): ContextoDeTenant {
  return {
    sesionId: "33333333-3333-4333-8333-333333333333",
    peticionId: null,
    superficie: "cliente",
    persona: { id: PERSONA, nombre: "Ana", correo: "ana@ejemplo.mx" },
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

function memoria(): RepositorioPolitica & {
  plazo: { dias: number; vencidos: number };
  categorias: Array<{ nombre: string; tope: number | null }>;
} {
  const estado = {
    plazo: { dias: 5, vencidos: 5 },
    categorias: [] as Array<{ nombre: string; tope: number | null }>,
  };
  const escritura: ContextoEscritura = {
    companyId: EMPRESA,
    plazo: { diasComprobante: estado.plazo.dias, maxVencidos: estado.plazo.vencidos },
    async guardarPlazo(dias, vencidos) {
      estado.plazo.dias = dias;
      estado.plazo.vencidos = vencidos;
    },
    async guardarUmbral() {},
    async guardarPersona() {},
    async quitarPersona() {
      return false;
    },
    async crearCategoria(categoria) {
      estado.categorias.push({ nombre: categoria.nombre, tope: categoria.topeCentavos });
    },
    async escribirTope() {},
    async quitarTope() {},
    async borrarCategoria() {},
    async auditar() {},
  };
  return {
    ...estado,
    async leer(contexto) {
      return {
        companyId: EMPRESA,
        puedeEditar: contexto.capacidades.includes("cliente.politica.editar"),
        diasComprobante: 5,
        maxVencidos: 5,
        umbralCentavos: null,
        personas: [],
        categorias: [],
        cajones: CAJONES.map((cajon) => ({ codigo: cajon.codigo, nombre: cajon.nombre, saldoCentavos: 0 })),
        sinCajonCentavos: 0,
      };
    },
    async escribir(contexto, fn) {
      rechazarSiNoEscribe(contexto);
      await fn(escritura);
    },
  };
}
