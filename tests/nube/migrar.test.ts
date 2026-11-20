import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { archivos, baseEsperada, cifrado, decidir, revisarUrl, tachar } from "../../scripts/migrar.mjs";

const RAIZ = join(import.meta.dirname, "../..");

describe("migrar al desplegar: cuándo", () => {
  it("el build de producción de Vercel migra; vista previa, desarrollo, local y contenedor no", () => {
    assert.equal(decidir({ VERCEL_ENV: "production" }, true).migrar, true);
    for (const env of [{ VERCEL_ENV: "preview" }, { VERCEL_ENV: "development" }, {}, { LEVER_CONTENEDOR: "1" }]) {
      const decision = decidir(env, true);
      assert.equal(decision.migrar, false, JSON.stringify(env));
      assert.match(decision.motivo ?? "", /no se migra/);
    }
  });

  it("una vista previa no migra aunque tenga DATABASE_URL_UNPOOLED: así nunca toca la base de producción", () => {
    const directa = new URL("postgresql://u@ep-x.neon.tech/plataforma").href;
    assert.equal(decidir({ VERCEL_ENV: "preview", DATABASE_URL_UNPOOLED: directa }, true).migrar, false);
  });

  it("a mano o como paso antes de desplegar en Google Cloud (sin --al-construir), migra siempre", () => {
    assert.equal(decidir({}, false).migrar, true);
    assert.equal(decidir({ VERCEL_ENV: "preview" }, false).migrar, true);
  });

  it("npm run build migra antes de compilar, y si la migración falla next build no corre", () => {
    const paquete = JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf8")) as { scripts: Record<string, string> };
    assert.equal(paquete.scripts.build, "node scripts/migrar.mjs --al-construir && next build");
  });
});

describe("migrar: a qué base", () => {
  it("solo la conexión directa de la base plataforma", () => {
    assert.equal(revisarUrl("postgresql://duena@ep-algo-123.us-east-1.aws.neon.tech/plataforma?sslmode=require"), null);
    assert.match(revisarUrl("") ?? "", /Falta DATABASE_URL_UNPOOLED/);
    assert.match(revisarUrl("postgresql://duena@ep-algo-123-pooler.us-east-1.aws.neon.tech/plataforma") ?? "", /agrupado/);
    assert.match(revisarUrl("postgresql://duena@db.example.com/plataforma?pgbouncer=true") ?? "", /agrupado/);
    assert.match(revisarUrl("postgresql://duena@db.example.com/otra") ?? "", /base plataforma/);
    assert.match(revisarUrl("mysql://duena@db.example.com/plataforma") ?? "", /directo de Postgres/);
    assert.match(revisarUrl("postgresql://duena@/plataforma") ?? "", /directo de Postgres/);
  });

  it("acepta el socket de Cloud SQL, que no lleva máquina en la URL", () => {
    assert.equal(revisarUrl("postgresql://duena@/plataforma?host=/cloudsql/proyecto:northamerica-south1:lever"), null);
  });

  it("TLS verificado salvo en la máquina local o por el socket de Cloud SQL", () => {
    assert.deepEqual(cifrado("postgresql://duena@ep-algo.neon.tech/plataforma"), { rejectUnauthorized: true });
    assert.equal(cifrado("postgresql://duena@127.0.0.1:5432/plataforma"), undefined);
    assert.equal(cifrado("postgresql://duena@localhost/plataforma"), undefined);
    assert.equal(cifrado("postgresql://duena@/plataforma?host=/cloudsql/proyecto:northamerica-south1:lever"), undefined);
  });

  it("nunca muestra el connection string", () => {
    assert.equal(tachar("falló postgresql://duena:clave@ep-x.neon.tech/plataforma por algo"), "falló *** por algo");
  });

  it("lee los mismos archivos que db/migrate.sh, en orden", () => {
    const lista = archivos();
    assert.ok(lista.length >= 40);
    assert.deepEqual([...lista].sort(), lista);
    assert.ok(lista.every((archivo) => /^[0-9]{4}_[a-z0-9_]+\.sql$/.test(archivo)));
  });

  it("la base esperada es la que declara la integración de Neon, o plataforma", () => {
    assert.equal(baseEsperada({}), "plataforma");
    assert.equal(baseEsperada({ PGDATABASE: " neondb " }), "neondb");
    assert.equal(revisarUrl("postgresql://duena@ep-algo.neon.tech/neondb", "neondb"), null);
    assert.match(revisarUrl("postgresql://duena@ep-algo.neon.tech/otra", "neondb") ?? "", /base neondb/);
  });
});
