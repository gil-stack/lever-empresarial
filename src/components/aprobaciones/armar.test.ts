import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { capacidadesDe } from "../../nucleo/capacidades";
import { accionesPendientes, pendientesDeInicio, type PendienteInicio } from "../../dominio/inicio";
import type { PagoVista } from "../../dominio/pagos-vistas";
import { armarAprobaciones } from "./armar";

const YO = "11111111-1111-4111-8111-111111111111";
const OTRA = "22222222-2222-4222-8222-222222222222";

function pendiente(id: string, area: PendienteInicio["area"] = "operacion"): PendienteInicio {
  return { id, titulo: id, detalle: id, ruta: "/consola/proveedores", accion: "Abrir", area };
}

function pago(id: string, solicitadoPor: string, estado: PagoVista["estado"] = "por_autorizar"): PagoVista {
  return {
    id, payableId: `${id}-p`, supplierId: "s", proveedor: "Proveedor", rfc: "AAA010101AAA", referencia: "F-1",
    origen: "cfdi", cfdiUuid: null, totalCentavos: 100, emitidaEl: "2026-11-01", venceEl: "2026-11-30",
    programadaEl: "2026-11-20", estado, clabe: null, clabeFinal: "1234", solicitadoPor, solicitante: "Alguien",
    resueltoPor: null, motivoResolucion: null, motivoExcepcion: null, version: 1, bloqueo: null,
  };
}

const BANDEJA = [
  pendiente("pagos-por-autorizar"),
  pendiente("nomina-por-preparar"),
  pendiente("liberadores"),
  pendiente("presupuesto-area-a"),
  pendiente("centro", "configuracion"),
];

/** Cada pendiente de la bandeja aparece exactamente una vez en Aprobaciones. */
function lugares(armado: ReturnType<typeof armarAprobaciones>): string[] {
  return [
    ...(armado.pagos ? [armado.pagos.pendiente.id] : []),
    ...(armado.nomina ? [armado.nomina.pendiente.id] : []),
    ...armado.avisos.map((p) => p.id),
    ...armado.otros.map((p) => p.id),
  ];
}

describe("Aprobaciones reparte la bandeja de Pendientes", () => {
  it("con todo leído: pagos y nómina se deciden aquí, presupuestos son avisos y el resto va a otros", () => {
    const armado = armarAprobaciones({
      pendientes: BANDEJA,
      personaId: YO,
      pagos: { pagos: [pago("a", OTRA), pago("b", YO), pago("c", OTRA)], hayMas: false },
      fechaNomina: "2026-11-15",
    });
    assert.deepEqual(armado.pagos?.pagos.map((p) => p.id), ["a", "c"], "lo que pidió la misma persona lo decide otra");
    assert.equal(armado.nomina?.fecha, "2026-11-15");
    assert.deepEqual(armado.avisos.map((p) => p.id), ["presupuesto-area-a"]);
    assert.deepEqual(armado.otros.map((p) => p.id), ["liberadores", "centro"]);
    assert.equal(armado.total, BANDEJA.length);
    assert.deepEqual(lugares(armado).toSorted(), BANDEJA.map((p) => p.id).toSorted());
  });

  it("si no se pudieron leer los pagos ni la fecha de nómina, sus pendientes quedan como enlace (no se pierden)", () => {
    const armado = armarAprobaciones({ pendientes: BANDEJA, personaId: YO, pagos: null, fechaNomina: null });
    assert.equal(armado.pagos, null);
    assert.equal(armado.nomina, null);
    assert.ok(armado.otros.some((p) => p.id === "pagos-por-autorizar"));
    assert.ok(armado.otros.some((p) => p.id === "nomina-por-preparar"));
    assert.deepEqual(lugares(armado).toSorted(), BANDEJA.map((p) => p.id).toSorted());
  });

  it("si la lista ya no trae pagos de otra persona (alguien los decidió), el pendiente queda como enlace", () => {
    const armado = armarAprobaciones({
      pendientes: [pendiente("pagos-por-autorizar")],
      personaId: YO,
      pagos: { pagos: [pago("b", YO), pago("d", OTRA, "listo_para_pagar")], hayMas: false },
      fechaNomina: null,
    });
    assert.equal(armado.pagos, null);
    assert.deepEqual(armado.otros.map((p) => p.id), ["pagos-por-autorizar"]);
  });

  it("con más de una página de pagos, avisa que hay más aunque esta página no traiga de otra persona", () => {
    const armado = armarAprobaciones({
      pendientes: [pendiente("pagos-por-autorizar")],
      personaId: YO,
      pagos: { pagos: [pago("b", YO)], hayMas: true },
      fechaNomina: null,
    });
    assert.equal(armado.pagos?.hayMas, true);
    assert.deepEqual(armado.pagos?.pagos, []);
  });

  it("cuenta cada pago por autorizar: el lateral, Pendientes y la pestaña dicen el mismo número", () => {
    const datos = { centros: 1, personas: 1, liberadores: 2, categorias: 1, topesSinEscribir: 0, proveedores: 1, plan: "aceptada" as const, pagosPorAutorizar: 3, nominaPorPreparar: "2026-11-15" };
    const pendientes = pendientesDeInicio(datos, capacidadesDe({ rolesCliente: ["liberador"], rolesPlataforma: [] }));
    assert.deepEqual(pendientes.map((p) => [p.id, p.cantidad]), [["pagos-por-autorizar", 3], ["nomina-por-preparar", undefined]]);
    assert.equal(accionesPendientes(pendientes), 4);
    const armado = armarAprobaciones({ pendientes, personaId: YO, pagos: { pagos: [pago("a", OTRA), pago("b", OTRA), pago("c", OTRA)], hayMas: false }, fechaNomina: "2026-11-15" });
    assert.equal(armado.total, 4);
    assert.equal((armado.pagos?.pagos.length ?? 0) + (armado.nomina ? 1 : 0), 4, "las filas por decidir son las mismas cuatro acciones");
  });

  it("sin pendientes no inventa nada", () => {
    const armado = armarAprobaciones({ pendientes: [], personaId: YO, pagos: null, fechaNomina: "2026-11-15" });
    assert.deepEqual(armado, { pagos: null, nomina: null, avisos: [], otros: [], total: 0 });
  });
});

