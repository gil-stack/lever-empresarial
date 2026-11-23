import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { cerrarConexion } from "../../src/nucleo/db.ts";
import { guardarAjusteDeAlerta, listarAjustesDeAlertas, listarAlertas } from "../../src/server/operacion/alertas.ts";
import { registrarProspecto } from "../../src/server/operacion/clientes.ts";
import { aplicarArchivo, conBaseDesechable, exigirBaseDesechable, urlDeAplicacion } from "../aislamiento/postgres.ts";
import { personal } from "./apoyo-alta-regulada.ts";

const urlAdmin = process.env.AISLAMIENTO_DATABASE_URL?.trim() ?? "";

describe("configuración de las alertas automáticas en Postgres desechable", { skip: urlAdmin.length === 0 }, () => {
  it("apaga, reasigna y vuelve a prender, con bitácora y RLS por operador", async () => {
    exigirBaseDesechable();
    await conBaseDesechable(urlAdmin, async (urlDuena) => {
      const dir = join(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");
      for (const archivo of readdirSync(dir).sort()) if (archivo.endsWith(".sql")) aplicarArchivo(urlDuena, join(dir, archivo));
      const { Client } = await import("pg");
      const admin = new Client({ connectionString: urlDuena });
      await admin.connect();
      const operatorId = String((await admin.query("select id from operators order by alta_en limit 1")).rows[0].id);
      const otroOperador = randomUUID();
      await admin.query("insert into operators (id, nombre) values ($1, 'Otro operador')", [otroOperador]);
      const a = randomUUID();
      const b = randomUUID();
      const origina = randomUUID();
      const externa = randomUUID();
      for (const [id, correo] of [[a, "a@ejemplo.mx"], [b, "b@ejemplo.mx"], [origina, "origina@ejemplo.mx"], [externa, "externa@ejemplo.mx"]] as const) {
        await admin.query("insert into users (id, nombre, correo, password_hash) values ($1, $2, $3, null)", [id, correo.split("@")[0].toUpperCase(), correo]);
      }
      for (const [id, rol] of [[a, "administracion_plataforma"], [b, "administracion_plataforma"], [origina, "originacion"]] as const) {
        await admin.query("insert into platform_staff (operator_id, user_id, estado) values ($1, $2, 'activo')", [operatorId, id]);
        await admin.query("insert into platform_staff_roles (operator_id, user_id, rol) values ($1, $2, $3)", [operatorId, id, rol]);
      }
      await admin.query("insert into platform_staff (operator_id, user_id, estado) values ($1, $2, 'activo')", [otroOperador, externa]);
      await admin.query("insert into platform_staff_roles (operator_id, user_id, rol) values ($1, $2, 'administracion_plataforma')", [otroOperador, externa]);

      process.env.DATABASE_URL = urlDeAplicacion(urlDuena);
      await cerrarConexion();
      const ana = personal(operatorId, a, ["administracion_plataforma"]);
      const ori = personal(operatorId, origina, ["originacion"]);
      const ajena = personal(otroOperador, externa, ["administracion_plataforma"]);
      const alta = (rfc: string, razonSocial: string, quien = ana) =>
        registrarProspecto(quien, { rfc, razonSocial, codigoPostal: "01000", regimen: "601", usoCfdi: "G03" });
      try {
        // Sin ajuste guardado: las dos prendidas y a quien hizo el trámite, como siempre.
        const iniciales = await listarAjustesDeAlertas(ana);
        assert.deepEqual(iniciales.map((ajuste) => [ajuste.categoria, ajuste.activa, ajuste.responsableId]), [
          ["activacion", true, null],
          ["comision", true, null],
        ]);
        const uno = await alta("AAA010101AAA", "Empresa Uno");
        assert.equal((await listarAlertas(ana, uno))[0]?.responsableId, a);

        // Solo la Administración configura; Originación ve pero no cambia.
        await assert.rejects(guardarAjusteDeAlerta(ori, { categoria: "activacion", activa: "no", responsableId: "" }), /sin_permiso_operacion/);
        await assert.rejects(guardarAjusteDeAlerta(ana, { categoria: "invitacion", activa: "no", responsableId: "" }), /ajuste_invalido/);
        await assert.rejects(guardarAjusteDeAlerta(ana, { categoria: "activacion", activa: "tal vez", responsableId: "" }), /ajuste_invalido/);
        await assert.rejects(guardarAjusteDeAlerta(ana, { categoria: "activacion", activa: "si", responsableId: externa }), /responsable_invalido/);

        // Apagada: registrar un prospecto ya no abre la alerta.
        await guardarAjusteDeAlerta(ana, { categoria: "activacion", activa: "no", responsableId: "" });
        const dos = await alta("BBB010101BBA", "Empresa Dos");
        assert.deepEqual(await listarAlertas(ana, dos), []);
        // Las que ya existían no cambian.
        assert.equal((await listarAlertas(ana, uno)).length, 1);

        // Prendida con responsable fijo: se asigna a Beto aunque registre Originación.
        await guardarAjusteDeAlerta(ana, { categoria: "activacion", activa: "si", responsableId: b });
        const tres = await alta("CCC010101CCA", "Empresa Tres", ori);
        assert.equal((await listarAlertas(ana, tres))[0]?.responsableId, b);
        const leidos = await listarAjustesDeAlertas(ana);
        assert.equal(leidos[0]?.activa, true);
        assert.equal(leidos[0]?.responsableId, b);
        assert.equal(leidos[0]?.actualizadoPor, "A");

        // Si el responsable fijo deja el personal, vuelve a quien hizo el trámite.
        await admin.query("update platform_staff set estado = 'suspendido' where operator_id = $1 and user_id = $2", [operatorId, b]);
        const cuatro = await alta("DDD010101DDA", "Empresa Cuatro");
        assert.equal((await listarAlertas(ana, cuatro))[0]?.responsableId, a);

        // Otro operador no ve ni hereda la configuración de este.
        assert.deepEqual((await listarAjustesDeAlertas(ajena)).map((ajuste) => ajuste.responsableId), [null, null]);

        // Cada cambio dejó su evento, y la fila no se borra.
        const eventos = await admin.query("select count(*)::int as n from audit_log where accion = 'alerta_configurada'");
        assert.equal(eventos.rows[0].n, 2);
        await assert.rejects(admin.query("delete from operational_alert_settings"), /ajuste_no_se_borra/);
        // Una escritura sin su evento en la bitácora no se guarda.
        const app = new Client({ connectionString: urlDeAplicacion(urlDuena) });
        await app.connect();
        try {
          await app.query("begin");
          await app.query("set local role plataforma_sofipo");
          await app.query("select set_config('app.operator_id', $1, true), set_config('app.user_id', $2, true)", [operatorId, a]);
          await app.query("update operational_alert_settings set activa = false where categoria = 'activacion'");
          await assert.rejects(app.query("commit"), /ajuste_sin_auditoria/);
        } finally {
          await app.end();
        }
      } finally {
        await admin.end();
        await cerrarConexion();
      }
    });
  });
});
