import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { CONTROL } from "../../src/dominio/control.ts";

import { TOPE_ARCHIVO_BYTES } from "../../src/dominio/archivos.ts";
import { hoyEnMexico } from "../../src/dominio/operacion/comisiones.ts";
import { sumarMeses } from "../../src/dominio/operacion/riesgo.ts";
import { capacidadesDe, type RolCliente } from "../../src/nucleo/capacidades.ts";
import type { ContextoDeTenant } from "../../src/nucleo/contexto.ts";
import { cerrarConexion, type Consulta } from "../../src/nucleo/db.ts";
import { decidirActivacion, solicitarActivacion } from "../../src/server/operacion/activaciones.ts";
import { leerBitacora } from "../../src/server/operacion/bitacora.ts";
import { leerCliente, registrarProspecto } from "../../src/server/operacion/clientes.ts";
import { leerBandejaCumplimiento } from "../../src/server/operacion/cumplimiento.ts";
import {
  agregarAccionista,
  agregarRepresentante,
  archivoDeDocumento,
  calificarRiesgoEmpresa,
  cargarDocumento,
  crearVersion,
  dictaminarVersion,
  enviarVersion,
  ExpedienteIncompleto,
  guardarDatosGenerales,
  leerExpediente,
  prepararDescargaDocumento,
  retirarDelBorrador,
} from "../../src/server/operacion/expediente.ts";
import { invitarPrimerAdministrador } from "../../src/server/operacion/invitaciones.ts";
import {
  cargarListaBloqueadas,
  enRevisionDeCumplimiento,
  leerArchivoDeLista,
  listarCoincidencias,
  registrarReporte,
  resolverCoincidencia,
} from "../../src/server/operacion/lpb.ts";
import { cambiarRolPersonal } from "../../src/server/operacion/personal.ts";
import { decidirCambioDeSuspension, solicitarCambioDeSuspension } from "../../src/server/operacion/suspensiones.ts";
import { crearPagoProveedor, resolverPagoProveedor } from "../../src/server/pagos-proveedores/servicio.ts";
import { nombrarCentro } from "../../src/server/personas/servicio.ts";
import { declararPerfil } from "../../src/server/pld/perfil.ts";
import { cambiarAccesoFinanzas } from "../../src/server/roles/finanzas.ts";
import { darDeAltaComoDuena } from "../../scripts/empresa-por-la-duena.ts";
import { invitarPersonalComoDuena } from "../../scripts/personal-por-la-duena.ts";
import { etiquetaAccion } from "../../src/components/operacion/formato.ts";
import { aplicarArchivo, conBaseDesechable, exigirBaseDesechable, urlDeAplicacion } from "../aislamiento/postgres.ts";
import {
  almacenEnMemoria,
  armarBorrador,
  DATOS_GENERALES,
  expedienteEnRegla,
  PDF,
  personal,
  SESION_SOFIPO,
  type SocioDePrueba,
} from "./apoyo-alta-regulada.ts";

const urlAdmin = process.env.AISLAMIENTO_DATABASE_URL?.trim() ?? "";

// Personal SOFIPO del operador de la prueba.
const ADM = "a0000000-0000-4000-8000-000000000001";
const ORI = "a0000000-0000-4000-8000-000000000002";
const APR = "a0000000-0000-4000-8000-000000000003";
const CUM = "a0000000-0000-4000-8000-000000000004";
const AUD = "a0000000-0000-4000-8000-000000000005";
const MIXTO = "a0000000-0000-4000-8000-000000000006";
const NUEVO = "a0000000-0000-4000-8000-000000000007";
// Persona que entra al personal en la prueba de carreras.
const RITA = "a0000000-0000-4000-8000-00000000000a";
// Solo Administración (ADM también tiene Cumplimiento desde la prueba del comando).
const ADA = "a0000000-0000-4000-8000-00000000000b";
// Personal de otro operador: no ve nada del primero.
const AJENA = "a0000000-0000-4000-8000-000000000009";
// Personas del portal de Beta.
const LUIS = "b0000000-0000-4000-8000-000000000001";
const ROSA = "b0000000-0000-4000-8000-000000000002";
const PROVEEDOR_LPB = "c0000000-0000-4000-8000-000000000001";
const PROVEEDOR_LIMPIO = "c0000000-0000-4000-8000-000000000002";
const PROVEEDOR_TRES = "c0000000-0000-4000-8000-000000000003";
const PROVEEDOR_CUATRO = "c0000000-0000-4000-8000-000000000004";
const COPIA_69B = "d0000000-0000-4000-8000-000000000001";
const CLABE = "002180701150123452";

const DOS_CAPAS: SocioDePrueba[] = [
  {
    nombre: "Holding Uno SA de CV", tipoPersona: "moral", rfc: "HUN100101AA1", capital: "60", votos: "60",
    hijos: [
      { nombre: "Mario López Paz", tipoPersona: "fisica", rfc: "LOPM700101AB1", curp: "LOPM700101HDFPZR01", capital: "50", votos: "50" },
      { nombre: "Ana Díaz Mora", tipoPersona: "fisica", rfc: "DIMA720202AB2", curp: "DIMA720202MDFZRN02", capital: "50", votos: "50" },
    ],
  },
  { nombre: "Pedro Ruiz Sol", tipoPersona: "fisica", rfc: "RUSP800303AB3", curp: "RUSP800303HDFZLD03", capital: "40", votos: "40" },
];

// bar-3: la constante de control del servidor es exactamente lo que la base cuenta como `[[:cntrl:]]` con el
// proveedor builtin C.UTF-8 de Neon (`pg_c_utf8`, fijado aquí para no depender del locale de la base de prueba
// ni del de CI), en todo el plano básico sin sustitutos. Antes el servidor solo filtraba C0 y DEL, y la base
// también rechaza C1 (U+0080 a U+009F).
describe("caracteres de control: el servidor y la base cuentan lo mismo", { skip: urlAdmin.length === 0 }, () => {
  it("CONTROL coincide con [[:cntrl:]] de pg_c_utf8 de U+0001 a U+FFFF", async () => {
    const c = new pg.Client({ connectionString: urlAdmin });
    await c.connect();
    try {
      const base = (await c.query<{ cp: number[] }>(
        `select coalesce(array_agg(cp order by cp), '{}') as cp from generate_series(1, 65535) as cp
          where (cp < 55296 or cp > 57343) and (chr(cp) collate "pg_c_utf8") ~ '[[:cntrl:]]'`,
      )).rows[0]!.cp;
      const servidor: number[] = [];
      for (let cp = 1; cp <= 0xffff; cp++) {
        if (cp >= 0xd800 && cp <= 0xdfff) continue;
        if (CONTROL.test(String.fromCodePoint(cp))) servidor.push(cp);
      }
      assert.deepEqual(servidor, base);
      assert.ok(base.includes(0x85) && base.includes(0x93) && !base.includes(0x2028) && !base.includes(0xa0));
    } finally {
      await c.end();
    }
  });
});

