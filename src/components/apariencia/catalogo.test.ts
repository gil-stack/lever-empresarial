import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  acentoPorTema,
  CLAVES_TONO,
  COLOR_DESVANECIDO,
  coloresDe,
  darken,
  ESCENAS,
  esColorHex,
  esEscena,
  esTema,
  esTono,
  hex2,
  INDICE_SHADER,
  lum,
  mkPal,
  TEMAS,
  tonoDeEscena,
  tonoDelTema,
  TONOS,
} from "./catalogo.ts";
import { claveDe, guardarPreferencias, leerPreferencias, PREFERENCIAS_POR_DEFECTO, type Almacen } from "./preferencias.ts";

// Los valores esperados salen de correr las funciones originales del diseño (bloque MOTOR-APARIENCIA).
describe("funciones de color del diseño", () => {
  it("hex2 separa los tres canales", () => {
    assert.deepEqual(hex2("#FF5A4E"), [255, 90, 78]);
    assert.deepEqual(hex2("#0e0a08"), [14, 10, 8]);
  });

  it("lum es la luminancia relativa", () => {
    assert.equal(lum("#FFFFFF"), 1);
    assert.equal(lum("#000000"), 0);
    assert.equal(lum("#FF5A4E"), 0.2912238720475605);
    assert.equal(lum("#808080"), 0.21586050011389923);
  });

  it("darken multiplica cada canal por 1 - k", () => {
    assert.equal(darken("#FF5A4E", 0.3), "#b33f37");
    assert.equal(darken("#A79CFF", 0.55), "#4b4673");
    assert.equal(darken("#123456", 0), "#123456");
  });

  it("mkPal arma la paleta completa a partir de un color", () => {
    assert.deepEqual(mkPal("#7C6CFF"), {
      nombre: "Tu color",
      colores: ["#0c0b1a", "#342d6b", "#7C6CFF", "#eae7ff", "#e2dfff"],
      ui: "#9486ff",
    });
    assert.deepEqual(mkPal("#3CC48F").colores, ["#06140e", "#19523c", "#3CC48F", "#e0f6ed", "#d4f2e6"]);
    assert.equal(mkPal("#3CC48F").ui, "#5fcfa3");
  });
});

describe("acento por tema (applyPal del diseño)", () => {
  it("en oscuro usa el color de interfaz del tono", () => {
    assert.deepEqual(acentoPorTema("oscuro", "petroleoC"), {
      acento: "#FF5A4E",
      acentoRgb: "255,90,78",
      tinta: "#FFFFFF",
    });
    assert.deepEqual(acentoPorTema("oscuro", "arena"), { acento: "#E9DAC5", acentoRgb: "233,218,197", tinta: "#1A0705" });
  });

  it("en claro oscurece el acento hasta que contraste", () => {
    // Papel Lever en claro se pinta como Aluminio.
    assert.equal(acentoPorTema("claro", "petroleoC").acento, "#cc483e");
    assert.equal(acentoPorTema("claro", "aluminio").acento, "#cc483e");
    assert.equal(acentoPorTema("claro", "arena").acento, "#756d63");
    assert.equal(acentoPorTema("claro", "mio").acento, "#756db3");
    for (const tono of CLAVES_TONO) assert.ok(lum(acentoPorTema("claro", tono).acento) <= 0.18, tono);
  });

  it("en Lever el acento es el brillo del coral y el texto encima es oscuro", () => {
    for (const tono of CLAVES_TONO) {
      assert.deepEqual(acentoPorTema("lever", tono), { acento: "#FFE4DD", acentoRgb: "255,228,221", tinta: "#1A0705" });
    }
  });

  it("con color propio el acento sale de mkPal", () => {
    assert.equal(acentoPorTema("oscuro", "mio", "#3CC48F").acento, "#5fcfa3");
    assert.equal(acentoPorTema("oscuro", "mio").acento, TONOS.mio.ui);
  });
});

describe("tono con el que se pinta cada escena", () => {
  it("el tema Lever siempre pinta en coral", () => {
    for (const tono of CLAVES_TONO) assert.equal(tonoDelTema("lever", tono), "cohete");
  });

  it("Papel Lever en claro es Aluminio; los demás tonos se respetan", () => {
    assert.equal(tonoDelTema("claro", "petroleoC"), "aluminio");
    assert.equal(tonoDelTema("claro", "arena"), "arena");
    assert.equal(tonoDelTema("oscuro", "petroleoC"), "petroleoC");
  });

  it("Flujo con Papel Lever lleva Tinta Lever; si la persona eligió otro tono, se respeta", () => {
    assert.equal(tonoDeEscena("flujo", "oscuro", "petroleoC"), "grafito");
    assert.equal(tonoDeEscena("bruma", "oscuro", "petroleoC"), "petroleoC");
    assert.equal(tonoDeEscena("flujo", "oscuro", "arena"), "arena");
    assert.equal(tonoDeEscena("flujo", "claro", "petroleoC"), "aluminio");
    assert.equal(tonoDeEscena("flujo", "lever", "petroleoC"), "cohete");
  });

  it("coloresDe solo usa el color propio si es un hex válido", () => {
    assert.deepEqual(coloresDe("mio", "#3CC48F"), mkPal("#3CC48F"));
    assert.equal(coloresDe("mio", "verde"), TONOS.mio);
    assert.equal(coloresDe("arena", "#3CC48F"), TONOS.arena);
  });
});

