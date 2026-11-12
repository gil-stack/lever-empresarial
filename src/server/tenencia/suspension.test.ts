import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { leerDetallePersona, leerMaestro } from "../personas/servicio.ts";
import type { DetallePersona, LecturaMaestro, RepositorioPersonas } from "../personas/tipos.ts";
import { resolverContexto, type MembresiaLeida } from "./resolver.ts";

const EMPRESA = "11111111-1111-4111-8111-111111111111";
const EMPLEADO = "22222222-2222-4222-8222-222222222222";
const CLABE = "002180701150123452";

describe("proyecciones de personas con el contexto real de una empresa suspendida", () => {
  for (const estado of ["activa", "suspendida"] as const) {
    it(`${estado}: aplica la autorización a la lista, la ficha y el historial de CLABE`, async () => {
      const { ctx } = await resolverContexto({
        sesion: {
          id: "33333333-3333-4333-8333-333333333333",
          usuario: { id: "44444444-4444-4444-8444-444444444444", nombre: "Ada", correo: "ada@ejemplo.mx" },
          segundoFactor: { metodo: "totp", en: new Date("2026-11-13T00:00:00Z") },
          venceEn: new Date("2026-11-14T00:00:00Z"),
        },
        empresaPedida: EMPRESA,
        peticionId: null,
        superficie: "cliente",
      }, { repositorio: { async pertenencia() { return { membresias: [membresia(estado)], personal: null }; } } });

      const detalle = ficha();
      const lista: LecturaMaestro = {
        personas: [detalle.persona], centros: [], areas: [], autorizados: [], jefes: [],
        resumen: { vigentes: 1, porConfigurar: 0, nominaMensualCentavos: 1000, proximoPagoEn: null, proximoPagoCentavos: 0 },
        total: 1, pagina: 1, porPagina: 20,
      };
      const repositorio: RepositorioPersonas = {
        async leer() { return lista; },
        async detalle(_ctx, _hoy, id) { assert.equal(id, EMPLEADO); return detalle; },
        async conEmpresa() { throw new Error("la lectura no escribe"); },
        async resumen() { throw new Error("lectura no esperada"); },
        async hechosLiberacion() { throw new Error("lectura no esperada"); },
      };
      const deps = { repositorio, ahora: () => new Date("2026-11-13T12:00:00Z") };
      const maestro = await leerMaestro(ctx, undefined, deps);
      const fichaVisible = await leerDetallePersona(ctx, EMPLEADO, deps);
      assert.ok(fichaVisible);
      const activa = estado === "activa";
      for (const persona of [maestro.personas[0], fichaVisible.persona]) {
        assert.equal(persona.clabe, activa ? CLABE : null);
        assert.equal(persona.clabeFinal, "3452");
        assert.equal(persona.nomina?.netoCentavos, 1000, "se conserva el permiso explícito de consultar nómina");
      }
      assert.equal(fichaVisible.clabeDuplicada, activa);
      assert.deepEqual(fichaVisible.historialClabe, activa ? detalle.historialClabe : []);
      assert.equal(JSON.stringify([maestro, fichaVisible]).includes(CLABE), activa);
      assert.equal(detalle.persona.clabe, CLABE, "la proyección no altera el registro del repositorio");
    });
  }
});

function membresia(estado: string): MembresiaLeida {
  return { id: EMPRESA, rfc: "EKU9003173C9", razonSocial: "Escuela", operadorId: "55555555-5555-4555-8555-555555555555", estado, demostracion: false, roles: ["administrador"] };
}

function ficha(): DetallePersona {
  return {
    persona: {
      id: EMPLEADO, userId: null, nombre: "Persona", altaEn: "2026-11-01", bajaEn: null,
      clabe: CLABE, clabeFinal: "3452", presupuestoCentavos: null, jefeId: null, jefeNombre: null,
      centroId: EMPRESA, centroNombre: "Área", roles: [], membresia: null, invitada: false,
      correo: null, tarjetaPendiente: false,
      nomina: { netoCentavos: 1000, frecuencia: "mensual", proximoPagoEn: "2026-11-30", destino: "clabe", activa: true },
    },
    centros: [], jefes: [], clabeDuplicada: true,
    historialClabe: [{ id: EMPLEADO, visible: "•••• 3452", desde: "2026-11-01", hasta: null, registradaPor: "Ada" }],
  };
}
