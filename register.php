<?php
header("Content-Type: application/json");

if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    http_response_code(405);
    echo json_encode(["status" => "error", "message" => "Invalid request method."]);
    exit();
}

$firstName = trim($_POST["first_name"] ?? "");
$secondName = trim($_POST["second_name"] ?? "");
$lastName = trim($_POST["last_name"] ?? "");
$email = strtolower(trim($_POST["email"] ?? ""));
$phoneNumber = trim($_POST["phone_number"] ?? "");
$idNo = trim($_POST["id_no"] ?? "");
$password = $_POST["password"] ?? "";
$name = trim("$firstName $secondName $lastName");

if ($firstName === "" || strlen($firstName) > 100 ||
    $secondName === "" || strlen($secondName) > 100 ||
    $lastName === "" || strlen($lastName) > 100 ||
    !filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 254 ||
    $phoneNumber === "" || strlen($phoneNumber) > 32 ||
    $idNo === "" || strlen($idNo) > 50 ||
    strlen($password) < 8 || strlen($password) > 72) {
    http_response_code(400);
    echo json_encode(["status" => "error", "message" => "Enter all required details, a valid email, and a password between 8 and 72 characters."]);
    exit();
}

require_once __DIR__ . "/db.php";

$passwordHash = password_hash($password, PASSWORD_DEFAULT);
$stmt = $conn->prepare("INSERT INTO users (name, first_name, second_name, last_name, email, phone_number, id_no, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");

if (!$stmt) {
    http_response_code(500);
    echo json_encode(["status" => "error", "message" => "Registration is temporarily unavailable."]);
    $conn->close();
    exit();
}

$stmt->bind_param("ssssssss", $name, $firstName, $secondName, $lastName, $email, $phoneNumber, $idNo, $passwordHash);

if (!$stmt->execute()) {
    if ($stmt->errno === 1062) {
        http_response_code(409);
        echo json_encode(["status" => "error", "message" => "An account with that email address or ID number already exists."]);
    } else {
        http_response_code(500);
        echo json_encode(["status" => "error", "message" => "Registration is temporarily unavailable."]);
    }
    $stmt->close();
    $conn->close();
    exit();
}

$userId = $stmt->insert_id;
$stmt->close();
$conn->close();

session_start();
session_regenerate_id(true);
$_SESSION["user_id"] = $userId;
$_SESSION["user_name"] = $name;
$_SESSION["is_admin"] = false;

echo json_encode(["status" => "success", "message" => "Registration complete. You are now signed in."]);
?>
