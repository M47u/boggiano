# Fiambrería Boggiano — sitio informativo

Landing page estática (HTML, CSS y JS vanilla) con un único endpoint PHP para recibir postulaciones.
**No tiene carrito, stock, pagos ni login.**

```
index.html            Página única con todas las secciones
css/styles.css        Estilos (colores y tipografías en :root)
js/main.js            Menú, catálogo, sucursales y formulario
data/catalogo.json    Productos y categorías
data/sucursales.json  Sucursales
img/                  Imágenes (placeholders por ahora)
enviar-cv.php         Recibe el formulario "Trabajá con nosotros"
config.example.php    Plantilla de configuración del email
uploads/cv/           CVs recibidos (bloqueados al público)
storage/              Datos internos: límite por IP y emails de prueba (bloqueado al público)
```

## Requisitos

- Hosting con Apache y PHP 8.1 o superior, con las extensiones `fileinfo`, `mbstring` e `iconv` (vienen por defecto casi siempre).
- El sitio tiene que abrirse desde un servidor. Si abrís `index.html` con doble clic, el catálogo y las sucursales no cargan, porque el navegador bloquea `fetch()` en `file://`. En local alcanza con XAMPP: `http://localhost/boggiano/`.

## Editar el catálogo

Archivo: `data/catalogo.json`.

```json
{
  "categoria": "quesos",
  "nombre": "Queso azul",
  "descripcion": "Cremoso y potente, para tablas y salsas.",
  "imagen": "img/productos/queso-azul.jpg",
  "precio": ""
}
```

| Campo | Obligatorio | Notas |
|---|---|---|
| `categoria` | Sí | Tiene que coincidir con un `id` de la lista `categorias` |
| `nombre` | Sí | También se usa como texto alternativo de la imagen |
| `descripcion` | No | Una o dos líneas |
| `imagen` | Sí | Ruta relativa. Recomendado: JPG o WebP de 800×600 (4:3), de menos de 150 KB |
| `precio` | No | Vacío (`""`) = no se muestra. Número (`9500`) = se muestra como `$ 9.500`. Texto (`"$ 9.500 el kg"`) = se muestra tal cual |

- **Agregar una categoría:** sumala a `categorias` con un `id` sin espacios ni tildes. Las categorías sin productos no aparecen.
- **Orden:** los productos se muestran en el orden del archivo, agrupados según el orden de `categorias`.
- **Antes de subir:** revisá que el JSON sea válido (por ejemplo en <https://jsonlint.com>). Una coma de más rompe el catálogo entero y aparece el mensaje "No pudimos cargar el catálogo".

## Editar sucursales

Archivo: `data/sucursales.json`.

```json
{
  "id": "lote-4",
  "nombre": "Lote 4",
  "direccion": "Entre Ríos 2095",
  "ciudad": "Formosa",
  "horarios": "Lun a Sáb 8 a 12 y 17 a 21",
  "telefono": "",
  "whatsapp": false,
  "lat": null,
  "lng": null
}
```

- **`id`**: sin espacios ni tildes. Es el valor que llega en el formulario de postulación. **Si cambiás un `id`, el servidor rechaza los formularios que todavía lo tengan cargado**, así que conviene no tocarlo una vez publicado.
- **`telefono`**: con código de área y sin 0 ni 15, por ejemplo `370 503-5029`. Si está vacío, no se muestran el teléfono ni el botón de WhatsApp.
- **`whatsapp`**: ponelo en `false` si el número es un fijo sin WhatsApp.
- **`lat` / `lng`**: opcionales. Si los completás (con números, sin comillas, por ejemplo `-26.1849`), "Cómo llegar" apunta al punto exacto. Si no, Google Maps busca por la dirección. Para obtenerlos: en Google Maps, clic derecho sobre el local y clic en las coordenadas para copiarlas.
- El `select` del formulario y los teléfonos del footer se arman solos a partir de este archivo.

**Importante (SEO):** en `index.html` hay un bloque `<script type="application/ld+json">` con un `FoodEstablishment` por sucursal (dirección, teléfono y horarios para Google). Es estático a propósito, para que Google lo lea sin ejecutar JavaScript. **Si cambiás una sucursal en el JSON, actualizá también ese bloque.** Los horarios ahí van en formato 24 h (`"opens": "08:00"`).

## Configurar el email de postulaciones

1. Copiá `config.example.php` como `config.php` (en la misma carpeta).
2. Completá:
   - `mail_to`: casilla que recibe los CV.
   - `mail_from`: **una casilla del mismo dominio del hosting** (por ejemplo `no-reply@fiambreriaboggiano.com.ar`). Si usás una de Gmail u otro dominio, el mail suele terminar en spam o no llegar.
   - `mail_transport`: `mail` en producción y `file` para pruebas locales (guarda el mail como `.eml` en `storage/mail/`, sin enviarlo).
   - `ip_salt`: cualquier texto largo y aleatorio.
3. Hacé una postulación de prueba y revisá también la carpeta de spam.

`config.php` está en `.gitignore` y bloqueado por `.htaccess`.

**Si los mails no llegan:** algunos hostings deshabilitan `mail()` o lo limitan. La alternativa es enviar por SMTP con una cuenta real (PHPMailer). Implica sumar esa librería al proyecto.

### Qué hace `enviar-cv.php`

- Valida nombre, apellido, DNI (7 u 8 números), teléfono, email, sucursal (contra `sucursales.json`) y mensaje de hasta 1000 caracteres.
- Valida que el CV sea un PDF real (extensión, tipo MIME detectado por el servidor y firma `%PDF-`) y de 2 MB como máximo.
- Guarda el PDF en `uploads/cv/` con nombre único. La carpeta no es accesible desde la web.
- Envía el mail con los datos y el PDF adjunto. Si el envío falla, borra el archivo y le muestra un error al postulante.
- Anti-spam: campo trampa (honeypot) y máximo 3 postulaciones por IP por hora (configurable). Las IP se guardan hasheadas.

**Límites de PHP:** `upload_max_filesize` y `post_max_size` del hosting tienen que ser de al menos 3M. Si son menores, los PDF cercanos a 2 MB se rechazan.

**Mantenimiento:** los CV quedan guardados en `uploads/cv/`. Conviene borrarlos periódicamente (son datos personales).

## Cambiar colores y tipografías

Todo está en `:root`, al principio de `css/styles.css`:

```css
--color-burgundy: #6e1f2b;
--font-display: "Fraunces", Georgia, serif;
```

Si cambiás las fuentes, actualizá también el `<link>` de Google Fonts en `index.html`. Revisá el contraste de los colores nuevos (mínimo 4.5:1 para texto) con <https://webaim.org/resources/contrastchecker/>.

## Encontrar los placeholders

Los textos e imágenes provisorios están marcados con `PLACEHOLDER` en comentarios o con el atributo `data-placeholder`:

```bash
rg -n "PLACEHOLDER|data-placeholder" index.html
```

También hay que reemplazar `https://www.example.com/` por el dominio real en `index.html` (canonical, Open Graph y JSON-LD).