describe("Aprobaciones usa las acciones y reglas que ya existen", () => {
  const leer = (ruta: string) => readFileSync(new URL(`../../../${ruta}`, import.meta.url), "utf8");

  it("decide pagos con decidirPago de Proveedores (versión e importe vistos) y nómina con BotonPrepararNomina", () => {
    const decision = leer("src/components/aprobaciones/decision-pago.tsx");
    assert.match(decision, /import \{ decidirPago \} from "@\/app\/consola\/proveedores\/acciones-pagos"/);
    for (const campo of ["requestId", "version", "totalCentavos"]) assert.match(decision, new RegExp(`name="${campo}"`));
    assert.match(decision, /data-atajo="aprobar"/);
    assert.match(decision, /data-atajo="rechazar"/);
    // La fila decidida se desmonta en el mismo cuadro en que llega la respuesta: un efecto en la fila
    // nunca correría y la persona no vería «Decisión asentada». El aviso se enciende desde la acción.
    assert.match(decision, /const resultado = await decidirPago\(previo, datos\);\s+if \(resultado\.tipo === "listo"\) \{\s+setAbierto\(false\);\s+avisar\(/);
    assert.doesNotMatch(decision, /useEffect/);
    const vista = leer("src/components/aprobaciones/vista.tsx");
    assert.match(vista, /import \{ BotonPrepararNomina \} from "@\/components\/personas\/boton-preparar"/);
    // Igual que la decisión: tras preparar, la fila de nómina sale de Aprobaciones; abrir el lote no puede depender de un efecto.
    const boton = leer("src/components/personas/boton-preparar.tsx");
    assert.match(boton, /const resultado = await enviarPreparacionNomina\(previo, datos\);\s+if \(resultado\.tipo === "listo" && resultado\.id\) router\.push\(/);
    assert.doesNotMatch(boton, /useEffect/);
  });

  it("no escribe umbrales de doble firma que no existen", () => {
    for (const ruta of ["src/components/aprobaciones/vista.tsx", "src/components/aprobaciones/decision-pago.tsx", "src/app/consola/aprobaciones/page.tsx"]) {
      const fuente = leer(ruta);
      assert.equal(/50,000|umbral|segunda aprobación/i.test(fuente), false, ruta);
    }
  });

  it("conserva la alerta de faltante de Pendientes con su caso «no disponible»", () => {
    const pagina = leer("src/app/consola/aprobaciones/page.tsx");
    assert.match(pagina, /leerFaltanteParaPendientes/);
    const vista = leer("src/components/aprobaciones/vista.tsx");
    assert.match(vista, /data-alerta="faltante-no-disponible"/);
    assert.match(vista, /<AlertaFaltante/);
  });
});
