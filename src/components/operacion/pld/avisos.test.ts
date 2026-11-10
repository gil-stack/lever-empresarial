import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AvisoOperacion, avisoConocido, errorDelCampo, tonoDelAviso } from "../aviso.tsx";
import { ASENTADOS_PLD, CAMPO_PLD, MENSAJES_PLD, VISIBLES_FUERA_DE_CUMPLIMIENTO } from "./avisos.ts";

const FUENTE_AVISO = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../aviso.tsx"), "utf8");

/** Las llaves propias de un diccionario de aviso.tsx, antes de su spread de PLD. */
function llavesDe(constante: string, spread: string): string[] {
  const inicio = FUENTE_AVISO.indexOf(`const ${constante}`);
  const fin = FUENTE_AVISO.indexOf(spread, inicio);
  assert.ok(inicio >= 0 && fin > inicio, `${constante} lleva su spread ${spread}`);
  const bloque = FUENTE_AVISO.slice(inicio, fin);
  return [...bloque.matchAll(/^\s{2}"?([a-z0-9_]+)"?[:,]/gim)].map((m) => m[1]!);
}

describe("avisos de PLD dentro de aviso.tsx", () => {
  it("ninguna llave de PLD pisa una que ya existía", () => {
    const propias = { MENSAJES: llavesDe("MENSAJES", "...MENSAJES_PLD"), CAMPO: llavesDe("CAMPO", "...CAMPO_PLD"), ASENTADOS: llavesDe("ASENTADOS", "...ASENTADOS_PLD") };
    assert.ok(propias.MENSAJES.length > 100 && propias.CAMPO.length > 10 && propias.ASENTADOS.length > 20);
    assert.deepEqual(Object.keys(MENSAJES_PLD).filter((llave) => propias.MENSAJES.includes(llave)), []);
    assert.deepEqual(Object.keys(CAMPO_PLD).filter((llave) => propias.CAMPO.includes(llave)), []);
    assert.deepEqual(ASENTADOS_PLD.filter((llave) => propias.ASENTADOS.includes(llave)), []);
  });

  it("lo hecho se anuncia como asentado y lo demás como algo por revisar", () => {
    for (const codigo of ASENTADOS_PLD) {
      assert.ok(MENSAJES_PLD[codigo], codigo);
      assert.equal(tonoDelAviso(codigo), "asentado", codigo);
    }
    for (const codigo of ["pld_sesion_sin_quorum", "pld_dictamen_fuera_de_plazo", "pld_reporte_fuera_de_plazo", "comite_sin_oficial"]) {
      assert.equal(tonoDelAviso(codigo), "revisar", codigo);
    }
    const html = renderToStaticMarkup(createElement(AvisoOperacion, { codigo: "perfil_declarado" }));
    assert.match(html, /Perfil transaccional registrado/);
    assert.deepEqual(errorDelCampo("folio_repetido", "folio"), { "aria-invalid": true, "aria-describedby": "aviso-operacion-campo", autoFocus: true });
    assert.deepEqual(errorDelCampo("dato_invalido_pagosMonto", "pagosMonto"), { "aria-invalid": true, "aria-describedby": "aviso-operacion-campo", autoFocus: true });
    // Las identidades del Comité con un carácter invisible tienen su aviso y marcan su campo.
    for (const campo of ["nombres", "primerApellido", "segundoApellido", "area", "cargoEntidad"]) {
      assert.match(renderToStaticMarkup(createElement(AvisoOperacion, { codigo: `invisible_${campo}` })), /trae un carácter invisible/, campo);
      assert.deepEqual(errorDelCampo(`invisible_${campo}`, campo), { "aria-invalid": true, "aria-describedby": "aviso-operacion-campo", autoFocus: true }, campo);
    }
  });

  // Un código que el resto del producto también lanza (expediente, LPB, suspensiones…) no lleva texto de PLD:
  // el aviso de PLD se vería en esas pantallas. Solo se comparten los que significan lo mismo en todas.
  it("ningún aviso de PLD cambia el de un código que lanza otra pantalla", () => {
    const raiz = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
    const lanzados = new Set<string>();
    const recorrer = (dir: string) => {
      for (const entrada of readdirSync(join(raiz, dir), { withFileTypes: true })) {
        const ruta = `${dir}/${entrada.name}`;
        if (entrada.isDirectory()) {
          if (entrada.name !== "pld") recorrer(ruta);
        } else if (/\.tsx?$/.test(entrada.name) && !entrada.name.endsWith(".test.ts")) {
          // `new ErrorDeDominio("…")` y el `super("…")` de las clases que la extienden.
          for (const m of readFileSync(join(raiz, ruta), "utf8").matchAll(/(?:ErrorDeDominio|super)\("([a-z][a-zA-Z0-9_]+)"\)/g)) lanzados.add(m[1]!);
        }
      }
    };
    recorrer("src");
    for (const archivo of readdirSync(join(raiz, "db/migrations")).filter((a) => a.endsWith(".sql") && !a.startsWith("0030"))) {
      for (const m of readFileSync(join(raiz, "db/migrations", archivo), "utf8").matchAll(/raise exception '([a-zA-Z0-9_]+)'/gi)) lanzados.add(m[1]!);
    }
    assert.ok(
      lanzados.has("dato_invalido_curp") && lanzados.has("expediente_datos_incompletos") && lanzados.has("conservacion_no_se_borra"),
      "la búsqueda encuentra los códigos del expediente (también los de una subclase) y de 0028",
    );
    assert.deepEqual(Object.keys(MENSAJES_PLD).filter((codigo) => lanzados.has(codigo)).sort(), ["cliente_ausente", "conservacion_no_se_borra", "formulario_ya_aplicado"]);
  });

  // La lista cerrada de aviso.tsx (#59) solo pinta un `dato_invalido_<campo>` o `invisible_<campo>` de un campo conocido.
  // aviso.test.ts revisa los códigos escritos tal cual; aquí van también los que arman los ayudantes de PLD con su campo.
  it("cada dato_invalido_ e invisible_ que lanza PLD se pinta, también los que arman sus ayudantes", () => {
    const servidor = join(dirname(fileURLToPath(import.meta.url)), "../../../server/pld");
    const fuentes = readdirSync(servidor)
      .filter((archivo) => archivo.endsWith(".ts") && !archivo.endsWith(".test.ts"))
      .map((archivo) => ({ archivo, texto: readFileSync(join(servidor, archivo), "utf8") }));
    // Si otro archivo arma un código con su campo, su ayudante entra a AYUDANTES.
    assert.deepEqual(
      fuentes.filter(({ texto }) => /`(?:dato_invalido|invisible)_\$\{/.test(texto)).map(({ archivo }) => archivo).sort(),
      ["avisos.ts", "base.ts", "comite.ts", "parametros.ts", "perfil.ts"],
    );
    // Ayudante → prefijos que lanza. `texto` y `nombre` del Comité llaman también rechazarInvisible con el mismo campo.
    const AYUDANTES: Array<[RegExp, string[]]> = [
      [/rechazarInvisible\([^,()]+,\s*"([A-Za-z]+)"\)/g, ["invisible_"]],
      [/\bexcluir\([^,()]+,\s*"([A-Za-z]+)"\)/g, ["dato_invalido_"]],
      [/\btexto\([^,()]+,\s*\d+,\s*"([A-Za-z]+)"\)/g, ["invisible_", "dato_invalido_"]],
      [/\bnombre\([^,()]+,\s*"([A-Za-z]+)"(?:,\s*"[^"]*")?\)/g, ["invisible_", "dato_invalido_"]],
      [/\b(?:decimal|entero)\([^,()]+,\s*"([A-Za-z]+)",/g, ["dato_invalido_"]],
      [/\b(?:monto|operaciones)\([^,()]+,\s*"([A-Za-z]+)"\)/g, ["dato_invalido_"]],
    ];
    const codigos = new Set<string>();
    for (const { texto } of fuentes) {
      for (const m of texto.matchAll(/"((?:dato_invalido|invisible)_[A-Za-z]+)"/g)) codigos.add(m[1]!);
      for (const [patron, prefijos] of AYUDANTES) for (const m of texto.matchAll(patron)) for (const prefijo of prefijos) codigos.add(prefijo + m[1]);
    }
    for (const codigo of ["dato_invalido_fraccionN", "dato_invalido_pagosMonto", "invisible_folio", "invisible_area", "dato_invalido_superior"]) {
      assert.ok(codigos.has(codigo), `la búsqueda encuentra ${codigo}`);
    }
    for (const codigo of codigos) {
      assert.equal(avisoConocido(codigo), true, codigo);
      assert.notEqual(renderToStaticMarkup(createElement(AvisoOperacion, { codigo })), "", codigo);
    }
  });

  it("lo que leen Originación, Aprobación o Administración no habla de alertas, casos ni análisis (55ª)", () => {
    for (const codigo of VISIBLES_FUERA_DE_CUMPLIMIENTO) {
      const texto = MENSAJES_PLD[codigo];
      assert.ok(texto, codigo);
      assert.doesNotMatch(texto, /alerta|\bcasos?\b|análisis|dictamen|comité|reporte|\bpld\b|inusual|preocupante/i, codigo);
    }
  });
});
