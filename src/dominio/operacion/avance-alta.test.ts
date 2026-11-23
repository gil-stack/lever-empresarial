import assert from "node:assert/strict";
import { test } from "node:test";

import { avanceDelAlta, type HechosDelAlta } from "./avance-alta.ts";

const NUEVO: HechosDelAlta = {
  estado: "prospecto",
  borrador: false,
  enviada: null,
  riesgo: null,
  activacion: null,
  invitacion: null,
  administradorActivo: false,
};

const estados = (h: HechosDelAlta) => Object.fromEntries(avanceDelAlta(h).pasos.map((paso) => [paso.clave, paso.estado]));

test("un prospecto recién registrado: solo el registro está hecho y sigue el expediente", () => {
  const avance = avanceDelAlta(NUEVO);
  assert.equal(avance.hechos, 1);
  assert.equal(avance.total, 6);
  assert.equal(avance.siguiente?.clave, "expediente");
  assert.equal(avance.siguiente?.estado, "pendiente");
});

test("expediente en captura, enviado y dictaminado", () => {
  assert.equal(estados({ ...NUEVO, borrador: true }).expediente, "en_curso");
  const enviado = { ...NUEVO, enviada: { resultado: null } };
  assert.deepEqual([estados(enviado).expediente, estados(enviado).dictamen], ["hecho", "en_curso"]);
  const observado = { ...NUEVO, enviada: { resultado: "observado" as const } };
  assert.deepEqual([estados(observado).expediente, estados(observado).dictamen], ["atencion", "atencion"]);
  assert.equal(avanceDelAlta(observado).siguiente?.clave, "expediente");
  assert.equal(estados({ ...observado, borrador: true }).expediente, "en_curso");
  const aprobado = { ...NUEVO, enviada: { resultado: "aprobado" as const } };
  assert.deepEqual([estados(aprobado).dictamen, estados(aprobado).riesgo], ["hecho", "en_curso"]);
});

test("con el riesgo vigente la activación queda lista; pedida, espera a Aprobación; rechazada, pide atención", () => {
  const listo = { ...NUEVO, enviada: { resultado: "aprobado" as const }, riesgo: "vigente" as const };
  assert.equal(avanceDelAlta(listo).siguiente?.clave, "activacion");
  assert.equal(estados(listo).activacion, "en_curso");
  assert.equal(estados({ ...listo, estado: "en_alta", activacion: "pendiente" }).activacion, "en_curso");
  assert.equal(estados({ ...listo, activacion: "rechazada" }).activacion, "atencion");
  assert.equal(estados({ ...listo, riesgo: "vencida" }).riesgo, "atencion");
});

test("activa: falta el administrador hasta que entra", () => {
  const activa = { ...NUEVO, estado: "activa" as const, enviada: { resultado: "aprobado" as const }, riesgo: "vigente" as const, activacion: "aprobada" as const };
  assert.equal(avanceDelAlta(activa).siguiente?.clave, "administrador");
  assert.equal(estados({ ...activa, invitacion: "vigente" }).administrador, "en_curso");
  assert.equal(estados({ ...activa, invitacion: "vencida" }).administrador, "atencion");
  const completa = avanceDelAlta({ ...activa, invitacion: "usada", administradorActivo: true });
  assert.equal(completa.hechos, 6);
  assert.equal(completa.siguiente, null);
});

test("suspendida: el alta se hizo, pero no salen invitaciones", () => {
  const suspendida = avanceDelAlta({ ...NUEVO, estado: "suspendida", enviada: { resultado: "aprobado" }, riesgo: "vigente" });
  assert.equal(suspendida.siguiente?.clave, "administrador");
  assert.equal(suspendida.siguiente?.estado, "atencion");
});
