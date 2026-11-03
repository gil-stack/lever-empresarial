import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  CAJONES,
  DIAS_DEFAULT,
  DIAS_MAX,
  DIAS_MIN,
  MOTIVO_ASIENTO_MAX,
  NOMBRE_CATEGORIA_MAX,
  VENCIDOS_DEFAULT,
  VENCIDOS_MAX,
  VENCIDOS_MIN,
} from "../../src/dominio/politica.ts";
import { SQL } from "../../src/server/politica/repositorio.ts";

const RAIZ = new URL("../../", import.meta.url);

describe("el contrato de la migración 0007", () => {
  it("siembra nombres y defaults, y no siembra centavos", () => {
    const sql = readFileSync(new URL("db/migrations/0007_politica_categorias_cajones.sql", RAIZ), "utf8").toLowerCase();
    assert.match(sql, new RegExp(`dias_comprobante integer not null default ${DIAS_DEFAULT}`));
    assert.match(sql, new RegExp(`max_vencidos integer not null default ${VENCIDOS_DEFAULT}`));
    assert.match(sql, new RegExp(`between ${DIAS_MIN} and ${DIAS_MAX}`));
    assert.match(sql, new RegExp(`between ${VENCIDOS_MIN} and ${VENCIDOS_MAX}`));
    assert.match(sql, new RegExp(`between 1 and ${NOMBRE_CATEGORIA_MAX}`));
    assert.match(sql, new RegExp(`between 1 and ${MOTIVO_ASIENTO_MAX}`));
    assert.match(sql, /umbral_proveedores_centavos bigint/);
    assert.doesNotMatch(sql, /umbral_proveedores_centavos bigint[^,\n]*default/);
    assert.match(sql, /tope_centavos bigint/);
    assert.doesNotMatch(sql, /tope_centavos bigint[^,\n]*default/);
    assert.doesNotMatch(sql, /insert into postings/);
    assert.doesNotMatch(sql, /insert into policy_categories/);
    assert.match(sql, /insert into policies/);
    assert.match(sql, /insert into drawers/);
    for (const cajon of CAJONES) {
      assert.equal(sql.includes(cajon.codigo), true);
      assert.equal(sql.includes(cajon.nombre.toLowerCase()), true);
    }
    assert.equal(sql.includes("spei"), false);
    assert.equal(sql.includes("clabe"), false);

    const numeros = new Set(sql.match(/\d+/g) ?? []);
    const permitidos = new Set([
      String(DIAS_DEFAULT),
      String(VENCIDOS_DEFAULT),
      String(DIAS_MIN),
      String(DIAS_MAX),
      String(VENCIDOS_MIN),
      String(VENCIDOS_MAX),
      String(NOMBRE_CATEGORIA_MAX),
      String(MOTIVO_ASIENTO_MAX),
      "0",
      String(CAJONES.length),
    ]);
    for (const numero of numeros) {
      assert.equal(permitidos.has(numero), true, numero);
    }
  });

  it("la lectura filtra por la membresía y el saldo es la suma", () => {
    assert.match(SQL.leer, /where m\.user_id = \$1/);
    assert.match(SQL.leer, /company_id = m\.company_id/);
    assert.match(SQL.leer, /coalesce\(sum\(p\.centavos\), 0\)/);
    assert.doesNotMatch(SQL.leer, /password/);
    assert.match(SQL.guardarPlazo, /where company_id = \$1/);
    assert.match(SQL.escribirTope, /where company_id = \$1 and id = \$2/);
    assert.match(SQL.borrarCategoria, /where company_id = \$1 and id = \$2/);
    assert.doesNotMatch(SQL.crearCategoria, /insert into postings/i);
    const fuente = readFileSync(new URL("src/server/politica/repositorio.ts", RAIZ), "utf8");
    const servicio = readFileSync(new URL("src/server/politica/servicio.ts", RAIZ), "utf8");
    assert.match(fuente, /rechazarSiNoEscribe\(fila\.rol\)/);
    assert.equal(fuente.toLowerCase().includes("insert into postings"), false);
    assert.equal(servicio.toLowerCase().includes("insert into postings"), false);
    assert.equal(fuente.includes("${userId}"), false);
  });

  it("la pantalla no hardcodea un monto ni ofrece dispersar", () => {
    const cajones = readFileSync(new URL("src/components/consola/cajones.tsx", RAIZ), "utf8");
    const formas = readFileSync(new URL("src/components/politica/formularios.tsx", RAIZ), "utf8");
    const acciones = readFileSync(new URL("src/app/consola/politica/acciones.ts", RAIZ), "utf8");
    assert.match(cajones, /formatoPesos\(cajon\.saldoCentavos\)/);
    assert.match(cajones, /formatoPesos\(vista\.sinCajonCentavos\)/);
    assert.match(cajones, /no se dispersa/i);
    assert.doesNotMatch(cajones, /<form/i);
    assert.doesNotMatch(cajones, /<button/i);
    assert.doesNotMatch(cajones, /\$0\.00/);
    assert.doesNotMatch(formas, /defaultValue=\{5\}/);
    assert.doesNotMatch(formas, /\b\d{4,}\b/);
    assert.equal(/gratis/i.test(formas), false);
    assert.equal(acciones.toLowerCase().includes("postings"), false);
    assert.equal(acciones.toLowerCase().includes("spei"), false);
  });
});
