import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { Consulta } from "../session/db";
import { ErrorDeDominio } from "../session/error-de-dominio";
import type { Sesion } from "../session/tipos";
import { auditarAlta, type EventoDeAuditoria } from "./auditar";
import { rechazoDeAlta } from "./decidir";
import { mapearEmpresa, SQL, type CuentaBloqueada, type RepositorioEmpresas } from "./repositorio";
import { darDeAltaEmpresa, leerEmpresa } from "./servicio";
import type { AltaEmpresaEntrada, Empresa } from "./tipos";
import { validarAlta } from "./validar";

describe("validación del alta", () => {
  it("acepta RFC de 12 o 13 con patrón, fecha, régimen y uso compatibles", () => {
    const moral = validarAlta(
      alta({
        rfc: " tcm-010101-ab1 ",
        razonSocial: "  Taller   Norte, S.A. de C.V. ",
        codigoPostal: "06 600",
        usoCfdi: "g03",
      }),
    );
    assert.equal(moral.ok, true);
    if (moral.ok) {
      assert.equal(moral.valor.rfc, "TCM010101AB1");
      assert.equal(moral.valor.razonSocial, "Taller Norte, S.A. de C.V.");
      assert.equal(moral.valor.codigoPostal, "06600");
      assert.equal(moral.valor.usoCfdi, "G03");
    }
    assert.equal(validarAlta(alta({ rfc: "ÑAB010101AB1" })).ok, true);
    assert.equal(validarAlta(alta({ rfc: "A&B010101AB1" })).ok, true);
    assert.equal(validarAlta(alta({ rfc: "ABC000229AB1" })).ok, true);
    assert.equal(validarAlta(alta({ rfc: "PELJ800101AB1", regimen: "612", usoCfdi: "G03" })).ok, true);
    assert.equal(validarAlta(alta({ rfc: "PELJ800101AB1", regimen: "605", usoCfdi: "CN01" })).ok, true);
    assert.equal(validarAlta(alta({ rfc: "PELJ800101AB1", regimen: "612", usoCfdi: "D01" })).ok, true);
    assert.equal(validarAlta(alta({ rfc: "TCM010101AB1", regimen: "622", usoCfdi: "G03" })).ok, true);
    assert.equal(validarAlta(alta({ rfc: "TCM010101AB1", regimen: "610", usoCfdi: "S01" })).ok, true);
    assert.equal(validarAlta(alta({ rfc: "PELJ800101AB1", regimen: "626", usoCfdi: "G03" })).ok, true);
    assert.equal(validarAlta(alta({ razonSocial: "A".repeat(254) })).ok, true);
  });

  it("rechaza patrón, fecha, genérico, código postal, régimen o uso que no cruzan", () => {
    assert.equal(codigoValidar(alta({ rfc: "NO" })), "rfc_invalido");
    assert.equal(codigoValidar(alta({ rfc: "ABC010101ABB" })), "rfc_invalido");
    assert.equal(codigoValidar(alta({ rfc: "ABC010229AB1" })), "rfc_invalido");
    assert.equal(codigoValidar(alta({ rfc: "ABC010431AB1" })), "rfc_invalido");
    assert.equal(codigoValidar(alta({ rfc: "XAXX010101000" })), "rfc_generico");
    assert.equal(codigoValidar(alta({ rfc: "xexx-010101-000" })), "rfc_generico");
    assert.equal(codigoValidar(alta({ razonSocial: "..." })), "razon_social_invalida");
    assert.equal(codigoValidar(alta({ razonSocial: "A".repeat(255) })), "razon_social_invalida");
    assert.equal(codigoValidar(alta({ razonSocial: "Taller\nNorte" })), "razon_social_invalida");
    assert.equal(codigoValidar(alta({ codigoPostal: "17000" })), "codigo_postal_invalido");
    assert.equal(codigoValidar(alta({ codigoPostal: "00000" })), "codigo_postal_invalido");
    assert.equal(codigoValidar(alta({ codigoPostal: "0660-0" })), "codigo_postal_invalido");
    assert.equal(codigoValidar(alta({ codigoPostal: "4410" })), "codigo_postal_invalido");
    assert.equal(codigoValidar(alta({ regimen: "612" })), "regimen_invalido");
    assert.equal(codigoValidar(alta({ rfc: "PELJ800101AB1", regimen: "601" })), "regimen_invalido");
    assert.equal(codigoValidar(alta({ rfc: "PELJ800101AB1", regimen: "622" })), "regimen_invalido");
    assert.equal(codigoValidar(alta({ usoCfdi: "D01" })), "uso_cfdi_invalido");
    assert.equal(codigoValidar(alta({ regimen: "610", usoCfdi: "G03" })), "uso_cfdi_invalido");
    assert.equal(codigoValidar(alta({ rfc: "PELJ800101AB1", regimen: "612", usoCfdi: "CN01" })), "uso_cfdi_invalido");
    assert.equal(codigoValidar(alta({ usoCfdi: "ZZZ" })), "uso_cfdi_invalido");
  });
});

