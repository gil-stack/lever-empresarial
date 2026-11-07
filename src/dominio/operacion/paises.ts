/**
 * Países ISO 3166-1 alfa-2. El socio extranjero sin CURP se identifica por su país
 * y el número de su pasaporte o identificación oficial: con un código cerrado, la
 * misma persona capturada por dos caminos suma una vez.
 */
export const PAISES: readonly string[] = (
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
  "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO " +
  "FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE " +
  "JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO " +
  "MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW " +
  "PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM " +
  "TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
).split(" ");

const NOMBRES = new Intl.DisplayNames(["es-MX"], { type: "region" });

export function nombreDePais(codigo: string): string {
  return NOMBRES.of(codigo) ?? codigo;
}

/** Los países de un socio extranjero, por nombre. México no: el mexicano se identifica con su CURP. */
export function paisesExtranjeros(): Array<{ codigo: string; nombre: string }> {
  return PAISES.filter((codigo) => codigo !== "MX")
    .map((codigo) => ({ codigo, nombre: nombreDePais(codigo) }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

export function paisExtranjeroValido(codigo: string): boolean {
  return codigo !== "MX" && PAISES.includes(codigo);
}

/** El número del pasaporte o de la identificación, sin espacios, guiones ni puntos y en mayúsculas. */
export function documentoExtranjeroNormalizado(texto: string): string | null {
  const limpio = texto.toUpperCase().replace(/[\s.\-/]/gu, "");
  return /^[A-Z0-9]{4,20}$/u.test(limpio) ? limpio : null;
}
