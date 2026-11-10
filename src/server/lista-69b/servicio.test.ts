import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Fila69b } from "../../dominio/lista-69b.ts";
import { capacidadesDe, type RolCliente } from "../../nucleo/capacidades.ts";
import type { ContextoDeTenant } from "../../nucleo/contexto.ts";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio.ts";
import type { OrigenListado } from "./descargar.ts";
import type { Repositorio69b, Snapshot69b } from "./repositorio.ts";
import { consultarRfc, guardarListado69b, leerVista69b } from "./servicio.ts";

const AHORA = new Date("2026-11-04T18:30:00.000Z");
const COPIA = "33333333-3333-4333-8333-333333333333";
const EMPRESA = "11111111-1111-4111-8111-111111111111";
const PERSONA = "22222222-2222-4222-8222-222222222222";
const OPERADOR = "66666666-6666-4666-8666-666666666666";
const OTRO_OPERADOR = "77777777-7777-4777-8777-777777777777";

const HTML = `
  <p>Artículo 69-B del Código Fiscal de la Federación</p>
  <strong>Información actualizada al 30 de septiembre de 2026.</strong>
  <a href="https://archivos.example/Listado_completo_69-B.csv">Listado completo</a>
  <p>Artículo 69-B Bis</p>
  <a href="https://archivos.example/bis.csv">Listado completo</a>
`;

const CSV = [
  "Información actualizada al 30 de septiembre de 2026",
  "No,RFC,Nombre del Contribuyente,Situación del contribuyente",
  "1,PAL7202161U0,UNO,Definitivo",
  "2,PAL7202161U0,UNO,Definitivo",
  "3,CABL840215RF4,DOS,Presunto",
].join("\n");

