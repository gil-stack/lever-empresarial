import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { cerrarConexion } from "../../src/nucleo/db.ts";
import { archivarClienteDePrueba, darDeAltaClienteDePrueba } from "../../src/server/operacion/clientes-de-prueba.ts";
import { listarClientes, registrarProspecto } from "../../src/server/operacion/clientes.ts";
import { SQL } from "../../src/server/tenencia/resolver.ts";
import { aplicarArchivo, conBaseDesechable, exigirBaseDesechable, urlDeAplicacion } from "../aislamiento/postgres.ts";
import { personal } from "./apoyo-alta-regulada.ts";

const urlAdmin = process.env.AISLAMIENTO_DATABASE_URL?.trim() ?? "";
const SANDBOX = {
  EFEVOO_URL: "https://test-intgapi.efevoopay.com",
  EFEVOO_API_USER: "usuario-prueba",
  EFEVOO_API_KEY: "llave-de-prueba-123",
  EFEVOO_AMBIENTE: "sandbox",
};
const sinTarjetas = { env: SANDBOX, vincular: async () => undefined };

describe("clientes de prueba (alta rápida) en Postgres desechable", { skip: urlAdmin.length === 0 }, () => {
  it("nace activo y marcado, solo por Administración, con bitácora; se archiva y su gente ya no entra", async () => {
    exigirBaseDesechable();
    await conBaseDesechable(urlAdmin, async (urlDuena) => {
      const dir = join(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");
      for (const archivo of readdirSync(dir).sort()) if (archivo.endsWith(".sql")) aplicarArchivo(urlDuena, join(dir, archivo));
      const { Client } = await import("pg");
      const admin = new Client({ connectionString: urlDuena });
      await admin.connect();
      const operatorId = String((await admin.query("select id from operators order by alta_en limit 1")).rows[0].id);
      const a = randomUUID();
      const origina = randomUUID();
      for (const [id, correo, rol] of [[a, "ana@ejemplo.mx", "administracion_plataforma"], [origina, "ori@ejemplo.mx", "originacion"]] as const) {
        await admin.query("insert into users (id, nombre, correo, password_hash) values ($1, $2, $3, null)", [id, correo.split("@")[0], correo]);
        await admin.query("insert into platform_staff (operator_id, user_id, estado) values ($1, $2, 'activo')", [operatorId, id]);
        await admin.query("insert into platform_staff_roles (operator_id, user_id, rol) values ($1, $2, $3)", [operatorId, id, rol]);
      }
      process.env.DATABASE_URL = urlDeAplicacion(urlDuena);
      await cerrarConexion();
      const ana = personal(operatorId, a, ["administracion_plataforma"]);
      const ori = personal(operatorId, origina, ["originacion"]);
      const app = new Client({ connectionString: urlDeAplicacion(urlDuena) });
      await app.connect();
      try {
        // Sin el procesador en pruebas, no existe.
        await assert.rejects(
          darDeAltaClienteDePrueba(ana, { razonSocial: "Prueba Uno", nombre: "Beto", correo: "beto@ejemplo.mx" }, { env: {} }),
          /alta_rapida_no_disponible/,
        );
        // Solo Administración de la plataforma.
        await assert.rejects(
          darDeAltaClienteDePrueba(ori, { razonSocial: "Prueba Uno", nombre: "Beto", correo: "beto@ejemplo.mx" }, sinTarjetas),
          /sin_permiso_operacion/,
        );
        // El correo del personal no sirve: no entra al portal de clientes.
        await assert.rejects(
          darDeAltaClienteDePrueba(ana, { razonSocial: "Prueba Uno", nombre: "Ori", correo: "ori@ejemplo.mx" }, sinTarjetas),
          /correo_es_de_personal/,
        );

        const hecho = await darDeAltaClienteDePrueba(ana, { razonSocial: "  Prueba   Uno ", nombre: "Beto", correo: "Beto@Ejemplo.mx" }, sinTarjetas);
        assert.deepEqual(hecho.tarjetas, { vinculada: true });
        assert.equal(hecho.invitacion.entrega, "omitida_desarrollo");
        assert.match(hecho.invitacion.enlace ?? "", /\/invitacion/);
        const empresa = (await admin.query(
          "select estado, de_prueba, demostracion, razon_social, contacto_correo, originada_por from companies where id = $1",
          [hecho.companyId],
        )).rows[0];
        assert.deepEqual(
          { ...empresa },
          { estado: "activa", de_prueba: true, demostracion: false, razon_social: "Prueba Uno", contacto_correo: "beto@ejemplo.mx", originada_por: a },
        );
        const eventos = (await admin.query(
          "select accion, actor_id, cambio from audit_log where company_id = $1 and entidad = 'companies' order by accion",
          [hecho.companyId],
        )).rows;
        assert.deepEqual(eventos.map((e) => [e.accion, e.actor_id]), [["alta_empresa", a], ["cliente_prueba_creado", a]]);
        assert.equal(eventos[0].cambio.de_prueba, true);
        // El administrador quedó invitado a la empresa.
        const beto = String((await admin.query("select id from users where correo = 'beto@ejemplo.mx'")).rows[0].id);
        const membresia = (await admin.query("select estado from memberships where user_id = $1 and company_id = $2", [beto, hecho.companyId])).rows[0];
        assert.equal(membresia.estado, "invitada");

        // RFC escrito y repetido: el aviso es del RFC.
        const rfc = String((await admin.query("select rfc from companies where id = $1", [hecho.companyId])).rows[0].rfc);
        await assert.rejects(
          darDeAltaClienteDePrueba(ana, { razonSocial: "Prueba Dos", rfc, nombre: "Ceci", correo: "ceci@ejemplo.mx" }, sinTarjetas),
          /rfc_duplicado/,
        );

        // La lista lo marca; un prospecto real no.
        const real = await registrarProspecto(ana, { rfc: "AAA010101AAA", razonSocial: "Real", codigoPostal: "01000", regimen: "601", usoCfdi: "G03" });
        const lista = await listarClientes(ana);
        assert.deepEqual(
          lista.map((c) => [c.razonSocial, c.dePrueba]).sort(),
          [["Prueba Uno", true], ["Real", false]],
        );

        // Desde la aplicación nadie marca, desmarca ni archiva a mano, ni llama a la puerta sin el rol.
        await app.query("begin");
        await app.query("set local role plataforma_sofipo");
        await app.query("select set_config('app.operator_id', $1, true), set_config('app.user_id', $2, true)", [operatorId, a]);
        await assert.rejects(app.query("update companies set de_prueba = true where id = $1", [real]), /cliente_de_prueba_por_su_puerta/);
        await app.query("rollback");
        await app.query("begin");
        await app.query("set local role plataforma_sofipo");
        await app.query("select set_config('app.operator_id', $1, true), set_config('app.user_id', $2, true)", [operatorId, a]);
        await assert.rejects(app.query("update companies set archivada_en = now() where id = $1", [hecho.companyId]), /cliente_de_prueba_por_su_puerta/);
        await app.query("rollback");
        await app.query("begin");
        await app.query("set local role plataforma_sofipo");
        await app.query("select set_config('app.operator_id', $1, true), set_config('app.user_id', $2, true)", [operatorId, origina]);
        await assert.rejects(
          app.query("select cliente_de_prueba_alta($1, 'PXX261123AB1', 'Otra', '06600', '601', 'G03', 'X', 'x@ejemplo.mx', null)", [randomUUID()]),
          /sin_permiso_cliente_de_prueba/,
        );
        await app.query("rollback");
        await assert.rejects(admin.query("update companies set de_prueba = false where id = $1", [hecho.companyId]), /cliente_de_prueba_no_se_desmarca/);

        // Su administrador, ya con la membresía activa, entra a la empresa; archivada, ya no.
        await admin.query("update memberships set estado = 'activa' where user_id = $1 and company_id = $2", [beto, hecho.companyId]);
        const entra = async () => (await admin.query(SQL.membresias, [beto])).rows.map((r) => [r.id, r.de_prueba]);
        assert.deepEqual(await entra(), [[hecho.companyId, true]]);

        // Archivar: solo un cliente de prueba, solo Administración, una vez.
        await assert.rejects(archivarClienteDePrueba(ori, hecho.companyId), /sin_permiso_operacion/);
        await assert.rejects(archivarClienteDePrueba(ana, real), /no_es_cliente_de_prueba/);
        await archivarClienteDePrueba(ana, hecho.companyId);
        await assert.rejects(archivarClienteDePrueba(ana, hecho.companyId), /cliente_de_prueba_ya_archivado/);
        assert.deepEqual((await listarClientes(ana)).map((c) => c.razonSocial), ["Real"]);
        assert.deepEqual(await entra(), []);
        const archivado = (await admin.query(
          "select count(*)::int as n from audit_log where company_id = $1 and accion = 'cliente_prueba_archivado' and actor_id = $2",
          [hecho.companyId, a],
        )).rows[0];
        assert.equal(archivado.n, 1);
      } finally {
        await app.end();
        await admin.end();
        await cerrarConexion();
      }
    });
  });
});
