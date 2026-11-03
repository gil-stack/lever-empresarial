import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import type { AltaEmpresaEntrada, Empresa } from "../company/tipos";
import { ErrorDeDominio } from "../session/error-de-dominio";
import type { AltaCuenta, Sesion, SesionAbierta } from "../session/tipos";
import { completarAlta } from "./completar.ts";

const EMPRESA: AltaEmpresaEntrada = {
  rfc: "TCM010101AB1",
  razonSocial: "Escuela Kemper Urgate",
  codigoPostal: "06600",
  regimen: "601",
  usoCfdi: "G03",
};

const CUENTA: AltaCuenta = {
  nombre: "Copia TCM",
  correo: "copia@ejemplo.mx",
  contrasena: "clave-segura-12",
};

describe("un RFC ya registrado no deja sesión ni cuenta", () => {
  it("borra la persona recién creada y no devuelve cookie", async () => {
    const usuarios = new Set<string>();
    const id = randomUUID();
    let cerro = 0;
    const resultado = await completarAlta(null, CUENTA, EMPRESA, {
      abrirCuenta: async () => {
        usuarios.add(id);
        return abierta(id, "sesion=nueva");
      },
      entrar: async () => {
        throw new Error("no debía entrar");
      },
      darDeAltaEmpresa: async () => {
        throw new ErrorDeDominio("rfc_duplicado");
      },
      descartarCuentaSinEmpresa: async (userId) => {
        usuarios.delete(userId);
        return true;
      },
      cerrarSesion: async () => {
        cerro += 1;
        return { setCookie: "limpia" };
      },
    });
    assert.equal(resultado.tipo, "rechazo");
    if (resultado.tipo === "rechazo") {
      assert.equal(resultado.setCookie, null);
      assert.equal(resultado.cerrarCookie, false);
      assert.equal((resultado.error as ErrorDeDominio).codigo, "rfc_duplicado");
    }
    assert.equal(usuarios.size, 0);
    assert.equal(cerro, 0);
  });

  it("si el correo ya existe y el RFC es de otra cuenta, no deja la sesión abierta", async () => {
    const id = randomUUID();
    const vivos = new Set<string>([id]);
    const sesiones = new Set<string>(["vieja"]);
    const resultado = await completarAlta(null, CUENTA, EMPRESA, {
      abrirCuenta: async () => {
        throw new ErrorDeDominio("correo_duplicado");
      },
      entrar: async () => {
        sesiones.delete("vieja");
        sesiones.add("nueva");
        return abierta(id, "sesion=nueva");
      },
      darDeAltaEmpresa: async () => {
        throw new ErrorDeDominio("rfc_duplicado");
      },
      descartarCuentaSinEmpresa: async (userId) => {
        vivos.delete(userId);
        sesiones.clear();
        return true;
      },
      cerrarSesion: async (cookie) => {
        sesiones.delete(cookie);
        return { setCookie: "limpia" };
      },
    });
    assert.equal(resultado.tipo, "rechazo");
    if (resultado.tipo === "rechazo") assert.equal(resultado.setCookie, null);
    assert.equal(vivos.size, 0);
    assert.equal(sesiones.size, 0);
  });

  it("conserva la cookie si la cuenta ya tenía empresa", async () => {
    const id = randomUUID();
    let descarto = 0;
    const resultado = await completarAlta(null, CUENTA, EMPRESA, {
      abrirCuenta: async () => {
        throw new ErrorDeDominio("correo_duplicado");
      },
      entrar: async () => abierta(id, "sesion=ya-tenia"),
      darDeAltaEmpresa: async () => {
        throw new ErrorDeDominio("segunda_razon_social");
      },
      descartarCuentaSinEmpresa: async () => {
        descarto += 1;
        return false;
      },
    });
    assert.equal(resultado.tipo, "rechazo");
    if (resultado.tipo === "rechazo") {
      assert.equal(resultado.setCookie, "sesion=ya-tenia");
      assert.equal(resultado.cerrarCookie, false);
      assert.equal((resultado.error as ErrorDeDominio).codigo, "segunda_razon_social");
    }
    assert.equal(descarto, 0);
  });

  it("con sesión previa y RFC ajeno, cierra la cookie si la persona quedó sin empresa", async () => {
    const id = randomUUID();
    const sesion = sesionDe(id);
    let borrada = false;
    const resultado = await completarAlta(sesion, null, EMPRESA, {
      darDeAltaEmpresa: async () => {
        throw new ErrorDeDominio("rfc_duplicado");
      },
      descartarCuentaSinEmpresa: async () => {
        borrada = true;
        return true;
      },
      leerEmpresa: async () => null,
    });
    assert.equal(borrada, true);
    assert.equal(resultado.tipo, "rechazo");
    if (resultado.tipo === "rechazo") assert.equal(resultado.cerrarCookie, true);
  });

  it("no cierra la cookie de quien ya tiene empresa", async () => {
    const sesion = sesionDe(randomUUID());
    const resultado = await completarAlta(sesion, null, EMPRESA, {
      darDeAltaEmpresa: async () => {
        throw new ErrorDeDominio("rfc_duplicado");
      },
      descartarCuentaSinEmpresa: async () => false,
      leerEmpresa: async () => empresaDe(sesion.usuario.id),
    });
    if (resultado.tipo === "rechazo") assert.equal(resultado.cerrarCookie, false);
  });

  it("devuelve la cookie solo cuando la empresa quedó guardada", async () => {
    const id = randomUUID();
    const resultado = await completarAlta(null, CUENTA, EMPRESA, {
      abrirCuenta: async () => abierta(id, "sesion=nueva"),
      darDeAltaEmpresa: async () => empresaDe(id),
      descartarCuentaSinEmpresa: async () => {
        throw new Error("no debía descartar");
      },
    });
    assert.deepEqual(resultado, { tipo: "lista", setCookie: "sesion=nueva" });
  });
});

function abierta(id: string, setCookie: string): SesionAbierta {
  return { setCookie, sesion: sesionDe(id) };
}

function sesionDe(id: string): Sesion {
  return {
    id: randomUUID(),
    venceEn: new Date("2026-11-04T00:00:00.000Z"),
    usuario: { id, nombre: "Copia TCM", correo: "copia@ejemplo.mx" },
    companyId: null,
    rol: null,
  };
}

function empresaDe(id: string): Empresa {
  return {
    id,
    rfc: EMPRESA.rfc,
    razonSocial: EMPRESA.razonSocial,
    codigoPostal: EMPRESA.codigoPostal,
    regimen: EMPRESA.regimen,
    usoCfdi: EMPRESA.usoCfdi,
    altaEn: new Date("2026-11-03T15:00:00.000Z"),
  };
}
