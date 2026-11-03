import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { CIFRA_NO_PUBLICADA } from "../../dominio/precio.ts";
import { ErrorDeDominio } from "../session/error-de-dominio.ts";
import { conexionIniciada, traducirErrorDeBase } from "../session/db.ts";
import type { Sesion } from "../session/tipos.ts";
import { leerOperadores } from "./operador.ts";
import { SQL, mapearPrecio } from "./repositorio.ts";
import {
  aceptarSuscripcion,
  leerSuscripcionDeLaSesion,
  leerTarifa,
  presentar,
  publicarSuscripcion,
  tarifaSinConsulta,
} from "./servicio.ts";
import type { FilaPrecio, FilaSuscripcion, RepositorioPrecios } from "./repositorio.ts";

const AHORA = new Date("2026-11-03T18:00:00.000Z");
const OPERADORES = new Set(["ana@ejemplo.mx"]);

describe("la tarifa lee el campo y no inventa el monto", () => {
  it("vacío es la frase, y el fallo de lectura no se disfraza de cifra no publicada", async () => {
    const vacia = await leerTarifa({
      repositorio: repo({ precio: precio(null) }),
      ahora: () => AHORA,
    });
    assert.equal(vacia.disponible, true);
    assert.equal(vacia.suscripcionPublicada, false);
    assert.equal(vacia.suscripcion, "cifra no publicada");
    assert.equal(vacia.spei, CIFRA_NO_PUBLICADA);
    assert.equal(vacia.porPersona, "$0.00");
    assert.equal(vacia.porTarjeta, "$0.00");
    assert.equal(vacia.implementacion, "$0.00");
    assert.equal(vacia.publicadaEl, null);

    const caida = await leerTarifa({
      repositorio: {
        ...repo({ precio: precio(null) }),
        leerPrecio: async () => {
          throw new ErrorDeDominio("base_no_disponible");
        },
      },
    });
    assert.equal(caida.disponible, false);
    assert.equal(caida.suscripcion, "No se pudo consultar el precio.");
    assert.notEqual(caida.suscripcion, CIFRA_NO_PUBLICADA);
    assert.equal(caida.suscripcionPublicada, false);
    assert.deepEqual(tarifaSinConsulta().suscripcion, caida.suscripcion);
  });

  it("la misma presentación sirve para la página y para la consola", () => {
    const publicada = presentar(precio(125050n, AHORA));
    assert.equal(publicada.suscripcion, "$1,250.50");
    assert.equal(publicada.suscripcionPublicada, true);
    assert.match(publicada.publicadaEl ?? "", /noviembre de 2026/);
    const pagina = readFileSync(new URL("../../app/precios/page.tsx", import.meta.url), "utf8");
    const consola = readFileSync(new URL("../../app/consola/page.tsx", import.meta.url), "utf8");
    const consolaVista = readFileSync(new URL("../../components/consola/consola-vacia.tsx", import.meta.url), "utf8");
    const renglones = readFileSync(new URL("../../components/precios/renglones.tsx", import.meta.url), "utf8");
    assert.match(pagina, /leerTarifa/);
    assert.match(consola, /leerTarifa/);
    assert.match(pagina, /RenglonesTarifa/);
    assert.match(consolaVista, /RenglonesTarifa/);
    assert.match(renglones, /tarifa\.suscripcion/);
    assert.match(renglones, /tarifa\.porPersona/);
    assert.match(renglones, /tarifa\.porTarjeta/);
    assert.match(renglones, /tarifa\.implementacion/);
  });
});

