import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { cerrarConexion } from "../../src/nucleo/db.ts";
import { ErrorDeDominio } from "../../src/nucleo/error-de-dominio.ts";
import { cifrarSemilla } from "../../src/server/autenticacion/cifrado.ts";
import { repositorioPg } from "../../src/server/autenticacion/repositorio.ts";
import { hashDeRespaldo } from "../../src/server/autenticacion/respaldo.ts";
import {
  entrarConRespaldo,
  entrarConTotp,
  iniciarConContrasena,
  inscribirPasskey,
  inscribirTotp,
  leerPaso,
  opcionesParaInscribirPasskey,
  pedirRecuperacion,
  prepararTotp,
  type DependenciasAutenticacion,
} from "../../src/server/autenticacion/servicio.ts";
import { codigoDelPaso, pasoDe } from "../../src/server/autenticacion/totp.ts";
import type { AdaptadorWebauthn } from "../../src/server/autenticacion/webauthn.ts";
import type { AvisoDeSeguridad } from "../../src/server/seguridad/avisos.ts";
import { hashDeToken, hashearContrasena } from "../../src/server/session/hash.ts";
import { leerSesion } from "../../src/server/session/servicio.ts";
import { aplicarArchivo, conBaseDesechable, exigirBaseDesechable, urlDeAplicacion } from "../aislamiento/postgres.ts";

/**
 * Recuperación del segundo factor con los factores viejos todavía vivos
 * (0027_recuperacion_factor_nuevo): con la recuperación aprobada se inscribe
 * un factor nuevo, y en la misma transacción se revocan la app y las passkeys
 * viejas, se invalidan los códigos de respaldo viejos y se cierran las demás
 * sesiones, cada cosa con su evento. Si algo falla, no cambia nada.
 */

const urlAdmin = process.env.AISLAMIENTO_DATABASE_URL?.trim() ?? "";
const CLAVE = "clave-segura-12";
const LLAVE = Buffer.alloc(32, 7);
const SEMILLA_VIEJA = Buffer.from("semilla-vieja-000001");
const SEMILLA_NUEVA = Buffer.from("semilla-nueva-000002");
const ORIGEN = { rpID: "localhost", origen: "http://localhost:3000" };

type Cliente = {
  connect: () => Promise<void>;
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
  end: () => Promise<void>;
};

