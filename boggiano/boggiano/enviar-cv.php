<?php
/**
 * Receives job applications from the "Trabajá con nosotros" form.
 * Validates input, stores the PDF in uploads/cv/ and emails it to the client.
 * Always responds JSON: { ok: bool, message: string, errors: { field: message } }
 */

declare(strict_types=1);

const MAX_CV_BYTES = 2 * 1024 * 1024;
const UPLOAD_DIR = __DIR__ . '/uploads/cv';
const STORAGE_DIR = __DIR__ . '/storage';
const BRANCHES_FILE = __DIR__ . '/data/sucursales.json';
const ANY_BRANCH = 'indistinta';

// Hosting servers often run on UTC or a European zone; dates go to an Argentine inbox.
date_default_timezone_set('America/Argentina/Cordoba');

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

function respond(int $status, bool $ok, string $message, array $errors = []): never
{
    http_response_code($status);
    echo json_encode(
        ['ok' => $ok, 'message' => $message, 'errors' => (object) $errors],
        JSON_UNESCAPED_UNICODE
    );
    exit;
}

function field(string $name): string
{
    $value = $_POST[$name] ?? '';
    return is_string($value) ? trim($value) : '';
}

/** Removes CR/LF so values are safe inside mail headers. */
function header_safe(string $value): string
{
    return trim(preg_replace('/[\r\n]+/', ' ', $value) ?? '');
}

function encode_header(string $value): string
{
    return '=?UTF-8?B?' . base64_encode(header_safe($value)) . '?=';
}

/** @return array<string, string> branch id => branch name */
function load_branches(): array
{
    $json = @file_get_contents(BRANCHES_FILE);
    $data = $json === false ? null : json_decode($json, true);
    $branches = [ANY_BRANCH => 'Cualquiera / indistinta'];
    foreach (($data['sucursales'] ?? []) as $branch) {
        if (isset($branch['id'], $branch['nombre'])) {
            $branches[(string) $branch['id']] = (string) $branch['nombre'];
        }
    }
    return $branches;
}

/* ---------- Rate limit (file based, keyed by salted IP hash) ---------- */

function rate_limit_key(array $config): string
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    return hash('sha256', $config['ip_salt'] . '|' . $ip);
}

/**
 * Runs $callback under an exclusive lock on the rate-limit file.
 * The callback receives the pruned hits map by reference.
 */
function with_rate_limit_store(array $config, callable $callback): mixed
{
    if (!is_dir(STORAGE_DIR)) {
        mkdir(STORAGE_DIR, 0750, true);
    }
    $handle = fopen(STORAGE_DIR . '/rate-limit.json', 'c+');
    if ($handle === false) {
        // Fail open: a broken store should not block real applicants.
        error_log('enviar-cv: cannot open rate limit store');
        $empty = [];
        return $callback($empty);
    }

    flock($handle, LOCK_EX);
    $raw = stream_get_contents($handle);
    $hits = json_decode($raw ?: '[]', true);
    $hits = is_array($hits) ? $hits : [];

    $cutoff = time() - (int) $config['rate_limit_window'];
    foreach ($hits as $key => $timestamps) {
        $hits[$key] = array_values(array_filter((array) $timestamps, fn ($t) => $t > $cutoff));
        if ($hits[$key] === []) {
            unset($hits[$key]);
        }
    }

    $result = $callback($hits);

    ftruncate($handle, 0);
    rewind($handle);
    fwrite($handle, json_encode($hits));
    fflush($handle);
    flock($handle, LOCK_UN);
    fclose($handle);

    return $result;
}

function is_rate_limited(array $config): bool
{
    $key = rate_limit_key($config);
    return with_rate_limit_store($config, function (array &$hits) use ($key, $config): bool {
        return count($hits[$key] ?? []) >= (int) $config['rate_limit_max'];
    });
}

function record_submission(array $config): void
{
    $key = rate_limit_key($config);
    with_rate_limit_store($config, function (array &$hits) use ($key): void {
        $hits[$key][] = time();
    });
}

/* ---------- Validation ---------- */

