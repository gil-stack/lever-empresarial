# Plataforma

Consola de control de gastos para una razón social mexicana.

## Desarrollo

```bash
npm install
npm run dev
```

`/salud` responde `ok` y no imprime configuración.

## Este corte

Fase 1, integrada: una persona entra, da de alta una razón social y ve la consola vacía. El teléfono existe, está vacío y no comparte el menú de la consola. Las funciones corren en `iad1` con runtime Node.js.

El maestro de personas vive en la consola: jefe, centro de costo, fecha de baja y CLABE con el dígito 3, 7 y 1. Hacen falta dos liberadores distintos para que la empresa esté operable. El contador no libera. No se dispersa dinero.

La cookie `sesion` y el alta viven en `src/server`. La puerta llama a `abrirCuenta` y a `darDeAltaEmpresa`. Una forma válida se guarda. Un segundo RFC en la misma cuenta no entra. La auditoría de ese alta se inserta en la misma transacción.

El servidor lee el connection string agrupado y no migra al arrancar. Las migraciones se aplican a mano:

```bash
export DATABASE_URL_UNPOOLED
./db/migrate.sh
```

`DATABASE_URL_UNPOOLED` es el string directo de la base `plataforma`. El valor no va en el repositorio. La rama de Neon para que preview no comparta el libro de production se crea con `./db/preview-branch.sh`. El detalle está en `db/README.md`.
