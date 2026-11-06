import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readFileSync } from "node:fs";

import { capacidadesDe, tiene, type RolCliente } from "../nucleo/capacidades.ts";
import {
  accesoFinanzasDe,
  FRASE_CONTADOR,
  FRASE_SIN_DISPERSION,
  decidirLiberacion,
  empresaOperable,
  erroresDeAltaPersona,
  estaDeBaja,
  fechaDesdePartes,
  fechaValida,
  hoyEnMexico,
  lineaDeRol,
  partesDeFecha,
  relatoOperabilidad,
  ROLES_VISIBLES,
  validarAltaPersona,
} from "./personas.ts";

function suelta(roles: RolCliente[]): boolean {
  return tiene(capacidadesDe({ rolesCliente: roles, rolesPlataforma: [] }), "cliente.pago.liberar");
}

const HOY = "2026-11-03";
const CENTRO = "11111111-1111-4111-8111-111111111111";
const CLABE = "002180701150123452";

describe("dos firmas y el contador", () => {
  it("solo el liberador suelta dinero, y una sola persona no deja operable la empresa", () => {
    assert.equal(suelta(["liberador"]), true);
    assert.equal(suelta(["contador"]), false);
    assert.equal(suelta(["administrador"]), false);
    assert.equal(suelta(["administrador", "liberador"]), true);
    assert.equal(suelta(["solicitante"]), false);
    assert.equal(suelta(["tarjetahabiente"]), false);
    assert.equal(suelta([]), false);
    assert.equal(empresaOperable(0), false);
    assert.equal(empresaOperable(1), false);
    assert.equal(empresaOperable(2), true);
    assert.equal(FRASE_CONTADOR, "El contador no tiene la acción de liberar.");
    assert.equal(FRASE_SIN_DISPERSION, "No se dispersa dinero.");
    assert.match(lineaDeRol("contador"), /El contador no tiene la acción de liberar/);
  });

  it("niega la liberación y nunca devuelve un sí", () => {
    const actor = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const otra = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    assert.equal(
      decidirLiberacion({ roles: ["contador"], deBaja: false, autorizados: 2, actorId: actor }),
      "sin_accion_de_liberar",
    );
    assert.equal(
      decidirLiberacion({ roles: ["administrador"], deBaja: false, autorizados: 2, actorId: actor }),
      "sin_accion_de_liberar",
    );
    assert.equal(
      decidirLiberacion({ roles: ["liberador"], deBaja: true, autorizados: 2, actorId: actor }),
      "sin_accion_de_liberar",
    );
    assert.equal(
      decidirLiberacion({ roles: ["liberador"], deBaja: false, autorizados: 1, actorId: actor }),
      "empresa_no_operable",
    );
    assert.equal(
      decidirLiberacion({
        roles: ["liberador"],
        deBaja: false,
        autorizados: 2,
        actorId: actor,
        otraFirmaId: actor.toUpperCase(),
      }),
      "misma_firma",
    );
    assert.equal(
      decidirLiberacion({
        roles: ["liberador"],
        deBaja: false,
        autorizados: 2,
        actorId: actor,
      }),
      "misma_firma",
    );
    assert.equal(
      decidirLiberacion({
        roles: ["liberador"],
        deBaja: false,
        autorizados: 2,
        actorId: actor,
        otraFirmaId: otra,
      }),
      "sin_dispersion",
    );
  });

  it("dice en voz alta cuando falta la segunda persona", () => {
    const ninguna = relatoOperabilidad([]);
    assert.equal(ninguna.operable, false);
    assert.match(ninguna.detalle, /dos personas distintas/);
    const una = relatoOperabilidad(["Ana López"]);
    assert.equal(una.operable, false);
    assert.match(una.detalle, /Ana López/);
    assert.match(una.detalle, /otra, distinta/);
    const dos = relatoOperabilidad(["Bruno Díaz", "Ana López"]);
    assert.equal(dos.operable, true);
    assert.equal(dos.titulo, "Hay dos personas autorizadas.");
    assert.match(dos.detalle, /Ana López y Bruno Díaz pueden soltar dinero/);
    assert.match(lineaDeRol("liberador"), /Puede soltar dinero/);
    assert.equal(lineaDeRol("liberador").includes("Autorizada"), false);
  });
});

