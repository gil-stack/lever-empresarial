import { iniciarEfevooFalso } from "./servidor-falso";

/**
 * El Efevoo falso solo, para el laboratorio local:
 *   npx tsx tests/efevoo/levantar-falso.ts <puerto>
 * Imprime las variables EFEVOO_* para el next del laboratorio (credenciales que solo valen en el falso).
 */
void iniciarEfevooFalso(Number(process.argv[2] ?? "4897")).then((falso) => {
  console.log(`EFEVOO_URL=${falso.url} EFEVOO_API_USER=${falso.usuario} EFEVOO_API_KEY=${falso.llave} EFEVOO_AMBIENTE=sandbox`);
  const cerrar = () => void falso.cerrar().then(() => process.exit(0));
  process.on("SIGINT", cerrar);
  process.on("SIGTERM", cerrar);
});
