<?php
header("Content-Type: application/json");

if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    http_response_code(405);
    echo json_encode(["status" => "error", "message" => "Invalid request method."]);
    exit();
}

$idNo = trim($_POST["id_no"] ?? "");
$password = $_POST["password"] ?? "";

if ($idNo === "" || strlen($idNo) > 50 || $password === "") {
    http_response_code(400);
    echo json_encode(["status" => "error", "message" => "Enter your ID number and password."]);
    exit();
}

require_once __DIR__ . "/db.php";

$stmt = $conn->prepare("SELECT id, name, password_hash, is_admin FROM users WHERE id_no = ?");
if (!$stmt) {
    http_response_code(500);
    echo json_encode(["status" => "error", "message" => "Sign-in is temporarily unavailable."]);
    $conn->close();
    exit();
}

$stmt->bind_param("s", $idNo);
$stmt->execute();
$result = $stmt->get_result();
$user = $result->fetch_assoc();
$stmt->close();
$conn->close();

if (!$user || !password_verify($password, $user["password_hash"])) {
    http_response_code(401);
    echo json_encode(["status" => "error", "message" => "ID number or password is incorrect."]);
    exit();
}

session_start();
session_regenerate_id(true);
$_SESSION["user_id"] = (int)$user["id"];
$_SESSION["user_name"] = $user["name"];
$_SESSION["is_admin"] = (bool)$user["is_admin"];

echo json_encode(["status" => "success", "message" => "You are now signed in."]);
?>