/** @return array{0: array<string, string>, 1: array<string, string>} [clean data, errors] */
function validate_fields(array $branches): array
{
    $data = [
        'nombre' => field('nombre'),
        'apellido' => field('apellido'),
        'dni' => str_replace('.', '', field('dni')),
        'telefono' => field('telefono'),
        'email' => field('email'),
        'sucursal' => field('sucursal'),
        'mensaje' => field('mensaje'),
    ];
    $errors = [];
    $namePattern = "/^\\p{L}[\\p{L}\\s'.-]{1,59}$/u";

    if (!preg_match($namePattern, $data['nombre'])) {
        $errors['nombre'] = 'Ingresá tu nombre (solo letras).';
    }
    if (!preg_match($namePattern, $data['apellido'])) {
        $errors['apellido'] = 'Ingresá tu apellido (solo letras).';
    }
    if (!preg_match('/^\d{7,8}$/', $data['dni'])) {
        $errors['dni'] = 'Ingresá un DNI válido: 7 u 8 números, sin puntos.';
    }
    $phoneDigits = preg_replace('/\D/', '', $data['telefono']) ?? '';
    if (!preg_match('/^[\d\s()+-]{8,20}$/', $data['telefono']) || strlen($phoneDigits) < 8 || strlen($phoneDigits) > 15) {
        $errors['telefono'] = 'Ingresá un teléfono válido con código de área.';
    }
    if (strlen($data['email']) > 120 || filter_var($data['email'], FILTER_VALIDATE_EMAIL) === false) {
        $errors['email'] = 'Ingresá un email válido.';
    }
    if (!array_key_exists($data['sucursal'], $branches)) {
        $errors['sucursal'] = 'Elegí una sucursal de la lista.';
    }
    if (mb_strlen($data['mensaje']) > 1000) {
        $errors['mensaje'] = 'El mensaje puede tener hasta 1000 caracteres.';
    }

    return [$data, $errors];
}

/** @return string|null error message, or null when the upload is a valid PDF */
function validate_cv(?array $file): ?string
{
    if ($file === null || !isset($file['error']) || is_array($file['error'])) {
        return 'Adjuntá tu CV en PDF.';
    }

    switch ($file['error']) {
        case UPLOAD_ERR_OK:
            break;
        case UPLOAD_ERR_NO_FILE:
            return 'Adjuntá tu CV en PDF.';
        case UPLOAD_ERR_INI_SIZE:
        case UPLOAD_ERR_FORM_SIZE:
            return 'El archivo supera los 2 MB.';
        default:
            return 'No pudimos recibir el archivo. Probá de nuevo.';
    }

    if (!is_uploaded_file($file['tmp_name'])) {
        return 'No pudimos recibir el archivo. Probá de nuevo.';
    }
    if ($file['size'] <= 0 || $file['size'] > MAX_CV_BYTES) {
        return 'El archivo supera los 2 MB.';
    }
    if (strtolower(pathinfo((string) $file['name'], PATHINFO_EXTENSION)) !== 'pdf') {
        return 'El CV tiene que ser un archivo PDF.';
    }

    // Trust the content, not the browser-provided type.
    $mime = (new finfo(FILEINFO_MIME_TYPE))->file($file['tmp_name']);
    $handle = fopen($file['tmp_name'], 'rb');
    $magic = $handle ? fread($handle, 5) : '';
    if ($handle) {
        fclose($handle);
    }
    if ($mime !== 'application/pdf' || $magic !== '%PDF-') {
        return 'El CV tiene que ser un archivo PDF.';
    }

    return null;
}

/* ---------- Email ---------- */

function attachment_name(array $data): string
{
    $base = 'CV-' . $data['apellido'] . '-' . $data['nombre'];
    $ascii = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $base) ?: 'CV';
    $clean = trim(preg_replace('/[^A-Za-z0-9-]+/', '-', $ascii) ?? '', '-');
    return ($clean !== '' ? $clean : 'CV') . '.pdf';
}

