import assert from "node:assert/strict";
import { test } from "node:test";
import { DIRECTORIO_MIGRACIONES, evaluarEsquema } from "./esquema.ts";
import type { Empresa, EventoDeAuditoria, LecturaDeNegocio } from "./interfaz.ts";
import { conEscenario, type ContextoAislamiento } from "./lector.ts";

/**
 * Fase 1. El libro guarda muchas empresas y cada cuenta es un RFC.
 * Listo cuando un segundo RFC no cabe en la misma cuenta: la sesión de A
 * no recibe la empresa B, ni aunque el navegador pida su id.
 *
 * Corre con `node --test tests/aislamiento/aislamiento.test.ts`.
 * Si db/migrations todavía no crea el cimiento, el reporte la marca
 * pendiente de esquema. No se omite y no se da por buena.
 *
 * Cuando el cimiento ya está, hace falta AISLAMIENTO_DATABASE_URL con un
 * Postgres desechable. La prueba crea una base, aplica las migraciones y
 * la borra. No usa DATABASE_URL: esa variable es el libro.
 */

const esquema = evaluarEsquema(DIRECTORIO_MIGRACIONES);

test(
  "el usuario de la empresa A no lee la empresa B",
  esquema.pendiente ? { todo: esquema.motivo } : {},
  async (t) => {
    if (esquema.pendiente) throw new Error(esquema.motivo);

    await conEscenario(DIRECTORIO_MIGRACIONES, async (ctx) => {
      const { lectura, libroSinFiltro, ids } = ctx;

      await t.test("el libro guarda las dos cuentas", async () => {
        assert.deepEqual(await libroSinFiltro.leerEmpresa(ids.empresaA), empresaA(ids));
        assert.deepEqual(await libroSinFiltro.leerEmpresa(ids.empresaB), empresaB(ids));
        assert.equal(
          await libroSinFiltro.existeEvento(ids.eventoB),
          true,
          "el acto de B tiene que estar guardado para que su ausencia en A sea aislamiento",
        );
      });

      await t.test("la sesión de A no lee B aunque el navegador pida su id", async () => {
        assert.equal(
          await lectura.leerEmpresa(ids.sesionA, ids.empresaB),
          null,
          "el id de B que manda el navegador no autoriza la lectura",
        );
      });

      await t.test("la sesión de A sí lee su propia empresa", async () => {
        assert.deepEqual(await lectura.leerEmpresa(ids.sesionA, ids.empresaA), empresaA(ids));
      });

      await t.test("el listado de A no incluye el RFC de B", async () => {
        assert.deepEqual(await lectura.listarEmpresas(ids.sesionA), [empresaA(ids)]);
      });

      await t.test("la auditoría de A no incluye los actos de B ni el del operador", async () => {
        const propia = await lectura.listarAuditoria(ids.sesionA, ids.empresaA);
        const ajena = await lectura.listarAuditoria(ids.sesionA, ids.empresaB);
        const todas = await lectura.listarAuditoria(ids.sesionA, null);
        assert.deepEqual(propia, [eventoA(ids)]);
        assert.deepEqual(ajena, []);
        assert.deepEqual(todas, [eventoA(ids)]);
        if (ids.eventoOperador) {
          // El plan permite company_id vacío en un acto del operador.
          // La fila se siembra cuando la columna lo acepta.
          assert.equal(
            todas.some((evento) => evento.id === ids.eventoOperador),
            false,
            "un acto del operador, sin empresa, no lo lee el usuario de A",
          );
        }
      });

      await t.test("la sesión de B no lee a A", async () => {
        assert.equal(await lectura.leerEmpresa(ids.sesionB, ids.empresaA), null);
        assert.deepEqual(await lectura.leerEmpresa(ids.sesionB, ids.empresaB), empresaB(ids));
        assert.deepEqual(await lectura.listarAuditoria(ids.sesionB, ids.empresaA), []);
      });

      await t.test("una sesión sin membresía no lee ninguna empresa", async () => {
        assert.equal(await lectura.leerEmpresa(ids.sesionSinMembresia, ids.empresaA), null);
        assert.equal(await lectura.leerEmpresa(ids.sesionSinMembresia, ids.empresaB), null);
        assert.deepEqual(await lectura.listarEmpresas(ids.sesionSinMembresia), []);
        assert.deepEqual(await lectura.listarAuditoria(ids.sesionSinMembresia, null), []);
      });

      await t.test("una sesión vencida o desconocida no lee", async () => {
        assert.equal(await lectura.leerEmpresa(ids.sesionAVencida, ids.empresaA), null);
        assert.deepEqual(await lectura.listarEmpresas(ids.sesionAVencida), []);
        assert.deepEqual(await lectura.listarAuditoria(ids.sesionAVencida, null), []);
        assert.equal(await lectura.leerEmpresa(ids.sesionFalsa, ids.empresaA), null);
        assert.equal(await lectura.leerEmpresa(ids.sesionFalsa, ids.empresaB), null);
      });

      await t.test("lo que recibe A no contiene el id, el RFC ni la razón social de B", async () => {
        const visto = await volcadoDe(lectura, ids.sesionA.tokenHash, ids);
        assert.equal(visto.includes(ids.empresaB), false);
        assert.equal(visto.includes(ids.rfcB), false);
        assert.equal(visto.includes(ids.razonB), false);
      });
    });
  },
);

function empresaA(ids: ContextoAislamiento["ids"]): Empresa {
  return { id: ids.empresaA, rfc: ids.rfcA, razonSocial: ids.razonA };
}

function empresaB(ids: ContextoAislamiento["ids"]): Empresa {
  return { id: ids.empresaB, rfc: ids.rfcB, razonSocial: ids.razonB };
}

function eventoA(ids: ContextoAislamiento["ids"]): EventoDeAuditoria {
  return { id: ids.eventoA, companyId: ids.empresaA, accion: "alta_empresa" };
}

async function volcadoDe(
  lectura: LecturaDeNegocio,
  tokenHash: string,
  ids: ContextoAislamiento["ids"],
): Promise<string> {
  const sesion = { tokenHash };
  const visto = {
    pedida: await lectura.leerEmpresa(sesion, ids.empresaB),
    propia: await lectura.leerEmpresa(sesion, ids.empresaA),
    empresas: await lectura.listarEmpresas(sesion),
    auditoriaAjena: await lectura.listarAuditoria(sesion, ids.empresaB),
    auditoriaPropia: await lectura.listarAuditoria(sesion, null),
  };
  return JSON.stringify(visto);
}