describe("catálogo completo y sin duplicados", () => {
  it("seis escenas con nombre, descripción e índice de shader propio", () => {
    assert.deepEqual(
      ESCENAS.map((e) => e.clave),
      ["bruma", "cristal", "halo", "calma", "flujo", "duna"],
    );
    assert.equal(new Set(ESCENAS.map((e) => e.clave)).size, ESCENAS.length);
    assert.equal(new Set(ESCENAS.map((e) => e.nombre)).size, ESCENAS.length);
    for (const e of ESCENAS) {
      assert.ok(e.nombre && e.descripcion.endsWith("."), e.clave);
      assert.equal(typeof INDICE_SHADER[e.clave], "number");
    }
    assert.deepEqual(Object.keys(INDICE_SHADER).sort(), ESCENAS.map((e) => e.clave).sort());
    assert.equal(new Set(Object.values(INDICE_SHADER)).size, ESCENAS.length);
  });

  it("siete tonos de cinco colores hex válidos y nombres únicos", () => {
    assert.deepEqual(CLAVES_TONO, ["petroleoC", "grafito", "cohete", "blanco", "arena", "aluminio", "mio"]);
    assert.equal(new Set(CLAVES_TONO.map((k) => TONOS[k].nombre)).size, 7);
    for (const k of CLAVES_TONO) {
      assert.equal(TONOS[k].colores.length, 5, k);
      for (const c of [...TONOS[k].colores, TONOS[k].ui]) assert.ok(esColorHex(c), `${k} ${c}`);
    }
  });

  it("tres temas, cada uno con su color de desvanecido", () => {
    assert.deepEqual(
      TEMAS.map((t) => t.clave),
      ["claro", "oscuro", "lever"],
    );
    assert.deepEqual(Object.keys(COLOR_DESVANECIDO).sort(), ["claro", "lever", "oscuro"]);
  });

  it("los validadores rechazan claves ajenas, incluso las del prototipo", () => {
    assert.ok(esEscena("halo") && !esEscena("eclipse") && !esEscena(3));
    assert.ok(esTono("arena") && !esTono("toString") && !esTono(null));
    assert.ok(esTema("lever") && !esTema("cohete"));
    assert.ok(esColorHex("#A1b2C3") && !esColorHex("#abc") && !esColorHex("red"));
  });
});

class AlmacenFalso implements Almacen {
  datos = new Map<string, string>();
  getItem(clave: string) {
    return this.datos.get(clave) ?? null;
  }
  setItem(clave: string, valor: string) {
    this.datos.set(clave, valor);
  }
}

const almacenQueFalla: Almacen = {
  getItem() {
    throw new Error("SecurityError");
  },
  setItem() {
    throw new Error("QuotaExceededError");
  },
};

describe("preferencias de apariencia", () => {
  it("sin nada guardado devuelve los valores del diseño", () => {
    assert.deepEqual(leerPreferencias(undefined, new AlmacenFalso()), PREFERENCIAS_POR_DEFECTO);
    assert.deepEqual(PREFERENCIAS_POR_DEFECTO, {
      tema: "oscuro",
      escena: "bruma",
      tono: "petroleoC",
      luzDinamica: true,
      movimiento: true,
    });
  });

  it("guarda y lee por persona sin mezclar la de otra", () => {
    const almacen = new AlmacenFalso();
    const laura = { ...PREFERENCIAS_POR_DEFECTO, tema: "lever", escena: "halo", movimiento: false } as const;
    assert.equal(guardarPreferencias(laura, "laura", almacen), true);
    assert.deepEqual(leerPreferencias("laura", almacen), laura);
    assert.deepEqual(leerPreferencias("mateo", almacen), PREFERENCIAS_POR_DEFECTO);
    assert.ok(almacen.datos.has(claveDe("laura")));
  });

  it("cada campo inválido vuelve a su valor por defecto y conserva los válidos", () => {
    const almacen = new AlmacenFalso();
    almacen.setItem(
      claveDe(),
      JSON.stringify({ tema: "cohete", escena: "duna", tono: "toString", movimiento: "no", colorPropio: "#3CC48F" }),
    );
    assert.deepEqual(leerPreferencias(undefined, almacen), {
      ...PREFERENCIAS_POR_DEFECTO,
      escena: "duna",
      colorPropio: "#3CC48F",
    });
  });

  it("JSON dañado o almacenamiento bloqueado no rompe: usa los valores por defecto", () => {
    const almacen = new AlmacenFalso();
    almacen.setItem(claveDe(), "{no es json");
    assert.deepEqual(leerPreferencias(undefined, almacen), PREFERENCIAS_POR_DEFECTO);
    almacen.setItem(claveDe(), "[1,2]");
    assert.deepEqual(leerPreferencias(undefined, almacen), PREFERENCIAS_POR_DEFECTO);
    assert.deepEqual(leerPreferencias(undefined, almacenQueFalla), PREFERENCIAS_POR_DEFECTO);
    assert.deepEqual(leerPreferencias(undefined, null), PREFERENCIAS_POR_DEFECTO);
  });

  it("si el navegador no deja guardar, avisa con false en vez de lanzar", () => {
    assert.equal(guardarPreferencias(PREFERENCIAS_POR_DEFECTO, undefined, almacenQueFalla), false);
    assert.equal(guardarPreferencias(PREFERENCIAS_POR_DEFECTO, undefined, null), false);
  });

  it("con el almacenamiento del entorno (aquí, Node) lee los valores por defecto sin lanzar", () => {
    assert.deepEqual(leerPreferencias(), PREFERENCIAS_POR_DEFECTO);
  });
});
