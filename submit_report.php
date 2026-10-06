<?php
header("Content-Type: application/json");

function respondWithError($statusCode, $message) {
    http_response_code($statusCode);
    echo json_encode(["status" => "error", "message" => $message]);
}

if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    respondWithError(405, "Invalid request method.");
    exit();
}

$title = trim($_POST["title"] ?? "");
$category = trim($_POST["category"] ?? "");
$location = trim($_POST["location"] ?? "");
$description = trim($_POST["description"] ?? "");
$allowedCategories = [
    "Roads & Traffic",
    "Water & Sewage",
    "Garbage & Sanitation",
    "Electricity & Power",
    "Public Safety"
];

if ($title === "" || strlen($title) > 200 ||
    !in_array($category, $allowedCategories, true) ||
    $location === "" || strlen($location) > 255 ||
    $description === "" || strlen($description) > 10000) {
    respondWithError(400, "Complete all report fields with valid values.");
    exit();
}

$maxAttachments = 5;
$maxFileSize = 25 * 1024 * 1024;
$maxTotalSize = 50 * 1024 * 1024;
$allowedTypes = [
    "image/jpeg" => "jpg",
    "image/png" => "png",
    "image/webp" => "webp",
    "video/mp4" => "mp4",
    "video/webm" => "webm",
    "audio/mp4" => "mp4",
    "audio/webm" => "webm",
    "audio/ogg" => "ogg",
    "application/pdf" => "pdf"
];
$uploadedFiles = [];
$totalSize = 0;

if (isset($_FILES["attachments"])) {
    $files = $_FILES["attachments"];
    if (!is_array($files["name"])) {
        respondWithError(400, "Invalid attachment upload.");
        exit();
    }

    $fileCount = count($files["name"]);
    if ($fileCount > $maxAttachments) {
        respondWithError(400, "You can attach up to 5 files to one report.");
        exit();
    }

    $finfo = finfo_open(FILEINFO_MIME_TYPE);
    if ($finfo === false) {
        respondWithError(500, "File validation is unavailable on the server.");
        exit();
    }

    for ($index = 0; $index < $fileCount; $index++) {
        $error = $files["error"][$index];
        if ($error === UPLOAD_ERR_NO_FILE) {
            continue;
        }
        if ($error !== UPLOAD_ERR_OK) {
            finfo_close($finfo);
            respondWithError(400, "An attachment could not be uploaded. Check the file size and try again.");
            exit();
        }

        $size = (int)$files["size"][$index];
        $temporaryPath = $files["tmp_name"][$index];
        if ($size < 1 || $size > $maxFileSize || !is_uploaded_file($temporaryPath)) {
            finfo_close($finfo);
            respondWithError(400, "Attachments must be valid files no larger than 25 MB each.");
            exit();
        }

        $mimeType = finfo_file($finfo, $temporaryPath);
        if (!isset($allowedTypes[$mimeType])) {
            finfo_close($finfo);
            respondWithError(400, "Only JPG, PNG, WebP, MP4, WebM, OGG audio, and PDF files are allowed.");
            exit();
        }

        $totalSize += $size;
        if ($totalSize > $maxTotalSize) {
            finfo_close($finfo);
            respondWithError(400, "Attachments must total no more than 50 MB.");
            exit();
        }

        $originalName = basename(str_replace("\\", "/", $files["name"][$index]));
        $uploadedFiles[] = [
            "temporary_path" => $temporaryPath,
            "original_name" => substr($originalName, 0, 255),
            "mime_type" => $mimeType,
            "file_size" => $size,
            "extension" => $allowedTypes[$mimeType],
            "stored_name" => bin2hex(random_bytes(16)) . "." . $allowedTypes[$mimeType]
        ];
    }

    finfo_close($finfo);
}

require_once __DIR__ . "/db.php";

$uploadDirectory = __DIR__ . DIRECTORY_SEPARATOR . "uploads" . DIRECTORY_SEPARATOR . "reports";
$relativeDirectory = "uploads/reports";
if (count($uploadedFiles) > 0 && !is_dir($uploadDirectory) &&
    !mkdir($uploadDirectory, 0750, true) && !is_dir($uploadDirectory)) {
    http_response_code(500);
    echo json_encode(["status" => "error", "message" => "File storage is unavailable on the server."]);
    $conn->close();
    exit();
}

if (!$conn->begin_transaction()) {
    http_response_code(500);
    echo json_encode(["status" => "error", "message" => "The report could not be saved. Please try again."]);
    $conn->close();
    exit();
}

$reportStmt = $conn->prepare("INSERT INTO reports (title, category, location, description) VALUES (?, ?, ?, ?)");
if (!$reportStmt) {
    $conn->rollback();
    http_response_code(500);
    echo json_encode(["status" => "error", "message" => "The report could not be saved. Please try again."]);
    $conn->close();
    exit();
}

$reportStmt->bind_param("ssss", $title, $category, $location, $description);
if (!$reportStmt->execute()) {
    $reportStmt->close();
    $conn->rollback();
    http_response_code(500);
    echo json_encode(["status" => "error", "message" => "The report could not be saved. Please try again."]);
    $conn->close();
    exit();
}

$reportId = $reportStmt->insert_id;
$reportStmt->close();
$movedFiles = [];
$attachmentStmt = null;

if (count($uploadedFiles) > 0) {
    $attachmentStmt = $conn->prepare("INSERT INTO report_attachments (report_id, file_path, original_name, mime_type, file_size) VALUES (?, ?, ?, ?, ?)");
    if (!$attachmentStmt) {
        $conn->rollback();
        http_response_code(500);
        echo json_encode(["status" => "error", "message" => "The attachments could not be saved. Please try again."]);
        $conn->close();
        exit();
    }
}

foreach ($uploadedFiles as $file) {
    $absolutePath = $uploadDirectory . DIRECTORY_SEPARATOR . $file["stored_name"];
    $relativePath = $relativeDirectory . "/" . $file["stored_name"];
    if (!move_uploaded_file($file["temporary_path"], $absolutePath)) {
        foreach ($movedFiles as $movedFile) {
            unlink($movedFile);
        }
        if ($attachmentStmt) {
            $attachmentStmt->close();
        }
        $conn->rollback();
        http_response_code(500);
        echo json_encode(["status" => "error", "message" => "An attachment could not be saved. Please try again."]);
        $conn->close();
        exit();
    }

    $movedFiles[] = $absolutePath;
    $fileSize = $file["file_size"];
    $originalName = $file["original_name"];
    $mimeType = $file["mime_type"];
    $attachmentStmt->bind_param(
        "isssi",
        $reportId,
        $relativePath,
        $originalName,
        $mimeType,
        $fileSize
    );

    if (!$attachmentStmt->execute()) {
        foreach ($movedFiles as $movedFile) {
            unlink($movedFile);
        }
        $attachmentStmt->close();
        $conn->rollback();
        http_response_code(500);
        echo json_encode(["status" => "error", "message" => "An attachment could not be saved. Please try again."]);
        $conn->close();
        exit();
    }
}

if ($attachmentStmt) {
    $attachmentStmt->close();
}

if (!$conn->commit()) {
    foreach ($movedFiles as $movedFile) {
        unlink($movedFile);
    }
    $conn->rollback();
    http_response_code(500);
    echo json_encode(["status" => "error", "message" => "The report could not be saved. Please try again."]);
    $conn->close();
    exit();
}

echo json_encode(["status" => "success", "message" => "Report submitted successfully with its attachments."]);
$conn->close();
?>
