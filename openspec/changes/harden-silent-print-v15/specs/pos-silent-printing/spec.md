## ADDED Requirements

### Requirement: Integracion con POS de ERPNext v15
La app MUST extender el flujo `print_receipt` disponible en ERPNext v15 sin
modificar archivos core y MUST instalar la extension una sola vez.

#### Scenario: Carga de Point of Sale
- **WHEN** se abre la pagina `point-of-sale`
- **THEN** la extension conserva el metodo nativo original y evita aplicar dos veces el override

#### Scenario: Actualizacion incompatible
- **WHEN** la clase o el metodo esperado de POS no esta disponible
- **THEN** la app no rompe la pagina y conserva el comportamiento nativo

### Requirement: Impresion silenciosa configurada
POS MUST enviar silenciosamente el recibo cuando su Print Format tenga una
configuracion `Silent Print Format` valida.

#### Scenario: Recibo configurado
- **WHEN** el usuario pulsa imprimir y el formato POS esta configurado
- **THEN** la app genera el PDF con el documento correcto y lo envia al tipo de impresora por defecto

#### Scenario: Una accion de usuario
- **WHEN** el usuario ejecuta una unica accion de impresion
- **THEN** la app crea como maximo un trabajo para HWB

### Requirement: Fallback de impresion nativa
POS MUST ejecutar el metodo nativo cuando no exista configuracion silenciosa o
cuando HWB falle antes de aceptar el trabajo.

#### Scenario: Formato no configurado
- **WHEN** el formato del POS no tiene `Silent Print Format`
- **THEN** se abre el flujo de impresion nativo de ERPNext

#### Scenario: Conexion nunca abierta
- **WHEN** HWB agota los intentos sin aceptar el trabajo
- **THEN** la app ofrece o ejecuta el fallback nativo sin marcar el trabajo como enviado

#### Scenario: Desconexion posterior al envio
- **WHEN** el socket se desconecta despues de `websocket.send()`
- **THEN** la app no ejecuta fallback automatico que pueda duplicar el recibo

### Requirement: Contexto del recibo
La impresion silenciosa de POS MUST conservar DocType, nombre, Print Format,
membrete e idioma aplicables al recibo.

#### Scenario: Recibo con idioma
- **WHEN** el documento POS tiene un idioma especifico
- **THEN** la solicitud de PDF conserva ese contexto de idioma

#### Scenario: Permiso insuficiente
- **WHEN** el usuario no puede imprimir el documento POS
- **THEN** el backend rechaza la generacion y el cliente no lo envia a HWB

### Requirement: Compatibilidad del flujo ordinario
La presencia de `silent_print` MUST NOT cambiar el comportamiento de POS para
formatos no configurados.

#### Scenario: Instalacion sin configuracion Silent Print
- **WHEN** la app esta instalada pero no hay registros aplicables
- **THEN** imprimir en POS produce el mismo flujo nativo que ERPNext v15
