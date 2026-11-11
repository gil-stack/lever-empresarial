import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const RAIZ = path.resolve(import.meta.dirname, "..");

function archivosEn(directorio: string, extension: string): string[] {
  return readdirSync(directorio).flatMap((nombre) => {
    const ruta = path.join(directorio, nombre);
    if (statSync(ruta).isDirectory()) return archivosEn(ruta, extension);
    return ruta.endsWith(extension) ? [ruta] : [];
  });
}

/** Las clases de las reglas de CSS que desplazan su contenido: overflow y sus formas por eje (x, y, inline, block) con auto o scroll en cualquiera de sus valores. */
export function clasesQueDesplazan(css: string): Set<string> {
  const clases = new Set<string>();
  const sinComentarios = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const [, selectores, cuerpo] of sinComentarios.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/(^|[;\s{])overflow(-(x|y|inline|block))?\s*:[^;}]*\b(auto|scroll)\b/.test(cuerpo!)) continue;
    for (const selector of selectores!.split(",")) {
      // La clase del elemento que desplaza es la del último compuesto del selector (`.a .b:hover` → b).
      const ultimo = selector.trim().split(/[\s>+~]+/).at(-1) ?? "";
      for (const [, clase] of ultimo.matchAll(/\.([\w-]+)/g)) clases.add(clase!);
    }
  }
  return clases;
}

