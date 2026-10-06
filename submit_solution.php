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

session_start();
if (empty($_SESSION["user_id"]) || empty($_SESSION["is_admin"])) {
    respondWithError(403, "Only staff accounts can add report responses.");
    exit();
}

$reportId = filter_var($_POST["report_id"] ?? null, FILTER_VALIDATE_INT, [
    "options" => ["min_range" => 1]
]);
$responseText = trim($_POST["response_text"] ?? "");
$actionTaken = trim($_POST["action_taken"] ?? "");
$status = $_POST["status"] ?? "";
$allowedStatuses = ["In Progress", "Resolved"];

if ($reportId === false || $reportId === null ||
    $responseText === "" || strlen($responseText) > 5000 ||
    $actionTaken === "" || strlen($actionTaken) > 5000 ||
    !in_array($status, $allowedStatuses, true)) {
    respondWithError(400, "Enter a first response, action taken, and valid report status.");
    exit();
}

$referenceFile = null;
if (!isset($_FILES["reference_file"]) || $_FILES["reference_file"]["error"] === UPLOAD_ERR_NO_FILE) {
    respondWithError(400, "Attach a reference file for the action taken.");
    exit();
}

if (isset($_FILES["reference_file"])) {
    $file = $_FILES["reference_file"];
    if ($file["error"] !== UPLOAD_ERR_OK || $file["size"] < 1 ||
        $file["size"] > 25 * 1024 * 1024 || !is_uploaded_file($file["tmp_name"])) {
        respondWithError(400, "The reference file must be a valid file no larger than 25 MB.");
        exit();
    }

    $allowedTypes = [
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/webp" => "webp",
        "video/mp4" => "mp4",
        "video/webm" => "webm",
        "application/pdf" => "pdf"
    ];
    $finfo = finfo_open(FILEINFO_MIME_TYPE);
    if ($finfo === false) {
        respondWithError(500, "File validation is unavailable on the server.");
        exit();
    }
    $mimeType = finfo_file($finfo, $file["tmp_name"]);
    finfo_close($finfo);

    if (!isset($allowedTypes[$mimeType])) {
        respondWithError(400, "Only JPG, PNG, WebP, MP4, WebM, and PDF files are allowed.");
        exit();
    }

    $originalName = basename(str_replace("\\", "/", $file["name"]));
    $referenceFile = [
        "temporary_path" => $file["tmp_name"],
        "path" => "uploads/solutions/" . bin2hex(random_bytes(16)) . "." . $allowedTypes[$mimeType],
        "name" => substr($originalName, 0, 255),
        "type" => $mimeType
    ];
}

require_once __DIR__ . "/db.php";

$reportStmt = $conn->prepare("SELECT id FROM reports WHERE id = ?");
if (!$reportStmt) {
    http_response_code(500);
    echo json_encode(["status" => "error", "message" => "The response could not be saved. Please try again."]);
    $conn->close();
    exit();
}
$reportStmt->bind_param("i", $reportId);
$reportStmt->execute();
$reportExists = $reportStmt->get_result()->num_rows === 1;
$reportStmt->close();

if (!$reportExists) {
    respondWithError(404, "The selected report could not be found.");
    $conn->close();
    exit();
}

$uploadDirectory = __DIR__ . DIRECTORY_SEPARATOR . "uploads" . DIRECTORY_SEPARATOR . "solutions";
if ($referenceFile !== null && !is_dir($uploadDirectory) &&
    !mkdir($uploadDirectory, 0750, true) && !is_dir($uploadDirectory)) {
    http_response_code(500);
    echo json_encode(["status" => "error", "message" => "Reference file storage is unavailable on the server."]);
    $conn->close();
    exit();
}

$absolutePath = null;
if ($referenceFile !== null) {
    $absolutePath = $uploadDirectory . DIRECTORY_SEPARATOR . basename($referenceFile["path"]);
    if (!move_uploaded_file($referenceFile["temporary_path"], $absolutePath)) {
        http_response_code(500);
        echo json_encode(["status" => "error", "message" => "The reference file could not be stored. Please try again."]);
        $conn->close();
        exit();
    }
}

$stmt = $conn->prepare(
    "INSERT INTO report_solutions
        (report_id, response_text, action_taken, status, reference_file_path, reference_file_name, reference_mime_type, responded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
);
if (!$stmt) {
    if ($absolutePath !== null) {
        unlink($absolutePath);
    }
    http_response_code(500);
    echo json_encode(["status" => "error", "message" => "The response could not be saved. Please try again."]);
    $conn->close();
    exit();
}

$filePath = $referenceFile["path"] ?? null;
$fileName = $referenceFile["name"] ?? null;
$fileType = $referenceFile["type"] ?? null;
$userId = (int)$_SESSION["user_id"];
$stmt->bind_param(
    "issssssi",
    $reportId,
    $responseText,
    $actionTaken,
    $status,
    $filePath,
    $fileName,
    $fileType,
    $userId
);

if (!$stmt->execute()) {
    if ($absolutePath !== null) {
        unlink($absolutePath);
    }
    if ($stmt->errno === 1062) {
        respondWithError(409, "A first response has already been added to this report.");
    } else {
        http_response_code(500);
        echo json_encode(["status" => "error", "message" => "The response could not be saved. Please try again."]);
    }
    $stmt->close();
    $conn->close();
    exit();
}

$stmt->close();
$conn->close();
echo json_encode(["status" => "success", "message" => "The first response, action taken, and reference file have been saved."]);
?>