describe("recuperación con factores viejos en Postgres", { skip: urlAdmin.length === 0 }, () => {
  it("inscribe el factor nuevo, deja sin efecto los viejos con su bitácora y, si algo falla, no cambia nada", async () => {
    exigirBaseDesechable();
    await conBaseDesechable(urlAdmin, async (urlDuena) => {
      const dir = join(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");
      for (const archivo of readdirSync(dir).sort()) if (archivo.endsWith(".sql")) aplicarArchivo(urlDuena, join(dir, archivo));
      const { Client } = (await import("pg")) as unknown as { Client: new (opts: { connectionString: string }) => Cliente };
      const duena = new Client({ connectionString: urlDuena });
      await duena.connect();
      process.env.DATABASE_URL = urlDeAplicacion(urlDuena);
      await cerrarConexion();
      try {
        const operador = String((await duena.query("select id from operators order by alta_en limit 1")).rows[0]?.id);
        const hash = await hashearContrasena(CLAVE);
        const op = randomUUID();
        const personas = {
          laura: randomUUID(),
          mario: randomUUID(),
          beto: randomUUID(),
          carla: randomUUID(),
          eva: randomUUID(),
          fer: randomUUID(),
        };
        for (const [nombre, id] of Object.entries(personas)) {
          await duena.query("insert into users (id, nombre, correo, password_hash) values ($1, $2, $3, $4)", [
            id,
            nombre,
            `${nombre}@empresa.mx`,
            hash,
          ]);
        }
        await duena.query("insert into users (id, nombre, correo, password_hash) values ($1, 'Personal', 'op@lever.mx', $2)", [
          op,
          hash,
        ]);
        await duena.query("insert into platform_staff (operator_id, user_id, estado) values ($1, $2, 'activo')", [operador, op]);
        const repo = repositorioPg();
        const t0 = Date.now();
        const en = (segundos: number) => new Date(t0 + segundos * 1000);
        const avisos: AvisoDeSeguridad[] = [];
        const deps = (segundos: number, extra: DependenciasAutenticacion = {}): DependenciasAutenticacion => ({
          ahora: () => en(segundos),
          llaveTotp: LLAVE,
          avisar: async (aviso) => void avisos.push(aviso),
          ...extra,
        });
        const entrar = async (nombre: keyof typeof personas, segundos: number) => {
          const inicio = await iniciarConContrasena({ correo: `${nombre}@empresa.mx`, contrasena: CLAVE }, deps(segundos));
          if (inicio.tipo !== "entrada") throw new Error(inicio.codigo);
          return inicio.cookie.valor;
        };
        /** Inscripción normal (sin recuperación): app con la semilla vieja, diez códigos y la primera sesión. */
        const conAppVieja = async (nombre: keyof typeof personas) => {
          const token = await entrar(nombre, 0);
          await prepararTotp(token, deps(0, { semilla: () => SEMILLA_VIEJA }));
          return inscribirTotp(token, codigoDelPaso(SEMILLA_VIEJA, pasoDe(en(0))), deps(0));
        };
        const conPasskeyVieja = async (userId: string) => {
          const id = randomUUID();
          await repo.agregarPasskey({
            userId,
            passkey: {
              id,
              credencialId: `credencial-vieja-${userId}`,
              llavePublica: new Uint8Array(32).fill(1),
              contador: 0,
              transportes: ["internal"],
              nombre: "Laptop vieja",
              respaldada: false,
            },
            ahora: en(0),
          });
          return id;
        };
        const aprobar = async (userId: string, segundos: number, venceEn: Date) => {
          await pedirRecuperacion(await entrar(nombreDe(personas, userId), segundos), "Perdí el teléfono", deps(segundos));
          const id = String(
            (await duena.query("select id from auth_recuperaciones where user_id = $1 and estado = 'solicitada'", [userId])).rows[0]
              ?.id,
          );
          await repo.aprobarRecuperacion({ id, aprobadorId: op, verificacion: "videollamada", nota: null, ahora: en(segundos), venceEn });
          return id;
        };
        const vivos = async (userId: string) =>
          (
            await duena.query(
              `select
                 (select count(*) from auth_passkeys where user_id = $1 and revocada_en is null)::int as passkeys,
                 (select count(*) from auth_totp where user_id = $1 and revocado_en is null and confirmado_en is not null)::int as apps,
                 (select count(*) from auth_totp where user_id = $1 and revocado_en is null and confirmado_en is null)::int as pendientes,
                 (select count(*) from auth_codigos_respaldo where user_id = $1 and usado_en is null and invalidado_en is null)::int as codigos,
                 (select count(*) from sessions where user_id = $1)::int as sesiones,
                 (select count(*) from audit_log where actor_id = $1)::int as eventos`,
              [userId],
            )
          ).rows[0];

        // 1. Laura: app vieja, passkey vieja, diez códigos y una sesión abierta en otro equipo.
        const inscripcionVieja = await conAppVieja("laura");
        const passkeyVieja = await conPasskeyVieja(personas.laura);
        const appVieja = String(
          (await duena.query("select id from auth_totp where user_id = $1 and confirmado_en is not null", [personas.laura])).rows[0]?.id,
        );
        const otroEquipo = await entrarConTotp(
          await entrar("laura", 30),
          codigoDelPaso(SEMILLA_VIEJA, pasoDe(en(30))),
          deps(30),
        );
        const cookieOtroEquipo = otroEquipo.split(";")[0]!;
        assert.ok(await leerSesion(cookieOtroEquipo), "control: la sesión del otro equipo está viva");
        const sesionOtroEquipo = String((await duena.query("select id from sessions where user_id = $1", [personas.laura])).rows[0]?.id);

        // 2. Pide la recuperación y otra persona la aprueba.
        const recuperacion = await aprobar(personas.laura, 60, en(60 + 12 * 3600));

        // 3. Entra con contraseña: ya no le pide el factor perdido, le pide registrar uno nuevo.
        const token = await entrar("laura", 90);
        assert.deepEqual(await leerPaso(token, deps(90)), {
          paso: "inscribir",
          nombre: "laura",
          correo: "laura@empresa.mx",
          porRecuperacion: true,
        });
        await prepararTotp(token, deps(90, { semilla: () => SEMILLA_NUEVA }));
        assert.deepEqual(
          { apps: (await vivos(personas.laura))?.apps, pendientes: (await vivos(personas.laura))?.pendientes },
          { apps: 1, pendientes: 1 },
          "0027: la app pendiente cabe junto a la confirmada vieja",
        );

        // 4. Confirma la app nueva.
        const inscripcion = await inscribirTotp(token, codigoDelPaso(SEMILLA_NUEVA, pasoDe(en(90))), deps(90));
        assert.equal(inscripcion.codigos.length, 10);
        assert.deepEqual(await vivos(personas.laura), {
          passkeys: 0,
          apps: 1,
          pendientes: 0,
          codigos: 10,
          sesiones: 1,
          eventos: (await vivos(personas.laura))?.eventos,
        });
        const appNueva = String(
          (
            await duena.query("select id from auth_totp where user_id = $1 and revocado_en is null and confirmado_en is not null", [
              personas.laura,
            ])
          ).rows[0]?.id,
        );
        assert.notEqual(appNueva, appVieja);
        const viejaFila = (await duena.query("select revocado_en, revocado_por from auth_totp where id = $1", [appVieja])).rows[0];
        assert.ok(viejaFila?.revocado_en instanceof Date);
        assert.equal(viejaFila?.revocado_por, personas.laura);
        assert.equal(
          (await duena.query("select revocada_por from auth_passkeys where id = $1", [passkeyVieja])).rows[0]?.revocada_por,
          personas.laura,
        );
        for (const codigo of inscripcionVieja.codigos) {
          const fila = (
            await duena.query("select invalidado_en, usado_en from auth_codigos_respaldo where codigo_hash = $1", [
              hashDeRespaldo(codigo.replace(/-/g, "")),
            ])
          ).rows[0];
          assert.ok(fila?.invalidado_en instanceof Date || fila?.usado_en instanceof Date, "cada código viejo quedó sin efecto");
        }
        assert.equal(
          (await duena.query("select estado from auth_recuperaciones where id = $1", [recuperacion])).rows[0]?.estado,
          "cumplida",
        );

        // 5. Cada paso dejó su evento, todos en la misma transacción.
        const bitacora = (
          await duena.query(
            `select accion, identificador, txid from audit_log
             where actor_id = $1 and accion in
               ('passkey_revocada', 'totp_revocado', 'sesion_cerrada', 'totp_confirmado', 'respaldo_generado', 'recuperacion_cumplida', 'entrada_completa')
               and ocurrido_en = $2`,
            [personas.laura, en(90)],
          )
        ).rows;
        const porAccion = Object.fromEntries(bitacora.map((fila) => [String(fila.accion), String(fila.identificador)]));
        assert.deepEqual(Object.keys(porAccion).sort(), [
          "entrada_completa",
          "passkey_revocada",
          "recuperacion_cumplida",
          "respaldo_generado",
          "sesion_cerrada",
          "totp_confirmado",
          "totp_revocado",
        ]);
        assert.equal(porAccion.passkey_revocada, passkeyVieja);
        assert.equal(porAccion.totp_revocado, appVieja);
        assert.equal(porAccion.sesion_cerrada, sesionOtroEquipo);
        assert.equal(porAccion.totp_confirmado, appNueva);
        assert.equal(porAccion.recuperacion_cumplida, recuperacion);
        assert.equal(new Set(bitacora.map((fila) => String(fila.txid))).size, 1, "una sola transacción");
        assert.deepEqual(
          avisos.filter((a) => a.para === "laura@empresa.mx").map((a) => a.cambio),
          ["factor_reinscrito"],
        );

        // 6. Lo viejo ya no abre nada: ni la sesión del otro equipo, ni la app, ni un código, ni la passkey.
        assert.equal(await leerSesion(cookieOtroEquipo), null);
        assert.equal(
          await codigoDe(entrarConTotp(await entrar("laura", 150), codigoDelPaso(SEMILLA_VIEJA, pasoDe(en(150))), deps(150))),
          "segundo_factor_invalido",
        );
        assert.equal(
          await codigoDe(entrarConRespaldo(await entrar("laura", 150), inscripcionVieja.codigos[5], deps(150))),
          "segundo_factor_invalido",
        );
        assert.deepEqual(await leerPaso(await entrar("laura", 150), deps(150)), {
          paso: "verificar",
          nombre: "laura",
          passkey: false,
          totp: true,
          respaldo: true,
          solicitudAbierta: false,
        });
        // Control: la app nueva sí abre.
        assert.match(
          await entrarConTotp(await entrar("laura", 180), codigoDelPaso(SEMILLA_NUEVA, pasoDe(en(180))), deps(180)),
          /sesion=/,
        );

        // 7. Rollback: si falla cualquier parte de la transacción, nada cambia.
        await conAppVieja("mario");
        await conPasskeyVieja(personas.mario);
        await aprobar(personas.mario, 60, en(240));
        const tokenMario = await entrar("mario", 90);
        await prepararTotp(tokenMario, deps(90, { semilla: () => SEMILLA_NUEVA }));
        const antes = await vivos(personas.mario);
        assert.deepEqual(antes, { passkeys: 1, apps: 1, pendientes: 1, codigos: 10, sesiones: 1, eventos: antes?.eventos });
        const entradaMario = await repo.leerEntrada(hashDeToken(tokenMario), en(90));
        assert.ok(entradaMario);
        const recuperacionMario = String(
          (await duena.query("select id from auth_recuperaciones where user_id = $1 and estado = 'aprobada'", [personas.mario]))
            .rows[0]?.id,
        );
        const pendienteMario = String(
          (await duena.query("select id from auth_totp where user_id = $1 and confirmado_en is null", [personas.mario])).rows[0]?.id,
        );
        const intentar = async (totpId: string, segundos: number) => {
          await repo.apartarIntentoDeEntrada(entradaMario.id, personas.mario);
          return codigoDe(
            repo.completarEntrada({
              entradaId: entradaMario.id,
              userId: personas.mario,
              metodo: "totp",
              sesion: { id: randomUUID(), tokenHash: hashDeToken(randomUUID()), expiresAt: en(3600), superficie: "cliente" },
              efecto: {
                tipo: "inscribir_totp",
                totpId,
                paso: pasoDe(en(segundos)),
                codigosHash: Array.from({ length: 10 }, () => hashDeRespaldo(randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase())),
                recuperacionId: recuperacionMario,
              },
              ahora: en(segundos),
            }),
          );
        };
        // 7a. La app que se confirma no existe: falla después de revocar.
        assert.equal(await intentar(randomUUID(), 90), "segundo_factor_invalido");
        assert.deepEqual(await vivos(personas.mario), antes, "la revocación se deshizo completa");
        // 7b. La recuperación venció justo antes: falla al final, después de confirmar la app nueva.
        assert.equal(await intentar(pendienteMario, 300), "recuperacion_vencida");
        assert.deepEqual(await vivos(personas.mario), antes, "la confirmación y la revocación se deshicieron completas");

        // 8. Con la recuperación vencida ya no se inscribe: vuelve a pedir el factor de siempre.
        const tarde = await entrar("mario", 300);
        assert.equal((await leerPaso(tarde, deps(300))).paso, "verificar");
        assert.equal(await codigoDe(prepararTotp(tarde, deps(300))), "ya_tiene_segundo_factor");
        assert.equal(
          await codigoDe(inscribirTotp(tarde, codigoDelPaso(SEMILLA_NUEVA, pasoDe(en(300))), deps(300))),
          "ya_tiene_segundo_factor",
        );
        assert.deepEqual(await vivos(personas.mario), { ...antes, eventos: (await vivos(personas.mario))?.eventos });

        // 8b. Con la app vieja viva, la base no deja confirmar la nueva: hay que revocar la vieja antes, en la misma
        // transacción. Pasa por los triggers de auth_totp con una fila pendiente junto a una confirmada.
        await duena.query("begin");
        await assert.rejects(
          duena.query("update auth_totp set confirmado_en = now(), ultimo_paso = $2 where id = $1", [
            pendienteMario,
            pasoDe(en(300)),
          ]),
          /auth_totp_uno_confirmado/,
        );
        await duena.query("rollback");
        await duena.query("begin");
        await duena.query(
          `update auth_totp set revocado_en = now(), revocado_por = $1
           where user_id = $1 and confirmado_en is not null and revocado_en is null`,
          [personas.mario],
        );
        const cabe = await duena.query("update auth_totp set confirmado_en = now(), ultimo_paso = $2 where id = $1", [
          pendienteMario,
          pasoDe(en(300)),
        ]);
        assert.equal(cabe.rowCount, 1, "control: con la vieja revocada antes, la nueva sí se confirma");
        await duena.query("rollback");

        // 9. Sin recuperación, quien tiene factores sigue en verificar y la base no deja inscribir otro.
        await conAppVieja("beto");
        const tokenBeto = await entrar("beto", 60);
        assert.equal((await leerPaso(tokenBeto, deps(60))).paso, "verificar");
        assert.equal(await codigoDe(prepararTotp(tokenBeto, deps(60))), "ya_tiene_segundo_factor");
        const entradaBeto = await repo.leerEntrada(hashDeToken(tokenBeto), en(60));
        assert.ok(entradaBeto);
        await repo.apartarIntentoDeEntrada(entradaBeto.id, personas.beto);
        assert.equal(
          await codigoDe(
            repo.completarEntrada({
              entradaId: entradaBeto.id,
              userId: personas.beto,
              metodo: "passkey",
              sesion: { id: randomUUID(), tokenHash: hashDeToken(randomUUID()), expiresAt: en(3600), superficie: "cliente" },
              efecto: {
                tipo: "inscribir_passkey",
                passkey: {
                  id: randomUUID(),
                  credencialId: `credencial-intrusa-${personas.beto}`,
                  llavePublica: new Uint8Array(32).fill(2),
                  contador: 0,
                  transportes: [],
                  nombre: "Intrusa",
                  respaldada: false,
                },
                codigosHash: [],
                recuperacionId: null,
              },
              ahora: en(60),
            }),
          ),
          "ya_tiene_segundo_factor",
        );
        // El índice de 0027 no deja dos apps confirmadas vigentes ni dos pendientes.
        for (const confirmada of [true, false]) {
          await duena.query("begin");
          if (!confirmada) {
            await duena.query("insert into auth_totp (id, user_id, secreto_cifrado, creado_en) values ($1, $2, $3, now())", [
              randomUUID(),
              personas.beto,
              cifradoDePrueba(),
            ]);
          }
          await assert.rejects(
            duena.query(
              `insert into auth_totp (id, user_id, secreto_cifrado, creado_en, confirmado_en)
               values ($1, $2, $3, now(), ${confirmada ? "now()" : "null"})`,
              [randomUUID(), personas.beto, cifradoDePrueba()],
            ),
            confirmada ? /auth_totp_uno_confirmado/ : /auth_totp_uno_pendiente/,
          );
          await duena.query("rollback");
        }

        // 10. Con passkey nueva: la vieja se revoca antes de guardar la nueva, que queda vigente.
        await conAppVieja("carla");
        const passkeyCarla = await conPasskeyVieja(personas.carla);
        await aprobar(personas.carla, 60, en(60 + 12 * 3600));
        const tokenCarla = await entrar("carla", 90);
        const conLlave = deps(90, { webauthn: webauthnQueRegistra(`credencial-nueva-${personas.carla}`) });
        await opcionesParaInscribirPasskey(tokenCarla, ORIGEN, conLlave);
        await inscribirPasskey(tokenCarla, { id: "nueva" }, ORIGEN, "Teléfono nuevo", conLlave);
        const llaves = (
          await duena.query("select id, nombre, revocada_en is null as vigente from auth_passkeys where user_id = $1 order by creada_en", [
            personas.carla,
          ])
        ).rows;
        assert.deepEqual(
          llaves.map((fila) => [fila.id === passkeyCarla ? "vieja" : fila.nombre, fila.vigente]),
          [
            ["vieja", false],
            ["Teléfono nuevo", true],
          ],
        );
        assert.deepEqual(await vivos(personas.carla), {
          passkeys: 1,
          apps: 0,
          pendientes: 0,
          codigos: 10,
          sesiones: 1,
          eventos: (await vivos(personas.carla))?.eventos,
        });

        // 11. Doble envío de la confirmación: dos a la vez dejan exactamente una app nueva.
        await conAppVieja("eva");
        await aprobar(personas.eva, 60, en(60 + 12 * 3600));
        const tokenEva = await entrar("eva", 90);
        await prepararTotp(tokenEva, deps(90, { semilla: () => SEMILLA_NUEVA }));
        const codigoEva = codigoDelPaso(SEMILLA_NUEVA, pasoDe(en(90)));
        const dos = await Promise.allSettled([
          inscribirTotp(tokenEva, codigoEva, deps(90)),
          inscribirTotp(tokenEva, codigoEva, deps(90)),
        ]);
        assert.deepEqual(
          dos.map((r) => r.status).sort(),
          ["fulfilled", "rejected"],
          "una confirmación entra y la otra se rechaza",
        );
        assert.deepEqual(await vivos(personas.eva), {
          passkeys: 0,
          apps: 1,
          pendientes: 0,
          codigos: 10,
          sesiones: 1,
          eventos: (await vivos(personas.eva))?.eventos,
        });
        assert.equal(
          Number(
            (
              await duena.query("select count(*)::int as n from audit_log where actor_id = $1 and accion = 'totp_confirmado'", [
                personas.eva,
              ])
            ).rows[0]?.n,
          ),
          2,
          "la del primer ingreso y una sola nueva",
        );

        // 12. Preparar otra vez no deja dos pendientes: muestra la misma, y guardar otra reemplaza a la anterior.
        await conAppVieja("fer");
        await aprobar(personas.fer, 60, en(60 + 12 * 3600));
        const tokenFer = await entrar("fer", 90);
        const pendientesFer = async () =>
          (
            await duena.query("select id from auth_totp where user_id = $1 and confirmado_en is null and revocado_en is null", [
              personas.fer,
            ])
          ).rows.map((fila) => String(fila.id));
        const primera = await prepararTotp(tokenFer, deps(90, { semilla: () => SEMILLA_NUEVA }));
        const [pendienteFer] = await pendientesFer();
        const segunda = await prepararTotp(tokenFer, deps(95, { semilla: () => SEMILLA_VIEJA }));
        assert.equal(segunda.semilla, primera.semilla, "preparar otra vez muestra la misma app pendiente");
        assert.deepEqual(await pendientesFer(), [pendienteFer]);
        const reemplazo = randomUUID();
        await repo.guardarTotpPendiente({
          id: reemplazo,
          userId: personas.fer,
          secretoCifrado: cifrarSemilla(SEMILLA_VIEJA, personas.fer, LLAVE),
          creadoEn: en(100),
        });
        assert.deepEqual(await pendientesFer(), [reemplazo], "la pendiente nueva reemplaza a la anterior");
        assert.equal(
          (await duena.query("select count(*)::int as n from auth_totp where id = $1", [pendienteFer])).rows[0]?.n,
          0,
          "la pendiente anterior se borró: no queda basura",
        );
        assert.equal((await vivos(personas.fer))?.apps, 1, "la app confirmada vieja sigue viva hasta confirmar la nueva");
      } finally {
        await duena.end();
        await cerrarConexion();
        delete process.env.DATABASE_URL;
      }
    });
  });

  it("0027 se aplica sobre datos que ya cumplían el índice de 0019 y los conserva", async () => {
    exigirBaseDesechable();
    await conBaseDesechable(urlAdmin, async (urlDuena) => {
      const dir = join(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");
      const archivos = readdirSync(dir)
        .filter((archivo) => archivo.endsWith(".sql"))
        .sort();
      for (const archivo of archivos.filter((nombre) => nombre < "0027")) aplicarArchivo(urlDuena, join(dir, archivo));
      const { Client } = (await import("pg")) as unknown as { Client: new (opts: { connectionString: string }) => Cliente };
      const duena = new Client({ connectionString: urlDuena });
      await duena.connect();
      try {
        const [conApp, conPendiente, conAmbas] = [randomUUID(), randomUUID(), randomUUID()];
        const hash = await hashearContrasena(CLAVE);
        for (const id of [conApp, conPendiente, conAmbas]) {
          await duena.query("insert into users (id, nombre, correo, password_hash) values ($1, $2, $3, $4)", [
            id,
            `persona ${id.slice(0, 4)}`,
            `${id}@empresa.mx`,
            hash,
          ]);
        }
        const fila = (userId: string, confirmada: boolean, revocada: boolean) =>
          duena.query(
            `insert into auth_totp (id, user_id, secreto_cifrado, creado_en, confirmado_en, ultimo_paso, revocado_en, revocado_por)
             values ($1, $2, $3, now(), ${confirmada ? "now(), 1" : "null, null"}, ${revocada ? "now(), $2" : "null, null"})`,
            [randomUUID(), userId, cifradoDePrueba()],
          );
        // Como en producción con 0025: a lo más una fila viva por persona, más las revocadas que haya.
        await fila(conApp, true, true);
        await fila(conApp, true, false);
        await fila(conPendiente, false, false);
        await fila(conAmbas, true, true);
        await fila(conAmbas, false, false);
        await duena.query("begin");
        await assert.rejects(fila(conApp, false, false), /auth_totp_uno_vigente/, "con 0025, la pendiente no cabe junto a la app");
        await duena.query("rollback");

        const consultaPrevia = `select user_id from auth_totp where revocado_en is null group by user_id
          having count(*) filter (where confirmado_en is not null) > 1 or count(*) filter (where confirmado_en is null) > 1`;
        assert.equal((await duena.query(consultaPrevia)).rows.length, 0, "nada viola los índices nuevos antes de aplicar 0027");
        const antes = (await duena.query("select id, confirmado_en, revocado_en from auth_totp order by id")).rows;

        for (const archivo of archivos.filter((nombre) => nombre >= "0027")) aplicarArchivo(urlDuena, join(dir, archivo));
        assert.deepEqual((await duena.query("select id, confirmado_en, revocado_en from auth_totp order by id")).rows, antes);
        const indices = (
          await duena.query("select indexname from pg_indexes where tablename = 'auth_totp' and indexname like 'auth_totp_uno_%' order by 1")
        ).rows.map((fila) => fila.indexname);
        assert.deepEqual(indices, ["auth_totp_uno_confirmado", "auth_totp_uno_pendiente"]);
        await fila(conApp, false, false);
        assert.equal(
          (await duena.query("select count(*)::int as n from auth_totp where user_id = $1 and revocado_en is null", [conApp])).rows[0]?.n,
          2,
          "con 0027, la app pendiente cabe junto a la confirmada",
        );
      } finally {
        await duena.end();
      }
    });
  });
});

function nombreDe<T extends Record<string, string>>(personas: T, userId: string): keyof T {
  const nombre = Object.keys(personas).find((clave) => personas[clave] === userId);
  if (!nombre) throw new Error("persona desconocida");
  return nombre as keyof T;
}

/** Formato válido de semilla cifrada; el contenido no importa para el índice. */
function cifradoDePrueba(): string {
  return `v1.${"a".repeat(16)}.${"b".repeat(40)}.${"c".repeat(22)}`;
}

/** Registra una credencial con el id dado sobre el reto que la puerta guardó. */
function webauthnQueRegistra(credencialId: string): AdaptadorWebauthn {
  const reto = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "").slice(0, 11);
  return {
    async opcionesRegistro() {
      return { opciones: { challenge: reto }, reto };
    },
    async verificarRegistro(args) {
      if (args.reto !== reto) return null;
      return { credencialId, llavePublica: new Uint8Array(32).fill(5), contador: 0, transportes: ["internal"], respaldada: false };
    },
    async opcionesEntrada() {
      throw new Error("no se usa");
    },
    async verificarEntrada() {
      return null;
    },
  };
}

async function codigoDe(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
  } catch (error) {
    if (error instanceof ErrorDeDominio) return error.codigo;
    throw error;
  }
  return "ok";
}