describe("alta regulada en Postgres desechable", { skip: urlAdmin.length === 0 }, () => {
  it("H2 y N3: la 0028 sobre una base en la 0027 asigna la 69-B al único operador; la primera Administración la da la dueña", async () => {
    exigirBaseDesechable();
    const dir = join(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");
    const hasta0027 = (url: string) => {
      for (const archivo of readdirSync(dir).sort()) {
        if (archivo.endsWith(".sql") && archivo < "0028") aplicarArchivo(url, join(dir, archivo));
      }
    };
    const copiaVieja = async (url: string) => {
      const c = new pg.Client({ connectionString: url });
      await c.connect();
      try {
        await c.query("begin");
        await c.query("insert into lista_69b_snapshots (id, fecha_archivo, cargado_en) values ($1, current_date - 1, now())", [COPIA_69B]);
        await c.query(
          `insert into audit_log (operator_id, actor_tipo, superficie, accion, entidad, identificador)
           values ((select id from operators order by alta_en limit 1), 'sistema', 'sistema', 'cargar_lista_69b', 'lista_69b_snapshots', $1)`,
          [COPIA_69B],
        );
        await c.query("insert into lista_69b_rows (snapshot_id, rfc, situacion) values ($1, 'PAL7202161U0', 'Presunto')", [COPIA_69B]);
        await c.query("commit");
      } finally {
        await c.end();
      }
    };
    // Como db/migrate.sh: la migración entera en una transacción.
    const aplicar0028 = async (url: string) => {
      const c = new pg.Client({ connectionString: url });
      await c.connect();
      try {
        await c.query("begin");
        await c.query(readFileSync(join(dir, "0028_alta_regulada.sql"), "utf8"));
        await c.query("commit");
      } catch (error) {
        await c.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        await c.end();
      }
    };
    const consultar = async (url: string, sql: string) => {
      const c = new pg.Client({ connectionString: url });
      await c.connect();
      try {
        return (await c.query(sql)).rows;
      } finally {
        await c.end();
      }
    };

    // Con un solo operador, la copia que ya existía pasa a él y la columna queda obligatoria.
    await conBaseDesechable(urlAdmin, async (urlDuena) => {
      hasta0027(urlDuena);
      await copiaVieja(urlDuena);
      await aplicar0028(urlDuena);
      assert.deepEqual(await consultar(urlDuena, `select (s.operator_id = o.id) as del_operador from lista_69b_snapshots s, operators o`), [{ del_operador: true }]);
      assert.deepEqual(await consultar(urlDuena, `select attnotnull from pg_attribute where attrelid = 'lista_69b_snapshots'::regclass and attname = 'operator_id'`), [{ attnotnull: true }]);

      // N3 y N8: la primera Administración la invita la dueña de la base; la bitácora guarda la
      // conexión (session_user) y el correo de quien corrió el comando, que es obligatorio.
      await assert.rejects(invitarPersonalComoDuena(urlDuena, ["primera@ejemplo.mx"], "gil"), /corrido_por_invalido/);
      const [primera] = await invitarPersonalComoDuena(urlDuena, ["primera@ejemplo.mx"], "Gil@Ejemplo.mx");
      assert.equal(primera?.resultado, "invitada");
      assert.deepEqual(await consultar(urlDuena, `
        select s.estado, r.rol, a.origen, a.cambio ->> 'ejecutado_por' = session_user as ejecutado_por, a.cambio ->> 'corrido_por' as corrido_por
        from platform_staff s join users u on u.id = s.user_id
        join platform_staff_roles r on r.operator_id = s.operator_id and r.user_id = s.user_id
        join audit_log a on a.accion = 'alta_personal' and a.identificador = s.user_id
        where u.correo = 'primera@ejemplo.mx'`), [{
        estado: "invitado", rol: "administracion_plataforma", origen: "migracion_personal", ejecutado_por: true, corrido_por: "gil@ejemplo.mx",
      }]);
      // base-N15: la primera corrida no entregó el enlace (sin Resend ni --mostrar-enlace). Con la
      // Administración solo invitada, un correo distinto no entra, ni solo ni junto a los mismos.
      assert.equal(primera?.invitacion?.entrega.entregada, false);
      const primerToken = primera!.invitacion!.emitida.token;
      for (const correos of [["segunda@ejemplo.mx"], ["primera@ejemplo.mx", "segunda@ejemplo.mx"]]) {
        await assert.rejects(invitarPersonalComoDuena(urlDuena, correos, "gil@ejemplo.mx"), /arranque_con_otros_correos/);
      }
      assert.deepEqual(await consultar(urlDuena, "select count(*)::int as n from invitations"), [{ n: 1 }]);
      // La corrida con los mismos correos emite un enlace nuevo y revoca el anterior, en la bitácora.
      const [reenviada] = await invitarPersonalComoDuena(urlDuena, ["Primera@Ejemplo.mx"], "otra@ejemplo.mx");
      assert.equal(reenviada?.resultado, "reenviada");
      const nuevoToken = reenviada!.invitacion!.emitida.token;
      assert.notEqual(nuevoToken, primerToken);
      const porToken = async (token: string) => (await consultar(urlDuena,
        `select revocada_en is not null as revocada, usada_en is not null as usada from invitacion_por_token('${createHash("sha256").update(token).digest("hex")}')`))[0];
      assert.deepEqual(await porToken(primerToken), { revocada: true, usada: false });
      assert.deepEqual(await porToken(nuevoToken), { revocada: false, usada: false });
      // Lo mismo que hace la aceptación (consumir): con el enlace viejo no cierra nada.
      assert.deepEqual(await consultar(urlDuena, `
        with cerrada as (update invitations set usada_en = now() where token_hash = '${createHash("sha256").update(primerToken).digest("hex")}'
          and usada_en is null and revocada_en is null and expira_en > now() returning 1)
        select count(*)::int as n from cerrada`), [{ n: 0 }]);
      assert.deepEqual(await consultar(urlDuena, `
        select a.cambio ->> 'corrido_por' as corrido_por, a.cambio ->> 'ejecutado_por' = session_user as ejecutado_por, a.origen
        from audit_log a join invitations i on i.id = a.identificador
        where a.accion = 'emitir_invitacion' and i.token_hash = '${createHash("sha256").update(nuevoToken).digest("hex")}'`), [{
        corrido_por: "otra@ejemplo.mx", ejecutado_por: true, origen: "migracion_personal",
      }]);
      assert.deepEqual(await consultar(urlDuena, "select count(*)::int as n from platform_staff"), [{ n: 1 }]);
      // N7: con la Administración activa, ninguna corrida invita ni reenvía.
      await consultar(urlDuena, "update platform_staff set estado = 'activo'");
      for (const correos of [["tercera@ejemplo.mx"], ["primera@ejemplo.mx"]]) {
        await assert.rejects(invitarPersonalComoDuena(urlDuena, correos, "gil@ejemplo.mx"), /personal_con_administracion/);
      }
      assert.deepEqual(await consultar(urlDuena, "select count(*)::int as n from platform_staff"), [{ n: 1 }]);
      assert.deepEqual(await consultar(urlDuena, "select count(*)::int as n from invitations"), [{ n: 2 }]);
      assert.deepEqual(await consultar(urlDuena, "select count(*)::int as n from users where correo in ('segunda@ejemplo.mx', 'tercera@ejemplo.mx')"), [{ n: 0 }]);
    });

    // La primera corrida invita a la vez a todas las personas de la variable.
    await conBaseDesechable(urlAdmin, async (urlDuena) => {
      hasta0027(urlDuena);
      await aplicar0028(urlDuena);
      const varias = await invitarPersonalComoDuena(urlDuena, ["una@ejemplo.mx", "dos@ejemplo.mx"], "gil@ejemplo.mx");
      assert.deepEqual(varias.map((fila) => fila.resultado), ["invitada", "invitada"]);
      assert.deepEqual(await consultar(urlDuena, "select count(*)::int as n from platform_staff where estado = 'invitado'"), [{ n: 2 }]);
      // base-N15: con las invitaciones ya vencidas, la misma variable las vuelve a emitir.
      await consultar(urlDuena, `
        begin;
        alter table invitations disable trigger invitations_no_update;
        update invitations set emitida_en = now() - interval '4 days', expira_en = now() - interval '1 day';
        alter table invitations enable trigger invitations_no_update;
        commit;`);
      const otraVez = await invitarPersonalComoDuena(urlDuena, ["una@ejemplo.mx", "dos@ejemplo.mx"], "gil@ejemplo.mx");
      assert.deepEqual(otraVez.map((fila) => fila.resultado), ["reenviada", "reenviada"]);
      assert.deepEqual(await consultar(urlDuena, `
        select count(*) filter (where revocada_en is null and expira_en > now())::int as vigentes, count(*) filter (where revocada_en is not null)::int as revocadas
        from invitations`), [{ vigentes: 2, revocadas: 2 }]);
    });

    // Con dos operadores y copias sin dueño, la migración se detiene y no deja nada a medias.
    await conBaseDesechable(urlAdmin, async (urlDuena) => {
      hasta0027(urlDuena);
      await consultar(urlDuena, "insert into operators (id, nombre) values (gen_random_uuid(), 'Segundo operador')");
      await copiaVieja(urlDuena);
      await assert.rejects(aplicar0028(urlDuena), /lista_69b_sin_operador/);
      assert.deepEqual(await consultar(urlDuena, `select count(*)::int as n from information_schema.columns where table_name = 'lista_69b_snapshots' and column_name = 'operator_id'`), [{ n: 0 }]);

      // N4: seguir la sugerencia del aborto al pie de la letra (crear la columna, apartar el
      // candado y asignar cada copia) y volver a aplicar la 0028 funciona.
      const c = new pg.Client({ connectionString: urlDuena });
      await c.connect();
      try {
        await c.query("begin");
        await c.query("alter table lista_69b_snapshots add column operator_id uuid");
        await c.query("alter table lista_69b_snapshots disable trigger lista_69b_snapshots_no_update");
        await c.query("update lista_69b_snapshots set operator_id = (select id from operators order by alta_en desc limit 1) where id = $1", [COPIA_69B]);
        await c.query("alter table lista_69b_snapshots enable trigger lista_69b_snapshots_no_update");
        await c.query("commit");
      } finally {
        await c.end();
      }
      await aplicar0028(urlDuena);
      assert.deepEqual(await consultar(urlDuena, `
        select s.operator_id = (select id from operators order by alta_en desc limit 1) as asignada,
               (select attnotnull from pg_attribute where attrelid = 'lista_69b_snapshots'::regclass and attname = 'operator_id') as obligatoria,
               (select count(*)::int from pg_constraint where conrelid = 'lista_69b_snapshots'::regclass and contype = 'f'
                  and conname = 'lista_69b_snapshots_operator_id_fkey') as llave
        from lista_69b_snapshots s`), [{ asignada: true, obligatoria: true, llave: 1 }]);
      await assert.rejects(consultar(urlDuena, "update lista_69b_snapshots set operator_id = gen_random_uuid()"), /solo acepta inserciones/);
    });

    // base-N17: una copia que leen proveedores de empresas de dos operadores. Asignarla a uno
    // solo deja a los proveedores del otro contra una copia ajena: la 0028 se detiene. Duplicarla,
    // una por operador con sus renglones, como dice la sugerencia, termina consistente.
    await conBaseDesechable(urlAdmin, async (urlDuena) => {
      hasta0027(urlDuena);
      await consultar(urlDuena, "insert into operators (id, nombre, alta_en) values (gen_random_uuid(), 'Segundo operador', now() + interval '1 second')");
      await copiaVieja(urlDuena);
      const A = "(select id from operators order by alta_en limit 1)";
      const B = "(select id from operators order by alta_en desc limit 1)";
      await consultar(urlDuena, `
        begin;
        insert into companies (id, rfc, razon_social, codigo_postal, regimen, uso_cfdi, operator_id, estado, demostracion) values
          ('c5000000-0000-4000-8000-0000000000a1', 'EMA150301AB1', 'Empresa de A', '06600', '601', 'G03', ${A}, 'activa', true),
          ('c5000000-0000-4000-8000-0000000000b1', 'EMB150301AB1', 'Empresa de B', '06600', '601', 'G03', ${B}, 'activa', true);
        insert into audit_log (operator_id, company_id, actor_tipo, superficie, accion, entidad, identificador)
          select c.operator_id, c.id, 'sistema', 'sistema', 'alta_empresa', 'companies', c.id from companies c;
        insert into documents (id, company_id, clave_blob, hash_sha256, tipo, nombre_original, creado_en) values
          ('d5000000-0000-4000-8000-0000000000a1', 'c5000000-0000-4000-8000-0000000000a1', 'demo/const-a', repeat('a', 64), 'application/pdf', 'a.pdf', now()),
          ('d5000000-0000-4000-8000-0000000000b1', 'c5000000-0000-4000-8000-0000000000b1', 'demo/const-b', repeat('b', 64), 'application/pdf', 'b.pdf', now());
        insert into suppliers (id, company_id, document_id, snapshot_id, rfc, razon_social, lista_fecha, lista_leida_en, boton_pago, alta_en) values
          ('5c000000-0000-4000-8000-0000000000a1', 'c5000000-0000-4000-8000-0000000000a1', 'd5000000-0000-4000-8000-0000000000a1', '${COPIA_69B}', 'PRA010101AB1', 'Proveedor de A', (select fecha_archivo from lista_69b_snapshots where id = '${COPIA_69B}'), now(), true, now()),
          ('5c000000-0000-4000-8000-0000000000b1', 'c5000000-0000-4000-8000-0000000000b1', 'd5000000-0000-4000-8000-0000000000b1', '${COPIA_69B}', 'PRB010101AB1', 'Proveedor de B', (select fecha_archivo from lista_69b_snapshots where id = '${COPIA_69B}'), now(), true, now());
        insert into audit_log (operator_id, company_id, actor_tipo, superficie, accion, entidad, identificador)
          select c.operator_id, s.company_id, 'sistema', 'sistema', 'alta_proveedor', 'suppliers', s.id from suppliers s join companies c on c.id = s.company_id;
        insert into supplier_clabes (id, company_id, supplier_id, clabe, digito_valido, vigente_desde)
          select md5(s.id::text)::uuid, s.company_id, s.id, '002180701150123452', true, now() from suppliers s;
        insert into audit_log (operator_id, company_id, actor_tipo, superficie, accion, entidad, identificador)
          select c.operator_id, sc.company_id, 'sistema', 'sistema', 'clabe_proveedor', 'supplier_clabes', sc.id from supplier_clabes sc join companies c on c.id = sc.company_id;
        commit;`);
      // La primera sugerencia ya dice que esa copia se duplica, una por operador con sus renglones.
      await assert.rejects(aplicar0028(urlDuena), (error: pg.DatabaseError) => {
        assert.match(error.message, /lista_69b_sin_operador/);
        assert.match(error.hint ?? "", /se duplica, una por operador con sus renglones, con la relectura apartada/);
        return true;
      });
      // Seguir solo la asignación (la copia a A) y volver a aplicar: se detiene sin dejar nada a medias.
      await consultar(urlDuena, `
        begin;
        alter table lista_69b_snapshots add column operator_id uuid;
        alter table lista_69b_snapshots disable trigger lista_69b_snapshots_no_update;
        update lista_69b_snapshots set operator_id = ${A} where id = '${COPIA_69B}';
        alter table lista_69b_snapshots enable trigger lista_69b_snapshots_no_update;
        commit;`);
      await assert.rejects(aplicar0028(urlDuena), (error: pg.DatabaseError) => {
        assert.match(error.message, /lista_69b_de_otro_operador/);
        assert.match(error.hint ?? "", /se duplica, una por operador con sus renglones, con la relectura apartada/);
        return true;
      });
      assert.deepEqual(await consultar(urlDuena, `
        select to_regclass('lpb_coincidencias') is null as sin_0028,
               (select attnotnull from pg_attribute where attrelid = 'lista_69b_snapshots'::regclass and attname = 'operator_id') as obligatoria`),
      [{ sin_0028: true, obligatoria: false }]);
      // La duplicación al pie de la letra: copia nueva de B con sus renglones y su evento, y los proveedores de B a ella.
      const copiaDeB = randomUUID();
      await consultar(urlDuena, `
        begin;
        alter table lista_69b_snapshots disable trigger lista_69b_relee_proveedores;
        insert into audit_log (operator_id, actor_tipo, superficie, accion, entidad, identificador)
          values (${B}, 'sistema', 'sistema', 'cargar_lista_69b', 'lista_69b_snapshots', '${copiaDeB}');
        set constraints lista_69b_exige_auditoria immediate;
        insert into lista_69b_snapshots (id, fecha_archivo, cargado_en, operator_id)
          select '${copiaDeB}', fecha_archivo, cargado_en, ${B} from lista_69b_snapshots where id = '${COPIA_69B}';
        alter table lista_69b_snapshots enable trigger lista_69b_relee_proveedores;
        insert into lista_69b_rows (snapshot_id, rfc, situacion) select '${copiaDeB}', rfc, situacion from lista_69b_rows where snapshot_id = '${COPIA_69B}';
        update suppliers set snapshot_id = '${copiaDeB}' where snapshot_id = '${COPIA_69B}' and company_id in (select id from companies where operator_id = ${B});
        commit;`);
      await aplicar0028(urlDuena);
      assert.deepEqual(await consultar(urlDuena, `
        select s.razon_social, l.operator_id = c.operator_id as copia_de_su_operador,
               (select count(*)::int from lista_69b_rows r where r.snapshot_id = l.id) as renglones
        from suppliers s join companies c on c.id = s.company_id join lista_69b_snapshots l on l.id = s.snapshot_id
        order by s.razon_social`), [
        { razon_social: "Proveedor de A", copia_de_su_operador: true, renglones: 1 },
        { razon_social: "Proveedor de B", copia_de_su_operador: true, renglones: 1 },
      ]);
    });
  });

  it("roles, expediente, riesgo, LPB, suspensión, candado, RLS y lecturas auditadas", async (t) => {
    exigirBaseDesechable();
    await conBaseDesechable(urlAdmin, async (urlDuena) => {
      const dir = join(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");
      for (const archivo of readdirSync(dir).sort()) if (archivo.endsWith(".sql")) aplicarArchivo(urlDuena, join(dir, archivo));
      const dueno = new pg.Client({ connectionString: urlDuena });
      await dueno.connect();
      const operador = String((await dueno.query("select id from operators order by alta_en limit 1")).rows[0].id);
      const otroOperador = randomUUID();
      await dueno.query("insert into operators (id, nombre) values ($1, 'Otro operador')", [otroOperador]);
      const personas: Array<[string, string, string | null, string[]]> = [
        [ADM, "Adriana Admin", operador, ["administracion_plataforma"]],
        [ORI, "Óscar Originación", operador, ["originacion"]],
        [APR, "Paula Aprobación", operador, ["aprobacion"]],
        [CUM, "Carmen Cumplimiento", operador, ["cumplimiento"]],
        [AUD, "Aurelio Auditoría", operador, []],
        [MIXTO, "Mario Mixto", operador, ["originacion", "aprobacion"]],
        [NUEVO, "Nora Nueva", operador, []],
        [AJENA, "Alma Ajena", otroOperador, ["auditoria"]],
        [LUIS, "Luis Portal", null, []],
        [ROSA, "Rosa Portal", null, []],
      ];
      for (const [id, nombre, op, roles] of personas) {
        await dueno.query("insert into users (id, nombre, correo) values ($1, $2, $3)", [id, nombre, `${id}@ejemplo.mx`]);
        if (!op) continue;
        await dueno.query("insert into platform_staff (operator_id, user_id, estado) values ($1, $2, 'activo')", [op, id]);
        for (const rol of roles) await dueno.query("insert into platform_staff_roles (operator_id, user_id, rol) values ($1, $2, $3)", [op, id, rol]);
      }

      process.env.DATABASE_URL = urlDeAplicacion(urlDuena);
      const urlApp = process.env.DATABASE_URL;
      await cerrarConexion();
      const adm = personal(operador, ADM, ["administracion_plataforma"]);
      const ori = personal(operador, ORI, ["originacion"]);
      const apr = personal(operador, APR, ["aprobacion"]);
      const cum = personal(operador, CUM, ["cumplimiento"]);
      const aud = personal(operador, AUD, ["auditoria"]);
      const mixto = personal(operador, MIXTO, ["originacion", "aprobacion"]);
      const ajena = personal(otroOperador, AJENA, ["auditoria"]);
      const almacen = almacenEnMemoria();
      const hoy = hoyEnMexico(new Date());
      const sofipo = <T>(userId: string, fn: (c: pg.Client) => Promise<T>, op = operador) =>
        como(urlApp, "plataforma_sofipo", { userId, operadorId: op }, fn);
      const evento = (
        c: pg.Client, userId: string, accion: string, entidad: string, identificador: string, companyId: string | null = null,
        cambio: Record<string, string> | null = null,
      ) =>
        c.query(
          `insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, origen, cambio)
           values ($1, $2, 'personal', $3, 'sofipo', $4, $5, $6, 'operacion', $7)`,
          [operador, companyId, userId, accion, entidad, identificador, cambio ? JSON.stringify(cambio) : null],
        );
      const contar = async (sql: string, params: unknown[] = []) => Number((await dueno.query(sql, params)).rows[0].n);
      const prospecto = (rfc: string, razonSocial: string) =>
        registrarProspecto(ori, { rfc, razonSocial, codigoPostal: "06600", regimen: "601", usoCfdi: "G03" });

      try {
        await t.test("50ª: el auditor no recibe cumplimiento, nadie se da roles y todo cambio deja evento", async () => {
          await cambiarRolPersonal(adm, SESION_SOFIPO, { userId: AUD, rol: "auditoria", quitar: false });
          // Repetir la asignación no duplica ni deja otro evento.
          await cambiarRolPersonal(adm, SESION_SOFIPO, { userId: AUD, rol: "auditoria", quitar: false });
          await assert.rejects(cambiarRolPersonal(adm, SESION_SOFIPO, { userId: AUD, rol: "cumplimiento", quitar: false }), /roles_incompatibles/);
          await assert.rejects(cambiarRolPersonal(adm, SESION_SOFIPO, { userId: ADM, rol: "auditoria", quitar: false }), /rol_propio/);
          await assert.rejects(cambiarRolPersonal(cum, SESION_SOFIPO, { userId: AUD, rol: "originacion", quitar: false }), /sin_permiso_operacion/);
          await assert.rejects(
            cambiarRolPersonal(adm, { superficie: "sofipo", segundoFactor: { metodo: "totp", en: new Date(Date.now() - 3_600_000) } }, {
              userId: NUEVO, rol: "originacion", quitar: false,
            }),
            /reautenticacion_requerida/,
          );
          assert.equal(await contar("select count(*)::int as n from platform_staff_roles where user_id = $1", [AUD]), 1);
          assert.equal(await contar("select count(*)::int as n from audit_log where accion = 'rol_personal_asignado' and identificador = $1", [AUD]), 1);

          // SQL directo: la base repite cada regla aunque alguien se salte el servicio.
          await assert.rejects(sofipo(CUM, async (c) => {
            await evento(c, CUM, "rol_personal_asignado", "platform_staff_roles", NUEVO, null, { rol: "originacion" });
            await c.query("insert into platform_staff_roles (operator_id, user_id, rol) values ($1, $2, 'originacion')", [operador, NUEVO]);
          }), /sin_permiso_roles/);
          await assert.rejects(sofipo(ADM, async (c) => {
            await evento(c, ADM, "rol_personal_asignado", "platform_staff_roles", ADM, null, { rol: "auditoria" });
            await c.query("insert into platform_staff_roles (operator_id, user_id, rol) values ($1, $2, 'auditoria')", [operador, ADM]);
          }), /rol_propio/);
          // Sin su evento en la misma transacción, la asignación no se guarda (trigger diferido, corre con el rol del portal).
          await assert.rejects(sofipo(ADM, (c) =>
            c.query("insert into platform_staff_roles (operator_id, user_id, rol) values ($1, $2, 'aprobacion')", [operador, NUEVO]),
          ), /rol_personal_sin_auditoria/);
          await assert.rejects(dueno.query("update platform_staff_roles set rol = 'cumplimiento' where user_id = $1", [AUD]), /rol_personal_no_se_reescribe/);

          // Dos asignaciones incompatibles a la vez: el candado por persona deja pasar una sola.
          const dos = await Promise.allSettled(["cumplimiento", "auditoria"].map((rol) =>
            sofipo(ADM, async (c) => {
              await evento(c, ADM, "rol_personal_asignado", "platform_staff_roles", NUEVO, null, { rol });
              await c.query("insert into platform_staff_roles (operator_id, user_id, rol) values ($1, $2, $3)", [operador, NUEVO, rol]);
            }),
          ));
          assert.deepEqual(dos.map((r) => r.status).sort(), ["fulfilled", "rejected"]);
          assert.match(String((dos.find((r) => r.status === "rejected") as PromiseRejectedResult).reason), /roles_incompatibles/);
          assert.equal(await contar("select count(*)::int as n from platform_staff_roles where user_id = $1", [NUEVO]), 1);

          await cambiarRolPersonal(adm, SESION_SOFIPO, { userId: AUD, rol: "auditoria", quitar: true });
          assert.equal(await contar("select count(*)::int as n from audit_log where accion = 'rol_personal_retirado' and identificador = $1", [AUD]), 1);
          await cambiarRolPersonal(adm, SESION_SOFIPO, { userId: AUD, rol: "auditoria", quitar: false });
        });

        let alfa = "";
        let alfaV1 = "";
        let alfaV2 = "";
        await t.test("expediente: dos capas de socios, propietarios reales calculados, versión inmutable y dictamen", async () => {
          alfa = await prospecto("ALF150301AB1", "Alfa Comercial SA de CV");
          await assert.rejects(registrarProspecto(cum, { rfc: "XXX150301AB1", razonSocial: "X", codigoPostal: "06600", regimen: "601", usoCfdi: "G03" }), /sin_permiso_operacion/);

          // Un borrador incompleto no se envía y el aviso dice qué falta. Sin datos generales, eso primero (serv-nuevo-6d:
          // antes del update, para no caer en el CHECK sin traducir); con ellos, la base exige el representante.
          const gamma = await prospecto("GAM150301AB3", "Gamma Servicios SA de CV");
          const gammaV1 = randomUUID();
          await crearVersion(ori, { companyId: gamma, formId: gammaV1 });
          await assert.rejects(enviarVersion(ori, gammaV1), /expediente_datos_incompletos/);
          await guardarDatosGenerales(ori, { versionId: gammaV1, datos: { ...DATOS_GENERALES, razonSocial: "Gamma Servicios SA de CV", rfc: "GAM150301AB3" } });
          await assert.rejects(enviarVersion(ori, gammaV1), /expediente_sin_representante/);

          ({ versionId: alfaV1 } = await armarBorrador(ori, { companyId: alfa, razonSocial: "Alfa Comercial SA de CV", rfc: "ALF150301AB1", socios: DOS_CAPAS, almacen }));
          // Cada dato general cae en su columna (la sentencia lista las columnas en el orden de la validación).
          const guardados = (await dueno.query(
            `select razon_social, giro, nacionalidad, rfc, serie_efirma, domicilio_calle, domicilio_exterior, domicilio_interior,
                    domicilio_colonia, domicilio_municipio, domicilio_entidad, domicilio_codigo_postal, domicilio_pais, telefono,
                    correo, fecha_constitucion::text as fecha_constitucion, volumen_mensual_centavos::text as volumen
             from kyb_versiones where id = $1`,
            [alfaV1],
          )).rows[0];
          assert.deepEqual(guardados, {
            razon_social: "Alfa Comercial SA de CV", giro: DATOS_GENERALES.giro, nacionalidad: DATOS_GENERALES.nacionalidad, rfc: "ALF150301AB1",
            serie_efirma: DATOS_GENERALES.serieEfirma, domicilio_calle: DATOS_GENERALES.domicilioCalle, domicilio_exterior: DATOS_GENERALES.domicilioExterior,
            domicilio_interior: null, domicilio_colonia: DATOS_GENERALES.domicilioColonia, domicilio_municipio: DATOS_GENERALES.domicilioMunicipio,
            domicilio_entidad: DATOS_GENERALES.domicilioEntidad, domicilio_codigo_postal: DATOS_GENERALES.domicilioCodigoPostal,
            domicilio_pais: DATOS_GENERALES.domicilioPais, telefono: DATOS_GENERALES.telefono, correo: DATOS_GENERALES.correo,
            fecha_constitucion: DATOS_GENERALES.fechaConstitucion, volumen: "10000000",
          });
          const previa = await leerExpediente(ori, alfa);
          assert.deepEqual(previa?.borrador?.accionistas.map((a) => [a.nombre, a.capa]), [
            ["Holding Uno SA de CV", 1], ["Mario López Paz", 2], ["Ana Díaz Mora", 2], ["Pedro Ruiz Sol", 1],
          ]);
          assert.equal(previa?.borrador?.estructuraCompleta, true);
          assert.equal(previa?.borrador?.documentos.length, 6);
          assert.ok(previa?.borrador?.documentos.every((d) => /^[0-9a-f]{64}$/.test(d.sha256)));

          await enviarVersion(ori, alfaV1);
          await enviarVersion(ori, alfaV1); // el segundo clic no hace nada
          const beneficiarios = (await dueno.query(
            "select nombre, motivo, capas, capital_pct::float8 as capital from kyb_beneficiarios where version_id = $1 order by capital desc, nombre",
            [alfaV1],
          )).rows as Array<{ nombre: string; motivo: string; capas: number; capital: number }>;
          // 25 % o más del capital, directo o a través de la holding (60 % × 50 % = 30 %).
          assert.deepEqual(beneficiarios.map((b) => [b.nombre, b.motivo, b.capas]), [
            ["Pedro Ruiz Sol", "capital", 1], ["Ana Díaz Mora", "capital", 2], ["Mario López Paz", "capital", 2],
          ]);

          await assert.rejects(sofipo(ORI, (c) => c.query("update kyb_versiones set giro = 'Otro giro' where id = $1", [alfaV1])), /expediente_enviado_inmutable/);
          await assert.rejects(sofipo(ORI, async (c) => {
            const id = randomUUID();
            await evento(c, ORI, "expediente_representante_agregado", "kyb_representantes", id, alfa);
            await c.query(
              `insert into kyb_representantes (id, version_id, company_id, operator_id, clave, nombre, cargo, es_administrador, creado_por, creado_en)
               values ($1, $2, $3, $4, $5, 'Otra persona', 'apoderado', false, $6, now())`,
              [id, alfaV1, alfa, operador, randomUUID(), ORI],
            );
          }), /expediente_enviado_inmutable/);
          await assert.rejects(dueno.query("delete from kyb_documentos where company_id = $1", [alfa]), /documento_expediente_inmutable/);
          await assert.rejects(dueno.query("delete from kyb_versiones where id = $1", [alfaV1]), /conservacion_no_se_borra/);
          await assert.rejects(sofipo(ORI, (c) => c.query("delete from kyb_documentos where company_id = $1", [alfa])), /permission denied/);
          await assert.rejects(sofipo(CUM, (c) => c.query("select clave_blob from kyb_documentos")), /permission denied/);

          // Quien envió no dictamina; Cumplimiento observa con motivo y el dictamen no se repite.
          await assert.rejects(dictaminarVersion(ori, SESION_SOFIPO, { versionId: alfaV1, formId: randomUUID(), resultado: "aprobado", motivo: "" }), /sin_permiso_operacion/);
          await assert.rejects(sofipo(ORI, async (c) => {
            const id = randomUUID();
            await evento(c, ORI, "expediente_dictaminado", "kyb_dictamenes", id, alfa);
            await c.query(
              `insert into kyb_dictamenes (id, version_id, company_id, operator_id, resultado, dictaminado_por, dictaminado_en)
               values ($1, $2, $3, $4, 'aprobado', $5, now())`,
              [id, alfaV1, alfa, operador, ORI],
            );
          }), /misma_persona_en_dictamen/);
          await assert.rejects(crearVersion(ori, { companyId: alfa, formId: randomUUID() }), /expediente_en_revision/);
          await assert.rejects(dictaminarVersion(cum, SESION_SOFIPO, { versionId: alfaV1, formId: randomUUID(), resultado: "observado", motivo: "" }), /motivo_invalido/);
          // serv-N17: observar o rechazar con un motivo de menos de 10 caracteres tampoco.
          await assert.rejects(dictaminarVersion(cum, SESION_SOFIPO, { versionId: alfaV1, formId: randomUUID(), resultado: "rechazado", motivo: "Falta" }), /motivo_corto/);
          // serv-N18: el mínimo cuenta caracteres como el CHECK, no unidades UTF-16: «Revisar 😀» son 9.
          await assert.rejects(dictaminarVersion(cum, SESION_SOFIPO, { versionId: alfaV1, formId: randomUUID(), resultado: "observado", motivo: "Revisar 😀" }), /motivo_corto/);
          const observado = randomUUID();
          await dictaminarVersion(cum, SESION_SOFIPO, { versionId: alfaV1, formId: observado, resultado: "observado", motivo: "Falta el poder notarial\ndel apoderado" });
          await dictaminarVersion(cum, SESION_SOFIPO, { versionId: alfaV1, formId: observado, resultado: "observado", motivo: "Falta el poder notarial\ndel apoderado" });
          assert.equal((await dueno.query("select motivo from kyb_dictamenes where id = $1", [observado])).rows[0]?.motivo, "Falta el poder notarial del apoderado");
          await assert.rejects(dictaminarVersion(cum, SESION_SOFIPO, { versionId: alfaV1, formId: randomUUID(), resultado: "aprobado", motivo: "" }), /dictamen_ya_registrado/);

          // La versión nueva hereda socios, representantes y documentos; se envía y se aprueba.
          alfaV2 = randomUUID();
          await crearVersion(ori, { companyId: alfa, formId: alfaV2 });
          const borrador = (await leerExpediente(ori, alfa))?.borrador;
          assert.equal(borrador?.numero, 2);
          assert.equal(borrador?.accionistas.length, 4);
          assert.equal(borrador?.representantes.length, 1);
          assert.equal(borrador?.documentos.length, 6);
          await enviarVersion(ori, alfaV2);
          await dictaminarVersion(cum, SESION_SOFIPO, { versionId: alfaV2, formId: randomUUID(), resultado: "aprobado", motivo: "" });
          const leido = await leerExpediente(aud, alfa);
          assert.equal(leido?.vigente?.numero, 2);
          assert.equal(leido?.vigente?.dictamen?.resultado, "aprobado");
          assert.deepEqual(leido?.versiones.map((v) => [v.numero, v.resultado]), [[2, "aprobado"], [1, "observado"]]);
          assert.equal(await contar("select count(*)::int as n from kyb_beneficiarios where version_id = $1", [alfaV2]), 3);
        });

        await t.test("grado de riesgo: seis meses de vigencia y revisión vencida calculada al leer", async () => {
          await assert.rejects(calificarRiesgoEmpresa(ori, { companyId: alfa, formId: randomUUID(), actividad: "baja", zona: "baja" }), /sin_permiso_operacion/);
          const calificacion = await calificarRiesgoEmpresa(cum, { companyId: alfa, formId: randomUUID(), actividad: "baja", zona: "baja" });
          // Dos capas de socios suman un punto: grado bajo.
          assert.deepEqual(calificacion, { grado: "bajo", puntaje: 1 });
          const fila = (await dueno.query(
            "select tipo, revisar_antes_de::text as revisar, version_id from kyb_calificaciones_riesgo where company_id = $1",
            [alfa],
          )).rows[0] as { tipo: string; revisar: string; version_id: string };
          assert.deepEqual(fila, { tipo: "alta", revisar: sumarMeses(hoy, 6), version_id: alfaV2 });
          // serv-N9: quien no ve la Lista recibe del servidor solo el grado y la fecha de revisión, sin desglose.
          for (const quien of [ori, apr]) {
            const riesgo = (await leerExpediente(quien, alfa))?.riesgo;
            assert.deepEqual(riesgo, { grado: "bajo", revisarAntesDe: sumarMeses(hoy, 6), vencida: false, desglose: null });
          }
          for (const quien of [cum, aud]) {
            const desglose = (await leerExpediente(quien, alfa))?.riesgo?.desglose;
            assert.deepEqual(Object.keys(desglose?.factores ?? {}).sort(), ["actividad", "antiguedad_meses", "capas", "coincidencias", "pep", "volumen_mensual_centavos", "zona"]);
            assert.equal(desglose?.puntaje, 1);
          }

          const enBandeja = async (ahora: Date) =>
            (await leerBandejaCumplimiento(cum, { ahora })).revisiones.find((r) => r.companyId === alfa)?.vencida;
          assert.equal(await enBandeja(new Date()), false);
          const despues = new Date(`${sumarMeses(hoy, 6)}T18:00:00Z`);
          despues.setUTCDate(despues.getUTCDate() + 1);
          assert.equal(await enBandeja(despues), true);
          await assert.rejects(leerBandejaCumplimiento(ori), /sin_permiso_operacion/);
          assert.ok(await leerBandejaCumplimiento(aud));

          await assert.rejects(sofipo(CUM, async (c) => {
            const id = randomUUID();
            await evento(c, CUM, "riesgo_calificado", "kyb_calificaciones_riesgo", id, alfa);
            await c.query(
              `insert into kyb_calificaciones_riesgo (id, operator_id, company_id, version_id, tipo, factores, puntaje, grado,
                 pep_extranjera, coincidencia_exacta, calificada_por, calificada_el, calificada_en, revisar_antes_de)
               values ($1, $2, $3, $4, 'alta', '{}', 1, 'bajo', false, false, $5, $6::date - 1, now(), ($6::date - 1 + interval '6 months')::date)`,
              [id, operador, alfa, alfaV2, CUM, hoy],
            );
          }), /calificacion_fecha_invalida/);
          await assert.rejects(dueno.query("update kyb_calificaciones_riesgo set grado = 'medio' where company_id = $1", [alfa]), /calificacion_inmutable/);
        });

        await t.test("candado de activación: la base rechaza cada faltante", async () => {
          const gamma = String((await dueno.query("select id from companies where rfc = 'GAM150301AB3'")).rows[0].id);
          await assert.rejects(solicitarActivacion(cum, gamma), /sin_permiso_operacion/);
          const solicitudGamma = await solicitarActivacion(ori, gamma);
          await assert.rejects(decidirActivacion(apr, SESION_SOFIPO, { id: solicitudGamma, aprobada: true }), /activacion_sin_expediente_aprobado/);
          await assert.rejects(decidirActivacion(ori, SESION_SOFIPO, { id: solicitudGamma, aprobada: true }), /sin_permiso_operacion/);
          await assert.rejects(sofipo(APR, (c) => c.query("update companies set estado = 'activa' where id = $1", [gamma])), /activacion_sin_expediente_aprobado/);
          await assert.rejects(dueno.query("update companies set estado = 'activa' where id = $1", [gamma]), /activacion_sin_expediente_aprobado/);

          // Expediente aprobado sin grado de riesgo; luego grado medio sin estructura corporativa.
          const delta = await prospecto("DEL150301AB4", "Delta Industrial SA de CV");
          const { versionId: deltaV1 } = await armarBorrador(ori, { companyId: delta, razonSocial: "Delta Industrial SA de CV", rfc: "DEL150301AB4", almacen });
          await enviarVersion(ori, deltaV1);
          await dictaminarVersion(cum, SESION_SOFIPO, { versionId: deltaV1, formId: randomUUID(), resultado: "aprobado", motivo: "" });
          const solicitudDelta = await solicitarActivacion(ori, delta);
          await assert.rejects(decidirActivacion(apr, SESION_SOFIPO, { id: solicitudDelta, aprobada: true }), /activacion_sin_riesgo_vigente/);
          assert.deepEqual(await calificarRiesgoEmpresa(cum, { companyId: delta, formId: randomUUID(), actividad: "alta", zona: "media" }), { grado: "medio", puntaje: 6 });
          await assert.rejects(decidirActivacion(apr, SESION_SOFIPO, { id: solicitudDelta, aprobada: true }), /activacion_sin_estructura_corporativa/);

          // Un documento que vence después del dictamen también frena (se simula el paso del tiempo).
          const solicitudAlfa = await solicitarActivacion(ori, alfa);
          await dueno.query("alter table kyb_documentos disable trigger user");
          await dueno.query("update kyb_documentos set vigente_hasta = $2::date - 1 where company_id = $1 and tipo = 'identificacion_representante'", [alfa, hoy]);
          await dueno.query("alter table kyb_documentos enable trigger user");
          await assert.rejects(decidirActivacion(apr, SESION_SOFIPO, { id: solicitudAlfa, aprobada: true }), /activacion_con_documento_vencido/);
          await dueno.query("alter table kyb_documentos disable trigger user");
          await dueno.query("update kyb_documentos set vigente_hasta = '2031-12-31' where company_id = $1 and tipo = 'identificacion_representante'", [alfa]);
          await dueno.query("alter table kyb_documentos enable trigger user");

          await assert.rejects(decidirActivacion(ori, SESION_SOFIPO, { id: solicitudAlfa, aprobada: true }), /sin_permiso_operacion/);
          // 0030 (Ola R2): el candado también exige el perfil transaccional declarado (25ª).
          await declararPerfil(ori, { companyId: alfa, formId: randomUUID(), pagosMonto: "500000", pagosOperaciones: "40", nominaMonto: "300000", nominaOperaciones: "2", motivo: "" });
          await decidirActivacion(apr, SESION_SOFIPO, { id: solicitudAlfa, aprobada: true });
          assert.equal((await leerCliente(ori, alfa))?.estado, "activa");
        });

        let marioId = "";
        await t.test("LPB: carga versionada, posible por nombre y propietario real exacto que suspende con plazo de 24 h", async () => {
          const csv = [
            "nombre,rfc,curp,tipo,fecha",
            "Mario López Paz,,LOPM700101HDFPZR01,fisica,2026-11-01",
            "PEDRO RUIZ SOL,,,fisica,2026-11-01",
            "Proveedor Bloqueado SA,PBL101010AB1,,moral,2026-11-01",
          ].join("\n");
          await assert.rejects(cargarListaBloqueadas(ori, { formId: randomUUID(), nombreArchivo: "lpb.csv", texto: csv }), /sin_permiso_operacion/);
          await assert.rejects(cargarListaBloqueadas(cum, { formId: randomUUID(), nombreArchivo: "lpb.csv", texto: "nombre;rfc\nx;y" }), /lpb_encabezado_invalido/);
          const formId = randomUUID();
          const carga = await cargarListaBloqueadas(cum, { formId, nombreArchivo: "lpb.csv", texto: csv });
          assert.equal(carga.filas, 3);
          assert.deepEqual(await cargarListaBloqueadas(cum, { formId, nombreArchivo: "lpb.csv", texto: csv }), carga);
          // S10: el mismo formulario con otro archivo no se da por hecho ni deja otra carga.
          const cargas = await contar("select count(*)::int as n from lpb_cargas");
          await assert.rejects(
            cargarListaBloqueadas(cum, { formId, nombreArchivo: "otra.csv", texto: `${csv}\nOTRA PERSONA RUIZ,,,fisica,2026-11-01` }),
            /formulario_invalido/,
          );
          assert.equal(await contar("select count(*)::int as n from lpb_cargas"), cargas);
          await assert.rejects(cargarListaBloqueadas(cum, { formId: randomUUID(), nombreArchivo: "otra.csv", texto: csv }), /lpb_ya_cargada/);
          await assert.rejects(dueno.query("delete from lpb_personas"), /lista_inmutable|conservacion_no_se_borra/);

          const coincidencias = await listarCoincidencias(cum, { companyId: alfa });
          const mario = coincidencias.find((k) => k.sujetoNombre === "Mario López Paz");
          const pedro = coincidencias.find((k) => k.sujetoNombre === "Pedro Ruiz Sol");
          assert.equal(mario?.tipo, "exacta");
          assert.equal(mario?.estado, "pendiente");
          assert.equal(pedro?.tipo, "posible");
          assert.ok(mario && pedro);
          marioId = mario.id;
          const plazo = (await dueno.query(
            "select extract(epoch from plazo_reporte_hasta - detectada_en)::int as s from lpb_coincidencias where id = $1",
            [mario.id],
          )).rows[0].s;
          assert.equal(plazo, 24 * 3600);

          // 75ª fr. I: suspensión inmediata, sin firma, con su evento de sistema.
          assert.equal((await leerCliente(ori, alfa))?.estado, "suspendida");
          const suspension = (await dueno.query(
            "select origen, estado, solicitada_por, coincidencia_id from company_suspensions where company_id = $1",
            [alfa],
          )).rows;
          assert.deepEqual(suspension, [{ origen: "lpb", estado: "aprobada", solicitada_por: null, coincidencia_id: mario.id }]);
          assert.equal(await contar(
            "select count(*)::int as n from audit_log where company_id = $1 and accion = 'empresa_suspendida_lpb' and actor_tipo = 'sistema' and actor_id is null",
            [alfa],
          ), 1);
          assert.equal(await contar(
            "select count(*)::int as n from company_state_history where company_id = $1 and estado_nuevo = 'suspendida' and actor_id is null",
            [alfa],
          ), 1);
          const bandeja = await leerBandejaCumplimiento(cum);
          assert.ok(bandeja.coincidencias.some((k) => k.id === mario.id && k.plazoReporteHasta !== null));
          // La bandeja dice por qué coincidió: Cumplimiento decide sin abrir otra pantalla.
          assert.equal(bandeja.coincidencias.find((k) => k.id === pedro.id)?.coincidePor, "nombre");
          assert.notEqual(bandeja.coincidencias.find((k) => k.id === mario.id)?.coincidePor, "nombre");
          assert.ok(bandeja.coincidencias.find((k) => k.id === pedro.id)?.nombreEnLista);

          // El nombre solo nunca se descarta solo: lo revisa Cumplimiento con motivo.
          await assert.rejects(resolverCoincidencia(ori, SESION_SOFIPO, { id: pedro.id, estado: "falso_positivo", motivo: "x" }), /sin_permiso_operacion/);
          await assert.rejects(sofipo(CUM, (c) => c.query("insert into lpb_coincidencias (operator_id, company_id, sujeto_tipo, sujeto_clave, sujeto_nombre, lista, tipo, coincide_por, valor_coincidente, detectada_en) values ($1, $2, 'empresa', $2, 'X', 'lpb', 'posible', 'nombre', 'X', now())", [operador, alfa])), /permission denied|coincidencia_solo_sistema/);
          // serv-N17: el motivo de la resolución lleva al menos 10 caracteres.
          await assert.rejects(resolverCoincidencia(cum, SESION_SOFIPO, { id: pedro.id, estado: "falso_positivo", motivo: "Homónimo" }), /motivo_corto/);
          await assert.rejects(resolverCoincidencia(cum, SESION_SOFIPO, { id: pedro.id, estado: "falso_positivo", motivo: "Revisar 😀" }), /motivo_corto/);
          // En dos renglones y con un tabulador: se guarda en un renglón (la base no acepta saltos de línea).
          await resolverCoincidencia(cum, SESION_SOFIPO, { id: pedro.id, estado: "falso_positivo", motivo: "Homónimo:\r\n\tla CURP del socio es distinta" });
          assert.equal((await dueno.query("select motivo_resolucion from lpb_coincidencias where id = $1", [pedro.id])).rows[0]?.motivo_resolucion, "Homónimo: la CURP del socio es distinta");
          await assert.rejects(registrarReporte(cum, { id: pedro.id, folio: "UIF-1", presentadoEl: hoy, avisoClienteEl: hoy }), /reporte_sin_confirmar/);
          await resolverCoincidencia(cum, SESION_SOFIPO, { id: mario.id, estado: "confirmada", motivo: "Coincide la CURP del propietario real" });
          // bar-4: la fecha de presentación o del aviso que no existe en el calendario se rechaza en su campo.
          await assert.rejects(registrarReporte(cum, { id: mario.id, folio: "UIF-2026-0001", presentadoEl: "2026-02-30", avisoClienteEl: hoy }), /dato_invalido_presentadoEl/);
          await assert.rejects(registrarReporte(cum, { id: mario.id, folio: "UIF-2026-0001", presentadoEl: hoy, avisoClienteEl: "0000-01-01" }), /dato_invalido_avisoClienteEl/);
          // Regla 1: el folio del reporte es un identificador. Con un carácter invisible (U+0085, un tabulador o, desde
          // serv-nuevo-5, un Cf como U+2060 o U+200B) se rechaza en su campo con su propio aviso y no se guarda nada; ni
          // se limpia ni llega a la base (antes, el CHECK `lpb_coincidencias_textos` respondía «La base no respondió»;
          // en 98224e0 se guardaba sin él; en b2db0b5 el U+2060 se guardaba).
          for (const folio of ["UIF-2026-\u00850001", "UIF-2026\t0001", "UIF-2026-\u20600001", "UIF\u200b-2026-0001"]) {
            await assert.rejects(registrarReporte(cum, { id: mario.id, folio, presentadoEl: hoy, avisoClienteEl: hoy }), /invisible_folio/, JSON.stringify(folio));
          }
          assert.equal((await dueno.query("select reporte_folio from lpb_coincidencias where id = $1", [mario.id])).rows[0]?.reporte_folio, null);
          await registrarReporte(cum, { id: mario.id, folio: "UIF-2026-0001", presentadoEl: hoy, avisoClienteEl: hoy });
          assert.equal((await dueno.query("select reporte_folio from lpb_coincidencias where id = $1", [mario.id])).rows[0]?.reporte_folio, "UIF-2026-0001");
          await assert.rejects(registrarReporte(cum, { id: mario.id, folio: "UIF-2026-0002", presentadoEl: hoy, avisoClienteEl: hoy }), /reporte_ya_registrado/);

          // Con coincidencia exacta abierta el grado es alto, aunque alguien intente otro por SQL.
          await assert.rejects(sofipo(CUM, async (c) => {
            const id = randomUUID();
            await evento(c, CUM, "riesgo_calificado", "kyb_calificaciones_riesgo", id, alfa);
            await c.query(
              `insert into kyb_calificaciones_riesgo (id, operator_id, company_id, version_id, tipo, factores, puntaje, grado,
                 pep_extranjera, coincidencia_exacta, calificada_por, calificada_el, calificada_en, revisar_antes_de)
               values ($1, $2, $3, $4, 'periodica', '{}', 1, 'bajo', false, false, $5, $6, now(), ($6::date + interval '6 months')::date)`,
              [id, operador, alfa, alfaV2, CUM, hoy],
            );
          }), /riesgo_debe_ser_alto/);
          assert.equal((await calificarRiesgoEmpresa(cum, { companyId: alfa, formId: randomUUID(), actividad: "baja", zona: "baja" })).grado, "alto");
        });

        await t.test("reactivar tras la LPB exige cerrar la coincidencia y dos personas", async () => {
          // Con la coincidencia abierta ni siquiera se puede pedir (77ª): primero se cierra el caso.
          await assert.rejects(
            solicitarCambioDeSuspension(ori, { companyId: alfa, formId: randomUUID(), tipo: "reactivacion", motivo: "La persona salió de la lista" }),
            /reactivacion_con_coincidencia_lpb/,
          );
          // Mientras siga en la lista vigente, no se puede marcar como fuera de ella.
          await assert.rejects(resolverCoincidencia(cum, SESION_SOFIPO, { id: marioId, estado: "fuera_de_lista", motivo: "Ya no aparece" }), /coincidencia_sigue_en_lista/);
          const sinMario = ["nombre,rfc,curp,tipo,fecha", "PEDRO RUIZ SOL,,,fisica,2026-11-01", "Proveedor Bloqueado SA,PBL101010AB1,,moral,2026-11-01"].join("\n");
          await cargarListaBloqueadas(cum, { formId: randomUUID(), nombreArchivo: "lpb-2.csv", texto: sinMario });
          await resolverCoincidencia(cum, SESION_SOFIPO, { id: marioId, estado: "fuera_de_lista", motivo: "Ya no aparece en la lista del 6 de noviembre" });
          const pedida = randomUUID();
          await solicitarCambioDeSuspension(ori, { companyId: alfa, formId: pedida, tipo: "reactivacion", motivo: "La persona salió de la lista" });
          await assert.rejects(decidirCambioDeSuspension(ori, SESION_SOFIPO, { id: pedida, aprobada: true, motivo: "" }), /sin_permiso_operacion/);
          await decidirCambioDeSuspension(apr, SESION_SOFIPO, { id: pedida, aprobada: true, motivo: "" });
          assert.equal((await leerCliente(ori, alfa))?.estado, "activa");
        });

        let beta = "";
        await t.test("suspensión manual con doble firma: ni dinero ni consola ni invitaciones, tampoco por SQL", async () => {
          beta = await prospecto("BET150301AB2", "Beta Logística SA de CV");
          await expedienteEnRegla(ori, cum, { companyId: beta, razonSocial: "Beta Logística SA de CV", rfc: "BET150301AB2" });
          await decidirActivacion(apr, SESION_SOFIPO, { id: await solicitarActivacion(ori, beta), aprobada: true });
          await sembrarPortal(dueno, beta, operador);
          // Los pagos llevan su propio almacén: el de expedientes no debe registrar ningún borrado.
          const deps = { almacen: almacenEnMemoria(), ahora: () => new Date() };
          const luis = cliente(LUIS, ["administrador", "liberador"], beta, operador);
          const rosa = cliente(ROSA, ["liberador"], beta, operador);
          const sesionCliente = { superficie: "cliente" as const, segundoFactor: { metodo: "totp" as const, en: new Date() } };
          const pago = (supplierId: string, monto: string) => crearPagoProveedor(luis, {
            clientRequestId: randomUUID(), supplierId, origen: "excepcion", pdf: { nombre: "soporte.pdf", bytes: PDF },
            monto, referencia: "Servicio de prueba", emitidaEl: hoy, venceEl: sumarMeses(hoy, 1), programadaEl: sumarMeses(hoy, 1),
            motivoExcepcion: "Servicio urgente autorizado por dirección",
          }, deps);

          // Flujo 11: el proveedor en la LPB no se paga.
          const bloqueado = await pago(PROVEEDOR_LPB, "1,000.00");
          await assert.rejects(resolverPagoProveedor(rosa, sesionCliente, {
            requestId: bloqueado.requestId, decision: "autorizar", version: 1, totalCentavos: 100000,
          }, deps), /pago_bloqueado_lpb/);
          const limpio = await pago(PROVEEDOR_LIMPIO, "2,000.00");

          // serv-N17: el motivo de la solicitud lleva de 10 a 500 caracteres, en el servidor y en la base.
          for (const corto of ["a", "  Revisar  ", "123456789", "Revisar 😀", "ok 👍👍👍👍"]) {
            await assert.rejects(solicitarCambioDeSuspension(ori, { companyId: beta, formId: randomUUID(), tipo: "suspension", motivo: corto }), /motivo_corto/);
          }
          await assert.rejects(solicitarCambioDeSuspension(ori, { companyId: beta, formId: randomUUID(), tipo: "suspension", motivo: "x".repeat(501) }), /motivo_invalido/);
          await assert.rejects(sofipo(ORI, async (c) => {
            const id = randomUUID();
            await evento(c, ORI, "suspension_solicitada", "company_suspensions", id, beta);
            await c.query(
              "insert into company_suspensions (id, operator_id, company_id, tipo, origen, motivo, solicitada_por, solicitada_en) values ($1, $2, $3, 'suspension', 'manual', 'Revisar', $4, now())",
              [id, operador, beta, ORI],
            );
          }), /company_suspensions_textos/);
          assert.equal(await contar("select count(*)::int as n from company_suspensions where company_id = $1", [beta]), 0);

          const pedida = randomUUID();
          // El motivo escrito en dos renglones (el navegador manda CRLF) entra en uno: la base no guarda
          // saltos de línea en los motivos. Antes, el servidor lo aceptaba y la base lo rechazaba.
          await solicitarCambioDeSuspension(ori, { companyId: beta, formId: pedida, tipo: "suspension", motivo: "Operaciones inusuales\r\n\r\n en revisión" });
          await solicitarCambioDeSuspension(ori, { companyId: beta, formId: pedida, tipo: "suspension", motivo: "Operaciones inusuales\r\n\r\n en revisión" });
          assert.equal((await dueno.query("select motivo from company_suspensions where id = $1", [pedida])).rows[0]?.motivo, "Operaciones inusuales en revisión");
          await assert.rejects(solicitarCambioDeSuspension(cum, { companyId: beta, formId: randomUUID(), tipo: "suspension", motivo: "Otra solicitud de suspensión" }), /suspension_pendiente/);
          // Rechazar la solicitud también pide un motivo de al menos 10 caracteres.
          await assert.rejects(decidirCambioDeSuspension(apr, SESION_SOFIPO, { id: pedida, aprobada: false, motivo: "No" }), /motivo_corto/);
          await assert.rejects(decidirCambioDeSuspension(apr, SESION_SOFIPO, { id: pedida, aprobada: false, motivo: "Revisar 😀" }), /motivo_corto/);
          await assert.rejects(decidirCambioDeSuspension(ori, SESION_SOFIPO, { id: pedida, aprobada: true, motivo: "" }), /sin_permiso_operacion/);
          await assert.rejects(sofipo(ORI, async (c) => {
            await evento(c, ORI, "suspension_aprobada", "company_suspensions", pedida, beta);
            await c.query("update company_suspensions set estado = 'aprobada', decidida_por = $2, decidida_en = now() where id = $1", [pedida, ORI]);
          }), /misma_persona_en_suspension|sin_rol_para_aprobar|company_suspensions_otra_persona/);
          await decidirCambioDeSuspension(apr, SESION_SOFIPO, { id: pedida, aprobada: true, motivo: "" });
          assert.equal((await leerCliente(ori, beta))?.estado, "suspendida");
          assert.equal(await contar(
            "select count(*)::int as n from company_state_history where company_id = $1 and suspension_id = $2 and actor_id = $3",
            [beta, pedida, APR],
          ), 1);

          // Efectos: la consola no libera el pago, ni por servicio ni por SQL directo.
          await assert.rejects(resolverPagoProveedor(rosa, sesionCliente, {
            requestId: limpio.requestId, decision: "autorizar", version: 1, totalCentavos: 200000,
          }, deps), /empresa_suspendida/);
          const portal = <T>(fn: (c: pg.Client) => Promise<T>) => como(urlApp, "plataforma_cliente", { userId: ROSA, companyId: beta }, fn);
          await assert.rejects(portal((c) => c.query(
            "update supplier_payment_requests set estado = 'listo_para_pagar', resuelto_por = $2, resuelto_en = now() where id = $1",
            [limpio.requestId, ROSA],
          )), /empresa_suspendida/);
          await assert.rejects(portal((c) => c.query("insert into payroll_batches (id, company_id) values ($1, $2)", [randomUUID(), beta])), /empresa_suspendida/);
          await assert.rejects(portal((c) => c.query("insert into cost_centers (id, company_id, nombre) values ($1, $2, 'Ventas')", [randomUUID(), beta])), /empresa_suspendida/);
          // La consola sigue ofreciendo cada acción (el contexto conserva las capacidades de los roles) y
          // la base la rechaza con su propio motivo, también por el servicio de Personas y de Finanzas.
          await assert.rejects(nombrarCentro(luis, { nombre: "Ventas", presupuesto: "1000.00" }), /empresa_suspendida/);
          assert.deepEqual(
            await cambiarAccesoFinanzas(luis, { userId: ROSA, verFinanzas: "si" }),
            { tipo: "rechazado", codigo: "empresa_suspendida", habilitado: false },
          );
          assert.equal(await contar("select count(*)::int as n from cost_centers where company_id = $1", [beta]), 0);
          assert.equal(await contar("select count(*)::int as n from membership_roles where company_id = $1 and rol = 'finanzas'", [beta]), 0);
          await assert.rejects(
            invitarPrimerAdministrador(adm, { companyId: beta, nombre: "Admin Beta", correo: "admin-beta@ejemplo.mx", vista: "" }, { produccion: false }),
            /empresa_suspendida/,
          );
          // Y si alguien se salta el servicio, la base tampoco emite la invitación.
          await assert.rejects(sofipo(ADM, (c) => c.query("insert into invitations (id, company_id) values ($1, $2)", [randomUUID(), beta])), /empresa_suspendida/);
          // Leer sí: la sesión viva queda en solo lectura.
          assert.equal(await contar("select count(*)::int as n from supplier_payment_requests where company_id = $1", [beta]), 2);
          assert.ok((await portal((c) => c.query("select id from supplier_payment_requests"))).rows.length >= 1);

          // Flujo 10: reactivar con doble firma.
          const reactivar = randomUUID();
          await solicitarCambioDeSuspension(cum, { companyId: beta, formId: reactivar, tipo: "reactivacion", motivo: "Revisión concluida sin hallazgos" });
          await assert.rejects(decidirCambioDeSuspension(apr, SESION_SOFIPO, { id: reactivar, aprobada: false, motivo: "" }), /motivo_invalido/);
          await decidirCambioDeSuspension(apr, SESION_SOFIPO, { id: reactivar, aprobada: true, motivo: "" });
          assert.equal((await leerCliente(ori, beta))?.estado, "activa");
          await resolverPagoProveedor(rosa, sesionCliente, { requestId: limpio.requestId, decision: "autorizar", version: 1, totalCentavos: 200000 }, deps);
          assert.equal(String((await dueno.query("select estado from supplier_payment_requests where id = $1", [limpio.requestId])).rows[0].estado), "listo_para_pagar");

          // Misma persona con los dos roles: la base tampoco la deja decidir lo que pidió.
          const propia = randomUUID();
          await solicitarCambioDeSuspension(mixto, { companyId: beta, formId: propia, tipo: "suspension", motivo: "Prueba de doble firma" });
          await assert.rejects(decidirCambioDeSuspension(mixto, SESION_SOFIPO, { id: propia, aprobada: true, motivo: "" }), /misma_persona_en_suspension/);
          await assert.rejects(sofipo(MIXTO, async (c) => {
            await evento(c, MIXTO, "suspension_rechazada", "company_suspensions", propia, beta);
            await c.query("update company_suspensions set estado = 'rechazada', decidida_por = $2, decidida_en = now(), motivo_decision = 'x' where id = $1", [propia, MIXTO]);
          }), /misma_persona_en_suspension/);
          await decidirCambioDeSuspension(apr, SESION_SOFIPO, { id: propia, aprobada: false, motivo: "Era una prueba" });
          assert.equal((await leerCliente(ori, beta))?.estado, "activa");
        });

        await t.test("RLS entre operadores, lecturas auditadas y Blob sin borrados", async () => {
          assert.equal(await leerExpediente(ajena, alfa), null);
          assert.deepEqual(await listarCoincidencias(ajena), []);
          const vistas = await sofipo(AJENA, (c) => c.query(
            `select (select count(*)::int from kyb_versiones) as versiones, (select count(*)::int from kyb_beneficiarios) as beneficiarios,
                    (select count(*)::int from lpb_cargas) as cargas, (select count(*)::int from lpb_coincidencias) as coincidencias,
                    (select count(*)::int from company_suspensions) as suspensiones, (select count(*)::int from kyb_calificaciones_riesgo) as riesgo`,
          ), otroOperador);
          assert.deepEqual(vistas.rows[0], { versiones: 0, beneficiarios: 0, cargas: 0, coincidencias: 0, suspensiones: 0, riesgo: 0 });
          await assert.rejects(
            como(urlApp, "plataforma_cliente", { userId: ROSA, companyId: beta }, (c) => c.query("select id from kyb_versiones")),
            /permission denied/,
          );

          const antes = await contar("select count(*)::int as n from audit_log where accion = 'expediente_consultado' and actor_id = $1", [AUD]);
          await leerExpediente(aud, alfa);
          assert.equal(await contar("select count(*)::int as n from audit_log where accion = 'expediente_consultado' and actor_id = $1", [AUD]), antes + 1);

          const documento = String((await dueno.query("select id from kyb_documentos where company_id = $1 and tipo = 'acta_constitutiva' limit 1", [alfa])).rows[0].id);
          const descarga = await prepararDescargaDocumento(aud, alfa, documento);
          assert.match(descarga.clave, new RegExp(`^expedientes/${alfa}/`));
          assert.ok(almacen.guardados.has(descarga.clave));
          const descargas = () => contar(
            "select count(*)::int as n from audit_log where accion = 'expediente_documento_descargado' and identificador = $1 and actor_id = $2",
            [documento, AUD],
          );
          assert.equal(await descargas(), 1);
          // F3: con otra empresa en la dirección no hay archivo ni evento.
          await assert.rejects(prepararDescargaDocumento(aud, beta, documento), /documento_no_existe/);
          await assert.rejects(sofipo(AUD, (c) => c.query("select * from kyb_documento_para_descarga($1, $2, null)", [documento, beta])), /documento_no_existe/);
          assert.equal(await descargas(), 1);
          await assert.rejects(prepararDescargaDocumento(adm, alfa, documento), /sin_permiso_operacion/);
          await assert.rejects(sofipo(ADM, (c) => c.query("select * from kyb_documento_para_descarga($1, $2, null)", [documento, alfa])), /sin_permiso_expediente/);
          await assert.rejects(sofipo(AJENA, (c) => c.query("select * from kyb_documento_para_descarga($1, $2, null)", [documento, alfa]), otroOperador), /documento_no_existe|sin_permiso_expediente/);

          assert.deepEqual(almacen.borrados, []);
        });

        await t.test("roles iniciales por comando: solo la dueña de la base, con evento y sin saltarse la 50ª", async () => {
          const sinQuien = (...args: string[]) => {
            const salida = spawnSync(join(process.cwd(), "node_modules/.bin/tsx"), ["scripts/plataforma.ts", "personal:rol", ...args], {
              cwd: process.cwd(), encoding: "utf8", env: { ...process.env, DATABASE_URL: "", DATABASE_URL_UNPOOLED: urlDuena },
            });
            return { estado: salida.status, texto: `${salida.stdout}${salida.stderr}`.trim() };
          };
          const comando = (...args: string[]) => sinQuien("--quien-corre", "Gil@Ejemplo.mx", ...args);
          const correoAdm = `${ADM}@ejemplo.mx`;
          const motivo = "Arranque de la 0028: acta del consejo del 10 de noviembre";
          const eventos = (accion: string) => contar(
            "select count(*)::int as n from audit_log where accion = $1 and identificador = $2 and actor_tipo = 'sistema' and origen = 'comando'",
            [accion, ADM],
          );

          // La aplicación no la ejecuta con ningún rol: ni el personal ni el portal ni la conexión de la app.
          for (const rol of ["plataforma_sofipo", "plataforma_cliente"] as const) {
            await assert.rejects(como(urlApp, rol, { userId: ADM, operadorId: operador }, (c) =>
              c.query("select personal_rol_por_comando($1, 'aprobacion', false, $2, 'gil@ejemplo.mx')", [correoAdm, motivo])), /permission denied/);
          }
          const app = new pg.Client({ connectionString: urlApp });
          await app.connect();
          await assert.rejects(app.query("select personal_rol_por_comando($1, 'aprobacion', false, $2, 'gil@ejemplo.mx')", [correoAdm, motivo]), /permission denied/);

          // N8: el comando exige el correo de quien lo corre; sin él (o con uno que no es correo) no hace nada.
          assert.match(sinQuien("--correo", correoAdm, "--rol", "aprobacion", "--motivo", motivo).texto, /Falta --quien-corre/);
          assert.match(comando("--quien-corre", "x", "--correo", correoAdm, "--rol", "aprobacion", "--motivo", motivo).texto, /--quien-corre va una sola vez/);
          assert.match(sinQuien("--quien-corre", "gil", "--correo", correoAdm, "--rol", "aprobacion", "--motivo", motivo).texto, /--quien-corre lleva el correo/);
          assert.equal(await eventos("rol_personal_asignado"), 0);
          await app.end();

          // Adriana es la única que administra al personal: el comando le da Aprobación y deja un evento.
          const asignado = comando("--correo", correoAdm.toUpperCase(), "--rol", "aprobacion", "--motivo", motivo);
          assert.equal(asignado.estado, 0, asignado.texto);
          assert.match(asignado.texto, /Se asignó el rol aprobacion/);
          assert.doesNotMatch(asignado.texto, /postgres(ql)?:\/\//);
          assert.equal(await contar("select count(*)::int as n from platform_staff_roles where user_id = $1 and rol = 'aprobacion'", [ADM]), 1);
          assert.equal(await eventos("rol_personal_asignado"), 1);
          const fila = (await dueno.query(
            "select motivo, cambio, superficie, actor_id from audit_log where accion = 'rol_personal_asignado' and identificador = $1 and origen = 'comando'",
            [ADM],
          )).rows[0];
          // F7 y N8: la conexión la dice la base (session_user); la persona, el correo que exige el comando.
          const sesionDuena = String((await dueno.query("select session_user as s")).rows[0].s);
          assert.deepEqual(fila, {
            motivo, cambio: { rol: "aprobacion", ejecutado_por: sesionDuena, corrido_por: "gil@ejemplo.mx" }, superficie: "sistema", actor_id: null,
          });

          // Repetirlo no duplica el rol ni el evento.
          const repetido = comando("--correo", correoAdm, "--rol", "aprobacion", "--motivo", motivo);
          assert.match(repetido.texto, /ya tenía el rol aprobacion/);
          assert.equal(await eventos("rol_personal_asignado"), 1);

          // Con otra persona que administra al personal, el rol se da por pantalla.
          const porPantalla = comando("--correo", `${NUEVO}@ejemplo.mx`, "--rol", "auditoria", "--motivo", motivo);
          assert.equal(porPantalla.estado, 1);
          assert.match(porPantalla.texto, /pantalla Personal/);

          // La 50ª sigue valiendo, no deja al personal sin administración y el motivo es obligatorio.
          assert.equal(comando("--correo", correoAdm, "--rol", "cumplimiento", "--motivo", motivo).estado, 0);
          const incompatible = comando("--correo", correoAdm, "--rol", "auditoria", "--motivo", motivo);
          assert.match(incompatible.texto, /Cumplimiento no se junta con Auditoría/);
          assert.match(comando("--correo", correoAdm, "--rol", "administracion_plataforma", "--motivo", motivo, "--quitar").texto, /no se queda sin administración/);
          assert.match(comando("--correo", correoAdm, "--rol", "aprobacion", "--motivo", "corto").texto, /de 10 a 500 caracteres/);
          assert.match(comando("--correo", "nadie@ejemplo.mx", "--rol", "aprobacion", "--motivo", motivo).texto, /No hay una persona activa/);
          assert.equal(await contar("select count(*)::int as n from platform_staff_roles where user_id = $1 and rol = 'auditoria'", [ADM]), 0);

          // Quitar deja su propio evento.
          const quitado = comando("--correo", correoAdm, "--rol", "aprobacion", "--motivo", motivo, "--quitar");
          assert.match(quitado.texto, /Se quitó el rol aprobacion/);
          assert.equal(await eventos("rol_personal_retirado"), 1);
          assert.equal(await contar("select count(*)::int as n from platform_staff_roles where user_id = $1 and rol = 'aprobacion'", [ADM]), 0);

          // Con la conexión agrupada ni siquiera conecta (el host lleva -pooler, como el de Neon).
          const urlAgrupada = new URL(urlDuena);
          urlAgrupada.hostname = "ep-ejemplo-pooler.neon.tech";
          const agrupada = spawnSync(join(process.cwd(), "node_modules/.bin/tsx"), ["scripts/plataforma.ts", "personal:rol", "--quien-corre", "gil@ejemplo.mx", "--correo", correoAdm, "--rol", "aprobacion", "--motivo", motivo], {
            cwd: process.cwd(), encoding: "utf8", env: { ...process.env, DATABASE_URL_UNPOOLED: urlAgrupada.toString() },
          });
          assert.equal(agrupada.status, 1);
          assert.match(agrupada.stderr, /connection string agrupado/);
        });

        // ---------- Regresiones de la revisión adversarial del PR (H1-H12, F4-F9) ----------
        const depsPagos = { almacen: almacenEnMemoria(), ahora: () => new Date() };
        const luis = cliente(LUIS, ["administrador", "liberador"], beta, operador);
        const rosa = cliente(ROSA, ["liberador"], beta, operador);
        const sesionCliente = { superficie: "cliente" as const, segundoFactor: { metodo: "totp" as const, en: new Date() } };
        const portal = <T>(fn: (c: pg.Client) => Promise<T>) => como(urlApp, "plataforma_cliente", { userId: ROSA, companyId: beta }, fn);
        // La solicitud de pago más reciente de un proveedor de Beta y los regresos que dejó el sistema.
        const solicitud = async (supplierId: string) => (await dueno.query(
          `select r.id, r.estado, r.version, r.total_centavos::int as total from supplier_payment_requests r
           join supplier_payables p on p.company_id = r.company_id and p.id = r.payable_id
           where r.company_id = $1 and p.supplier_id = $2 order by r.creado_en desc limit 1`,
          [beta, supplierId],
        )).rows[0] as { id: string; estado: string; version: number; total: number };
        const regresos = async (id: string) => (await dueno.query(
          "select actor_tipo, motivo from audit_log where accion = 'regresar_pago_proveedor' and identificador = $1 order by ocurrido_en",
          [id],
        )).rows;
        // Cada carga cambia la fecha: el mismo archivo no se carga dos veces (lpb_ya_cargada).
        const lista = (fecha: string, ...extra: string[]) => [
          "nombre,rfc,curp,tipo,fecha",
          `PEDRO RUIZ SOL,,,fisica,${fecha}`,
          `Proveedor Bloqueado SA,PBL101010AB1,,moral,${fecha}`,
          `Proveedor Tres SA,TRE101010AB3,,moral,${fecha}`,
          ...extra.map((renglon) => `${renglon},${fecha}`),
        ].join("\n");
        const BETA_EN_LISTA = "Beta Logística SA de CV,BET150301AB2,,moral";
        const cargar = (texto: string) => cargarListaBloqueadas(cum, { formId: randomUUID(), nombreArchivo: "lpb.csv", texto });
        // Una transacción en REPEATABLE READ que toma su foto al abrir, como una conexión que decide con datos viejos.
        const abrirRepetible = async (userId: string): Promise<pg.Client> => {
          const c = new pg.Client({ connectionString: urlApp });
          await c.connect();
          await c.query("begin isolation level repeatable read");
          await c.query("set local role plataforma_sofipo");
          await c.query("select set_config('app.user_id', $1, true), set_config('app.operator_id', $2, true)", [userId, operador]);
          return c;
        };
        const cerrar = async (c: pg.Client) => {
          await c.query("rollback").catch(() => undefined);
          await c.end();
        };

        await t.test("H1: desde la aplicación una empresa solo nace prospecto y real", async () => {
          // Con su evento de alta en la misma transacción, como lo intentaría alguien que se salta el servicio.
          const directa = (userId: string, estado: string, demostracion: boolean) => sofipo(userId, async (c) => {
            const id = randomUUID();
            await c.query(
              `insert into companies (id, rfc, razon_social, codigo_postal, regimen, uso_cfdi, alta_at, operator_id, estado, demostracion, originada_por)
               values ($1, 'DIR150301AB9', 'Directa SA de CV', '06600', '601', 'G03', now(), $2, $3, $4, $5)`,
              [id, operador, estado, demostracion, userId],
            );
            await evento(c, userId, "alta_empresa", "companies", id, id);
          });
          for (const userId of [ORI, ADM]) {
            for (const [estado, demostracion] of [["activa", false], ["en_alta", false], ["suspendida", false], ["baja", false], ["prospecto", true]] as const) {
              await assert.rejects(directa(userId, estado, demostracion), /empresa_nace_prospecto/, `${userId} ${estado} ${demostracion}`);
            }
          }
          assert.equal(await contar("select count(*)::int as n from companies where rfc = 'DIR150301AB9'"), 0);
        });

        await t.test("H12: lo autorizado regresa a «por autorizar» al suspender o cuando la contraparte entra a la lista", async () => {
          const limpio = await solicitud(PROVEEDOR_LIMPIO);
          assert.equal(limpio.estado, "listo_para_pagar");
          const suspender = randomUUID();
          await solicitarCambioDeSuspension(ori, { companyId: beta, formId: suspender, tipo: "suspension", motivo: "Revisión de operaciones del trimestre" });
          await decidirCambioDeSuspension(apr, SESION_SOFIPO, { id: suspender, aprobada: true, motivo: "" });
          assert.deepEqual(await solicitud(PROVEEDOR_LIMPIO), { ...limpio, estado: "por_autorizar", version: limpio.version + 1 });
          assert.deepEqual(await regresos(limpio.id), [{ actor_tipo: "sistema", motivo: "La empresa quedó suspendida. La autorización anterior se retiró." }]);
          const otraVez = { requestId: limpio.id, decision: "autorizar" as const, version: limpio.version + 1, totalCentavos: limpio.total };
          await assert.rejects(resolverPagoProveedor(rosa, sesionCliente, otraVez, depsPagos), /empresa_suspendida/);
          // Tras reactivar, el liberador lo vuelve a autorizar sobre la versión nueva.
          const reactivar = randomUUID();
          await solicitarCambioDeSuspension(cum, { companyId: beta, formId: reactivar, tipo: "reactivacion", motivo: "Revisión concluida sin hallazgos" });
          await decidirCambioDeSuspension(apr, SESION_SOFIPO, { id: reactivar, aprobada: true, motivo: "" });
          await resolverPagoProveedor(rosa, sesionCliente, otraVez, depsPagos);
          assert.equal((await solicitud(PROVEEDOR_LIMPIO)).estado, "listo_para_pagar");

          // Si la contraparte entra a la lista, regresa solo lo de ese proveedor y la empresa sigue activa.
          await dueno.query("begin");
          try {
            await sembrarProveedor(dueno, beta, operador, PROVEEDOR_TRES, "TRE101010AB3", "Proveedor Tres SA");
            await dueno.query("commit");
          } catch (error) {
            await dueno.query("rollback");
            throw error;
          }
          const tres = await crearPagoProveedor(luis, {
            clientRequestId: randomUUID(), supplierId: PROVEEDOR_TRES, origen: "excepcion", pdf: { nombre: "soporte.pdf", bytes: PDF },
            monto: "3,000.00", referencia: "Servicio de prueba", emitidaEl: hoy, venceEl: sumarMeses(hoy, 1), programadaEl: sumarMeses(hoy, 1),
            motivoExcepcion: "Servicio urgente autorizado por dirección",
          }, depsPagos);
          await resolverPagoProveedor(rosa, sesionCliente, { requestId: tres.requestId, decision: "autorizar", version: 1, totalCentavos: 300000 }, depsPagos);
          const autorizado = await solicitud(PROVEEDOR_TRES);
          assert.equal(autorizado.estado, "listo_para_pagar");
          await cargar(lista("2026-10-20"));
          assert.deepEqual(await solicitud(PROVEEDOR_TRES), { ...autorizado, estado: "por_autorizar", version: autorizado.version + 1 });
          assert.deepEqual(await regresos(tres.requestId), [
            { actor_tipo: "sistema", motivo: "Este pago quedó detenido para revisión de cumplimiento. La autorización anterior se retiró." },
          ]);
          assert.equal((await solicitud(PROVEEDOR_LIMPIO)).estado, "listo_para_pagar");
          assert.equal((await leerCliente(ori, beta))?.estado, "activa");
          await assert.rejects(resolverPagoProveedor(rosa, sesionCliente, {
            requestId: tres.requestId, decision: "autorizar", version: autorizado.version + 1, totalCentavos: 300000,
          }, depsPagos), /pago_bloqueado_lpb/);
        });

        await t.test("H3 y H6: un caso cerrado se reabre con una carga nueva y no con la misma; la reactivación con foto vieja aborta", async () => {
          const casos = async () => (await dueno.query(
            "select id, estado from lpb_coincidencias where company_id = $1 and sujeto_tipo = 'empresa' and coincide_por = 'rfc' order by detectada_en",
            [beta],
          )).rows as Array<{ id: string; estado: string }>;
          const estadoBeta = async () => (await leerCliente(ori, beta))?.estado;

          // Escenario A: fuera de lista y de vuelta en una carga posterior → caso nuevo y suspensión inmediata.
          await cargar(lista("2026-10-21", BETA_EN_LISTA));
          assert.equal(await estadoBeta(), "suspendida");
          const [primero] = await casos();
          assert.equal(primero?.estado, "pendiente");
          await cargar(lista("2026-10-22"));
          await resolverCoincidencia(cum, SESION_SOFIPO, { id: primero!.id, estado: "fuera_de_lista", motivo: "Ya no aparece en la lista del 22 de octubre" });
          const reactivar = randomUUID();
          await solicitarCambioDeSuspension(cum, { companyId: beta, formId: reactivar, tipo: "reactivacion", motivo: "La empresa salió de la lista" });
          await decidirCambioDeSuspension(apr, SESION_SOFIPO, { id: reactivar, aprobada: true, motivo: "" });
          assert.equal(await estadoBeta(), "activa");
          await cargar(lista("2026-10-23", BETA_EN_LISTA));
          assert.deepEqual((await casos()).map((k) => k.estado), ["fuera_de_lista", "pendiente"]);
          assert.equal(await estadoBeta(), "suspendida");
          assert.equal(await contar("select count(*)::int as n from company_suspensions where company_id = $1 and origen = 'lpb'", [beta]), 2);
          // Con el caso abierto no sale nómina ni pago.
          await assert.rejects(portal((c) => c.query("insert into payroll_batches (id, company_id) values ($1, $2)", [randomUUID(), beta])), /empresa_suspendida/);
          const limpio = await solicitud(PROVEEDOR_LIMPIO);
          assert.equal(limpio.estado, "por_autorizar");
          await assert.rejects(resolverPagoProveedor(rosa, sesionCliente, {
            requestId: limpio.id, decision: "autorizar", version: limpio.version, totalCentavos: limpio.total,
          }, depsPagos), /empresa_suspendida/);

          // Escenario B: falso positivo exacto. Con la misma carga no se reabre.
          const segundo = (await casos())[1]!;
          await resolverCoincidencia(cum, SESION_SOFIPO, { id: segundo.id, estado: "falso_positivo", motivo: "El RFC de la lista es de otra persona moral" });
          assert.equal(Number((await dueno.query("select lpb_cotejar_empresa($1) as n", [beta])).rows[0].n), 0);
          assert.equal((await casos()).length, 2);

          // H6: Aprobación decide la reactivación con su foto de antes del cotejo de una carga nueva: la base la aborta.
          const pedida = randomUUID();
          await solicitarCambioDeSuspension(cum, { companyId: beta, formId: pedida, tipo: "reactivacion", motivo: "Dictamen de falso positivo" });
          const vieja = await abrirRepetible(APR);
          try {
            await vieja.query("select count(*) from lpb_coincidencias where company_id = $1", [beta]);
            await cargar(lista("2026-10-24", BETA_EN_LISTA));
            // La decisión misma escribe la fila de la empresa antes de leer los casos abiertos: ahí aborta.
            await assert.rejects(
              vieja.query("update company_suspensions set estado = 'aprobada', decidida_por = $2, decidida_en = now() where id = $1", [pedida, APR]),
              /could not serialize/,
            );
          } finally {
            await cerrar(vieja);
          }
          // Con una carga nueva el falso positivo exacto sí se reabre.
          assert.deepEqual((await casos()).map((k) => k.estado), ["fuera_de_lista", "falso_positivo", "pendiente"]);
          assert.equal(await estadoBeta(), "suspendida");
          await assert.rejects(decidirCambioDeSuspension(apr, SESION_SOFIPO, { id: pedida, aprobada: true, motivo: "" }), /reactivacion_con_coincidencia_lpb/);
          await decidirCambioDeSuspension(apr, SESION_SOFIPO, { id: pedida, aprobada: false, motivo: "Volvió a aparecer en la lista del 24 de octubre" });

          // Una posible por nombre descartada como falso positivo no se reabre, aunque el nombre siga en cada carga.
          assert.equal(await contar(
            "select count(*)::int as n from lpb_coincidencias where company_id = $1 and coincide_por = 'nombre' and valor_coincidente = 'PEDRO RUIZ SOL'",
            [alfa],
          ), 1);
        });

        await t.test("H2: solo Administración escribe el personal, la 69-B, el precio, invitaciones y membresías", async () => {
          const intentos: Array<[string, (c: pg.Client) => Promise<unknown>]> = [
            ["personal", (c) => c.query("update platform_staff set estado = estado where user_id = $1", [NUEVO])],
            ["69-B", (c) => c.query("insert into lista_69b_snapshots (id, operator_id, fecha_archivo, cargado_en) values ($1, $2, current_date, now())", [randomUUID(), operador])],
            ["precio", (c) => c.query("update platform_pricing set suscripcion_centavos = 100000, publicado_en = now()")],
            ["invitación", (c) => c.query("insert into invitations (id, company_id) values ($1, $2)", [randomUUID(), alfa])],
            ["membresía", (c) => c.query("insert into memberships (user_id, company_id, estado) values ($1, $2, 'activa')", [LUIS, alfa])],
          ];
          for (const userId of [ORI, APR, CUM, AUD]) {
            for (const [que, intento] of intentos) await assert.rejects(sofipo(userId, intento), /sin_rol_de_administracion/, `${userId}: ${que}`);
          }
          // Nadie cambia su propio registro del personal, tampoco Administración; a otra persona, Administración sí.
          for (const userId of [ADM, AUD]) {
            await assert.rejects(sofipo(userId, (c) => c.query("update platform_staff set estado = estado where user_id = $1", [userId])), /personal_propio/);
          }
          await sofipo(ADM, (c) => c.query("update platform_staff set estado = estado where user_id = $1", [NUEVO]));
          assert.equal(await contar("select count(*)::int as n from memberships where company_id = $1", [alfa]), 0);

          // La 69-B es de cada operador. La que carga Administración de otro operador (con Alfa y un
          // proveedor de Beta en definitivo) no coteja, no relee ni la ve este operador.
          await dueno.query("insert into platform_staff_roles (operator_id, user_id, rol) values ($1, $2, 'administracion_plataforma')", [otroOperador, AJENA]);
          const copiaAjena = randomUUID();
          await sofipo(AJENA, async (c) => {
            await c.query("insert into lista_69b_snapshots (id, operator_id, fecha_archivo, cargado_en) values ($1, $2, current_date, now())", [copiaAjena, otroOperador]);
            await c.query("insert into lista_69b_rows (snapshot_id, rfc, situacion) values ($1, 'ALF150301AB1', 'Definitivo'), ($1, 'LIM101010AB2', 'Definitivo')", [copiaAjena]);
            await c.query(
              `insert into audit_log (operator_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, origen)
               values ($1, 'personal', $2, 'sofipo', 'cargar_lista_69b', 'lista_69b_snapshots', $3, 'operacion')`,
              [otroOperador, AJENA, copiaAjena],
            );
          }, otroOperador);
          assert.equal((await leerCliente(ori, alfa))?.estado, "activa");
          assert.equal(await contar("select count(*)::int as n from lpb_coincidencias where snapshot_69b_id = $1", [copiaAjena]), 0);
          assert.equal(await contar("select count(*)::int as n from suppliers where snapshot_id = $1", [copiaAjena]), 0);
          const copias = async (leer: (fn: (c: pg.Client) => Promise<pg.QueryResult>) => Promise<pg.QueryResult>) =>
            (await leer((c) => c.query("select id from lista_69b_snapshots order by cargado_en"))).rows.map((fila) => String(fila.id));
          assert.deepEqual(await copias((fn) => sofipo(AJENA, fn, otroOperador)), [copiaAjena]);
          assert.ok(!(await copias((fn) => sofipo(ADM, fn))).includes(copiaAjena));
          assert.deepEqual(await copias(portal), [COPIA_69B]);
          assert.equal(Number((await portal((c) => c.query("select count(*)::int as n from lista_69b_rows where snapshot_id = $1", [copiaAjena]))).rows[0].n), 0);
          await assert.rejects(sofipo(AJENA, (c) => c.query("insert into lista_69b_rows (snapshot_id, rfc, situacion) values ($1, 'ALF150301AB1', 'Definitivo')", [COPIA_69B]), otroOperador), /row-level security/);
          // Con la copia del otro operador como la más reciente, Cumplimiento carga su LPB: el cotejo usa la
          // copia de su operador y Alfa sigue activa, sin casos del 69-B.
          await cargar(lista("2026-10-25"));
          assert.equal((await leerCliente(ori, alfa))?.estado, "activa");
          assert.equal(await contar("select count(*)::int as n from lpb_coincidencias where lista = '69b'"), 0);
          // Una copia limpia de Administración del operador vuelve a ser la vigente para lo que sigue.
          const copiaLimpia = randomUUID();
          await sofipo(ADM, async (c) => {
            await c.query("insert into lista_69b_snapshots (id, operator_id, fecha_archivo, cargado_en) values ($1, $2, current_date, now())", [copiaLimpia, operador]);
            await c.query("insert into lista_69b_rows (snapshot_id, rfc, situacion) values ($1, 'PAL7202161U0', 'Presunto')", [copiaLimpia]);
            await evento(c, ADM, "cargar_lista_69b", "lista_69b_snapshots", copiaLimpia);
          });
          assert.equal((await leerCliente(ori, alfa))?.estado, "activa");
          assert.equal(await contar("select count(*)::int as n from lpb_coincidencias where lista = '69b'"), 0);
        });

        let epsilon = "";
        let epsilonV1 = "";
        await t.test("H6, H7, H8 y N3: la 50ª con foto vieja aborta, sin usuario nadie da roles y un evento por cosa", async () => {
          // H7 y N3: sin usuario nadie da Administración ni registra personal, aunque traiga el evento
          // del alta del sistema. La primera Administración la da la dueña de la base.
          const sinUsuario = <T>(fn: (c: pg.Client) => Promise<T>) => como(urlApp, "plataforma_sofipo", { userId: "", operadorId: operador }, fn);
          const altaDelSistema = (c: pg.Client, userId: string) => c.query(
            `insert into audit_log (operator_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, origen, cambio)
             values ($1, 'sistema', null, 'sistema', 'alta_personal', 'platform_staff', $2, 'operacion', '{"rol": "administracion_plataforma"}')`,
            [operador, userId],
          );
          await assert.rejects(sinUsuario(async (c) => {
            await altaDelSistema(c, NUEVO);
            await c.query("insert into platform_staff_roles (operator_id, user_id, rol) values ($1, $2, 'administracion_plataforma')", [operador, NUEVO]);
          }), /sin_permiso_roles/);
          await dueno.query("insert into users (id, nombre, correo) values ($1, 'Rita Rápida', $2)", [RITA, `${RITA}@ejemplo.mx`]);
          await assert.rejects(sinUsuario(async (c) => {
            await c.query("insert into platform_staff (operator_id, user_id, estado) values ($1, $2, 'activo')", [operador, RITA]);
            await altaDelSistema(c, RITA);
            await c.query("insert into platform_staff_roles (operator_id, user_id, rol) values ($1, $2, 'administracion_plataforma')", [operador, RITA]);
          }), /sin_rol_de_administracion/);
          // N3: tampoco a quien nace invitado en la misma transacción, que era lo que hacía la migración retirada.
          await assert.rejects(sinUsuario(async (c) => {
            await c.query("insert into platform_staff (operator_id, user_id, estado) values ($1, $2, 'invitado')", [operador, RITA]);
            await altaDelSistema(c, RITA);
            await c.query("insert into platform_staff_roles (operator_id, user_id, rol) values ($1, $2, 'administracion_plataforma')", [operador, RITA]);
          }), /sin_rol_de_administracion/);
          assert.equal(await contar("select count(*)::int as n from platform_staff where user_id = $1", [RITA]), 0);
          // El comando de la dueña no adivina el operador: con dos, no invita a nadie.
          await assert.rejects(invitarPersonalComoDuena(urlDuena, [`${RITA}@ejemplo.mx`], "gil@ejemplo.mx"), /operador_ambiguo/);
          assert.equal(await contar(
            "select count(*)::int as n from platform_staff_roles where user_id in ($1, $2) and rol = 'administracion_plataforma'",
            [NUEVO, RITA],
          ), 0);

          // H8: el evento del alta solo cubre a quien nace en esta transacción; cada rol lleva el suyo, con su entidad.
          const asignar = (eventos: Array<[string, string, string]>, roles: string[]) => sofipo(ADM, async (c) => {
            for (const [accion, entidad, rol] of eventos) await evento(c, ADM, accion, entidad, NUEVO, null, { rol });
            for (const rol of roles) await c.query("insert into platform_staff_roles (operator_id, user_id, rol) values ($1, $2, $3)", [operador, NUEVO, rol]);
          });
          await assert.rejects(asignar([["alta_personal", "platform_staff", "aprobacion"]], ["aprobacion"]), /rol_personal_sin_auditoria/);
          await assert.rejects(asignar([["rol_personal_asignado", "platform_staff_roles", "aprobacion"]], ["aprobacion", "administracion_plataforma"]), /rol_personal_sin_auditoria/);
          await assert.rejects(asignar([["rol_personal_asignado", "platform_staff_roles", "aprobacion,administracion_plataforma"]], ["aprobacion"]), /rol_personal_sin_auditoria/);
          await assert.rejects(asignar([["rol_personal_asignado", "platform_staff", "aprobacion"]], ["aprobacion"]), /rol_personal_sin_auditoria/);
          assert.equal(await contar(
            "select count(*)::int as n from platform_staff_roles where user_id = $1 and rol in ('aprobacion', 'administracion_plataforma')",
            [NUEVO],
          ), 0);

          // H8: el evento del dictamen tiene que ser de la misma empresa y de la misma entidad.
          epsilon = await prospecto("EPS150301AB5", "Épsilon Agro SA de CV");
          ({ versionId: epsilonV1 } = await armarBorrador(ori, { companyId: epsilon, razonSocial: "Épsilon Agro SA de CV", rfc: "EPS150301AB5", almacen }));
          await enviarVersion(ori, epsilonV1);
          const dictamenConEvento = (empresaDelEvento: string, entidad: string) => sofipo(CUM, async (c) => {
            const id = randomUUID();
            await evento(c, CUM, "expediente_dictaminado", entidad, id, empresaDelEvento);
            await c.query(
              `insert into kyb_dictamenes (id, version_id, company_id, operator_id, resultado, dictaminado_por, dictaminado_en)
               values ($1, $2, $3, $4, 'aprobado', $5, now())`,
              [id, epsilonV1, epsilon, operador, CUM],
            );
          });
          await assert.rejects(dictamenConEvento(alfa, "kyb_dictamenes"), /regulado_sin_auditoria/);
          await assert.rejects(dictamenConEvento(epsilon, "kyb_versiones"), /regulado_sin_auditoria/);
          assert.equal(await contar("select count(*)::int as n from kyb_dictamenes where version_id = $1", [epsilonV1]), 0);

          // H6: en REPEATABLE READ la segunda asignación decide con una foto vieja de los roles: la base la aborta.
          await dueno.query("insert into platform_staff (operator_id, user_id, estado) values ($1, $2, 'activo')", [operador, RITA]);
          const vieja = await abrirRepetible(ADM);
          try {
            await vieja.query("select count(*) from platform_staff_roles where user_id = $1", [RITA]);
            await sofipo(ADM, async (c) => {
              await evento(c, ADM, "rol_personal_asignado", "platform_staff_roles", RITA, null, { rol: "cumplimiento" });
              await c.query("insert into platform_staff_roles (operator_id, user_id, rol) values ($1, $2, 'cumplimiento')", [operador, RITA]);
            });
            await evento(vieja, ADM, "rol_personal_asignado", "platform_staff_roles", RITA, null, { rol: "auditoria" });
            await assert.rejects(
              vieja.query("insert into platform_staff_roles (operator_id, user_id, rol) values ($1, $2, 'auditoria')", [operador, RITA]),
              /could not serialize/,
            );
          } finally {
            await cerrar(vieja);
          }
          assert.deepEqual((await dueno.query("select rol from platform_staff_roles where user_id = $1", [RITA])).rows, [{ rol: "cumplimiento" }]);
        });

        await t.test("H9: las funciones del sistema no responden por otro operador ni sin contexto", async () => {
          const responde = async (userId: string, op: string, sql: string, params: unknown[]) =>
            (await sofipo(userId, (c) => c.query(sql, params), op)).rows[0].r as unknown;
          const tieneRol = "select personal_tiene_rol($1, $2, array['administracion_plataforma']) as r";
          assert.equal(await responde(ADM, operador, tieneRol, [operador, ADM]), true);
          assert.equal(await responde(AJENA, otroOperador, tieneRol, [operador, ADM]), false);
          assert.equal(await responde("", "", tieneRol, [operador, ADM]), false);
          const carga = "select lpb_carga_vigente($1) as r";
          assert.ok(await responde(CUM, operador, carga, [operador]));
          assert.equal(await responde(AJENA, otroOperador, carga, [operador]), null);
          assert.equal(await responde("", "", carga, [operador]), null);
          const abiertas = "select lpb_coincidencias_abiertas($1) as r";
          assert.equal(await responde(CUM, operador, abiertas, [beta]), true);
          assert.equal(await responde(AJENA, otroOperador, abiertas, [beta]), false);
          assert.equal(await responde("", "", abiertas, [beta]), false);
          // La dueña de la base (migraciones y comandos) responde sin contexto.
          assert.equal((await dueno.query(abiertas, [beta])).rows[0].r, true);
        });

        let ximena = "";
        let ximenaV1 = "";
        await t.test("H5 y H10: CURP y RFC obligatorios al enviar, suma por CURP y estructura de hasta 10 capas", async () => {
          const enviarCon = async (rfc: string, razonSocial: string, socios: SocioDePrueba[]) => {
            const companyId = await prospecto(rfc, razonSocial);
            const { versionId } = await armarBorrador(ori, { companyId, razonSocial, rfc, socios, almacen });
            return { companyId, versionId, enviar: () => enviarVersion(ori, versionId) };
          };
          // Ximena tiene 12.5 % directo y 87.5 % × 14.29 % por Holding Dos.
          const caminos = (segundaCurp?: string): SocioDePrueba[] => [
            { nombre: "Ximena Torres Paz", tipoPersona: "fisica", rfc: "TOPX800101AB4", curp: "TOPX800101MDFRZM05", capital: "12.5", votos: "12.5" },
            {
              nombre: "Holding Dos SA de CV", tipoPersona: "moral", rfc: "HDO100101AA2", capital: "87.5", votos: "87.5",
              hijos: [
                { nombre: "Yolanda Ruiz Sol", tipoPersona: "fisica", rfc: "RUSY750101AB6", curp: "RUSY750101MDFZLL06", capital: "85.71", votos: "85.71" },
                { nombre: "Ximena Torres Paz", tipoPersona: "fisica", rfc: "TOPX800101AB4", curp: segundaCurp, capital: "14.29", votos: "14.29" },
              ],
            },
          ];
          // Con solo el RFC en el segundo camino se partía en dos y quedaba fuera de los propietarios reales.
          await assert.rejects((await enviarCon("SCU150301AB5", "Sin Curp SA de CV", caminos())).enviar(), /expediente_accionista_sin_curp/);
          await assert.rejects((await enviarCon("SRF150301AB6", "Sin Rfc SA de CV", [{
            nombre: "Holding Sin RFC SA de CV", tipoPersona: "moral", capital: "100", votos: "100",
            hijos: [{ nombre: "Laura Gómez Ruiz", tipoPersona: "fisica", rfc: "GORL750505QW1", curp: "GORL750505MDFMZR04", capital: "100", votos: "100" }],
          }])).enviar(), /expediente_accionista_sin_rfc/);
          // Con su CURP en los dos caminos suma 25.0038 %: propietaria real por capital.
          const conCurp = await enviarCon("XIM150301AB7", "Ximena Inversiones SA de CV", caminos("TOPX800101MDFRZM05"));
          await conCurp.enviar();
          ({ companyId: ximena, versionId: ximenaV1 } = conCurp);
          assert.deepEqual((await dueno.query(
            "select nombre, motivo, capital_pct::text as capital, capas from kyb_beneficiarios where version_id = $1 order by nombre",
            [ximenaV1],
          )).rows, [
            { nombre: "Ximena Torres Paz", motivo: "capital", capital: "25.0038", capas: 2 },
            { nombre: "Yolanda Ruiz Sol", motivo: "control", capital: "74.9963", capas: 2 },
          ]);

          // H10: once capas (diez morales y la dueña final). Antes pasaba como completa y la dueña quedaba fuera del cálculo.
          let cadena: SocioDePrueba[] = [
            { nombre: "Dulce Final Nava", tipoPersona: "fisica", rfc: "FINA700101AB7", curp: "FINA700101MDFNVL07", capital: "100", votos: "100" },
          ];
          for (let capa = 10; capa >= 1; capa -= 1) {
            cadena = [{ nombre: `Capa ${capa} SA de CV`, tipoPersona: "moral", rfc: `CAP1001${String(capa).padStart(2, "0")}AA1`, capital: "100", votos: "100", hijos: cadena }];
          }
          await assert.rejects((await enviarCon("PRF150301AB8", "Profunda SA de CV", cadena)).enviar(), /expediente_estructura_muy_profunda/);
        });

        await t.test("N2: el socio extranjero sin CURP se identifica con país, documento y fecha de nacimiento y suma una vez", async () => {
          const enviarCon = async (rfc: string, razonSocial: string, socios: SocioDePrueba[]) => {
            const companyId = await prospecto(rfc, razonSocial);
            const { versionId } = await armarBorrador(ori, { companyId, razonSocial, rfc, socios, almacen });
            return { versionId, enviar: () => enviarVersion(ori, versionId) };
          };
          const propietarios = async (versionId: string) => (await dueno.query(
            "select nombre, motivo, capital_pct::text as capital from kyb_beneficiarios where version_id = $1 order by nombre",
            [versionId],
          )).rows;
          const john = (capital: string, documento?: string, fecha?: string): SocioDePrueba => ({
            nombre: "John Smith Taylor", tipoPersona: "fisica", pais: "US", documentoExtranjero: documento, fechaNacimiento: fecha, capital, votos: capital,
          });
          const laura: SocioDePrueba = { nombre: "Laura Gómez Ruiz", tipoPersona: "fisica", rfc: "GORL750505QW1", curp: "GORL750505MDFMZR04", capital: "60", votos: "60" };

          // Con 40 % directo, sin CURP pero con su pasaporte y fecha de nacimiento, se envía y es propietario real.
          const directo = await enviarCon("EXD150301AB1", "Extranjero Directo SA de CV", [laura, john("40", "X1234567", "1980-05-01")]);
          await directo.enviar();
          assert.deepEqual(await propietarios(directo.versionId), [
            { nombre: "John Smith Taylor", motivo: "capital", capital: "40.0000" },
            { nombre: "Laura Gómez Ruiz", motivo: "control", capital: "60.0000" },
          ]);
          assert.deepEqual((await dueno.query(
            "select nacionalidad, pais, documento_extranjero, fecha_nacimiento::text as nacimiento from kyb_accionistas where version_id = $1 and curp is null",
            [directo.versionId],
          )).rows, [{ nacionalidad: "Estados Unidos", pais: "US", documento_extranjero: "X1234567", nacimiento: "1980-05-01" }]);

          // El mismo documento por dos caminos (escrito distinto) suma una vez: 12.5 % + 87.5 % × 14.29 % = 25.0038 %.
          const dosCaminos = await enviarCon("EXC150301AB2", "Extranjero Caminos SA de CV", [
            john("12.5", "x12-345 678", "1980-05-01"),
            {
              nombre: "Holding Dos SA de CV", tipoPersona: "moral", rfc: "HDO100101AA2", capital: "87.5", votos: "87.5",
              hijos: [
                { nombre: "Yolanda Ruiz Sol", tipoPersona: "fisica", rfc: "RUSY750101AB6", curp: "RUSY750101MDFZLL06", capital: "85.71", votos: "85.71" },
                john("14.29", "X12345678", "1980-05-01"),
              ],
            },
          ]);
          await dosCaminos.enviar();
          assert.deepEqual(await propietarios(dosCaminos.versionId), [
            { nombre: "John Smith Taylor", motivo: "capital", capital: "25.0038" },
            { nombre: "Yolanda Ruiz Sol", motivo: "control", capital: "74.9963" },
          ]);

          // Sin documento o sin fecha de nacimiento el servidor no lo captura (la base tampoco lo deja
          // enviar: N2-resto); el mexicano sin CURP no se envía.
          await assert.rejects(enviarCon("EXS150301AB3", "Extranjero Sin Documento SA de CV", [laura, john("40", undefined, "1980-05-01")]), /dato_invalido_documentoExtranjero/);
          await assert.rejects(enviarCon("EXF150301AB4", "Extranjero Sin Fecha SA de CV", [laura, john("40", "X1234567")]), /dato_invalido_fechaNacimiento/);
          await assert.rejects((await enviarCon("MXS150301AB5", "Mexicano Sin Curp SA de CV", [laura, { ...laura, nombre: "Mario Paz Lira", curp: undefined, rfc: undefined, capital: "40", votos: "40" }])).enviar(), /expediente_accionista_sin_curp/);
          // México no es país extranjero, ni por el servidor ni por SQL.
          const borrador = await enviarCon("EXM150301AB6", "Extranjero Mexico SA de CV", [laura, john("40", "X1234567", "1980-05-01")]);
          await assert.rejects(agregarAccionista(ori, {
            versionId: borrador.versionId, formId: randomUUID(), padreClave: "", tipoPersona: "fisica", nombre: "Ana Ruiz", rfc: "", curp: "",
            pais: "MX", documentoExtranjero: "X1234567", fechaNacimiento: "1980-05-01", capital: "1", votos: "1", controlOtrosMedios: false, pep: "no",
          }), /dato_invalido_pais/);
          await assert.rejects(dueno.query("update kyb_accionistas set pais = 'MX' where version_id = $1 and pais = 'US'", [borrador.versionId]), /kyb_accionistas_extranjero|expediente_no_se_reescribe/);
        });

        await t.test("N2-resto y N6: la misma persona con dos identificadores no se parte; la moral extranjera se identifica con país y registro", async () => {
          const enviarCon = async (rfc: string, razonSocial: string, socios: SocioDePrueba[]) => {
            const companyId = await prospecto(rfc, razonSocial);
            const { versionId } = await armarBorrador(ori, { companyId, razonSocial, rfc, socios, almacen });
            return { companyId, versionId, enviar: () => enviarVersion(ori, versionId) };
          };
          const propietarios = async (versionId: string) => (await dueno.query(
            "select nombre, motivo, capital_pct::text as capital from kyb_beneficiarios where version_id = $1 order by nombre",
            [versionId],
          )).rows;
          const laura: SocioDePrueba = { nombre: "Laura Gómez Ruiz", tipoPersona: "fisica", rfc: "GORL750505QW1", curp: "GORL750505MDFMZR04", capital: "55", votos: "55" };
          const pedro: SocioDePrueba = { nombre: "Pedro Paz Ruiz", tipoPersona: "fisica", rfc: "PARP800101AB1", curp: "PARP800101HDFZZD01", capital: "50", votos: "50" };
          // La misma persona con 15 % directo y la mitad de un holding con 30 %: suma 30 %.
          const partida = (directo: SocioDePrueba, enHolding: SocioDePrueba, rfcHolding: string): SocioDePrueba[] => [
            laura,
            directo,
            { nombre: `Holding ${rfcHolding} SA de CV`, tipoPersona: "moral", rfc: rfcHolding, capital: "30", votos: "30", hijos: [enHolding, pedro] },
          ];
          const john = (capital: string, extra: Partial<SocioDePrueba> = {}): SocioDePrueba => ({
            nombre: "John Smith Taylor", tipoPersona: "fisica", pais: "US", documentoExtranjero: "X12345678", fechaNacimiento: "1980-05-01",
            capital, votos: capital, ...extra,
          });

          // (c) Con CURP en un camino y pasaporte en otro. Con país, el documento y la fecha van siempre,
          // aunque traiga CURP: el servidor no lo captura sin ellos y la base no lo deja enviar.
          await assert.rejects(
            enviarCon("NCA150301AB1", "Partida Curp SA de CV", partida(john("15"), john("50", { curp: "SMTJ800501HNETYH09", documentoExtranjero: undefined, fechaNacimiento: undefined }), "HPA100101AA1")),
            /dato_invalido_documentoExtranjero/,
          );
          const porSql = await enviarCon("NCB150301AB2", "Partida Sql SA de CV", [laura, john("15"), {
            nombre: "Holding Sql SA de CV", tipoPersona: "moral", rfc: "HSQ100101AA1", capital: "30", votos: "30", hijos: [pedro],
          }]);
          const holding = String((await dueno.query("select clave from kyb_accionistas where version_id = $1 and tipo_persona = 'moral'", [porSql.versionId])).rows[0].clave);
          await sofipo(ORI, async (c) => {
            const id = randomUUID();
            await c.query(
              `insert into kyb_accionistas (id, version_id, company_id, operator_id, clave, padre_clave, tipo_persona, nombre, curp, nacionalidad, pais,
                 capital_bp, votos_bp, pep, creado_por, creado_en)
               values ($1, $2, $3, $4, gen_random_uuid(), $5, 'fisica', 'John Smith Taylor', 'SMTJ800501HNETYH09', 'Estados Unidos', 'US', 5000, 5000, 'no', $6, now())`,
              [id, porSql.versionId, porSql.companyId, operador, holding, ORI],
            );
            await evento(c, ORI, "expediente_accionista_agregado", "kyb_accionistas", id, porSql.companyId);
          });
          await assert.rejects(porSql.enviar(), /expediente_accionista_sin_identificacion/);
          // Con el mismo pasaporte en los dos caminos (y la CURP en uno) suma 30 % y es propietario real.
          const conCurp = await enviarCon("NCC150301AB3", "Partida Junta SA de CV", partida(john("15"), john("50", { curp: "SMTJ800501HNETYH09" }), "HPJ100101AA1"));
          await conCurp.enviar();
          assert.deepEqual(await propietarios(conCurp.versionId), [
            { nombre: "John Smith Taylor", motivo: "capital", capital: "30.0000" },
            { nombre: "Laura Gómez Ruiz", motivo: "control", capital: "55.0000" },
          ]);

          // La fecha de la CURP: siglo por la posición 17 y una fecha imposible no cuenta.
          assert.deepEqual((await dueno.query(
            `select kyb_fecha_de_curp('EARJ800101HDFTZR01')::text as antes, kyb_fecha_de_curp('EARJ050101HDFTZRA1')::text as despues,
                    kyb_fecha_de_curp('EARJ991340HDFTZR01') as imposible`,
          )).rows, [{ antes: "1980-01-01", despues: "2005-01-01", imposible: null }]);

          // (d) Un mexicano declarado extranjero en un camino y con su CURP en otro: mismo nombre (escrito
          // en otro orden y sin acentos) y la fecha de su CURP. La base no lo deja enviar.
          const jorgeExtranjero: SocioDePrueba = {
            nombre: "Jorge Eta Ruiz", tipoPersona: "fisica", pais: "US", documentoExtranjero: "567890123", fechaNacimiento: "1980-01-01", capital: "15", votos: "15",
          };
          const jorgeMexicano: SocioDePrueba = { nombre: "RUIZ, Jorge Etá", tipoPersona: "fisica", rfc: "EARJ800101AB1", curp: "EARJ800101HDFTZR01", capital: "50", votos: "50" };
          await assert.rejects(
            (await enviarCon("NCD150301AB4", "Partida Nacional SA de CV", partida(jorgeExtranjero, jorgeMexicano, "HET100101AA1"))).enviar(),
            /expediente_misma_persona_dos_identificadores/,
          );
          // (e) El mismo extranjero con pasaporte en un camino e identificación nacional en otro.
          await assert.rejects(
            (await enviarCon("NCE150301AB5", "Partida Documentos SA de CV", partida(john("15"), john("50", { documentoExtranjero: "D98765432" }), "HDC100101AA1"))).enviar(),
            /expediente_misma_persona_dos_identificadores/,
          );
          // Dos personas distintas con el mismo nombre y otra fecha sí se envían.
          const homonimos = await enviarCon("NCF150301AB6", "Homonimos SA de CV", partida(john("15"), john("50", { documentoExtranjero: "D98765432", fechaNacimiento: "1990-02-02" }), "HHO100101AA1"));
          await homonimos.enviar();
          // base-N16: dos mexicanos homónimos nacidos el mismo día, con CURP distinta, son dos personas.
          const juan = (rfc: string, curp: string, capital: string): SocioDePrueba => ({
            nombre: "Juan Hernández García", tipoPersona: "fisica", rfc, curp, capital, votos: capital,
          });
          const reales = await enviarCon("NCJ150301AC1", "Homonimos Reales SA de CV",
            partida(juan("HEGJ800101AB1", "HEGJ800101HDFRRN01", "15"), juan("HEGJ800101AB2", "HEGJ800101HJCRRN09", "50"), "HHR100101AA1"));
          await reales.enviar();
          // Con la misma CURP en los dos caminos (uno declarado extranjero con pasaporte) es la misma persona.
          await assert.rejects(
            (await enviarCon("NCK150301AC2", "Partida Misma Curp SA de CV", partida(
              john("15", { curp: "SMTJ800501HNETYH09" }),
              { nombre: "John Smith Taylor", tipoPersona: "fisica", rfc: "SITJ800501AB1", curp: "SMTJ800501HNETYH09", capital: "50", votos: "50" },
              "HMC100101AA1",
            ))).enviar(),
            /expediente_misma_persona_dos_identificadores/,
          );

          // N6: una LLC de EE. UU. con 45 %, sin RFC mexicano, se identifica con su país y su registro. Su
          // dueño final sale como propietario real.
          const llc: SocioDePrueba = {
            nombre: "Delaware Holdings LLC", tipoPersona: "moral", pais: "US", documentoExtranjero: "12-3456789", capital: "45", votos: "45",
            hijos: [john("100")],
          };
          await assert.rejects(
            enviarCon("NCG150301AB7", "Matriz Sin Registro SA de CV", [laura, { ...llc, documentoExtranjero: undefined }]),
            /dato_invalido_documentoExtranjero/,
          );
          const matriz = await enviarCon("NCH150301AB8", "Matriz Extranjera SA de CV", [laura, llc]);
          await matriz.enviar();
          assert.deepEqual(await propietarios(matriz.versionId), [
            { nombre: "John Smith Taylor", motivo: "capital", capital: "45.0000" },
            { nombre: "Laura Gómez Ruiz", motivo: "control", capital: "55.0000" },
          ]);
          assert.deepEqual((await dueno.query(
            "select rfc, nacionalidad, pais, documento_extranjero, fecha_nacimiento from kyb_accionistas where version_id = $1 and tipo_persona = 'moral'",
            [matriz.versionId],
          )).rows, [{ rfc: null, nacionalidad: "Estados Unidos", pais: "US", documento_extranjero: "123456789", fecha_nacimiento: null }]);
          // La moral extranjera no lleva fecha de nacimiento, ni por SQL (en un borrador).
          const enBorrador = await enviarCon("NCI150301AB9", "Matriz Borrador SA de CV", [laura, llc]);
          await assert.rejects(sofipo(ORI, (c) => c.query(
            `insert into kyb_accionistas (id, version_id, company_id, operator_id, clave, tipo_persona, nombre, nacionalidad, pais,
               documento_extranjero, fecha_nacimiento, capital_bp, votos_bp, pep, creado_por, creado_en)
             values (gen_random_uuid(), $1, $2, $3, gen_random_uuid(), 'moral', 'Otra Holdings LLC', 'Estados Unidos', 'US', '98765432',
               '1990-01-01', 100, 100, 'no', $4, now())`,
            [enBorrador.versionId, enBorrador.companyId, operador, ORI],
          )), /kyb_accionistas_extranjero/);
        });

        await t.test("H11: el portal no lee en la bitácora lo de Cumplimiento; que está suspendida, sí", async () => {
          const vistos = (await portal((c) => c.query(
            `select count(*) filter (where entidad like 'kyb\\_%' or entidad like 'lpb\\_%' or entidad = 'company_suspensions'
                                     or accion like 'expediente\\_%')::int as regulados,
                    count(*)::int as total
             from audit_log`,
          ))).rows[0] as { regulados: number; total: number };
          assert.equal(vistos.regulados, 0);
          assert.ok(vistos.total > 0);
          assert.ok(await contar(
            `select count(*)::int as n from audit_log
             where company_id = $1 and (entidad like 'kyb\\_%' or entidad like 'lpb\\_%' or entidad = 'company_suspensions')`,
            [beta],
          ) > 0);
          assert.equal((await portal((c) => c.query("select estado from companies where id = $1", [beta]))).rows[0].estado, "suspendida");
        });

        await t.test("F4 y F5: un doble envío simultáneo deja una fila y un evento; un formulario ajeno no se da por hecho", async () => {
          const ambos = <T>(fn: () => Promise<T>) => Promise.allSettled([fn(), fn()]);
          const salida = (resultados: PromiseSettledResult<unknown>[]) => resultados
            .map((r) => (r.status === "fulfilled" ? "ok" : String((r.reason as { codigo?: string }).codigo ?? r.reason)))
            .sort();
          const eventos = (accion: string, id: string) =>
            contar("select count(*)::int as n from audit_log where accion = $1 and identificador = $2", [accion, id]);
          const deAlfa = async (sql: string) => String((await dueno.query(sql, [alfaV2])).rows[0].id);
          const repAlfa = await deAlfa("select id from kyb_representantes where version_id = $1 limit 1");
          const socioAlfa = await deAlfa("select id from kyb_accionistas where version_id = $1 limit 1");
          const docAlfa = await deAlfa("select documento_id as id from kyb_version_documentos where version_id = $1 limit 1");
          const dictamenAlfa = await deAlfa("select id from kyb_dictamenes where version_id = $1");
          const riesgoAlfa = await deAlfa("select id from kyb_calificaciones_riesgo where version_id = $1 limit 1");

          // Versión: el mismo formulario en dos pestañas crea una; dos formularios distintos, una y «ya hay borrador».
          const kappa = await prospecto("KAP150301AB9", "Kappa Textil SA de CV");
          const kappaV1 = randomUUID();
          assert.deepEqual(salida(await ambos(() => crearVersion(ori, { companyId: kappa, formId: kappaV1 }))), ["ok", "ok"]);
          assert.equal(await contar("select count(*)::int as n from kyb_versiones where company_id = $1", [kappa]), 1);
          assert.equal(await eventos("expediente_version_creada", kappaV1), 1);
          await assert.rejects(crearVersion(ori, { companyId: kappa, formId: alfaV2 }), /expediente_ausente/);
          // La carrera del Vercel CI de b2db0b5, en el peor orden y siempre: la segunda pestaña hace su primera
          // lectura, la primera confirma ahí mismo y la segunda sigue. Con dos lecturas (por id y por borrador), la
          // segunda veía el borrador recién confirmado sin haber visto su id y respondía «ya hay borrador».
          const conOtraPestana = (otra: () => Promise<unknown>) => {
            let pendiente: (() => Promise<unknown>) | null = otra;
            return (consulta: Consulta): Consulta => ({
              query: async (sql, params) => {
                const resultado = await consulta.query(sql, params);
                // Tras la primera lectura de la transacción (la del formulario), la otra pestaña corre y confirma.
                if (pendiente) {
                  const correr = pendiente;
                  pendiente = null;
                  await correr();
                }
                return resultado;
              },
            });
          };
          const mu = await prospecto("MUP150301AB2", "Mu Papelera SA de CV");
          const muV1 = randomUUID();
          assert.equal(await crearVersion(ori, { companyId: mu, formId: muV1 }, conOtraPestana(() => crearVersion(ori, { companyId: mu, formId: muV1 }))), muV1);
          assert.equal(await contar("select count(*)::int as n from kyb_versiones where company_id = $1", [mu]), 1);
          assert.equal(await eventos("expediente_version_creada", muV1), 1);
          // Un formulario distinto en el mismo orden sigue siendo «ya hay borrador», y queda una sola versión.
          const nu = await prospecto("NUP150301AB3", "Nu Papelera SA de CV");
          await assert.rejects(
            crearVersion(ori, { companyId: nu, formId: randomUUID() }, conOtraPestana(() => crearVersion(ori, { companyId: nu, formId: randomUUID() }))),
            /expediente_con_borrador/,
          );
          assert.equal(await contar("select count(*)::int as n from kyb_versiones where company_id = $1", [nu]), 1);
          const lambda = await prospecto("LAM150301AB1", "Lambda Metales SA de CV");
          assert.deepEqual(salida(await ambos(() => crearVersion(ori, { companyId: lambda, formId: randomUUID() }))), ["expediente_con_borrador", "ok"]);
          assert.equal(await contar("select count(*)::int as n from kyb_versiones where company_id = $1", [lambda]), 1);

          // Representante, accionista y documento: una fila y un evento; con el id de otra versión, «expediente ausente».
          const representante = (formId: string) => agregarRepresentante(ori, {
            versionId: kappaV1, formId, nombre: "Rosa Pérez Ríos", rfc: "PERR800101AB1", curp: "PERR800101MDFRSS09",
            cargo: "administrador_unico", esAdministrador: true, designadoPor: "Asamblea constitutiva", pep: "no",
          });
          const rep = randomUUID();
          assert.deepEqual(salida(await ambos(() => representante(rep))), ["ok", "ok"]);
          assert.equal(await contar("select count(*)::int as n from kyb_representantes where version_id = $1", [kappaV1]), 1);
          assert.equal(await eventos("expediente_representante_agregado", rep), 1);
          await assert.rejects(representante(repAlfa), /expediente_ausente/);
          await assert.rejects(retirarDelBorrador(ori, { versionId: kappaV1, id: repAlfa, tipo: "representante" }), /expediente_ausente/);
          assert.equal(await contar("select count(*)::int as n from kyb_representantes where id = $1 and retirado_en is null", [repAlfa]), 1);

          const accionista = (formId: string) => agregarAccionista(ori, {
            versionId: kappaV1, formId, padreClave: "", tipoPersona: "fisica", nombre: "Laura Gómez Ruiz", rfc: "GORL750505QW1",
            curp: "GORL750505MDFMZR04", pais: "", documentoExtranjero: "", fechaNacimiento: "", capital: "100", votos: "100",
            controlOtrosMedios: false, pep: "no",
          });
          const socio = randomUUID();
          assert.deepEqual(salida(await ambos(() => accionista(socio))), ["ok", "ok"]);
          assert.equal(await contar("select count(*)::int as n from kyb_accionistas where version_id = $1", [kappaV1]), 1);
          assert.equal(await eventos("expediente_accionista_agregado", socio), 1);
          await assert.rejects(accionista(socioAlfa), /expediente_ausente/);

          const acta = (formId: string, deps = { almacen }) => cargarDocumento(ori, {
            versionId: kappaV1, formId, tipo: "acta_constitutiva", representanteClave: "", emitidoEl: "", vigenteHasta: "",
            detalle: "Folio mercantil 777", archivo: { nombre: "acta.pdf", bytes: PDF },
          }, deps);
          // Las dos subidas llegan a Blob antes de que cualquiera escriba la fila: el doble envío es simultáneo de verdad.
          const memoria = almacenEnMemoria();
          let llegadas = 0;
          let soltar = () => {};
          const juntas = new Promise<void>((resolver) => { soltar = resolver; });
          const conBarrera: typeof memoria = {
            ...memoria,
            async guardar(entrada) {
              const guardado = await memoria.guardar(entrada);
              llegadas += 1;
              if (llegadas === 2) soltar();
              await juntas;
              return guardado;
            },
          };
          const documento = randomUUID();
          assert.deepEqual(salida(await ambos(() => acta(documento, { almacen: conBarrera }))), ["ok", "ok"]);
          assert.equal(await contar("select count(*)::int as n from kyb_version_documentos where version_id = $1", [kappaV1]), 1);
          assert.equal(await eventos("expediente_documento_cargado", documento), 1);
          // S9: el archivo del envío que perdió no tiene fila: se borra; el de la fila se conserva.
          const conservado = String((await dueno.query("select clave_blob from kyb_documentos where id = $1", [documento])).rows[0].clave_blob);
          assert.equal(memoria.guardados.size, 2);
          assert.equal(memoria.borrados.length, 1);
          assert.notEqual(memoria.borrados[0], conservado);
          // Si la transacción falla después de subir (representante que no es de la versión), el archivo también se borra.
          const fallida = almacenEnMemoria();
          await assert.rejects(cargarDocumento(ori, {
            versionId: kappaV1, formId: randomUUID(), tipo: "identificacion_representante", representanteClave: randomUUID(), emitidoEl: "",
            vigenteHasta: "2030-01-01", detalle: "", archivo: { nombre: "ine.pdf", bytes: PDF },
          }, { almacen: fallida }), /documento_sin_representante/);
          assert.deepEqual(fallida.borrados, [...fallida.guardados.keys()]);
          assert.equal(fallida.borrados.length, 1);
          // bar-2: «Vigente hasta» antes de «Emitido el» se rechaza en su campo antes de subir nada (antes, el
          // archivo subía y el CHECK `kyb_documentos_vigencia` respondía «La base no respondió»). bar-4: una fecha
          // que no existe en el calendario, o del año 0, también se rechaza en su campo (antes, 22008 de la base).
          const claveRep = String((await dueno.query("select clave from kyb_representantes where id = $1", [rep])).rows[0].clave);
          const conFechas = almacenEnMemoria();
          const identificacion = (emitidoEl: string, vigenteHasta: string) => cargarDocumento(ori, {
            versionId: kappaV1, formId: randomUUID(), tipo: "identificacion_representante", representanteClave: claveRep, emitidoEl,
            vigenteHasta, detalle: "", archivo: { nombre: "ine.pdf", bytes: PDF },
          }, { almacen: conFechas });
          const documentosKappa = () => contar("select count(*)::int as n from kyb_documentos where company_id = (select company_id from kyb_versiones where id = $1)", [kappaV1]);
          const antesDeFechas = await documentosKappa();
          await assert.rejects(identificacion("2026-10-01", "2026-09-30"), /dato_invalido_vigenteHasta/);
          await assert.rejects(identificacion("", "2026-02-30"), /dato_invalido_vigenteHasta/);
          await assert.rejects(identificacion("", "0000-01-01"), /dato_invalido_vigenteHasta/);
          await assert.rejects(identificacion("2026-02-30", "2031-12-31"), /dato_invalido_emitidoEl/);
          assert.equal(conFechas.guardados.size, 0);
          assert.equal(await documentosKappa(), antesDeFechas);
          // bar-4: constitución y nacimiento del socio extranjero con fechas imposibles.
          await assert.rejects(guardarDatosGenerales(ori, { versionId: kappaV1, datos: { ...DATOS_GENERALES, fechaConstitucion: "2020-02-30" } }), /dato_invalido_fechaConstitucion/);
          // bar-3: un control C1 (U+0085, o las comillas U+0093/U+0094 de un Windows-1252 mal decodificado) en la
          // razón social del alta se rechaza en su campo; antes pasaba el servidor y el CHECK de `companies` lo
          // rechazaba con «La base no respondió». (En los textos libres se quita: serv-nuevo-1, en el reporte.)
          await assert.rejects(registrarProspecto(ori, { rfc: "CTL010101AB1", razonSocial: "Empresa \u0093Control\u0094", codigoPostal: "01000", regimen: "601", usoCfdi: "G03" }), /razon_social_control/);
          // serv-nuevo-5: un carácter de formato (U+2060, unión de palabras) también; en b2db0b5 se guardaba.
          await assert.rejects(registrarProspecto(ori, { rfc: "CTL010101AB1", razonSocial: "Empresa\u2060Control SA", codigoPostal: "01000", regimen: "601", usoCfdi: "G03" }), /razon_social_control/);
          // bar-5: el correo con un carácter de control, o que en minúsculas pasa de 254 («İ» se vuelve dos), se
          // rechaza en su campo (antes, el CHECK `kyb_versiones_correo` respondía «La base no respondió»).
          await assert.rejects(guardarDatosGenerales(ori, { versionId: kappaV1, datos: { ...DATOS_GENERALES, correo: "con\u0001tacto@lab.mx" } }), /dato_invalido_correo/);
          await assert.rejects(guardarDatosGenerales(ori, { versionId: kappaV1, datos: { ...DATOS_GENERALES, correo: `İ${"a".repeat(246)}@lab.mx` } }), /dato_invalido_correo/);
          await assert.rejects(agregarAccionista(ori, {
            versionId: kappaV1, formId: randomUUID(), padreClave: "", tipoPersona: "fisica", nombre: "John Smith Taylor", rfc: "", curp: "",
            pais: "US", documentoExtranjero: "X12345678", fechaNacimiento: "1980-02-30", capital: "0", votos: "0", controlOtrosMedios: true, pep: "no",
          }), /dato_invalido_fechaNacimiento/);
          await assert.rejects(acta(docAlfa), /expediente_ausente/);

          // N10: el mismo formulario con otro archivo no se da por guardado. De entrada no sube nada; en
          // la carrera, el que pierde se rechaza y su archivo se borra.
          const otroPdf = new TextEncoder().encode(`%PDF-1.4\n% otro archivo\n${"1".repeat(80)}\n%%EOF\n`);
          const actaCon = (formId: string, bytes: Uint8Array, deps: { almacen: typeof memoria }) => cargarDocumento(ori, {
            versionId: kappaV1, formId, tipo: "acta_constitutiva", representanteClave: "", emitidoEl: "", vigenteHasta: "",
            detalle: "Folio mercantil 777", archivo: { nombre: "acta.pdf", bytes },
          }, deps);
          const deEntrada = almacenEnMemoria();
          await assert.rejects(actaCon(documento, otroPdf, { almacen: deEntrada }), /formulario_invalido/);
          assert.equal(deEntrada.guardados.size, 0);
          await actaCon(documento, PDF, { almacen: deEntrada });
          assert.equal(deEntrada.guardados.size, 0);
          const carrera = almacenEnMemoria();
          let enCarrera = 0;
          let soltarCarrera = () => {};
          const juntasCarrera = new Promise<void>((resolver) => { soltarCarrera = resolver; });
          const conBarreraCarrera: typeof carrera = {
            ...carrera,
            async guardar(entrada) {
              const guardado = await carrera.guardar(entrada);
              enCarrera += 1;
              if (enCarrera === 2) soltarCarrera();
              await juntasCarrera;
              return guardado;
            },
          };
          const reusado = randomUUID();
          assert.deepEqual(salida(await Promise.allSettled([
            actaCon(reusado, PDF, { almacen: conBarreraCarrera }),
            actaCon(reusado, otroPdf, { almacen: conBarreraCarrera }),
          ])), ["formulario_invalido", "ok"]);
          assert.equal(await eventos("expediente_documento_cargado", reusado), 1);
          const guardadoReusado = String((await dueno.query("select clave_blob from kyb_documentos where id = $1", [reusado])).rows[0].clave_blob);
          assert.equal(carrera.guardados.size, 2);
          assert.equal(carrera.borrados.length, 1);
          assert.notEqual(carrera.borrados[0], guardadoReusado);

          // Dictamen: con el id de otro dictamen no se da por hecho; el mismo formulario, uno; dos distintos, uno y «ya registrado».
          const aprobar = (versionId: string, formId: string) =>
            dictaminarVersion(cum, SESION_SOFIPO, { versionId, formId, resultado: "aprobado", motivo: "" });
          await assert.rejects(aprobar(ximenaV1, dictamenAlfa), /expediente_ausente/);
          const dictamen = randomUUID();
          assert.deepEqual(salida(await ambos(() => aprobar(ximenaV1, dictamen))), ["ok", "ok"]);
          assert.equal(await contar("select count(*)::int as n from kyb_dictamenes where version_id = $1", [ximenaV1]), 1);
          assert.equal(await eventos("expediente_dictaminado", dictamen), 1);
          assert.deepEqual(salida(await ambos(() => aprobar(epsilonV1, randomUUID()))), ["dictamen_ya_registrado", "ok"]);
          assert.equal(await contar("select count(*)::int as n from kyb_dictamenes where version_id = $1", [epsilonV1]), 1);

          // Riesgo: con el id de la calificación de otra empresa no se da por hecho; el mismo formulario, una.
          const calificar = (formId: string) => calificarRiesgoEmpresa(cum, { companyId: ximena, formId, actividad: "baja", zona: "baja" });
          await assert.rejects(calificar(riesgoAlfa), /expediente_ausente/);
          const riesgo = randomUUID();
          assert.deepEqual(salida(await ambos(() => calificar(riesgo))), ["ok", "ok"]);
          assert.equal(await contar("select count(*)::int as n from kyb_calificaciones_riesgo where company_id = $1", [ximena]), 1);
          assert.equal(await eventos("riesgo_calificado", riesgo), 1);

          // Lista: el mismo formulario, una carga; el mismo archivo con otro formulario, «ya cargada».
          const carga = randomUUID();
          const texto = lista("2026-10-25", BETA_EN_LISTA);
          assert.deepEqual(salida(await ambos(() => cargarListaBloqueadas(cum, { formId: carga, nombreArchivo: "lpb.csv", texto }))), ["ok", "ok"]);
          assert.equal(await eventos("lpb_cargada", carga), 1);
          const otroTexto = lista("2026-10-26", BETA_EN_LISTA);
          assert.deepEqual(
            salida(await ambos(() => cargarListaBloqueadas(cum, { formId: randomUUID(), nombreArchivo: "lpb.csv", texto: otroTexto }))),
            ["lpb_ya_cargada", "ok"],
          );

          // Suspensión: el mismo formulario, una solicitud; dos distintos, una y «ya hay una pendiente»; uno ajeno, rechazado.
          const pedir = (formId: string) =>
            solicitarCambioDeSuspension(ori, { companyId: alfa, formId, tipo: "suspension", motivo: "Revisión por doble envío" });
          const suspension = randomUUID();
          assert.deepEqual(salida(await ambos(() => pedir(suspension))), ["ok", "ok"]);
          assert.equal(await eventos("suspension_solicitada", suspension), 1);
          await decidirCambioDeSuspension(apr, SESION_SOFIPO, { id: suspension, aprobada: false, motivo: "Era una prueba de doble envío" });
          assert.deepEqual(salida(await ambos(() => pedir(randomUUID()))), ["ok", "suspension_pendiente"]);
          const abierta = String((await dueno.query("select id from company_suspensions where company_id = $1 and estado = 'pendiente'", [alfa])).rows[0].id);
          await decidirCambioDeSuspension(apr, SESION_SOFIPO, { id: abierta, aprobada: false, motivo: "Era una prueba de doble envío" });
          // La misma carrera que la versión, en el peor orden: la otra pestaña del mismo formulario confirma justo
          // después de la primera lectura. Con dos lecturas (por id y por pendiente), respondía «ya hay una pendiente».
          const forzada = randomUUID();
          await solicitarCambioDeSuspension(ori, { companyId: alfa, formId: forzada, tipo: "suspension", motivo: "Revisión por doble envío" }, conOtraPestana(() => pedir(forzada)));
          assert.equal(await contar("select count(*)::int as n from company_suspensions where company_id = $1 and estado = 'pendiente'", [alfa]), 1);
          assert.equal(await eventos("suspension_solicitada", forzada), 1);
          await decidirCambioDeSuspension(apr, SESION_SOFIPO, { id: forzada, aprobada: false, motivo: "Era una prueba de doble envío" });
          // Un formulario distinto en el mismo orden sigue siendo «ya hay una pendiente».
          await assert.rejects(
            solicitarCambioDeSuspension(ori, { companyId: alfa, formId: randomUUID(), tipo: "suspension", motivo: "Revisión por doble envío" }, conOtraPestana(() => pedir(randomUUID()))),
            /suspension_pendiente/,
          );
          const otraPestana = String((await dueno.query("select id from company_suspensions where company_id = $1 and estado = 'pendiente'", [alfa])).rows[0].id);
          await decidirCambioDeSuspension(apr, SESION_SOFIPO, { id: otraPestana, aprobada: false, motivo: "Era una prueba de doble envío" });
          const deBeta = String((await dueno.query("select id from company_suspensions where company_id = $1 and origen = 'manual' limit 1", [beta])).rows[0].id);
          await assert.rejects(pedir(deBeta), /formulario_invalido/);
          assert.equal((await leerCliente(ori, alfa))?.estado, "activa");
        });

        await t.test("F6: el comando no adivina banderas: repetida, con valor en una de sí o no, desconocida o sin --demostracion", async () => {
          const correr = (...args: string[]) => {
            const salida = spawnSync(join(process.cwd(), "node_modules/.bin/tsx"), ["scripts/plataforma.ts", ...args], {
              cwd: process.cwd(), encoding: "utf8", env: { ...process.env, DATABASE_URL: "", DATABASE_URL_UNPOOLED: urlDuena },
            });
            return { estado: salida.status, texto: `${salida.stdout}${salida.stderr}`.trim() };
          };
          const correoAdm = `${ADM}@ejemplo.mx`;
          const motivo = "Arranque de la 0028: acta del consejo del 10 de noviembre";
          const huella = () => contar(
            `select (select count(*) from platform_staff_roles) + (select count(*) from companies)
                  + (select count(*) from audit_log where accion like 'rol_personal_%' or accion = 'alta_empresa') as n`,
          );
          const antes = await huella();
          const casos: Array<[string[], RegExp]> = [
            [["personal:rol", "--correo", correoAdm, "--rol", "aprobacion", "--motivo", motivo, "--quitar", "no"], /--quitar no lleva valor/],
            [["personal:rol", "--correo", correoAdm, "--rol", "aprobacion", "--motivo", motivo, "--motivo", "Otro motivo distinto"], /--motivo va una sola vez/],
            [["personal:rol", "--correo", correoAdm, "--rol", "aprobacion", "--motivo", motivo, "--forzar"], /personal:rol no conoce --forzar/],
            [
              ["empresa:alta", "--personal", correoAdm, "--rfc", "CMD150301AB2", "--razon", "Por Comando SA", "--cp", "06600", "--regimen", "601", "--uso", "G03"],
              /solo crea empresas de demostración/,
            ],
          ];
          for (const [args, mensaje] of casos) {
            const resultado = correr(...args);
            assert.equal(resultado.estado, 1, resultado.texto);
            assert.match(resultado.texto, mensaje);
          }
          assert.equal(await huella(), antes);
        });

        await t.test("F8: Originación y Aprobación ven «en revisión de Cumplimiento» sin detalle; Administración no lee esos motivos", async () => {
          for (const ctx of [ori, apr, adm]) await assert.rejects(listarCoincidencias(ctx, { companyId: beta }), /sin_permiso_operacion/);
          assert.equal(await enRevisionDeCumplimiento(ori, beta), true);
          assert.equal(await enRevisionDeCumplimiento(apr, beta), true);
          assert.equal(await enRevisionDeCumplimiento(ori, alfa), false);
          assert.ok((await listarCoincidencias(aud, { companyId: beta })).length > 0);
          const motivos = async (ctx: typeof adm) => (await leerBitacora(ctx, alfa))
            .filter((e) => e.accion === "expediente_dictaminado" || e.accion.startsWith("lpb_"))
            .map((e) => e.motivo)
            .filter((m) => m !== null);
          assert.deepEqual(await motivos(adm), []);
          const deAuditoria = await motivos(aud);
          assert.ok(deAuditoria.includes("Falta el poder notarial del apoderado"));
          assert.ok(deAuditoria.includes("Homónimo: la CURP del socio es distinta"));
        });

        await t.test("S6: en la bitácora del personal, los eventos de la lista de una empresa solo los leen Cumplimiento y Auditoría", async () => {
          await dueno.query("insert into users (id, nombre, correo) values ($1, 'Ada Administración', $2)", [ADA, `${ADA}@ejemplo.mx`]);
          await dueno.query("insert into platform_staff (operator_id, user_id, estado) values ($1, $2, 'activo')", [operador, ADA]);
          await dueno.query("insert into platform_staff_roles (operator_id, user_id, rol) values ($1, $2, 'administracion_plataforma')", [operador, ADA]);
          const ada = personal(operador, ADA, ["administracion_plataforma"]);
          const deLaLista = (e: { companyId: string | null; accion: string }) =>
            e.companyId !== null && (e.accion.startsWith("lpb_") || e.accion === "empresa_suspendida_lpb");
          const deAda = await leerBitacora(ada);
          assert.equal(deAda.filter(deLaLista).length, 0);
          assert.equal((await leerBitacora(ada, beta)).filter(deLaLista).length, 0);
          // La carga de la lista, sin empresa, sí la ve; y lo demás de la empresa también.
          assert.ok(deAda.some((e) => e.accion === "lpb_cargada" && e.companyId === null));
          assert.ok((await leerBitacora(ada, beta)).some((e) => e.accion === "suspension_aprobada" || e.accion === "reactivacion_aprobada"));
          // Por empresa: la bitácora general trae los 400 eventos más recientes y los de la lista ya pueden quedar atrás.
          assert.ok((await leerBitacora(aud, beta)).filter(deLaLista).length > 0);
          // Por SQL directo, igual: es la política de la base.
          const porSql = (userId: string) => sofipo(userId, async (c) => Number((await c.query(
            "select count(*)::int as n from audit_log where company_id is not null and (accion like 'lpb\\_%' or accion = 'empresa_suspendida_lpb')",
          )).rows[0].n));
          assert.equal(await porSql(ADA), 0);
          assert.ok((await porSql(AUD)) > 0);
          assert.ok((await porSql(CUM)) > 0);
        });

        await t.test("S12 y N8: el alta por la dueña deja la conexión y el correo de quien corrió el comando; la bitácora nombra la coincidencia detectada", async () => {
          const pide = { ...adm, capacidades: capacidadesDe({ rolesCliente: [], rolesPlataforma: ["administracion_plataforma"] }) };
          const alta = { rfc: "DEM150301AB9", razonSocial: "Demostración Dueña SA de CV", codigoPostal: "06600", regimen: "601", usoCfdi: "G03" };
          await assert.rejects(darDeAltaComoDuena(urlDuena, pide, alta, { demostracion: true, corridoPor: "" }), /corrido_por_invalido/);
          const demo = await darDeAltaComoDuena(urlDuena, pide, alta, { demostracion: true, corridoPor: " Gil@Ejemplo.mx " });
          assert.deepEqual((await dueno.query(
            `select cambio ->> 'ejecutado_por' = session_user as ejecutado_por, cambio ->> 'demostracion' as demostracion,
                    cambio ->> 'corrido_por' as corrido_por
             from audit_log where accion = 'alta_empresa' and company_id = $1`,
            [demo.id],
          )).rows, [{ ejecutado_por: true, demostracion: "true", corrido_por: "gil@ejemplo.mx" }]);
          assert.equal(etiquetaAccion("lpb_coincidencia_detectada"), "El sistema detectó una coincidencia");
        });

        await t.test("F9: sin el rol no se lee el archivo; uno que pasa del tope tampoco", async () => {
          const espiado = (contenido: BlobPart[], nombre: string) => {
            const archivo = new File(contenido, nombre);
            let leido = false;
            Object.assign(archivo, {
              arrayBuffer: async () => { leido = true; return new ArrayBuffer(0); },
              text: async () => { leido = true; return ""; },
            });
            return { archivo, leido: () => leido };
          };
          const csv = espiado(["nombre;rfc\nx;y"], "lpb.csv");
          await assert.rejects(leerArchivoDeLista(aud, csv.archivo), /sin_permiso_operacion/);
          const pdf = espiado([PDF], "acta.pdf");
          await assert.rejects(archivoDeDocumento(aud, pdf.archivo), /sin_permiso_operacion/);
          const grande = espiado([new Uint8Array(TOPE_ARCHIVO_BYTES + 1)], "grande.pdf");
          await assert.rejects(archivoDeDocumento(ori, grande.archivo), /archivo_demasiado_grande/);
          const grandeCsv = espiado([new Uint8Array(TOPE_ARCHIVO_BYTES + 1)], "grande.csv");
          assert.deepEqual(await leerArchivoDeLista(cum, grandeCsv.archivo), { ok: false, codigo: "lpb_demasiado_grande" });
          assert.deepEqual([csv.leido(), pdf.leido(), grande.leido(), grandeCsv.leido()], [false, false, false, false]);
          // Con el rol y dentro del tope, se lee.
          assert.deepEqual(await archivoDeDocumento(ori, new File([PDF], "acta.pdf")), { nombre: "acta.pdf", bytes: PDF });
        });

        await t.test("H4: el nombre se compara sin orden de palabras, sin puntuación y sin letras fuera de la tabla", async () => {
          const normal = async (nombre: string) => String((await dueno.query("select lpb_normalizar($1) as r", [nombre])).rows[0].r);
          assert.equal(await normal("RIOS PEREZ ROSA"), await normal("Rosa Pérez Ríos"));
          assert.equal(await normal("Grupo S.A. de C.V."), await normal("GRUPO SA DE CV"));
          assert.equal(await normal("Søren O'Brien Ødegård"), "OBRIEN ODEGARD SOREN");
          // En una carga, «RIOS PEREZ ROSA» es posible coincidencia con la representante Rosa Pérez Ríos.
          await cargar(lista("2026-10-27", BETA_EN_LISTA, "RIOS PEREZ ROSA,,,fisica"));
          const representantes = (await listarCoincidencias(cum, { companyId: beta })).filter((k) => k.sujetoTipo === "representante");
          assert.deepEqual(representantes.map((k) => [k.sujetoNombre, k.tipo, k.coincidePor, k.estado]), [["Rosa Pérez Ríos", "posible", "nombre", "pendiente"]]);
        });

        await t.test("N1: el falso positivo exacto resuelto con una carga posterior no se reabre con esa misma; con la siguiente, sí", async () => {
          const casosBeta = async () => (await dueno.query(
            "select id, estado, cerrada_con_carga_id from lpb_coincidencias where company_id = $1 and sujeto_tipo = 'empresa' and coincide_por = 'rfc' order by detectada_en",
            [beta],
          )).rows as Array<{ id: string; estado: string; cerrada_con_carga_id: string | null }>;
          const total = () => contar("select count(*)::int as n from lpb_coincidencias where company_id = $1", [beta]);
          const vigente = async () => String((await dueno.query("select lpb_carga_vigente($1) as id", [operador])).rows[0].id);
          // Detectada con la carga del 24 de octubre (C1); la del 27 (C2, vigente) también la trae.
          const abierta = (await casosBeta()).at(-1)!;
          assert.equal(abierta.estado, "pendiente");
          const c2 = await vigente();
          assert.notEqual(String((await dueno.query("select carga_id from lpb_coincidencias where id = $1", [abierta.id])).rows[0].carga_id), c2);
          await resolverCoincidencia(cum, SESION_SOFIPO, { id: abierta.id, estado: "falso_positivo", motivo: "El RFC de la lista del 27 de octubre es de otra persona moral" });
          const rosa = (await listarCoincidencias(cum, { companyId: beta })).find((k) => k.sujetoTipo === "representante" && k.estado === "pendiente");
          await resolverCoincidencia(cum, SESION_SOFIPO, { id: rosa!.id, estado: "falso_positivo", motivo: "Homónimo: la CURP de la representante es distinta" });
          const reactivar = randomUUID();
          await solicitarCambioDeSuspension(cum, { companyId: beta, formId: reactivar, tipo: "reactivacion", motivo: "Dictamen de falso positivo" });
          await decidirCambioDeSuspension(apr, SESION_SOFIPO, { id: reactivar, aprobada: true, motivo: "" });
          assert.equal((await leerCliente(ori, beta))?.estado, "activa");
          const antes = await total();

          // Con C2 vigente nada lo reabre: ni otro cotejo, ni un proveedor nuevo, ni una copia del 69-B, ni una versión nueva.
          assert.equal(Number((await dueno.query("select lpb_cotejar_empresa($1) as n", [beta])).rows[0].n), 0);
          await dueno.query("begin");
          try {
            await sembrarProveedor(dueno, beta, operador, PROVEEDOR_CUATRO, "CUA101010AB4", "Proveedor Cuatro SA");
            await dueno.query("commit");
          } catch (error) {
            await dueno.query("rollback");
            throw error;
          }
          const otraCopia = randomUUID();
          await sofipo(ADM, async (c) => {
            await c.query("insert into lista_69b_snapshots (id, operator_id, fecha_archivo, cargado_en) values ($1, $2, current_date, now())", [otraCopia, operador]);
            await c.query("insert into lista_69b_rows (snapshot_id, rfc, situacion) values ($1, 'PAL7202161U0', 'Presunto')", [otraCopia]);
            await evento(c, ADM, "cargar_lista_69b", "lista_69b_snapshots", otraCopia);
          });
          const betaV2 = randomUUID();
          await crearVersion(ori, { companyId: beta, formId: betaV2 });
          await enviarVersion(ori, betaV2);
          assert.equal(await total(), antes);
          assert.equal((await leerCliente(ori, beta))?.estado, "activa");
          // Se cerró con la carga que estaba vigente (C2): con esa no se reabre.
          assert.equal((await casosBeta()).find((k) => k.id === abierta.id)?.cerrada_con_carga_id, c2);

          // C3 con la empresa: caso nuevo y suspensión inmediata.
          await cargar(lista("2026-10-28", BETA_EN_LISTA));
          assert.deepEqual((await casosBeta()).map((k) => k.estado), ["fuera_de_lista", "falso_positivo", "falso_positivo", "pendiente"]);
          assert.equal((await leerCliente(ori, beta))?.estado, "suspendida");
        });

        await t.test("N5: Cumplimiento cierra un caso mientras otra pestaña carga una lista con la misma persona: o se reabre con la nueva o el cierre la anota", async () => {
          const casos = async () => (await dueno.query(
            `select id, estado, carga_id, cerrada_con_carga_id from lpb_coincidencias
             where company_id = $1 and sujeto_tipo = 'empresa' and coincide_por = 'rfc' order by detectada_en`,
            [beta],
          )).rows as Array<{ id: string; estado: string; carga_id: string; cerrada_con_carga_id: string | null }>;
          const pendiente = async () => {
            const abiertos = (await casos()).filter((k) => k.estado === "pendiente");
            assert.equal(abiertos.length, 1);
            return abiertos[0]!;
          };
          const vigente = async () => String((await dueno.query("select lpb_carga_vigente($1) as id", [operador])).rows[0].id);
          // Dos pestañas de Cumplimiento: cada una con su transacción abierta, como la de la aplicación.
          const abrir = async (aislamiento: "read committed" | "repeatable read") => {
            const c = new pg.Client({ connectionString: urlApp });
            await c.connect();
            await c.query(`begin isolation level ${aislamiento}`);
            await c.query("set local role plataforma_sofipo");
            await c.query("select set_config('app.user_id', $1, true), set_config('app.operator_id', $2, true)", [CUM, operador]);
            return c;
          };
          const soltar = async (...conexiones: pg.Client[]) => {
            for (const c of conexiones) {
              await c.query("rollback").catch(() => undefined);
              await c.end();
            }
          };
          const cerrarCaso = async (c: pg.Client, id: string) => {
            await evento(c, CUM, "lpb_coincidencia_resuelta", "lpb_coincidencias", id, beta);
            await c.query(
              `update lpb_coincidencias set estado = 'falso_positivo', resuelta_por = $2, resuelta_en = now(),
                 motivo_resolucion = 'El RFC de la lista es de otra persona moral' where id = $1`,
              [id, CUM],
            );
          };
          // Lo que hace cargarListaBloqueadas, en la transacción de la pestaña.
          const cargarEn = async (c: pg.Client, texto: string) => {
            const id = randomUUID();
            const renglones = texto.split("\n").slice(1).map((renglon) => renglon.split(","));
            await c.query(
              "insert into lpb_cargas (id, operator_id, nombre_archivo, sha256, filas, cargada_por, cargada_en) values ($1, $2, 'lpb.csv', $3, $4, $5, now())",
              [id, operador, createHash("sha256").update(texto).digest("hex"), renglones.length, CUM],
            );
            for (const [nombre, rfc, curp, tipo, fecha] of renglones) {
              await c.query(
                `insert into lpb_personas (carga_id, operator_id, nombre, rfc, curp, tipo, fecha_publicacion)
                 values ($1, $2, $3, nullif($4, ''), nullif($5, ''), $6, $7::date)`,
                [id, operador, nombre, rfc, curp, tipo, fecha],
              );
            }
            await evento(c, CUM, "lpb_cargada", "lpb_cargas", id);
            return id;
          };
          // La otra pestaña queda esperando el candado de la empresa (o termina, si no lo hay).
          const esperaElCandado = async (c: pg.Client) => {
            const pid = (c as unknown as { processID: number }).processID;
            for (let intento = 0; intento < 40; intento += 1) {
              const fila = (await dueno.query("select wait_event_type from pg_stat_activity where pid = $1", [pid])).rows[0] as { wait_event_type?: string } | undefined;
              if (fila?.wait_event_type === "Lock") return true;
              await new Promise((listo) => setTimeout(listo, 50));
            }
            return false;
          };

          // READ COMMITTED, el cierre primero: la carga nueva espera, ve el caso cerrado con la carga
          // anterior y abre uno nuevo con la suya.
          const primero = await pendiente();
          const c3 = await vigente();
          let cierre = await abrir("read committed");
          let carga = await abrir("read committed");
          try {
            await cerrarCaso(cierre, primero.id);
            const c4 = await cargarEn(carga, lista("2026-10-29", BETA_EN_LISTA));
            const confirmada = carga.query("commit");
            const espero = await esperaElCandado(carga);
            await cierre.query("commit");
            await confirmada;
            const despues = await casos();
            assert.equal(despues.find((k) => k.id === primero.id)?.cerrada_con_carga_id, c3);
            assert.deepEqual(despues.filter((k) => k.estado === "pendiente").map((k) => k.carga_id), [c4]);
            assert.ok(espero, "el cotejo de la carga nueva esperó al cierre");
          } finally {
            await soltar(cierre, carga);
          }

          // READ COMMITTED, la carga primero: el cierre espera y anota la carga nueva; con esa no se reabre.
          const segundo = await pendiente();
          carga = await abrir("read committed");
          cierre = await abrir("read committed");
          try {
            const c5 = await cargarEn(carga, lista("2026-10-30", BETA_EN_LISTA));
            await carga.query("set constraints all immediate");
            const cerrando = cerrarCaso(cierre, segundo.id);
            const espero = await esperaElCandado(cierre);
            await carga.query("commit");
            await cerrando;
            await cierre.query("commit");
            const despues = await casos();
            assert.equal(despues.find((k) => k.id === segundo.id)?.cerrada_con_carga_id, c5);
            assert.deepEqual(despues.filter((k) => k.estado === "pendiente"), []);
            assert.equal(Number((await dueno.query("select lpb_cotejar_empresa($1) as n", [beta])).rows[0].n), 0);
            assert.ok(espero, "el cierre esperó al cotejo de la carga nueva");
          } finally {
            await soltar(cierre, carga);
          }

          // REPEATABLE READ, el cierre primero: la carga, con su foto de antes del cierre, aborta.
          await cargar(lista("2026-10-31", BETA_EN_LISTA));
          const tercero = await pendiente();
          cierre = await abrir("repeatable read");
          carga = await abrir("repeatable read");
          try {
            await cerrarCaso(cierre, tercero.id);
            await cargarEn(carga, lista("2026-11-01", BETA_EN_LISTA));
            const confirmada = carga.query("commit");
            await esperaElCandado(carga);
            await cierre.query("commit");
            await assert.rejects(confirmada, /could not serialize/);
          } finally {
            await soltar(cierre, carga);
          }
          // Al repetirla, abre el caso con su carga.
          await cargar(lista("2026-11-01", BETA_EN_LISTA));
          assert.equal((await pendiente()).carga_id, await vigente());

          // REPEATABLE READ, la carga primero: el cierre, con su foto de antes de la carga, aborta; al
          // repetirlo anota la carga nueva.
          const cuarto = await pendiente();
          carga = await abrir("repeatable read");
          cierre = await abrir("repeatable read");
          let c8 = "";
          try {
            c8 = await cargarEn(carga, lista("2026-11-02", BETA_EN_LISTA));
            await carga.query("set constraints all immediate");
            const cerrando = cerrarCaso(cierre, cuarto.id);
            await esperaElCandado(cierre);
            await carga.query("commit");
            await assert.rejects(cerrando, /could not serialize/);
          } finally {
            await soltar(cierre, carga);
          }
          await resolverCoincidencia(cum, SESION_SOFIPO, { id: cuarto.id, estado: "falso_positivo", motivo: "El RFC de la lista es de otra persona moral" });
          assert.equal((await casos()).find((k) => k.id === cuarto.id)?.cerrada_con_carga_id, c8);
        });

        await t.test("H2: con su propia copia el operador sí suspende y «fuera de lista» mira la copia de su operador", async () => {
          const propia = randomUUID();
          await sofipo(ADM, async (c) => {
            await c.query("insert into lista_69b_snapshots (id, operator_id, fecha_archivo, cargado_en) values ($1, $2, current_date, now())", [propia, operador]);
            await c.query("insert into lista_69b_rows (snapshot_id, rfc, situacion) values ($1, 'ALF150301AB1', 'Definitivo')", [propia]);
            await evento(c, ADM, "cargar_lista_69b", "lista_69b_snapshots", propia);
          });
          assert.equal((await leerCliente(ori, alfa))?.estado, "suspendida");
          const caso = (await dueno.query(
            "select id from lpb_coincidencias where company_id = $1 and lista = '69b' and snapshot_69b_id = $2 and estado = 'pendiente'",
            [alfa, propia],
          )).rows[0] as { id: string } | undefined;
          assert.ok(caso);
          // Otro operador carga una copia más reciente sin Alfa: la de este operador la sigue trayendo.
          const ajenaSinAlfa = randomUUID();
          await sofipo(AJENA, async (c) => {
            await c.query("insert into lista_69b_snapshots (id, operator_id, fecha_archivo, cargado_en) values ($1, $2, current_date, now())", [ajenaSinAlfa, otroOperador]);
            await c.query("insert into lista_69b_rows (snapshot_id, rfc, situacion) values ($1, 'PAL7202161U0', 'Presunto')", [ajenaSinAlfa]);
            await c.query(
              `insert into audit_log (operator_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, origen)
               values ($1, 'personal', $2, 'sofipo', 'cargar_lista_69b', 'lista_69b_snapshots', $3, 'operacion')`,
              [otroOperador, AJENA, ajenaSinAlfa],
            );
          }, otroOperador);
          await assert.rejects(
            resolverCoincidencia(cum, SESION_SOFIPO, { id: caso.id, estado: "fuera_de_lista", motivo: "Ya no aparece en el 69-B" }),
            /coincidencia_sigue_en_lista/,
          );
        });

        await t.test("base-N23: un control entre dos palabras no pega el nombre que se coteja contra la Lista ni el giro", async () => {
          // Cuatro socios extranjeros sin RFC ni CURP: el nombre es su única llave contra la Lista. Antes, el control
          // se borraba sin dejar espacio («PedroRuiz Sol») y la Lista con el nombre bien escrito ya no lo encontraba.
          const extranjero = (nombre: string, documento: string): SocioDePrueba => ({
            nombre, tipoPersona: "fisica", pais: "US", documentoExtranjero: documento, fechaNacimiento: "1980-01-01", capital: "25", votos: "25",
          });
          const rfc = "LCO010101AB3";
          const companyId = await prospecto(rfc, "Laboratorio Cotejo SA de CV");
          const { versionId } = await armarBorrador(ori, {
            companyId, razonSocial: "Laboratorio Cotejo SA de CV", rfc, almacen,
            socios: [extranjero("Ana Ruiz Sol", "X1234567"), extranjero("Pedro Ruiz Sol", "X1234568"), extranjero("Luis Ruiz Sol", "X1234569"), extranjero("Eva Ruiz Sol", "X1234560")],
          });
          const socio = (nombre: string) => agregarAccionista(ori, {
            versionId, formId: randomUUID(), padreClave: "", tipoPersona: "fisica", nombre, rfc: "", curp: "",
            pais: "US", documentoExtranjero: "Z7654321", fechaNacimiento: "1981-02-02", capital: "0", votos: "0", controlOtrosMedios: true, pep: "no",
          });
          const representante = (nombre: string) => agregarRepresentante(ori, {
            versionId, formId: randomUUID(), nombre, rfc: "", curp: "", cargo: "apoderado", esAdministrador: false, designadoPor: "", pep: "no",
          });
          // Regla 1: una identidad con cualquier carácter invisible se rechaza en su campo con su propio aviso
          // («invisible_nombre»), también el tabulador; no se limpia. serv-nuevo-5: también los Cf (U+00AD en un
          // representante, U+200B en un socio, U+2060, U+FEFF, U+200E), que en b2db0b5 se guardaban. base-N26: también los
          // invisibles de otras categorías (U+3164, U+FE0F, U+180B, U+17B4, U+115F, U+FFA0, U+E0100), que en a75d5e4 se
          // guardaban: «Rodr\u3164íguez» parte el apellido en `lpb_normalizar` («IGUEZ RODR») y no coincide con la Lista.
          for (const nombre of [
            "Pedro\u000bRuiz Sol", "Luis\u0085Gómez Paz", "Juan\u0085Pérez López", "Eva Ruiz\u0096Sol", "O\u0092Brien Sol", "Ana\tRuiz Sol", "Iván\u000cSol", "Iván\u001fSol", "Iván\u0001Sol",
            "Pedro\u00adRuiz Sol", "Ana\u200bRuiz Sol", "Luis\u2060Ruiz Sol", "Eva\ufeffRuiz Sol", "Iván\u200eSol",
            "Luis Rodr\u3164íguez", "Eva Ruiz\ufe0fSol", "Iván\u180bSol", "Ana\u17b4Ruiz Sol", "Pedro\u115fRuiz Sol", "Rosa\uffa0Ríos", "Juan\u{e0100}Pérez López",
          ]) {
            await assert.rejects(socio(nombre), /invisible_nombre/, `socio ${JSON.stringify(nombre)}`);
            await assert.rejects(representante(nombre), /invisible_nombre/, `representante ${JSON.stringify(nombre)}`);
          }
          // Un nombre mal formado sin invisibles conserva el error de formato.
          await assert.rejects(representante("   "), /dato_invalido_nombre/);
          // base-N25: el documento del socio extranjero con un carácter invisible se rechaza en su campo; en b2db0b5
          // «X123\t4567» se guardaba como X1234567, otro número del que se escribió.
          for (const documento of ["X123\t4567", "X123\u000b4567", "X123\r4567", "X123\u200b4567"]) {
            await assert.rejects(
              agregarAccionista(ori, {
                versionId, formId: randomUUID(), padreClave: "", tipoPersona: "fisica", nombre: "Mia Ruiz Sol", rfc: "", curp: "",
                pais: "US", documentoExtranjero: documento, fechaNacimiento: "1981-02-02", capital: "0", votos: "0", controlOtrosMedios: true, pep: "no",
              }),
              /dato_invalido_documentoExtranjero/,
              JSON.stringify(documento),
            );
          }
          const nombres = async (tabla: "kyb_accionistas" | "kyb_representantes") =>
            (await dueno.query(`select nombre from ${tabla} where version_id = $1 order by nombre`, [versionId])).rows.map((r) => String(r.nombre));
          assert.deepEqual(await nombres("kyb_accionistas"), ["Ana Ruiz Sol", "Eva Ruiz Sol", "Luis Ruiz Sol", "Pedro Ruiz Sol"]);
          assert.deepEqual(await nombres("kyb_representantes"), ["Rosa Pérez Ríos"]);

          // La razón social del expediente también es una identidad: con U+0085 (o un Cf como U+FEFF, que en b2db0b5 se
          // guardaba) se rechaza en su campo con su propio aviso.
          for (const razonSocial of ["Laboratorio\u0085Cotejo SA de CV", "Laboratorio\ufeffCotejo SA de CV", "Laboratorio Cotejo\u00ad SA de CV", "Labora\u3164torio Cotejo SA de CV"]) {
            await assert.rejects(
              guardarDatosGenerales(ori, { versionId, datos: { ...DATOS_GENERALES, razonSocial, rfc } }),
              /invisible_razonSocial/,
              JSON.stringify(razonSocial),
            );
          }
          // En el giro, que es texto libre, el NEL entre dos palabras se vuelve un espacio (serv-nuevo-4).
          await guardarDatosGenerales(ori, { versionId, datos: { ...DATOS_GENERALES, razonSocial: "Laboratorio Cotejo SA de CV", rfc, giro: "Distribución\u0085de abarrotes" } });
          const datos = (await dueno.query("select razon_social, giro from kyb_versiones where id = $1", [versionId])).rows[0];
          assert.deepEqual([datos?.razon_social, datos?.giro], ["Laboratorio Cotejo SA de CV", "Distribución de abarrotes"]);

          await enviarVersion(ori, versionId);
          // base-N24: un renglón de la Lista con un tabulador (o un guion suave, o un U+200B) en el nombre se rechaza; en
          // b2db0b5 se juntaban los espacios antes de revisar y «EVA\tRUIZ SOL» se guardaba como «EVA RUIZ SOL».
          const cargasAntes = (await dueno.query("select count(*)::int as n from lpb_cargas")).rows[0]?.n;
          for (const renglon of ["EVA\tRUIZ SOL,,,fisica", "EVA\u00adRUIZ SOL,,,fisica", "EVA RUIZ\u200bSOL,,,fisica", "EVA RODR\u3164IGUEZ,,,fisica"]) {
            await assert.rejects(cargar(lista("2026-11-02", BETA_EN_LISTA, renglon)), /lpb_renglon_invalido/, JSON.stringify(renglon));
          }
          assert.equal((await dueno.query("select count(*)::int as n from lpb_cargas")).rows[0]?.n, cargasAntes);
          await cargar(lista("2026-11-02", BETA_EN_LISTA, "ANA RUIZ SOL,,,fisica", "PEDRO RUIZ SOL,,,fisica", "LUIS RUIZ SOL,,,fisica", "EVA RUIZ SOL,,,fisica"));
          const coincidencias = (await listarCoincidencias(cum, { companyId })).map((k) => [k.sujetoNombre, k.tipo, k.coincidePor]).sort();
          assert.deepEqual(coincidencias, [
            ["Ana Ruiz Sol", "posible", "nombre"],
            ["Eva Ruiz Sol", "posible", "nombre"],
            ["Luis Ruiz Sol", "posible", "nombre"],
            ["Pedro Ruiz Sol", "posible", "nombre"],
          ]);
          // serv-nuevo-5 no amplía los textos libres: un motivo con un emoji compuesto (unido con U+200D) se guarda tal cual.
          const ana = (await listarCoincidencias(cum, { companyId })).find((k) => k.sujetoNombre === "Ana Ruiz Sol");
          assert.ok(ana);
          const motivo = "Homónimo: revisado con la familia 👨‍👩‍👧 completa";
          await resolverCoincidencia(cum, SESION_SOFIPO, { id: ana.id, estado: "falso_positivo", motivo });
          assert.equal((await dueno.query("select motivo_resolucion from lpb_coincidencias where id = $1", [ana.id])).rows[0]?.motivo_resolucion, motivo);
        });

        await t.test("serv-nuevo-6d: enviar sin giro ni domicilio dice qué falta; la versión sigue en borrador y sin evento", async () => {
          // Antes, el CHECK `kyb_versiones_forma` respondía 23514 sin traducir y la pantalla decía «La base no respondió».
          const rfc = "INC150301AB5";
          const razonSocial = "Incompleta Comercial SA de CV";
          const companyId = await prospecto(rfc, razonSocial);
          const { versionId } = await armarBorrador(ori, { companyId, razonSocial, rfc, almacen });
          await guardarDatosGenerales(ori, { versionId, datos: { ...DATOS_GENERALES, razonSocial, rfc, giro: "", domicilioCalle: "", domicilioColonia: "" } });
          const estado = async () => String((await dueno.query("select estado from kyb_versiones where id = $1", [versionId])).rows[0]?.estado);
          const eventos = async () =>
            Number((await dueno.query("select count(*)::int as n from audit_log where accion = 'expediente_enviado' and identificador = $1", [versionId])).rows[0]?.n);
          await assert.rejects(enviarVersion(ori, versionId), (error: unknown) => {
            assert.ok(error instanceof ExpedienteIncompleto);
            assert.equal(error.codigo, "expediente_datos_incompletos");
            assert.deepEqual(error.faltan, ["giro", "domicilio"]);
            return true;
          });
          assert.deepEqual([await estado(), await eventos()], ["borrador", 0]);
          // Con los datos completos, la misma versión se envía.
          await guardarDatosGenerales(ori, { versionId, datos: { ...DATOS_GENERALES, razonSocial, rfc } });
          await enviarVersion(ori, versionId);
          assert.deepEqual([await estado(), await eventos()], ["enviada", 1]);
        });
      } finally {
        await dueno.end();
        await cerrarConexion();
        delete process.env.DATABASE_URL;
      }
    });
  });
});

/** Una transacción con el rol de la aplicación y su contexto, como la abre src/nucleo/db.ts, sin traducir errores. */
async function como<T>(
  url: string,
  rol: "plataforma_sofipo" | "plataforma_cliente",
  ids: { userId: string; operadorId?: string; companyId?: string },
  fn: (c: pg.Client) => Promise<T>,
): Promise<T> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query("begin");
    await c.query(`set local role ${rol}`);
    await c.query(
      "select set_config('app.company_id', $1, true), set_config('app.user_id', $2, true), set_config('app.operator_id', $3, true)",
      [ids.companyId ?? "", ids.userId, ids.operadorId ?? ""],
    );
    const resultado = await fn(c);
    await c.query("commit");
    return resultado;
  } catch (error) {
    await c.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await c.end();
  }
}

function cliente(userId: string, roles: RolCliente[], companyId: string, operadorId: string): ContextoDeTenant {
  return {
    sesionId: randomUUID(), peticionId: null, superficie: "cliente",
    persona: { id: userId, nombre: userId, correo: `${userId.slice(-4)}@ejemplo.mx` }, segundoFactor: "totp",
    empresa: { id: companyId, rfc: "BET150301AB2", razonSocial: "Beta Logística SA de CV", operadorId, estado: "activa", demostracion: false },
    roles, personal: null, empresas: [], capacidades: capacidadesDe({ rolesCliente: roles, rolesPlataforma: [] }),
  };
}

/** El portal de Beta: dos personas, una copia de la 69-B y dos proveedores (uno está en la LPB vigente). */
async function sembrarPortal(dueno: pg.Client, companyId: string, operadorId: string): Promise<void> {
  await dueno.query("begin");
  try {
    // La base pide dos liberadores operativos para autorizar (0022): Luis pide, Rosa autoriza.
    for (const [id, roles] of [[LUIS, ["administrador", "liberador"]], [ROSA, ["liberador"]]] as const) {
      await dueno.query("insert into memberships (user_id, company_id, estado) values ($1, $2, 'activa')", [id, companyId]);
      for (const rol of roles) {
        await dueno.query(
          `insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, cambio)
           values ($1, $2, 'miembro', $3, 'cliente', 'asignar_rol', 'membership_roles', $4, $5)`,
          [operadorId, companyId, LUIS, id, JSON.stringify({ rol })],
        );
        await dueno.query("insert into membership_roles (user_id, company_id, rol) values ($1, $2, $3)", [id, companyId, rol]);
      }
    }
    await dueno.query("insert into lista_69b_snapshots (id, operator_id, fecha_archivo, cargado_en) values ($1, $2, current_date - 1, now())", [COPIA_69B, operadorId]);
    await dueno.query(
      `insert into audit_log (operator_id, actor_tipo, superficie, accion, entidad, identificador)
       values ($1, 'sistema', 'sistema', 'cargar_lista_69b', 'lista_69b_snapshots', $2)`,
      [operadorId, COPIA_69B],
    );
    await dueno.query("insert into lista_69b_rows (snapshot_id, rfc, situacion) values ($1, 'PAL7202161U0', 'Presunto')", [COPIA_69B]);
    const proveedores: Array<[string, string, string]> = [
      [PROVEEDOR_LPB, "PBL101010AB1", "Proveedor Bloqueado SA"],
      [PROVEEDOR_LIMPIO, "LIM101010AB2", "Proveedor Limpio SA"],
    ];
    for (const [id, rfc, nombre] of proveedores) await sembrarProveedor(dueno, companyId, operadorId, id, rfc, nombre);
    await dueno.query("commit");
  } catch (error) {
    await dueno.query("rollback");
    throw error;
  }
}

/** Un proveedor con constancia, CLABE y sus eventos, dentro de la transacción abierta de la dueña. */
async function sembrarProveedor(dueno: pg.Client, companyId: string, operadorId: string, id: string, rfc: string, nombre: string): Promise<void> {
  const documento = randomUUID();
  const clabeId = randomUUID();
  await dueno.query(
    `insert into documents (id, company_id, clave_blob, hash_sha256, tipo, nombre_original, creado_en)
     values ($1, $2, $3, $4, 'application/pdf', 'constancia.pdf', now())`,
    [documento, companyId, `constancias/${id}`, "a".repeat(64)],
  );
  await dueno.query(
    `insert into suppliers (id, company_id, document_id, snapshot_id, rfc, razon_social, lista_fecha, lista_leida_en, boton_pago, alta_en)
     values ($1, $2, $3, $4, $5, $6, (select fecha_archivo from lista_69b_snapshots where id = $4), now(), true, now())`,
    [id, companyId, documento, COPIA_69B, rfc, nombre],
  );
  await dueno.query(
    `insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador)
     values ($1, $2, 'miembro', $3, 'cliente', 'alta_proveedor', 'suppliers', $4)`,
    [operadorId, companyId, LUIS, id],
  );
  await dueno.query(
    `insert into supplier_clabes (id, company_id, supplier_id, clabe, digito_valido, vigente_desde)
     values ($1, $2, $3, $4, true, now() - interval '1 day')`,
    [clabeId, companyId, id, CLABE],
  );
  await dueno.query(
    `insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador)
     values ($1, $2, 'miembro', $3, 'cliente', 'clabe_proveedor', 'supplier_clabes', $4)`,
    [operadorId, companyId, LUIS, clabeId],
  );
}
