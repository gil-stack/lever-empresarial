import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { registrarEvento } from "./index.ts";
import * as modulo from "./index.ts";

const EMPRESA = "6f0d1c2a-7b3e-4d5f-8a91-0c2b4e6d8f10";
const ACTOR = "a1b2c3d4-e5f6-4789-a012-3456789abcde";
const HORA = new Date("2026-11-03T15:04:05.000Z");

const INSERT = `insert into audit_events (
  id,
  company_id,
  actor_id,
  accion,
  entidad,
  identificador,
  ocurrido_en
) values ($1, $2, $3, $4, $5, $6, $7)`;

type Llamada = { sql: string; params: readonly unknown[] };

function eventoValido(parcial: Record<string, unknown> = {}) {
  return {
    companyId: EMPRESA,
    actorId: ACTOR,
    accion: "alta_empresa" as const,
    entidad: "companies" as const,
    identificador: EMPRESA,
    ocurridoEn: HORA,
    ...parcial,
  };
}

function consultaQueAnota(llamadas: Llamada[]) {
  return {
    async query(sql: string, params: readonly unknown[]) {
      llamadas.push({ sql, params });
      return { rowCount: 1 };
    },
  };
}

describe("registrarEvento", () => {
  it("exporta exactamente registrarEvento", () => {
    assert.deepEqual(Object.keys(modulo).sort(), ["registrarEvento"]);
  });

  it("inserta quién, cuándo y los campos del alta en la misma consulta", async () => {
    const llamadas: Llamada[] = [];
    await registrarEvento(eventoValido(), consultaQueAnota(llamadas));

    assert.equal(llamadas.length, 1);
    const { sql, params } = llamadas[0];
    assert.equal(sql, INSERT);
    assert.equal(sql.includes(EMPRESA), false);
    assert.match(params[0], /^[0-9a-f-]{36}$/i);
    assert.deepEqual(params.slice(1), [
      EMPRESA,
      ACTOR,
      "alta_empresa",
      "companies",
      EMPRESA,
      HORA,
    ]);
    assert.equal((params[6] as Date).toISOString(), "2026-11-03T15:04:05.000Z");
    assert.equal(sql.toLowerCase().includes("update"), false);
    assert.equal(sql.toLowerCase().includes("delete"), false);
    assert.equal(sql.toLowerCase().includes("commit"), false);
  });

  it("acepta la hora como texto ISO y no deja que el llamador la cambie después", async () => {
    const llamadas: Llamada[] = [];
    const ocurridoEn = new Date("2026-11-03T15:04:05.000Z");
    await registrarEvento(eventoValido({ ocurridoEn }), consultaQueAnota(llamadas));
    ocurridoEn.setUTCFullYear(1999);

    const guardada = llamadas[0].params[6] as Date;
    assert.equal(guardada.toISOString(), "2026-11-03T15:04:05.000Z");
    assert.notEqual(guardada, ocurridoEn);

    const llamadasIso: Llamada[] = [];
    await registrarEvento(
      eventoValido({ ocurridoEn: "2026-11-03T18:00:00.000Z" }),
      consultaQueAnota(llamadasIso),
    );
    assert.equal(
      (llamadasIso[0].params[6] as Date).toISOString(),
      "2026-11-03T18:00:00.000Z",
    );
  });

  it("no guarda secretos, connection strings ni PAN, y el error no los repite", async () => {
    const secreto =
      "postgresql://usuario:supersecreto@ep-abc.us-east-1.aws.neon.tech/plataforma";
    const casos: Array<Record<string, unknown>> = [
      { actorId: secreto },
      { companyId: "postgres://usuario:clave@localhost/plataforma" },
      { identificador: "mysql://root:root@localhost:3306/plataforma" },
      { identificador: "mongodb+srv://user:pass@cluster.mongodb.net/plataforma" },
      { actorId: "redis://default:pass@localhost:6379" },
      {
        companyId:
          "Host=ep-abc.us-east-1.aws.neon.tech;Username=owner;Password=secreto;Database=plataforma",
      },
      { actorId: "postgres%3A%2F%2Fusuario%3Asecreto%40localhost%2Fplataforma" },
      { actorId: "4242424242424242" },
      { actorId: "$2b$12$abcdefghijklmnopqrstuv" },
      { ocurridoEn: `nota ${secreto}` },
      { url: secreto },
    ];

    for (const parcial of casos) {
      let consultas = 0;
      await assert.rejects(
        () =>
          registrarEvento(eventoValido(parcial), {
            query() {
              consultas += 1;
              return { rowCount: 1 };
            },
          }),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /^Auditoría rechazada: evento_con_secreto$/);
          const texto = `${error.message}\n${error.stack}`;
          assert.equal(texto.includes("supersecreto"), false);
          assert.equal(texto.includes("postgresql://"), false);
          assert.equal(texto.includes("postgres://"), false);
          assert.equal(texto.includes("4242424242424242"), false);
          assert.equal(texto.includes("Password"), false);
          return true;
        },
      );
      assert.equal(consultas, 0);
    }
  });

  it("no consulta si el evento no es el alta o la consulta no tiene query", async () => {
    let consultas = 0;
    const consulta = {
      query() {
        consultas += 1;
        return { rowCount: 1 };
      },
    };

    const invalidos: unknown[] = [
      eventoValido({ accion: "otra" }),
      eventoValido({ entidad: "users" }),
      eventoValido({ companyId: "" }),
      eventoValido({ actorId: "no-es-uuid" }),
      eventoValido({ identificador: EMPRESA.slice(0, 8) }),
      eventoValido({ ocurridoEn: "ayer" }),
      eventoValido({ ocurridoEn: new Date("no-es-fecha") }),
      eventoValido({ razonSocial: "Talleres del Norte, S.A. de C.V." }),
      null,
      ["alta"],
    ];

    for (const evento of invalidos) {
      await assert.rejects(
        () => registrarEvento(evento as never, consulta),
        /Auditoría rechazada: (evento_invalido|reloj_invalido)/,
      );
    }

    await assert.rejects(
      () => registrarEvento(eventoValido(), { query: "no" } as never),
      /Auditoría rechazada: consulta_invalida/,
    );
    assert.equal(consultas, 0);
  });

  it("deja pasar el error de la base para que la transacción pueda revertirse", async () => {
    await assert.rejects(
      () =>
        registrarEvento(eventoValido(), {
          query() {
            return Promise.reject(new Error("fallo de insert"));
          },
        }),
      /fallo de insert/,
    );
  });

  it("cada alta es una fila nueva", async () => {
    const llamadas: Llamada[] = [];
    const consulta = consultaQueAnota(llamadas);
    await registrarEvento(eventoValido(), consulta);
    await registrarEvento(
      eventoValido({ identificador: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }),
      consulta,
    );

    assert.equal(llamadas.length, 2);
    assert.notEqual(llamadas[0].params[0], llamadas[1].params[0]);
    assert.equal(llamadas[0].params[1], EMPRESA);
    assert.equal(llamadas[1].params[5], "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  });

  it("el fuente no lee el entorno ni escribe en consola", () => {
    const fuente = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    assert.equal(fuente.includes("process.env"), false);
    assert.equal(fuente.includes("DATABASE_URL"), false);
    assert.equal(fuente.includes("console."), false);
    assert.equal(fuente.includes("node:fs"), false);
    assert.equal(fuente.includes("node:net"), false);
  });
});
