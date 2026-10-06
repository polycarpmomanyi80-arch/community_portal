<?php
header("Content-Type: application/json");
require_once __DIR__ . "/db.php";

$sql = "SELECT r.id, r.title, r.category, r.location, r.description, r.status, r.created_at,
               a.id AS attachment_id, a.file_path AS attachment_path,
               a.original_name AS attachment_name, a.mime_type AS attachment_type,
               s.response_text, s.action_taken, s.status AS solution_status,
               s.reference_file_path, s.reference_file_name, s.reference_mime_type,
               s.created_at AS responded_at
        FROM reports r
        LEFT JOIN report_attachments a ON a.report_id = r.id
        LEFT JOIN report_solutions s ON s.report_id = r.id
        ORDER BY r.created_at DESC, a.id ASC";
$result = $conn->query($sql);

if (!$result) {
    http_response_code(500);
    echo json_encode(["status" => "error", "message" => "Failed to fetch reports."]);
    $conn->close();
    exit();
}

$reportsById = [];

if ($result->num_rows > 0) {
    while ($row = $result->fetch_assoc()) {
        $reportId = $row["id"];
        if (!isset($reportsById[$reportId])) {
            $reportsById[$reportId] = [
                "id" => $row["id"],
                "title" => $row["title"],
                "category" => $row["category"],
                "location" => $row["location"],
                "description" => $row["description"],
                "status" => $row["status"],
                "created_at" => $row["created_at"],
                "attachments" => [],
                "solution" => $row["response_text"] === null ? null : [
                    "response" => $row["response_text"],
                    "action_taken" => $row["action_taken"],
                    "status" => $row["solution_status"],
                    "reference_file" => $row["reference_file_path"] === null ? null : [
                        "path" => $row["reference_file_path"],
                        "name" => $row["reference_file_name"],
                        "type" => $row["reference_mime_type"]
                    ],
                    "responded_at" => $row["responded_at"]
                ]
            ];
        }

        if ($row["attachment_id"] !== null) {
            $reportsById[$reportId]["attachments"][] = [
                "path" => $row["attachment_path"],
                "name" => $row["attachment_name"],
                "type" => $row["attachment_type"]
            ];
        }
    }
}

echo json_encode(["status" => "success", "data" => array_values($reportsById)]);
$conn->close();
?>