## 1. Preflight y decisiones operativas

- [ ] 1.1 Confirmar estado Git limpio, rama dedicada y versiones objetivo de Frappe, ERPNext, Python, navegador y Webapp Hardware Bridge.
- [ ] 1.2 Revisar en un sitio de desarrollo los registros existentes de `Silent Print Format` y `Silent Print Settings` sin exponer documentos, usuarios ni datos sensibles.
- [ ] 1.3 Resolver y documentar limites de cola, reintentos, timeout y tamaño maximo de PDF con mediciones del entorno de staging.
- [ ] 1.4 Confirmar si la version instalada de HWB entrega acuses utilizables y documentar el limite de garantia de no duplicacion.
- [ ] 1.5 Confirmar navegadores, esquema HTTPS y politicas CSP de staging para validar acceso a `ws://127.0.0.1:12212`.

## 2. Seguridad y enrutamiento backend

- [x] 2.1 Implementar validacion reusable de `print_user`, usuario habilitado, `tab_id` y tipo de impresora efectivo.
- [x] 2.2 Reemplazar el SQL interpolado de `set_master_tab` por `frappe.db.set_single_value` y validar formato y longitud del identificador.
- [x] 2.3 Restringir `set_master_tab` a la sesion del usuario impresor y cubrir explicitamente el rechazo de `Guest` y otros usuarios.
- [x] 2.4 Dirigir `update_master_tab` solamente al usuario impresor configurado.
- [x] 2.5 Limpiar `tab_id` cuando cambie `print_user` y convertir el campo de pestaña en solo lectura para configuracion manual.
- [x] 2.6 Implementar una API minima de configuracion cliente que no revele el usuario impresor a sesiones no autorizadas.
- [x] 2.7 Endurecer `print_silently` para no generar ni publicar cuando la configuracion este incompleta o invalida.
- [x] 2.8 Publicar `print-silently` siempre con un usuario receptor explicito y agregar un `job_id` opaco por orden.
- [x] 2.9 Mantener y verificar los permisos de impresion del solicitante sin usar `ignore_permissions`.
- [x] 2.10 Aplicar la precedencia `print_type` explicito, luego `default_print_type`, y rechazar el caso sin impresora efectiva.

## 3. Generacion PDF compatible con Frappe v15

- [x] 3.1 Validar la existencia de `Silent Print Format` y su Print Format enlazado antes de renderizar el documento.
- [x] 3.2 Construir opciones acotadas para tamaños estandar y pagina custom, normalizando dimensiones y margenes a `mm`.
- [x] 3.3 Delegar la generacion a `frappe.get_print(..., as_pdf=True, pdf_options=...)` conservando membrete, idioma y permisos.
- [x] 3.4 Eliminar la copia local de `get_pdf` y `prepare_options`, sus imports obsoletos y el `print()` de depuracion.
- [x] 3.5 Agregar validaciones de `Silent Print Format` para dimensiones positivas, margenes no negativos y tipo por defecto requerido cuando aplique.
- [x] 3.6 Confirmar que `requirements.txt` no necesita dependencias PDF directas adicionales despues de usar la API nativa.

## 4. Cliente WebSocket y pestaña maestra

- [x] 4.1 Refactorizar `WebSocketPrinter` para conexion bajo demanda y estados `idle`, `connecting`, `open`, `closed` y `failed`.
- [x] 4.2 Encolar trabajos recibidos durante la conexion y enviarlos solamente con `WebSocket.OPEN`.
- [x] 4.3 Limitar la cola en memoria y mostrar un error no sensible cuando se alcance el limite.
- [x] 4.4 Implementar reconexion con backoff y maximo de intentos, sin bucles inmediatos ilimitados.
- [x] 4.5 Evitar reenvio automatico de trabajos despues de que `websocket.send()` haya retornado sin error.
- [x] 4.6 Generar identificadores de pestaña con `crypto.randomUUID()` y fallback compatible de entropia suficiente.
- [x] 4.7 Mostrar el icono y activar listeners remotos solamente para el usuario impresor confirmado por backend.
- [x] 4.8 Procesar cada `job_id` una sola vez en la pestaña maestra y descartar eventos en las otras pestañas.
- [x] 4.9 Eliminar logs del payload, PDF base64, documento y pestaña; conservar solo mensajes tecnicos no sensibles cuando sean necesarios.
- [x] 4.10 Mostrar estados accionables para bridge ausente, conexion agotada, cola llena y configuracion invalida.
- [x] 4.11 Normalizar los acuses de HWB 0.13.0 y 1.0.1 conservando `job_id`, mensaje e impresora cuando exista.
- [x] 4.12 Diferenciar fallo previo al envio, rechazo confirmado y resultado ambiguo sin reintentar automaticamente un trabajo posiblemente aceptado.

## 5. Point of Sale ERPNext v15

- [ ] 5.1 Separar la extension POS en `public/js/pos_silent_print.js` y ajustar `page_js` sin duplicar la inicializacion global.
- [ ] 5.2 Extender una sola vez `PastOrderSummary.print_receipt` de ERPNext v15 y conservar referencia al metodo original.
- [ ] 5.3 Generar y enviar el recibo silencioso cuando el Print Format del POS tenga configuracion valida.
- [ ] 5.4 Ejecutar el flujo nativo cuando no exista `Silent Print Format` o el bridge falle antes de aceptar el trabajo.
- [ ] 5.5 Evitar fallback automatico y duplicacion despues de un `websocket.send()` exitoso.
- [ ] 5.6 Conservar DocType, nombre, formato, membrete e idioma del recibo POS.
- [ ] 5.7 Verificar que una clase o metodo POS ausente no rompa la pagina y deje activo el comportamiento nativo.