describe("alta de persona", () => {
  it("exige CLABE válida, centro y una fecha de alta real", () => {
    const errores = erroresDeAltaPersona(
      {
        nombre: "  ",
        alta: "2026-11-31",
        baja: "2026-11-01",
        centroId: "no",
        clabe: "002180701150123453",
        acceso: "nueva",
        correo: "mal",
        rol: "contador",
      },
      HOY,
    );
    const campos = errores.map((error) => error.campo);
    assert.ok(campos.includes("nombre"));
    assert.ok(campos.includes("alta"));
    assert.ok(campos.includes("centro"));
    assert.ok(campos.includes("clabe"));
    assert.ok(campos.includes("correo"));
    assert.equal(errores.some((error) => error.mensaje.includes("002180")), false);
  });

  it("admite contratación futura y tarjeta sin CLABE externa", () => {
    const resultado = validarAltaPersona(
      {
        nombre: "Persona futura",
        alta: "2026-12-01",
        baja: "",
        centroId: CENTRO,
        jefeId: "",
        presupuesto: "8000.00",
        destino: "tarjeta",
        clabe: "",
        acceso: "no",
      },
      HOY,
    );
    assert.equal(resultado.ok, true);
    if (resultado.ok) {
      assert.equal(resultado.valor.clabe, null);
      assert.equal(resultado.valor.destino, "tarjeta");
      assert.equal(resultado.valor.presupuestoCentavos, 800000);
    }
  });

  it("retira solicitante de nuevas altas sin tocar el rol histórico", () => {
    const resultado = validarAltaPersona(
      {
        nombre: "Persona histórica",
        alta: HOY,
        baja: "",
        centroId: CENTRO,
        jefeId: "",
        clabe: CLABE,
        acceso: "nueva",
        correo: "persona@ejemplo.mx",
        rol: "solicitante",
      },
      HOY,
    );
    assert.equal(resultado.ok, false);
    assert.equal(ROLES_VISIBLES.some((rol) => rol.valor === "solicitante"), false);
    assert.match(lineaDeRol("solicitante"), /Solicitante/);
  });

  it("admite Finanzas como acceso adicional, pero no como único rol de trabajo", () => {
    const base = {
      nombre: "Contadora Norte",
      alta: HOY,
      baja: "",
      centroId: CENTRO,
      jefeId: "",
      clabe: CLABE,
      acceso: "nueva",
      correo: "contadora@ejemplo.mx",
    };
    const valida = validarAltaPersona({ ...base, rol: ["contador", "finanzas"] }, HOY);
    assert.equal(valida.ok, true);
    if (valida.ok && valida.valor.acceso.tipo === "nueva") {
      assert.deepEqual(valida.valor.acceso.roles, ["contador", "finanzas"]);
    }
    const invalida = validarAltaPersona({ ...base, rol: "finanzas" }, HOY);
    assert.equal(invalida.ok, false);
    if (!invalida.ok) assert.equal(invalida.codigo, "finanzas_sin_rol");
  });

  it("guarda la CLABE completa cuando el dígito cierra y el contador no gana un permiso aparte", () => {
    const resultado = validarAltaPersona(
      {
        nombre: "  Contadora  Norte ",
        alta: HOY,
        baja: "",
        centroId: CENTRO,
        jefeId: "",
        clabe: "002 180 70115012345 2",
        acceso: "nueva",
        correo: "Contadora@Ejemplo.MX",
        rol: "contador",
      },
      HOY,
    );
    assert.equal(resultado.ok, true);
    if (resultado.ok && resultado.valor.acceso.tipo === "nueva") {
      assert.equal(resultado.valor.clabe, CLABE);
      assert.equal(resultado.valor.nombre, "Contadora Norte");
      assert.equal(resultado.valor.acceso.correo, "contadora@ejemplo.mx");
      assert.deepEqual(resultado.valor.acceso.roles, ["contador"]);
      assert.equal("puedeLiberar" in resultado.valor, false);
      assert.equal("puedeLiberar" in resultado.valor.acceso, false);
    }
  });

  it("cuenta la baja de hoy como baja, y una futura como vigente", () => {
    assert.equal(estaDeBaja("2026-11-03", HOY), true);
    assert.equal(estaDeBaja("2026-11-04", HOY), false);
    assert.equal(estaDeBaja(null, HOY), false);
  });

  it("usa el calendario de la Ciudad de México", () => {
    assert.equal(hoyEnMexico(new Date("2026-11-04T05:30:00.000Z")), "2026-11-03");
    assert.equal(hoyEnMexico(new Date("2026-11-04T06:00:00.000Z")), "2026-11-04");
  });

  it("guarda cada parte de la fecha y no borra el 31 de noviembre", () => {
    let valor = "";
    valor = fechaDesdePartes({ ...partesDeFecha(valor), dia: "3" });
    assert.deepEqual(partesDeFecha(valor), { dia: "3", mes: "", anio: "" });
    assert.equal(fechaValida(valor), null);

    valor = fechaDesdePartes({ ...partesDeFecha(valor), mes: "11" });
    assert.deepEqual(partesDeFecha(valor), { dia: "3", mes: "11", anio: "" });
    assert.equal(fechaValida(valor), null);

    valor = fechaDesdePartes({ ...partesDeFecha(valor), anio: "2026" });
    assert.equal(valor, HOY);
    assert.equal(fechaValida(valor), HOY);
    assert.equal(
      erroresDeAltaPersona({ alta: HOY, baja: valor }, HOY).some((error) => error.campo === "baja"),
      false,
    );

    valor = fechaDesdePartes({ ...partesDeFecha(valor), dia: "31" });
    assert.equal(valor, "2026-11-31");
    assert.deepEqual(partesDeFecha(valor), { dia: "31", mes: "11", anio: "2026" });
    assert.equal(fechaValida(valor), null);
    assert.equal(
      erroresDeAltaPersona({ alta: HOY, baja: valor }, HOY).some(
        (error) => error.campo === "baja" && error.mensaje === "Esa fecha no existe.",
      ),
      true,
    );

    valor = fechaDesdePartes({ ...partesDeFecha(valor), dia: "" });
    assert.deepEqual(partesDeFecha(valor), { dia: "", mes: "11", anio: "2026" });
    valor = fechaDesdePartes({ dia: "", mes: "", anio: "" });
    assert.equal(valor, "");
    assert.deepEqual(partesDeFecha("2026-02-31"), { dia: "31", mes: "02", anio: "2026" });
    assert.equal(fechaValida("2026-02-31"), null);

    const fuente = readFileSync(new URL("../components/personas/formularios.tsx", import.meta.url), "utf8");
    const inicio = fuente.indexOf("function FechaLegible");
    const fin = fuente.indexOf("\nfunction Campo");
    assert.equal(inicio >= 0 && fin > inicio, true);
    const cuerpo = fuente.slice(inicio, fin);
    assert.equal(cuerpo.includes('onChange("")'), false);
    assert.match(cuerpo, /fechaDesdePartes/);
    assert.match(cuerpo, /partesDeFecha/);
    assert.match(cuerpo, /Esa fecha no existe/);
  });

  it("la ficha ofrece Finanzas con la misma regla que el alta", () => {
    const base = { userId: "11111111-1111-4111-8111-111111111111", invitada: false, bajaEn: null };
    // El alta acepta tarjetahabiente + Finanzas; la ficha también ofrece la casilla.
    assert.equal(validarAltaPersona({
      nombre: "Ana Tarjeta", alta: HOY, baja: "", centroId: CENTRO, jefeId: "", clabe: CLABE,
      acceso: "nueva", correo: "ana@ejemplo.mx", rol: ["tarjetahabiente", "finanzas"],
    }, HOY).ok, true);
    assert.equal(accesoFinanzasDe({ ...base, roles: ["tarjetahabiente"] }, HOY), "casilla");
    assert.equal(accesoFinanzasDe({ ...base, roles: ["contador", "finanzas"] }, HOY), "casilla");
    assert.equal(accesoFinanzasDe({ ...base, roles: ["finanzas"] }, HOY), "casilla");
    assert.equal(accesoFinanzasDe({ ...base, roles: ["administrador"] }, HOY), "incluido");
    assert.equal(accesoFinanzasDe({ ...base, userId: null, roles: [] }, HOY), null);
    assert.equal(accesoFinanzasDe({ ...base, invitada: true, roles: ["contador"] }, HOY), null);
    assert.equal(accesoFinanzasDe({ ...base, bajaEn: HOY, roles: ["contador"] }, HOY), null);
  });

  it("conserva montado el aviso al otorgar o revocar Finanzas", () => {
    const fuente = readFileSync(new URL("../components/personas/maestro.tsx", import.meta.url), "utf8");
    assert.match(fuente, /key=\{persona\.userId\}/);
    assert.doesNotMatch(fuente, /key=\{`\$\{persona\.userId\}-\$\{persona\.roles\.includes\("finanzas"\)\}`\}/);
  });
});
