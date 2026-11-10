import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { traducirErrorDeBase } from "../../nucleo/db.ts";
import type { ContextoDePersonal } from "../../nucleo/contexto.ts";
import { auditarOperacion, MOTIVO_MAXIMO_BITACORA } from "./auditar.ts";

const ctx = { personal: { operadorId: "o" }, persona: { id: "p" }, peticionId: "r" } as unknown as ContextoDePersonal;

// Doceava revisión (P2 del revisor de la base): la bitácora admite un motivo de 500 caracteres. Un motivo más largo se
// rechazaba en la base («La base no respondió») y se perdía lo escrito; ahora se rechaza antes, en su campo, sin truncar.
describe("motivo de la bitácora de Operación", () => {
  it("con más de 500 caracteres se rechaza antes de escribir; con 500, se escribe tal cual", async () => {
    const escritos: unknown[][] = [];
    const consulta = { query: async (_sql: string, valores: unknown[]) => { escritos.push(valores); return { rowCount: 1, rows: [] }; } };
    const evento = (motivo: string) => ({ companyId: null, accion: "alerta_cerrada" as const, identificador: "i", motivo, ocurridoEn: new Date() });
    assert.equal(MOTIVO_MAXIMO_BITACORA, 500);
    await assert.rejects(auditarOperacion(consulta as never, ctx, evento("x".repeat(501))), /motivo_largo/);
    // Cuenta caracteres, como `char_length`: 500 emojis son 1,000 unidades UTF-16 y sí caben.
    await auditarOperacion(consulta as never, ctx, evento("😀".repeat(500)));
    await auditarOperacion(consulta as never, ctx, evento("x".repeat(500)));
    assert.equal(escritos.length, 2);
    assert.equal(escritos[1]![7], "x".repeat(500));
  });

  it("si aun así la base lo rechaza, el aviso es del motivo y no «la base no respondió»", () => {
    const error = Object.assign(new Error("check"), { code: "23514", constraint: "audit_log_motivo_formato", table: "audit_log" });
    assert.equal((traducirErrorDeBase(error) as { codigo?: string }).codigo, "motivo_largo");
  });
});
