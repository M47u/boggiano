<?php
/**
 * Copy this file as config.php and fill in the real values.
 * config.php is ignored by git and blocked from the web by .htaccess.
 */

return [
    // Inbox that receives the job applications.
    'mail_to' => 'rrhh@example.com',

    // Sender address. Use an address on the hosting's own domain
    // (e.g. no-reply@yourdomain.com) or many providers will flag it as spam.
    'mail_from' => 'no-reply@example.com',
    'mail_from_name' => 'Web Fiambrería Boggiano',

    // 'mail' = send with PHP mail() (production).
    // 'file' = write the email as .eml into storage/mail/ (local testing, no mail server needed).
    'mail_transport' => 'mail',

    // Anti-spam: max successful applications per IP within the window.
    'rate_limit_max' => 3,
    'rate_limit_window' => 3600, // seconds

    // Random string used to hash IPs before storing them. Change it.
    'ip_salt' => 'change-me-to-a-long-random-string',
];
