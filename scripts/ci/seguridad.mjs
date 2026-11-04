/**
 * Revisión de seguridad que corre como tarea de Vercel CI.
 *
 * Vercel CI no tiene un revisor de seguridad propio: las tareas son las de
 * turbo.json. Vercel Security Review es de Vercel Agent, un check aparte que
 * se enciende en el panel, no un task del CI. Esta tarea usa dos herramientas
 * abiertas: npm audit, y el compilador de TypeScript (ya dependencia del
 * repo) para leer las rutas de servidor.
 *
 * No imprime secretos. Un hallazgo sale como archivo, línea y regla.
 *
 * npm audit falla con una vulnerabilidad alta o crítica en producción, o
 * crítica en cualquier dependencia. Las moderadas del árbol de eslint no
 * bloquean: el único arreglo que ofrece npm es instalar eslint 4.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");

const OMITIR_DIR = new Set([
  "node_modules",
  ".next",
  ".git",
  "coverage",
  "out",
  "build",
  ".vercel",
]);

const NOMBRES_SECRETOS = [
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "BLOB_READ_WRITE_TOKEN",
  "RESEND_API_KEY",
];

const URL_CON_CLAVE = /postgres(?:ql)?:\/\/[A-Za-z0-9._%~-]+:[A-Za-z0-9._%~-]+@/g;
const TOKEN_BLOB = /vercel_blob_rw_[A-Za-z0-9_]+/g;
const TOKEN_RESEND = /\bre_[A-Za-z0-9]{20,}\b/g;

export function buscarSecretos(ruta, texto) {
  const hallazgos = [];
  const esPrueba = ruta.endsWith(".test.ts") || ruta.endsWith(".test.tsx");
  const lineas = texto.split("\n");

  lineas.forEach((linea, indice) => {
    const donde = `${ruta}:${indice + 1}`;
    if (!esPrueba && URL_CON_CLAVE.test(linea)) {
      hallazgos.push(`${donde} cadena de Postgres con contraseña`);
    }
    URL_CON_CLAVE.lastIndex = 0;

    if (TOKEN_BLOB.test(linea)) {
      hallazgos.push(`${donde} token de Blob`);
    }
    TOKEN_BLOB.lastIndex = 0;

    if (TOKEN_RESEND.test(linea)) {
      hallazgos.push(`${donde} token de Resend`);
    }
    TOKEN_RESEND.lastIndex = 0;

    for (const nombre of NOMBRES_SECRETOS) {
      const asignacion = new RegExp(
        `\\b${nombre}\\b\\s*[:=]\\s*['"\`][^'"\`\\n]{6,}['"\`]`,
      );
      if (asignacion.test(linea)) {
        hallazgos.push(`${donde} ${nombre} tiene un valor literal`);
      }
    }
  });

  return hallazgos;
}

export function revisarCliente(ruta, texto) {
  if (!esArchivoCliente(texto)) return [];
  const hallazgos = [];
  const lineas = texto.split("\n");
  lineas.forEach((linea, indice) => {
    const donde = `${ruta}:${indice + 1}`;
    for (const nombre of NOMBRES_SECRETOS) {
      if (new RegExp(`\\b${nombre}\\b`).test(linea)) {
        hallazgos.push(`${donde} un módulo de cliente menciona ${nombre}`);
      }
    }
    if (/\bfrom\s+['"]pg['"]/.test(linea) || /\bfrom\s+['"]@vercel\/blob['"]/.test(linea)) {
      hallazgos.push(`${donde} un módulo de cliente importa el driver o Blob`);
    }
    if (/\bfrom\s+['"][^'"]*\/server(?:\/|['"])/.test(linea) || /\bfrom\s+['"]@\/server/.test(linea)) {
      hallazgos.push(`${donde} un módulo de cliente importa src/server`);
    }
  });
  return hallazgos;
}

export function revisarSql(ruta, texto) {
  const archivo = ts.createSourceFile(ruta, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const hallazgos = [];

  function visitar(nodo) {
    if (ts.isImportDeclaration(nodo) && ts.isStringLiteral(nodo.moduleSpecifier)) {
      const modulo = nodo.moduleSpecifier.text;
      if (modulo === "child_process" || modulo === "node:child_process") {
        hallazgos.push(`${ubicar(archivo, nodo)} importa child_process`);
      }
    }

    if (ts.isCallExpression(nodo)) {
      const llamado = nodo.expression;
      if (ts.isIdentifier(llamado) && llamado.text === "eval") {
        hallazgos.push(`${ubicar(archivo, nodo)} llama a eval`);
      }
      if (
        ts.isIdentifier(llamado) &&
        llamado.text === "import" &&
        nodo.arguments[0] &&
        ts.isStringLiteral(nodo.arguments[0]) &&
        (nodo.arguments[0].text === "child_process" || nodo.arguments[0].text === "node:child_process")
      ) {
        hallazgos.push(`${ubicar(archivo, nodo)} importa child_process`);
      }
      if (ts.isPropertyAccessExpression(llamado) && llamado.name.text === "query") {
        const argumento = nodo.arguments[0];
        if (argumento) revisarArgumentoSql(archivo, argumento, hallazgos);
      }
    }

    if (
      ts.isNewExpression(nodo) &&
      ts.isIdentifier(nodo.expression) &&
      nodo.expression.text === "Function"
    ) {
      hallazgos.push(`${ubicar(archivo, nodo)} construye una función desde texto`);
    }

    ts.forEachChild(nodo, visitar);
  }

  visitar(archivo);
  return hallazgos;
}

function revisarArgumentoSql(archivo, nodo, hallazgos) {
  if (ts.isStringLiteral(nodo) || ts.isNoSubstitutionTemplateLiteral(nodo)) return;
  if (ts.isPropertyAccessExpression(nodo) || ts.isIdentifier(nodo)) {
    const inicial = inicializadorDe(nodo);
    if (inicial) {
      revisarArgumentoSql(archivo, inicial, hallazgos);
      return;
    }
    if (ts.isIdentifier(nodo) && esParametroSql(nodo)) {
      hallazgos.push(`${ubicar(archivo, nodo)} SQL recibido como parámetro`);
    }
    return;
  }
  if (ts.isTemplateExpression(nodo)) {
    for (const tramo of nodo.templateSpans) {
      if (!interpolacionDePlaceholders(tramo.expression)) {
        hallazgos.push(
          `${ubicar(archivo, tramo.expression)} SQL con un valor interpolado que no es un placeholder $n`,
        );
      }
    }
    return;
  }
  if (ts.isBinaryExpression(nodo) && nodo.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    hallazgos.push(`${ubicar(archivo, nodo)} SQL armado con concatenación`);
    return;
  }
  hallazgos.push(`${ubicar(archivo, nodo)} SQL de origen no comprobable`);
}

function esParametroSql(nodo) {
  let actual = nodo.parent;
  while (actual) {
    if (ts.isFunctionLike(actual)) {
      const coincide = actual.parameters.some(
        (parametro) => ts.isIdentifier(parametro.name) && parametro.name.text === nodo.text,
      );
      if (coincide) return true;
    }
    actual = actual.parent;
  }
  return false;
}

function inicializadorDe(nodo) {
  if (ts.isIdentifier(nodo)) {
    const declaracion = declaracionEnScope(nodo.text, nodo);
    if (declaracion && ts.isVariableDeclaration(declaracion) && declaracion.initializer) {
      return declaracion.initializer;
    }
    return null;
  }
  if (!ts.isPropertyAccessExpression(nodo) || !ts.isIdentifier(nodo.expression) || !ts.isIdentifier(nodo.name)) {
    return null;
  }
  const objeto = declaracionEnScope(nodo.expression.text, nodo);
  if (!objeto || !ts.isVariableDeclaration(objeto) || !objeto.initializer || !ts.isObjectLiteralExpression(objeto.initializer)) {
    return null;
  }
  for (const propiedad of objeto.initializer.properties) {
    if (!ts.isPropertyAssignment(propiedad) || !ts.isIdentifier(propiedad.name)) continue;
    if (propiedad.name.text === nodo.name.text) return propiedad.initializer;
  }
  return null;
}

function interpolacionDePlaceholders(expresion) {
  if (!ts.isCallExpression(expresion)) return false;
  const llamado = expresion.expression;
  if (!ts.isPropertyAccessExpression(llamado) || llamado.name.text !== "join") return false;
  if (!ts.isIdentifier(llamado.expression)) return false;
  const separador = expresion.arguments[0];
  if (!separador || !ts.isStringLiteral(separador)) return false;

  const nombre = llamado.expression.text;
  const pushes = pushesDelArreglo(nombre, expresion);
  if (pushes.length === 0) return false;
  return pushes.every((argumento) => plantillaSoloNumeros(argumento));
}

function pushesDelArreglo(nombre, desde) {
  const funcion = ancestroFuncion(desde);
  if (!funcion) return [];
  const argumentos = [];
  function visitar(nodo) {
    if (
      ts.isCallExpression(nodo) &&
      ts.isPropertyAccessExpression(nodo.expression) &&
      nodo.expression.name.text === "push" &&
      ts.isIdentifier(nodo.expression.expression) &&
      nodo.expression.expression.text === nombre &&
      nodo.arguments[0]
    ) {
      argumentos.push(nodo.arguments[0]);
    }
    ts.forEachChild(nodo, visitar);
  }
  visitar(funcion);
  return argumentos;
}

function plantillaSoloNumeros(nodo) {
  if (ts.isNoSubstitutionTemplateLiteral(nodo) || ts.isStringLiteral(nodo)) return true;
  if (!ts.isTemplateExpression(nodo)) return false;
  return nodo.templateSpans.every((tramo) => esNumero(tramo.expression));
}

function esNumero(nodo) {
  if (ts.isNumericLiteral(nodo) || ts.isParenthesizedExpression(nodo)) {
    return ts.isParenthesizedExpression(nodo) ? esNumero(nodo.expression) : true;
  }
  if (ts.isBinaryExpression(nodo)) {
    const operador = nodo.operatorToken.kind;
    if (operador !== ts.SyntaxKind.PlusToken && operador !== ts.SyntaxKind.AsteriskToken) return false;
    return esNumero(nodo.left) && esNumero(nodo.right);
  }
  if (!ts.isIdentifier(nodo)) return false;
  const declaracion = declaracionEnScope(nodo.text, nodo);
  if (!declaracion) return false;
  if (ts.isVariableDeclaration(declaracion)) {
    return declaracion.initializer ? esNumero(declaracion.initializer) : false;
  }
  return declaracion.tipo === "indice";
}

function declaracionEnScope(nombre, desde) {
  let actual = desde;
  while (actual) {
    if (ts.isFunctionLike(actual) || ts.isSourceFile(actual)) {
      if (ts.isFunctionLike(actual)) {
        for (const [posicion, parametro] of actual.parameters.entries()) {
          if (ts.isIdentifier(parametro.name) && parametro.name.text === nombre) {
            if (esParametroIndice(actual, posicion)) return { tipo: "indice" };
            if (parametro.initializer && esNumero(parametro.initializer)) return { tipo: "indice" };
            return null;
          }
        }
      }
      const variable = buscarVariable(actual, nombre);
      if (variable) return variable;
    }
    actual = actual.parent;
  }
  return null;
}

function buscarVariable(raiz, nombre) {
  let hallada = null;
  function visitar(nodo) {
    if (hallada) return;
    if (ts.isFunctionLike(nodo) && nodo !== raiz) return;
    if (ts.isVariableDeclaration(nodo) && ts.isIdentifier(nodo.name) && nodo.name.text === nombre) {
      hallada = nodo;
      return;
    }
    ts.forEachChild(nodo, visitar);
  }
  visitar(raiz);
  return hallada;
}

function esParametroIndice(funcion, posicion) {
  const padre = funcion.parent;
  if (!padre || !ts.isCallExpression(padre) || padre.arguments[0] !== funcion) return false;
  const llamado = padre.expression;
  if (!ts.isPropertyAccessExpression(llamado)) return false;
  const metodo = llamado.name.text;
  const indice = metodo === "reduce" || metodo === "reduceRight" ? 2 : 1;
  const conIndice = ["forEach", "map", "filter", "flatMap", "find", "findIndex", "reduce", "reduceRight"];
  return conIndice.includes(metodo) && posicion === indice;
}

function ancestroFuncion(nodo) {
  let actual = nodo;
  while (actual) {
    if (ts.isFunctionLike(actual)) return actual;
    actual = actual.parent;
  }
  return null;
}

function ubicar(archivo, nodo) {
  const { line } = archivo.getLineAndCharacterOfPosition(nodo.getStart(archivo));
  return `${archivo.fileName}:${line + 1}`;
}

function esArchivoCliente(texto) {
  return /(^|\n)\s*['"]use client['"]/.test(texto.slice(0, 400));
}

export function archivosDelRepo(raiz = RAIZ) {
  const archivos = [];
  function visitar(directorio, relativo) {
    for (const entrada of readdirSync(directorio)) {
      if (OMITIR_DIR.has(entrada)) continue;
      const absoluto = path.join(directorio, entrada);
      const ruta = relativo ? `${relativo}/${entrada}` : entrada;
      const info = statSync(absoluto);
      if (info.isDirectory()) visitar(absoluto, ruta);
      else if (esTexto(entrada)) archivos.push(ruta);
    }
  }
  visitar(raiz, "");
  return archivos;
}

function esTexto(nombre) {
  return /\.(ts|tsx|js|mjs|cjs|sql|json|sh|md|css|mjs)$/.test(nombre);
}

function esServidor(ruta) {
  if (ruta.endsWith(".test.ts") || ruta.endsWith(".test.tsx")) return false;
  if (ruta.startsWith("src/server/") && ruta.endsWith(".ts")) return true;
  if (ruta.startsWith("src/app/") && (ruta.endsWith("/route.ts") || ruta.endsWith("/acciones.ts"))) return true;
  return false;
}

export function revisarPaquete(directorio) {
  const hallazgos = [];
  if (!existsSync(directorio)) {
    return ["falta el paquete del navegador (.next/static); la tarea security depende de build"];
  }
  function visitar(dir) {
    for (const entrada of readdirSync(dir)) {
      const absoluto = path.join(dir, entrada);
      const info = statSync(absoluto);
      if (info.isDirectory()) {
        visitar(absoluto);
        continue;
      }
      if (info.size > 8_000_000) continue;
      const texto = readFileSync(absoluto);
      if (texto.includes(0)) continue;
      const relativo = path.relative(RAIZ, absoluto);
      const plano = texto.toString("utf8");
      for (const nombre of NOMBRES_SECRETOS) {
        if (new RegExp(`\\b${nombre}\\b`).test(plano)) {
          hallazgos.push(`${relativo} el paquete del navegador contiene ${nombre}`);
        }
      }
      if (URL_CON_CLAVE.test(plano)) hallazgos.push(`${relativo} el paquete del navegador contiene una cadena de Postgres`);
      URL_CON_CLAVE.lastIndex = 0;
      if (TOKEN_BLOB.test(plano)) hallazgos.push(`${relativo} el paquete del navegador contiene un token de Blob`);
      TOKEN_BLOB.lastIndex = 0;
      if (TOKEN_RESEND.test(plano)) hallazgos.push(`${relativo} el paquete del navegador contiene un token de Resend`);
      TOKEN_RESEND.lastIndex = 0;
    }
  }
  visitar(directorio);
  return hallazgos;
}

function auditar() {
  const produccion = spawnSync("npm", ["audit", "--omit=dev", "--audit-level=high"], {
    cwd: RAIZ,
    encoding: "utf8",
  });
  const critico = spawnSync("npm", ["audit", "--audit-level=critical"], {
    cwd: RAIZ,
    encoding: "utf8",
  });
  const fallos = [];
  if (produccion.status !== 0) {
    fallos.push("npm audit encontró vulnerabilidades altas o críticas en dependencias de producción.");
    fallos.push(recortar(produccion.stdout || produccion.stderr));
  }
  if (critico.status !== 0) {
    fallos.push("npm audit encontró vulnerabilidades críticas, incluidas las de desarrollo.");
    fallos.push(recortar(critico.stdout || critico.stderr));
  }
  return fallos;
}

function recortar(texto) {
  const lineas = (texto ?? "").split("\n").filter((linea) => linea.trim().length > 0);
  return lineas.slice(0, 40).join("\n");
}

function leer(ruta) {
  return readFileSync(path.join(RAIZ, ruta), "utf8");
}

export function main() {
  const hallazgos = [];

  for (const ruta of archivosDelRepo()) {
    const texto = leer(ruta);
    hallazgos.push(...buscarSecretos(ruta, texto));
    if (ruta.endsWith(".ts") || ruta.endsWith(".tsx")) {
      hallazgos.push(...revisarCliente(ruta, texto));
    }
    if (esServidor(ruta)) {
      hallazgos.push(...revisarSql(ruta, texto));
    }
  }

  const estatico = path.join(RAIZ, ".next/static");
  if (!existsSync(estatico)) {
    console.log("No está .next/static. Se construye el paquete para revisarlo.");
    const build = spawnSync("npx", ["next", "build"], { cwd: RAIZ, encoding: "utf8" });
    if (build.status !== 0) {
      hallazgos.push("next build falló y no hay paquete del navegador que revisar");
      if (build.stderr) console.error(recortar(build.stderr));
    }
  }
  hallazgos.push(...revisarPaquete(estatico));
  hallazgos.push(...auditar());

  if (hallazgos.length === 0) {
    console.log("Revisión de seguridad en verde: dependencias, secretos, paquete del navegador y rutas de servidor.");
    return 0;
  }
  console.error(`Revisión de seguridad: ${hallazgos.length} hallazgo(s).`);
  for (const hallazgo of hallazgos) console.error(hallazgo);
  return 1;
}

const ejecutadoDirecto = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (ejecutadoDirecto) {
  process.exit(main());
}
