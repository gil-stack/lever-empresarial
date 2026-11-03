import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readFileSync } from "node:fs";

import {
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
  puedeSoltarDinero,
  relatoOperabilidad,
  validarAltaPersona,
} from "./personas.ts";

const HOY = "2026-11-03";
const CENTRO = "11111111-1111-4111-8111-111111111111";
const CLABE = "002180701150123452";

describe("dos firmas y el contador", () => {
  it("solo el liberador suelta dinero, y una sola persona no deja operable la empresa", () => {
    assert.equal(puedeSoltarDinero("liberador"), true);
    assert.equal(puedeSoltarDinero("contador"), false);
    assert.equal(puedeSoltarDinero("administrador"), false);
    assert.equal(puedeSoltarDinero("solicitante"), false);
    assert.equal(puedeSoltarDinero("tarjetahabiente"), false);
    assert.equal(puedeSoltarDinero(null), false);
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
      decidirLiberacion({ rol: "contador", deBaja: false, autorizados: 2, actorId: actor }),
      "sin_accion_de_liberar",
    );
    assert.equal(
      decidirLiberacion({ rol: "administrador", deBaja: false, autorizados: 2, actorId: actor }),
      "sin_accion_de_liberar",
    );
    assert.equal(
      decidirLiberacion({ rol: "liberador", deBaja: true, autorizados: 2, actorId: actor }),
      "sin_accion_de_liberar",
    );
    assert.equal(
      decidirLiberacion({ rol: "liberador", deBaja: false, autorizados: 1, actorId: actor }),
      "empresa_no_operable",
    );
    assert.equal(
      decidirLiberacion({
        rol: "liberador",
        deBaja: false,
        autorizados: 2,
        actorId: actor,
        otraFirmaId: actor.toUpperCase(),
      }),
      "misma_firma",
    );
    assert.equal(
      decidirLiberacion({
        rol: "liberador",
        deBaja: false,
        autorizados: 2,
        actorId: actor,
      }),
      "misma_firma",
    );
    assert.equal(
      decidirLiberacion({
        rol: "liberador",
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
  it("exige CLABE válida, centro y un alta que no sea futura", () => {
    const errores = erroresDeAltaPersona(
      {
        nombre: "  ",
        alta: "2026-11-04",
        baja: "2026-11-01",
        centroId: "no",
        clabe: "002180701150123453",
        acceso: "nueva",
        correo: "mal",
        contrasena: "corta",
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
    assert.ok(campos.includes("contrasena"));
    assert.equal(errores.some((error) => error.mensaje.includes("002180")), false);
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
        contrasena: "una frase larga",
        rol: "contador",
      },
      HOY,
    );
    assert.equal(resultado.ok, true);
    if (resultado.ok && resultado.valor.acceso.tipo === "nueva") {
      assert.equal(resultado.valor.clabe, CLABE);
      assert.equal(resultado.valor.nombre, "Contadora Norte");
      assert.equal(resultado.valor.acceso.correo, "contadora@ejemplo.mx");
      assert.equal(resultado.valor.acceso.rol, "contador");
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
});