describe("publicar y aceptar", () => {
  it("quien no es operador no escribe, y el cero tampoco", async () => {
    let publicaciones = 0;
    const base = repo({
      precio: precio(null),
      publicar: async () => {
        publicaciones += 1;
        return precio(1n);
      },
    });
    assert.equal(
      await codigo(publicarSuscripcion(sesion(), "1250.00", { repositorio: base, operadores: new Set() })),
      "no_es_operador",
    );
    assert.equal(
      await codigo(
        publicarSuscripcion(sesion({ usuario: { ...sesion().usuario, correo: "otro@ejemplo.mx" } }), "1250.00", {
          repositorio: base,
          operadores: OPERADORES,
        }),
      ),
      "no_es_operador",
    );
    assert.equal(
      await codigo(publicarSuscripcion(sesion(), "0.00", { repositorio: base, operadores: OPERADORES })),
      "monto_en_cero",
    );
    assert.equal(
      await codigo(publicarSuscripcion(null, "1250.00", { repositorio: base, operadores: OPERADORES })),
      "sesion_ausente",
    );
    assert.equal(publicaciones, 0);
  });

  it("el operador publica centavos una vez y la tarifa muestra ese monto", async () => {
    const estado = repo({ precio: precio(null) });
    const tarifa = await publicarSuscripcion(sesion(), "1,250.50", {
      repositorio: estado,
      operadores: OPERADORES,
      ahora: () => AHORA,
    });
    assert.equal(tarifa.suscripcion, "$1,250.50");
    assert.equal(estado.publicaciones[0]?.centavos, 125050n);
    assert.equal(
      await codigo(
        publicarSuscripcion(sesion(), "99.00", {
          repositorio: estado,
          operadores: OPERADORES,
          ahora: () => AHORA,
        }),
      ),
      "precio_ya_publicado",
    );
    assert.equal(estado.publicaciones.length, 1);
  });

  it("no llama a aceptar si el monto no está publicado", async () => {
    let aceptaciones = 0;
    const persona = sesion();
    const base = repo({
      precio: precio(null),
      suscripcion: suscripcion("recorrido", persona.companyId ?? ""),
      aceptar: async () => {
        aceptaciones += 1;
        throw new Error("no debía aceptar");
      },
    });
    assert.equal(
      await codigo(aceptarSuscripcion(persona, { repositorio: base, operadores: OPERADORES })),
      "precio_no_publicado",
    );
    assert.equal(
      await codigo(aceptarSuscripcion(persona, { repositorio: base, operadores: new Set() })),
      "no_es_operador",
    );
    assert.equal(aceptaciones, 0);
  });

  it("acepta solo la empresa de la sesión cuando el monto ya está publicado", async () => {
    const persona = sesion();
    const estado = repo({
      precio: precio(125050n, AHORA),
      suscripcion: suscripcion("recorrido", persona.companyId ?? ""),
    });
    await aceptarSuscripcion(persona, { repositorio: estado, operadores: OPERADORES, ahora: () => AHORA });
    assert.equal(estado.aceptaciones.length, 1);
    assert.equal(estado.aceptaciones[0]?.companyId, persona.companyId);
    assert.equal(
      await codigo(aceptarSuscripcion(persona, { repositorio: estado, operadores: OPERADORES, ahora: () => AHORA })),
      "suscripcion_ya_aceptada",
    );
    assert.equal(estado.aceptaciones.length, 1);

    const otra = sesion();
    const ajena = repo({
      precio: precio(125050n, AHORA),
      suscripcion: suscripcion("recorrido", otra.companyId ?? ""),
    });
    await aceptarSuscripcion(otra, { repositorio: ajena, operadores: OPERADORES, ahora: () => AHORA });
    assert.equal(ajena.aceptaciones[0]?.companyId, otra.companyId);
    assert.notEqual(ajena.aceptaciones[0]?.companyId, persona.companyId);
  });

  it("la suscripción de la empresa nace como recorrido de 30 días", async () => {
    const persona = sesion();
    const lectura = await leerSuscripcionDeLaSesion(persona, {
      repositorio: repo({ suscripcion: suscripcion("recorrido", persona.companyId ?? "", INICIO_ALTA) }),
      ahora: () => AHORA,
    });
    assert.equal(lectura.tipo, "lista");
    if (lectura.tipo !== "lista") return;
    assert.equal(lectura.estado, "recorrido");
    assert.equal(lectura.titulo, "Recorrido");
    assert.match(lectura.relato, /30 días/);
    assert.equal(
      (await leerSuscripcionDeLaSesion(sesion({ companyId: null }), { repositorio: repo({}) })).tipo,
      "sin_empresa",
    );
  });
});

describe("el libro no trae un precio", () => {
  it("la migración inserta NULL y el update solo cabe si el campo sigue vacío", () => {
    const pricing = readFileSync(new URL("../../../db/migrations/0007_platform_pricing.sql", import.meta.url), "utf8");
    const subscriptions = readFileSync(
      new URL("../../../db/migrations/0008_subscriptions.sql", import.meta.url),
      "utf8",
    );
    assert.match(pricing, /VALUES \(true, NULL, NULL\)/);
    assert.match(pricing, /suscripcion_centavos is null/i);
    assert.match(SQL.publicar, /suscripcion_centavos is null/i);
    assert.match(subscriptions, /la suscripcion no pasa a aceptada sin monto publicado/);
    assert.match(subscriptions, /'recorrido'/);
    assert.equal(/\b\d{3,}\b/.test(pricing), false);
    assert.equal(/\b\d{3,}\b/.test(subscriptions), false);
    assert.equal(pricing.toLowerCase().includes("gratis"), false);
    const interfaz = [
      "src/components/precios/renglones.tsx",
      "src/components/precios/suscripcion-empresa.tsx",
      "src/components/precios/formulario-publicar.tsx",
      "src/components/precios/formulario-aceptar.tsx",
      "src/app/precios/page.tsx",
    ]
      .map((ruta) => readFileSync(new URL(`../../../${ruta}`, import.meta.url), "utf8"))
      .join("\n");
    assert.equal(/gratis|cashback|rendimiento|\bCAT\b|\bfree\b|\btrial\b/i.test(interfaz), false);
    assert.match(readFileSync(new URL("../../components/precios/suscripcion-empresa.tsx", import.meta.url), "utf8"), /existePasoAceptada/);
    assert.match(
      readFileSync(new URL("../../components/precios/suscripcion-empresa.tsx", import.meta.url), "utf8"),
      /paso \? <FormularioAceptar/,
    );
    assert.equal(readFileSync(new URL("../../app/precios/page.tsx", import.meta.url), "utf8").includes("FormularioAceptar"), false);
  });

  it("un error del trigger no copia el mensaje del driver", () => {
    const traducido = traducirErrorDeBase(
      Object.assign(new Error("la suscripcion no pasa a aceptada sin monto publicado"), { code: "P0001" }),
    );
    assert.equal(traducido.message, "precio_no_publicado");
    const secreto = traducirErrorDeBase(
      Object.assign(new Error("postgres://usuario:secreto@host/plataforma"), { code: "P0001" }),
    );
    assert.equal(secreto.message, "base_no_disponible");
    assert.equal((secreto.stack ?? "").includes("secreto@"), false);
  });

  it("mapear un centavo en cero o un texto no es una cifra publicada", () => {
    assert.equal(mapearPrecio({ fila_id: randomUUID(), suscripcion_centavos: null, publicado_en: null }).centavos, null);
    assert.throws(
      () => mapearPrecio({ fila_id: randomUUID(), suscripcion_centavos: "0", publicado_en: AHORA.toISOString() }),
      (error: unknown) => error instanceof ErrorDeDominio,
    );
    assert.throws(
      () => mapearPrecio({ fila_id: randomUUID(), suscripcion_centavos: "12.5", publicado_en: null }),
      (error: unknown) => error instanceof ErrorDeDominio,
    );
  });

  it("importar no abre la base", async () => {
    await import("./index.ts");
    assert.equal(conexionIniciada(), false);
  });
});

