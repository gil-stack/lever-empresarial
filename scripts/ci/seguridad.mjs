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

/**
 * Envoltorios que reciben el SQL como texto y lo ejecutan. Sus llamadas se
 * revisan igual que `.query(...)`, en el argumento que lleva el SQL, y dentro
 * del envoltorio mismo no se marca «SQL recibido como parámetro» para ese
 * parámetro (es su trabajo recibirlo). Cada uno va por nombre y archivo:
 *
 * - aplicarSentencia (src/nucleo/db.ts): la entrega única del SQL al driver;
 *   se llama desde todo el servidor con el SQL en el segundo argumento.
 * - consultar y consultarDefinidor (src/server/autenticacion/repositorio.ts):
 *   abren la transacción con su rol y pasan el SQL a aplicarSentencia, con el
 *   SQL en el primer argumento. Hoy solo se llaman en ese archivo; si se
 *   importan en otro, sus llamadas se revisan igual (por el import).
 * - query de comoConsulta (src/nucleo/db.ts): adapta el cliente de pg a
 *   Consulta; sus llamadores ya se revisan como `.query(...)`.
 */
export const ENVOLTORIOS_SQL = [
  { nombre: "aplicarSentencia", archivo: "src/nucleo/db.ts", argumento: 1, parametro: "sentencia", global: true },
  { nombre: "consultar", archivo: "src/server/autenticacion/repositorio.ts", argumento: 0, parametro: "sentencia", global: false },
  { nombre: "consultarDefinidor", archivo: "src/server/autenticacion/repositorio.ts", argumento: 0, parametro: "sentencia", global: false },
  // El adaptador del cliente de pg a Consulta (comoConsulta): su `query` es la del driver.
  { nombre: "query", archivo: "src/nucleo/db.ts", argumento: 0, parametro: "sql", global: false },
];

/**
 * Alcance (decisión del líder, 2026-11-12): esta regla es una defensa contra
 * errores accidentales de inyección (un valor que se cuela en el texto del SQL
 * al escribir el servidor), no contra código malicioso escrito a propósito por
 * el equipo. Por eso es estática y conservadora: lo que no puede comprobar lo
 * marca, pero no intenta seguir todo lo que un autor decidido podría hacer.
 */

/** Las rutas del repo a las que puede apuntar un import (`./x`, `../x` o `@/x`). */
function rutasDeModulo(desde, especificador) {
  let base;
  if (especificador.startsWith("./") || especificador.startsWith("../")) base = path.posix.join(path.posix.dirname(desde), especificador);
  else if (especificador.startsWith("@/")) base = `src/${especificador.slice(2)}`;
  else return [];
  return [`${base}.ts`, `${base}/index.ts`, base];
}

/** El import de un nombre en el archivo: `{ original as nombre }` o `* as nombre`. */
function importDe(archivo, nombre) {
  for (const sentencia of archivo.statements) {
    if (!ts.isImportDeclaration(sentencia) || !ts.isStringLiteral(sentencia.moduleSpecifier)) continue;
    const enlaces = sentencia.importClause?.namedBindings;
    if (!enlaces) continue;
    const modulo = sentencia.moduleSpecifier.text;
    if (ts.isNamespaceImport(enlaces) && enlaces.name.text === nombre) return { modulo, original: null };
    if (ts.isNamedImports(enlaces)) {
      const e = enlaces.elements.find((x) => x.name.text === nombre);
      if (e) return { modulo, original: (e.propertyName ?? e.name).text };
    }
  }
  return null;
}

/**
 * El envoltorio al que apunta una expresión: un identificador (por su import,
 * con o sin alias, o por nombre en el archivo del envoltorio o si es global) o
 * `espacio.nombre` de un `import * as espacio` de su módulo.
 */