describe("una sola razón social", () => {
  it("prioriza la cuenta sobre el RFC repetido de otra empresa", () => {
    assert.equal(rechazoDeAlta({ tieneEmpresa: true, rfcOcupado: true }), "segunda_razon_social");
    assert.equal(rechazoDeAlta({ tieneEmpresa: true, rfcOcupado: false }), "segunda_razon_social");
    assert.equal(rechazoDeAlta({ tieneEmpresa: false, rfcOcupado: true }), "rfc_duplicado");
    assert.equal(rechazoDeAlta({ tieneEmpresa: false, rfcOcupado: false }), null);
  });

  it("no admite un segundo RFC en la misma cuenta y aísla la lectura", async () => {
    const repo = memoria();
    const ana = randomUUID();
    const luis = randomUUID();
    repo.sembrar(ana);
    repo.sembrar(luis);
    const eventos: EventoDeAuditoria[] = [];
    const auditar = async (evento: EventoDeAuditoria, consulta: Consulta) => {
      eventos.push(evento);
      await consulta.query("insert into audit_events (company_id, actor, accion, entidad, identificador) values ($1, $2, $3, $4, $5)", [
        evento.companyId,
        evento.actorId,
        evento.accion,
        evento.entidad,
        evento.identificador,
      ]);
    };
    const primera = await darDeAltaEmpresa(sesionDe(ana), alta(), { repositorio: repo, auditar });
    assert.equal(primera.rfc, "TCM010101AB1");
    assert.equal(await codigo(darDeAltaEmpresa(sesionDe(ana), alta({ rfc: "ALT010101AB1" }), { repositorio: repo, auditar })), "segunda_razon_social");
    assert.equal(await codigo(darDeAltaEmpresa(sesionDe(ana), alta(), { repositorio: repo, auditar })), "segunda_razon_social");
    assert.equal(await codigo(darDeAltaEmpresa(sesionDe(luis), alta(), { repositorio: repo, auditar })), "rfc_duplicado");
    const segunda = await darDeAltaEmpresa(sesionDe(luis), alta({ rfc: "ALT010101AB1", razonSocial: "Luis Alma" }), {
      repositorio: repo,
      auditar,
    });

    const lecturas: string[] = [];
    const leerDeLaCuenta = repo.leerDeLaCuenta.bind(repo);
    repo.leerDeLaCuenta = async (userId: string) => {
      lecturas.push(userId);
      return leerDeLaCuenta(userId);
    };
    const sesionAjena = sesionDe(ana, segunda.id);
    const leida = await leerEmpresa(sesionAjena, { companyId: segunda.id, repositorio: repo });
    assert.equal(leida?.id, primera.id);
    assert.equal(leida?.rfc, "TCM010101AB1");
    assert.deepEqual(lecturas, [ana]);
    assert.equal(JSON.stringify(leida).includes(segunda.rfc), false);

    assert.equal(eventos.length, 2);
    assert.equal(eventos[0]?.accion, "alta_empresa");
    assert.equal(eventos[0]?.entidad, "companies");
    assert.equal(eventos[0]?.actorId, ana);
    assert.equal(eventos[0]?.companyId, primera.id);
    assert.equal(eventos[0]?.identificador, primera.id);
    assert.equal(eventos[0]?.ocurridoEn.getTime(), primera.altaEn.getTime());
    assert.deepEqual(Object.keys(eventos[0] ?? {}).sort(), [
      "accion",
      "actorId",
      "companyId",
      "entidad",
      "identificador",
      "ocurridoEn",
    ]);
    assert.equal(JSON.stringify(eventos[0]).includes("TCM010101AB1"), false);
    assert.equal(JSON.stringify(eventos[0]).includes("Taller"), false);
    assert.equal(repo.escrituras().some((sql) => sql.startsWith("insert into audit_events")), true);
  });

  it("deshace el alta si la auditoría falla y no publica la conexión", async () => {
    const repo = memoria();
    const userId = randomUUID();
    repo.sembrar(userId);
    const auditar = async (_evento: EventoDeAuditoria, consulta: Consulta) => {
      await consulta.query("insert into audit_events (id) values ($1)", ["x"]);
      throw new Error("fallo postgres://usuario:secreto@host/plataforma");
    };
    const error = await rechazo(darDeAltaEmpresa(sesionDe(userId), alta(), { repositorio: repo, auditar }));
    assert.equal(error.codigo, "auditoria_no_disponible");
    assert.equal(error.message.includes("postgres://"), false);
    assert.equal(error.cause, undefined);
    assert.equal(await repo.leerDeLaCuenta(userId), null);
    assert.deepEqual(repo.escrituras(), []);
  });

  it("no deja cerrar la transacción desde la auditoría", async () => {
    const repo = memoria();
    const userId = randomUUID();
    repo.sembrar(userId);
    const auditar = async (_evento: EventoDeAuditoria, consulta: Consulta) => {
      await consulta.query("COMMIT;");
    };
    assert.equal(
      await codigo(darDeAltaEmpresa(sesionDe(userId), alta(), { repositorio: repo, auditar })),
      "auditoria_no_disponible",
    );
    assert.equal(await repo.leerDeLaCuenta(userId), null);
  });

  it("no toca la base con una sesión o un RFC que no sirven", async () => {
    const repo = memoria();
    let bloqueos = 0;
    const original = repo.conCuenta.bind(repo);
    repo.conCuenta = (userId, fn) => {
      bloqueos += 1;
      return original(userId, fn);
    };
    assert.equal(await codigo(darDeAltaEmpresa(null, alta(), { repositorio: repo })), "sesion_ausente");
    assert.equal(
      await codigo(darDeAltaEmpresa(sesionDe("00000000-0000-0000-0000-000000000000"), alta(), { repositorio: repo })),
      "sesion_ausente",
    );
    assert.equal(await codigo(darDeAltaEmpresa(sesionDe(randomUUID()), alta({ rfc: "no" }), { repositorio: repo })), "rfc_invalido");
    assert.equal(bloqueos, 0);
    const userId = randomUUID();
    assert.equal(await codigo(darDeAltaEmpresa(sesionDe(userId), alta(), { repositorio: repo })), "usuario_ausente");
  });
});

