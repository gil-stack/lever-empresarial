import assert from "node:assert/strict";
import { test } from "node:test";

import { buscarSecretos, revisarCliente, revisarSql } from "../../scripts/ci/seguridad.mjs";

test("una cadena con contraseña no es un nombre de variable", () => {
  assert.deepEqual(buscarSecretos("src/server/session/db.ts", 'process.env.DATABASE_URL'), []);
  assert.deepEqual(
    buscarSecretos("src/server/db.ts", 'const url = "postgresql://usuario:secreto@db.ejemplo/plataforma";'),
    ["src/server/db.ts:1 cadena de Postgres con contraseña"],
  );
});

test("las pruebas pueden citar una cadena falsa; un token no", () => {
  const cita = 'const ejemplo = "postgresql://usuario:supersecreto@ep.neon.tech/plataforma";';
  assert.deepEqual(buscarSecretos("src/server/sesion.test.ts", cita), []);
  const tokenBlob = "vercel_blob_rw_" + "abc123DEF";
  const tokenResend = "re_" + "1234567890abcdefghij";
  assert.deepEqual(buscarSecretos("src/app/page.tsx", `const t = "${tokenBlob}";`), [
    "src/app/page.tsx:1 token de Blob",
  ]);
  assert.deepEqual(buscarSecretos("README.md", `const t = "${tokenResend}";`), [
    "README.md:1 token de Resend",
  ]);
});

test("el cliente no menciona el libro ni Blob", () => {
  const cliente = `"use client";\nconst x = process.env.DATABASE_URL;\n`;
  assert.equal(revisarCliente("src/components/x.tsx", cliente).length, 1);
  assert.deepEqual(revisarCliente("src/server/session/db.ts", "process.env.DATABASE_URL"), []);
});

test("el placeholder $n del lote 69-B se acepta y un valor no", () => {
  const seguro = `
    function insertar(filas: { id: string }[]) {
      const valores: string[] = [];
      filas.forEach((fila, indice) => {
        const base = indice * 3;
        valores.push(\`($\${base + 1}, $\${base + 2}, $\${base + 3})\`);
      });
      consulta.query(\`insert into t values \${valores.join(", ")}\`);
    }
  `;
  assert.deepEqual(revisarSql("src/server/x.ts", seguro), []);

  const inseguro = `
    function buscar(rfc: string) {
      consulta.query(\`select * from t where rfc = '\${rfc}'\`);
    }
  `;
  assert.equal(revisarSql("src/server/x.ts", inseguro).length, 1);
});

test("eval y child_process no entran al servidor", () => {
  assert.equal(revisarSql("src/app/salud/route.ts", "export function GET() { return eval('1'); }").length, 1);
  assert.equal(
    revisarSql("src/server/a.ts", "import { spawn } from 'node:child_process';").length,
    1,
  );
});
