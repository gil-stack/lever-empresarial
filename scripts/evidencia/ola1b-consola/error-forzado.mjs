// «Error forzado» para la evidencia de Ola 1B (flujo 14). Ninguna lectura de la
// base llega a src/app/consola/error.tsx: cada página traduce sus errores y los
// pinta dentro del marco. Para ver ese límite de error en la aplicación real, este
// preload hace que dar formato a una cifra centinela lance mientras exista
// ERROR_FORZADO_ARCHIVO. El flujo declara un saldo con esa cifra, que solo se
// formatea al pintar Inicio, y borra el archivo para que «Reintentar» abra la página.
// Solo vive en scripts/evidencia y no cambia el código de la aplicación.
//
//   NODE_OPTIONS="--import=./scripts/evidencia/ola1b-consola/error-forzado.mjs" \
//   ERROR_FORZADO_ARCHIVO=/fuera/del/repo/error-forzado npx next start -p 4807
import { existsSync } from "node:fs";

const ARCHIVO = process.env.ERROR_FORZADO_ARCHIVO ?? "";
if (!ARCHIVO || ARCHIVO.includes("/docs/")) throw new Error("ERROR_FORZADO_ARCHIVO tiene que ser un archivo fuera del repositorio.");

/** Pesos enteros de la cifra centinela: $42,424,242.42 (formatoPesos formatea la parte entera). */
export const PESOS_CENTINELA = 42424242;

// `format` es un descriptor de acceso que devuelve la función ligada a cada formateador.
const descriptor = Object.getOwnPropertyDescriptor(Intl.NumberFormat.prototype, "format");
Object.defineProperty(Intl.NumberFormat.prototype, "format", {
  configurable: true,
  get() {
    const formatear = descriptor.get.call(this);
    return (valor) => {
      if (valor === PESOS_CENTINELA && existsSync(ARCHIVO)) throw new Error("error_forzado_de_evidencia");
      return formatear(valor);
    };
  },
});