function envoltorioDe(ruta, archivo, expresion) {
  if (ts.isIdentifier(expresion)) {
    const imp = importDe(archivo, expresion.text);
    if (imp) {
      if (imp.original === null) return null;
      const rutas = rutasDeModulo(ruta, imp.modulo);
      return ENVOLTORIOS_SQL.find((e) => e.nombre === imp.original && rutas.includes(e.archivo)) ?? null;
    }
    return ENVOLTORIOS_SQL.find((e) => e.nombre === expresion.text && (e.global || e.archivo === ruta)) ?? null;
  }
  if (ts.isPropertyAccessExpression(expresion) && ts.isIdentifier(expresion.expression)) {
    const imp = importDe(archivo, expresion.expression.text);
    if (!imp || imp.original !== null) return null;
    const rutas = rutasDeModulo(ruta, imp.modulo);
    return ENVOLTORIOS_SQL.find((e) => e.nombre === expresion.name.text && rutas.includes(e.archivo)) ?? null;
  }
  return null;
}

/** ¿Este identificador es un uso como valor (no un nombre de import, de propiedad, de declaración o de tipo)? */
function esUsoComoValor(nodo) {
  const padre = nodo.parent;
  if (!padre) return false;
  if (ts.isImportSpecifier(padre) || ts.isExportSpecifier(padre) || ts.isNamespaceImport(padre) || ts.isImportClause(padre)) return false;
  if (ts.isPropertyAccessExpression(padre) && padre.name === nodo) return false;
  if ((ts.isPropertyAssignment(padre) || ts.isMethodDeclaration(padre) || ts.isPropertyDeclaration(padre)) && padre.name === nodo) return false;
  if ((ts.isVariableDeclaration(padre) || ts.isFunctionDeclaration(padre) || ts.isParameter(padre) || ts.isBindingElement(padre)) && padre.name === nodo) return false;
  let actual = padre;
  while (actual) {
    if (ts.isTypeNode(actual)) return false;
    actual = actual.parent;
  }
  return true;
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
      const envoltorio = envoltorioDe(ruta, archivo, llamado);
      if (envoltorio) {
        const argumento = nodo.arguments[envoltorio.argumento];
        if (argumento) revisarArgumentoSql(archivo, argumento, hallazgos);
        else hallazgos.push(`${ubicar(archivo, nodo)} ${envoltorio.nombre} sin SQL`);
      }
    }

    // Fuera de su archivo, un envoltorio solo se usa llamándolo directo: guardarlo en otra variable,
    // pasarlo como valor o `.call`/`.apply` lo dejaría ejecutar SQL sin que la regla lo vea.
    if ((ts.isIdentifier(nodo) && esUsoComoValor(nodo)) || (ts.isPropertyAccessExpression(nodo) && ts.isIdentifier(nodo.expression))) {
      const envoltorio = envoltorioDe(ruta, archivo, nodo);
      const llamadoDirecto = ts.isCallExpression(nodo.parent) && nodo.parent.expression === nodo;
      if (envoltorio && envoltorio.archivo !== ruta && !llamadoDirecto) {
        hallazgos.push(`${ubicar(archivo, nodo)} ${envoltorio.nombre} sin llamada directa (el SQL no se puede revisar)`);
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

function sinEnvoltura(nodo) {
  let actual = nodo;
  while (
    ts.isParenthesizedExpression(actual) ||
    ts.isAsExpression(actual) ||
    (ts.isSatisfiesExpression && ts.isSatisfiesExpression(actual)) ||
    ts.isTypeAssertionExpression(actual)
  ) {
    actual = actual.expression;
  }
  return actual;
}

function revisarArgumentoSql(archivo, nodoOriginal, hallazgos, vistos = new Set()) {
  const nodo = sinEnvoltura(nodoOriginal);
  if (ts.isStringLiteral(nodo) || ts.isNoSubstitutionTemplateLiteral(nodo)) return;
  if (ts.isPropertyAccessExpression(nodo) || ts.isIdentifier(nodo)) {
    const inicial = inicializadorDe(nodo);
    if (inicial && vistos.has(inicial)) {
      hallazgos.push(`${ubicar(archivo, nodo)} SQL de origen no comprobable (constantes circulares)`);
      return;
    }
    if (inicial) {
      vistos.add(inicial);
      revisarArgumentoSql(archivo, inicial, hallazgos, vistos);
      return;
    }
    if (ts.isIdentifier(nodo) && esParametroSql(nodo)) {
      if (!esParametroDeEnvoltorio(archivo, nodo)) hallazgos.push(`${ubicar(archivo, nodo)} SQL recibido como parámetro`);
      return;
    }
    // Ni constante del archivo, ni importada de un módulo del repo, ni parámetro: no se puede comprobar.
    hallazgos.push(`${ubicar(archivo, nodo)} SQL de origen no comprobable`);
    return;
  }
  if (ts.isTemplateExpression(nodo)) {
    for (const tramo of nodo.templateSpans) {
      if (interpolacionDePlaceholders(tramo.expression)) continue;
      // Decisión del líder (2026-11-12): se puede interpolar una constante cuyo
      // inicializador sea a su vez SQL verificable (fragmentos compartidos).
      if (constanteSqlVerificable(tramo.expression, new Set())) continue;
      hallazgos.push(
        `${ubicar(archivo, tramo.expression)} SQL con un valor interpolado que no es un placeholder $n ni una constante verificable`,
      );
    }
    return;
  }
  if (ts.isBinaryExpression(nodo) && nodo.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    hallazgos.push(`${ubicar(archivo, nodo)} SQL armado con concatenación`);
    return;
  }
  hallazgos.push(`${ubicar(archivo, nodo)} SQL de origen no comprobable`);
}

/**
 * Una constante (`const`) cuyo inicializador es SQL verificable, revisada de
 * forma recursiva: un literal, o una plantilla cuyas interpolaciones son a su
 * vez constantes verificables. Sin llamadas, sin parámetros, sin
 * concatenación y sin ciclos. Vale `NOMBRE` y `OBJETO.propiedad` de un objeto
 * literal `const`.
 */
function constanteSqlVerificable(expresion, visitados) {
  const nodo = sinEnvoltura(expresion);
  const inicial = inicializadorConstante(nodo);
  if (!inicial || visitados.has(inicial)) return false;
  visitados.add(inicial);
  return sqlVerificable(inicial, visitados);
}

function sqlVerificable(expresion, visitados) {
  const nodo = sinEnvoltura(expresion);
  if (ts.isStringLiteral(nodo) || ts.isNoSubstitutionTemplateLiteral(nodo) || ts.isNumericLiteral(nodo)) return true;
  if (ts.isTemplateExpression(nodo)) {
    return nodo.templateSpans.every((tramo) => constanteSqlVerificable(tramo.expression, visitados));
  }
  if (ts.isIdentifier(nodo) || ts.isPropertyAccessExpression(nodo)) return constanteSqlVerificable(nodo, visitados);
  return false;
}

/**
 * Un objeto `const` cuyas propiedades no cambian: `{ … } as const` (TypeScript
 * no deja asignarlas), o uno cuyo nombre en su archivo solo aparece leyendo una
 * propiedad (`OBJ.x`), sin asignarla, borrarla ni pasar el objeto entero.
 */
function objetoSinMutar(declaracion) {
  const inicial = declaracion.initializer;
  if (inicial && ts.isAsExpression(inicial) && ts.isTypeReferenceNode(inicial.type) && ts.isIdentifier(inicial.type.typeName) && inicial.type.typeName.text === "const") {
    return true;
  }
  if (!ts.isIdentifier(declaracion.name)) return false;
  const nombre = declaracion.name.text;
  let limpio = true;
  function visitar(nodo) {
    if (!limpio) return;
    if (ts.isIdentifier(nodo) && nodo.text === nombre && nodo !== declaracion.name && esUsoComoValor(nodo) && declaracionEnScope(nombre, nodo) === declaracion) {
      const acceso = nodo.parent;
      if (!ts.isPropertyAccessExpression(acceso) || acceso.expression !== nodo || seEscribe(acceso)) limpio = false;
    }
    ts.forEachChild(nodo, visitar);
  }
  visitar(declaracion.getSourceFile());
  return limpio;
}

/** ¿Se asigna, se incrementa o se borra esta expresión? */
function seEscribe(expresion) {
  const padre = expresion.parent;
  if (!padre) return false;
  if (ts.isBinaryExpression(padre) && padre.left === expresion && padre.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && padre.operatorToken.kind <= ts.SyntaxKind.LastAssignment) return true;
  if ((ts.isPrefixUnaryExpression(padre) || ts.isPostfixUnaryExpression(padre)) && (padre.operator === ts.SyntaxKind.PlusPlusToken || padre.operator === ts.SyntaxKind.MinusMinusToken)) return true;
  if (ts.isDeleteExpression(padre)) return true;
  return false;
}

function esConstante(declaracion) {
  return ts.isVariableDeclaration(declaracion) && (ts.getCombinedNodeFlags(declaracion) & ts.NodeFlags.Const) !== 0;
}

function inicializadorConstante(nodo) {
  if (ts.isIdentifier(nodo)) {
    const declaracion = declaracionEnScope(nodo.text, nodo);
    if (!declaracion || !esConstante(declaracion) || !declaracion.initializer) return null;
    return declaracion.initializer;
  }
  if (!ts.isPropertyAccessExpression(nodo) || !ts.isIdentifier(nodo.expression) || !ts.isIdentifier(nodo.name)) return null;
  const objeto = declaracionEnScope(nodo.expression.text, nodo);
  if (!objeto || !esConstante(objeto) || !objeto.initializer || !objetoSinMutar(objeto)) return null;
  const literal = sinEnvoltura(objeto.initializer);
  if (!ts.isObjectLiteralExpression(literal)) return null;
  for (const propiedad of literal.properties) {
    if (!ts.isPropertyAssignment(propiedad) || !ts.isIdentifier(propiedad.name)) continue;
    if (propiedad.name.text === nodo.name.text) return propiedad.initializer;
  }
  return null;
}

/** El parámetro que lleva el SQL dentro de un envoltorio registrado (ENVOLTORIOS_SQL), por nombre y archivo. */
function esParametroDeEnvoltorio(archivo, nodo) {
  let actual = nodo.parent;
  while (actual) {
    if (ts.isFunctionLike(actual) && actual.parameters.some((p) => ts.isIdentifier(p.name) && p.name.text === nodo.text)) {
      const nombre = nombreDeFuncion(actual);
      return ENVOLTORIOS_SQL.some((e) => e.nombre === nombre && e.archivo === archivo.fileName && e.parametro === nodo.text);
    }
    actual = actual.parent;
  }
  return false;
}

function nombreDeFuncion(funcion) {
  if (ts.isFunctionDeclaration(funcion) && funcion.name) return funcion.name.text;
  const padre = funcion.parent;
  if (padre && (ts.isVariableDeclaration(padre) || ts.isPropertyAssignment(padre)) && ts.isIdentifier(padre.name)) return padre.name.text;
  if (ts.isMethodDeclaration(funcion) && ts.isIdentifier(funcion.name)) return funcion.name.text;
  return null;
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
    // Solo `const`: una variable que se puede reasignar no dice qué SQL lleva al ejecutarse.
    if (declaracion && esConstante(declaracion) && declaracion.initializer) {
      return declaracion.initializer;
    }
    return null;
  }
  if (!ts.isPropertyAccessExpression(nodo) || !ts.isIdentifier(nodo.expression) || !ts.isIdentifier(nodo.name)) {
    return null;
  }
  const objeto = declaracionEnScope(nodo.expression.text, nodo);
  // `{ ... } as const` también es un objeto literal: antes se saltaba la revisión de sus sentencias.
  const literal = objeto && esConstante(objeto) && objeto.initializer && objetoSinMutar(objeto) ? sinEnvoltura(objeto.initializer) : null;
  if (!literal || !ts.isObjectLiteralExpression(literal)) {
    return null;
  }
  for (const propiedad of literal.properties) {
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

  // El arreglo nace vacío (`const x = []`) y en todo su ámbito solo se usa con
  // `x.push(<plantillas de números>)`, `x.join("…")` y `x.length`. Cualquier otra
  // cosa (nacer con valores, unshift, splice, asignar por índice, pasarlo entero) no se comprueba.
  const nombre = llamado.expression.text;
  const declaracion = declaracionEnScope(nombre, llamado.expression);
  if (!declaracion || !esConstante(declaracion) || !declaracion.initializer) return false;
  const inicial = sinEnvoltura(declaracion.initializer);
  if (!ts.isArrayLiteralExpression(inicial) || inicial.elements.length > 0) return false;
  let pushes = 0;
  let limpio = true;
  function visitar(nodo) {
    if (!limpio) return;
    if (ts.isIdentifier(nodo) && nodo.text === nombre && nodo !== declaracion.name && esUsoComoValor(nodo) && declaracionEnScope(nombre, nodo) === declaracion) {
      const acceso = nodo.parent;
      const llamada = acceso?.parent;
      const directo = ts.isPropertyAccessExpression(acceso) && acceso.expression === nodo && ts.isCallExpression(llamada) && llamada.expression === acceso;
      if (directo && acceso.name.text === "push" && llamada.arguments.length > 0 && llamada.arguments.every(plantillaSoloNumeros)) pushes += 1;
      else if (directo && acceso.name.text === "join") {
        // join solo lee
      } else if (ts.isPropertyAccessExpression(acceso) && acceso.expression === nodo && acceso.name.text === "length" && !seEscribe(acceso)) {
        // length solo lee
      } else limpio = false;
    }
    ts.forEachChild(nodo, visitar);
  }
  visitar(ambitoDe(declaracion));
  return limpio && pushes > 0;
}

/** El bloque (o el archivo) donde vive una declaración: su ámbito léxico. */
function ambitoDe(declaracion) {
  let actual = declaracion.parent;
  while (actual && !ts.isBlock(actual) && !ts.isSourceFile(actual) && !ts.isModuleBlock(actual) && !ts.isCaseClause(actual) && !ts.isDefaultClause(actual)
    && !ts.isForStatement(actual) && !ts.isForOfStatement(actual) && !ts.isForInStatement(actual)) {
    actual = actual.parent;
  }
  return actual ?? declaracion.getSourceFile();
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

/**
 * La declaración que ve un uso, por ámbito léxico: sube por bloques, `for`,
 * `catch`, funciones (sus parámetros) y el archivo (sus imports del repo), y en
 * cada uno toma solo lo declarado directamente ahí. Así una `const` homónima en
 * otro bloque, o la variable de un `for…of`, no se confunden.
 */
function declaracionEnScope(nombre, desde) {
  let actual = desde;
  while (actual) {
    if (ts.isFunctionLike(actual)) {
      for (const [posicion, parametro] of actual.parameters.entries()) {
        if (ts.isIdentifier(parametro.name) && parametro.name.text === nombre) {
          if (esParametroIndice(actual, posicion)) return { tipo: "indice" };
          if (parametro.initializer && esNumero(parametro.initializer)) return { tipo: "indice" };
          return null;
        }
      }
    }
    const local = declaracionDelAmbito(actual, nombre);
    if (local) return local;
    if (ts.isSourceFile(actual)) return buscarImportado(actual, nombre);
    actual = actual.parent;
  }
  return null;
}

function declaracionDelAmbito(nodo, nombre) {
  const deLista = (lista) => lista.declarations.find((d) => ts.isIdentifier(d.name) && d.name.text === nombre) ?? null;
  if (ts.isBlock(nodo) || ts.isSourceFile(nodo) || ts.isModuleBlock(nodo) || ts.isCaseClause(nodo) || ts.isDefaultClause(nodo)) {
    for (const sentencia of nodo.statements) {
      if (!ts.isVariableStatement(sentencia)) continue;
      const declaracion = deLista(sentencia.declarationList);
      if (declaracion) return declaracion;
    }
    return null;
  }
  if ((ts.isForStatement(nodo) || ts.isForOfStatement(nodo) || ts.isForInStatement(nodo)) && nodo.initializer && ts.isVariableDeclarationList(nodo.initializer)) {
    return deLista(nodo.initializer);
  }
  if (ts.isCatchClause(nodo) && nodo.variableDeclaration && ts.isIdentifier(nodo.variableDeclaration.name) && nodo.variableDeclaration.name.text === nombre) {
    return nodo.variableDeclaration;
  }
  return null;
}

/**
 * Una constante importada de un módulo del repo (`./x`, `../x` o `@/x`): se
 * busca su `export const` en ese archivo para revisarla ahí. Un import de un
 * paquete, o un archivo que no se puede leer, no se resuelve (no comprobable).
 */
const MODULOS = new Map();
let leerModulo = (relativa) => {
  const absoluta = path.join(RAIZ, relativa);
  return existsSync(absoluta) ? readFileSync(absoluta, "utf8") : null;
};

/** Para las pruebas: de dónde lee la regla los módulos importados. */
export function leerModulosDesde(lector) {
  leerModulo = lector;
  MODULOS.clear();
}

function buscarImportado(archivo, nombre) {
  for (const sentencia of archivo.statements) {
    if (!ts.isImportDeclaration(sentencia) || !ts.isStringLiteral(sentencia.moduleSpecifier)) continue;
    const enlaces = sentencia.importClause?.namedBindings;
    if (!enlaces || !ts.isNamedImports(enlaces)) continue;
    const especificador = enlaces.elements.find((e) => e.name.text === nombre);
    if (!especificador) continue;
    const modulo = moduloDelRepo(archivo.fileName, sentencia.moduleSpecifier.text);
    if (!modulo) return null;
    const original = (especificador.propertyName ?? especificador.name).text;
    for (const s of modulo.statements) {
      if (!ts.isVariableStatement(s) || !s.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
      const declaracion = s.declarationList.declarations.find((d) => ts.isIdentifier(d.name) && d.name.text === original);
      if (declaracion) return declaracion;
    }
    return null;
  }
  return null;
}

function moduloDelRepo(desde, especificador) {
  for (const relativa of rutasDeModulo(desde, especificador)) {
    if (MODULOS.has(relativa)) return MODULOS.get(relativa);
    const texto = leerModulo(relativa);
    if (texto === null) continue;
    const fuente = ts.createSourceFile(relativa, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    MODULOS.set(relativa, fuente);
    return fuente;
  }
  return null;
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

function ubicar(_archivo, nodo) {
  // El nodo puede venir de otro módulo (una constante importada): se ubica en el suyo.
  const fuente = nodo.getSourceFile();
  const { line } = fuente.getLineAndCharacterOfPosition(nodo.getStart(fuente));
  return `${fuente.fileName}:${line + 1}`;
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

export function esServidor(ruta, texto = "") {
  if (ruta.endsWith(".test.ts") || ruta.endsWith(".test.tsx")) return false;
  if (ruta.startsWith("src/server/") && ruta.endsWith(".ts")) return true;
  // El núcleo lleva aplicarSentencia, la entrega del SQL al driver: también se revisa.
  if (ruta.startsWith("src/nucleo/") && ruta.endsWith(".ts")) return true;
  if (ruta.startsWith("src/app/") && ruta.endsWith("/route.ts")) return true;
  // Las acciones del servidor: `acciones.ts`, `acciones-<algo>.ts` (por ejemplo acciones-efevoo.ts) y todo
  // archivo de src/app que empiece con "use server".
  if (ruta.startsWith("src/app/") && /\/acciones(-[^/]+)?\.ts$/.test(ruta)) return true;
  if (ruta.startsWith("src/app/") && /\.tsx?$/.test(ruta) && /^\s*(\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*['"]use server['"]/.test(texto)) return true;
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
    if (esServidor(ruta, texto)) {
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
