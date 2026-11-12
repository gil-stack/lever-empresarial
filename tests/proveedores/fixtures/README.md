# Versiones publicadas de 0022

Copias exactas de `db/migrations/0022_pagos_proveedores.sql`, usadas para probar upgrades con datos y marcas de migración existentes. No se regeneran a partir de HEAD ni requieren historia de Git en CI.

- `0022_original.sql`: commit `a39d647a2ac252c1725c741286bdc40f0ee9516d`.
- `0022_idempotencia.sql`: commit `dd01836e46aa9ad8aff931a921d1463e3e133572`.

La tercera versión (`2a0dcc1bdc759386358ecdafbdab464ba9c9919a`) sigue en `db/migrations/0022_pagos_proveedores.sql`. La prueba comprueba hashes SHA-256 de las dos copias históricas y compara el catálogo final con una instalación nueva.