## 6. Pruebas automatizadas y funcionales

- [ ] 6.1 Reemplazar las clases de prueba vacias por pruebas Frappe v15 con aislamiento y limpieza de datos creados.
- [x] 6.2 Probar autorizacion de `set_master_tab`, valores manipulados y ausencia de modificaciones por usuarios no permitidos.
- [ ] 6.3 Probar que configuracion vacia, usuario deshabilitado o pestaña invalida nunca producen un broadcast Realtime.
- [x] 6.4 Probar entrega dirigida, `job_id`, permisos de documento y precedencia de `print_type`.
- [ ] 6.5 Probar opciones PDF A4 y custom, unidades, valores invalidos, membrete y respuesta base64 sin depender de un PDF real cuando pueda usarse mock.
- [ ] 6.6 Probar limpieza de `tab_id` al cambiar `print_user` y contrato de la API de configuracion cliente.
- [ ] 6.7 Probar en JavaScript conexion diferida, cola, limite, backoff, trabajo ya enviado y deduplicacion por `job_id`.
- [ ] 6.8 Probar POS configurado, fallback sin configuracion, fallo previo al envio y ausencia de fallback posterior al envio.
- [ ] 6.9 Ejecutar una prueba funcional controlada con HWB e impresora de prueba, registrando navegador, version y resultados sin contenido documental.
- [ ] 6.10 Verificar manualmente que usuarios Desk ordinarios no abren WebSocket ni reciben payloads remotos.

## 7. Documentacion, despliegue y cierre

- [ ] 7.1 Actualizar README con configuracion segura, seleccion de pestaña, precedencia de impresora, errores y fallback POS.
- [x] 7.2 Documentar requisitos de navegador/HWB, limites medidos y procedimiento de prueba sin incluir usuarios o datos reales.
- [ ] 7.3 Ejecutar validaciones Python, sintaxis JavaScript, JSON, pruebas Frappe y `openspec validate harden-silent-print-v15 --strict`.
- [x] 7.4 Revisar que el diff no contenga secretos, logs, PDFs, artefactos generados, `__pycache__` ni cambios fuera de alcance.
- [x] 7.5 Solicitar autorizacion antes de `bench build`, `bench migrate`, reinicio o cualquier prueba que modifique un sitio.
- [x] 7.6 Ejecutar despliegue y pruebas en staging solamente despues de la autorizacion requerida y registrar comandos/resultados.
- [ ] 7.7 Actualizar este checklist con tareas completadas, desviaciones, pruebas realizadas y validaciones pendientes.
- [ ] 7.8 Mostrar archivos creados, modificados y eliminados, `git status`, resumen de `git diff` y riesgos residuales.
- [ ] 7.9 Proponer un commit logico, realizar push de la rama y abrir Pull Request solamente cuando el usuario lo autorice.
- [ ] 7.10 Proponer el archivado OpenSpec despues de implementar, validar y aprobar el cambio; no archivarlo durante la fase de especificacion.

## Integracion solicitada — 2026-10-20

- El usuario autorizo integrar los cambios existentes en la rama principal y
  hacer push remoto. Rama de trabajo: `fix/silent-print-security-v15`; principal
  confirmada mediante `git remote show upstream`: `master`.
- Alcance de esta entrega: backend, controles de DocType, cliente
  `silent_print_v15.js`, README y especificacion existente. No se implementaron
  tareas adicionales de POS ni se modificaron otras apps.
- Desviacion del diseno: el cliente global se entrega como
  `silent_print/public/js/silent_print_v15.js`; el hook POS conserva el archivo
  legado. La seccion 5 y la validacion funcional del POS continuan pendientes.
- Validaciones aprobadas: `git diff --check`, sintaxis Python mediante AST,
  `node --check silent_print/public/js/silent_print_v15.js`, parseo de los JSON
  de ambos DocTypes y `openspec validate harden-silent-print-v15 --strict`
  usando Node 22 ya instalado. Node 18 no ejecuta esta version de OpenSpec.
- Las cuatro pruebas existentes de `test_service.py` pasaron en aislamiento
  mediante `unittest.TestCase`, con sesion, traducciones y errores simulados;
  no se ejecuto el ciclo `FrappeTestCase` ni se inicializo un sitio o base de
  datos. Esto no sustituye la suite de integracion Frappe ni pruebas con HWB.
- Se revisaron los archivos candidatos por patrones de secretos sin hallazgos.
  El respaldo `.orig` se conserva en `/tmp` y se excluye del commit, al igual
  que caches y archivos compilados. No hay archivos versionados eliminados.
- No se ejecutaron build, migrate, reinicios ni cambios de datos. Graphify
  no esta preparado en esta app y no se genero ningun grafo.
- Pendientes: pruebas de sitio, hardware, navegador/CSP y tareas no marcadas.
  OpenSpec permanece activo; proponer archivado cuando se complete y valide
  todo su alcance. El resultado del commit y push se verifica mediante Git
  y se comunica al usuario al finalizar la integracion.
