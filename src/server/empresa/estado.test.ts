import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { empresaSuspendida, membresiaConRoles } from "./estado.ts";

describe("guardia del estado de la empresa", () => {
  it("solo activa y suspendida conservan los roles de la membresía", () => {
    assert.deepEqual(["activa", "suspendida", "prospecto", "en_alta", "baja", null].map(membresiaConRoles), [true, true, false, false, false, false]);
    assert.equal(empresaSuspendida({ estado: "suspendida" }), true);
    assert.equal(empresaSuspendida({ estado: "activa" }), false);
    assert.equal(empresaSuspendida(null), false);
  });
});