describe("contrato con la base y la auditoría", () => {
  it("bloquea la cuenta, lee solo por el usuario y llama a registrarEvento", async () => {
    assert.match(SQL.bloquearCuenta, /for update/i);
    assert.equal(SQL.leerEmpresa.match(/\$\d+/g)?.join(","), "$1");
    assert.doesNotMatch(SQL.insertarMembresia, /administrador/);
    assert.match(SQL.insertarEmpresa, /razon_social/);
    assert.match(SQL.insertarEmpresa, /codigo_postal/);
    assert.match(SQL.insertarEmpresa, /uso_cfdi/);
    assert.match(SQL.insertarEmpresa, /alta_at/);
    const fuenteServicio = readFileSync(new URL("./servicio.ts", import.meta.url), "utf8");
    assert.equal(fuenteServicio.includes("entrada.rol"), false);
    assert.match(fuenteServicio, /leerDeLaCuenta\(userId\)/);
    assert.doesNotMatch(fuenteServicio, /leerDeLaCuenta\(opciones/);
    const fuenteAuditar = readFileSync(new URL("./auditar.ts", import.meta.url), "utf8");
    assert.match(fuenteAuditar, /import\("\.\.\/audit"\)/);
    assert.match(fuenteAuditar, /registrarEvento/);

    const evento: EventoDeAuditoria = {
      companyId: randomUUID(),
      actorId: randomUUID(),
      accion: "alta_empresa",
      entidad: "companies",
      identificador: randomUUID(),
      ocurridoEn: new Date("2026-11-03T15:00:00.000Z"),
    };
    const error = await rechazo(
      auditarAlta(evento, {
        async query() {
          return { rows: [], rowCount: 0 };
        },
      }),
    );
    assert.equal(error.codigo, "auditoria_no_disponible");
    assert.equal(error.message.includes("postgres://"), false);

    const empresa = mapearEmpresa({
      id: randomUUID(),
      rfc: "TCM010101AB1",
      razon_social: "Taller",
      codigo_postal: "06600",
      regimen: "601",
      uso_cfdi: "G03",
      alta_at: "2026-11-03T15:00:00.000Z",
      password_hash: "secreto",
      database_url: "postgres://no",
    });
    assert.equal(empresa.razonSocial, "Taller");
    assert.equal(JSON.stringify(empresa).includes("secreto"), false);
    assert.equal(JSON.stringify(empresa).includes("postgres"), false);
    assert.throws(
      () =>
        mapearEmpresa({
          id: 1,
          rfc: "postgres://secreto",
          razon_social: "A",
          codigo_postal: "06600",
          regimen: "601",
          uso_cfdi: "G03",
          alta_at: "no-es-fecha",
        }),
      (fallo: unknown) => fallo instanceof ErrorDeDominio && fallo.message === "base_no_disponible",
    );
  });
});

function alta(parcial: Partial<AltaEmpresaEntrada> = {}): AltaEmpresaEntrada {
  return {
    rfc: "TCM010101AB1",
    razonSocial: "Taller Norte, S.A. de C.V.",
    codigoPostal: "06600",
    regimen: "601",
    usoCfdi: "G03",
    ...parcial,
  };
}

function sesionDe(userId: string, companyId: string | null = null): Sesion {
  return {
    id: randomUUID(),
    venceEn: new Date("2026-11-04T10:00:00.000Z"),
    usuario: { id: userId, nombre: "Ana Pérez", correo: "ana@ejemplo.mx" },
    companyId,
    rol: null,
  };
}

type Estado = {
  usuarios: Set<string>;
  empresas: Map<string, Empresa>;
  porUsuario: Map<string, string>;
  porRfc: Map<string, string>;
  escrituras: string[];
};

function memoria(): RepositorioEmpresas & {
  sembrar: (userId: string) => void;
  escrituras: () => string[];
} {
  let estado: Estado = {
    usuarios: new Set(),
    empresas: new Map(),
    porUsuario: new Map(),
    porRfc: new Map(),
    escrituras: [],
  };
  const repo: RepositorioEmpresas & { sembrar: (userId: string) => void; escrituras: () => string[] } = {
    sembrar(userId) {
      estado.usuarios.add(userId);
    },
    escrituras() {
      return [...estado.escrituras];
    },
    leerDeLaCuenta(userId) {
      const companyId = estado.porUsuario.get(userId);
      return Promise.resolve(companyId ? (estado.empresas.get(companyId) ?? null) : null);
    },
    async conCuenta(userId, fn) {
      if (!estado.usuarios.has(userId)) throw new ErrorDeDominio("usuario_ausente");
      const respaldo = clonar(estado);
      const consulta: Consulta = {
        async query(sql) {
          estado.escrituras.push(sql);
          return { rows: [], rowCount: 0 };
        },
      };
      const cuenta: CuentaBloqueada = {
        tieneEmpresa: async () => estado.porUsuario.has(userId),
        rfcOcupado: async (rfc) => estado.porRfc.has(rfc),
        insertar: async (empresa) => {
          if (estado.porUsuario.has(userId)) throw new ErrorDeDominio("segunda_razon_social");
          if (estado.porRfc.has(empresa.rfc)) throw new ErrorDeDominio("rfc_duplicado");
          const fila: Empresa = { ...empresa, altaEn: new Date("2026-11-03T15:00:00.000Z") };
          estado.empresas.set(fila.id, fila);
          estado.porUsuario.set(userId, fila.id);
          estado.porRfc.set(fila.rfc, fila.id);
          return fila;
        },
        consulta,
      };
      try {
        return await fn(cuenta);
      } catch (error) {
        estado = respaldo;
        throw error;
      }
    },
  };
  return repo;
}

function clonar(estado: Estado): Estado {
  return {
    usuarios: new Set(estado.usuarios),
    empresas: new Map(estado.empresas),
    porUsuario: new Map(estado.porUsuario),
    porRfc: new Map(estado.porRfc),
    escrituras: [...estado.escrituras],
  };
}

function codigoValidar(entrada: AltaEmpresaEntrada): string {
  const resultado = validarAlta(entrada);
  return resultado.ok ? "ok" : resultado.codigo;
}

async function codigo(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
  } catch (error) {
    if (error instanceof ErrorDeDominio) return error.codigo;
    throw error;
  }
  throw new Error("la operación no rechazó");
}

async function rechazo(promesa: Promise<unknown>): Promise<ErrorDeDominio> {
  try {
    await promesa;
  } catch (error) {
    if (error instanceof ErrorDeDominio) return error;
    throw error;
  }
  throw new Error("la operación no rechazó");
}
