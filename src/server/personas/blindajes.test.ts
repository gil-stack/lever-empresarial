import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { clabeEnmascarada } from "../../dominio/clabe.ts";
import { altaConNomina, validarAltaPersona } from "../../dominio/personas.ts";
import type { PersonaVista } from "../../dominio/personas-vista.ts";
import { capacidadesDe, type RolCliente } from "../../nucleo/capacidades.ts";
import type { ContextoConEmpresa } from "../../nucleo/contexto.ts";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio.ts";
import { exigirAutenticacionReciente } from "../autenticacion/reautenticacion.ts";
import { preparar } from "../bitacora/auditar.ts";
import { escaparComodines } from "./repositorio.ts";
import { cambiarClabeNomina, vistaPara } from "./servicio.ts";

const CLABE = "002180701150123452";
const CENTRO = "55555555-5555-4555-8555-555555555555";
const AHORA = new Date("2026-11-06T18:00:00.000Z");

describe("CLABE de nómina con mínimo privilegio", () => {
  it("solo quien puede cambiarla ve los 18 dígitos y solo quien prepara o autoriza ve el neto", () => {
    const persona = vista();
    const admin = vistaPara(ctx(["administrador"]), persona);
    assert.equal(admin.clabe, CLABE);
    assert.equal(admin.nomina?.netoCentavos, 1000);
    const liberador = vistaPara(ctx(["liberador"]), persona);
    assert.equal(liberador.clabe, null);
    assert.equal(liberador.clabeFinal, "3452");
    assert.equal(liberador.nomina?.netoCentavos, 1000);
    const contador = vistaPara(ctx(["contador"]), persona);
    assert.equal(contador.clabe, null);
    assert.equal(contador.clabeFinal, "3452");
    assert.equal(contador.nomina?.netoCentavos, null);
    assert.equal(JSON.stringify(contador).includes(CLABE), false);
  });

  it("la bitácora acepta la terminación y nunca los 18 dígitos en una clave ajena", () => {
    assert.equal(clabeEnmascarada(CLABE), "•••• 3452");
    const actor = {
      operadorId: "44444444-4444-4444-8444-444444444444",
      companyId: "11111111-1111-4111-8111-111111111111",
      actorTipo: "miembro" as const,
      actorId: "22222222-2222-4222-8222-222222222222",
      superficie: "cliente" as const,
      peticionId: null,
      origen: "consola",
    };
    const fila = preparar(actor, {
      accion: "cambiar_clabe_nomina",
      identificador: "33333333-3333-4333-8333-333333333333",
      cambio: { clabe_anterior: null, clabe_nueva: clabeEnmascarada(CLABE) },
    });
    assert.equal(String(fila.at(-1)).includes(CLABE), false);
    assert.throws(
      () => preparar(actor, { accion: "cambiar_clabe_nomina", identificador: null, cambio: { clabe: CLABE } }),
      (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "auditoria_no_disponible",
    );
  });

  it("exige el permiso propio y un segundo factor de menos de 30 minutos en la misma sesión", async () => {
    const sinPermiso = (roles: RolCliente[]) =>
      assert.rejects(
        () => cambiarClabeNomina(ctx(roles), sesion(AHORA), { personaId: CENTRO, clabe: CLABE }, { ahora: () => AHORA }),
        (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "sin_permiso",
      );
    await sinPermiso(["contador"]);
    await sinPermiso(["liberador"]);
    const vieja = new Date(AHORA.getTime() - 31 * 60 * 1000);
    await assert.rejects(
      () => cambiarClabeNomina(ctx(["administrador"]), sesion(vieja), { personaId: CENTRO, clabe: CLABE }, { ahora: () => AHORA }),
      (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "reautenticacion_requerida",
    );
    await assert.rejects(
      () => cambiarClabeNomina(ctx(["administrador"]), { ...sesion(AHORA), id: "otra" }, { personaId: CENTRO, clabe: CLABE }, { ahora: () => AHORA }),
      (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "reautenticacion_requerida",
    );
    assert.throws(() => exigirAutenticacionReciente({ superficie: "sofipo", segundoFactor: { metodo: "totp", en: AHORA } }, AHORA, "cliente"));
    assert.doesNotThrow(() => exigirAutenticacionReciente({ superficie: "cliente", segundoFactor: { metodo: "totp", en: AHORA } }, AHORA, "cliente"));
  });
});

describe("alta sin nómina y búsqueda literal", () => {
  it("una persona solo acceso no exige neto, destino ni CLABE; con nómina sí exige CLABE", () => {
    const base = { nombre: "Solo Acceso", alta: "2026-11-01", centroId: CENTRO, acceso: "no" };
    assert.equal(altaConNomina({ ...base, nomina: "no", neto: "100" }), false);
    assert.equal(altaConNomina({ ...base, neto: null, frecuencia: "", primerPago: null }), false);
    assert.equal(altaConNomina({ ...base, neto: "100" }), true);
    const sinNomina = validarAltaPersona({ ...base, nomina: "no", destino: null, clabe: null }, "2026-11-06");
    assert.equal(sinNomina.ok, true);
    if (sinNomina.ok) assert.equal(sinNomina.valor.destino, null);
    const conNomina = validarAltaPersona({ ...base, nomina: "si", destino: null, clabe: "" }, "2026-11-06");
    assert.equal(conNomina.ok, false);
    if (!conNomina.ok) assert.equal(conNomina.codigo, "clabe_invalida");
  });

  it("escapa los comodines de ILIKE", () => {
    assert.equal(escaparComodines("100%_a\\b"), "100\\%\\_a\\\\b");
  });
});

function vista(): PersonaVista {
  return {
    id: CENTRO,
    nombre: "Persona",
    altaEn: "2026-11-01",
    bajaEn: null,
    clabe: CLABE,
    clabeFinal: CLABE.slice(-4),
    presupuestoCentavos: null,
    jefeId: null,
    jefeNombre: null,
    centroId: CENTRO,
    centroNombre: "Área",
    roles: [],
    membresia: null,
    invitada: false,
    correo: null,
    nomina: { netoCentavos: 1000, frecuencia: "mensual", proximoPagoEn: "2026-11-30", destino: "clabe", activa: true },
    tarjetaPendiente: false,
  };
}

function sesion(en: Date) {
  return { id: "33333333-3333-4333-8333-333333333333", superficie: "cliente" as const, segundoFactor: { metodo: "totp" as const, en } };
}

function ctx(roles: RolCliente[]): ContextoConEmpresa {
  return {
    sesionId: "33333333-3333-4333-8333-333333333333",
    peticionId: null,
    superficie: "cliente",
    persona: { id: "22222222-2222-4222-8222-222222222222", nombre: "Ada", correo: "ada@ejemplo.mx" },
    segundoFactor: "totp",
    empresa: {
      id: "11111111-1111-4111-8111-111111111111",
      rfc: "EKU9003173C9",
      razonSocial: "Escuela",
      operadorId: "44444444-4444-4444-8444-444444444444",
      estado: "activa",
      demostracion: true,
    },
    roles,
    personal: null,
    empresas: [{ id: "11111111-1111-4111-8111-111111111111", razonSocial: "Escuela", roles }],
    capacidades: capacidadesDe({ rolesCliente: roles, rolesPlataforma: [] }),
  };
}