describe("la copia y la consulta", () => {
  it("sin copia no hay pago, aunque el RFC sea válido", async () => {
    const libro = memoria();
    const vista = await leerVista69b(cliente("administrador"), "PAL7202161U0", {
      repositorio: libro.repo,
      ahora: () => AHORA,
    });
    assert.equal(vista.fechaTexto, null);
    assert.equal(vista.puedeGuardar, false);
    assert.equal(vista.resultado?.bloqueado, true);
    assert.equal(vista.resultado?.frase, "El proveedor puede existir. El pago no.");
    assert.equal(vista.resultado?.decision.listaPermitePago, false);
  });

  it("guarda la fecha del archivo y bloquea solo a quien aparece", async () => {
    const libro = memoria();
    const guardado = await guardarListado69b(personal(), {
      repositorio: libro.repo,
      origen: origen(CSV),
      ahora: () => AHORA,
      id: () => COPIA,
    });
    assert.equal(guardado.fechaTexto, "30 de septiembre de 2026");
    assert.equal(guardado.contribuyentesTexto, "2");
    assert.equal(libro.guardados, 1);

    const publicado = await consultarRfc("pal 720216 1u0", OPERADOR, { repositorio: libro.repo });
    assert.equal(publicado.tipo, "lista");
    if (publicado.tipo !== "lista") return;
    assert.equal(publicado.rfc, "PAL7202161U0");
    assert.equal(publicado.bloqueado, true);
    assert.deepEqual(publicado.situaciones, ["Definitivo"]);
    assert.equal(publicado.frase, "El proveedor puede existir. El pago no.");

    const limpio = await consultarRfc("EKU9003173C9", OPERADOR, { repositorio: libro.repo });
    assert.equal(limpio.tipo, "lista");
    if (limpio.tipo !== "lista") return;
    assert.equal(limpio.bloqueado, false);
    assert.equal(limpio.decision.listaPermitePago, true);
    assert.equal(limpio.situaciones.length, 0);

    const vista = await leerVista69b(cliente("contador"), "CABL840215RF4", {
      repositorio: libro.repo,
      ahora: () => AHORA,
    });
    assert.equal(vista.fechaTexto, "30 de septiembre de 2026");
    assert.equal(vista.puedeGuardar, false);
    assert.equal(vista.contribuyentesTexto, "2");
    assert.deepEqual(vista.resultado?.situaciones, ["Presunto"]);
    assert.match(vista.consultaTexto, /hora del centro de México/);
  });

  it("no guarda si la fecha de la página y la del archivo no coinciden", async () => {
    const libro = memoria();
    const distinto = CSV.replace("30 de septiembre de 2026", "1 de enero de 2026");
    await assert.rejects(
      () =>
        guardarListado69b(personal(), {
          repositorio: libro.repo,
          origen: origen(distinto),
          ahora: () => AHORA,
          id: () => COPIA,
        }),
      (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "fechas_distintas",
    );
    assert.equal(libro.guardados, 0);
    assert.equal(await libro.repo.vigente(OPERADOR), null);
  });

  it("el contador no guarda y el tarjetahabiente no abre la lista", async () => {
    const libro = memoria();
    await assert.rejects(
      () => guardarListado69b(cliente("contador"), { repositorio: libro.repo, origen: origen(CSV) }),
      (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "no_es_operador",
    );
    await assert.rejects(
      () => leerVista69b(cliente("tarjetahabiente"), null, { repositorio: libro.repo }),
      (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "sin_permiso",
    );
    const solicitante = await leerVista69b(cliente("solicitante"), null, { repositorio: libro.repo });
    assert.equal(solicitante.puedeGuardar, false);
    const invalido = await consultarRfc("XAXX010101000", OPERADOR, { repositorio: libro.repo });
    assert.equal(invalido.tipo, "invalida");
  });

  it("la copia más reciente es la que se consulta", async () => {
    const libro = memoria();
    await guardarListado69b(personal(), {
      repositorio: libro.repo,
      origen: origen(CSV),
      ahora: () => new Date("2026-10-01T12:00:00.000Z"),
      id: () => COPIA,
    });
    const segunda = "44444444-4444-4444-8444-444444444444";
    const otro = CSV.replace("Presunto", "Desvirtuado").replace("30 de septiembre de 2026", "30 de septiembre de 2026");
    await guardarListado69b(personal(), {
      repositorio: libro.repo,
      origen: origen(otro),
      ahora: () => AHORA,
      id: () => segunda,
    });
    const vigente = await libro.repo.vigente(OPERADOR);
    assert.equal(vigente?.id, segunda);
    const consulta = await consultarRfc("CABL840215RF4", OPERADOR, { repositorio: libro.repo });
    assert.equal(consulta.tipo, "lista");
    if (consulta.tipo !== "lista") return;
    assert.deepEqual(consulta.situaciones, ["Desvirtuado"]);
  });
});

describe("la copia es de cada operador", () => {
  it("la copia que carga otro operador no la ve ni la usa el portal de este", async () => {
    const libro = memoria();
    await guardarListado69b(personal(OTRO_OPERADOR), {
      repositorio: libro.repo,
      origen: origen(CSV),
      ahora: () => AHORA,
      id: () => COPIA,
    });
    const vista = await leerVista69b(cliente("administrador"), "PAL7202161U0", { repositorio: libro.repo, ahora: () => AHORA });
    assert.equal(vista.fechaTexto, null);
    assert.deepEqual(vista.resultado?.situaciones, []);
    const propia = await leerVista69b(personal(OTRO_OPERADOR), "PAL7202161U0", { repositorio: libro.repo, ahora: () => AHORA });
    assert.deepEqual(propia.resultado?.situaciones, ["Definitivo"]);
  });
});

function origen(csv: string): OrigenListado {
  return {
    async leerPagina() {
      return HTML;
    },
    async leerArchivo(url) {
      assert.equal(url, "https://archivos.example/Listado_completo_69-B.csv");
      return new TextEncoder().encode(csv);
    },
  };
}

function base(roles: RolCliente[], plataforma: boolean, operadorId = OPERADOR): ContextoDeTenant {
  return {
    sesionId: "55555555-5555-4555-8555-555555555555",
    peticionId: null,
    superficie: plataforma ? "sofipo" : "cliente",
    persona: { id: PERSONA, nombre: "Ana", correo: "ana@ejemplo.test" },
    segundoFactor: "totp",
    empresa: plataforma
      ? null
      : {
          id: EMPRESA,
          rfc: "EKU9003173C9",
          razonSocial: "Escuela",
          operadorId,
          estado: "activa",
          demostracion: true,
        },
    roles,
    personal: plataforma
      ? { operadorId, roles: ["administracion_plataforma"] }
      : null,
    empresas: [],
    capacidades: capacidadesDe({
      rolesCliente: plataforma ? [] : roles,
      rolesPlataforma: plataforma ? ["administracion_plataforma"] : [],
    }),
  };
}

function cliente(rol: RolCliente): ContextoDeTenant {
  return base([rol], false);
}

function personal(operadorId = OPERADOR): ContextoDeTenant {
  return base([], true, operadorId);
}

function memoria(): { repo: Repositorio69b; guardados: number } {
  const snapshots: Array<Snapshot69b & { operadorId: string }> = [];
  const filas: { snapshotId: string; fila: Fila69b }[] = [];
  const estado = { guardados: 0 };
  const repo: Repositorio69b = {
    async vigente(operadorId) {
      const orden = snapshots
        .filter((copia) => copia.operadorId === operadorId)
        .sort((a, b) => b.cargadoEn.getTime() - a.cargadoEn.getTime());
      const [vigente] = orden;
      return vigente ? { id: vigente.id, fechaArchivo: vigente.fechaArchivo, cargadoEn: vigente.cargadoEn, contribuyentes: vigente.contribuyentes } : null;
    },
    async situaciones(operadorId, snapshotId, rfc) {
      if (!snapshots.some((copia) => copia.id === snapshotId && copia.operadorId === operadorId)) return [];
      return filas
        .filter((fila) => fila.snapshotId === snapshotId && fila.fila.rfc === rfc)
        .map((fila) => fila.fila.situacion)
        .sort((a, b) => a.localeCompare(b, "es"));
    },
    async guardar(ctx, entrada) {
      const contribuyentes = new Set(entrada.filas.map((fila) => fila.rfc)).size;
      snapshots.push({
        operadorId: ctx.personal.operadorId,
        id: entrada.id,
        fechaArchivo: entrada.fechaArchivo,
        cargadoEn: entrada.cargadoEn,
        contribuyentes,
      });
      for (const fila of entrada.filas) filas.push({ snapshotId: entrada.id, fila });
      estado.guardados += 1;
    },
  };
  return { repo, get guardados() { return estado.guardados; } };
}
