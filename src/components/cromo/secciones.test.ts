import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { capacidadesDe, ROLES_CLIENTE, type RolCliente } from "../../nucleo/capacidades";
import { abreLaRuta, puertasDe } from "./puertas";
import { masDe, seccionActual, seccionesDe } from "./secciones";

const EMPRESA = "33333333-3333-4333-8333-333333333333";

function capacidades(rol: RolCliente) {
  return capacidadesDe({ rolesCliente: [rol], rolesPlataforma: [] });
}

function etiquetas(rol: RolCliente) {
  const puertas = puertasDe(capacidades(rol));
  return {
    grupos: seccionesDe(puertas, EMPRESA).map((grupo) => [grupo.titulo, grupo.secciones.map((seccion) => seccion.etiqueta)]),
    mas: masDe(puertas, EMPRESA).map((grupo) => [grupo.titulo, grupo.secciones.map((seccion) => seccion.etiqueta)]),
  };
}

describe("lateral con los grupos del diseño", () => {
  it("el administrador ve los grupos y el orden de NAV_MAIN, con el flujo de caja en su propio grupo", () => {
    assert.deepEqual(etiquetas("administrador").grupos, [
      ["Operación", ["Resumen", "Conciliación", "Aprobaciones", "Gastos", "Tarjetas", "Movimientos", "Fiscal"]],
      ["Flujo de caja", ["Saldo y alertas", "Cobros", "Calendario", "Presupuestos"]],
      ["Dinero", ["Cuenta", "Pagos internacionales", "Proveedores", "Nómina", "Crédito", "Inversión"]],
      ["Ocasionales", ["Viajes y proyectos", "Gasolina", "Ahorro"]],
    ]);
    assert.deepEqual(etiquetas("administrador").mas, [
      ["Tú", ["Mi perfil", "Apariencia", "Teléfono"]],
      ["Empresa", ["Configuración", "Políticas", "Integraciones"]],
    ]);
  });

  it("finanzas no ve Fiscal ni Proveedores ni Nómina, que su puerta no abre", () => {
    const { grupos } = etiquetas("finanzas");
    const todas = grupos.flatMap(([, secciones]) => secciones as string[]);
    for (const fuera of ["Fiscal", "Proveedores", "Nómina", "Conciliación"]) assert.equal(todas.includes(fuera), false, fuera);
    assert.ok(todas.includes("Saldo y alertas"));
  });

  it("cada enlace del lateral y de «Más» abre para ese rol: nadie ve una sección que le daría 404", () => {
    for (const rol of ROLES_CLIENTE) {
      const caps = capacidades(rol);
      const puertas = puertasDe(caps);
      for (const grupo of [...seccionesDe(puertas, EMPRESA), ...masDe(puertas, EMPRESA)]) {
        for (const seccion of grupo.secciones) {
          if (seccion.ruta === "/telefono") continue;
          assert.ok(abreLaRuta(caps, seccion.ruta as Parameters<typeof abreLaRuta>[1]), `${rol} ve ${seccion.ruta} y no la abre`);
          assert.equal(seccion.href, `/c/${EMPRESA}${seccion.ruta}`);
        }
      }
    }
  });

  it("las puertas de los módulos reales no cambian: cada uno sigue con su capacidad de siempre", () => {
    for (const rol of ROLES_CLIENTE) {
      const caps = capacidades(rol);
      const puertas = puertasDe(caps);
      const rutas = seccionesDe(puertas, EMPRESA).flatMap((grupo) => grupo.secciones.map((seccion) => seccion.ruta));
      const mas = masDe(puertas, EMPRESA).flatMap((grupo) => grupo.secciones.map((seccion) => seccion.ruta));
      assert.equal(rutas.includes("/consola"), puertas.resumen, `${rol}: Resumen`);
      assert.equal(rutas.includes("/consola/proveedores"), puertas.proveedores, `${rol}: Proveedores`);
      assert.equal(rutas.includes("/consola/personas/nomina"), puertas.maestro, `${rol}: Nómina`);
      assert.equal(rutas.includes("/consola/flujo"), puertas.flujo, `${rol}: Saldo y alertas`);
      assert.equal(rutas.includes("/consola/aprobaciones"), puertas.consola, `${rol}: Aprobaciones (antes Pendientes)`);
      assert.equal(mas.includes("/consola/politica"), puertas.politica, `${rol}: Políticas`);
      assert.equal(mas.includes("/consola/configuracion"), puertas.configuracion, `${rol}: Configuración`);
      // La 69-B y la Póliza viven dentro de Fiscal: quien abría alguna de las dos, ve Fiscal.
      assert.equal(rutas.includes("/consola/fiscal"), puertas.lista69b || puertas.poliza, `${rol}: Fiscal`);
    }
  });

  it("las rutas que viven dentro de una sección la marcan como actual", () => {
    const grupos = seccionesDe(puertasDe(capacidades("administrador")), EMPRESA);
    // Pendientes ya no se pinta: redirige a Aprobaciones.
    assert.equal(seccionActual(grupos, "/consola/aprobaciones")?.etiqueta, "Aprobaciones");
    assert.equal(seccionActual(grupos, "/consola/pendientes"), undefined);
    assert.equal(seccionActual(grupos, "/consola/lista-69b")?.etiqueta, "Fiscal");
    assert.equal(seccionActual(grupos, "/consola/poliza")?.etiqueta, "Fiscal");
    assert.equal(seccionActual(grupos, "/consola/personas")?.etiqueta, "Nómina");
    assert.equal(seccionActual(grupos, "/consola/gastos")?.etiqueta, "Gastos");
    assert.equal(seccionActual(grupos, "/consola/apariencia"), undefined);
  });
});