// Una etiqueta JSX de apertura o cierre, con atributos que pueden llevar llaves anidadas (hasta tres niveles).
const ETIQUETA = /<(\/?)([A-Za-z][\w.]*)((?:[^<>"'{}]|"[^"]*"|'[^']*'|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})*?)(\/?)>/g;
const esRegion = (etiqueta: string) => /\btabIndex=\{0\}/.test(etiqueta) && /\brole="region"/.test(etiqueta) && /\baria-label="Tabla de[^"]+"/.test(etiqueta);
const clasesDe = (etiqueta: string) => (/\bclassName=(?:"([^"]*)"|\{`([^`]*)`\})/.exec(etiqueta)?.slice(1).find(Boolean) ?? "").split(/\s+/).filter(Boolean);

export interface TablaVista { archivo: string; padre: string | null; problema: string | null }

/**
 * Cada <table> del archivo con su contenedor inmediato. Una tabla visible debe estar dentro de una región con nombre «Tabla de …» y
 * tabIndex 0 (su padre directo, sea un div o un componente), y ningún ancestro con una clase que desplace puede ser otro elemento: si
 * el que desplaza no es la región, el teclado no llega; tampoco puede desplazar la propia tabla. Solo se exceptúan las tablas
 * `solo-lector`, que no se ven ni se desplazan.
 *
 * Límite conocido: lo que no se lee de forma estática se le escapa (un `style` en línea, un `className` calculado o un selector de
 * CSS sin clase). La red en tiempo de ejecución es axe `scrollable-region-focusable` sobre las páginas de verdad: la e2e de
 * accesibilidad, la de cobranza a 390 (e2e 19) y el recorrido de evidencia.
 */
export function tablasDe(archivo: string, texto: string, desplazan: Set<string>): TablaVista[] {
  const pila: { nombre: string; etiqueta: string }[] = [];
  const tablas: TablaVista[] = [];
  for (const m of texto.matchAll(ETIQUETA)) {
    const [etiqueta, cierre, nombre, , solo] = m;
    if (cierre) {
      const i = pila.findLastIndex((e) => e.nombre === nombre);
      if (i >= 0) pila.length = i;
      continue;
    }
    if (nombre === "table") {
      const padre = pila.at(-1)?.etiqueta ?? null;
      let problema: string | null = null;
      if (!clasesDe(etiqueta).includes("solo-lector")) {
        if (!padre || !esRegion(padre)) problema = "su contenedor inmediato no es una región «Tabla de …» con tabIndex 0";
        const desplazante = pila.find((e) => clasesDe(e.etiqueta).some((c) => desplazan.has(c)) && e.etiqueta !== padre);
        if (!problema && desplazante) problema = `desplaza un ancestro que no es la región: ${desplazante.etiqueta.slice(0, 80)}`;
        if (!problema && clasesDe(etiqueta).some((c) => desplazan.has(c))) problema = "la propia tabla desplaza: el teclado no llega";
      }
      tablas.push({ archivo, padre, problema });
    }
    if (!solo) pila.push({ nombre: nombre!, etiqueta: etiqueta! });
  }
  return tablas;
}

const DESPLAZAN = new Set(archivosEn(path.join(RAIZ, "src"), ".css").flatMap((archivo) => [...clasesQueDesplazan(readFileSync(archivo, "utf8"))]));

describe("las tablas que se desplazan a lo ancho se alcanzan con el teclado (axe scrollable-region-focusable)", () => {
  it("el CSS que desplaza tablas se reconoce (overflow y sus formas por eje, de uno o dos valores, dentro de @media, en selectores compuestos)", () => {
    assert.ok(DESPLAZAN.has("tabla-contenedor"), [...DESPLAZAN].join(", "));
    const css = ".a { overflow-x: auto; } @media (max-width: 600px) { .b .c:hover, .d > .e { color: red; overflow: scroll } } .f { overflow: hidden }";
    assert.deepEqual([...clasesQueDesplazan(css)].sort(), ["a", "c", "e"]);
    const ejes = ".g{overflow-y:auto} .h { overflow-inline: scroll; } .i { overflow-block: auto } .j { overflow: hidden auto } .k { overflow: clip } .l { overflow-x: hidden }";
    assert.deepEqual([...clasesQueDesplazan(ejes)].sort(), ["g", "h", "i", "j"]);
  });

  it("la guardia ve las formas que se le escapaban (clase compuesta, otra clase que desplaza, componente, ancestro que desplaza)", () => {
    const desplazan = new Set(["tabla-contenedor", "cobranza-muestra"]);
    const casos: [string, boolean][] = [
      // La muestra del empate antes de r63g-N1: clase compuesta y sin región.
      ['<div className="tabla-contenedor cobranza-muestra">\n<table className="tabla" data-tabla="muestra"></table></div>', false],
      ['<div className="cobranza-muestra"><table></table></div>', false],
      ["<Desplazable><table></table></Desplazable>", false],
      ['<div className="cobranza-muestra"><div tabIndex={0} role="region" aria-label="Tabla de x"><table></table></div></div>', false],
      ["<section><table></table></section>", false],
      ['<div className="tabla-contenedor cobranza-muestra" tabIndex={0} role="region" aria-label="Tabla de la muestra"><table></table></div>', true],
      ['<Desplazable tabIndex={0} role="region" aria-label="Tabla de x" className={`tabla-contenedor ${extra}`}><table></table></Desplazable>', true],
      ['<div className="grafica"><table className="solo-lector"></table></div>', true],
      // La propia tabla con una clase que desplaza, aunque su padre sea la región.
      ['<div tabIndex={0} role="region" aria-label="Tabla de x"><table className="tabla cobranza-muestra"></table></div>', false],
    ];
    for (const [jsx, valida] of casos) {
      const [tabla] = tablasDe("prueba.tsx", jsx, desplazan);
      assert.equal(tabla?.problema === null, valida, `${jsx} → ${tabla?.problema}`);
    }
  });

  it("cada tabla del portal, de Operación y del muestrario está dentro de una región con nombre y tabIndex", () => {
    const tablas = archivosEn(path.join(RAIZ, "src"), ".tsx").flatMap((archivo) => tablasDe(path.relative(RAIZ, archivo), readFileSync(archivo, "utf8"), DESPLAZAN));
    // Sin la regla, a 390 (o con más columnas) la tabla desborda y quien usa el teclado no puede recorrerla.
    assert.ok(tablas.length >= 28, `${tablas.length} tablas`);
    assert.deepEqual(tablas.filter((t) => t.problema).map(({ archivo, problema }) => ({ archivo, problema })), []);
    const nombres = tablas.flatMap((t) => (t.padre ? [/aria-label="([^"]+)"/.exec(t.padre)?.[1]] : []));
    assert.equal(new Set(nombres).size, nombres.length, "cada región con su propio nombre");
  });
});