describe("operadores", () => {
  it("normaliza la lista y no toma un correo mal formado", () => {
    const lista = leerOperadores(" Ana@Ejemplo.mx, no-es-correo, , otRa@dominio.mx ");
    assert.equal(lista.has("ana@ejemplo.mx"), true);
    assert.equal(lista.has("otra@dominio.mx"), true);
    assert.equal(lista.size, 2);
    assert.equal(leerOperadores(undefined).size, 0);
  });
});

const INICIO_ALTA = new Date("2026-11-01T12:00:00.000Z");

function sesion(parcial: Partial<Sesion> = {}): Sesion {
  return {
    id: randomUUID(),
    venceEn: new Date("2026-12-03T18:00:00.000Z"),
    usuario: { id: randomUUID(), nombre: "Ana Pérez", correo: "ana@ejemplo.mx" },
    companyId: randomUUID(),
    rol: "administrador",
    ...parcial,
  };
}

function precio(centavos: bigint | null, publicadoEn: Date | null = centavos === null ? null : AHORA): FilaPrecio {
  return { filaId: randomUUID(), centavos, publicadoEn };
}

function suscripcion(
  estado: "recorrido" | "aceptada",
  companyId = randomUUID(),
  inicio = INICIO_ALTA,
): FilaSuscripcion {
  return {
    companyId,
    estado,
    recorridoInicio: inicio,
    aceptadaEn: estado === "aceptada" ? AHORA : null,
    aceptadaPorNombre: estado === "aceptada" ? "Ana Pérez" : null,
  };
}

function repo(opciones: {
  precio?: FilaPrecio;
  suscripcion?: FilaSuscripcion | null;
  publicar?: RepositorioPrecios["publicar"];
  aceptar?: RepositorioPrecios["aceptar"];
}): RepositorioPrecios & { publicaciones: { centavos: bigint }[]; aceptaciones: { companyId: string }[] } {
  let actual = opciones.precio ?? precio(null);
  let fila = opciones.suscripcion === undefined ? null : opciones.suscripcion;
  const publicaciones: { centavos: bigint }[] = [];
  const aceptaciones: { companyId: string }[] = [];
  return {
    publicaciones,
    aceptaciones,
    async leerPrecio() {
      return actual;
    },
    async publicar(entrada) {
      if (opciones.publicar) return opciones.publicar(entrada);
      if (actual.centavos !== null) throw new ErrorDeDominio("precio_ya_publicado");
      actual = { filaId: actual.filaId, centavos: entrada.centavos, publicadoEn: entrada.cuando };
      publicaciones.push({ centavos: entrada.centavos });
      return actual;
    },
    async leerSuscripcion(companyId) {
      if (!fila || fila.companyId !== companyId) return null;
      return fila;
    },
    async aceptar(entrada) {
      if (opciones.aceptar) return opciones.aceptar(entrada);
      if (actual.centavos === null) throw new ErrorDeDominio("precio_no_publicado");
      if (!fila || fila.companyId !== entrada.companyId) throw new ErrorDeDominio("suscripcion_ausente");
      if (fila.estado !== "recorrido") throw new ErrorDeDominio("suscripcion_ya_aceptada");
      fila = {
        ...fila,
        estado: "aceptada",
        aceptadaEn: entrada.cuando,
        aceptadaPorNombre: "Ana Pérez",
      };
      aceptaciones.push({ companyId: entrada.companyId });
      return fila;
    },
  };
}

async function codigo(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
  } catch (error) {
    if (error instanceof ErrorDeDominio) return error.codigo;
    throw error;
  }
  throw new Error("la operación no rechazó");
}
