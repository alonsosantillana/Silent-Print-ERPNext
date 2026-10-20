## ADDED Requirements

### Requirement: Generacion mediante API soportada
El sistema MUST generar PDFs con las APIs publicas de Frappe v15 y MUST NOT
mantener una copia local de la implementacion de `frappe.utils.pdf`.

#### Scenario: Generacion valida
- **WHEN** existe un `Silent Print Format` valido y el usuario puede imprimir el documento
- **THEN** el sistema llama a `frappe.get_print` con generacion PDF y devuelve bytes codificados en base64

#### Scenario: Dependencias PDF
- **WHEN** se instala la app en un entorno Frappe v15 limpio
- **THEN** la app no requiere imports directos de `PyPDF2`, `pdfkit`, `six`, BeautifulSoup o `distutils` para generar el PDF

### Requirement: Validacion previa del formato
El sistema MUST validar la configuracion `Silent Print Format` antes de ejecutar
el renderizado costoso del documento.

#### Scenario: Formato silencioso inexistente
- **WHEN** el Print Format solicitado no tiene un registro `Silent Print Format`
- **THEN** `create_pdf` devuelve una respuesta que permite usar impresion nativa sin invocar wkhtmltopdf

#### Scenario: Print Format enlazado inexistente
- **WHEN** la configuracion referencia un Print Format eliminado o invalido
- **THEN** el sistema informa el error y no intenta generar el PDF

### Requirement: Opciones de pagina estandar
El sistema MUST trasladar el tamaño estandar configurado a `pdf_options` sin
alterar opciones no incluidas en el alcance.

#### Scenario: Pagina A4
- **WHEN** `page_size` es `A4`
- **THEN** la generacion recibe `page-size=A4`

#### Scenario: Ausencia de tamaño
- **WHEN** un registro heredado no contiene `page_size`
- **THEN** el sistema utiliza `A4` como valor compatible y documentado

### Requirement: Opciones de pagina custom
El sistema MUST aceptar solamente dimensiones positivas y margenes no negativos
para pagina custom y MUST expresar los valores a wkhtmltopdf con unidades `mm`.

#### Scenario: Dimensiones validas
- **WHEN** una configuracion custom contiene ancho 80, alto 200 y margenes validos
- **THEN** `pdf_options` contiene `page-width=80mm`, `page-height=200mm` y los margenes normalizados

#### Scenario: Dimension ausente
- **WHEN** una pagina custom no tiene ancho o alto
- **THEN** el sistema rechaza la configuracion con un mensaje que identifica el campo requerido

#### Scenario: Valor invalido
- **WHEN** una dimension no es numerica, no es positiva o un margen es negativo
- **THEN** el sistema rechaza la configuracion antes de invocar el generador PDF

### Requirement: Membrete y contexto de impresion
El sistema MUST conservar el parametro `no_letterhead`, idioma de la solicitud y
contexto de permisos al delegar la impresion a Frappe.

#### Scenario: Impresion sin membrete
- **WHEN** el solicitante envia `no_letterhead=1`
- **THEN** Frappe genera el documento sin membrete

#### Scenario: Idioma de sesion o solicitud
- **WHEN** Frappe establece el idioma aplicable a la solicitud
- **THEN** el PDF usa ese contexto sin hardcodear un idioma en el backend

### Requirement: Respuesta de PDF acotada
El sistema MUST devolver solamente el PDF base64 y el tipo de impresora efectivo
necesarios para el cliente.

#### Scenario: Respuesta exitosa
- **WHEN** la generacion finaliza correctamente
- **THEN** la respuesta contiene `pdf_base64` y `print_type` sin cookies, rutas temporales ni metadatos de sesion