function build_email(array $config, array $data, string $branchName, string $pdfPath): array
{
    $fullName = $data['nombre'] . ' ' . $data['apellido'];
    $subject = encode_header('Nueva postulación: ' . $fullName);
    $boundary = 'b_' . bin2hex(random_bytes(12));

    $lines = [
        'Nueva postulación recibida desde la web.',
        '',
        'Nombre: ' . $data['nombre'],
        'Apellido: ' . $data['apellido'],
        'DNI: ' . $data['dni'],
        'Teléfono: ' . $data['telefono'],
        'Email: ' . $data['email'],
        'Sucursal de preferencia: ' . $branchName,
        '',
        'Mensaje:',
        $data['mensaje'] !== '' ? $data['mensaje'] : '(sin mensaje)',
        '',
        'Fecha: ' . date('d/m/Y H:i'),
        'Archivo guardado: uploads/cv/' . basename($pdfPath),
    ];

    $body = "This is a multi-part message in MIME format.\r\n\r\n"
        . "--{$boundary}\r\n"
        . "Content-Type: text/plain; charset=UTF-8\r\n"
        . "Content-Transfer-Encoding: base64\r\n\r\n"
        . chunk_split(base64_encode(implode("\r\n", $lines)))
        . "--{$boundary}\r\n"
        . 'Content-Type: application/pdf; name="' . attachment_name($data) . "\"\r\n"
        . "Content-Transfer-Encoding: base64\r\n"
        . 'Content-Disposition: attachment; filename="' . attachment_name($data) . "\"\r\n\r\n"
        . chunk_split(base64_encode((string) file_get_contents($pdfPath)))
        . "--{$boundary}--\r\n";

    $headers = [
        'From: ' . encode_header($config['mail_from_name']) . ' <' . header_safe($config['mail_from']) . '>',
        'Reply-To: ' . header_safe($data['email']),
        'MIME-Version: 1.0',
        "Content-Type: multipart/mixed; boundary=\"{$boundary}\"",
        'X-Mailer: PHP',
    ];

    return [$subject, $body, implode("\r\n", $headers)];
}

function send_email(array $config, string $subject, string $body, string $headers): bool
{
    $to = header_safe($config['mail_to']);

    if (($config['mail_transport'] ?? 'mail') === 'file') {
        $dir = STORAGE_DIR . '/mail';
        if (!is_dir($dir)) {
            mkdir($dir, 0750, true);
        }
        $eml = "To: {$to}\r\nSubject: {$subject}\r\n{$headers}\r\n\r\n{$body}";
        return file_put_contents($dir . '/' . date('Ymd-His') . '-' . bin2hex(random_bytes(4)) . '.eml', $eml) !== false;
    }

    return mail($to, $subject, $body, $headers);
}

/* ---------- Request handling ---------- */

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    respond(405, false, 'Método no permitido.');
}

// When the body exceeds post_max_size PHP silently empties $_POST and $_FILES.
if ($_POST === [] && $_FILES === [] && (int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 0) {
    respond(413, false, 'El archivo supera los 2 MB.', ['cv' => 'El archivo supera los 2 MB.']);
}

$configFile = __DIR__ . '/config.php';
if (!is_file($configFile)) {
    error_log('enviar-cv: config.php is missing');
    respond(500, false, 'El formulario no está disponible en este momento. Probá más tarde.');
}
$config = require $configFile;

$successMessage = '¡Gracias! Recibimos tu postulación. Si tu perfil coincide con lo que buscamos, te vamos a contactar.';

// Honeypot filled: pretend success so bots don't learn anything.
if (field('website') !== '') {
    respond(200, true, $successMessage);
}

if (is_rate_limited($config)) {
    respond(429, false, 'Recibimos varias postulaciones desde tu conexión. Probá de nuevo más tarde.');
}

$branches = load_branches();
[$data, $errors] = validate_fields($branches);
$cvError = validate_cv($_FILES['cv'] ?? null);
if ($cvError !== null) {
    $errors['cv'] = $cvError;
}
if ($errors !== []) {
    respond(422, false, 'Revisá los campos marcados.', $errors);
}

if (!is_dir(UPLOAD_DIR)) {
    mkdir(UPLOAD_DIR, 0750, true);
}
$storedName = date('Ymd-His') . '-' . bin2hex(random_bytes(8)) . '.pdf';
$storedPath = UPLOAD_DIR . '/' . $storedName;

if (!move_uploaded_file($_FILES['cv']['tmp_name'], $storedPath)) {
    error_log('enviar-cv: could not move uploaded file');
    respond(500, false, 'No pudimos guardar tu CV. Probá de nuevo más tarde.');
}
@chmod($storedPath, 0640);

[$subject, $body, $headers] = build_email($config, $data, $branches[$data['sucursal']], $storedPath);

if (!send_email($config, $subject, $body, $headers)) {
    // Without the email the client never sees the application, so roll back.
    @unlink($storedPath);
    error_log('enviar-cv: email delivery failed');
    respond(500, false, 'No pudimos enviar tu postulación. Probá de nuevo más tarde.');
}

record_submission($config);
respond(200, true, $successMessage);
