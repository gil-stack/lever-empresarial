import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { DATOS_DEMO } from "../../dominio/demo";
import { COMPRAS_DE_OCTUBRE } from "../../dominio/demo/movimientos";
import { MODULOS_DEMO, PRODUCTOS } from "../../dominio/demo/productos";
import { cargaDemo } from "./regla";

/** Los nombres de ejemplo del diseño: la empresa, su gente, sus proveedores, comercios y vehículos. */
export const NOMBRES_DE_EJEMPLO = [
  "Altamar", "ALO180312AB1", "Daniela Ruiz", "Carlos Méndez", "Ana Torres", "Jorge Salas", "Eduardo",
  "Pacific Packaging", "Shenzhen Hengtai", "Logística Ibérica", "Northern Fleet", "Servicios Integrales Delta",
  "Fiesta Inn", "Empaques y Tarimas", "Grupo Comercial Delta", "Mantenimiento Industrial Lerma", "Home Depot",
  "Office Depot", "Pemex", "Aeroméxico", "Costco", "Amazon", "Sanborns", "Lever Silver", "Grupo Norte",
  "Expo Monterrey", "NLA-48-21", "Nissan", "Renault", "Google Workspace", "CONTPAQi", "BUK", "Santander", "BBVA",
] as const;

/** Lo que delata un dato de ejemplo: todo texto con una cifra (montos, folios, CLABE, fechas). */
function textosDeEjemplo(valor: unknown, salida: Set<string> = new Set()): Set<string> {
  if (typeof valor === "string" && /\d/.test(valor)) salida.add(valor);
  else if (Array.isArray(valor)) for (const hijo of valor) textosDeEjemplo(hijo, salida);
  else if (valor && typeof valor === "object") for (const hijo of Object.values(valor)) textosDeEjemplo(hijo, salida);
  return salida;
}

function congeladoEntero(valor: unknown): boolean {
  if (!valor || typeof valor !== "object") return true;
  return Object.isFrozen(valor) && Object.values(valor).every(congeladoEntero);
}

const DEMO = { demostracion: true } as const;
const REAL = { demostracion: false } as const;

describe("regla del modo demostración", () => {
  it("una empresa de demostración recibe los datos de ejemplo de cada módulo", () => {
    for (const modulo of MODULOS_DEMO) {
      const carga = cargaDemo(DEMO, modulo);
      assert.equal(carga.tipo, "demostracion", modulo);
      assert.equal(carga.tipo === "demostracion" && carga.datos, DATOS_DEMO[modulo]);
    }
  });

  it("una empresa real, sin empresa o con una marca que no es true recibe solo la línea de producto", () => {
    const casos = [REAL, null, undefined, { demostracion: 1 as unknown as boolean }, { demostracion: "true" as unknown as boolean }];
    for (const empresa of casos) {
      for (const modulo of MODULOS_DEMO) {
        const carga = cargaDemo(empresa, modulo);
        assert.deepEqual(carga, { tipo: "pronto", modulo, producto: PRODUCTOS[modulo] });
      }
    }
  });

  it("lo que llega a una empresa real no lleva ni una cifra ni un texto de ejemplo", () => {
    const ejemplo = textosDeEjemplo(DATOS_DEMO);
    assert.ok(ejemplo.size > 200, `se esperaban cientos de textos con cifra, hay ${ejemplo.size}`);
    for (const modulo of MODULOS_DEMO) {
      const json = JSON.stringify(cargaDemo(REAL, modulo));
      assert.equal(/\d/.test(json), false, `${modulo} lleva un dígito: ${json}`);
      for (const texto of [...ejemplo, ...NOMBRES_DE_EJEMPLO]) assert.equal(json.includes(texto), false, `${modulo} filtra «${texto}»`);
    }
  });

  it("los datos de ejemplo son de solo lectura", () => {
    assert.ok(congeladoEntero(DATOS_DEMO));
    const saldo = DATOS_DEMO.cuenta.saldoCentavos;
    try {
      (DATOS_DEMO.cuenta as { saldoCentavos: number }).saldoCentavos = 1;
    } catch {
      // En modo estricto la asignación lanza; fuera de él se ignora. En los dos casos no cambia.
    }
    assert.equal(DATOS_DEMO.cuenta.saldoCentavos, saldo);
  });

  it("las cifras de Gastos cuadran con las compras de octubre del diseño", () => {
    const total = COMPRAS_DE_OCTUBRE.reduce((suma, compra) => suma + compra.centavos, 0);
    assert.equal(total, DATOS_DEMO.gastos.gastadoCentavos);
    assert.equal(COMPRAS_DE_OCTUBRE.length, 34);
    const porDia = DATOS_DEMO.gastos.porDia.reduce<number>((suma, dia) => suma + (dia ?? 0), 0);
    assert.equal(porDia, total);
  });

  it("ningún componente de cliente importa los datos de ejemplo", () => {
    const raiz = join(process.cwd(), "src");
    const culpables: string[] = [];
    const recorrer = (dir: string) => {
      for (const nombre of readdirSync(dir)) {
        const ruta = join(dir, nombre);
        if (statSync(ruta).isDirectory()) recorrer(ruta);
        else if (/\.tsx?$/.test(nombre)) {
          const codigo = readFileSync(ruta, "utf8");
          if (/^["']use client["']/m.test(codigo) && /dominio\/demo(?!\/productos)/.test(codigo)) culpables.push(ruta);
        }
      }
    };
    recorrer(raiz);
    assert.deepEqual(culpables, []);
  });
});
