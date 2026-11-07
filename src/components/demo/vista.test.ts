import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";

import { MODULOS_DEMO, PRODUCTOS } from "../../dominio/demo/productos";
import { CIFRAS_DE_EJEMPLO, NOMBRES_DE_EJEMPLO } from "../../server/demo/centinelas";
import { cargaDemo } from "../../server/demo/regla";
import { VistaDemo, type CargaDemoCualquiera } from "./vista";

const EMPRESA = "33333333-3333-4333-8333-333333333333";

function pintar(demostracion: boolean, modulo: (typeof MODULOS_DEMO)[number], params: Record<string, string> = {}): string {
  const carga = cargaDemo({ demostracion }, modulo) as CargaDemoCualquiera;
  return renderToStaticMarkup(createElement(VistaDemo, { carga, empresaId: EMPRESA, params }));
}

describe("módulos de demostración en el servidor", () => {
  for (const modulo of MODULOS_DEMO) {
    it(`${modulo}: una empresa real ve «Disponible pronto» sin cifras ni nombres de ejemplo`, () => {
      const html = pintar(false, modulo);
      assert.match(html, /Disponible pronto/);
      assert.ok(html.includes(PRODUCTOS[modulo].producto));
      const texto = html.replace(/<[^>]+>/g, " ");
      assert.equal(/\d/.test(texto), false, `lleva un dígito: ${texto}`);
      for (const centinela of [...NOMBRES_DE_EJEMPLO, ...CIFRAS_DE_EJEMPLO]) {
        assert.equal(html.includes(centinela), false, `filtra «${centinela}»`);
      }
      assert.equal(html.includes("Demostración"), false);
    });

    it(`${modulo}: una empresa de demostración ve el aviso y ningún botón de dinero encendido`, () => {
      const html = pintar(true, modulo);
      assert.match(html, /<strong>Demostración\.<\/strong>/);
      // Cada botón del módulo está apagado, salvo «Filtrar» de Movimientos, que solo filtra la lista.
      const botones = [...html.matchAll(/<button\b[^>]*>/g)].map((boton) => boton[0]);
      for (const boton of botones) {
        if (boton.includes('type="submit"')) continue;
        assert.match(boton, /disabled=""/, `botón encendido: ${boton}`);
      }
      assert.equal(/<form\b[^>]*method="post"/i.test(html), false, "un módulo demo no envía nada");
    });
  }

  it("Gastos pinta las cifras del diseño en la empresa de demostración", () => {
    const html = pintar(true, "gastos");
    assert.ok(html.includes("$98,422"));
    assert.ok(html.includes("+16% vs septiembre"));
    assert.ok(html.includes("Daniela Ruiz"));
  });

  it("Cuenta pinta el saldo exacto y la CLABE de ejemplo", () => {
    const html = pintar(true, "cuenta");
    assert.ok(html.includes("$1,284,560.40"));
    assert.ok(html.includes("718 180 00012345678 9"));
    assert.ok(html.includes("+$350,000.00"));
  });

  it("Movimientos filtra de verdad: Carlos Méndez en los últimos 7 días", () => {
    const html = pintar(true, "movimientos", { persona: "Carlos Méndez", periodo: "7" });
    assert.match(html, /5 compras con los filtros/);
    assert.equal(html.includes("Uber"), false);
    assert.ok(html.includes("AutoZone"));
  });

  it("Movimientos ignora valores de filtro que no existen", () => {
    const html = pintar(true, "movimientos", { persona: "<script>", agrupar: "otra" });
    assert.match(html, /34 compras con los filtros/);
    assert.equal(html.includes("<script>"), false);
  });

  it("Tarjetas cambia a Presupuestos por área con la dirección", () => {
    const html = pintar(true, "tarjetas", { vista: "presupuestos" });
    assert.ok(html.includes("Al ritmo actual se acaba el día 24"));
    assert.ok(html.includes("$215,000"));
  });
});
