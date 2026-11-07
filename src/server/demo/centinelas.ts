/**
 * Lo que delata un dato de ejemplo en una respuesta: los nombres de la empresa
 * del diseño, su gente, sus proveedores, comercios y vehículos, y cifras que
 * solo existen en la demostración. Lo usan las pruebas de servidor y el
 * recorrido para revisar el HTML y la carga RSC de una empresa real.
 */
export const NOMBRES_DE_EJEMPLO = [
  "Altamar", "ALO180312AB1", "Daniela Ruiz", "Carlos Méndez", "Ana Torres", "Jorge Salas", "Eduardo",
  "Pacific Packaging", "Shenzhen Hengtai", "Logística Ibérica", "Northern Fleet", "Servicios Integrales Delta",
  "Fiesta Inn", "Empaques y Tarimas", "Grupo Comercial Delta", "Mantenimiento Industrial Lerma", "Home Depot",
  "Office Depot", "Pemex", "Aeroméxico", "Costco", "Amazon", "Sanborns", "Lever Silver", "Grupo Norte",
  "Expo Monterrey", "NLA-48-21", "Nissan", "Renault", "Google Workspace", "CONTPAQi", "BUK", "Santander", "BBVA",
] as const;

export const CIFRAS_DE_EJEMPLO = [
  "1,284,560", "98,422", "320,878", "357,306", "1,080,000", "750,000", "13,381", "138,686", "230,345", "47,279",
  "18.42", "99.5%", "1,277", "713 L", "8.8 km/l", "1,709", "718 180",
] as const;
