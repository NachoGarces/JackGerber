# JackGerber · Gerber → SVG para láser

Aplicación web que convierte los archivos de fabricación de una PCB (**Gerber** y taladros **Excellon**) en un **SVG en milímetros** listo para grabadoras láser (por ejemplo RDWorks).

Todo se procesa en tu navegador: no hay servidor y tus archivos no se suben a ningún sitio.

## Qué hace

- Convierte el Gerber de cobre en un SVG a tamaño real.
- Suma opcionalmente **pads**, **taladros** y **serigrafía**. Con varios archivos, el SVG lleva una capa por archivo, cada una de un color para elegir en RDWorks si se graba o se corta.
- Opciones: cobre en negativo, unir los taladros al cobre y a los pads, modo espejo (placa y serigrafía por separado) y marco de corte.
- Vista previa con zoom y desplazamiento antes de descargar.
- Selector de programa de diseño: KiCad, EasyEDA y Proteus.

## Cómo usarla

Abre [JackGerber](https://nachogarces.github.io/JackGerber/), sube tus archivos, configura según tus necesidades, pulsa **Generar** y luego **Descargar**.

## Estado del proyecto

En desarrollo. Las integraciones con **EasyEDA** y **Proteus** aún se están probando, y los **tutoriales de exportación** están en preparación.
