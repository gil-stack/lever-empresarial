import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { leerCfdi } from "./cfdi";
import { fechaEnMexico, fechaValida, montoEscrito, sumarDias, validarFechasPago } from "./pagos-proveedores";

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

// Barrido servidor contra base (701bc25): lo que lee el CFDI cabe en los CHECK de la base.
describe("el CFDI leído cabe en la base", () => {
  const conCambio = (de: string | RegExp, a: string) => new TextEncoder().encode(new TextDecoder().decode(cfdiDePrueba()).replace(de, a));
  const incompleto = { ok: false, codigo: "cfdi_datos_incompletos" };

  it("bar-7: un total de más de 9e15 centavos no se lee", () => {
    assert.deepEqual(leerCfdi(cfdiDePrueba({ total: "90000000000000.01" })), incompleto);
    const tope = leerCfdi(cfdiDePrueba({ total: "90000000000000.00" }));
    assert.equal(tope.ok && tope.cfdi.totalCentavos, 9_000_000_000_000_000);
  });

  it("bar-8: el RFC receptor tiene la forma del RFC y la serie y el folio no traen caracteres de control", () => {
    assert.deepEqual(leerCfdi(cfdiDePrueba({ receptor: "eku900317-3c9" })), incompleto);
    assert.deepEqual(leerCfdi(conCambio('Serie="A"', 'Serie="A&#x9;B"')), incompleto);
    assert.deepEqual(leerCfdi(conCambio('Folio="81"', 'Folio="8&#x85;1"')), incompleto);
  });

  // serv-nuevo-3: XML 1.0 §3.3.3: el tabulador y los saltos de línea literales de un atributo valen un espacio
  // (un PAC puede partir un atributo largo). Las referencias no se normalizan: después de decodificar, en el
  // nombre (texto libre) el control se quita (serv-nuevo-1) y en la serie o el folio se rechaza (bar-8).
  it("serv-nuevo-3: los saltos literales valen un espacio y el nombre quita el control de una referencia", () => {
    const partido = leerCfdi(conCambio('Nombre="Escuela Kemper"', 'Nombre="Escuela\n\tKemper"'));
    assert.equal(partido.ok && partido.cfdi.nombreReceptor, "Escuela Kemper");
    const serie = leerCfdi(conCambio('Serie="A"', 'Serie="A\tB"'));
    assert.equal(serie.ok && serie.cfdi.serie, "A B");
    const control = leerCfdi(conCambio('Nombre="Escuela Kemper"', 'Nombre="Escuela&#x85; Kemper&#xA;SA"'));
    assert.equal(control.ok && control.cfdi.nombreReceptor, "Escuela Kemper SA");
  });

  it("bar-9: decodifica las cinco entidades y las referencias numéricas en una pasada, sin expandir un DOCTYPE", () => {
    const amp = leerCfdi(conCambio('Nombre="Escuela Kemper"', 'Nombre="PEREZ &amp; ASOCIADOS &lt;MX&gt; &quot;A&quot; &apos;B&apos; &#209;&#xD1;"'));
    assert.equal(amp.ok && amp.cfdi.nombreReceptor, "PEREZ & ASOCIADOS <MX> \"A\" 'B' ÑÑ");
    const literal = leerCfdi(conCambio('Nombre="Escuela Kemper"', 'Nombre="A &amp;amp; B"'));
    assert.equal(literal.ok && literal.cfdi.nombreReceptor, "A &amp; B");
    const rfc = leerCfdi(cfdiDePrueba({ receptor: "A&amp;C010101AB1" }));
    assert.equal(rfc.ok && rfc.cfdi.rfcReceptor, "A&C010101AB1");
    const risas = new TextEncoder().encode(new TextDecoder().decode(cfdiDePrueba()).replace(
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE cfdi:Comprobante [<!ENTITY a "jaja"><!ENTITY b "&a;&a;&a;&a;">]>',
    ).replace('Nombre="Escuela Kemper"', 'Nombre="&b;"'));
    assert.deepEqual(leerCfdi(risas), { ok: false, codigo: "cfdi_invalido" });
  });
});

describe("bar-7: el monto escrito de un pago cabe en la base", () => {
  it("hasta 9e15 centavos, como el CHECK `supplier_payables_total`", () => {
    assert.equal(montoEscrito("90000000000000.00"), 9_000_000_000_000_000);
    assert.equal(montoEscrito("90000000000000.01"), null);
  });
});

// serv-nuevo-2: una referencia que no es de las cinco predefinidas ni numérica (una entidad sin declarar) vuelve
// mal formado el XML; antes se guardaba literal («Cliente &x; Lab»).
describe("referencias de entidad en el CFDI", () => {
  const conNombre = (nombre: string) => new TextEncoder().encode(new TextDecoder().decode(cfdiDePrueba()).replace('Nombre="Escuela Kemper"', `Nombre="${nombre}"`));
  it("una entidad sin declarar o mal escrita es un XML inválido; las predefinidas y numéricas se leen", () => {
    for (const malo of ["Cliente &x; Lab", "Cliente &AMP; Lab", "Cliente &#X26; Lab"]) {
      assert.deepEqual(leerCfdi(conNombre(malo)), { ok: false, codigo: "cfdi_invalido" }, malo);
    }
    const bueno = leerCfdi(conNombre("Cliente &amp; Lab &#38; &#x26;"));
    assert.equal(bueno.ok && bueno.cfdi.nombreReceptor, "Cliente & Lab & &");
  });
});

describe("bar-10: las fechas del pago existen en el calendario", () => {
  it("el año 0 y un día que no existe no son fechas de pago", () => {
    assert.equal(fechaValida("0000-01-01"), false);
    assert.equal(fechaValida("2026-02-30"), false);
    assert.equal(fechaValida("2024-02-29"), true);
    // Cada fecha mala dice cuál es, para que el aviso marque su campo (antes todas eran «fecha_invalida» en el vencimiento).
    const fechas = { emitidaEl: "2026-11-01", venceEl: "2026-11-30", programadaEl: "2026-11-30", hoy: "2026-11-08" };
    assert.equal(validarFechasPago({ ...fechas, emitidaEl: "0000-01-01" }), "fecha_emision_invalida");
    assert.equal(validarFechasPago({ ...fechas, venceEl: "2026-02-30" }), "fecha_invalida");
    assert.equal(validarFechasPago({ ...fechas, venceEl: "2026-10-31" }), "fecha_invalida");
    assert.equal(validarFechasPago({ ...fechas, programadaEl: "2026-13-01" }), "fecha_programada_invalida");
    assert.equal(validarFechasPago({ ...fechas, programadaEl: "2026-11-07" }), "fecha_pasada");
    assert.equal(validarFechasPago(fechas), null);
  });
});
