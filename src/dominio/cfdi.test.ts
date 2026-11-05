import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { leerCfdi } from "./cfdi";
import { fechaEnMexico, fechaValida, sumarDias, validarFechasPago } from "./pagos-proveedores";

const UUID = "123e4567-e89b-42d3-a456-426614174000";

export function cfdiDePrueba(cambios: { emisor?: string; receptor?: string; total?: string; moneda?: string } = {}): Uint8Array {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital"
    Version="4.0" Fecha="2026-11-01T10:20:30" TipoDeComprobante="I" Moneda="${cambios.moneda ?? "MXN"}" Total="${cambios.total ?? "1234.56"}" Serie="A" Folio="81">
    <cfdi:Emisor Rfc="${cambios.emisor ?? "AAA010101AAA"}" Nombre="Proveedor Uno" RegimenFiscal="601" />
    <cfdi:Receptor Rfc="${cambios.receptor ?? "EKU9003173C9"}" Nombre="Escuela Kemper" DomicilioFiscalReceptor="06600" RegimenFiscalReceptor="601" UsoCFDI="G03" />
    <cfdi:Complemento><tfd:TimbreFiscalDigital UUID="${UUID}" /></cfdi:Complemento>
  </cfdi:Comprobante>`;
  return new TextEncoder().encode(xml);
}

describe("lectura segura del CFDI", () => {
  it("lee timbre, partes, referencia, fecha y centavos sin consultar ni inventar vigencia SAT", () => {
    const resultado = leerCfdi(cfdiDePrueba());
    assert.equal(resultado.ok, true);
    if (!resultado.ok) return;
    assert.equal(resultado.cfdi.uuid, UUID.toUpperCase());
    assert.equal(resultado.cfdi.rfcEmisor, "AAA010101AAA");
    assert.equal(resultado.cfdi.rfcReceptor, "EKU9003173C9");
    assert.equal(resultado.cfdi.totalCentavos, 123456);
    assert.equal(resultado.cfdi.referencia, "A-81");
    assert.equal(resultado.cfdi.emitidaEl, "2026-11-01");
  });

  it("rechaza entidades, XML roto, moneda distinta y datos incompletos", () => {
    const xxe = new TextEncoder().encode(`<!DOCTYPE cfdi:Comprobante [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" />`);
    assert.equal(leerCfdi(xxe).ok, false);
    assert.equal(leerCfdi(new TextEncoder().encode("<Comprobante>")).ok, false);
    assert.equal(leerCfdi(cfdiDePrueba({ moneda: "USD" })).ok, false);
    assert.equal(leerCfdi(cfdiDePrueba({ total: "0.001" })).ok, false);
  });

  it("rechaza un CFDI válido que trae marcado ejecutable en la addenda", () => {
    const conAddenda = (addenda: string, prologo = "") => new TextEncoder().encode(
      new TextDecoder().decode(cfdiDePrueba()).replace("<?xml version=\"1.0\" encoding=\"UTF-8\"?>", `<?xml version="1.0" encoding="UTF-8"?>${prologo}`)
        .replace("</cfdi:Comprobante>", `<cfdi:Addenda>${addenda}</cfdi:Addenda></cfdi:Comprobante>`),
    );
    const casos = [
      `<h:script xmlns:h="http://www.w3.org/1999/xhtml">alert(document.domain)</h:script>`,
      `<x:div xmlns:x="http://www.w3.org/1999/xhtml"><x:img src="x" onerror="alert(1)"/></x:div>`,
      `<x:div xmlns:x="http://www.w3.org/1999/&#120;html"><x:a href="#">texto</x:a></x:div>`,
      `<div xmlns="http&#x3a;//www.w3.org/1999/xhtml">texto</div>`,
      `<s:svg xmlns:s="http://www.w3.org/2000/svg"><s:circle r="1"/></s:svg>`,
      `<m:math xmlns:m="http://www.w3.org/1998/Math/MathML"><m:mi>x</m:mi></m:math>`,
      `<script>alert(1)</script>`,
      `<a:SCRIPT xmlns:a="urn:proveedor">x</a:SCRIPT>`,
    ];
    for (const addenda of casos) {
      assert.deepEqual(leerCfdi(conAddenda(addenda)), { ok: false, codigo: "cfdi_contenido_no_permitido" }, addenda);
    }
    assert.deepEqual(
      leerCfdi(conAddenda("", `<?xml-stylesheet type="text/xsl" href="https://ataque.example/x.xsl"?>`)),
      { ok: false, codigo: "cfdi_contenido_no_permitido" },
    );
    const addendaComercial = leerCfdi(conAddenda(`<p:Pedido xmlns:p="http://www.proveedor.com.mx/addenda" Numero="4500"/>`));
    assert.equal(addendaComercial.ok, true, "una addenda comercial sin marcado activo se acepta");
  });
});

describe("fechas de la obligación", () => {
  it("calcula días sin depender de la zona del servidor y rechaza calendario imposible", () => {
    assert.equal(sumarDias("2026-11-30", 30), "2026-12-30");
    assert.equal(fechaValida("2026-02-29"), false);
    assert.equal(fechaEnMexico(new Date("2026-11-05T05:30:00.000Z")), "2026-11-04");
  });

  it("no permite programar en pasado ni vencer antes de emitir", () => {
    assert.equal(validarFechasPago({ emitidaEl: "2026-11-01", venceEl: "2026-10-30", programadaEl: "2026-11-06", hoy: "2026-11-05" }), "fecha_invalida");
    assert.equal(validarFechasPago({ emitidaEl: "2026-11-01", venceEl: "2026-11-30", programadaEl: "2026-11-04", hoy: "2026-11-05" }), "fecha_pasada");
  });
});
